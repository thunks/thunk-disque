'use strict';
/*global describe, it, before, after, beforeEach, afterEach*/

var assert = require('assert');
var disque = require('../index');

describe('commands', function() {
  var client;

  before(function() {
    client = disque.createClient([7711, 7712, 7713, 7714]);
    client.on('error', function(error) {
      console.error('disque client:', error);
    });
  });

  // beforeEach(function(done) {
  //   client.flushdb()(function(error, res) {
  //     should(error).be.equal(null);
  //     should(res).be.equal('OK');
  //   })(done);
  // });

  after(function() {
    client.clientEnd();
  });

  it('client.echo', function(done) {
    client.echo('hello world!')(function(error, res) {
      should(error).be.equal(null);
      should(res).be.equal('hello world!');
      return this.echo(123);
    })(function(error, res) {
      should(error).be.equal(null);
      should(res).be.equal('123');
    })(done);
  });

  it('client.ping', function(done) {
    client.ping()(function(error, res) {
      should(error).be.equal(null);
      should(res).be.equal('PONG');
    })(done);
  });

  it('client.select', function(done) {
    client.select(10)(function(error, res) {
      should(error).be.equal(null);
      should(res).be.equal('OK');
      return this.select(99);
    })(function(error, res) {
      should(error).be.instanceOf(Error);
      should(res).be.equal(undefined);
    })(done);
  });

  it('client.auth', function(done) {
    client.auth('123456')(function(error, res) {
      should(error).be.instanceOf(Error);
      should(res).be.equal(undefined);
      return this.config('set', 'requirepass', '123456');
    })(function(error, res) {
      should(error).be.equal(null);
      should(res).be.equal('OK');
      return this.auth('123456');
    })(function(error, res) {
      should(error).be.equal(null);
      should(res).be.equal('OK');
      return this.config('set', 'requirepass', '');
    })(function(error, res) {
      should(error).be.equal(null);
      should(res).be.equal('OK');
    })(done);
  });

  it('client.quit', function(done) {
    client.quit()(function(error, res) {
      should(error).be.equal(null);
      should(res).be.equal('OK');
    })(done);
  });

});
