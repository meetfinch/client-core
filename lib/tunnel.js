var Connection = require("ssh2");
var debug = require("./debug");
var net = require("net");
var tls = require("tls");

var EventEmitter = require("events").EventEmitter;

var Tunnel = function(options) {
  this.connection = new Connection();

  this.emitter = new EventEmitter();

  this.options = options;

  this.forwards = {};
  _ref = this.options.forwards;
  for (_i = 0, _len = _ref.length; _i < _len; _i++) {
    forward = _ref[_i];
    this.forwards[forward.subdomain] = forward;
  }
};

Tunnel.prototype.on = function(message, callback) {
  return this.emitter.on(message, callback);
};

Tunnel.prototype.connect = function() {
  debug("Connecting forwards via " + this.options.host + ":" + this.options.sshPort);

  var self = this;

  this.connection.connect({
    port: this.options.sshPort,
    host: this.options.host,
    username: this.options.user,
    privateKey: this.options.key
  });

  this.connection.on("connect", function() {
    return self.emitter.emit("connect");
  });

  this.connection.on("ready", function() {

    self.connected = true;

    createForward.call(self, function(err) {
      if (err) {
        return self.emitter.emit("ready", err);
      }

      debug("Secure channel established—ready for requests");

      self.connection.on("tcp connection", function(info, accept, reject) {
        forwardLocal.call(self, accept());
      });

      self.emitter.emit("ready", null);
    });
  });

  this.connection.on("error", function(err) {
    self.emitter.emit("error", err);
  });

  this.connection.on("close", function(err) {
    self.emitter.emit("close", err);
  });
};

Tunnel.prototype.touch = function() {
  return;

  /*
  clearTimeout(this.timeoutHandler);
  this.timeoutHandler = null;
  this.timeoutHandler = setTimeout((function(_this) {
    return function() {
      return _this.emit("idle");
    };
  })(this), this.timeout);
  return this.timeoutHandler.unref();
  */
};

createForward = function(callback) {
  debug("Requesting secure forward channel on connection");
  return this.connection.forwardIn("127.0.0.1", this.options.forwardPort, (function(self) {
    return function(err) {
      if (err) {
        return callback(err);
      }
      self.touch();
      return callback(null);
    };
  })(this));
};

Tunnel.prototype.close = function(done) {
  debug("Closing secure forward channel");
  return this.connection.unforwardIn("127.0.0.1", this.options.forwardPort, (function(_this) {
    return function(err) {
      debug("Closing connection");
      _this.connection.end();
      return done();
    };
  })(this));
};

var forwardLocal = function(remote) {
  var local, site;
  local = null;
  site = null;

  /*
   *
   * REMOTE / INBOUND REQUEST<->RESPONSE HANDLERS
   *
   */
  return remote.once("data", (function(self) {
    return function(data) {
      var forward, request, response, result;
      debug("Parsing inbound request");
      request = parseRequestString(data.toString("utf8"));
      if (request.headers["x-ping-" + self.connectionId]) {
        self.emitter.emit("ping", request.headers["x-ping-" + self.connectionId]);
        response = "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n";
        return remote.end(response, "utf8");
      }
      self.touch();
      result = connectLocalSite(self.forwards, request, remote);
      if (!result) {
        return remote.end();
      }

      forward = result.forward;
      local = result.local;

      self.emitter.emit("request", request.headers["x-subdomain"]);

      remote.on("data", function() {
        self.emitter.emit("data");
        return debug("REMOTE --> LOCAL");
      });
      local.on("data", function() {
        self.emitter.emit("data");
        return debug("LOCAL  --> REMOTE");
      });

      local.write(data);
      remote.pipe(local);
      local.pipe(remote);
      local.on("error", function(err) {
        data = {
          forward: forward,
          local: local,
          remote: remote
        };
        return self.emitter.emit("local:error", err, data);
      });
      return remote.on("error", function(err) {
        return self.emitter.emit("remote:error", err);
      });
    };
  })(this));
};

var connectLocalSite = function(forwards, request, remote) {
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

var parseRequestString = function(req) {
  var head, header, headers, params, request, str, tail, val, _i, _len, _ref, _ref1;
  request = {
    headers: {},
    method: null,
    url: null,
    protocol: null,
    raw: req
  };
  headers = {};
  _ref = req.split("\r\n"), head = _ref[0], tail = 2 <= _ref.length ? [].slice.call(_ref, 1) : [];
  for (_i = 0, _len = tail.length; _i < _len; _i++) {
    header = tail[_i];
    if (header.indexOf(": ") === -1) {
      continue;
    }
    _ref1 = header.split(": "), str = _ref1[0], val = _ref1[1];
    headers[str.toLowerCase()] = val;
  }
  request.headers = headers;
  params = head.match(/^([A-Z]+) (.+) (HTTP\/\d\.\d)$/);
  if (params) {
    request.method = params[1];
    request.url = params[2];
    request.protocol = "http";
  }
  return request;
};

module.exports = Tunnel;