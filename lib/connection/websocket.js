var io = require("socket.io-client");
var ss = require("socket.io-stream");

function WebsocketConnection() {
}

WebsocketConnection.prototype.connect = function(options) {
  this._connection = io("ws://" + this.host + ":" + this.port + "?id=" + this.connectionId);

  var self = this;
  self._connection.on("connect", function() {
    setImmediate(function() {
      // to make this interface the same as SSH we have to manually
      // emit a 'ready' event
      self._connection.emit("ready");
    });
  });
};

WebsocketConnection.prototype.on = function(event, handler) {
  this._connection.on(event, handler);
};

WebsocketConnection.prototype.bindForwards = function(callback) {
  var self = this;

  ss(this._connection).on("request", function(requestStream, responseStream) {
    self._connection.emit("request", requestStream, responseStream);
  });

  setImmediate(callback);
};
