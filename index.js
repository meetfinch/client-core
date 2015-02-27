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

function deleteConnection(session, reason, callback) {
  var client, params;

  client = getClient();

  params = {
    id: session.connection.id,
    reason: reason,
    key: session._key
  };

  session._closing = true;

  client.del("/connections", params, callback);
}

function _close(reason) {
  return function(session, callback) {

    if (!session) {
      return callback(new Error("No session object provided"));
    }

    if (session._closing) {
      debug("Ignoring close request; session is already closing");
      return callback();
    }

    /**
     * First of all close the connection from a Finch(server) point of
     * view; the most important thing is to make sure no more traffic
     * passes through it from a billing perspective
     */
    deleteConnection(session, "disconnect", function(err) {
      if (err) {
        return callback(err);
      }

      /**
       * Next set up a timer to destroy the tunnel if it doesn't shutdown
       * cleanly within a reasonable timeframe. This isn't so bad but we'd
       * still rather not unless we have to
       */
      var handler = setTimeout(function() {
        debug("Tunnel close took too long; destroying");
        session._tunnel.destroy();
        callback();
      }, CLOSE_TIMEOUT);

      /**
       * Finally, initiate a clean tunnel shutdown
       */
      session._tunnel.close(function(err) {
        debug("Tunnel closed cleanly");
        clearTimeout(handler);
        callback(err);
      });
    });
  };
}

function bindListeners(session, tunnel) {
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
        debug("Ignoring invalid ping");
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
    debug("Secure connection closed");
    /**
     * @TODO did we know about this close, or do we need to
     * handle it and initiate a DEL /connections{id} of our own?
     */
    if (!session._closing) {
      debug("Session closed unexpectedly; attempting cleanup");

      // @TODO need a better 'reason' here
      deleteConnection(session, "disconnect", function(err) {
        if (err) {
          debug("Could not clean up connection");
        } else {
          debug("Connection cleaned up successfully");
        }
      });
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
}

function startSession(session, options, callback) {
  var client = getClient();

  var params = {
    consumer_key: options.consumer_key,
    version: version,
    os_type: os.type(),
    os_platform: os.platform(),
    os_arch: os.arch(),
    os_release: os.release(),
    forwards: options.forwards,
    key: options.key
  };

  if (options.edgy) {
    params.edgy = options.edgy;
  }

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
    session.forwards   = [];

    var forwards = response.connection.forwards;

    for (var i = 0, j = forwards.length; i < j; i++) {
      var f = forwards[i];
      var forward = {
        url: config.proxy.protocol + "://" + f.subdomain + "." + response.connection.domain + config.proxy.suffix
      };
      session.forwards.push(forward);
    }

    bindListeners(session, tunnel);

    callback(null, response);

    session.emit("start");

    tunnel.connect();
  });
}

module.exports = {
  forward: function(options, callback) {

    var session = new Session();

    // @TODO: parse/validate options first...

    StaticManager.start(options.forwards, function(err, servers, forwards) {
      if (err) {
        return callback(err);
      }

      // re-assign our forwards just in case the static manager has adjusted
      // them a little bit
      options.forwards = forwards;

      startSession(session, options, callback);

    });

    return session;
  },

  close: _close("disconnect"),

  timeout: _close("timeout"),

  destroy: function(session) {
    session._tunnel.destroy();
  },

  /**
   * @TODO: arguable that this shouldn't live in core
   * until we can figure out a way to do it using oauth
   */
  auth: function(params, callback) {
    var client = getClient();

    client.post("/auth", params, callback);
  },

  /**
   * @TODO: arguable that this shouldn't live in core
   * until we can figure out a way to do it using oauth
   */
  register: function(params, callback) {
    var client = getClient();

    client.post("/signup", params, callback);
  },

  /**
   * Swap a token for an overview of the current user
   * Similar to URLs like /me et al
   */
  details: function(token, callback) {
    var client = getClient();

    var params = {
      key: token
    };

    client.get("/details", params, function(err, response) {
      if (err) {
        return callback(err);
      }

      return callback(null, response);
    });
  },

  /**
   * @TODO: don't expose this
   */
  request: function(method, url, params, callback) {
    var client = getClient();
    client[method.toLowerCase()](url, params, callback);
  },

  config: config
};
