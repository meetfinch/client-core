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

var CLOSE_TIMEOUT = 5e3;
var DEFAULT_IDLE_TIMEOUT = 36e5;
var MAX_RETRY_COUNT = 100;

function reset(session) {
  session._error = null;
  session._revoking = null;
  session._closing = false;
  session._numRetries = MAX_RETRY_COUNT;
}

function shouldRetry(session) {
  if (!session.shouldRetry) {
    return false;
  }

  if (session._numRetries <= 0) {
    return false;
  }

  session._numRetries --;
  return true;
}

function translateServerError(level) {
  switch (level) {
    case "client-socket":
      return "Server unavailable";

    case "client-authentication":
      return "Authentication failed";

    default:
      return level;
  }
}

function getClient() {
  return new Client({
    url: config.api.url,
    path: config.api.path
  });
}

function deleteConnection(session, reason, callback) {
  var client, params;

  client = getClient();

  if (!session) {
    debug("WARN: no session object passed to close, ignoring");
    return;
  }

  params = {
    id: session.connection.id,
    reason: reason,
    key: session._key
  };

  session._closing = true;
  session.emit("closing");

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

    if (!session.connection) {
      debug("Ignoring close request; session has no connection object");
      return callback();
    }

    /**
     * First of all close the connection from a Finch(server) point of
     * view; the most important thing is to make sure no more traffic
     * passes through it from a billing perspective
     */
    deleteConnection(session, reason, function(err) {
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
    // clear down some internal markers which otherwise could hang
    // around between retries
    reset(session);

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
          session.emit("revoking");
          session._revoking = true;
          session._tunnel.close(function() {
            // no-op?
          });
          break;

        case "ping":
          // standard keepalive ping, no-op
          break;

        default:
          debug("Unhandled ping response type: " + type);
          break;
      }
    });
  });

  tunnel.on("close", function(hadError) {
    var closeInfo;
    debug("Secure connection closed " + (hadError ? "with error" : "without error"));

    if (session._revoking) {
      closeInfo = {
        reason: "revoked",
        message: "Connection revoked!",
        willRetry: false
      };
    } else if (session._error) {
      var level = session._error.level;
      closeInfo = {
        reason: "error",
        message: translateServerError(level),
        willRetry: false
      };

      // levels so far:
      // client-authentication, i.e. rejected context
      // client-socket, i.e. server unavailable

      if (level !== "client-authentication" && shouldRetry(session)) {
        debug("Session closed with error; will retry anyway");
        tunnel.retry();
        closeInfo.willRetry = true;
      }

    } else if (!session._closing) {
      closeInfo = {
        reason: "unexpected",
        message: "Connection lost",
        willRetry: false
      };

      if (shouldRetry(session)) {
        debug("Session closed unexpectedly; will retry");
        tunnel.retry();
        closeInfo.willRetry = true;
      } else {
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
    }

    session.emit("close", closeInfo);
  });

  tunnel.on("error", function(err) {
    session._error = err;
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
      // @TODO should we emit session.close or something?
      // to be fair we haven't emitted any start events or anything
      // if we fall in here so there's nothing to cancel out, but it's worth
      // re-evaluating whether we *should* have emitted by now.
      //
      // I understand why nothing has been emitted - because unless this
      // call succeeds we have no session. But calling clients don't know
      // that; they just ask for finch.forward() and get a session back
      // so it should probably emit events which reflect the API call
      // as well as actually setting up a tunnel
      return callback(err, response);
    }

    debug("Connection ID: " + response.connection.id);

    var tunnel = new Tunnel(response.connection);

    if (options.timeout) {
      // convert a strict boolean into a sensible default
      if (options.timeout === true) {
        options.timeout = DEFAULT_IDLE_TIMEOUT;
      }
      tunnel.timeout = options.timeout;
      debug("Setting tunnel timeout of " + tunnel.timeout);
    }

    if (options.retries) {
      session.shouldRetry = true;
    }

    reset(session);

    session.connection = response.connection;
    session.forwards   = [];
    // private metadata, effectively (even though it's leaked!)
    session._tunnel    = tunnel;
    session._key       = options.key;

    var forwards = response.connection.forwards;

    for (var i = 0, j = forwards.length; i < j; i++) {
      var f = forwards[i];
      var shortUrl = f.subdomain + "." +  response.connection.domain;
      var url = config.proxy.protocol + "://" + shortUrl + config.proxy.suffix;
      if (f.path) {
        url += "/" + f.path;
      }
      var forward = {
        url: url,
        // sometimes we don't care about protocol or port suffix
        shortUrl : shortUrl,
        title: f.title
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

    client.get("/details", params, callback);
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
