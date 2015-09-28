/**
 * 打包插件。用法：
 *
 */
'use strict';
var DEF_CONF = {
    // 脚本占位符
    scriptPlaceHolder: '<!--SCRIPT_PLACEHOLDER-->',

    // 样式占位符
    stylePlaceHolder: '<!--STYLE_PLACEHOLDER-->',

    // 资源占位符
    resourcePlaceHolder: '<!--RESOURCEMAP_PLACEHOLDER-->',

    output: 'pkg/${id}_min.js',

    // 自动分析资源并在页面中载入
    autoLoad: true,

    // 自动打包资源
    autoPack: false,

    lib: ['jquery', 'zepto', 'common', 'qqapi'], // 当做 library 使用，会单独打成一个文件

    ignore: [], // 不打包的模块

    libDict: {},

    ignoreDict: {},

    cssInline: false

};


var _ = fis.util;
var Page = require('./lib/page');

module.exports = function(ret, pack, settings, opt) {
    if (!_.isEmpty(pack)) { // TODO 暂时不支持官方默认的手动配置打包
        return;
    }



    var files = ret.src;
    var conf = _.assign({}, DEF_CONF, settings);

    (conf.lib || []).forEach(function(lib) {
        conf.libDict[lib] = 1;
    });
    (conf.ignore || []).forEach(function(ignore) {
        conf.ignoreDict[ignore] = 1;
    });

    Object.keys(files).forEach(function(subpath) {
        var file = files[subpath];

        if (file.isHtmlLike && !file.page) {
            file.page = new Page(file, ret, conf); // 实例化一个页面
        }
    });

};
