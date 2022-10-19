### Running

The pusher requires 2 pieces of information: the address of the Jigasi's REST API (to be queried) and the address of the
RTCStats server (to which data should be pushed).  This information can be provided in 2 ways:

1) Command line arguments: `node app.js --jigasi-address http://127.0.0.1:8081 --rtcstats-server ws://127.0.0.1:3001`
2) Environment variables: `JIGASI_ADDRESS="http://127.0.0.1:8081" RTCSTATS_SERVER="ws://127.0.0.1:3001" node app.js`

The Json format that this service expects from Jigais is this

```json
{
  "gateways": {
    "1921781245": {
      "sessions": {
        "1512XXXXXXX (+1512XXXXXXX)": {
          "jvbConference": {
            "meetingUrl": "https://meet.example.org/confname",
            "meetingId": "776ef674-8fdb-42f1-8083-523cefbc3a96"
          }
        }
      }
    }
  }
}
```