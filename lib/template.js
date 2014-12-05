var cache, fs, read, assets;

assets = __dirname + "/../assets/templates";

fs = require("fs");

cache = {};

read = function(tpl) {
  var path = tpl + ".html";
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
    templateData = read(assets + "/" + tpl);
    for (key in params) {
      value = params[key];
      regex = new RegExp("{{" + key + "}}", "g");
      templateData = templateData.replace(regex, value);
    }
    return templateData;
  }
};
