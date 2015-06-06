'use strict'
/*global */

var disque = require('../index')
var client = disque.createClient([7711, 7712, 7713])

client.info()(function (err, info) {
  console.log(err, info)

  return this.addjob('queueA', 'Hello', 0)
})(function (err, res) {
  console.log(err, res)
  // null
  // 'DI81250b3ccbac68e6625e79c8e7c5b286b1dcd2ac05a0SQ'
  return this.show(res)

})(function (err, res) {
  console.log(err, res)
// null
// {
//   id: 'DI81250b3ccbac68e6625e79c8e7c5b286b1dcd2ac05a0SQ',
//   queue: 'queueA',
//   state: 'queued',
//   repl: 3,
//   ttl: 86400,
//   ctime: 1430579357544000000,
//   delay: 0,
//   retry: 8640,
//   'nodes-delivered':
//    [ 'f0e652056250c887ed294a53fa9386ea05abb0be',
//      '2067c69f914c619ed9f348f5ce6e7532ec26e9a8',
//      '81250b3c4318f0b6463da3742c7cf7069a46b6f6' ],
//   'nodes-confirmed': [],
//   'next-requeue-within': 8639835,
//   'next-awake-within': 8639335,
//   body: 'Hello'
// }
})
