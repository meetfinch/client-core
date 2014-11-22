var Loader, debug, path;

path = require("path");

debug = require("./debug");

module.exports = Loader = (function() {
  function Loader(options) {
    this.env = options.env;
    this.file = options.file;
  }

  Loader.prototype.getPath = function() {
    var extension, final, home;
    if (this.env.NODE_ENV && this.env.NODE_ENV !== "production") {
      extension = "-" + this.env.NODE_ENV;
    } else {
      extension = "";
    }
    home = this.env.USERPROFILE || this.env.HOME;
    debug("First attempt to find home directory: " + home);
    if (!home) {
      if (this.env.HOMEPATH && this.env.HOMEDRIVE) {
        home = "" + this.env.HOMEDRIVE + this.env.HOMEPATH;
        debug("Second attempt to find home directory: " + home);
      } else {
        return null;
      }
    }
    final = path.join(home, "" + this.file + extension);
    debug("Configuration path: " + final);
    return final;
  };

  return Loader;

})();
