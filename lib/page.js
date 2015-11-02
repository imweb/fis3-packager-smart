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
    depMap = {},
    path = require('path'),
    _ = fis.util;



var Page;

var isPack = false;

// 线上文件不处理
var HTTP_REG = /^https?:\/\//i;

var packToDepMap = {};

var packToAlisaDeps = {
    requires: [],
    asyncs: []
};

var html = require('./html');

function uniqList(arr) {
    var ret = [],
        obj = {};
    arr.forEach(function(r) {
        if (!obj[r]) {
            ret.push(r);
            obj[r] = 1;
        }
    });
    return ret;
}

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

        if (!isPack) {
            packToDepMap = self.packTo(conf.pack);
            isPack = true;
        }


        if (conf.autoPack) {
            self.generatePackageFile(analysis.depMap);
        }

        if (packToAlisaDeps && ~conf.addPackTo.indexOf(self.file.subpath)) {

            content = self.injectAlisa(content, uniqList(packToAlisaDeps.requires.concat(analysis.aliasDeps.requires)));
        } else {
            content = self.injectAlisa(content, analysis.aliasDeps.requires);
        }

        content = self.injectJs(content, analysis.pageRes);

        if (~conf.addPackTo.indexOf(self.file.subpath)) {
            analysis.depMap = _.merge(analysis.depMap, packToDepMap);
        }

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

    injectAlisa: function(content, requires) {
        var self = this,
            conf = self.conf,
            script = '';

        requires.forEach(function(r) {
            script += '<script src="' + conf.aliasMap[r] + '"></script>' + LINE_BREAK;
        });
        content = content.replace(/<\/body>/, script + LINE_BREAK + '$&');

        return content;
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
            aliasDeps = {
                requires: [],
                asyncs: []
            },
            pageDepMap = {};

        // var packTo = conf.packTo;

        // packTo.forEach(function(fileId) {
        // 先把pack记录到pageRes中， 防止其他模块打包此模块
        // 这里暂时注释掉，其他模块也可以打包此模块
        // pageRes[fileId] = ret.ids[fileId];
        // });

        // 分析页面link的css
        var obtainStyleRets = html.obtainStyle(file.getContent());

        file.setContent(obtainStyleRets.content);

        var obtainStyleFileIds = [];
        obtainStyleRets.hrefs.forEach(function(href) {
            obtainStyleFileIds.push(ret.urlmapping[href].id);
        });

        requires = requires.concat(obtainStyleFileIds);


        requires.forEach(function(fileId) { // 同步资源
            if (HTTP_REG.test(fileId)) return;
            if (conf.libDict[fileId] || conf.libDict[conf.idMaps[fileId]]) {
                // 同一个common库，一个页面是同步，一个是异步，这里有干扰
                if (!depMap[fileId]) { // 去重
                    depMap[fileId] = self.calFileDepsFromId(fileId, pageRes);
                }
                pageDepMap[fileId] = depMap[fileId];
            } else if (!pageDepMap[fileId]) {
                pageDepMap[fileId] = self.calFileDepsFromId(fileId, pageRes);
            }

            // pageDepMap[fileId].sourceHtml = file.subpath;
            pageRes = _.merge(pageRes, pageDepMap[fileId].deps);
            cssDeps = _.merge(cssDeps, pageDepMap[fileId].cssDeps);

            // asyncs = asyncs.concat(pageDepMap[fileId].asyncDeps);
            aliasDeps.requires = aliasDeps.requires.concat(pageDepMap[fileId].aliasDeps.requires);
            aliasDeps.asyncs = aliasDeps.asyncs.concat(pageDepMap[fileId].aliasDeps.asyncs);
        });




        asyncs.forEach(function(fileId) { // 异步资源
            if (HTTP_REG.test(fileId)) return;
            if (conf.libDict[fileId] || conf.libDict[conf.idMaps[fileId]]) {
                if (!depMap[fileId]) { // 去重
                    depMap[fileId] = self.calFileDepsFromId(fileId, pageRes);
                }

                depMap[fileId].isAsync = true;

                pageDepMap[fileId] = depMap[fileId];
            } else if (!pageDepMap[fileId]) {
                pageDepMap[fileId] = self.calFileDepsFromId(fileId, pageRes);
                pageDepMap[fileId].isAsync = true;
            }
            pageDepMap[fileId].sourceHtml = file.subpath;

            pageRes = _.merge(pageRes, pageDepMap[fileId].deps);
            cssDeps = _.merge(cssDeps, pageDepMap[fileId].cssDeps);
            // asyncs = asyncs.concat(pageDepMap[fileId].asyncDeps);
            aliasDeps.requires = aliasDeps.requires.concat(pageDepMap[fileId].aliasDeps.requires);
            aliasDeps.asyncs = aliasDeps.asyncs.concat(pageDepMap[fileId].aliasDeps.asyncs);
        });


        // alias handle

        aliasDeps.requires = uniqList(aliasDeps.requires);
        aliasDeps.asyncs = uniqList(aliasDeps.asyncs);

        var actualAsyncDeps = {};

        asyncs.forEach(function(asyncDepId) { // 再次确认异步资源
            if (!pageRes[asyncDepId] && !conf.ignoreDict[asyncDepId]) {
                actualAsyncDeps[asyncDepId] = ret.ids[asyncDepId];
            }
        });

        return {
            aliasDeps: aliasDeps,
            pageRes: pageRes,
            cssDeps: cssDeps,
            asyncDeps: actualAsyncDeps,
            depMap: pageDepMap // contains: deps, cssDeps, asyncDeps
        };
    },
    packTo: function(pack) {
        // 同步资源打包
        // 异步资源打包
        var self = this,
            ret = self.ret,
            conf = self.conf,
            subpath,
            pkgFile,
            content,
            depMaps = {},
            allPageRes = {},
            packToDepMap = {},
            aliasDeps = {
                requires: [],
                asyncs: []
            },
            packed = {};

        conf.packToIgnore.forEach(function(p) {
            packed[p] = true;
        });

        Object.keys(pack).forEach(function(p) {

            if (Page.combineCache[p]) { // 去重

                // subpath = '/pkg/' + p;
                // pkgFile = fis.file(fis.project.getProjectPath(), subpath);
                // Page.jsSourceHtmlDict[pkgFile.subpath].push(self.file.subpath);
                return;
            }

            var isAsync = /\.async\./i.test(p);
            var packFiles = pack[p],
                pageRes = {};
            packFiles.forEach(function(file) {
                file = fis.file(fis.project.getProjectPath(), file);
                file = file.id;

                depMaps[file] = self.calFileDepsFromId(file, pageRes);

                pageRes = _.merge(pageRes, depMaps[file].deps);
                allPageRes = _.merge(allPageRes, pageRes);
                aliasDeps.requires = aliasDeps.requires.concat(depMaps[file].aliasDeps.requires);
                aliasDeps.asyncs = aliasDeps.requires.concat(depMaps[file].aliasDeps.asyncs);
            });

            content = '';
            Object.keys(pageRes).forEach(function(page, index) {

                // 过滤掉基础库
                if (packed[page]) return;
                var f = ret.ids[page],
                    c = f.getContent() || '';

                if (index > 0) {
                    content += LINE_BREAK + ';';
                }

                content += c;
                if (!isAsync) {
                    packed[page] = true;
                }

            });


            subpath = '/pkg/' + p;
            pkgFile = fis.file(fis.project.getProjectPath(), subpath);
            pkgFile.setContent(content);

            // Page.jsSourceHtmlDict[pkgFile.subpath] = [pkgFile.subpath];
            pkgFile.sourceHtml = self.file.subpath;

            pkgFile.deps = pageRes;

            packToDepMap[pkgFile.id] = pkgFile;

            // 打包文件中包含async认为是异步文件
            if (/\.async\./i.test(p)) {
                // 异步
                pkgFile.isAsync = true;

                ret.pkg[pkgFile.subpath] = pkgFile;
            } else {
                // 同步处理认为是公共包，所有文件公用
                ret.pkg[pkgFile.subpath] = pkgFile;
            }

            ret.map.pkg[pkgFile.id + '.min'] = {
                uri: pkgFile.getUrl(),
                type: 'js',
                has: Object.keys(pageRes)
            };
        });


        aliasDeps.requires = uniqList(aliasDeps.requires);
        aliasDeps.asyncs = uniqList(aliasDeps.asyncs);

        packToAlisaDeps = aliasDeps;

        return packToDepMap;
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
            conf = self.conf,
            aliasDeps = {
                requires: [],
                asyncs: []
            },
            aliasKeys = Object.keys(conf.aliasMap);

        pageRes = pageRes || {};
        while (queue.length) {
            curId = queue.pop();

            // require 线上文件，不处理
            if (pageRes[curId] || HTTP_REG.test(curId) || conf.ignoreDict[curId]) {
                continue;
            }

            if (~aliasKeys.indexOf(curId)) {
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
                        // 同步依赖aliasMap
                        if (~aliasKeys.indexOf(depId)) {
                            aliasDeps.requires.push(depId);
                        }
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

                        if (~aliasKeys.indexOf(asyncDepId)) {
                            aliasDeps.asyncs.push(asyncDepId);
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
            asyncDeps: asyncDeps,
            aliasDeps: aliasDeps
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

            // TODO: css 如何打包
            // 暂时2个包，一个common，一个业务
            // 哪些文件打到common，哪些文件打到业务css
            if (conf.autoPack) {
                if (conf.cssInline) {
                    html += '<style>' + cssFile.getContent() + '</style>' + LINE_BREAK;
                } else {
                    // if (/^\/?modules\/common\//.test(cssFile.id)) {
                    if (/^\/?common\//.test(cssFile.id)) {
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
        // pkg = self.ret.pkg;

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

            if (!ret.ids[id] || !ret.ids[id].isJsLike) {
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
            index = 0,
            filterDeps = [];
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
                    if (~conf.packToIgnore.indexOf(fid)) {
                        return;
                    }
                    resourceMap.res[fid] = {
                        // deps: depDict[fid].requires,
                        pkg: pName
                    };

                    deps = self.generateJSDepList(fid);

                    if (deps.length) {
                        filterDeps.length = 0;
                        deps.forEach(function(dep) {
                            if (!conf.packToIgnoreDict[dep]) {
                                filterDeps.push(dep);
                            }
                        });
                        resourceMap.res[fid].deps = [].concat(filterDeps);
                    }
                });

                resourceMap.pkg[pName] = {
                    url: (ret.map.pkg[combinedId] || {}).uri
                }; // todo do i need to add deps?
                index++;
            });
            analysis.aliasDeps.asyncs.forEach(function(id) {
                resourceMap.pkg[id] = {
                    url: conf.aliasMap[id]
                };
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
                    filterDeps.length = 0;
                    deps.forEach(function(dep) {
                        if (!conf.packToIgnoreDict[dep]) {
                            filterDeps.push(dep);
                        }
                    });
                    resourceMap.res[depId].deps = [].concat(filterDeps);;
                }
            });
            // aliasMap
            analysis.aliasDeps.asyncs.forEach(function(alias) {
                resourceMap.res[alias] = {
                    url: conf.aliasMap[alias]
                };
            });
        }

        if (packToAlisaDeps && ~conf.addPackTo.indexOf(self.file.subpath)) {
            packToAlisaDeps.asyncs.forEach(function(f) {
                resourceMap.res[f] = {
                    url: conf.aliasMap[f]
                };
            });
        }

        // process asyncMap
        Object.keys(analysis.asyncDeps).forEach(function(asyncId) {
            resourceMap.res[asyncId] = {
                url: self._getUri(asyncId)
            };
            deps = self.generateJSDepList(asyncId);

            if (deps.length) {
                filterDeps.length = 0;
                deps.forEach(function(dep) {
                    if (!conf.packToIgnoreDict[dep]) {
                        filterDeps.push(dep);
                    }
                });
                resourceMap.res[asyncId].deps = [].concat(filterDeps);
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
