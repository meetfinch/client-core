var StaticServer, asyncSeries;

StaticServer = require("./server");

module.exports = {
  start: function(forwards, callback) {
    var servers, startServer;
    servers = [];
    startServer = function(forward, idx, done) {
      var server;

      // to preserve array indeces we try and 'start' all
      // forwards, so bail early if they're not relevant
      if (!forward["static"]) {
        return setImmediate(done);
      }
      server = new StaticServer(forward.directory);
      server.listen(function(err) {
        if (err) {
          return done(err);
        }
        forward.private_host = "localhost";
        forward.private_port = server.port;
        return done();
      });

      // immediately take the server out of the event loop;
      // this makes our cleanup process a lot easier!
      server.unref();

      // keep track of the server so we can invoke the outer
      // callback with an array of all those started, if needs be
      return servers.push(server);
    };
    return asyncSeries(forwards, startServer, function(err) {
      if (err) {
        return callback(err);
      }
      return callback(null, servers, forwards);
    });
  }
};

// crude substitute for async.eachSeries
asyncSeries = function(collection, invokable, done) {
  var iterate, stop;
  stop = collection.length;
  return (iterate = function(idx) {
    if (idx >= stop) {
      return done();
    }
    return invokable(collection[idx], idx, function(err) {
      if (err) {
        return done(err);
      }
      return iterate(idx + 1);
    });
  })(0);
};
