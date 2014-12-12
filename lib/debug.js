(function() {
  var argPos, debug, _debug, _colour;

  _debug  = false;
  _colour = false;

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
    var str = ("" + ts + ": " + str);
    if (_colour) {
      str = str.grey;
    }
    return console.error(str);
  };

  argPos = process.argv.indexOf("--debug");

  if (argPos !== -1) {
    process.argv.splice(argPos, 1);
    _debug = true;
  } else if (process.env.DEBUG) {
    _debug = true;
  }

  if (process.argv.indexOf("--debug-color") !== -1) {
    require("colors");
    _colour = true;
  }

  if (_debug) {
    debug("debug option present, enabling debug mode");
    debug("node -v: " + process.versions.node);
  }

  module.exports = debug;

}).call(this);
