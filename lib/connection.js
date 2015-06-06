'use strict'

var net = require('net')
var util = require('util')
var Resp = require('respjs')

var tool = require('./tool')
var Queue = require('./queue')

var thunk = require('thunks')()
var debug = require('debug')('disque')

exports.sendCommand = sendCommand
exports.createConnections = createConnections

function sendCommand (disque, commandName, args, responseHook) {
  return thunk.call(disque, function (callback) {
    var command = createCommand(this, commandName, args, callback, responseHook)
    dispatchCommands(this, command)
  })
}

function createConnections (disque, addressArray) {
  addressArray.forEach(function (id) {
    createConnection(disque, id)
  })
}

function createConnection (disque, id) {
  var disqueState = disque._disqueState
  var connection = disqueState.pool[id]
  if (!connection) connection = disqueState.pool[id] = new Connection(disque, id)
  return connection
}

function Connection (disque, id) {
  this.id = id
  this.disque = disque

  this.attempts = 0
  this.retryDelay = 3000

  this.ended = false
  this.connected = false
  this.monitorMode = false
  this.queue = new Queue()
  this.pendingQueue = new Queue()
  this.returnBuffers = disque._disqueState.options.returnBuffers
  this.connect()
}

Connection.prototype.returnCommands = function () {
  debug('move commands to main queue, %s', this.id)
  this.rescuePending()
  this.queue.migrateTo(this.disque._disqueState.commandQueue)
  return this
}

Connection.prototype.rescuePending = function () {
  debug('rescue pending commands, %s', this.id)
  while (this.pendingQueue.length) {
    var command = this.pendingQueue.pop()
    if (command.name !== 'debug') this.queue.unshift(command)
  }
  this.pendingQueue = null
  return this
}

Connection.prototype.disconnect = function () {
  if (this.ended) return
  this.ended = true
  this.returnCommands()
  this.destroy()
}

Connection.prototype.destroy = function () {
  this.connected = false
  this.resp.removeAllListeners()
  this.socket.removeAllListeners(['connect', 'error', 'close', 'end'])
  this.socket.end()
  this.socket.destroy()
  this.socket = null
  debug('destroy socket, %s', this.id)
}

Connection.prototype.connect = function () {
  var ctx = this

  this.connected = false
  if (this.socket) this.destroy()

  var address = this.id.split(':')
  var options = this.disque._disqueState.options
  var socket = this.socket = net.createConnection({
    host: address[0],
    port: +address[1]
  })

  socket.setNoDelay(options.noDelay)
  socket.setTimeout(0)
  socket.setKeepAlive(true)
  debug('create socket, %s', this.id)

  this.resp = ctx.createResp()

  socket
    .once('connect', function () {
      // reset
      ctx.attempts = 0
      ctx.retryDelay = 3000

      ctx.checkConnection()
      debug('socket connected, %s', ctx.id)
    })
    .on('error', function (error) {
      ctx.disque.emit('error', error)
    })
    .once('close', function (hadError) {
      ctx.reconnecting()
    })

  socket.pipe(this.resp)
  return this
}

Connection.prototype.reconnecting = function () {
  var ctx = this
  var disqueState = this.disque._disqueState
  var options = disqueState.options
  this.connected = false

  if (disqueState.ended || this.ended) return

  // try reset default socket
  if (disqueState.connection === this) {
    for (var id in disqueState.pool) {
      if (id !== this.id) {
        disqueState.connection = disqueState.pool[id]
        break
      }
    }
  }

  if (++this.attempts <= options.maxAttempts) {
    this.rescuePending()
    this.retryDelay *= 1.2
    if (this.retryDelay >= options.retryMaxDelay) {
      this.retryDelay = options.retryMaxDelay
    }

    setTimeout(function () {
      debug('socket reconnecting, %s', ctx.id)
      ctx.connect()
      ctx.disque.emit('reconnecting', {
        delay: ctx.retryDelay,
        attempts: ctx.attempts
      })
    }, this.retryDelay)
  } else {
    this.tryRemove(new Error(this.id + ' reconnecting failed'), true)
  }
}

