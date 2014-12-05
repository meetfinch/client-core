var config  = require("./config");
// handy internal debugging
var debug   = require("./lib/debug");
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
// any static forwards?
var StaticManager = require("./lib/service/static/manager");

var CLOSE_TIMEOUT = 5000;

function getClient() {
  return new Client({
    url: config.api.url,
    path: config.api.path
  });
}

function _close(reason) {
  return function(session, callback) {
    var client, params;

    if (session._closing) {
      debug("Ignoring close request; session is already closing");
      return callback();
    }

    client = getClient();

    params = {
      id: session.connection.id,
      reason: reason,
      key: session._key
    };

    session._closing = true;

    /**
     * First of all close the connection from a Finch(server) point of
     * view; the most important thing is to make sure no more traffic
     * passes through it from a billing perspective
     */
    client.del("/connections", params, function(err) {
      if (err) {
        return callback(err);
      }

      /**
       * Next set up a timer to destroy the tunnel if it doesn't shutdown
       * cleanly within a reasonable timeframe. This isn't so bad but we'd
       * still rather not unless we have to
       */
      var handler = setTimeout(function() {
        debug("tunnel close took too long; destroying");
        session._tunnel.destroy();
        callback();
      }, CLOSE_TIMEOUT);

      /**
       * Finally, initiate a clean tunnel shutdown
       */
      session._tunnel.close(function(err) {
        debug("tunnel closed cleanly");
        clearTimeout(handler);
        callback(err);
      });
    });
  };
}

module.exports = {
  forward: function(options, callback) {

    var session = new Session();

    // @TODO: parse/validate options first...

    StaticManager.start(options.forwards, function(err, servers, forwards) {
      if (err) {
        return callback(err);
      }

      var client = getClient();

      var params = {
        // @TODO clientId: xxx,
        version: version,
        os_type: os.type(),
        os_platform: os.platform(),
        os_arch: os.arch(),
        os_release: os.release(),
        forwards: forwards,
        key: options.key
      };

      client.post("/connections", params, function(err, response) {
        if (err || response.warning) {
          return callback(err, response);
        }

        debug("Connection ID: " + response.connection.id);

        var tunnel = new Tunnel(response.connection);

        if (options.timeout) {
          tunnel.timeout = options.timeout;
        }

        session.connection = response.connection;
        session._tunnel    = tunnel;
        session._key       = options.key;
        session._servers   = servers;
        session.forwards   = [];

        var forwards = response.connection.forwards;

        for (var i = 0, j = forwards.length; i < j; i++) {
          var f = forwards[i];
          var forward = {
            url: config.server.protocol + "://" + f.subdomain + "." + response.connection.domain + config.server.suffix
          };
          session.forwards.push(forward);
        }

        var errorHandler = new ErrorHandler();

        tunnel.on("connect", function() {
          session.emit("connect");
        });

        tunnel.on("ready", function(err) {
          session.emit("ready", err);
        });

        tunnel.on("ping", function(id) {
          debug("Verifying ping request");

          var client = getClient();
          var params = {
            pingId: id,
            key: session._key
          };

          client.get("/connections/ping", params, function(err, response) {
            if (err) {
              // probably a misguided ping; silently ignore
              return;
            }

            var type = response.type;

            /**
             * session.emit("ping", type);
             */

            switch (type) {
              case "disconnect": // @NOTE: should be revoked, hence why we re-map here
                session.emit("revoked");
                session._tunnel.close();
                break;

              default:
                debug("Unhandled ping response type: " + type);
                break;
            }
          });
        });

        tunnel.on("close", function(hadError) {
          /**
           * @TODO did we know about this close, or do we need to
           * handle it and initiate a DEL /connections{id} of our own?
           */
          if (!session._closing) {
            "DEL";
          }
          session.emit("close", hadError);
        });

        tunnel.on("error", function(err) {
          session.emit("error", err);
        });

        tunnel.on("data", function() {
          session.emit("data");
        });

        tunnel.on("idle", function() {
          session.emit("idle");
        });

        tunnel.on("local:error", function(err, data) {
          errorHandler.dispatch(err, data.local, data.remote);
          session.emit("local:error", err, data);
        });

        tunnel.on("remote:error", function() {
          session.emit("remote:error");
        });

        callback(null, response);

        session.emit("start");

        tunnel.connect();
      });

    });
    return session;
  },

  close: _close("disconnect"),

  timeout: _close("timeout"),

  destroy: function(session) {
    session._tunnel.destroy();
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
        // @TODO handle
        console.log("ERROR", err.message);
        return callback(err);
      }

      return callback(null, preferences);
    });
  },

  auth: function(params, callback) {
    var client = getClient();

    client.post("/auth", params, function(err, response) {
      if (err) {
        console.log("ERROR", err);
        return callback(err);
      }

      return callback(null, response);
    });
  },

  register: function(params, callback) {
    var client = getClient();

    client.post("/signup", params, callback);
  },

  details: function(token, callback) {
    var client = getClient();

    var params = {
      key: token
    };

    client.get("/details", params, function(err, response) {
      if (err) {
        console.log("ERROR", err);
        return callback(err);
      }

      return callback(null, response);
    });
  },

  config: config
};
