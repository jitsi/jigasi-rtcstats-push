const assert = require('node:assert');
const test = require('node:test');
const { describe } = require('node:test');

const { processJigasiJson } = require('../src/functions');

const dataNoCalls = require('./test-data-no-calls.json');
const dataOneCallNewNick = require('./test-data-one-call-change-nick.json');
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

        assert.equal(
            events.filter(e => e.type === 'identity').length,
            2,
            'There should be two identity events'
        );

        // process same content, no new evevent should be sent as there was no change
        processJigasiJson(dataOneCall, state, sendData);
        assert.equal(
            events.filter(e => e.type === 'identity').length,
            2,
            'There should be still two identity events'
        );

        processJigasiJson(dataOneCallNewNick, state, sendData);
        assert.equal(
            events.filter(e => e.type === 'identity').length,
            3,
            'There should be 3 identity events'
        );

        processJigasiJson(dataNoCalls, state, sendData);
        assert.equal(events.length, 4, 'There should be 4 events start, data, data and stop');

        assert.equal(
            events.filter(e => e.type === 'close').length,
            1,
            'There should be one close event'
        );

        const sessions = dataOneCall.gateways[Object.keys(dataOneCall.gateways)[0]].sessions;
        const number = Object.keys(sessions)[0];

        assert.equal(
            events.some(e => e.data?.data?.caller === number),
            true,
            'There should be at least one event with number'
        );
    });
});
