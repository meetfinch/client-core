var StaticServer, http, nstatic, path, Template;

nstatic = require("node-static");

http = require("http");

path = require("path");

Template = require("../../template");

module.exports = StaticServer = (function() {
  function StaticServer(path) {
    this.path = path;
  }

  StaticServer.prototype.listen = function(done) {
    var file, _path;

    file = new nstatic.Server(this.path);
    _path = this.path;

    this.server = http.createServer(function(req, res) {
      return file.serve(req, res, function(err) {
        var params, tpl;
        if (err) {
          params = {
            error: "" + err.status + "—" + err.message,
            file: path.join(_path, req.url)
          };
          tpl = Template.render("errors/static", params);
          res.writeHead(err.status, {
            "content-type": "text/html"
          });
          return res.end(tpl);
        }
      });
    });

    return this.server.listen(0, (function(_this) {
      return function() {
        _this.port = _this.server.address().port;
        return done();
      };
    })(this));
  };

  StaticServer.prototype.close = function(done) {
    if (done == null) {
      done = function() {};
    }
    return this.server.close(done);
  };

  StaticServer.prototype.unref = function() {
    return this.server.unref();
  };

  return StaticServer;

})();
