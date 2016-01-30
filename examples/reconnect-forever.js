'use strict'
/*global */

var disque = require('../index')
var client = disque.createClient()

client
  .on('error', function (err) {
    console.error(err)
  })
  .on('close', function () {
    console.log('close and reconnect')
    this.clientConnect()
  })

var count = 0
setInterval(function () {
  client.ping()(function (err, res) {
    console.log(++count, err, res)
  })
}, 2000)
