'use strict'
/**
 * thunk-redis - https://github.com/thunks/thunk-disque
 *
 * MIT Licensed
 */

const defaultPort = 7711
const defaultHost = '127.0.0.1'
const tool = require('./tool')
const DisqueClient = require('./client')
const wrapIPv6Address = require('./connection').wrapIPv6Address

exports.log = tool.log
exports.slice = tool.slice

exports.createClient = function (port, host, options) {
  let addressArray

  if (Array.isArray(port)) {
    addressArray = normalizeNetAddress(port)
    options = host
  } else if (port && typeof port.port === 'number') {
    addressArray = normalizeNetAddress([port])
    options = host
  } else if (typeof port === 'string') {
    addressArray = normalizeNetAddress([port])
    options = host
  } else if (typeof port === 'number') {
    if (typeof host !== 'string') {
      options = host
      host = defaultHost
    }
    addressArray = normalizeNetAddress([{
      port: port,
      host: host
    }])
  } else {
    options = port
    addressArray = normalizeNetAddress([{
      port: defaultPort,
      host: defaultHost
    }])
  }

  options = options || {}
  options.autoMeet = !!options.autoMeet
  options.bufBulk = !!options.returnBuffers
  options.authPass = (options.authPass || '') + ''
  options.noDelay = options.noDelay == null ? true : !!options.noDelay
  options.maxAttempts = options.maxAttempts >= 0 ? Math.floor(options.maxAttempts) : 5
  options.retryMaxDelay = options.retryMaxDelay >= 3000 ? Math.floor(options.retryMaxDelay) : 5 * 60 * 1000

  let client = new DisqueClient(addressArray, options)

  let AliasPromise = options.usePromise

  if (!AliasPromise) return client

  if (typeof AliasPromise !== 'function') AliasPromise = Promise
  if (!AliasPromise.prototype || typeof AliasPromise.prototype.then !== 'function') {
    throw new Error(String(AliasPromise) + ' is not Promise constructor')
  }
  // if `options.usePromise` is available, export promise commands API for a client instance.
  client.clientCommands.map(function (command) {
    let commandMethod = client[command]
    client[command] = client[command.toUpperCase()] = function () {
      let thunkCommand = commandMethod.apply(client, arguments)
      return new AliasPromise(function (resolve, reject) {
        thunkCommand(function (err, res) {
          if (err == null) resolve(res)
          else reject(err)
        })
      })
    }
  })
  return client
}

// return ['[192.168.0.100]:7711', '[::192.9.5.5]:7711']
function normalizeNetAddress (array) {
  return array.map(function (options) {
    if (typeof options === 'string') return wrapIPv6Address(options)
    if (typeof options === 'number') return wrapIPv6Address(defaultHost, options)
    options.host = options.host || defaultHost
    options.port = options.port || defaultPort
    return wrapIPv6Address(options.host, options.port)
  })
}
