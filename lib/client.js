var Client, debug, querystring;

querystring = require("querystring");

debug = require("./debug");

module.exports = Client = (function() {
  function Client(options) {
    this.options = options;
    this.url = require("url").parse(this.options.url);
    this.path = this.options.path || "";
    debug("API base path: " + this.options.url + this.path);
  }

  Client.prototype.get = function(url, query, callback) {
    return this.request("GET", url, query, callback);
  };

  Client.prototype.del = function(url, query, callback) {
    return this.request("DELETE", url, query, callback);
  };

  Client.prototype.post = function(url, query, callback) {
    return this.request("POST", url, query, callback);
  };

  Client.prototype.request = function(method, url, query, callback) {
    var headers, key, length, options, params, path, req;
    if (query == null) {
      query = {};
    }
    if (query.key) {
      debug("Authenticating with API key " + query.key);
      key = "Basic " + (new Buffer(query.key).toString("base64"));
      delete query.key;
    }
    if (method === "POST") {
      params = JSON.stringify(query);
      length = Buffer.byteLength(params, "utf8");
      headers = {
        "Content-Type": "application/json",
        "Content-Length": length
      };
      path = url;
    } else {
      params = querystring.stringify(query);
      headers = {};
      path = "" + url + "?" + params;
    }
    if (key) {
      headers["Authorization"] = key;
    }
    path = "" + this.path + path;
    options = {
      hostname: this.url.hostname,
      port: this.url.port,
      path: path,
      method: method,
      headers: headers
    };
    debug("" + method + " " + this.url.protocol + "//" + this.url.hostname + ":" + this.url.port + path);
    req = require(this.url.protocol === "https:" ? "https" : "http").request(options, function(res) {
      var response, statusCode;
      debug("API response start (" + res.statusCode + ")");
      response = "";
      statusCode = res.statusCode;
      headers = res.headers;
      res.setEncoding("utf8");
      res.on("data", function(d) {
        return response += d;
      });
      return res.on("end", function() {
        var e, err;
        debug("API response end");
        if (statusCode >= 400) {
          err = {
            statusCode: statusCode
          };
        }
        if (headers["content-type"] && headers["content-type"].search(/application\/json/) !== -1) {
          debug("Response content type is JSON, attempting to parse");
          try {
            response = JSON.parse(response);
          } catch (_error) {
            e = _error;
            debug("Caught error parsing JSON response: " + e);
            response = {};
          }
        }
        return callback(err, response);
      });
    });
    req.on("error", function(err) {
      debug("Caught response error: " + err);
      return callback(err);
    });
    if (method === "POST") {
      req.write(params);
    }
    return req.end();
  };

  return Client;

})();
