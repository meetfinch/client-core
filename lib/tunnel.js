//var Connection = require("ssh2");
var io = require("socket.io-client");
var ss = require("socket.io-stream");
var debug = require("debug")("finch:core:tunnel");
var net = process.env.CHROME_EXTENSION ? require("./shim/net") : require("net");
var tls = require("tls");
var util = require("./util");

var EventEmitter = require("events").EventEmitter;

var Tunnel = function(options) {
  var _ref, _i, _len, forward;

  this.emitter = new EventEmitter();

  this.forwards = {};

  this.timeoutHandler = null;
  this.retryHandler = null;
  this.timeout = null;

  this.connectionId = options.id;
  this.host         = options.host;
  this.port         = options.port;
  this.user         = options.user;
  this.key          = options.key;
  this.forwardPort  = options.forwardPort;
  this.keepalive    = options.keepalive || 0;

  this.retries = 0;
  this.connected = false;

  _ref = options.forwards;
  for (_i = 0, _len = _ref.length; _i < _len; _i++) {
    forward = _ref[_i];
    this.forwards[forward.subdomain] = forward;
  }
};

Tunnel.prototype.on = function(message, callback) {
  return this.emitter.on(message, callback);
};

Tunnel.prototype.connect = function() {
  debug("Connecting forwards via " + this.host + ":" + this.port);

  var self = this;

  this.connection = io("ws://" + this.host + ":" + this.port + "?id=" + this.connectionId);

  /*
  this.connection.connect({
    port: this.port,
    host: this.host,
    username: this.user,
    privateKey: this.key,
    // debug: debug,
    keepaliveInterval: this.keepalive
  });
  */

  this.connection.on("connect", function() {
    debug("Established initial WS connection");

    // @NOTE: we don't want to rely on this too much; it
    // can be emitted even if the server is unavailable
    // on ready is a much safer bet

    self.emitter.emit("connect");

    self.connected = true;
    self.retries = 0;

    debug("Secure channel established—ready for requests");

    ss(self.connection).on("request", function(requestStream, responseStream) {
      forwardLocal.call(self, requestStream, responseStream);
    });

    self.emitter.emit("ready", null);
  });

  this.connection.on("error", function(err) {
    debug("Secure connection error");
    self.connected = false;
    self.emitter.emit("error", err);
  });

  this.connection.on("close", function(err) {
    self.connected = false;
    self.emitter.emit("close", err);
  });
};

Tunnel.prototype.touch = function() {
  if (!this.timeout) {
    return;
  }

  clearTimeout(this.timeoutHandler);
  this.timeoutHandler = null;

  var self = this;

  this.timeoutHandler = setTimeout(function() {
    return self.emitter.emit("idle");
  }, this.timeout);

  // we don't want this timer blocking the event loop if the app wants to exit
  this.timeoutHandler.unref();
};

Tunnel.prototype.close = function(done) {
  var self = this;
  debug("Closing secure forward channel");

  this.clearHandlers();

  if (this.connected === false) {
    debug("Not currently connected, destroying socket");
    // destroy kills the connection's underlying _socket,
    // which may still be hanging around if we're still
    // connecting but experiencing a long delay or timeout
    return setImmediate(function() {
      self.connection.destroy();
      self.emitter.emit("close");
      done();
    });
  }

  return this.connection.unforwardIn("127.0.0.1", this.forwardPort, function(err) {
    debug("Closing connection");
    self.connection.end();
    done();
  });
};

Tunnel.prototype.destroy = function() {
  debug("Destroying secure channel");
  this.clearHandlers();
  this.connection.destroy();
};

Tunnel.prototype.retry = function() {
  var self = this;
  this.retries ++;

  this.retryHandler = setTimeout(function() {
    debug("Trying to re-establish connection...");
    self.connection = null;
    self.clearHandlers();
    self.connect();
  }, getRetryBackoff(this.retries));
};

Tunnel.prototype.clearHandlers = function() {
  clearTimeout(this.retryHandler);
  clearTimeout(this.timeoutHandler);
  this.retryHandler = null;
  this.timeoutHandler = null;
};

var forwardLocal = function(requestStream, responseStream) {
  var local, site;
  local = null;
  site = null;

  /*
   *
   * REMOTE / INBOUND REQUEST<->RESPONSE HANDLERS
   *
   */
  return requestStream.once("data", (function(self) {
    return function(data) {
      // @TODO: skip the initial parse if we only have one forward
      var forward, request, response, result;
      debug("Parsing inbound request");
      request = util.parseRequestString(data.toString("utf8"));
      if (request.headers["x-ping-" + self.connectionId]) {
        self.emitter.emit("ping", request.headers["x-ping-" + self.connectionId]);
        response = "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n";
        return responseStream.end(response, "utf8");
      }
      self.touch();
      result = connectLocalSite(self.forwards, request, responseStream);
      if (!result) {
        return responseStream.end();
      }

      forward = result.forward;
      local = result.local;

      self.emitter.emit("request", request.headers["x-subdomain"]);

      requestStream.on("data", function() {
        self.emitter.emit("data");
        return debug("REMOTE --> LOCAL");
      });
      local.on("data", function() {
        self.emitter.emit("data");
        return debug("LOCAL  --> REMOTE");
      });

      local.write(data);

      requestStream.pipe(local);
      local.pipe(responseStream);

      local.on("error", function(err) {
        data = {
          forward: forward,
          local: local,
          remote: responseStream
        };
        return self.emitter.emit("local:error", err, data);
      });

      return responseStream.on("error", function(err) {
        return self.emitter.emit("remote:error", err);
      });
    };
  })(this));
};

var connectLocalSite = function(forwards, request) {
  var domain, forward, local, options, protocol, result;
  domain = request.headers["x-subdomain"];
  forward = forwards[domain];
  if (!forward) {
    return false;
  }

  /*
   * start the actual local connection
   */
  if (forward.ssl) {
    debug("Creating https TCP socket");
    protocol = tls;
    options = {
      // @TODO expose as an option rather than always accepting self-signed
      rejectUnauthorized: false
    };
  } else {
    debug("Creating http TCP socket");
    protocol = net;
    options = {};
  }
  debug("Connecting TCP socket to " + forward.private_host + ":" + forward.private_port);
  local = protocol.connect(forward.private_port, forward.private_host, options);
  debug("Issuing request: " + request.method + " " + request.url);

  return {
    local: local,
    forward: forward
  };
};

function getRetryBackoff(retries) {

  var buckets = {
    2: 500,
    10: 1000,
    20: 2000,
    30: 3000,
    50: 5000,
    100: 10000,
    200: 15000
  };

  for (var i in buckets) {
    if (retries <= i) {
      return buckets[i];
    }
  }

  return 30e3;
}

module.exports = Tunnel;
