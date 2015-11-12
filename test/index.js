/**
 * test main file
 * @author jero
 * @date 2015-09-12
 */


var path = require('path');
var fs = require('fs');
var fis = require('fis3');
var _ = fis.util;
var expect = require('chai').expect;
var _release = fis.require('command-release/lib/release.js');
var _deploy = fis.require('command-release/lib/deploy.js');
var root = path.join(__dirname, 'src');

fis.project.setProjectRoot(root);
var _self = require('../index');

function release(opts, cb) {
    opts = opts || {};

    _release(opts, function(error, info) {
        _deploy(info, cb);
    });
}

describe('fis3-hook-lego findup & autoLoad', function() {


    beforeEach(function() {
        var dev = path.join(__dirname, 'dev');

        _.del(dev);


        // fis.log.level = fis.log.L_ALL;
        _self.options = {
            cssInline: false
        };
        fis.match('::package', {
            packager: _self
        });

        fis.match('*', {
            deploy: fis.plugin('local-deliver', {
                to: dev
            })
        });

        fis.hook('commonjs');
        fis.hook('lego');


        fis.match(/^\/modules\/(.+)\.js$/, {
                isMod: true,
                id: '$1'
            })
            .match(/^\/modules\/((?:[^\/]+\/)*)([^\/]+)\/\2\.(js)$/i, {
                // isMod: true,
                id: '$1$2'
            })
            .match(/^\/lego_modules\/(.+)\.js$/i, {
                isMod: true,
                id: '$1'
            });

        fis.match(/^\/(pages\/.+)\.js$/, {
            isMod: true,
            id: '$1'
        });

    });

    it('lego hook', function(done) {
        fis.on('release:end', function(ret) {


            expect(2).to.equal(2);
        });


        release({
            unique: true
        }, function() {
            done();
            fis.log.info('release complete');
        });
    });
});


describe('fis3-packager-smart pack', function() {


    beforeEach(function() {
        var dist = path.join(__dirname, 'dist');

        _.del(dist);


        // fis.log.level = fis.log.L_ALL;

        _self.options = {
            autoPack: true,
            cssInline: true
        };

        fis.match('::package', {
            packager: _self
        });

        fis.match('*', {
            deploy: fis.plugin('local-deliver', {
                to: dist
            })
        });

        fis.hook('commonjs');


        fis.match(/^\/modules\/(.+)\.js$/, {
                isMod: true,
                id: '$1'
            })
            .match(/^\/modules\/((?:[^\/]+\/)*)([^\/]+)\/\2\.(js)$/i, {
                // isMod: true,
                id: '$1$2'
            })
            .match(/^\/lego_modules\/(.+)\.js$/i, {
                isMod: true,
                id: '$1'
            });

        fis.match(/^\/(pages\/.+)\.js$/, {
            isMod: true,
            id: '$1'
        });

    });

    it('lego hook', function(done) {

        release({
            unique: true
        }, function() {
            expect(fs.existsSync(path.join(root, '../dist', 'pkg/common_min.js'))).to.be.true;
            expect(fs.existsSync(path.join(root, '../dist', 'pkg/pages/index/main_min.js'))).to.be.true;
            expect(fs.existsSync(path.join(root, '../dist', 'pkg/pages/index/main_async_min.js'))).to.be.true;
            done();
            fis.log.info('release complete');
        });
    });
});


// 所有js打包成一个文件
describe('fis3-packager-smart pack - jsAllInOne', function() {

    var dist = path.join(__dirname, 'allInOne');
    beforeEach(function() {
        

        _.del(dist);

        _self.options = {
            autoPack: true,
            cssInline: true,
            jsAllInOne: true
        };

        fis.match('::package', {
            packager: _self
        });

        fis.match('*', {
            deploy: fis.plugin('local-deliver', {
                to: dist
            })
        });

        fis.hook('commonjs');


        fis.match(/^\/modules\/(.+)\.js$/, {
                isMod: true,
                id: '$1'
            })
            .match(/^\/modules\/((?:[^\/]+\/)*)([^\/]+)\/\2\.(js)$/i, {
                // isMod: true,
                id: '$1$2'
            })
            .match(/^\/lego_modules\/(.+)\.js$/i, {
                isMod: true,
                id: '$1'
            });

        fis.match(/^\/(pages\/.+)\.js$/, {
            isMod: true,
            id: '$1'
        });

    });

    it('lego hook', function(done) {

        release({
            unique: true
        }, function() {
            expect(fs.existsSync(path.join(dist, 'pkg/index.html_aio.js'))).to.be.true;
            var content = fs.readFileSync(path.join(dist, 'index.html'));
            expect(/<script\ssrc=\"\/pkg\/index\.html_aio\.js\"><\/script>/.test(content)).to.be.true;
            done();
            fis.log.info('release complete');
        });
    });
});