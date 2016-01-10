'use strict'

const thunks = require('thunks')
const EventEmitter = require('events').EventEmitter

const tool = require('./tool')
const Queue = require('./queue')
const initCommands = require('./commands').initCommands
const createConnections = require('./connection').createConnections

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
    this.nodes = []
    // nodes info from hello:
    // [
    //   ['9125b45882462cd1fb144626345e0bbdce2009d4', '127.0.0.1', '7711', '1'],
    //   ['e50c7ee4f62d93636afa99b6e7ca8971c6288159', '127.0.0.1', '7712', '1'],
    //   ['b63e269d8eb0c70f4b5851fc8867f3c6776f42a4', '127.0.0.1', '7713', '1'],
    //   ['8e4296741b592cb65982884bc429f79fe52ad532', '127.0.0.1', '7714', '1']
    //   ...
    // ]
  }
}

class DisqueClient extends EventEmitter {
  constructor (addressArray, options) {
    super()

    tool.setPrivate(this, '_disqueState', new DisqueState(options, addressArray))
    this._disqueState.thunk = thunks((error) => this.emit('error', error))
    this.clientConnect()
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
      connection.disconnect()
      delete disqueState.pool[key]
    })

    let commandQueue = disqueState.commandQueue
    let message = 'The disque connection was ended'
    while (commandQueue.length) commandQueue.shift().callback(new Error(message))

    this.emit('close', hadError)
    this.removeAllListeners()
  }
}

initCommands(DisqueClient.prototype)

module.exports = DisqueClient
