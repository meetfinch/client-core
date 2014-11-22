var cache, fs, read;

fs = require("fs");

cache = {};

read = function(tpl) {
  var path;
  path = "" + __dirname + "/../assets/templates/" + tpl + ".html";
  if (!cache[tpl]) {
    cache[tpl] = fs.readFileSync(path, "utf8");
  }
  return cache[tpl];
};

module.exports = {
  render: function(tpl, params) {
    var key, regex, templateData, value;
    if (params === null) {
      params = {};
    }
    templateData = read(tpl);
    for (key in params) {
      value = params[key];
      regex = new RegExp("{{" + key + "}}", "g");
      templateData = templateData.replace(regex, value);
    }
    return templateData;
  }
};
