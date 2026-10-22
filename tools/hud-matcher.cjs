const fs=require('node:fs');
const templates=JSON.parse(fs.readFileSync('tools/hud-font-templates.json'));
const source=`/* Digit shapes extracted from local Classic HUD screenshots. */\n(function(root){\nconst templates=${JSON.stringify(templates)};\n${normalizeScale.toString()}\n${recognize.toString()}\n${recognizeNative.toString()}\n${resolveReading.toString()}\n${percentageReading.toString()}\nroot.MapleHudOcr={recognize,resolveReading,percentageReading};\n})(typeof window==='undefined'?globalThis:window);\n`;
fs.writeFileSync('hud-ocr.js',source);
let html=fs.readFileSync('index.html','utf8');
html=html.replace(/<!-- HUD FONT START -->[\s\S]*?<!-- HUD FONT END -->\s*/,'');
html=html.replace('</head>','<!-- HUD FONT START -->\n<script>'+source+'</script>\n<!-- HUD FONT END -->\n</head>');
fs.writeFileSync('index.html',html);
function recognizeNative(image){
 function coverage(get,width,height){const out=[];for(let y=0;y<14;y++)for(let x=0;x<14;x++){const l=x*width/14,r=(x+1)*width/14,t=y*height/14,b=(y+1)*height/14;let sum=0;for(let py=Math.floor(t);py<Math.ceil(b);py++)for(let px=Math.floor(l);px<Math.ceil(r);px++)sum+=get(px,py)*Math.max(0,Math.min(r,px+1)-Math.max(l,px))*Math.max(0,Math.min(b,py+1)-Math.max(t,py));out.push(sum/((r-l)*(b-t)));}return out;}
 const {width:w,height:h}=image;let data=image.data;const mask=new Uint8Array(w*h),green=new Uint8Array(w);
 let peak=0;for(let i=0;i<data.length;i+=4)peak=Math.max(peak,Math.min(data[i],data[i+1],data[i+2]));
 if(peak<100)return {text:'',confidence:0,details:[],reason:'Frame is faded or too dark'};
 if(peak<255){data=Uint8ClampedArray.from(data,(v,i)=>i%4===3?v:Math.round(v*255/peak));}
 for(let x=0;x<w;x++){
  let count=0;
  for(let y=0;y<h;y++){const i=(y*w+x)*4,r=data[i],g=data[i+1],b=data[i+2];if(g-r>12&&g-b>20)count++;mask[y*w+x]=Math.min(r,g,b)>155&&Math.max(r,g,b)-Math.min(r,g,b)<65&&g-r<15?1:0;}
  if(count>=2){green[x]=1;for(let y=0;y<h;y++)mask[y*w+x]=0;}
 }
 const greenGroups=[];let gs=null,gl=-1;
 for(let x=0;x<w;x++)if(green[x]){if(gs===null)gs=x;else if(x-gl>3){greenGroups.push([gs,gl+1]);gs=x;}gl=x;}
 if(gs!==null)greenGroups.push([gs,gl+1]);
 const end=greenGroups.length>=2?greenGroups[1][0]:w;
 const spans=[];let start=null;
 for(let x=0;x<=end;x++){let on=false;if(x<end)for(let y=0;y<h;y++)on ||= !!mask[y*w+x];if(on&&start===null)start=x;if(!on&&start!==null){spans.push([start,x]);start=null;}}
 const heights=spans.map(([l,r])=>{let t=h,b=0;for(let y=0;y<h;y++)for(let x=l;x<r;x++)if(mask[y*w+x]){t=Math.min(t,y);b=Math.max(b,y+1);}return b-t;}).sort((a,b)=>a-b);
 const typicalHeight=heights[Math.floor(heights.length/2)]||h;
 // Score plausible boundaries jointly. Width alone never licenses a digit split.
 const rank=(left,right)=>{
  let top=h,bottom=0;for(let y=0;y<h;y++)for(let x=left;x<right;x++)if(mask[y*w+x]){top=Math.min(top,y);bottom=Math.max(bottom,y+1);}
  const gw=right-left,gh=bottom-top;if(!gh)return [];
  const v=coverage((x,y)=>mask[(top+y)*w+left+x],gw,gh),byChar=new Map();
  for(const t of templates){if(!/^[0-9]$/.test(t.char))continue;const th=t.rows.length,tw=t.rows[0].length;t.vector ||= coverage((x,y)=>t.rows[y][x]==='1'?1:0,tw,th);let diff=0,n=0;
   for(let y=0;y<14;y++)for(let x=0;x<14;x++){const weight=x<5&&y>2&&y<12?1.5:1,nearest=mask[(top+Math.min(gh-1,Math.floor((y+.5)*gh/14)))*w+left+Math.min(gw-1,Math.floor((x+.5)*gw/14))] !== (t.rows[Math.min(th-1,Math.floor((y+.5)*th/14))][Math.min(tw-1,Math.floor((x+.5)*tw/14))]==='1'?1:0);diff+=(Math.abs(v[y*14+x]-t.vector[y*14+x])*.6+Number(nearest)*.4)*weight;n+=weight;}
   const error=diff/n+Math.abs(gw/gh-tw/th)*.15;if(!byChar.has(t.char)||error<byChar.get(t.char))byChar.set(t.char,error);
  }return [...byChar].map(([char,error])=>({char,error})).sort((a,b)=>a.error-b.error);
 };
 const clear=r=>r.length>1&&r[0].error<.25&&r[1].error-r[0].error>.035&&(r[0].error<.22||r[1].error-r[0].error>.06);
 for(let index=0;index<spans.length;index++){
  const [left,right]=spans[index],width=right-left;if(width<typicalHeight*1.45||width>typicalHeight*3.3)continue;
  const columns=Array.from({length:width},(_,x)=>{let n=0;for(let y=0;y<h;y++)n+=mask[y*w+left+x];return n;}),candidates=[];
  for(const count of [2,3]){
   if(width/count<typicalHeight*.35||width/count>typicalHeight*1.15)continue;
   const search=(cuts,k)=>{
    if(k===count){const edges=[left,...cuts,right],pieces=edges.slice(0,-1).map((x,i)=>[x,edges[i+1]]),ranks=pieces.map(p=>rank(...p));if(ranks.every(clear))candidates.push({pieces,text:ranks.map(r=>r[0].char).join(''),score:ranks.reduce((s,r)=>s+r[0].error,0)/count});return;}
    const center=k*width/count,radius=typicalHeight*.2,choices=[];
    for(let x=Math.max(1,Math.ceil(center-radius));x<Math.min(width-1,Math.floor(center+radius)+1);x++){
     const before=Math.max(...columns.slice(Math.max(0,x-Math.ceil(typicalHeight*.5)),x)),after=Math.max(...columns.slice(x+1,Math.min(width,x+Math.ceil(typicalHeight*.5))));
     if(columns[x]<=Math.min(before,after)*.4)choices.push(x);
    }
    choices.sort((a,b)=>columns[a]-columns[b]);for(const x of choices.slice(0,4))if(!cuts.length||left+x-cuts.at(-1)>=typicalHeight*.35)search([...cuts,left+x],k+1);
   };search([],1);
  }
  candidates.sort((a,b)=>a.score-b.score);const best=candidates[0],other=candidates.find(c=>c.text!==best?.text);
  if(!best||(other&&other.score-best.score<.035))continue;
  spans.splice(index,1,...best.pieces);index+=best.pieces.length-1;
 }
 let text='',scores=[],details=[];
 for(const [left,right] of spans){
  let top=h,bottom=0;for(let y=0;y<h;y++)for(let x=left;x<right;x++)if(mask[y*w+x]){top=Math.min(top,y);bottom=Math.max(bottom,y+1);}
  const gw=right-left,gh=bottom-top;
  if(gh<typicalHeight*.5){text+=(gw/gh>1.8&&!(gw<=typicalHeight*.4&&gw/gh<=3))?'?':'.';continue;}
  const candidates=[],vector=coverage((x,y)=>mask[(top+y)*w+left+x],gw,gh);
  for(const t of templates){if(t.char==='.'||t.char===',')continue;const th=t.rows.length,tw=t.rows[0].length;let diff=0,n=0;
   t.vector ||= coverage((x,y)=>t.rows[y][x]==='1'?1:0,tw,th);
   for(let y=0;y<14;y++)for(let x=0;x<14;x++){const weight=x<5&&y>2&&y<12?1.5:1;const nearest=mask[(top+Math.min(gh-1,Math.floor((y+.5)*gh/14)))*w+left+Math.min(gw-1,Math.floor((x+.5)*gw/14))] !== (t.rows[Math.min(th-1,Math.floor((y+.5)*th/14))][Math.min(tw-1,Math.floor((x+.5)*tw/14))]==='1'?1:0);diff+=(Math.abs(vector[y*14+x]-t.vector[y*14+x])*.6+Number(nearest)*.4)*weight;n+=weight;}
   candidates.push({char:t.char,error:diff/n+Math.abs(gw/gh-tw/th)*.15});
  }
  candidates.sort((a,b)=>a.error-b.error);const best=candidates[0],second=candidates.find(c=>c.char!==best.char),margin=second.error-best.error;
  const options=[];for(const c of candidates)if(/^[0-9]$/.test(c.char)&&!options.some(o=>o.char===c.char)&&c.error<=Math.min(.25,best.error+.08))options.push(c);
  const char=best.error<.25&&margin>.035&&(best.error<.22||margin>.06)?best.char:'?';const charIndex=text.length;text+=char;scores.push(1-best.error);details.push({char,charIndex,options:options.slice(0,3),best:best.char,runnerUp:second.char,error:best.error,margin,left,right});
 }
 // Brackets are green, so reinsert them by their position between white glyphs.
 const opening=green.findIndex(v=>v);if(opening>=0){let before=0;for(const [left] of spans)if(left<opening)before++;text=text.slice(0,before)+'['+text.slice(before)+(greenGroups.length>=2?']':'');for(const d of details)if(d.charIndex>=before)d.charIndex++;}
 return {text,confidence:scores.length?Math.min(...scores)*100:0,details,glyphHeight:typicalHeight};
}
function percentageReading(text,requiredExp,previousExp=null){
 const m=text.match(/^(?:\[(\d{1,3}\.\d{2})%\]|(\d{1,3}\.\d{2})%)$/);
 if(!m||!Number.isFinite(requiredExp)||requiredExp<=0)return null;
 const pct=Number(m[1]||m[2]);if(pct<0||pct>100)return null;
 const center=requiredExp*pct/100,error=requiredExp*.00005;
 const previousFits=Number.isFinite(previousExp)&&previousExp>=0&&previousExp<=requiredExp&&Math.abs(previousExp-center)<=error;
 return {exp:previousFits?previousExp:Math.max(0,Math.min(requiredExp,Math.round(center))),pct,estimated:true,error};
}
function resolveReading(result,requiredExp){
 if(!Number.isFinite(requiredExp)||requiredExp<=0||!result.text.includes('?'))return result;
 const uncertain=result.details.filter(d=>d.char==='?');if(!uncertain.length||uncertain.length>6||uncertain.some(d=>!d.options?.length))return result;
 let variants=[result.text];for(const d of uncertain){variants=variants.flatMap(text=>d.options.map(o=>text.slice(0,d.charIndex)+o.char+text.slice(d.charIndex+1)));if(variants.length>729)return result;}
 const valid=new Set();for(const text of variants){const m=text.match(/^(\d[\d.]*)\[(\d+\.\d{2})%\]$/);if(!m)continue;const amount=m[1].replace(/\./g,'');if(!/^\d+$/.test(amount))continue;const exp=Number(amount),pct=Number(m[2]);if(exp<=requiredExp&&Math.abs(exp/requiredExp*100-pct)<=.0051)valid.add(text);}
 if(valid.size!==1)return result;
 return {...result,text:[...valid][0],originalText:result.text,resolved:true};
}
if(require.main===module){
 const fixtures=JSON.parse(fs.readFileSync('tools/hud-font-fixtures.json'));let passed=0;
 for(const [i,f] of fixtures.entries()){const r=recognize(f);const actual=r.text.replace(/\[|\]/g,'|').replace(/\|$/,'').replace(/,/g,'.');const expected=f.expected.replace(/,/g,'.');if(actual===expected)passed++;else console.log(i,f.expected,r.text,JSON.stringify(r.details.filter(d=>d.char==='?')));}
 console.log(`${passed}/${fixtures.length} exact matches`);
}

