const fetch = require('node-fetch');
const os = require('os');
const WebSocketClient = require('websocket').client;

require('log-timestamp');

const { processJigasiJson } = require('./functions');

/**
 * The main app.
 */
module.exports = class App {
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

            processJigasiJson(json, this.conferenceStates, this.sendData.bind(this));
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
     * Sends the data.
     * @param msgObj
     */
    sendData(msgObj) {
        this.ws.send(JSON.stringify(msgObj));
    }
};

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
