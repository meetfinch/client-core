var EventEmitter = require("events").EventEmitter;

var Session = function() {
  this.emitter = new EventEmitter();
};

Session.prototype.on = function(message, callback) {
  return this.emitter.on(message, callback);
};

Session.prototype.emit = function(message, data, ext) {
  this.emitter.emit(message, data, ext);
};

module.exports = Session;
