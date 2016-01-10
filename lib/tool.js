'use strict'

const util = require('util')

exports.setPrivate = function (ctx, key, value) {
  Object.defineProperty(ctx, key, {
    value: value,
    writable: false,
    enumerable: false,
    configurable: false
  })
}

exports.slice = function (args, start) {
  start = start || 0
  if (start >= args.length) return []
  let len = args.length
  let ret = Array(len - start)
  while (len-- > start) ret[len - start] = args[len]
  return ret
}

exports.log = function (err) {
  let silent = this.silent
  if (util.isError(err)) {
    arguments[0] = err.stack
    silent = false
  }
  if (!silent) console.log.apply(console, arguments)
}

exports.each = function (obj, iterator, context, arrayLike) {
  if (!obj) return
  if (arrayLike == null) arrayLike = Array.isArray(obj)
  if (arrayLike) {
    for (let i = 0, l = obj.length; i < l; i++) iterator.call(context, obj[i], i, obj)
  } else {
    let keys = Object.keys(obj)
    for (let i = 0, l = keys.length; i < l; i++) iterator.call(context, obj[keys[i]], keys[i], obj)
  }
}
