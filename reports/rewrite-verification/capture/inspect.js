(function () {
    var injector = angular.element(document).injector();
    function visible(el) {
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && getComputedStyle(el).visibility !== 'hidden';
    }
    function box(el) {
        var r = el.getBoundingClientRect();
        return {text:el.textContent.trim().slice(0,100), x:r.x,y:r.y,width:r.width,height:r.height};
    }
    return {
        state:injector.get('$state').current.name,
        viewport:[innerWidth,innerHeight], screen:[screen.width,screen.height],
        theme:injector.get('$rootScope').settingsInfo.theme,
        errors:window.__renderErrors,
        brokenImages:Array.from(document.images).filter(function(el){return visible(el)&&(!el.complete||!el.naturalWidth);}).map(function(el){return el.src;}),
        svgCount:document.querySelectorAll('svg').length,
        invalidSvg:Array.from(document.querySelectorAll('svg path,svg rect,svg text')).filter(function(el){return /NaN|Infinity/.test(el.outerHTML);}).length,
        headers:Array.from(document.querySelectorAll('.bar .title')).filter(visible).map(box),
        tabs:Array.from(document.querySelectorAll('a.tab-item')).filter(visible).map(box),
        fontStatus:document.fonts.status,
        documentWidth:document.documentElement.scrollWidth,
        scrollRegions:Array.from(document.querySelectorAll('.chart-scroll,.scroll-content')).filter(visible).map(function(el){return {className:el.className,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,clientHeight:el.clientHeight,scrollHeight:el.scrollHeight};})
    };
})();
