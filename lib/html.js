var rStyle = /<!--([\s\S]*?)(?:-->|$)|(?:\s*(<link[^>]*(?:\/)?>)|(<style[^>]*>([\s\S]*?)<\/style>))(<!--ignore-->)?\n?/ig;
var rRefStyle = /rel=('|")stylesheet\1/i;
var rSrcHref = /(?:src|href)=('|")(.+?)\1/i;

// 分析页面
function obtainStyle(content) {
    rStyle.lastIndex = 0;
    var hrefs = [];
    content = content.replace(rStyle, function(all, comment, link, style, body, ignored) {
        if (comment || ignored) {
            return all;
        }

        if (link && rRefStyle.test(link) && rSrcHref.test(link)) {
            // link css
            var href = RegExp.$2;
            hrefs.push(href);
            all = '';
        } else if (style && body.trim()) {
            // inline css，暂时不处理
            all = style;
        }

        return all;
    });

    return {
        content: content,
        hrefs: hrefs
    };
}

module.exports = {
    obtainStyle: obtainStyle
};
