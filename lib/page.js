/*
 * @TODO
 * 1. 手工指定packTo问题
 * 2. require 远程文件
 * 3. 页面script和link标签处理
 * 4. 同步文件的async依赖打包策略
 * 5. resourceMap 优化
 *
 *
 * link 标签已经处理，script标签暂时不处理，各种ignore
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
        content = self.injectCss(content, analysis.cssDeps);

        if (conf.autoPack) {
            self.generatePackageFile(analysis.depMap);
        }
        content = self.injectJs(content, analysis.pageRes);

        resourceMap = self.generateSourceMap(analysis);

        content = self.injectResourceMap(content, resourceMap);
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


        asyncs.forEach(function(fileId) { // 异步资源
            if (HTTP_REG.test(fileId)) return;
            if (!pageDepMap[fileId]) {
                pageDepMap[fileId] = self.calFileDepsFromId(fileId, pageRes);
                pageDepMap[fileId].isAsync = true;
            }

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

        var commonCssList = [],
            pageCssList = [];
        Object.keys(cssDeps).forEach(function(cssId) {
            cssFile = cssDeps[cssId];

            if (conf.autoPack) {
                if (conf.cssInline) {
                    html += '<style>' + cssFile.getContent() + '</style>' + LINE_BREAK;
                } else {
                    if (conf.commonCssGlob.test(cssFile.id)) {
                        // common
                        commonCssList.push(cssFile);
                    } else {
                        // 业务
                        pageCssList.push(cssFile);
                    }
                }
            } else {
                html += '<link rel="stylesheet" type="text/css" href="' + self._getUri(cssId) + '">' + LINE_BREAK;
            }
        });

        if (conf.cssAllInOne) {
            html += self.packCss(commonCssList.concat(pageCssList), '/pkg/' + path.basename(self.file.subpathNoExt) + '/main_min.css');
        } else {
            if (commonCssList.length) {
                html += self.packCss(commonCssList, '/pkg/common/common_min.css');
            }

            if (pageCssList.length) {
                html += self.packCss(pageCssList, '/pkg/' + path.basename(self.file.subpathNoExt) + '/main_min.css');
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
                if (!pFile) {
                    return;
                }
                // ret.pkg 是全局的，所有页面都有打pkg里面全部的包
                if (!pFile.isAsync && pFile.isJsLike) {
                    html += '<script src="' + pFile.getUrl() + '"></script>' + LINE_BREAK;
                }
            });


        } else {
            Object.keys(pageRes).forEach(function(jsId) {
                jsFile = pageRes[jsId];
                if (jsFile.getContent()) {
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
    generatePackageFile: function(depMap) {
        var deps,
            has,
            content,
            subpath,
            pkgFile,
            combinedId,
            self = this,
            ret = self.ret,
            conf = self.conf;

        Object.keys(depMap).forEach(function(id) {
            subpath = conf.output.replace('${id}', id);
            pkgFile = fis.file(fis.project.getProjectPath(), subpath);
            pkgFile.isAsync = !!depMap[id].isAsync;
            if (Page.combineCache[id]) { // 去重
                pkgFile = ret.pkg[pkgFile.subpath];

                self.pkg[pkgFile.subpath] = _.merge(pkgFile, {
                    isAsync: !!depMap[id].isAsync
                });
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
            ret.pkg[pkgFile.subpath] = pkgFile;
            self.pkg[pkgFile.subpath] = _.merge(pkgFile, {
                isAsync: !!depMap[id].isAsync
            });
            combinedId = id + '.min';
            ret.map.pkg[combinedId] = {
                uri: pkgFile.getUrl(),
                type: 'js',
                has: has
            };
            Page.combineCache[id] = true;
        });
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
                if (!file.isAsync) {
                    return;
                }
                Object.keys(depDict).forEach(function(fid) {
                    resourceMap.res[fid] = {
                        pkg: pName
                    };

                    deps = self.generateJSDepList(fid);

                    if (deps.length) {
                        resourceMap.res[fid].deps = deps;
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
                if (!file || !file.isJsLike || !file.isAsync) {
                    return;
                }
                resourceMap.res[depId] = {
                    url: self._getUri(depId)
                };
                deps = self.generateJSDepList(depId);

                if (deps.length) {
                    resourceMap.res[depId].deps = deps;
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

    injectResourceMap: function(content, resourceMap) {
        var conf = this.conf,
            html = this.modJsCodeGen(resourceMap);
        if (content.indexOf(conf.resourcePlaceHolder) !== -1) {
            content = content.replace(conf.resourcePlaceHolder, html);
        } else {
            content = content.replace(/<\/body>/, html + LINE_BREAK + '$&');
        }

        return content;
    },

    modJsCodeGen: function(map) {
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
