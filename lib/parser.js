var debug = require("debug")("finch:core:parser");

module.exports = {
  parseString: function(input) {
    var proto;
    var host;
    var port;
    var path;
    var ssl;
    var hostname;

    // standard parse
    // start off with "friendly" string searches

    var matches = input.match(/^(https?):\/\/([\w\-\.]+)(:([\w\-\.]+))?(\/([^\s]+))?/);
    if (matches) {
      proto = matches[1];
      host = matches[2];
      // we always ignore [3]; it's just the port with a colon in front of it
      port = matches[4];
      // we always ignore [5]; it's just the path with a slash in front of it
      path = matches[6] || null;
      if (!port) {
        port = proto === "https" ? 443 : 80;
      } else {
        port = parsePort(port, input);
      }

      ssl = proto === "https";

      // always take the host machine as the host header in simple mode
      hostname = host;

      if ((proto === "https" && port === 80) || (proto === "http" && port === 443)) {
        var targetProto = proto === "https" ? "http" : "https";
        var error = "Sorry, port " + port + " is assumed to be " + targetProto + ", but you've specified " + proto + "\nYou can override this by using the --advanced switch";
        throw new Error(error);
      }
    } else {
      // just try and split the string
      var parts = input.split(":");
      host = parseHost(parts[0], input);
      port = parsePort(parts[1], input);
      path = null;
      ssl = port === 443;
      hostname = host;
    }
    var parsed = {
      private_host: host,
      private_port: port,
      forwarded_hostname: hostname,
      // @TODO forget this, just use "proto" instead
      ssl: ssl,
      path: path
    };

    Object.keys(parsed).forEach(function(key) {
      debug("Parsed: %s => %s", key, parsed[key]);
    });

    return parsed;
  }
};

function parsePort(port) {
  if (!port) {
    return 80;
  }
  if (port.search(/^\d+$/) === 0) {
    return +port;
  }
  throw new Error("'" + port + "' does not appear to be a valid port number");
}

function parseHost(host, input) {
  if (host) {
    return host;
  }
  throw new Error("Please specify a host (input string: '" + input + "')");
}
