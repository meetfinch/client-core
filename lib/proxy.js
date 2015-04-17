var url = require("url");
var debug = require("debug")("finch:core:http");

module.exports = {
  detect: function(parsedUrl) {
    var proxy;
    var envVars = ["HTTP_PROXY", "http_proxy"];

    if (parsedUrl.protocol === "https:") {
      envVars = [].concat(["HTTPS_PROXY", "https_proxy"], envVars);
    }

    for (var i = 0, j = envVars.length; i < j; i++) {
      var key = envVars[i];
      var val = process.env[key];
      if (val) {
        debug("Detected proxy environment setting %s: %s", key, val);
        return url.parse(val);
      }
    }

    return null;
  }
};
