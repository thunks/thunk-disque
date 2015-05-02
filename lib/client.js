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
  // {
  //   '127.0.0.1:7711': connection1,
  //   '127.0.0.1:7712': connection2,
  //   '9125b458': connection1,
  //   'e50c7ee4': connection2,
  //   ...
  // }
  // connection1.id === '127.0.0.1:7711'
  // connection1.sid === '9125b458'
  // connection1.nid === '9125b45882462cd1fb144626345e0bbdce2009d4'
  this.connections = []; // ['9125b458', 'b63e269d', ...]
  this.nodes = [];
  // nodes info from hello:
  // [
  //   ['9125b45882462cd1fb144626345e0bbdce2009d4', '127.0.0.1', '7711', '1'],
  //   ['e50c7ee4f62d93636afa99b6e7ca8971c6288159', '127.0.0.1', '7712', '1'],
  //   ['b63e269d8eb0c70f4b5851fc8867f3c6776f42a4', '127.0.0.1', '7713', '1'],
  //   ['8e4296741b592cb65982884bc429f79fe52ad532', '127.0.0.1', '7714', '1']
  //   ...
  // ]
}

function DisqueClient(addressArray, options) {
  EventEmitter.call(this);
  tool.setPrivate(this, '_disqueState', new DisqueState(options));
  this._disqueState.addresses = addressArray;

  var ctx = this;
  this._disqueState.Thunk = thunks(function(error) {
    ctx.emit('error', error);
  });
  createConnections(this, addressArray);
}

util.inherits(DisqueClient, EventEmitter);
initCommands(DisqueClient.prototype);

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
  var message = (hadError && hadError.toString()) || 'The disque connection was ended';
  while (commandQueue.length) commandQueue.shift().callback(new Error(message));

  this._disqueState.pool = null;
  this.emit('close', hadError);
  this.removeAllListeners();
};
