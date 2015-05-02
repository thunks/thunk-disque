thunk-disque
==========
A thunk/promise-based disque client, support all disque features.

[![NPM version][npm-image]][npm-url]
[![Build Status][travis-image]][travis-url]

## 中文教程 http://disquebook.com/

## https://github.com/antirez/disque

## https://github.com/thunks/thunks

## Installation

**Node.js:**

```bash
npm install thunk-disque
```

## API

```js
var disque = require('thunk-disque');
```

#### disque.createClient([port], [host], [options])
#### disque.createClient([addressArray], [options])

- `port`: {Number}, default: `6379`;
- `host`: {String}, default: `'localhost'`;
- `options`: {Object}, default: `{}`;
  - `handleError`: {Boolean}, *Optional*, Handle client error event. Default: `true`.
  - `authPass`: {String}, *Optional*, Default: `''`.
  - `returnBuffers`: {Boolean}, *Optional*, Default: `false`.
  - `usePromise`: {Boolean|Promise}, *Optional*, Default: `false`.

    **Use default Promise:**
    ```js
    var disque = require('thunk-disque');
    var client = disque.createClient({
      usePromise: true
    });
    ```

    **Use bluebird:**
    ```js
    var disque = require('thunk-disque');
    var Bluebird = require('bluebird');
    var client = disque.createClient({
      usePromise: Bluebird
    });
    ```
  - `noDelay`: {Boolean}, *Optional*, Default: `true`.
      Disables the Nagle algorithm. By default TCP connections use the Nagle algorithm, they buffer data before sending it off. Setting true for noDelay will immediately fire off data each time socket.write() is called.
  - `retryMaxDelay`: {Number}, *Optional*, Default: `Infinity`.
      By default every time the client tries to connect and fails time before reconnection (delay) almost multiply by `1.2`. This delay normally grows infinitely, but setting `retryMaxDelay` limits delay to maximum value, provided in milliseconds.
  - `maxAttempts`: {Number}, *Optional*, Default: `10`.
      By default client will try reconnecting until connected. Setting `maxAttempts` limits total amount of reconnects.

Create a disque client, return the client.

```js
// connect to 127.0.0.1:7711
var client1 = disque.createClient();
var client5 = disque.createClient(7711, '127.0.0.1');

// connect to 127.0.0.1:7711, 127.0.0.1:7712, 127.0.0.1:7713
// and auto meet them into cluster
var client6 = disque.createClient([7711, 7712, 7713]);
```

#### disque.log([...])

```js
var client = disque.createClient();
client.info()(redis.log);
```

### Events

#### client.on('close', function () {})
#### client.on('connect', function () {})
#### client.on('connection', function (connection) {})
#### client.on('warn', function (error) {})
#### client.on('error', function (error) {})
#### client.on('reconnecting', function (message) {})

#### client.on('monitor', function (message) {})

### Others

#### client.clientCommands

#### client.clientEnd()
#### client.clientUnref()

### Disque Commands

#### client.ackjob
#### client.addjob
#### client.auth
#### client.bgrewriteaof
#### client.client
#### client.cluster
#### client.command
#### client.config
#### client.debug
#### client.deljob
#### client.dequeue
#### client.enqueue
#### client.fastack
#### client.getjob
#### client.hello
#### client.info
#### client.latency
#### client.loadjob
#### client.monitor
#### client.ping
#### client.qlen
#### client.qpeek
#### client.show
#### client.shutdown
#### client.slowlog
#### client.time

## Debug

Tool: **https://github.com/visionmedia/debug**

Debugs: `redis:resp`, `redis:socket`, `redis:command`

**Debug all:**
```sh
DEBUG=redis:* node examples/demo
```

[npm-url]: https://npmjs.org/package/thunk-disque
[npm-image]: http://img.shields.io/npm/v/thunk-disque.svg

[travis-url]: https://travis-ci.org/thunks/thunk-disque
[travis-image]: http://img.shields.io/travis/thunks/thunk-disque.svg
