const _ = require('lodash');
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
                const nick = gateway.sessions[sessionName].jvbConference.nick;

                if (meetingId) {
                    if (!invertedJson.conferences[meetingId]) {
                        invertedJson.conferences[meetingId] = {
                            meetingUrl,
                            caller: sessionName
                        };
                    }

                    if (nick) {
                        invertedJson.conferences[meetingId].nick = nick;
                    }
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
    // but we need to set it as an explicit field of the message.
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
 * @param state - The current state to check.
 * @param sendCb - The send data callback.
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
            applicationName: 'JIGASI'
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
 * @param currentData - Current data.
 * @param state - The current state to check.
 */
function _updateData(confId, currentData, state) {
    const confState = state[confId];

    if (!confState.data || !_.isEqual(confState.data, currentData)) {
        confState.data = currentData;

        return true;
    }

    return false;
}

/**
 * Process jigasi json data.
 * @param json - The data.
 * @param state - The current state to check.
 * @param sendCb - The send data callback.
 */
function processJigasiJson(json, state, sendCb) {
    const jigasiJson = invertJigasiJson(json);

    checkForAddedOrRemovedConferences(jigasiJson, state, sendCb);

    _getConferenceIds(jigasiJson).forEach(confId => {
        const confData = jigasiJson.conferences[confId];

        if (_updateData(confId, confData, state)) {
            const toSend = { ...state[confId] };

            // make a copy of state and data content
            toSend.data = { ...state[confId].data };

            // let's drop duplicate data
            delete toSend.data.meetingUrl;

            sendCb(_createIdentityMessage(toSend));
        }
    });
}

module.exports.processJigasiJson = processJigasiJson;
