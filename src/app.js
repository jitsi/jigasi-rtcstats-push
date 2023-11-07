const fetch = require('node-fetch');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const WebSocketClient = require('websocket').client;
const { hideBin } = require('yargs/helpers');
const yargs = require('yargs/yargs');

require('log-timestamp');

/**
 * The main app.
 */
class App {
    /**
     * Creates the app.
     * @param jigasiBaseUrl - The url to fetch jigasi data.
     * @param rtcStatsServerUrl - The rtc url where to push data.
     */
    constructor(jigasiBaseUrl, rtcStatsServerUrl) {
        this.jigasiUrl = `${jigasiBaseUrl}/debug`;
        this.rtcStatsServerUrl = rtcStatsServerUrl;
        console.log(`Querying the Jigasi REST API at ${this.jigasiUrl}`);
        console.log(`Sending stats data to RTC stats server at ${this.rtcStatsServerUrl}`);

        // Map conference ID (aka meeting unique ID) to state about that conference state contains, at least:
        // statsSessionId: (String) the dump ID for this conference
        // sessions: (Array) session names for all sessions *who have ever* been in this conference
        this.conferenceStates = {};
    }

    /**
     * Setups and starts gathering data and pushing.
     */
    start() {
        this.setupWebsocket();
        this.fetchTask = setInterval(async () => {
            console.debug('Fetching data');
            const json = await fetchJson(this.jigasiUrl);
            const invertedJson = invertJigasiJson(json);

            this.processJigasiJson(invertedJson);
        }, 5000);
    }

    /**
     * Stops fetching data.
     */
    stop() {
        clearInterval(this.fetchTask);
    }

    /**
     * Setups the websocket client that will fetch data.
     */
    setupWebsocket() {
        // Create the websocket client
        this.wsClient = new WebSocketClient({
            keepalive: true,
            keepaliveInterval: 20000
        });

        // Enclose the websocket connect logic, so it can be re-used easily in the reconnect logic below.
        const wsConnectionFunction = () => {
            console.log('Connecting websocket');
            this.wsClient.connect(
        this.rtcStatsServerUrl,
        '1.0_JIGASI',
        os.hostname(),
        { 'User-Agent': `Node ${process.version}` }
            );
        };

        // Install the event handlers on the websocket client
        this.wsClient.on('connectFailed', error => {
            console.log('Websocket connection failed: ', error);
            console.log('Will try to reconnect in 5 seconds');
            setTimeout(wsConnectionFunction, 5000);
        });

        this.wsClient.on('connect', connection => {
            // Assign the new connection to a member so it can be used to send data
            this.ws = connection;
            console.log('Websocket connected');

            // Install the event handlers on the connection object
            connection.on('error', error => {
                console.log('Websocket error: ', error);
            });

            connection.on('close', () => {
                console.log('Websocket closed, will try to reconnect in 5 seconds');
                setTimeout(wsConnectionFunction, 5000);
            });
        });

        // Do the initial connection
        wsConnectionFunction();
    }

    /**
     * Process jigasi json data.
     * @param jigasiJson - The data.
     */
    processJigasiJson(jigasiJson) {
        this.checkForAddedOrRemovedConferences(jigasiJson);
        const timestamp = new Date();

        getConferenceIds(jigasiJson).forEach(confId => {
            const confData = jigasiJson.conferences[confId];

            // The timestamp is at the top level, inject it into the conference data here
            confData.timestamp = timestamp;
            this.processConference(confId, confData);
        });
    }

    /**
     * Checks whether conferences are added or removed.
     * @param jigasiJson
     */
    checkForAddedOrRemovedConferences(jigasiJson) {
        const confIds = getConferenceIds(jigasiJson);
        const newConfIds = confIds.filter(id => !(id in this.conferenceStates));
        const removedConfIds = Object.keys(this.conferenceStates).filter(id => confIds.indexOf(id) === -1);

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

            this.conferenceStates[newConfId] = confState;
            this.sendData(createIdentityMessage(confState));
        });
        removedConfIds.forEach(removedConfId => {
            const confState = this.conferenceStates[removedConfId];

            delete this.conferenceStates[removedConfId];
            this.sendData(createCloseMsg(confState.statsSessionId));
        });
    }

    /**
     * Process a conference.
     * @param confId - The conference id.
     * @param confData - The data.
     */
    processConference(confId, confData) {
        this.checkForAddedOrRemovedSessions(confId, confData.sessions);
    }

    /**
     * Checks for added or removed sessions.
     * @param confId - The id.
     * @param currentSessions - Current sessions.
     */
    checkForAddedOrRemovedSessions(confId, currentSessions) {
        const confState = this.conferenceStates[confId];
        const oldSessions = confState.sessions;
        const newSessions = currentSessions.filter(currentSession => oldSessions.indexOf(currentSession) === -1);

        if (newSessions.length > 0) {
            confState.sessions.push(...newSessions);
            this.sendData(createIdentityMessage(confState));
        }
    }

    /**
     * Sends the data.
     * @param msgObj
     */
    sendData(msgObj) {
        this.ws.send(JSON.stringify(msgObj));
    }
}

/**
 * Checks for supplied parameters.
 */
const params = yargs(hideBin(process.argv))
  .env()
  .options({
      'jigasi-address': {
          alias: 'j',
          describe: 'The address of the JIGASI whose REST API will be queried (\'http://127.0.0.1:8080\')',
          demandOption: true
      },
      'rtcstats-server': {
          alias: 'r',
          describe: 'The address of the RTC stats server websocket (\'ws://127.0.0.1:3000\')',
          demandOption: true
      }

  })
  .help()
  .argv;

console.log(`Got jigasi address ${params.jigasiAddress} and rtcstats server ${params.rtcstatsServer}`);

const app = new App(params.jigasiAddress, params.rtcstatsServer);

app.start();

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
function getConferenceIds(jigasiJson) {
    return Object.keys(jigasiJson.conferences);
}

/**
 * Fetches data from url, returns response json.
 * @param url - The url to query.
 * @returns {Object}
 */
async function fetchJson(url) {
    try {
        const response = await fetch(url);

        return await response.json();
    } catch (e) {
        console.log('Error retrieving data: ', e);

        return null;
    }
}

/**
 * Creates identity message that is pushed to rtcstats.
 * @param state
 * @returns {{data: Omit<*, "statsSessionId">, statsSessionId, type: string}}
 */
function createIdentityMessage(state) {
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
function createCloseMsg(statsSessionId) {
    return {
        type: 'close',
        statsSessionId
    };
}
