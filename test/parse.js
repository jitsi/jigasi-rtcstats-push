const assert = require('node:assert');
const test = require('node:test');
const { describe } = require('node:test');

const { processJigasiJson } = require('../src/functions');

const dataNoCalls = require('./test-data-no-calls.json');
const dataOneCall = require('./test-data-one-call.json');

describe('Testing parsing of jigasi data', () => {
    test('', () => {
        // const app = new App();

        const events = [];
        const sendData = msgObj => {
            events.push(msgObj);
            console.info(msgObj);
        };
        const state = [];

        processJigasiJson(dataOneCall, state, sendData);
        processJigasiJson(dataNoCalls, state, sendData);

        assert.equal(events.length, 3, 'There should be 3 events start, data and stop');

        assert.equal(
            events.filter(e => e.type === 'identity').length,
            2,
            'There should be two identity events'
        );

        assert.equal(
            events.filter(e => e.type === 'close').length,
            1,
            'There should be one close event'
        );

        const sessions = dataOneCall.gateways[Object.keys(dataOneCall.gateways)[0]].sessions;
        const number = Object.keys(sessions)[0];

        assert.equal(
            events.filter(e => !(e.data && e.data.sessions[0] === number)).length,
            1,
            'There should be one event with number'
        );
    });
});
