var ss = require("socket.io-stream");

module.exports = {
  connect: function(port, host, options) {
    var writeStream;
    var stream = {
      // mimic a writable stream. We won't ever actually stream anything, just store the buffer before calling fetch
      // we have to implement these various things because we call .pipe() on this object, which internally
      // sets up various on / once listeners and calls .write

      /*
      _write: function(chunk, enc, next) {
        console.log("private _write", arguments);
      },
      */

      write: function(data) {
        console.log("public write", arguments);

        fetch("http://localhost:8888/")
        .then(function(response) {
          var reader = response.body.getReader();
          return reader.read().then(function handleChunk(result) {
            if (result.done) {
              return;
            }
            writeStream.write(new ss.Buffer(result.value));
            return reader.read().then(handleChunk);
          });
        })
        .then(function() {
          console.log("done reading data");
          writeStream.end();
        })
        .catch(function(err) {
          console.log(err.message);
        });
      },

      on: function() {
        console.log("on", arguments);
      },

      once: function() {
        console.log("once", arguments);
      },

      pipe: function(_writeStream) {
        console.log("pipe", _writeStream);
        writeStream = _writeStream;
      },

      emit: function() {
        console.log("emit", arguments);
      },

      end: function() {
        console.log("end", arguments);
      }
    };

    return stream;
  },

};
