/**
 * @require './main.css'
 * @author jero
 * @date 2015-09-12
 */
var dialog = require('dialog');
var slider = require('slider');
var tab = require('tab');
var version = require('versions@0.1.0');
// var common = require('common');
var testModule = require('test_module');
var header = require('index/header');

console.log(dialog, slider, tab, version, testModule, header);

require.async('./async', function(async) {
    async();
});