var config  = require("./config");
// handy internal debugging
var debug   = require("debug")("finch:core:client");
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
var macaddress = require("macaddress");
var crypto = require("crypto");
// any proxy settings to worry about?
var proxy;

var CLOSE_TIMEOUT = 5e3;
var DEFAULT_IDLE_TIMEOUT = 36e5;
var MAX_RETRY_COUNT = 200;

function reset(session) {
  session._error = null;
  session._revoking = null;
  session._closing = false;
  session._numRetries = MAX_RETRY_COUNT;
}

function shouldRetry(session) {
  if (!session.shouldRetry || session._closing) {
    return false;
  }

  if (session._numRetries <= 0) {
    return false;
  }

  session._numRetries --;
  return true;
}

function retryLevel(level) {
  return ["client-authentication", "client-timeout"].indexOf(level) === -1;
}

function translateServerError(level) {
  switch (level) {
    case "client-socket":
      return "Server unavailable";

    case "client-authentication":
      return "Authentication failed";

    case "client-timeout":
      return "Could not connect";

    default:
      return level;
  }
}

function getClient() {
  return new Client({
    url: config.api.url,
    path: config.api.path,
    proxy: proxy
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

  client.del("/connections", params, callback);
}

/**
 * This is a user initiated close; it should never be invoked when
 * deciding to close the tunnel internally (i.e. to to error or revocation)
 */
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

    debug("Closing session " + session.connection.id);

    reset(session);

    session._closing = true;
    session.emit("closing");
    // in case we had a retry or idle timer in progress
    session._tunnel.clearHandlers();

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
    // @NOTE: be careful; connect isn't reliable as
    // it can be emitted even when the server is down
    session.emit("connect");
  });

  tunnel.on("ready", function(err) {
    // clear down some internal markers which otherwise could hang
    // around between retries
    reset(session);
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
    debug("Secure connection closed");

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
        level: level,
        message: translateServerError(level),
        willRetry: false
      };

      // levels so far:
      // client-authentication, i.e. rejected context
      // client-socket, i.e. server unavailable
      // client-timeout, i.e. server probably blocked

      if (retryLevel(level) && shouldRetry(session)) {
        debug("Session closed with error; will retry anyway");
        tunnel.retry();
        closeInfo.willRetry = true;
      } else {
        debug("Session closed with error %s; not retrying", level);

        deleteConnection(session, "connection-error", function(err) {
          if (err) {
            debug("Could not clean up connection", err);
          } else {
            debug("Connection cleaned up successfully");
          }
        });
      }

    } else if (!session._closing) {
      /**
       * We can end up in this situation if the server closes our connection cleanly
       * but we didn't ask it to. As such if retries are disabled we need to make
       * sure we try and clean up the connection from an API point of view.
       *
       * Arguably the API cleanup here isn't necessary; the server could/should perhaps
       * do this instead except for the fact it doesn't know the difference between
       * a loss of connection and the end of one
       */
      closeInfo = {
        reason: "unexpected",
        message: "Connection lost",
        willRetry: false
      };

      if (shouldRetry(session)) {
        debug("Session closed unexpectedly; will retry");
        closeInfo.willRetry = true;
        tunnel.retry();
      } else {
        debug("Session closed unexpectedly; attempting cleanup");

        deleteConnection(session, "unknown-error", function(err) {
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

  macaddress.one(function(err, mac) {

    var client = getClient();
    var singleForward = false;

    // allow a single forward
    if (options.forward) {
      singleForward = true;
    }

    var params = {
      consumer_id: options.consumer_id,
      version: version,
      os_type: os.type(),
      os_platform: os.platform(),
      os_arch: os.arch(),
      os_release: os.release(),
      mac: crypto.createHash("sha1").update(mac).digest("hex"),
      forwards: options.forwards,
      key: options.key
    };

    if (options.edgy) {
      params.edgy = options.edgy;
    }

    if (options.cluster) {
      params.cluster = options.cluster;
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
      var connection = response.connection;

      debug("Connection ID: %s", connection.id);

      var tunnel = new Tunnel({
        id: connection.id,
        forwards: connection.forwards,
        host: connection.host,
        port: connection.sshPort,
        user: connection.user,
        key: connection.key,
        forwardPort: connection.forwardPort,
        keepalive: options.keepalive
      });

      if (options.timeout) {
        // convert a strict boolean into a sensible default
        if (options.timeout === true) {
          options.timeout = DEFAULT_IDLE_TIMEOUT;
        }
        tunnel.timeout = options.timeout;
        debug("Setting tunnel timeout of " + tunnel.timeout);
      }

      // @TODO: edgy only
      if (options.retry) {
        session.shouldRetry = true;
      }

      reset(session);

      session.connection = response.connection;
      // private metadata, effectively (even though it's leaked!)
      session._tunnel    = tunnel;
      session._key       = options.key;

      var forwards = response.connection.forwards;
      var filtered = [];

      for (var i = 0, j = forwards.length; i < j; i++) {
        var f = forwards[i];
        var shortUrl = f.subdomain + "." +  response.connection.domain;
        var url = config.proxy.protocol + "://" + shortUrl + config.proxy.suffix;
        if (f.path) {
          url += "/" + f.path;
        }
        var forward = {
          // https://foo.usefinch.com/path/here
          url: url,
          // foo.usefinch.com
          shortUrl : shortUrl,
          // not altered; just nice to return back to the caller
          title: f.title,
          // needed to key a connectionId:subdomain together for updates
          subdomain: f.subdomain,
          // clients need to know about these to keep their UI up-to-date
          rewrite_links: f.rewrite_links,
          restrict_path: f.restrict_path,
          synchronize: f.synchronize
        };

        filtered.push(forward);
      }

      // watch it; references ahoy here
      if (singleForward) {
        session.forward = filtered[0];
        response.forward = filtered[0];
      } else {
        session.forwards = filtered;
        response.forwards = filtered;
      }

      bindListeners(session, tunnel);

      callback(null, response);

      session.emit("start");

      tunnel.connect();
    });
  });
}

module.exports = {
  forward: function(options, callback) {

    var session = new Session();

    // @TODO: parse/validate options first...

    if (["ssh", "websocket"].indexOf(options.protocol || "") === -1) {
      debug("Warning: defaulting to SSH protocol. Please specify with options.protocol. Valid options are 'ssh' and 'websocket'");
      options.protocol = "ssh";
    }

    if (options.forward) {
      options.forwards = [options.forward];
    }

    StaticManager.start(options.forwards, function(err, servers, forwards) {
      if (err) {
        return callback(err);
      }

      // re-assign our forwards just in case the static manager has adjusted
      // them a little bit
      options.forwards = forwards;
      if (options.forward) {
        options.forward = forwards[0];
      }

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

  signup: function(params, callback) {
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

  config: config,

  // @TODO: the rest of core isn't stateful, and neither
  // should this be. But how do we make our other methods
  // like auth, details etc stateless?
  setProxy: function(_proxy) {
    debug("setProxy(%s)", _proxy);
    proxy = _proxy;
  },

  update: function(params, callback) {
    var client = getClient();
    client.put("/connections", params, callback);
  }
};
