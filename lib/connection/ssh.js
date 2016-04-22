var connection = require("ssh2");

function SshConnection() {
  this._connection = new Connection();
}

SshConnection.prototype.connect = function(options) {
  this.forwardPort  = options.forwardPort;

  this._connection.connect(options);
};

SshConnection.prototype.on = function(event, handler) {
  this._connection.on(event, handler);
};

SshConnection.prototype.bindForwards = function(callback) {
  var self = this;

  this._connection.forwardIn("127.0.0.1", this.forwardPort, function(err) {
    if (err) {
      return callback(err);
    }

    // where does this go?
    // debug("Requesting secure forward channel on connection");

    self._connection.on("tcp connection", function(info, accept, reject) {
      var remote = accept();
      self._connection.emit("request", remote, remote);
    });

    return callback(null);
  });
};

SshConnection.prototype.close = function(callback) {
  var self = this;

  this._connection.unforwardIn("127.0.0.1", this.forwardPort, function(err) {
    //debug("Closing connection");
    self._connection.end();
    callback();
  });
};

SshConnection.prototype.destroy = function() {
  this._connection.destroy();
};
