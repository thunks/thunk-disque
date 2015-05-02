'use strict';

var util = require('util');
var thunks = require('thunks');
var EventEmitter = require('events').EventEmitter;

var tool = require('./tool');
var Queue = require('./queue');
var initCommands = require('./commands').initCommands;
var createConnections = require('./connection').createConnections;

var clientId = 0;

module.exports = DisqueClient;

function DisqueState(options) {
  this.options = options;

  this.ended = false;
  this.connected = false;
  this.timestamp = Date.now();
  this.clientId = ++clientId;
  this.commandQueue = new Queue();
  this.pool = Object.create(null);
  this.connection = null;
}

function DisqueClient(addressArray, options) {
  EventEmitter.call(this);
  tool.setPrivate(this, '_disqueState', new DisqueState(options));

  var ctx = this;
  this._disqueState.Thunk = thunks(function(error) {
    ctx.emit('error', error);
  });
  createConnections(this, addressArray);
}

util.inherits(DisqueClient, EventEmitter);
initCommands(DisqueClient.prototype);

// id: '127.0.0.1:7000'
DisqueClient.prototype.clientSwitch = function(id) {
  if (!this._disqueState.pool[id]) throw new Error(id + ' is not exist');
  this.connection = this._disqueState.pool[id];
  return this;
};

DisqueClient.prototype.clientUnref = function() {
  if (this._disqueState.ended) return;
  tool.each(this._disqueState.pool, function(connection) {
    if (connection.connected) connection.socket.unref();
    else connection.socket.once('connect', function() {
      this.unref();
    });
  });
};

DisqueClient.prototype.clientEnd = function(hadError) {
  if (this._disqueState.ended) return;
  this._disqueState.ended = true;
  this._disqueState.connected = false;
  tool.each(this._disqueState.pool, function(connection) {
    connection.disconnect();
  });
  var commandQueue = this._disqueState.commandQueue;
  var message = (hadError && hadError.toString()) || 'The redis connection was ended';
  while (commandQueue.length) commandQueue.shift().callback(new Error(message));

  this._disqueState.pool = null;
  this.emit('close', hadError);
  this.removeAllListeners();
};

DisqueClient.prototype.clientState = function() {
  var disqueState = this._disqueState;
  var state = {
    ended: disqueState.ended,
    clientId: disqueState.clientId,
    connected: disqueState.connected,
    timestamp: disqueState.timestamp,
    connection: disqueState.connection,
    commandQueueLength: disqueState.commandQueue.length
  };
  return state;
};
