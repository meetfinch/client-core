var io = require("socket.io-client");
var ss = require("socket.io-stream");

function WebsocketConnection() {
  this._onReady = null;
  this._onRequest = null;
}

WebsocketConnection.prototype.connect = function(options) {
  var str = "wss://" + options.host + ":" + options.port + "?id=" + options.username;
  this._socket = io(str);

  var self = this;
  self._socket.on("connect", function() {
    setImmediate(function() {
      // to make this interface the same as SSH we have to manually
      // emit a 'ready' event
      if (self._onReady) {
        self._onReady();
      }
    });
  });
};

WebsocketConnection.prototype.on = function(event, handler) {
  if (event === "ready") {
    this._onReady = handler;
  } else if (event === "request") {
    this._onRequest = handler;
  } else if (event === "close") {
    this._onClose = handler;
  } else {
    this._socket.on(event, handler);
  }
};

WebsocketConnection.prototype.bindForwards = function(callback) {
  var self = this;

  ss(this._socket).on("request", function(requestStream, responseStream) {
    self._onRequest(requestStream, responseStream);
  });

  setImmediate(callback);
};

WebsocketConnection.prototype.close = function(callback) {
  this._socket.disconnect(true);
  this._onClose();

  if (typeof callback === "function") {
    setImmediate(callback);
  }
};

WebsocketConnection.prototype.destroy = function() {
  this._socket.disconnect(true);
};

module.exports = WebsocketConnection;
