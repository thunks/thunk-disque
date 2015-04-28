'use strict';

var net = require('net');
var util = require('util');
var resp = require('respjs');

var tool = require('./tool');
var Queue = require('./queue');

var Thunk = require('thunks')();
var debugResp = require('debug')('disque:resp');
var debugSocket = require('debug')('disque:socket');
var debugCommand = require('debug')('disque:command');


exports.sendCommand = sendCommand;
exports.createConnections = createConnections;

function sendCommand(disque, command, args, additionalCallbacks, responseHook) {
  return Thunk.call(disque, function(callback) {
    if (this._disqueState.ended) return callback(new Error('The disque client was ended'));
    args = tool.slice(args);
    args.unshift(command);
    var _callback = !responseHook ? callback : function(err, res) {
      if (err != null) return callback(err);
      callback(null, responseHook.call(disque, res));
    };
    dispatchCommands(this, createCommand(this, args, _callback, additionalCallbacks));
  });
}

function createConnections(disque, addressArray) {
  addressArray.forEach(function(id) {
    createConnection(disque, id);
  });
}

function createConnection(disque, id) {
  var disqueState = disque._disqueState;
  var connection = disqueState.pool[id];
  if (!connection) connection = disqueState.pool[id] = new Connection(disque, id);
  else {
    process.nextTick(function() {
      connection.execQueue();
    });
  }
  return connection;
}

function Connection(disque, id) {
  var options = disque._disqueState.options;

  this.id = id;
  this.disque = disque;

  this.attempts = 0;
  this.retryDelay = 1000;

  this.ended = false;
  this.connected = false;
  this.queue = new Queue();
  this.pendingWatcher = null;
  this.replicationIds = null;
  this.returnBuffers = options.returnBuffers;
  this.commandsHighWater = options.commandsHighWater;

  this.connect();
}

Connection.prototype.returnCommands = function() {
  debugCommand('move commands to main queue, %s', this.id);
  this.rescuePending();
  this.queue.migrateTo(this.disque._disqueState.commandQueue);
  return this;
};

Connection.prototype.rescuePending = function() {
  if (!this.pendingWatcher) return;
  debugCommand('rescue pending commands, %s', this.id);
  var command = this.pendingWatcher.commands.pop();
  while (command) {
    if (command.slot != null && command.name !== 'debug') this.queue.unshift(command);
    command = this.pendingWatcher.commands.pop();
  }
  this.pendingWatcher = null;
  return this;
};

Connection.prototype.destroy = function() {
  if (this.ended) return;
  this.ended = true;
  this.connected = false;
  this.returnCommands();
  this.socket.end();
  this.socket.destroy();
  this.socket = null;
  debugSocket('destroy socket, %s', this.id);
};

Connection.prototype.connect = function() {
  var ctx = this;

  this.connected = false;
  if (this.socket) this.socket.destroy();

  var address = this.id.split(':');
  var options = this.disque._disqueState.options;
  var socket = this.socket = net.createConnection({
    host: address[0],
    port: +address[1]
  });

  socket.setNoDelay(options.noDelay);
  socket.setTimeout(options.timeout);
  socket.setKeepAlive(options.keepAlive);
  debugSocket('create socket, %s', this.id);

  socket
    .on('connect', function() {
      // reset
      ctx.attempts = 0;
      ctx.retryDelay = 1000;

      ctx.connected = true;
      ctx.checkConnection();
      debugSocket('socket connected, %s', socket.id);
    })
    .on('data', function(chunk) {
      var reply = ctx.pendingWatcher;
      debugSocket('socket receive, node %s, length %d', ctx.id, chunk.length, '\n', chunk);

      if (!reply) return ctx.disque.emit('error', new Error('Unexpected reply: ' + chunk));
      if (!reply.resp) reply.resp = ctx.createResp();
      reply.resp.feed(chunk);
    })
    .on('error', function(error) {
      ctx.disque.emit('error', error);
    })
    .on('close', function(hadError) {
      ctx.reconnecting();
    })
    .on('timeout', function() {
      ctx.reconnecting(new Error('The disque connection was timeout'));
    })
    .on('end', function() {
      if (!ctx.disque._disqueState.clusterMode) ctx.tryRemove(null, true);
    });
  return this;
};

Connection.prototype.reconnecting = function(error) {
  var ctx = this;
  var disqueState = this.disque._disqueState;
  var options = disqueState.options;
  this.connected = false;

  if (++this.attempts <= options.maxAttempts) {
    this.rescuePending();
    this.retryDelay *= 1.2;
    if (this.retryDelay >= options.retryMaxDelay)
      this.retryDelay = options.retryMaxDelay;

    setTimeout(function() {
      debugSocket('socket reconnecting, %s', ctx.id);
      ctx.connect();
      ctx.disque.emit('reconnecting', {
        delay: ctx.retryDelay,
        attempts: ctx.attempts
      });
    }, this.retryDelay);
  } else {
    this.tryRemove(error || new Error(this.id + ' reconnecting failed'), true);
  }
};

Connection.prototype.checkConnection = function() {

};

Connection.prototype.createResp = function() {

};

Connection.prototype.tryRemove = function(error, tryEnd) {

};

Connection.prototype.execQueue = function() {

};

function Command(command, slot, data, callback, additionalCallbacks) {

}

function createCommand(disque, reqArray, callback, additionalCallbacks) {

}

function dispatchCommands(disque, command) {

}

function dispatchCommand(disqueState, command) {

}

function noOp() {}
