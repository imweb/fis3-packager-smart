/*
 * link 标签已经处理，script标签暂时不处理，各种ignore（loader处理方式）
 */

/*
 * resourceMap 打包到页面的入口脚本中。
 * 问题：由于fis本身的md5机制，getUrl时，就已经生成了md5，后续文件的content操作，不会更新md5
 * 主文件模块的结构
 *
 *     =============================
 *    |                             |
 *    |        resourceMap          |
 *    |                             |
 *     =============================
 *     =============================
 *    |                             |
 *    |        主要依赖模块打包     |
 *    |                             |
 *     =============================
 *     =============================
 *    |                             |
 *    |  define包裹自己，触发回调   |
 *    |                             |
 *     =============================
 *
 * 正确的处理时序：
 * 1. 打包（不要getUrl）
 * 2. resourceMap，loadUrl本身是同步逻辑，不涉及到resourceMap，不用获取url
 * 3. define 插入主入口文件
 * 4. getUrl， md5
 * 5. replace页面和js中的引用
 */
/*global fis*/
var LINE_BREAK = '\r',
    path = require('path'),
    _ = fis.util;


var Page;

// 线上文件不处理
var HTTP_REG = /^https?:\/\//i;

var html = require('./html');


module.exports = Page = function(file, ret, conf) {
    if (!(file && conf)) {
        return;
    }

    this.conf = _.assign({}, conf);

    this.file = file;
    this.ret = ret;
    // 记录当前页面的pkg属性，是包含部分file属性，和全局的ret.pkg区别开
    this.pkg = {};

    this._sync = [];

    this.init();
};


