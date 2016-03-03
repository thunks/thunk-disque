'use strict'

const net = require('net')
const util = require('util')
const Resp = require('respjs')

const tool = require('./tool')
const Queue = require('./queue')

const thunk = require('thunks')()
const debug = require('debug')('disque')

exports.sendCommand = sendCommand
exports.wrapIPv6Address = wrapIPv6Address
exports.createConnections = createConnections

function sendCommand (disque, commandName, args, responseHook) {
  return thunk.call(disque, function (callback) {
    let command = createCommand(this, commandName, args, callback, responseHook)
    if (command) dispatchCommands(this, command)
  })
}

function createConnections (disque, addressArray) {
  addressArray.map((id) => createConnection(disque, id))
}

function createConnection (disque, id) {
  let disqueState = disque._disqueState
  let connection = disqueState.pool[id]
  if (!connection) connection = disqueState.pool[id] = new Connection(disque, id)
  return connection
}

class Connection {
  constructor (disque, id) {
    this.id = id
    this.disque = disque

    this.attempts = 0
    this.retryDelay = 3000

    this.ended = false
    this.connected = false
    this.monitorMode = false
    this.queue = new Queue()
    this.pendingQueue = new Queue()
    this.bufBulk = disque._disqueState.options.bufBulk
    this.autoMeet = disque._disqueState.options.autoMeet
    this.connect()
  }

  returnCommands () {
    debug('move commands to main queue, %s', this.id)
    this.rescuePending()
    this.queue.migrateTo(this.disque._disqueState.commandQueue)
    return this
  }

  rescuePending () {
    debug('rescue pending commands, %s', this.id)
    while (this.pendingQueue.length) {
      let command = this.pendingQueue.pop()
      if (command.name !== 'debug') this.queue.unshift(command)
    }
    return this
  }

  disconnect () {
    if (this.ended) return
    this.ended = true
    this.returnCommands()
    this.destroy()

    let disqueState = this.disque._disqueState
    delete disqueState.pool[this.id]
    let index = disqueState.connections.indexOf(this.sid)
    if (index >= 0) disqueState.connections.splice(index, 1)
    disqueState.resetConnection()
  }

  destroy () {
    debug('destroy socket, %s', this.id)
    this.connected = false
    this.resp.removeAllListeners()
    this.socket.removeAllListeners(['connect', 'error', 'close', 'end'])
    this.socket.end()
    this.socket.destroy()
    this.socket = null
  }

  connect () {
    this.connected = false
    if (this.socket) this.destroy()

    let address = unwrapAddress(this.id)
    let options = this.disque._disqueState.options
    let socket = this.socket = net.createConnection({
      host: address[0],
      port: +address[1]
    })

    if (!socket.cork || !socket.uncork) {
      socket.cork = socket.uncork = noOp
    }

    socket.setNoDelay(options.noDelay)
    socket.setTimeout(0)
    socket.setKeepAlive(true)
    debug('create socket, %s', this.id)

    this.resp = this.createResp()

    socket
      .once('connect', () => {
        // reset
        this.attempts = 0
        this.retryDelay = 3000

        this.checkConnection()
        debug('socket connected, %s', this.id)
      })
      .on('error', (error) => this.disque.emit('error', error))
      .once('close', () => this.reconnecting())
      .once('end', () => this.tryRemove(null, true))

    socket.pipe(this.resp)
    return this
  }

  reconnecting () {
    let disqueState = this.disque._disqueState
    let options = disqueState.options
    this.connected = false
    if (disqueState.ended || this.ended) return

    disqueState.resetConnection()
    this.attempts++
    if (this.attempts <= options.maxAttempts) {
      this.rescuePending()
      this.retryDelay *= 1.2
      if (this.retryDelay >= options.retryMaxDelay) {
        this.retryDelay = options.retryMaxDelay
      }

      setTimeout(() => {
        debug('socket reconnecting, %s', this.id)
        this.connect()
        this.disque.emit('reconnecting', {
          delay: this.retryDelay,
          attempts: this.attempts
        })
      }, this.retryDelay)
    } else {
      let err = new Error('Reconnect ECONNREFUSED ' + this.id)
      let address = unwrapAddress(this.id)
      err.errno = err.code = 'ECONNREFUSED'
      err.address = address[0]
      err.port = +address[1]
      err.attempts = this.attempts - 1
      this.tryRemove(err, true)
    }
  }

  checkConnection () {
    let disqueState = this.disque._disqueState
    let options = disqueState.options

    disqueState.thunk((callback) => {
      // auth
      if (!options.authPass) return callback()
      let command = createCommand(this.disque, 'auth', [options.authPass], callback)
      if (command) this.writeCommand(command)
    })(() => {
      // check self info and other cluster nodes.
      return updateNodes(this)
    })(() => {
      this.connected = true
      disqueState.resetConnection()
      this.disque.emit('connection', this)
      // default socket connected
      if (disqueState.connected) this.flushCommand()
      else {
        disqueState.connected = true
        this.disque.emit('connect')
        dispatchCommands(this.disque)
      }
    })
  }

  createResp () {
    let disque = this.disque
    let pendingQueue = this.pendingQueue

    return new Resp({bufBulk: this.bufBulk})
      .on('drain', () => this.flushCommand())
      .on('error', (error) => {
        this.rescuePending()
        disque.emit('error', error)
      })
      .on('data', (data) => {
        let command = pendingQueue.first()
        debug('resp receive, node %s', this.id, '\n', data, command)

        if (this.monitorMode && (!command || command.name !== 'quit')) {
          return disque.emit('monitor', data)
        }

        pendingQueue.shift()
        if (!command) return disque.emit('error', new Error('Unexpected reply: ' + data))

        if (util.isError(data)) {
          data.node = this.id
          command.callback(data)
          return disque.emit('warn', data)
        }

        if (command.name === 'monitor') {
          debug('enter monitor mode', '\n', command)
          this.monitorMode = true
          return command.callback(null, data)
        }

        return command.callback(null, data)
      })
  }