// Area resampling preserves partial pixel coverage when recovering a canonical HUD scale.
function normalizeScale(image,factor){
 const width=Math.max(1,Math.round(image.width*factor)),height=Math.max(1,Math.round(image.height*factor)),data=new Uint8ClampedArray(width*height*4),sx=image.width/width,sy=image.height/height;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const l=x*sx,r=(x+1)*sx,t=y*sy,b=(y+1)*sy,sums=[0,0,0,0];
  for(let py=Math.floor(t);py<Math.ceil(b);py++)for(let px=Math.floor(l);px<Math.ceil(r);px++){const weight=Math.max(0,Math.min(r,px+1)-Math.max(l,px))*Math.max(0,Math.min(b,py+1)-Math.max(t,py)),i=(Math.min(image.height-1,py)*image.width+Math.min(image.width-1,px))*4;for(let k=0;k<4;k++)sums[k]+=image.data[i+k]*weight;}
  for(let k=0;k<4;k++)data[(y*width+x)*4+k]=Math.round(sums[k]/(sx*sy));
 }return {width,height,data};
}
function recognize(image){
 const native=recognizeNative(image);if(!native.text.includes('?')||!native.glyphHeight)return native;
 // A scale recovery is accepted only when two canonical raster sizes agree.
 const recovered=[18,24].map(height=>recognizeNative(normalizeScale(image,height/native.glyphHeight)));
 const valid=r=>/^(?:\d[\d.]*\[\d+\.\d{2}%\]|\[\d{1,3}\.\d{2}%\]|\d{1,3}\.\d{2}%)$/.test(r.text);
 if(recovered.every(valid)&&recovered[0].text===recovered[1].text)return {...recovered[0],confidence:Math.min(...recovered.map(r=>r.confidence)),normalized:true};
 return native;
}