_.assign(module.exports.prototype, {
    init: function() {
        var analysis,
            content,
            resourceMap,
            self = this,
            ret = self.ret,
            conf = self.conf,
            file = self.file;

        analysis = self.analyzeHtmlDepsAndAsync();
        content = file.getContent();
        // 插入css
        content = self.injectCss(content, analysis.cssDeps);

        if (conf.autoPack) {
            // 打包js
            self.generatePackageFile(analysis.depMap);
        } else {
            // dev 模式下，把require.loadUrl替换成require.async
            content = self.replaceLoadUrl(content);
        }
        // 插入script标签
        content = self.injectJs(content, analysis.pageRes);



        // 生成resourceMap
        resourceMap = self.generateSourceMap(analysis);

        // // 插入resourceMap
        content = self.injectResourceMap(content, resourceMap);

        // process loadUrl
        if (conf.autoPack) {
            content = self.processLoadUrl(content, analysis.depMap);
        }

        if (conf.autoPack) {
            content = self.removePlaceholder(content);
            content = self.mergeInlineAssets(content);
        }

        file.setContent(content);

        if (file.useCache) {
            // 注释时，dist 时 watch 有问题
            ret.pkg[file.subpath] = file;
        }
    },

    analyzeHtmlDepsAndAsync: function() {
        var self = this,
            ret = this.ret,
            file = self.file,
            conf = self.conf,
            requires = file.requires || [], // 页面同步资源
            asyncs = file.asyncs || [], // 页面异步资源
            // 伪异步
            loadUrls = file.extras.loadUrls || [], // 页面异步资源
            pageRes = {},
            cssDeps = {},
            pageDepMap = {};

        // 分析页面link的css
        var obtainStyleRets = html.obtainStyle(file.getContent());

        file.setContent(obtainStyleRets.content);

        // analysis link tag to obtain css
        var obtainStyleFileIds = [];
        obtainStyleRets.hrefs.forEach(function(href) {
            obtainStyleFileIds.push(ret.urlmapping[href].id);
        });


        requires = requires.concat(obtainStyleFileIds);
        requires.forEach(function(fileId) { // 同步资源
            if (HTTP_REG.test(fileId)) return;
            if (!pageDepMap[fileId]) {
                pageDepMap[fileId] = self.calFileDepsFromId(fileId, pageRes);
            }

            pageRes = _.merge(pageRes, pageDepMap[fileId].deps);
            cssDeps = _.merge(cssDeps, pageDepMap[fileId].cssDeps);
        });

        // note all sync files in page
        Object.keys(pageRes).forEach(function(res) {
            self._sync.push(res);
            self._sync = self._sync.concat(Object.keys(pageRes[res].deps || {}));
        });

        // uinque array list
        self._sync = self._sync.filter(function(elem, index, arr) {
            return arr.indexOf(elem) === index;
        });

        // loadUrl资源是同步资源但是用异步的方式加载
        // loadUrl资源不会打进resourceMap里面
        // loadUrl资源处理逻辑：
        // 1. 通过fis3-hook-loadUrl识别require.loadUrl资源（在file.extras.loadUrls中）
        // 2. 分析依赖关系，这一步骤同异步资源的处理，通过isLoadUrl标志
        // 3. 替换源代码：
        // - 3.1. 把url替换require.loadUrl里面的模块名
        // - 3.2. 在回调里面通过require获取模块
        loadUrls.concat(asyncs).forEach(function(fileId) { // 异步资源
            if (HTTP_REG.test(fileId)) return;
            if (!pageDepMap[fileId]) {
                pageDepMap[fileId] = self.calFileDepsFromId(fileId, pageRes);
                pageDepMap[fileId].isAsync = true;
            }

            // 每个依赖的资源都是异步
            Object.keys(pageDepMap[fileId].deps).forEach(function(id) {
                var file = pageDepMap[fileId].deps[id];
                file.isAsync = true;
            });
            pageRes = _.merge(pageRes, pageDepMap[fileId].deps);
            cssDeps = _.merge(cssDeps, pageDepMap[fileId].cssDeps);
        });

        // handle async deps
        // all async deps of each file will be packed into one file
        Object.keys(pageDepMap).forEach(function(fileId) {
            if (pageDepMap[fileId].asyncDeps.length) {
                var _asyncDeps = {};
                pageDepMap[fileId].asyncDeps.forEach(function(async) {
                    if (!pageRes[async]) {
                        _asyncDeps[async] = ret.ids[async];
                    }
                });

                if (Object.keys(_asyncDeps).length) {
                    pageDepMap[fileId + '_async'] = {
                        deps: _asyncDeps,
                        cssDeps: {},
                        asyncDeps: [],
                        isAsync: true
                    };
                }
            }
        });

        var actualAsyncDeps = {};

        asyncs.forEach(function(asyncDepId) { // 再次确认异步资源
            if (!pageRes[asyncDepId] && !conf.ignoreDict[asyncDepId]) {
                actualAsyncDeps[asyncDepId] = ret.ids[asyncDepId];
            }
        });

        return {
            pageRes: pageRes,
            cssDeps: cssDeps,
            asyncDeps: actualAsyncDeps,
            depMap: pageDepMap // contains: deps, cssDeps, asyncDeps
        };
    },
    replaceLoadUrl: function(content) {
        return content.replace(/require\.loadUrl/gm, 'require.async');
    },
    calFileDepsFromId: function(file, pageRes) {
        var curId,
            curFile,
            queue = [file],
            deps = {},
            asyncDeps = [],
            cssDeps = {},
            self = this,
            ret = self.ret,
            conf = self.conf;

        pageRes = pageRes || {};
        while (queue.length) {
            curId = queue.pop();

            // require 线上文件，不处理
            if (pageRes[curId] || HTTP_REG.test(curId) || conf.ignoreDict[curId]) {
                continue;
            }

            curFile = ret.ids[curId];

            if (!curFile) {
                !conf.ignoreDict[curId] && fis.log.notice(curId + ' is not exists!');
                continue;
            }

            if (curFile.isCssLike) {
                // todo handle css
                cssDeps[curId] = curFile;
                continue;
            }

            if (!curFile || !curFile.isJsLike) {
                continue;
            }

            deps[curId] = curFile;
            if (curFile.requires && curFile.requires.length) {
                curFile.requires.forEach(function(depId) {
                    if (depId !== curId && !deps[depId]) { // 加入 queue 继续查找
                        queue.unshift(depId);
                    }
                });
            }

            if (curFile.asyncs.length) {
                curFile.asyncs.forEach(function(asyncDepId) {
                    if (asyncDepId != curId && !deps[asyncDepId] && !asyncDeps[asyncDepId]) { // 去重
                        var asyncFile = ret.ids[asyncDepId];

                        if (HTTP_REG.test(asyncDepId)) {
                            return;
                        }

                        if (!asyncFile) {
                            !conf.ignoreDict[asyncDepId] && fis.log.notice(asyncDepId + ' is not exists!');
                            return;
                        }

                        asyncDeps.push(asyncDepId);
                        if (asyncFile.requires && asyncFile.requires.length) { // 异步文件中的依赖
                            asyncFile.requires.forEach(function(asyncDepId) {
                                var asyncDepFile = ret.ids[asyncDepId];
                                if (HTTP_REG.test(asyncDepId)) {
                                    return;
                                }
                                if (!asyncDepFile) {
                                    !conf.ignoreDict[asyncDepId] && fis.log.notice(asyncDepId + ' is not exists!');
                                    return;
                                }

                                if (asyncDepFile.isCssLike) {
                                    cssDeps[asyncDepId] = asyncDepFile;
                                } else if (asyncDepFile.isJsLike) {
                                    asyncDeps.push(asyncDepId);
                                }
                            });
                        }
                    }
                });
            }
        }

        return {
            deps: deps,
            cssDeps: cssDeps,
            asyncDeps: asyncDeps
        };
    },
    packCss: function(fileList, subpath) {
        var pkgFile = fis.file(fis.project.getProjectPath(), subpath),
            content = '';
        fileList.forEach(function(file) {
            content += '/* ' + file.subpath + ' */' + LINE_BREAK + file.getContent() + LINE_BREAK;
        });

        pkgFile.setContent(content);
        this.ret.pkg[pkgFile.subpath] = pkgFile;
        return '<link rel="stylesheet" type="text/css" href="' + pkgFile.getUrl() + '">' + LINE_BREAK;
    },
    injectCss: function(content, cssDeps) {
        var cssFile,
            html = '',
            self = this,
            conf = self.conf;

        var pageCssList = [];
        Object.keys(cssDeps).forEach(function(cssId) {
            cssFile = cssDeps[cssId];

            if (conf.autoPack) {
                if (conf.cssInline) {
                    html += '<style>' + cssFile.getContent() + '</style>' + LINE_BREAK;
                } else {
                    // 业务
                    pageCssList.push(cssFile);
                }
            } else {
                html += '<link rel="stylesheet" type="text/css" href="' + self._getUri(cssId) + '">' + LINE_BREAK;
            }
        });

        if (conf.cssAllInOne) {
            html += self.packCss(pageCssList, '/pkg/' + self.file.subpathNoExt + '/main_min.css');
        } else {
            if (pageCssList.length) {
                html += self.packCss(pageCssList, '/pkg/' + self.file.subpathNoExt + '/main_min.css');
            }
        }

        if (content.indexOf(conf.stylePlaceHolder) !== -1) {
            content = content.replace(conf.stylePlaceHolder, html);
        } else {
            content = content.replace(/<\/head>/, html + LINE_BREAK　 + '$&');
        }

        return content;
    },
    injectJs: function(content, pageRes) {
        var jsFile,
            html = '',
            self = this,
            conf = self.conf,
            pkg = self.pkg;

        if (conf.autoPack) {

            Object.keys(pkg).forEach(function(pId) {
                var pFile = pkg[pId];
                // ret.pkg 是全局的，所有页面都有打pkg里面全部的包
                if (pFile && !pFile.isAsync && pFile.isJsLike) {
                    html += '<script src="' + pFile.getUrl() + '"></script>' + LINE_BREAK;
                }
            });


        } else {
            Object.keys(pageRes).forEach(function(jsId) {
                jsFile = pageRes[jsId];
                if (jsFile.getContent() && !jsFile.isAsync) {
                    html += '<script src="' + jsFile.getUrl() + '"></script>' + LINE_BREAK;
                }
            });
        }

        if (content.indexOf(conf.scriptPlaceHolder) !== -1) {
            content = content.replace(conf.scriptPlaceHolder, html);
        } else {
            content = content.replace(/<\/body>/, html + LINE_BREAK + '$&');
        }

        return content;
    },
    _getUri: function(id) {
        return (this.ret.map.res[id] || {}).uri || '';
    },
    processLoadUrl: function(content, depMap) {
        var self = this;
        var reg = /require\.loadUrl\s*\(\s*("(?:[^\\"\r\n\f]|\\[\s\S])*"|'(?:[^\\'\n\r\f]|\\[\s\S])*'|\[[\s\S]*?\])\s*,\s*function\s*\(([\s\S]*?)\)\s*{\s*/g;

        content = content.replace(reg, function(m, value, arg) {
            var hasBrackets = false;
            var values;
            var args;
            var res = [];
            var info;
            var ret;


            value = value.trim().replace(/(^\[|\]$)/g, function(m, v) {
                if (v) hasBrackets = true;
                return '';
            });
            values = value.split(/\s*,\s*/);
            args = arg.split(/\s*,\s*/);

            for (var i = 0, l = values.length; i < l; ++i) {
                info = fis.project.lookup(values[i], self.file);
                if (!self.ret.map.pkg[info.id + '.min']) {
                    console.log('[ERROR] there has not the pkg:', info.id);
                    return m;
                }

                res.push({
                    id: info.id,
                    url: self.ret.map.pkg[info.id + '.min'].uri,
                    arg: i > args.length - 1 ? undefined : args[i]
                });
            }

            ret = ['require.loadUrl(['];
            res.forEach(function(o) {
                ret.push('"' + o.url + '"');
                ret.push(', ');
            });
            ret.pop();
            ret.push('], function() {');
            res.forEach(function(o) {
                if (o.arg) {
                    ret.push(o.arg + '=require("' + o.id + '");');
                }
            });
            return ret.join('');
        });

        return content;
    },
    packAllJsInOne: function(content) {
        var self = this,
            ret = self.ret;
        var allInOneFile = fis.file(fis.project.getProjectPath(), '/pkg/' + self.file.subpath + '_aio.js');
        allInOneFile.setContent(content);
        ret.pkg[allInOneFile.subpath] = allInOneFile;
        self.pkg[allInOneFile.subpath] = _.merge(allInOneFile, {
            isAsync: false
        });
        ret.map.pkg[allInOneFile.id + '.min'] = {
            uri: allInOneFile.getUrl(),
            type: 'js'
        };
    },
    generatePackageFile: function(depMap) {
        var deps,
            has,
            content,
            subpath,
            pkgFile,
            combinedId,
            self = this,
            ret = self.ret,
            conf = self.conf,
            allSyncContent = '';

        if (conf.outputResourceMapToMainJs && !this.mainScriptId) {
            this.getMainJs();
        }

        Object.keys(depMap).forEach(function(id) {
            // xxx_async file does not exists in ret.ids
            if (ret.ids[id] && !ret.ids[id].isJsLike) return;
            subpath = conf.output.replace('${id}', id);
            pkgFile = fis.file(fis.project.getProjectPath(), subpath);
            pkgFile.isAsync = !!depMap[id].isAsync;
            // pkgFile.isLoadUrl = !!depMap[id].isLoadUrl;
            if (Page.combineCache[id] && !self.isIdInLoadUrl(id)) { // 去重
                pkgFile = ret.pkg[pkgFile.subpath];
                if (conf.jsAllInOne && !depMap[id].isAsync) {
                    deps = depMap[id].deps;
                    has = Object.keys(deps);

                    has.forEach(function(fid, index) {
                        var f = ret.ids[fid],
                            c = f.getContent() || '';

                        if (index > 0) {
                            allSyncContent += LINE_BREAK + ';';
                        }

                        allSyncContent += c;
                    });
                } else {

                    self.pkg[pkgFile.subpath] = _.merge(pkgFile, {
                        isAsync: !!depMap[id].isAsync
                    });
                }

                return;
            }
            deps = depMap[id].deps;
            content = '';
            has = Object.keys(deps);

            has.forEach(function(fid, index) {
                var f = ret.ids[fid],
                    c = f.getContent() || '';

                if (index > 0) {
                    content += LINE_BREAK + ';';
                }

                content += c;
            });

            pkgFile.setContent(content);

            // 因为mod.js是通过define函数来确认异步js加载成功的
            // 因此这里需要添加一个空define
            // if (pkgFile.isLoadUrl) {
            if (self.isIdInLoadUrl(id)) {
                // content += LINE_BREAK + ';define("' + pkgFile.getUrl() + '", function() {});';
                // //////////////////// hack fis.file mark ////////////////////////////////////////////
                // 这里是打包文件file对象初始化的地方
                // hack思路：先不用hash，等到resourceMap插入之后再生成hash，然后替换所有需要替换的地方
                // console.log('bbbbb', self.mainScriptId, id);
                // 只针对主文件，因为resourceMap是打到主文件的
                // if (conf.outputResourceMapToMainJs && self.mainScriptId && self.mainScriptId == id) {
                pkgFile.useHash = false;
                content += LINE_BREAK + ';define("' + pkgFile.getUrl() + '", function() {});';
                pkgFile.setContent(content);

                // if (pkgFile.useHash === true) {
                //     pkgFile.setContent(pkgFile.getContent().replace('\u001F', pkgFile.getUrl()));
                // }
            }

            ret.pkg[pkgFile.subpath] = pkgFile;


            /*
             * 由于fis本身的文件md5机制，这里getUrl后，就会导致文件md5固定，后面对文件的content的
             * 修改，并不会触发md5值更新。
             * loadUrl中的url，先不要取Url进行md5
             */




            if (!self.isIdInLoadUrl(id)) {
                combinedId = id + '.min';
                ret.map.pkg[combinedId] = {
                    uri: pkgFile.getUrl(),
                    type: 'js',
                    has: has
                };
                Page.combineCache[id] = true;
            }

            // sync
            if (conf.jsAllInOne && !depMap[id].isAsync) {
                allSyncContent += content;
            } else {
                self.pkg[pkgFile.subpath] = _.merge(pkgFile, {
                    isAsync: !!depMap[id].isAsync
                });
            }


        });

        if (conf.jsAllInOne) {
            self.packAllJsInOne(allSyncContent);
        }

    },
    isIdInLoadUrl: function(id) {
        return (this.file.extras.loadUrls || []).indexOf(id) > -1;
    },
    generateSourceMap: function(analysis) {
        var deps,
            resourceMap = {
                res: {},
                pkg: {}
            },
            self = this,
            ret = self.ret,
            conf = self.conf,
            index = 0;
        // alias
        if (conf.autoPack) {
            Object.keys(analysis.depMap).forEach(function(p) {
                var combinedId = p + '.min',
                    depDict = analysis.depMap[p].deps,
                    file = analysis.depMap[p],
                    pName = 'p' + index;
                if (!file.isAsync || self.isIdInLoadUrl(p)) {
                    return;
                }
                Object.keys(depDict).forEach(function(fid) {
                    resourceMap.res[fid] = {
                        pkg: pName
                    };

                    deps = self.generateJSDepList(fid);

                    if (deps.length) {
                        var _deps = [];
                        deps.forEach(function(dep) {
                            // filter sync module from deps
                            if (self._sync.indexOf(dep) === -1) {
                                _deps.push(dep);
                            }
                        });
                        // filter requires
                        if (_deps.length) {
                            resourceMap.res[fid].deps = _deps;
                        }
                    }
                });

                resourceMap.pkg[pName] = {
                    url: (ret.map.pkg[combinedId] || {}).uri
                }; // todo do i need to add deps?
                index++;
            });

        } else {
            Object.keys(analysis.pageRes).forEach(function(depId) {
                var file = analysis.pageRes[depId];
                if (file && file.isJsLike && file.isAsync) {
                    resourceMap.res[depId] = {
                        url: self._getUri(depId)
                    };
                    deps = self.generateJSDepList(depId);

                    if (deps.length) {
                        resourceMap.res[depId].deps = deps;
                    }
                }
            });
        }

        // process asyncMap
        Object.keys(analysis.asyncDeps).forEach(function(asyncId) {
            resourceMap.res[asyncId] = {
                url: self._getUri(asyncId)
            };
            deps = self.generateJSDepList(asyncId);

            if (deps.length) {
                resourceMap.res[asyncId].deps = deps;
            }
        });

        return resourceMap;
    },

    /**
     * 生成一个文件的 js 依赖
     * @param id
     * @returns {Array}
     */
    generateJSDepList: function(id) {
        var ret = this.ret,
            file = ret.ids[id],
            list = [];


        if (file && file.requires && file.requires.length) {
            file.requires.forEach(function(r) {
                var rFile = ret.ids[r];
                if (!rFile) return;
                if (rFile.isJsLike) {
                    list.push(r);
                }
            });
        }

        return list;
    },

    getMainJs: function() {
        var self = this;
        var arr;
        if (!this.mainScriptId) {
            arr = (this.file.extras.loadUrls || []).concat(this.file.requires.concat(this.file.asyncs));
            arr.forEach(function(id) {
                if (self.mainScriptId || self.conf.libDict && self.conf.libDict[id]) {
                    return;
                }
                self.mainScriptId = id;
            });
        }
        return this;
    },
    injectResourceMap: function(content, resourceMap) {
        var conf = this.conf,
            ret = this.ret,
            html,
            subpath,
            mainScriptFile;

        if (conf.autoPack && conf.outputResourceMapToMainJs) {
            if (!this.mainScriptId) {
                this.getMainJs();
            }
            if (this.mainScriptId) {
                subpath = '/' + conf.output.replace('${id}', this.mainScriptId);
                if ((mainScriptFile = this.ret.pkg[subpath])) {
                    mainScriptFile.setContent('require.resourceMap(' + JSON.stringify(resourceMap, null, this.conf.autoPack ? null : 4) + ')' + LINE_BREAK + mainScriptFile.getContent());
                }
            }
            (this.file.extras.loadUrls || []).forEach(function(id) {
                var subpath = conf.output.replace('${id}', id),
                    _file = fis.file(fis.project.getProjectPath(), subpath);

                subpath = _file.subpath;
                var file = ret.pkg[subpath],
                    beforeMd5Url = file.getUrl();

                file.useHash = true;
                ret.map.pkg[id + '.min'] = {
                    uri: file.getUrl(),
                    type: 'js'
                };
                // 替换md5
                file.setContent(file.getContent().replace(new RegExp(fis.util.escapeReg(beforeMd5Url), 'g'), file.getUrl()));
            });
        } else {
            html = this.modJsCodeGen(resourceMap);
            if (content.indexOf(conf.resourcePlaceHolder) !== -1) {
                content = content.replace(conf.resourcePlaceHolder, html);
            } else {
                content = content.replace(/<\/body>/, html + LINE_BREAK + '$&');
            }
        }

        return content;
    },

    modJsCodeGen: function(map) {
        // resourceMap is empty
        if (!Object.keys(map.res).length) {
            return '';
        }
        return '<script>require.resourceMap(' + JSON.stringify(map, null, this.conf.autoPack ? null : 4) + ');</script>';
    },

    removePlaceholder: function(content) {
        var conf = this.conf;

        return content.replace(conf.scriptPlaceHolder, '')
            .replace(conf.stylePlaceHolder, '')
            .replace(conf.resourcePlaceHolder, '');
    },

    mergeInlineAssets: function(content) {
        return content.replace(/([^>])\s*<\/script>\s*<script(\s+type="text\/javascript"\s*)?>\s*/g, '$1;')
            .replace(/<\/style>\s*<style>/g, '')
            .replace(/\s*\n\s*/g, '\n');
    }
});
