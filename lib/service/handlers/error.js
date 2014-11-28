var path = require("path");

var Template = require("../../template");

var ErrorHandler = function(options) {
  this.assetPath = options.assets;
};

ErrorHandler.prototype.dispatch = function(err, local, remote) {
  var body, response, title;

  // disconnect the streams; we'll respond manually
  remote.unpipe(local);
  local.unpipe(remote);

  switch (err.code) {
    case "ECONNREFUSED":
      title = "Connection Refused";
      break;
    case "ENOTFOUND":
      title = "Address Not Found";
      break;
    default:
      title = "Unknown Error";
  }

  var p = path.resolve(this.assetPath, "local");

  body = Template.render(p, {
    title: title
  });

  response = "HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\nContent-Type: text/html; charset=utf8\r\nContent-Length: " + body.length + "\r\n\r\n" + body;
  return remote.write(response);
};

module.exports = ErrorHandler;