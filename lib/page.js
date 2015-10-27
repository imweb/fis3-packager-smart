/**
 * page
 * @author jerojiang
 * @date 2015-09-19
 */

/*global fis*/
var LINE_BREAK = '\r',
    depMap = {},
    combineCache = {},
    path = require('path'),
    _ = fis.util;



var Page;

var isPack = false;

// 线上文件不处理
var HTTP_REG = /^https?:\/\//i;

var packToDepMap = {};

module.exports = Page = function(file, ret, conf) {
    if (!(file && conf)) {
        return;
    }

    this.conf = _.assign({}, conf);

    this.file = file;
    this.ret = ret;
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

    analyzeHtmlDepsAndAsync: function() {
        var self = this,
            ret = this.ret,
            file = self.file,
            conf = self.conf,
            requires = file.requires || [], // 页面同步资源
            asyncs = file.asyncs || [], // 页面异步资源
            pageRes = {},
            cssDeps = {},
            pageDepMap = {},
            all = requires.concat(asyncs);

        var packTo = conf.packTo,
            packToFile;

        packTo.forEach(function(fileId) {
            // 先把pack记录到pageRes中， 防止其他模块打包此模块
            // pageRes[fileId] = 'packTo';
            pageRes[fileId] = ret.ids[fileId];
        });


        requires.forEach(function(fileId) { // 同步资源
            if (HTTP_REG.test(fileId)) return;
            if (conf.libDict[fileId] || conf.libDict[conf.idMaps[fileId]]) {
                if (!depMap[fileId]) { // 去重
                    depMap[fileId] = self.calFileDepsFromId(fileId, pageRes);
                }
                pageDepMap[fileId] = depMap[fileId];
            } else if (!pageDepMap[fileId]) {
                pageDepMap[fileId] = self.calFileDepsFromId(fileId, pageRes);
            }

            pageDepMap[fileId].sourceHtml = file.subpath;
            pageRes = _.merge(pageRes, pageDepMap[fileId].deps);
            cssDeps = _.merge(cssDeps, pageDepMap[fileId].cssDeps);
            asyncs = asyncs.concat(pageDepMap[fileId].asyncDeps);

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
            asyncs = asyncs.concat(pageDepMap[fileId].asyncDeps);
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
    packTo: function(pack) {
        // 同步资源打包
        // 异步资源打包
        var self = this,
            ret = self.ret,
            conf = self.conf,
            subpath,
            pkgFile,
            content,
            pageRes,
            depMaps = {},
            allPageRes = {},
            packToDepMap = {},
            packed = {};

        conf.packToIgnore.forEach(function(p) {
            packed[p] = true;
        });

        Object.keys(pack).forEach(function(p) {
            var isAsync = /\.async\./i.test(p);
            var packFiles = pack[p],
                pageRes = {};
            packFiles.forEach(function(file) {
                file = fis.file(fis.project.getProjectPath(), file);
                file = file.id;

                depMaps[file] = self.calFileDepsFromId(file, pageRes);
                pageRes = _.merge(pageRes, depMaps[file].deps);
                allPageRes = _.merge(allPageRes, pageRes);
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

        self.commonPageRes = allPageRes;

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
                    if (depId != curId && !deps[depId]) { // 加入 queue 继续查找
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
            pkg = self.ret.pkg,
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
                    if (/^\/?modules\/common\//.test(cssFile.id)) {
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
            content = content.replace(/<\/head>/, html + LINE_BREAK);
        }

        return content;
    },
    injectJs: function(content, pageRes) {
        var jsFile,
            html = '',
            self = this,
            conf = self.conf,
            pkg = self.ret.pkg;

        if (conf.autoPack) {
            Object.keys(pkg).forEach(function(pId) {
                var pFile = pkg[pId];
                if (!pFile) {
                    return;
                }

                if (!pFile.isAsync && pFile.
                dist 时 watch 有问题 // && pFile.sourceHtml === self.file.subpath) {
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
            content = content.replace(/<\/body>/, html + LINE_BREAK);
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
            if (Page.combineCache[id]) { // 去重
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

            subpath = conf.output.replace('${id}', id);
            pkgFile = fis.file(fis.project.getProjectPath(), subpath);
            pkgFile.isAsync = !!depMap[id].isAsync;
            pkgFile.sourceHtml = self.file.subpath
            pkgFile.setContent(content);
            ret.pkg[pkgFile.subpath] = pkgFile;
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
            conf = self.conf;

        if (conf.autoPack) {
            Object.keys(analysis.depMap).forEach(function(p, index) {
                var combinedId = p + '.min',
                    depDict = analysis.depMap[p].deps,
                    file = analysis.depMap[p],
                    pName = 'p' + index;
                if (!file.isJsLike || !file.isAsync) {
                    return;
                }
                Object.keys(depDict).forEach(function(fid) {
                    resourceMap.res[fid] = {
                        // deps: depDict[fid].requires,
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
            content = content.replace(/<\/body>/, html + LINE_BREAK);
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
