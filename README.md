# fis3-packager-smart
fis3 require打包插件。

### 安装
```
npm i -g fis3-packager-smart
```

### 打包原理
分析页面a.html的同步（requires）和异步依赖（asyncs），每个依赖的js文件，会再去分析自身的依赖关系，然后打成一个包。

例如页面a.html中有以下脚本：
```
require.async(['zepto', 'common', 'a'], function($, tools, main){
    main.init();
});
```
最终会分析zepto的依赖，打成一个包，common和a类似。

调试模式下，可以设置`autoPack: false`，表示不打包。这样依赖的文件会全部以script的方式插入到html中， css的处理类似。

配置中有lib项配置，表示该库会单独打成一个包。

### html中的引用
基于上面的原理，html中引入主JS脚本时，推荐的方式是：
+ 主JS也是一个模块，而不是自执行的脚本，对外导出init接口
+ html中使用内联的方式require主JS脚本，然后调用init方法
```
// main.js
module.exports = {init: function(){}};

// index.html
<script>
require(['main'], function(main) {
    main.init();
});
</script>
```

或者主JS自执行，但是在html中通过require引入
```
// main.js
init();
// index.html
<script>
require('main');
</script>
// index.html中不要使用下面的方式引入脚本
<script src='main.js'></script>
```

### 配置
```
fis.match('::package', {
    packager: fis.plugin('smart', {
        // 脚本占位符
        scriptPlaceHolder: '<!--SCRIPT_PLACEHOLDER-->',

        // 样式占位符
        stylePlaceHolder: '<!--STYLE_PLACEHOLDER-->',

        // 资源占位符
        resourcePlaceHolder: '<!--RESOURCEMAP_PLACEHOLDER-->',

        output: 'pkg/${id}_min.js',
<<<<<<< HEAD
=======

        // 自动分析资源并在页面中载入
        autoLoad: true,
        
>>>>>>> dfa8987c020cfce548de45442ba56c5e841994b0
        // 自动打包资源
        autoPack: false,

        ignore: [], // 不打包的模块
<<<<<<< HEAD
        // css 内联到页面
        cssInline: false,
        // 所有css打包到一个文件中
        cssAllInOne: false
=======
        // 适合移动端场景
        cssInline: false,
        // css是否打包成一个文件，适合单页面应用
        cssAllInOne: false 
>>>>>>> dfa8987c020cfce548de45442ba56c5e841994b0
    })
});
```

上面的配置都是默认的，使用者可以完全不用管，只需要配置autoPack属性
```
fis.match('::package', {
    packager: fis.plugin('smart', {
        autoPack: true // false表示不打包，默认是false
    });
});
```
