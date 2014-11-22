(function() {
  var mode;

  mode = process.env.NODE_ENV || "production";

  module.exports = require(__dirname + "/" + mode + ".json");

}).call(this);
