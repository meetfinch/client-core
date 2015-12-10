var Template = require("../../template");

var ErrorHandler = function() {

};

ErrorHandler.prototype.dispatch = function(err, local, remote) {
  var body, response, title;

  // disconnect the streams; we'll respond manually
  remote.unpipe(local);
  local.unpipe(remote);

  switch (err.code) {
    // most likely the host/port combo is invalid
    case "ECONNREFUSED":
      title = "Connection refused";
      break;

    // most likely URL cannot be resolved
    case "ENOTFOUND":
    // most likely IP address can't be reached
    case "EHOSTUNREACH":
    case "ENETUNREACH":
    // probably a totally invalid IP
    case "EINVAL":
      title = "Address not found";
      break;

    // probably a valid address but can't connect; firewalled perhaps?
    case "ETIMEDOUT":
      title = "Connection timeout";
      break;

    default:
      title = "Unknown error";
  }

  body = Template.render("errors/local", {
    title: title
  });

  response = "HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\nContent-Type: text/html; charset=utf8\r\nContent-Length: " + body.length + "\r\n\r\n" + body;
  return remote.write(response);
};

module.exports = ErrorHandler;
