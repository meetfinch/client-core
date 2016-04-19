module.exports = {
  connect: function(port, host, options) {
    var stream = {
      // mimic a writable stream. We won't ever actually stream anything, just store the buffer before calling fetch
      // we have to implement these various things because we call .pipe() on this object, which internally
      // sets up various on / once listeners and calls .write

      _write: function(chunk, enc, next) {
        console.log("private _write", arguments);
      },

      write: function() {
        console.log("public write", arguments);
      },

      on: function() {
        console.log("on", arguments);
      },

      once: function() {
        console.log("once", arguments);
      },

      pipe: function(writeStream) {
        console.log("pipe", writeStream);
      },

      emit: function() {
        console.log("emit", arguments);
      }
    };

    return stream;
  },

};
