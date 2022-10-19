const fetch = require('node-fetch')
const { v4: uuidv4 } = require('uuid')
const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')
const WebSocketClient = require('websocket').client
const os = require('os')
require('log-timestamp')

class App {
  constructor (jigasiBaseUrl, rtcStatsServerUrl) {
    this.jigasiUrl = `${jigasiBaseUrl}/debug`
    this.rtcStatsServerUrl = rtcStatsServerUrl
    console.log(`Querying the Jigasi REST API at ${this.jigasiUrl}`)
    console.log(`Sending stats data to RTC stats server at ${this.rtcStatsServerUrl}`)

    // Map conference ID to state about that conference
    // Conference state contains, at least:
    // statsSessionId: (String) the dump ID for this conference
    // sessions: (Array) session names for all sessions *who have ever* been in this conference
    this.conferenceStates = {}
  }

  start () {
    this.setupWebsocket()
    this.fetchTask = setInterval(async () => {
      console.debug('Fetching data')
      const json = await fetchJson(this.jigasiUrl)
      const invertedJson = invertJigasiJson(json)
      this.processJigasiJson(invertedJson)
    }, 5000)
  }

  stop () {
    clearInterval(this.fetchTask)
  }

  setupWebsocket () {
    // Create the websocket client
    this.wsClient = new WebSocketClient({
      keepalive: true,
      keepaliveInterval: 20000
    })
    // Enclose the websocket connect logic so it can be re-used easily in the reconnect logic below.
    const wsConnectionFunction = () => {
      console.log('Connecting websocket')
      this.wsClient.connect(
        this.rtcStatsServerUrl,
        '1.0_JIGASI',
        os.hostname(),
        { 'User-Agent': `Node ${process.version}` }
      )
    }

    // Install the event handlers on the websocket client
    this.wsClient.on('connectFailed', error => {
      console.log('Websocket connection failed: ', error)
      console.log('Will try to reconnect in 5 seconds')
      setTimeout(wsConnectionFunction, 5000)
    })

    this.wsClient.on('connect', connection => {
      // Assign the new connection to a member so it can be used to send data
      this.ws = connection
      console.log('Websocket connected')

      // Install the event handlers on the connection object
      connection.on('error', error => {
        console.log('Websocket error: ', error)
      })

      connection.on('close', () => {
        console.log('Websocket closed, will try to reconnect in 5 seconds')
        setTimeout(wsConnectionFunction, 5000)
      })
    })

    // Do the initial connection
    wsConnectionFunction()
  }

  processJigasiJson (jigasiJson) {
    this.checkForAddedOrRemovedConferences(jigasiJson)
    const timestamp = new Date()
    getConferenceIds(jigasiJson).forEach(confId => {
      const confData = jigasiJson.conferences[confId]
      // The timestamp is at the top level, inject it into the conference data here
      confData.timestamp = timestamp
      this.processConference(confId, confData)
    })
  }

  checkForAddedOrRemovedConferences (jigasiJson) {
    const confIds = getConferenceIds(jigasiJson)
    const newConfIds = confIds.filter(id => !(id in this.conferenceStates))
    const removedConfIds = Object.keys(this.conferenceStates).filter(id => confIds.indexOf(id) === -1)
    newConfIds.forEach(newConfId => {
      const statsSessionId = uuidv4()
      const confState = {
        statsSessionId,
        confUrl: jigasiJson.conferences[newConfId].meetingUrl,
        displayName: os.hostname(),
        meetingUniqueId: newConfId,
        applicationName: 'JIGASI',
        sessions: []
      }
      this.conferenceStates[newConfId] = confState
      this.sendData(createIdentityMessage(confState))
    })
    removedConfIds.forEach(removedConfId => {
      const confState = this.conferenceStates[removedConfId]
      delete this.conferenceStates[removedConfId]
      this.sendData(createCloseMsg(confState.statsSessionId))
    })
  }

  processConference (confId, confData) {
    this.checkForAddedOrRemovedSessions(confId, confData.sessions)
  }

  checkForAddedOrRemovedSessions (confId, currentSessions) {
    const confState = this.conferenceStates[confId]
    const oldSessions = confState.sessions
    const newSessions = currentSessions.filter(currentSession => oldSessions.indexOf(currentSession) === -1)
    if (newSessions.length > 0) {
      confState.sessions.push(...newSessions)
      this.sendData(createIdentityMessage(confState))
    }
  }

  sendData (msgObj) {
    this.ws.send(JSON.stringify(msgObj))
  }
}

const params = yargs(hideBin(process.argv))
  .env()
  .options({
    'jigasi-address': {
      alias: 'j',
      describe: "The address of the JIGASI whose REST API will be queried ('http://127.0.0.1:8080')",
      demandOption: true
    },
    'rtcstats-server': {
      alias: 'r',
      describe: "The address of the RTC stats server websocket ('ws://127.0.0.1:3000')",
      demandOption: true
    }

  })
  .help()
  .argv

console.log(`Got jigasi address ${params.jigasiAddress} and rtcstats server ${params.rtcstatsServer}`)

const app = new App(params.jigasiAddress, params.rtcstatsServer)

app.start()

/**
 * @param jigasiJson
 */
function invertJigasiJson (jigasiJson) {
  const invertedJson = { conferences: [] }
  Object.keys(jigasiJson.gateways)
    .forEach(gatewayHash => {
      const gateway = jigasiJson.gateways[gatewayHash]
      Object.keys(gateway.sessions).forEach(sessionName => {
        const meetingId = gateway.sessions[sessionName].jvbConference.meetingId
        const meetingUrl = gateway.sessions[sessionName].jvbConference.meetingUrl
        if (meetingId) {
          if (!invertedJson.conferences[meetingId]) {
            invertedJson.conferences[meetingId] = { sessions: [], meetingUrl }
          }

          invertedJson.conferences[meetingId].sessions.push(sessionName)
        }
      })
    })

  return invertedJson
}
/**
 * Given the data retrieved from the jigasi REST API,
 * extract all of the conference IDs
 * @param jigasiJson
 */
function getConferenceIds (jigasiJson) {
  return Object.keys(jigasiJson.conferences)
}

async function fetchJson (url) {
  try {
    const response = await fetch(url)
    return await response.json()
  } catch (e) {
    console.log('Error retrieving data: ', e)
    return null
  }
}

function createIdentityMessage (state) {
  // This is a bit awkward: we keep the statsSessionId in the conference state,
  // but we need to set it as an explicit field of the message.  Also,
  const { statsSessionId, ...metadata } = state
  return {
    type: 'identity',
    statsSessionId,
    data: metadata
  }
}

function createCloseMsg (statsSessionId) {
  return {
    type: 'close',
    statsSessionId
  }
}
