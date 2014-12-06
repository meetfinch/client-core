(function() {
  var argPos, debug, _debug;

  require("colors");

  _debug = false;

  debug = function(str) {
    var ts;
    if (str == null) {
      str = null;
    }
    if (str === null) {
      return _debug;
    }
    if (!_debug) {
      return;
    }
    ts = new Date;
    return console.error(("" + ts + ": " + str).grey);
  };

  argPos = process.argv.indexOf("--debug");

  if (argPos !== -1) {
    process.argv.splice(argPos, 1);
    _debug = true;
  } else if (process.env.DEBUG) {
    _debug = true;
  }

  if (_debug) {
    debug("debug option present, enabling debug mode");
    debug("node -v: " + process.versions.node);
  }

  module.exports = debug;

}).call(this);
