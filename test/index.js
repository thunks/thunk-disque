'use strict'
/*global describe, it */

var assert = require('assert')
var disque = require('../index')

// ackjob: [-1, ['write', 'fast'], 0, 0, 0],
// addjob: [-4, ['write', 'denyoom', 'fast'], 0, 0, 0],
// auth: [2, ['readonly', 'loading', 'fast'], 0, 0, 0],
// bgrewriteaof: [1, ['readonly', 'admin'], 0, 0, 0],
// client: [-2, ['readonly', 'admin'], 0, 0, 0],
// cluster: [-2, ['readonly', 'admin'], 0, 0, 0],
// command: [0, ['readonly', 'loading'], 0, 0, 0],
// config: [-2, ['readonly', 'admin'], 0, 0, 0],
// debug: [-2, ['admin'], 0, 0, 0],
// deljob: [-1, ['write', 'fast'], 0, 0, 0],
// dequeue: [-1, ['write', 'fast'], 0, 0, 0],
// enqueue: [-1, ['write', 'denyoom', 'fast'], 0, 0, 0],
// fastack: [-1, ['write', 'fast'], 0, 0, 0],
// getjob: [-2, ['write', 'fast'], 0, 0, 0],
// jscan: [-1, ['readonly'], 0, 0, 0],
// latency: [-2, ['readonly', 'admin', 'loading'], 0, 0, 0],
// loadjob: [2, ['write'], 0, 0, 0],
// monitor: [1, ['readonly', 'admin'], 0, 0, 0],
// nack: [-1, ['write', 'denyoom', 'fast'], 0, 0, 0],
// pause: [-3, ['readonly', 'fast'], 0, 0, 0],
// qlen: [2, ['readonly', 'fast'], 0, 0, 0],
// qpeek: [3, ['readonly'], 0, 0, 0],
// qscan: [-1, ['readonly'], 0, 0, 0],
// qstat: [2, ['readonly', 'fast'], 0, 0, 0],
// show: [2, ['readonly', 'fast'], 0, 0, 0],
// shutdown: [-1, ['readonly', 'admin', 'loading'], 0, 0, 0],
// slowlog: [-2, ['readonly'], 0, 0, 0],
// working: [2, ['write', 'fast'], 0, 0, 0]

describe('commands', function () {
  var client = disque.createClient()

  it('ping', function *() {
    assert.strictEqual(yield client.ping(), 'PONG')
  })

  it('info', function *() {
    let info = yield client.info()
    assert.strictEqual(Object.keys(info).length > 0, true)
  })

  it('hello', function *() {
    let hello = yield client.hello()
    assert.strictEqual(hello.length >= 3, true)
  })

  it('time', function *() {
    let time = yield client.time()
    assert.strictEqual(1000 * (1 + time[0]) > Date.now(), true)
  })
  // TODO
})
