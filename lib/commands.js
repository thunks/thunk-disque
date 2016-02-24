'use strict'

const thunk = require('thunks')()
const tool = require('./tool')
const sendCommand = require('./connection').sendCommand

// (Disque 0.0.1) `disque command`
// `node check-commands.js`
const commandsInfo = {
  ackjob: [-1, ['write', 'fast'], 0, 0, 0],
  addjob: [-4, ['write', 'denyoom', 'fast'], 0, 0, 0],
  auth: [2, ['readonly', 'loading', 'fast'], 0, 0, 0],
  bgrewriteaof: [1, ['readonly', 'admin'], 0, 0, 0],
  client: [-2, ['readonly', 'admin'], 0, 0, 0],
  cluster: [-2, ['readonly', 'admin'], 0, 0, 0],
  command: [0, ['readonly', 'loading'], 0, 0, 0],
  config: [-2, ['readonly', 'admin'], 0, 0, 0],
  debug: [-2, ['admin'], 0, 0, 0],
  deljob: [-1, ['write', 'fast'], 0, 0, 0],
  dequeue: [-1, ['write', 'fast'], 0, 0, 0],
  enqueue: [-1, ['write', 'denyoom', 'fast'], 0, 0, 0],
  fastack: [-1, ['write', 'fast'], 0, 0, 0],
  getjob: [-2, ['write', 'fast'], 0, 0, 0],
  hello: [1, ['readonly', 'fast'], 0, 0, 0],
  info: [-1, ['readonly', 'loading'], 0, 0, 0],
  jscan: [-1, ['readonly'], 0, 0, 0],
  latency: [-2, ['readonly', 'admin', 'loading'], 0, 0, 0],
  loadjob: [2, ['write'], 0, 0, 0],
  monitor: [1, ['readonly', 'admin'], 0, 0, 0],
  nack: [-1, ['write', 'denyoom', 'fast'], 0, 0, 0],
  pause: [-3, ['readonly', 'fast'], 0, 0, 0],
  ping: [-1, ['readonly', 'fast'], 0, 0, 0],
  qlen: [2, ['readonly', 'fast'], 0, 0, 0],
  qpeek: [3, ['readonly'], 0, 0, 0],
  qscan: [-1, ['readonly'], 0, 0, 0],
  qstat: [2, ['readonly', 'fast'], 0, 0, 0],
  show: [2, ['readonly', 'fast'], 0, 0, 0],
  shutdown: [-1, ['readonly', 'admin', 'loading'], 0, 0, 0],
  slowlog: [-2, ['readonly'], 0, 0, 0],
  time: [1, ['readonly', 'fast'], 0, 0, 0],
  working: [2, ['write', 'fast'], 0, 0, 0]
}

// fake QUIT command info~
commandsInfo.quit = [1, ['readonly', 'noscript'], 0, 0, 0]

const commands = Object.keys(commandsInfo)

exports.initCommands = function (proto) {
  proto.clientCommands = commands

  commands.map(function (command) {
    proto[command] = function () {
      return sendCommand(this, command, adjustArgs(arguments))
    }
  })

  /* overrides */
  // Parse the reply from INFO into a hash.
  proto.info = function () {
    return sendCommand(this, 'info', adjustArgs(arguments), formatInfo)
  }

  proto.show = function () {
    return sendCommand(this, 'show', adjustArgs(arguments), toHash)
  }

  proto.qstat = function () {
    return sendCommand(this, 'qstat', adjustArgs(arguments), toHash)
  }

  proto.monitor = function () {
    // monit all nodes in cluster mode
    let tasks = []
    tool.each(this._disqueState.pool, (connection) => {
      if (!connection.monitorMode) tasks.push(connection.sendCommand('monitor', []))
    })

    return thunk.all.call(this, tasks)
  }

  commands.map((command) => {
    proto[command.toUpperCase()] = proto[command]
  })
}

function adjustArgs (args) {
  return Array.isArray(args[0]) ? args[0] : args
}

function toHash (array) {
  // disque returned (nil)
  if (!array) return null

  let hash = {}

  for (let i = 0, len = array.length; i < len; i += 2) {
    hash[array[i]] = array[i + 1]
  }

  return hash
}

function formatInfo (info) {
  let hash = {}

  info.toString().split('\r\n').map((line) => {
    let index = line.indexOf(':')

    if (index === -1) return
    let name = line.slice(0, index)
    hash[name] = line.slice(index + 1)
  })

  return hash
}
