const os = require('os');
const { v4: uuidv4 } = require('uuid');

/**
 * The Jigasi json is a tree that has the following structure:
 * root->gateways->sessions->conferences
 * For easier processing we invert this tree like this:
 * root->conferences->sessions
 * @param jigasiJson
 */
function invertJigasiJson(jigasiJson) {
    const invertedJson = { conferences: [] };

    Object.keys(jigasiJson.gateways)
        .forEach(gatewayHash => {
            const gateway = jigasiJson.gateways[gatewayHash];

            Object.keys(gateway.sessions).forEach(sessionName => {
                const meetingId = gateway.sessions[sessionName].jvbConference.meetingId;
                const meetingUrl = gateway.sessions[sessionName].jvbConference.meetingUrl;

                if (meetingId) {
                    if (!invertedJson.conferences[meetingId]) {
                        invertedJson.conferences[meetingId] = { sessions: [],
                            meetingUrl };
                    }

                    invertedJson.conferences[meetingId].sessions.push(sessionName);
                }
            });
        });

    return invertedJson;
}

/**
 * Given the data retrieved from the jigasi REST API,
 * extract all of the conference IDs
 * @param jigasiJson
 */
function _getConferenceIds(jigasiJson) {
    return Object.keys(jigasiJson.conferences);
}

/**
 * Creates identity message that is pushed to rtcstats.
 * @param state
 * @returns {{data: Omit<*, "statsSessionId">, statsSessionId, type: string}}
 */
function _createIdentityMessage(state) {
    // This is a bit awkward: we keep the statsSessionId in the conference state,
    // but we need to set it as an explicit field of the message.  Also,
    const { statsSessionId, ...metadata } = state;

    return {
        type: 'identity',
        statsSessionId,
        data: metadata
    };
}

/**
 * The closing message for a session.
 * @param statsSessionId
 * @returns {{statsSessionId, type: string}}
 */
function _createCloseMsg(statsSessionId) {
    return {
        type: 'close',
        statsSessionId
    };
}

/**
 * Checks whether conferences are added or removed.
 * @param jigasiJson
 */
function checkForAddedOrRemovedConferences(jigasiJson, state, sendCb) {
    const confIds = _getConferenceIds(jigasiJson);
    const newConfIds = confIds.filter(id => !(id in state));
    const removedConfIds = Object.keys(state).filter(id => confIds.indexOf(id) === -1);

    newConfIds.forEach(newConfId => {
        const statsSessionId = uuidv4();
        const confState = {
            statsSessionId,
            confUrl: jigasiJson.conferences[newConfId].meetingUrl,
            displayName: os.hostname(),
            meetingUniqueId: newConfId,
            applicationName: 'JIGASI',
            sessions: []
        };

        state[newConfId] = confState;
        sendCb(_createIdentityMessage(confState));
    });
    removedConfIds.forEach(removedConfId => {
        const confState = state[removedConfId];

        delete state[removedConfId];
        sendCb(_createCloseMsg(confState.statsSessionId));
    });
}

/**
 * Checks for added or removed sessions.
 * @param confId - The id.
 * @param currentSessions - Current sessions.
 */
function _checkForAddedOrRemovedSessions(confId, currentSessions, state, sendCb) {
    const confState = state[confId];
    const oldSessions = confState.sessions;
    const newSessions = currentSessions.filter(currentSession => oldSessions.indexOf(currentSession) === -1);

    if (newSessions.length > 0) {
        confState.sessions.push(...newSessions);
        sendCb(_createIdentityMessage(confState));
    }
}

/**
 * Process jigasi json data.
 * @param json - The data.
 */
function processJigasiJson(json, state, sendCb) {
    const jigasiJson = invertJigasiJson(json);

    checkForAddedOrRemovedConferences(jigasiJson, state, sendCb);

    const timestamp = new Date();

    _getConferenceIds(jigasiJson).forEach(confId => {
        const confData = jigasiJson.conferences[confId];

        // The timestamp is at the top level, inject it into the conference data here
        confData.timestamp = timestamp;
        _checkForAddedOrRemovedSessions(confId, confData.sessions, state, sendCb);
    });
}

module.exports.processJigasiJson = processJigasiJson;
