module.exports = {
  connect: function(port, host, options) {
    var stream = {
      _write: function(chunk, enc, next) {
        console.log(arguments);
      }
    };

    return stream;
  }
};
