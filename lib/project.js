/*
 * 处理项目级别common，项目中所有页面都会引入的文件
 * common.css
 * common.js
 */

/* global fis */
var Page = require('./page'),
    _ = fis.util;

function Proj(ret, conf) {
    var self = this;
    self.ret = ret;
    self.conf = conf;
}

_.assign(Proj.prototype, {
    init: function() {

    },
    packCommonCss: function() {

    },
    packCommonjs: function() {

    },
    pages: function() {
        var self = this,
            files = self.ret.src,
            file;
        Object.keys(files).forEach(function(subpath) {
            file = files[subpath];
        });
    }
});



module.exports = Proj;
