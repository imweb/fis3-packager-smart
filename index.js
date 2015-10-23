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

    packToIgnore: [],

    ignore: [], // 不打包的模块

    libDict: {},

    ignoreDict: {},

    addPackTo: [],

    cssAllInOne: false,

    cssInline: false

};


/*
* 平台问题
* 1. common 一个包
* 2. 主逻辑一个包
* 3. 同步/异步问题
 */


var _ = fis.util;
var Page = require('./lib/page');

module.exports = function(ret, pack, settings, opt) {


    var files = ret.src,
        conf = _.assign({}, DEF_CONF, settings),
        packTo = [];
        
    Object.keys(pack).forEach(function(key) {
        packTo = packTo.concat(pack[key])
    });

    // subpath  => id
    packTo.forEach(function(subpath, index) {
        packTo[index] = files[subpath].id;
    });

    conf.packTo = packTo;


    conf.pack = pack;

    (conf.lib || []).forEach(function(lib) {
        conf.libDict[lib] = 1;
    });
    (conf.ignore || []).forEach(function(ignore) {
        conf.ignoreDict[ignore] = 1;
    });

    conf.idMaps = fis.get('idMaps') || {};
    Page.combineCache = {};

    Object.keys(files).forEach(function(subpath) {
        var file = files[subpath];
        if ((file.isHtmlLike || file.ext === '.vm') && !file.page) {
            file.page = new Page(file, ret, conf); // 实例化一个页面
        }
    });

};
