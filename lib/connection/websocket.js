var io = require("socket.io-client");
var ss = require("socket.io-stream");

function WebsocketConnection() {
}

WebsocketConnection.prototype.connect = function(options) {
  this._socket = io("ws://" + this.host + ":" + this.port + "?id=" + this.socketId);

  var self = this;
  self._socket.on("connect", function() {
    setImmediate(function() {
      // to make this interface the same as SSH we have to manually
      // emit a 'ready' event
      self._socket.emit("ready");
    });
  });
};

WebsocketConnection.prototype.on = function(event, handler) {
  this._socket.on(event, handler);
};

WebsocketConnection.prototype.bindForwards = function(callback) {
  var self = this;

  ss(this._socket).on("request", function(requestStream, responseStream) {
    self._socket.emit("request", requestStream, responseStream);
  });

  setImmediate(callback);
};

WebsocketConnection.prototype.close = function(callback) {
  this._socket.disconnect(true);
  setImmediate(callback);
};

WebsocketConnection.prototype.destroy = function() {
  this._socket.disconnect(true);
  setImmediate(callback);
};

module.exports = WebsocketConnection;
