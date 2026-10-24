const fs=require('node:fs');
function render(html,marker,source){
 const start='<!-- '+marker+' START -->',end='<!-- '+marker+' END -->',a=html.indexOf(start),b=html.indexOf(end);
 if(a<0||b<a||html.indexOf(start,a+start.length)>=0||html.indexOf(end,b+end.length)>=0)throw Error('Missing or duplicate embedded module: '+marker);
 return html.slice(0,a)+start+'\n<script>'+source+'</script>\n'+end+html.slice(b+end.length);
}
function write(marker,source){const html=fs.readFileSync('index.html','utf8'),next=render(html,marker,source);if(next!==html)fs.writeFileSync('index.html',next);}
module.exports={render,write};
