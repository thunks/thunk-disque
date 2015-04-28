'use strict';

var util = require('util');
var resp = require('respjs');
var thunks = require('thunks');
var EventEmitter = require('events').EventEmitter;

var tool = require('./tool');
var Queue = require('./queue');
var createConnections = require('./connection').createConnections;

var clientId = 0;

module.exports = DisqueClient;

function DisqueState(options) {
  this.options = options;

  this.database = 0;
  this.ended = false;
  this.connected = false;
  this.pubSubMode = false;
  this.monitorMode = false;
  this.clusterMode = false;
  this.timestamp = Date.now();
  this.clientId = ++clientId;
  this.commandQueue = new Queue();
  this.pool = Object.create(null);
  // {
  //   '127.0.0.1:7001': connection
  //   ...
  // }
  // masterSocket.replicationIds = ['127.0.0.1:7003', ...]

  this.slots = Object.create(null);
  // {
  //   '-1': defaultConnectionId
  //   '0': masterConnectionId
  //   '1': masterConnectionId
  ///  ...
  // }

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

// id: '127.0.0.1:7000', slot: -1, 0, 1, ...
DisqueClient.prototype.clientSwitch = function(id) {
  var disqueState = this._disqueState;
  id = disqueState.slots[id] || id;
  if (!disqueState.pool[id]) throw new Error(id + ' is not exist');
  disqueState.slots[-1] = id;
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
    connection.destroy();
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
    pool: {},
    ended: disqueState.ended,
    clientId: disqueState.clientId,
    database: disqueState.database,
    connected: disqueState.connected,
    timestamp: disqueState.timestamp,
    commandQueueLength: disqueState.commandQueue.length
  };

  tool.each(disqueState.pool, function(connection) {
    state.pool[connection.id] = connection.replicationIds ? connection.replicationIds.slice() : [];
  });
  return state;
};
