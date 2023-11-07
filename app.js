const { hideBin } = require('yargs/helpers');
const yargs = require('yargs/yargs');

const App = require('./src/app');

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
