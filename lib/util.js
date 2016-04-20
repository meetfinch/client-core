module.exports = {
  parseRequestString: function(req) {
    var head, header, headers, params, request, str, tail, val, _i, _len, _ref, _ref1;
    request = {
      headers: {},
      method: null,
      url: null,
      raw: req
    };
    headers = {};
    _ref = req.split("\r\n"), head = _ref[0], tail = 2 <= _ref.length ? [].slice.call(_ref, 1) : [];
    for (_i = 0, _len = tail.length; _i < _len; _i++) {
      header = tail[_i];
      if (header.indexOf(": ") === -1) {
        continue;
      }
      _ref1 = header.split(": "), str = _ref1[0], val = _ref1[1];
      headers[str.toLowerCase()] = val;
    }
    request.headers = headers;
    params = head.match(/^([A-Z]+) (.+) (HTTP\/\d\.\d)$/);
    if (params) {
      request.method = params[1];
      request.url = params[2];
    }
    return request;
  }
};