Connection.prototype.checkConnection = function () {
  var ctx = this
  var disqueState = this.disque._disqueState
  var options = disqueState.options

  disqueState.thunk(function (callback) {
    // auth
    if (!options.authPass) return callback()
    var command = createCommand(ctx.disque, 'auth', [options.authPass], callback)
    ctx.writeCommand(command)

  })(function () {
    // check self info and other cluster nodes.
    return updateNodes(ctx)

  })(function () {
    ctx.connected = true
    ctx.disque.emit('connection', ctx)
    // default socket connected
    if (disqueState.connected) ctx.flushQueue(); else {
      disqueState.connected = true
      disqueState.connection = ctx
      ctx.disque.emit('connect')
      dispatchCommands(ctx.disque)
    }
  })
}

Connection.prototype.createResp = function () {
  var ctx = this
  var disque = this.disque
  var pendingQueue = this.pendingQueue

  return new Resp({returnBuffers: ctx.returnBuffers})
    .on('error', function (error) {
      debug('resp error, node %s', ctx.id, '\n', error)
      ctx.rescuePending()
      disque.emit('error', error)
    })
    .on('drain', function () {
      ctx.flushQueue()
    })
    .on('data', function (data) {
      var command = pendingQueue.first()
      debug('resp receive, node %s', ctx.id, '\n', data, command)

      if (ctx.monitorMode && (!command || command.name !== 'quit')) {
        return disque.emit('monitor', data)
      }

      pendingQueue.shift()
      if (!command) return disque.emit('error', new Error('Unexpected reply: ' + data))

      if (util.isError(data)) {
        data.node = ctx.id
        command.callback(data)
        return disque.emit('warn', data)
      }

      if (command.name === 'monitor') {
        debug('enter monitor mode', '\n', command)
        ctx.monitorMode = true
        return command.callback(null, data)
      }

      return command.callback(null, data)
    })
}

Connection.prototype.tryRemove = function (error, tryEnd) {
  var disque = this.disque
  var disqueState = this.disque._disqueState
  if (this.ended || !disqueState.pool) return

  this.disconnect()
  delete disqueState.pool[this.id]
  delete disqueState.pool[this.sid]

  var index = disqueState.connections.indexOf(this.sid)
  if (index >= 0) disqueState.connections.splice(index, 1)

  for (var i = 0; i < disqueState.nodes.length; i++) {
    if (disqueState.nodes[i][0] === this.nid) {
      disqueState.nodes.splice(i, 1)
      break
    }
  }

  if (error) disque.emit('error', error)
  if (tryEnd && !disqueState.nodes.length) disque.clientEnd(error); else {
    // auto connect a new node
    connectNewNode(disque)
    // dispatch commands again
    process.nextTick(function () {
      dispatchCommands(disque)
    })
  }
}

Connection.prototype.flushQueue = function () {
  // `this.pendingQueue.length` improve performance more than 80% magically.
  if (!this.connected || this.pendingQueue.length) return this
  while (this.queue.length) this.writeCommand(this.queue.shift())

  return this
}

Connection.prototype.sendCommand = function (commandName, args, responseHook) {
  var ctx = this
  return thunk.call(this.disque, function (callback) {
    var command = createCommand(this, commandName, args, callback, responseHook)
    ctx.queue.push(command)
    ctx.flushQueue()
  })
}

Connection.prototype.writeCommand = function (command) {
  this.pendingQueue.push(command)

  debug('socket write, node %s, length %d', this.id, command.data.length, '\n', command.data)
  return this.socket.write(command.data)
}

