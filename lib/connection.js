'use strict';

var net = require('net');
var util = require('util');
var Resp = require('respjs');

var tool = require('./tool');
var Queue = require('./queue');

var Thunk = require('thunks')();
var debug = require('debug')('disque');

exports.sendCommand = sendCommand;
exports.createConnections = createConnections;

function sendCommand(disque, commandName, args, additionalCallbacks, responseHook) {
  return Thunk.call(disque, function(callback) {
    var command = createCommand(this, commandName, args, callback, additionalCallbacks, responseHook);
    dispatchCommands(this, command);
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
  return connection;
}

function Connection(disque, id) {
  this.id = id;
  this.disque = disque;

  this.attempts = 0;
  this.retryDelay = 1000;

  this.ended = false;
  this.connected = false;
  this.monitorMode = false;
  this.queue = new Queue();
  this.pendingQueue = new Queue();
  this.returnBuffers = disque._disqueState.options.returnBuffers;
  this.connect();
}

Connection.prototype.returnCommands = function() {
  debug('move commands to main queue, %s', this.id);
  this.rescuePending();
  this.queue.migrateTo(this.disque._disqueState.commandQueue);
  return this;
};

Connection.prototype.rescuePending = function() {
  debug('rescue pending commands, %s', this.id);
  while (this.pendingQueue.length) {
    var command = this.pendingQueue.pop();
    if (command.name !== 'debug') this.queue.unshift(command);
  }
  this.pendingQueue = null;
  return this;
};

Connection.prototype.disconnect = function() {
  if (this.ended) return;
  this.ended = true;
  this.returnCommands();
  this.destroy();
};

Connection.prototype.destroy = function() {
  this.connected = false;
  this.resp.removeAllListeners();
  this.socket.removeAllListeners(['connect', 'error', 'close', 'end']);
  this.socket.end();
  this.socket.destroy();
  this.socket = null;
  debug('destroy socket, %s', this.id);
};

Connection.prototype.connect = function() {
  var ctx = this;

  this.connected = false;
  if (this.socket) this.destroy();

  var address = this.id.split(':');
  var options = this.disque._disqueState.options;
  var socket = this.socket = net.createConnection({
    host: address[0],
    port: +address[1]
  });

  socket.setNoDelay(options.noDelay);
  socket.setTimeout(0);
  socket.setKeepAlive(true);
  debug('create socket, %s', this.id);

  this.resp = ctx.createResp();

  socket
    .once('connect', function() {
      // reset
      ctx.attempts = 0;
      ctx.retryDelay = 1000;

      ctx.checkConnection();
      debug('socket connected, %s', ctx.id);
    })
    .on('error', function(error) {
      ctx.disque.emit('error', error);
    })
    .once('close', function(hadError) {
      ctx.reconnecting();
    });

  socket.pipe(this.resp);
  return this;
};

Connection.prototype.reconnecting = function() {
  var ctx = this;
  var disqueState = this.disque._disqueState;
  var options = disqueState.options;
  this.connected = false;

  if (disqueState.ended || this.ended) return;

  // try reset default socket
  if (disqueState.connection === this) {
    for (var id in disqueState.pool) {
      if (id !== this.id) {
        disqueState.connection = disqueState.pool[id];
        break;
      }
    }
  }

  if (++this.attempts <= options.maxAttempts) {
    this.rescuePending();
    this.retryDelay *= 1.2;
    if (this.retryDelay >= options.retryMaxDelay)
      this.retryDelay = options.retryMaxDelay;

    setTimeout(function() {
      debug('socket reconnecting, %s', ctx.id);
      ctx.connect();
      ctx.disque.emit('reconnecting', {
        delay: ctx.retryDelay,
        attempts: ctx.attempts
      });
    }, this.retryDelay);
  } else {
    this.tryRemove(new Error(this.id + ' reconnecting failed'), true);
  }
};

Connection.prototype.checkConnection = function() {
  var ctx = this;
  var disqueState = this.disque._disqueState;
  var options = disqueState.options;

  disqueState.Thunk(function(callback) {
    // auth
    if (!options.authPass) return callback();
    var command = createCommand(ctx.disque, 'auth', [options.authPass], function(error, res) {
      if (res && res.toString() === 'OK') return callback();
      callback(new Error('Auth failed: ' + ctx.id));
    });
    ctx.writeCommand(command);

  })(function() {
    // check cluster slots and connect them.
    // return updateNodes(ctx);
    return;

  })(function() {
    ctx.connected = true;
    ctx.disque.emit('connection', ctx);
    // default socket connected
    if (disqueState.connected) ctx.flushQueue();
    else {
      disqueState.connected = true;
      disqueState.connection = ctx;
      ctx.disque.emit('connect');
      dispatchCommands(ctx.disque);
    }
  });
};

Connection.prototype.createResp = function() {
  var ctx = this;
  var disque = this.disque;
  var disqueState = disque._disqueState;
  var pendingQueue = this.pendingQueue;

  return new Resp({returnBuffers: ctx.returnBuffers})
    .on('error', function(error) {
      debug('resp error, node %s', ctx.id, '\n', error);
      ctx.rescuePending();
      disque.emit('error', error);
    })
    .on('drain', function() {
      ctx.flushQueue();
    })
    .on('data', function(data) {
      var command = pendingQueue.first();
      debug('resp receive, node %s', ctx.id, '\n', data, command);

      if (ctx.monitorMode && (!command || command.name !== 'quit'))
        return disque.emit('monitor', data);

      pendingQueue.shift();
      if (!command) return disque.emit('error', new Error('Unexpected reply: ' + data));

      if (util.isError(data)) {
        data.node = ctx.id;
        command.callback(data);
        return disque.emit('warn', data);
      }

      if (command.name === 'monitor') {
        debug('enter monitor mode', '\n', command);
        ctx.monitorMode = true;
        return command.callback(null, data);
      }

      return command.callback(null, data);
    });
};

Connection.prototype.tryRemove = function(error, tryEnd) {
  var disque = this.disque;
  var disqueState = this.disque._disqueState;
  if (this.ended || !disqueState.pool) return;

  this.disconnect();
  delete disqueState.pool[this.id];
  var connectionIds = Object.keys(disqueState.pool);
  // try reset default socket
  if (disqueState.slots[-1] === this.id) disqueState.slots[-1] = connectionIds[0];

  if (error) disque.emit('error', error);
  if (tryEnd && !connectionIds.length) disque.clientEnd(error);
  else {
    // dispatch commands again
    process.nextTick(function() {
      dispatchCommands(disque);
    });
  }
};

Connection.prototype.flushQueue = function() {
  // `this.pendingQueue.length` improve performance more than 80% magically.
  if (!this.connected || this.pendingQueue.length) return this;
  while (this.queue.length) this.writeCommand(this.queue.shift());

  return this;
};

Connection.prototype.sendCommand = function(commandName, args, additionalCallbacks, responseHook) {
  var ctx = this;
  return Thunk.call(this.disque, function(callback) {
    var command = createCommand(this, commandName, args, callback, additionalCallbacks, responseHook);
    ctx.queue.push(command);
    ctx.flushQueue();
  });
};

Connection.prototype.writeCommand = function(command) {
  this.pendingQueue.push(command);
  var additionalCallbacks = command.additionalCallbacks;
  while (additionalCallbacks-- > 0)
    this.pendingQueue.push({
      name: command.name,
      callback: noOp
    });

  debug('socket write, slot %s, node %s, length %d', command.slot, this.id, command.data.length, '\n', command.data);
  return this.socket.write(command.data);
};

// function updateNodes(connection) {
//   var disque = connection.disque;
//   return disque._disqueState.Thunk(function(callback) {
//     if (!disque._disqueState.clusterMode) return callback();
//     var command = createCommand(disque, 'cluster', ['slots'], function(error, res) {
//       if (error) return callback(error);
//       tool.each(res, function(info) {
//         // [ 5461, 10922, [ '127.0.0.1', 7001 ], [ '127.0.0.1', 7004 ] ]
//         var id, i = 1, replicationIds = [];
//
//         while (info[++i]) {
//           id = info[i][0] + ':' + info[i][1];
//           replicationIds.push(id);
//         }
//         // get other nodes.
//         var _connection = createConnection(disque, replicationIds[0]);
//         _connection.replicationIds = replicationIds.slice(1);
//
//         for (i = info[0]; i <= info[1]; i++) disque._disqueState.slots[i] = replicationIds[0];
//       });
//       callback();
//     });
//
//     connection.writeCommand(command);
//   });
// }

function Command(command, data, callback, additionalCallbacks) {
  this.data = data;
  this.name = command;
  this.callback = callback;
  this.additionalCallbacks = additionalCallbacks || 0;
  debug('add command', '\n', this);
}

function createCommand(disque, commandName, args, callback, additionalCallbacks, responseHook) {
  if (disque._disqueState.ended) return callback(new Error('The disque client was ended'));

  var reqArray = tool.slice(args);
  reqArray.unshift(commandName);

  var _callback = !responseHook ? callback : function(err, res) {
    if (err != null) return callback(err);
    callback(null, responseHook.call(disque, res));
  };

  var buffer;
  try {
    buffer = Resp.bufferify(reqArray);
  } catch (error) {
    return _callback(error);
  }
  return new Command(reqArray[0], buffer, _callback, additionalCallbacks);
}

function dispatchCommands(disque, command) {
  var disqueState = disque._disqueState;
  var commandQueue = disqueState.commandQueue;

  if (!disqueState.connected) {
    if (command) commandQueue.push(command);
    return;
  }

  var connections = Object.create(null);

  var _connection = null;
  while (commandQueue.length) {
    _connection = dispatchCommand(disqueState, commandQueue.shift());
    if (_connection) connections[_connection.id] = _connection;
  }

  if (command) _connection = dispatchCommand(disqueState, command);
  if (_connection) connections[_connection.id] = _connection;

  tool.each(connections, function(connection) {
    connection.flushQueue();
  });
}

function dispatchCommand(disqueState, command) {
  var connection = disqueState.connection;
  if (!connection || connection.ended) {
    process.nextTick(function() {
      command.callback(new Error('connection not exist'));
    });
    return;
  }
  connection.queue.push(command);
  return connection;
}

function noOp() {}
