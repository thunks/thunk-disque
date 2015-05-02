'use strict';
/*global */

var disque = require('../index');
var client = disque.createClient([7711, 7712, 7713]);

client.info()(function (err, info) {
  console.log(err, info);
});
