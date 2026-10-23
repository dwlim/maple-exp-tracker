(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MapleLocalOcr=api;})(typeof window==='undefined'?globalThis:window,function(){
function prepare(image,kind,mode){
 let {width:w,height:h,data}=image,l=0,t=0,r=w,b=h,bracketColumns=[];
 if(kind==='level'&&mode==='soft'){
  l=w;t=h;r=0;b=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,R=data[i],G=data[i+1],B=data[i+2];if(R>100&&G/R>.25&&G/R<.85&&B/R<.4){l=Math.min(l,x);r=Math.max(r,x+1);t=Math.min(t,y);b=Math.max(b,y+1);}}
  if(r<=l||b<=t)return null;
 }
 if(kind==='exp'||kind==='exp-context'){
  const groups=[];let start=null,last=-1;
  for(let x=0;x<w;x++){let n=0;for(let y=0;y<h;y++){const i=(y*w+x)*4;if(data[i+1]-data[i]>12&&data[i+1]-data[i+2]>20)n++;}if(n>=2){if(start===null)start=x;else if(x-last>3){groups.push([start,last+1]);start=x;}last=x;}}
  if(start!==null)groups.push([start,last+1]);if(groups.length<2)return null;
  // Keep both fields in one line when the native amount is unclear.
  // Green bracket columns provide separators, not guessed numeric characters.
  if(kind==='exp-context'){
   bracketColumns=[groups[0],groups.at(-1)];r=groups.at(-1)[1];let top=h,bottom=0;
   for(const [left,right] of bracketColumns)for(let x=left;x<right;x++)for(let y=0;y<h;y++){const i=(y*w+x)*4;if(data[i+1]-data[i]>12&&data[i+1]-data[i+2]>20){top=Math.min(top,y);bottom=Math.max(bottom,y+1);}}
   t=Math.max(0,top-2);b=Math.min(h,bottom+2);
  }else{l=groups[0][1];r=groups.at(-1)[0];}if(r-l<3)return null;
 }
 const sw=r-l,sh=b-t,gray=new Float32Array(sw*sh);let low=255,high=0;
 for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){
  const i=((t+y)*w+l+x)*4,R=data[i],G=data[i+1],B=data[i+2];let v;
  if(kind==='level')v=mode==='blue'?B:255*(1-Math.max(0,Math.min(1,(Math.min(G,B)/Math.max(R,1)-.22)/.68)));
  else v=255-Math.min(255,Math.max(0,(Math.max(Math.min(R,G,B),G-R>8&&G-B>12?G:0)-55)*255/145));
  if(kind==='exp-context'&&bracketColumns.some(([left,right])=>x+l>=left&&x+l<right))v=255;
  gray[y*sw+x]=v;low=Math.min(low,v);high=Math.max(high,v);
 }
 if(kind==='level'&&mode==='blue')for(let i=0;i<gray.length;i++)gray[i]=255-(gray[i]-low)*255/Math.max(1,high-low);
 if(kind==='exp'&&mode==='binary')for(let i=0;i<gray.length;i++)gray[i]=gray[i]<150?0:255;
 const scale=kind==='level'&&mode==='blue'?4:mode==='large'?8:6,pad=20,width=sw*scale+pad*2,height=sh*scale+pad*2,out=new Uint8ClampedArray(width*height*4).fill(255);
 const sinc=x=>Math.abs(x)<1e-8?1:Math.sin(Math.PI*x)/(Math.PI*x),weights=(size)=>Array.from({length:size*scale},(_,d)=>{const center=(d+.5)/scale-.5,terms=[];let sum=0;for(let i=Math.max(0,Math.floor(center)-2);i<=Math.min(size-1,Math.floor(center)+3);i++){const delta=center-i,v=Math.abs(delta)<3?sinc(delta)*sinc(delta/3):0;terms.push([i,v]);sum+=v;}return terms.map(([i,v])=>[i,v/sum]);}),wx=weights(sw),wy=weights(sh),horizontal=new Float32Array(sw*scale*sh);
 for(let y=0;y<sh;y++)for(let x=0;x<sw*scale;x++){let sum=0;for(const [i,v] of wx[x])sum+=gray[y*sw+i]*v;horizontal[y*sw*scale+x]=Math.max(0,Math.min(255,sum));}
 for(let y=0;y<sh*scale;y++)for(let x=0;x<sw*scale;x++){
  let v=0;for(const [i,weight] of wy[y])v+=horizontal[i*sw*scale+x]*weight;const j=((y+pad)*width+x+pad)*4;
  out[j]=out[j+1]=out[j+2]=Math.max(0,Math.min(255,Math.round(v)));
 }return {width,height,data:out};
}
function normalize(text,kind){
 text=text.trim().replace(/\s/g,'');
 if(kind==='level'){text=text.replace(/[LV.]/g,'');return /^\d{1,3}$/.test(text)&&Number(text)>=1&&Number(text)<=100?text:null;}
 text=text.replace(/,/g,'.');
 if(/^\d{1,3}\.\d{2}%$/.test(text))text='['+text+']';
 if(/^\[\d{1,3}\.\d{2}%\]$/.test(text)){const pct=Number(text.slice(1,-2));return pct<=100?text:null;}
 return /^\d[\d.]*\[\d+\.\d{2}%\]$/.test(text)?text:null;
}
function choose(readings,kind,native){
 const valid=readings.map(r=>({...r,text:normalize(r.text,kind)})).filter(r=>r.text&&r.confidence>=(kind==='level'?35:0));
 if(kind==='level'){
  const digits=native?.expectedDigits;if(digits)for(let i=valid.length-1;i>=0;i--)if(valid[i].text.length!==digits)valid.splice(i,1);
  // A neural confidence score cannot overrule a clear digit or near-exact shape.
  if(native?.details)for(let i=valid.length-1;i>=0;i--)if(native.details.some((d,k)=>(/^\d$/.test(d.text||'')&&d.text!==valid[i].text[k])||(d.error<.025&&d.margin>.01&&d.best!==valid[i].text[k])))valid.splice(i,1);
 }
 if(kind==='exp'&&native?.text){const percentageOnly=native.text.startsWith('[');for(let i=valid.length-1;i>=0;i--)if(valid[i].text.startsWith('[')!==percentageOnly)valid.splice(i,1);}
 const groups=new Map();for(const r of valid){const g=groups.get(r.text)||[];g.push(r);groups.set(r.text,g);}
 if(groups.size!==1)return null;
 const [text,votes]=[...groups][0],confidence=Math.max(...votes.map(v=>v.confidence));
 const corroborated=kind==='level'&&native?.details?.length===text.length&&native.details.every((d,i)=>(d.text===text[i]||d.best===text[i])&&d.error<.06&&d.margin>.008);
 if(kind==='level'&&confidence<60&&votes.length<2&&!corroborated)return null;
 if(kind==='exp'&&(votes.length<2||confidence<30))return null;
 return {text,confidence,engine:'tesseract',votes:votes.length};
}
function createReader(recognize){
 let queue=Promise.resolve();const cache=new Map();
 function read(input){const task=queue.then(async()=>{
  const result={};
  for(const kind of ['level','exp']){
   const native=kind==='level'?input.nativeLevel:input.nativeExp;const prefix=kind==='exp'?input.nativeExp?.text?.split('[')[0]:'';
   if(kind==='level'&&/^\d{1,3}$/.test(native?.data?.text||''))continue;
   if(kind==='exp'&&(normalize(input.nativeExp?.text||'',kind)||!input.nativeExp?.text?.includes('[')))continue;
   const image=kind==='level'?input.levelImage:input.expImage;if(!image)continue;
   const context=kind==='exp'&&prefix&&!/^\d[\d.]*$/.test(prefix);
   let hash=2166136261;for(const v of image.data)hash=Math.imul(hash^v,16777619);const key=kind+(context?'-context':'')+':'+image.width+':'+image.height+':'+hash;
   let readings=cache.get(key);
   if(!readings){readings=[];for(const mode of kind==='level'?['soft','blue']:['soft','large']){const pixels=prepare(image,context?'exp-context':kind,mode);if(pixels){let reading=await recognize(pixels,kind);if(context){const fields=reading.text.trim().match(/^(\d[\d.,]*)\s+(\d{1,3}\.\d{2})%$/);reading={...reading,text:fields?fields[1].replace(/,/g,'.')+'['+fields[2]+'%]':''};}readings.push(reading);}}cache.set(key,readings);if(cache.size>12)cache.delete(cache.keys().next().value);}
   result[kind]=choose(readings,kind,kind==='exp'?{text:context?native.text:'['}:native);if(kind==='exp'&&result[kind]&&prefix&&!context)result[kind]={...result[kind],text:prefix+result[kind].text,confidence:Math.min(result[kind].confidence,input.nativeExp.confidence||0)};
  }return result;
 });queue=task.catch(()=>{});return task;}
 return {read};
}
let browserReader;
function read(input){
 if(!browserReader){let workerPromise,configuredWorker,configuredKind;
  const worker=async()=>{if(!workerPromise)workerPromise=(async()=>{
   if(typeof Tesseract==='undefined')await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=new URL('assets/ocr/tesseract.min.js',location.href).href;s.onload=resolve;s.onerror=()=>reject(Error('Local OCR runtime could not load'));document.head.appendChild(s);});
   const base=new URL('assets/ocr/',location.href).href;
   return Tesseract.createWorker('eng',1,{workerPath:base+'worker.min.js',corePath:base,langPath:base,gzip:true,cachePath:'maple-track-eng-5dc5d8d6'});
  })().catch(e=>{workerPromise=null;throw e;});return workerPromise;};
  browserReader=createReader(async(pixels,kind)=>{const w=await worker();if(configuredWorker!==w||configuredKind!==kind){await w.setParameters({tessedit_pageseg_mode:7,tessedit_char_whitelist:kind==='level'?'LV.0123456789':'0123456789.[]% '});configuredWorker=w;configuredKind=kind;}const c=document.createElement('canvas');c.width=pixels.width;c.height=pixels.height;c.getContext('2d').putImageData(new ImageData(pixels.data,pixels.width,pixels.height),0,0);try{const {data}=await w.recognize(c);return {text:data.text,confidence:data.confidence};}finally{c.width=0;c.height=0;}});
 }return browserReader.read(input);
}
return {prepare,normalize,choose,createReader,read};
});