  tryRemove (error, tryEnd) {
    if (this.ended) return

    let disque = this.disque
    this.disconnect()
    if (error) disque.emit('error', error)
    if (tryEnd && !Object.keys(disque._disqueState.pool).length) disque.clientEnd(error)
    else process.nextTick(() => dispatchCommands(disque))
  }

  sendCommand (commandName, args, responseHook) {
    return thunk.call(this.disque, (callback) => {
      let command = createCommand(this.disque, commandName, args, callback, responseHook)
      if (command) this.flushCommand(command)
    })
  }

  flushCommand (command) {
    // `this.pendingQueue.length` lead to pipeline.
    if (!this.connected || this.pendingQueue.length > 64) {
      if (command) this.queue.push(command)
      return this
    }
    let maxPipeline = 256
    this.socket.cork()
    while (this.queue.length && maxPipeline--) this.writeCommand(this.queue.shift())
    if (command) {
      if (!this.queue.length) this.writeCommand(command)
      else this.queue.push(command)
    }
    this.socket.uncork()
    return this
  }

  writeCommand (command) {
    this.pendingQueue.push(command)
    return this.socket.write(command.data)
  }
}

function updateNodes (connection) {
  let disque = connection.disque
  return disque._disqueState.thunk(function (callback) {
    let command = createCommand(disque, 'hello', [], function (error, res) {
      if (error) return callback(error)
      // res:
      // [
      //   1,
      //   "9125b45882462cd1fb144626345e0bbdce2009d4",
      //   ["9125b45882462cd1fb144626345e0bbdce2009d4", "127.0.0.1", "7711", "1"],
      //   ["e50c7ee4f62d93636afa99b6e7ca8971c6288159", "127.0.0.1", "7712", "1"],
      //   ["b63e269d8eb0c70f4b5851fc8867f3c6776f42a4", "127.0.0.1", "7713", "1"],
      //   ["8e4296741b592cb65982884bc429f79fe52ad532", "127.0.0.1", "7714", "1"]
      // ]
      //
      // [ '81250b3c4318f0b6463da3742c7cf7069a46b6f6', '', '7711', '1' ]
      connection.priority = +res[0]
      connection.nid = res[1]
      connection.sid = res[1].slice(0, 8)

      let disqueState = connection.disque._disqueState
      disqueState.pool[connection.sid] = connection
      if (disqueState.connections.indexOf(connection.sid) < 0) {
        disqueState.connections.push(connection.sid)
      }
      // sort by connections priority
      // disqueState.connections.sort(function (a, b) {
      //   return disqueState.pool[a].priority - disqueState.pool[b].priority
      // })
      // auto MEET
      let firstNode = disqueState.pool[disqueState.connections[0]]
      if (connection !== firstNode && connection.autoMeet) {
        return meetNodes(connection, firstNode)(callback)
      }

      callback()
    })

    if (command) connection.writeCommand(command)
  })
}

function meetNodes (src, dest) {
  let disque = src.disque
  let ip = unwrapAddress(dest.id)
  return disque._disqueState.thunk(function (callback) {
    let command = createCommand(disque, 'cluster', ['meet', ip[0], ip[1]], callback)
    if (command) src.writeCommand(command)
  })
}

function Command (command, mayBeJobId, data, callback) {
  this.data = data
  this.name = command
  this.callback = callback
  this.mayBeJobId = mayBeJobId || ''
}

function createCommand (disque, commandName, args, callback, responseHook) {
  if (disque._disqueState.ended) {
    callback(new Error('The disque client was ended'))
    return
  }

  let reqArray = tool.slice(args)
  reqArray.unshift(commandName)

  let _callback = !responseHook ? callback : function (err, res) {
    if (err != null) return callback(err)
    callback(null, responseHook.call(disque, res))
  }

  let buffer
  try {
    buffer = Resp.encodeRequest(reqArray)
    return new Command(reqArray[0], reqArray[1], buffer, _callback)
  } catch (error) {
    _callback(error)
  }
}

function dispatchCommands (disque, command) {
  let disqueState = disque._disqueState
  let commandQueue = disqueState.commandQueue

  if (!disqueState.connected) {
    if (command) commandQueue.push(command)
    return
  }

  while (commandQueue.length) dispatchCommand(disqueState, commandQueue.shift())
  if (command) dispatchCommand(disqueState, command)
}

function dispatchCommand (disqueState, command) {
  let sid = isJobCommand[command.name] && command.mayBeJobId.slice(2, 10)
  let connection = disqueState.getConnection(sid)
  if (connection instanceof Error) process.nextTick(() => command.callback(connection))
  else connection.flushCommand(command)
}

const isJobCommand = Object.create(null)
;[
  'ackjob',
  'deljob',
  'dequeue',
  'enqueue',
  'fastack',
  'nack',
  'show',
  'working'
].forEach((command) => {
  isJobCommand[command] = true
})

function unwrapAddress (address) {
  return address.indexOf('[') === 0 ? address.slice(1).split(']:') : address.split(':')
}

// support IPv6
// https://www.ietf.org/rfc/rfc2732.txt
function wrapIPv6Address (host, port) {
  if (!port) {
    if (host.indexOf('[') === 0) return host
    host = host.split(':')
    port = host[1]
    host = host[0]
  }
  return '[' + host + ']:' + port
}

function noOp () {}
