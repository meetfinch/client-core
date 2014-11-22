var config  = require("./config");
// low-level wrapper around our connection transport of choice
var Tunnel  = require("./tunnel");
// for making API requests
var Client  = require("./client");
// high-level wrapper suitable for returning to consumers
var Session = require("./session");
// used for connection related stuff
var os      = require("os");
// part of API handshake
var version = require(__dirname + "" + "/../package.json").version;
// to figure out configuration path based on env/os
var Loader = require("./loader");
// to load and save user's preferences
var UserPrefs = require("./preferences");

var forward = function(options, callback) {
  var client = new Client({
    url: config.api.url,
    path: config.api.path
  });

  var params = {
    version: version,
    os_type: os.type(),
    os_platform: os.platform(),
    os_arch: os.arch(),
    os_release: os.release(),
    forwards: options.forwards,
    key: options.key
  };

  var session = new Session();

  client.post("/connections", params, function(err, response) {
    if (err) {
      console.log("ERROR", err);
      return;
    }

    var tunnel = new Tunnel(response.connection);

    session._connection = response.connection;
    session._tunnel = tunnel;
    session._key = options.key;
    session._forwards = response.connection.forwards;
    session.forwards = [];

    for (var i = 0, j = session._forwards.length; i < j; i++) {
      var forward = session._forwards[i];
      var friendly = {
        url: config.server.protocol + "://" + forward.subdomain + "." + response.connection.domain + config.server.suffix
      };
      session.forwards.push(friendly);
    }

    tunnel.on("connect", function() {
      session.emit("connect");
    });

    tunnel.on("ready", function() {
      session.emit("ready");
    });

    tunnel.on("ping", function() {
      // @TODO handle internally
    });

    tunnel.on("close", function() {
      session.emit("close");
    });

    tunnel.on("data", function() {
      session.emit("data");
    });

    tunnel.connect();
  });

  return session;
};

var close = function(session) {
  var client = new Client({
    url: config.api.url,
    path: config.api.path
  });

  var params = {
    id: session._connection.id,
    reason: "disconnect",
    key: session._key
  };

  client.del("/connections", params, function(err) {
    if (err) {
      console.log(err);
      return;
    }

    session._tunnel.close(function(err) {
      if (err) {
        console.log(err);
      }
    });
  });
};

var load = function(path, callback) {
  // figure out how to find the user's config file
  var loader = new Loader({
    env: process.env,
    file: path
  });

  var preferences = new UserPrefs(loader.getPath());

  preferences.load(function(err) {
    if (err) {
      return callback(err);
    }

    return callback(null, preferences);
  });
};

var auth = function(params, callback) {
  var client = new Client({
    url: config.api.url,
    path: config.api.path
  });

  client.post("/auth", params, function(err, response) {
    if (err) {
      console.log("ERROR", err);
      return callback(err);
    }

    return callback(null, response.token);
  });
};

module.exports = {
  forward: forward,
  close: close,
  load: load,
  auth: auth
};
