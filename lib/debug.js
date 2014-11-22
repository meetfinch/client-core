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
    return console.error(("" + ts + ": " + str));
  };

  argPos = process.argv.indexOf("--debug");

  if (argPos !== -1) {
    process.argv.splice(argPos, 1);
    _debug = true;
    debug("--debug flag present, enabling debug mode");
  } else if (process.env.DEBUG) {
    _debug = true;
    debug("debug option present, enabling debug mode");
  }

  module.exports = debug;

}).call(this);
