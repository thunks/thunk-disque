'use strict'

const assert = require('assert')
const tman = require('tman')
const disque = require('..')
const client = disque.createClient()
const TEST_QUEUE = 'thunk-disque-test'

// TODO:
// bgrewriteaof: [1, ['readonly', 'admin'], 0, 0, 0],
// client: [-2, ['readonly', 'admin'], 0, 0, 0],
// cluster: [-2, ['readonly', 'admin'], 0, 0, 0],
// debug: [-2, ['admin'], 0, 0, 0],
// latency: [-2, ['readonly', 'admin', 'loading'], 0, 0, 0],
// loadjob: [2, ['write'], 0, 0, 0],
// slowlog: [-2, ['readonly'], 0, 0, 0],
// shutdown: [-1, ['readonly', 'admin', 'loading'], 0, 0, 0],

// deljob: [-1, ['write', 'fast'], 0, 0, 0],
// dequeue: [-1, ['write', 'fast'], 0, 0, 0],
// enqueue: [-1, ['write', 'denyoom', 'fast'], 0, 0, 0],
// fastack: [-1, ['write', 'fast'], 0, 0, 0],
// jscan: [-1, ['readonly'], 0, 0, 0],
// monitor: [1, ['readonly', 'admin'], 0, 0, 0],
// nack: [-1, ['write', 'denyoom', 'fast'], 0, 0, 0],
// pause: [-3, ['readonly', 'fast'], 0, 0, 0],
// qlen: [2, ['readonly', 'fast'], 0, 0, 0],
// qpeek: [3, ['readonly'], 0, 0, 0],
// qscan: [-1, ['readonly'], 0, 0, 0],
// qstat: [2, ['readonly', 'fast'], 0, 0, 0],
// working: [2, ['write', 'fast'], 0, 0, 0]

function * cleanup () {
  let count = 0
  while (true) {
    let len = yield client.qlen(TEST_QUEUE)
    if (!len) break
    let jobs = yield client.getjob('nohang', 'count', 1000, 'from', TEST_QUEUE)
    if (!jobs || !jobs.length) {
      yield this.thunk.delay(1000)
      continue
    }
    count += jobs.length
    yield client.ackjob(jobs.map((job) => job[1]))
  }
  console.log('Clear Up', count)
}

tman.before(cleanup)
tman.after(cleanup)

tman.suite('commands', function () {
  tman.it('ping', function *() {
    let res = yield client.ping()
    assert.strictEqual(res, 'PONG')
  })

  tman.it('info', function *() {
    let info = yield client.info()
    assert.strictEqual(info.tcp_port, '7711')
    assert.ok(Object.keys(info).length > 0)
    assert.ok(info.connected_clients >= 1)
  })

  tman.it('hello', function *() {
    let res = yield client.hello()
    assert.ok(res.length >= 3)
    assert.ok(res[2].length >= 1)
  })

  tman.it('command', function *() {
    let res = yield client.command()
    assert.ok(res.length > 30)
  })

  tman.it('time', function *() {
    let time = yield client.time()
    assert.strictEqual(1000 * (1 + time[0]) > Date.now(), true)
  })

  tman.it('addjob, show, getjob, ackjob', function *() {
    let id0 = yield client.addjob(TEST_QUEUE, 'message1', 100)
    let id1 = yield client.addjob([TEST_QUEUE, 'message2', 100])
    let id2 = yield client.addjob(TEST_QUEUE, 'message3', 100, 'maxlen', 3)
    let err = null
    try {
      yield client.addjob(TEST_QUEUE, 'message4', 100, 'MAXLEN', 3)
    } catch (e) {
      err = e
    }

    let res = yield client.getjob('from', TEST_QUEUE)
    assert.strictEqual(res.length, 1)
    assert.strictEqual(res[0][0], TEST_QUEUE)
    assert.strictEqual(res[0][1], id0)
    assert.strictEqual(res[0][2], 'message1')

    let job = yield client.show(id0)
    assert.strictEqual(job.id, id0)
    assert.strictEqual(job.queue, TEST_QUEUE)
    assert.strictEqual(job.body, 'message1')
    assert.strictEqual(job.state, 'active')
    assert.ok(job['nodes-delivered'].length >= 1)

    assert.ok(err instanceof Error)
    assert.strictEqual(err.code, 'MAXLEN')

    assert.strictEqual((yield client.ackjob(id0)), 1)
    let id3 = yield client.addjob(TEST_QUEUE, 'message4', 100, 'MAXLEN', 3)
    assert.strictEqual((yield client.ackjob([id1, id2, id3])), 3)
  })

  tman.it('auth, config', function *() {
    let err = null
    try {
      yield client.auth('123456')
    } catch (e) {
      err = e
    }

    assert.ok(err instanceof Error)
    assert.strictEqual(err.code, 'ERR')

    let res = yield client.config('set', 'requirepass', '123456')
    assert.strictEqual(res, 'OK')

    res = yield client.auth('123456')
    assert.strictEqual(res, 'OK')

    res = yield client.config('set', 'requirepass', '')
    assert.strictEqual(res, 'OK')
  })
})
