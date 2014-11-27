var Preferences, algorithm, crypto, cryptoKey, debug, encoding, fs;

crypto = require("crypto");

fs = require("fs");

debug = require("./debug");


/*
 * note: the point about the encryption here is that it is simply used to
 * provide a layer of protection should the user's ~/.finch information somehow
 * be stolen by an attacker. It won't slow them down long but at worst they can
 * simply decrypt a user's API key, which a user will have hopefully revoked by
 * then
 */

cryptoKey = "1ltVktcxqipCpU27hhkox5aEcUaZGYLj";

algorithm = "aes256";

encoding = "base64";

module.exports = Preferences = (function() {
  Preferences.prototype.data = {};

  Preferences.prototype.exists = false;

  function Preferences(path) {
    this.path = path;
  }

  Preferences.prototype.clear = function() {
    this.data = {};
  };

  Preferences.prototype.save = function(done) {
    var cipher, str, rawToken;

    rawToken = this.data.token;

    if (rawToken) {
      cipher = crypto.createCipher(algorithm, cryptoKey);
      str = cipher.update(rawToken, "utf8", encoding);

      this.data.token = "" + str + (cipher.final(encoding));
    }

    fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2));

    if (rawToken) {
      this.data.token = rawToken;
    }
  };

  Preferences.prototype.load = function(done) {
    var data, decipher, e, str, token;
    this.exists = fs.existsSync(this.path);
    if (!this.exists) {
      return done();
    }
    debug("Reading configuration path");
    data = fs.readFileSync(this.path);
    debug("Parsing configuration data");

    data = JSON.parse(data);

    if (data.token) {
      decipher = crypto.createDecipher(algorithm, cryptoKey);
      try {
        debug("Decrypting token");
        str = decipher.update(data.token, encoding, "utf8");
        token = "" + str + (decipher.final("utf8"));
      } catch (_error) {
        e = _error;
        return done(new Error("Could not decrypt token"));
      }
      data.token = token;
    }

    this.data = data;
    return done();
  };

  Preferences.prototype.get = function(key) {
    if (!this.data) {
      return null;
    }
    return this.data[key];
  };

  Preferences.prototype.set = function(key, value) {
    if (!this.data) {
      return null;
    }

    this.data[key] = value;

    return this;
  };

  return Preferences;

})();
