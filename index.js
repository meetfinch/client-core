var config  = require("./config");
// low-level wrapper around our connection transport of choice
var Tunnel  = require("./lib/tunnel");
// for making API requests
var Client  = require("./lib/client");
// high-level wrapper suitable for returning to consumers
var Session = require("./lib/session");
// used for connection related stuff
var os      = require("os");
// part of API handshake
var version = require(__dirname + "/package.json").version;
// to figure out configuration path based on env/os
var Loader = require("./lib/loader");
// to load and save user's preferences
var UserPrefs = require("./lib/preferences");
// for handling any forwarding errors
var ErrorHandler = require("./lib/service/handlers/error");

module.exports = {
  forward: function(options, callback) {
    var client = new Client({
      url: config.api.url,
      path: config.api.path
    });

    var params = {
      // @TODO clientId: xxx,
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
      session.forwards = [];

      var forwards = response.connection.forwards;

      for (var i = 0, j = forwards.length; i < j; i++) {
        var f = forwards[i];
        var forward = {
          url: config.server.protocol + "://" + f.subdomain + "." + response.connection.domain + config.server.suffix
        };
        session.forwards.push(forward);
      }

      var errorHandler = new ErrorHandler({
        assets: __dirname + "/assets/templates/errors"
      });

      tunnel.on("connect", function() {
        session.emit("connect");
      });

      tunnel.on("ready", function() {
        session.emit("ready");
      });

      tunnel.on("ping", function() {
        // @TODO handle internally
        // if the result of the ping was a revocation, then...
        // session.emit("revoked");
      });

      tunnel.on("close", function(hadError) {
        session.emit("close", hadError);
      });

      tunnel.on("error", function() {
        session.emit("error");
      });

      tunnel.on("data", function() {
        session.emit("data");
      });

      tunnel.on("idle", function() {
        session.emit("idle");
      });

      tunnel.on("local:error", function(err, data) {
        errorHandler.dispatch(err, data.local, data.remote);
      });

      session.emit("start");

      tunnel.connect();
    });

    return session;
  },

  close: function(session, callback) {
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
        if (callback) {
          callback();
        }
      });
    });
  },

  load: function(path, callback) {
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
  },

  auth: function(params, callback) {
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
  }
};