function updateNodes (connection) {
  var disque = connection.disque
  return disque._disqueState.thunk(function (callback) {
    var command = createCommand(disque, 'hello', [], function (error, res) {
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

      var disqueState = connection.disque._disqueState
      disqueState.pool[connection.sid] = connection
      if (disqueState.connections.indexOf(connection.sid) < 0) {
        disqueState.connections.push(connection.sid)
      }

      // auto MEET
      var firstNode = disqueState.pool[disqueState.connections[0]]
      if (connection !== firstNode) {
        return meetNodes(connection, firstNode)(callback)
      }

      disqueState.nodes = res.slice(2)

      if (disqueState.addresses.length < 2 && disqueState.connections.length < 2) {
        // auto connect a second node if not provide
        connectNewNode(disque)

      } else {
        // sort by connections priority
        disqueState.connections.sort(function (a, b) {
          return a.priority - b.priority
        })
      }
      callback()
    })

    connection.writeCommand(command)
  })
}

function connectNewNode (disque) {
  // auto connect a second node if not provide
  var node, disqueState = disque._disqueState
  for (var i = 0; i < disqueState.nodes.length; i++) {
    node = disqueState.nodes[i]
    if (disqueState.connections.indexOf(node[0].slice(0, 8)) < 0) {
      createConnection(disque, (node[1] || '127.0.0.1') + ':' + node[2])
      return
    }
  }
}

function meetNodes (src, dest) {
  var disque = src.disque
  var ip = dest.id.split(':')
  return disque._disqueState.thunk(function (callback) {
    var command = createCommand(disque, 'cluster', ['meet', ip[0], ip[1]], function (error, res) {
      if (error) return callback(error)
      // wait 1000 ms for get latest hello info
      return disque._disqueState.thunk.delay(1000)(function () {
        return updateNodes(dest)(callback)
      })
    })

    src.writeCommand(command)
  })
}

function Command (command, mayBeJobId, data, callback) {
  this.data = data
  this.name = command
  this.callback = callback
  this.mayBeJobId = mayBeJobId
  debug('add command', '\n', this)
}

function createCommand (disque, commandName, args, callback, responseHook) {
  if (disque._disqueState.ended) return callback(new Error('The disque client was ended'))

  var reqArray = tool.slice(args)
  reqArray.unshift(commandName)

  var _callback = !responseHook ? callback : function (err, res) {
    if (err != null) return callback(err)
    callback(null, responseHook.call(disque, res))
  }

  var buffer
  try {
    buffer = Resp.bufferify(reqArray)
  } catch (error) {
    return _callback(error)
  }
  return new Command(reqArray[0], reqArray[1], buffer, _callback)
}

function dispatchCommands (disque, command) {
  var disqueState = disque._disqueState
  var commandQueue = disqueState.commandQueue

  if (!disqueState.connected) {
    if (command) commandQueue.push(command)
    return
  }

  var connection = null

  if (commandQueue.length) {
    var connections = Object.create(null)
    while (commandQueue.length) {
      connection = dispatchCommand(disqueState, commandQueue.shift())
      if (connection) connections[connection.id] = connection
    }

    tool.each(connections, function (connection) {
      connection.flushQueue()
    })
  }

  if (command) {
    connection = dispatchCommand(disqueState, command)
    if (connection) connection.flushQueue()
  }
}

function dispatchCommand (disqueState, command) {
  var connection

  if (isJobCommand[command.name]) {
    connection = disqueState.pool[command.mayBeJobId.slice(2, 10)]
  }

  connection = connection || disqueState.pool[disqueState.connections[0]]
  if (!connection || connection.ended) {
    process.nextTick(function () {
      command.callback(new Error('connection not exist'))
    })
    return
  }
  connection.queue.push(command)
  return connection
}

var isJobCommand = Object.create(null)
var jobCommands = ['show', 'ackjob', 'fastack', 'enqueue', 'dequeue', 'deljob']
jobCommands.forEach(function (command) {
  isJobCommand[command] = true
})
