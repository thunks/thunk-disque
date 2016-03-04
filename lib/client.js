'use strict'

const thunks = require('thunks')
const EventEmitter = require('events').EventEmitter

const tool = require('./tool')
const Queue = require('./queue')
const initCommands = require('./commands').initCommands
const createConnections = require('./connection').createConnections

const thunk = thunks()

var clientId = 0

class DisqueState {
  constructor (options, addressArray) {
    this.options = options
    this.addressArray = addressArray
    this.ended = false
    this.connected = false
    this.connection = null
    this.timestamp = Date.now()
    this.clientId = ++clientId
    this.commandQueue = new Queue()
    this.pool = Object.create(null)
    // {
    //   '[127.0.0.1]:7711': connection1,
    //   '[127.0.0.1]:7712': connection2,
    //   '9125b458': connection1,
    //   'e50c7ee4': connection2,
    //   ...
    // }
    // connection1.id === '[127.0.0.1]:7711'
    // connection1.sid === '9125b458'
    // connection1.nid === '9125b45882462cd1fb144626345e0bbdce2009d4'
    this.connections = [] // ['9125b458', 'b63e269d', ...]
  }

  getConnection (sid) {
    let connection = sid && this.pool[sid]
    if (!connection || !connection.connected) connection = this.connection
    if (!connection || connection.ended) return new Error('connection(' + sid + ') not exist')
    return connection
  }

  // try reset default connection
  resetConnection () {
    if (this.connection && this.connection.connected) return

    let connection = null
    let keys = Object.keys(this.pool)
    for (let i = 0; i < keys.length; i++) {
      connection = this.pool[keys[i]]
      if (connection.connected) break
    }
    this.connection = connection
  }
}

class DisqueClient extends EventEmitter {
  constructor (addressArray, options) {
    super()

    tool.setPrivate(this, '_disqueState', new DisqueState(options, addressArray))
    this._disqueState.thunk = thunks((error) => this.emit('error', error))
    this.clientConnect()
    // useage: client.clientReady(taskFn), task will be called after connected
    this.clientReady = thunk.persist.call(this, (callback) => this.once('connect', callback))
  }

  clientConnect () {
    let disqueState = this._disqueState
    disqueState.ended = false
    createConnections(this, disqueState.addressArray)
  }

  clientUnref () {
    if (this._disqueState.ended) return
    tool.each(this._disqueState.pool, (connection) => {
      if (connection.connected) connection.socket.unref()
      else connection.socket.once('connect', () => connection.socket.unref())
    })
  }

  clientEnd (hadError) {
    let disqueState = this._disqueState
    if (disqueState.ended) return
    disqueState.ended = true
    disqueState.connected = false

    tool.each(disqueState.pool, (connection, key) => {
      if (connection) connection.disconnect()
    })

    let commandQueue = disqueState.commandQueue
    let message = 'The disque connection was ended'
    while (commandQueue.length) commandQueue.shift().callback(new Error(message))

    this.emit('close', hadError)
  }
}

initCommands(DisqueClient.prototype)

module.exports = DisqueClient
