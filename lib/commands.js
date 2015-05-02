'use strict';

var Thunk = require('thunks')();
var tool = require('./tool');
var sendCommand = require('./connection').sendCommand;

// (Disque 0.0.1) `disque command`
// `node check-commands.js`
var commandsInfo = {
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
  latency: [-2, ['readonly', 'admin', 'loading'], 0, 0, 0],
  loadjob: [2, ['write'], 0, 0, 0],
  monitor: [1, ['readonly', 'admin'], 0, 0, 0],
  ping: [-1, ['readonly', 'fast'], 0, 0, 0],
  qlen: [2, ['readonly', 'fast'], 0, 0, 0],
  qpeek: [3, ['readonly'], 0, 0, 0],
  show: [2, ['readonly', 'fast'], 0, 0, 0],
  shutdown: [-1, ['readonly', 'admin', 'loading'], 0, 0, 0],
  slowlog: [-2, ['readonly'], 0, 0, 0],
  time: [1, ['readonly', 'fast'], 0, 0, 0]
};

// fake QUIT command info~
commandsInfo.quit = [1, ['readonly', 'noscript'], 0, 0, 0];

var commands = Object.keys(commandsInfo);

exports.initCommands = function(proto) {

  proto.clientCommands = commands;

  tool.each(commands, function(command) {
    proto[command] = function() {
      return sendCommand(this, command, adjustArgs(arguments));
    };
  }, null, true);

  /* overrides */

  // Parse the reply from INFO into a hash.
  proto.info = function() {
    return sendCommand(this, 'info', adjustArgs(arguments), 0, formatInfo);
  };

  proto.monitor = function(hashKey) {
    var args = adjustArgs(arguments);
    if (hashKey || !this._redisState.clusterMode)
      return sendCommand(this, 'monitor', args);

    // monit all nodes in cluster mode
    var tasks = [];
    tool.each(this._redisState.pool, function(connection) {
      if (connection.monitorMode) return;
      tasks.push(connection.sendCommand('monitor', args));
    });

    return Thunk.all.call(this, tasks);
  };

  tool.each(commands, function(command) {
    proto[command.toUpperCase()] = proto[command];
  }, null, true);
};

function isObject(obj) {
  return typeof obj === 'object' && !Array.isArray(obj);
}

function adjustArgs(args) {
  return Array.isArray(args[0]) ? args[0] : args;
}

function toArray(hash, array) {
  tool.each(hash, function(value, key) {
    array.push(key, value);
  }, null);
  return array;
}

function toHash(array) {
  var hash = {};

  for (var i = 0, len = array.length; i < len; i += 2)
    hash[array[i]] = array[i + 1];

  return hash;
}

function formatInfo(info) {
  var hash = {};

  tool.each(info.toString().split('\r\n'), function(line) {
    var index = line.indexOf(':');

    if (index === -1) return;
    var name = line.slice(0, index);
    hash[name] = line.slice(index + 1);
  }, null, true);

  return hash;
}
