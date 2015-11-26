/*global fis*/
/*
 * 精简打包逻辑，适配特定的业务场景
 */

var DEF_CONF = {
    // 脚本占位符
    scriptPlaceHolder: '<!--SCRIPT_PLACEHOLDER-->',

    // 样式占位符
    stylePlaceHolder: '<!--STYLE_PLACEHOLDER-->',

    // 资源占位符
    resourcePlaceHolder: '<!--RESOURCEMAP_PLACEHOLDER-->',

    output: 'pkg/${id}_min.js',

    // 自动打包资源
    autoPack: false,

    ignore: [], // 不打包的模块

    ignoreDict: {},

    outputResourceMapToMainJs: false,
    lib: [], // 指定公共库
    libDict: {},

    // css 打包成一个文件，适合单页面应用
    cssAllInOne: false,
    // css 内嵌到html中
    cssInline: false,
    // 所有同步js打包成一个文件
    jsAllInOne: false,
    // common css，业务自行处理打包，其他打成一个page包
    commonCssGlob: /\/?common\//
};


var _ = fis.util;
var Page = require('./lib/page');

module.exports = function(ret, pack, settings) {


    var files = ret.src,
        conf = _.assign({}, DEF_CONF, settings);

    conf.idMaps = fis.get('idMaps') || {};
    Page.combineCache = {};

    (conf.ignore || []).forEach(function(ignore) {
        conf.ignoreDict[conf.idMaps[ignore] || ignore] = 1;
    });
    (conf.lib || []).forEach(function(lib) {
        conf.libDict[conf.idMaps[lib] || lib] = 1;
    });

    var urlmapping = ret.urlmapping = {};
    Object.keys(files).forEach(function(subpath) {
        var file = files[subpath];
        if (file.release) {
            urlmapping[file.getUrl()] = file;
        }
    });

    Object.keys(files).forEach(function(subpath) {
        var file = files[subpath];
        if (file.isHtmlLike && !file.page) {
            file.page = new Page(file, ret, conf); // 实例化一个页面
        }
    });

};
