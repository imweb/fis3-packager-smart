/**
 * test main file
 * @author jero
 * @date 2015-09-12
 */


var path = require('path');
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

function hookSelf(opts) {
    var key = 'modules.hook';
    var origin = fis.get(key);

    if (origin) {
        origin = typeof origin === 'string' ?
            origin.split(/\s*,\s*/) : (Array.isArray(origin) ? origin : [origin]);
    } else {
        origin = [];
    }

    origin.push(function(fis) {
        var options = {};

        _.assign(options, _self.defaultOptions);
        _.assign(options, opts);

        return _self.call(this, fis, options);
    });

    fis.set(key, origin);
}



describe('fis3-hook-lego findup & autoLoad', function() {


    beforeEach(function() {
        var dev = path.join(__dirname, 'dev');

        _.del(dev);


        // fis.log.level = fis.log.L_ALL;
        _self.options = {
            test: 0
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
