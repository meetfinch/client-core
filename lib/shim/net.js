var ss = require("socket.io-stream");
var util = require("../util");

/**
 * This is a horrible shim which sort of simulates the interface we rely on
 * from the `net` NodeJS module. It does the LEAST amount it possibly can to
 * satisfy the APIs our *current* use-case needs, and no more.
 */

function FauxSocket(port, host) {
  console.log("Creating faux socket to " + host + ":" + port);
  this.port = port;
  this.host = host;
}

FauxSocket.prototype.write = function(data) {

  var self = this;
  var reqData = util.parseRequestString(data.toString("utf8"));

  console.log("headers", reqData.headers);

  var targetUrl = "http://" + this.host + ":" + this.port + reqData.url;

  console.log(targetUrl);

  fetch(targetUrl, {
    method: reqData.method,
    headers: new Headers(reqData.headers)
  })
  .then(function(response) {

    // @TODO: actual http version?
    self.writeStream.write("HTTP/1.1 " + response.status + " " + response.statusText);

    for (var pair of response.headers.entries()) {
      self.writeStream.write(pair[0] + ": " + pair[1] + "\r\n");
    }
    self.writeStream.write("\r\n");
    var reader = response.body.getReader();
    return reader.read().then(function handleChunk(result) {
      if (result.done) {
        return;
      }
      var value = new ss.Buffer(result.value);
      self.writeStream.write(value.toString("utf8"));
      return reader.read().then(handleChunk);
    });
  })
  .then(function() {
    // response finished
    self.writeStream.end();
  })
  .catch(function(err) {
    console.log(err.message);
  });
};

FauxSocket.prototype.on = function() {
  console.log("on", arguments);
};

FauxSocket.prototype.once = function() {
  console.log("once", arguments);
};

FauxSocket.prototype.pipe = function(writeStream) {
  this.writeStream = writeStream;
};

FauxSocket.prototype.emit = function() {
  console.log("emit", arguments);
};

FauxSocket.prototype.end = function() {
  console.log("end", arguments);
};

module.exports = {
  connect: function(port, host/* , options */) {
    var socket = new FauxSocket(port, host);

    return socket;
  },

};
