(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MapleHudRegions=api;})(typeof window==='undefined'?globalThis:window,function(){
function crop(image,box){
 const x=Math.max(0,Math.floor(box.x)),y=Math.max(0,Math.floor(box.y)),width=Math.max(1,Math.min(image.width-x,Math.ceil(box.w))),height=Math.max(1,Math.min(image.height-y,Math.ceil(box.h))),data=new Uint8ClampedArray(width*height*4);
 for(let row=0;row<height;row++)data.set((image.data.subarray||image.data.slice).call(image.data,((y+row)*image.width+x)*4,((y+row)*image.width+x+width)*4),row*width*4);
 return {width,height,data};
}
function components(image,kind,from=.65){
 const {width,height,data}=image,top=Math.floor(height*from),h=height-top,mask=new Uint8Array(width*h),queue=new Uint32Array(width*h),out=[];
 for(let y=top;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,r=data[i],g=data[i+1],b=data[i+2];mask[(y-top)*width+x]=kind==='orange'?(r>100&&g/r>.25&&g/r<.85&&b/r<.4):kind==='cash'?(r>110&&r>g*1.7&&r>b*1.3):kind==='white'?(Math.min(r,g,b)>135&&Math.max(r,g,b)-Math.min(r,g,b)<65):(g-r>12&&g-b>20);}
 for(let seed=0;seed<mask.length;seed++)if(mask[seed]){let count=1;queue[0]=seed;mask[seed]=0;let l=width,r=0,t=h,b=0;
  for(let head=0;head<count;head++){const i=queue[head],x=i%width,y=Math.floor(i/width);l=Math.min(l,x);r=Math.max(r,x+1);t=Math.min(t,y);b=Math.max(b,y+1);
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy,j=ny*width+nx;if(nx>=0&&nx<width&&ny>=0&&ny<h&&mask[j]){mask[j]=0;queue[count++]=j;}}
  }
  if(count>=3)out.push({x:l,y:t+top,w:r-l,h:b-t,area:count});
 }
 return out;
}
function whiteSpans(image,x0,x1,y0,y1){
 const spans=[];let start=null;
 for(let x=Math.max(0,Math.floor(x0));x<=Math.min(image.width,Math.ceil(x1));x++){let count=0,t=y1,b=y0;
  if(x<x1)for(let y=Math.max(0,Math.floor(y0));y<Math.min(image.height,Math.ceil(y1));y++){const i=(y*image.width+x)*4,r=image.data[i],g=image.data[i+1],z=image.data[i+2];if(Math.min(r,g,z)>135&&Math.max(r,g,z)-Math.min(r,g,z)<65){count++;t=Math.min(t,y);b=Math.max(b,y+1);}}
  if(count){if(!start)start={x,y:t,w:0,h:b-t};else{const end=Math.max(start.y+start.h,b);start.y=Math.min(start.y,t);start.h=end-start.y;}}
  else if(start){start.w=x-start.x;spans.push(start);start=null;}
 }
 return spans;
}
const normal=(b,image)=>({x:b.x/image.width,y:b.y/image.height,w:b.w/image.width,h:b.h/image.height});
const lvMask='111100000011100000011100111100000011100000111100111100000001100000111100111100000001100000111100111100000001110000110000111100000001110000110000111100000000110001110000111100000000111101110000111100000000111101110000111100000000111101100000111100000000011111100000111100000000011111100000111100000000011111000011111100000000011111000011111111111110011111000011111111111110001111000011';
function hasLvLabel(image,tile){
 const spans=whiteSpans(image,tile.x-tile.h*3.5,tile.x-1,tile.y-tile.h*.3,tile.y+tile.h*1.3);
 for(let end=spans.length-1;end>=0;end--)for(let n=1;n<=3&&end-n+1>=0;n++){
  const group=spans.slice(end-n+1,end+1),x=group[0].x,y=Math.min(...group.map(b=>b.y)),w=group.at(-1).x+group.at(-1).w-x,h=Math.max(...group.map(b=>b.y+b.h))-y;
  if(h<tile.h*.55||w/h<1.1||w/h>2.3||tile.x-x-w>tile.h*1.5)continue;
  let error=0;for(let yy=0;yy<16;yy++)for(let xx=0;xx<24;xx++){const px=x+Math.min(w-1,Math.floor((xx+.5)*w/24)),py=y+Math.min(h-1,Math.floor((yy+.5)*h/16)),i=(py*image.width+px)*4,on=Math.min(image.data[i],image.data[i+1],image.data[i+2])>135;error+=Number(on)!==Number(lvMask[yy*24+xx]);}
  if(error/384<.24)return true;
 }
 return false;
}

const expLabelMask='111111111111111100011111001111111110111111111100111110011100111111111111111110000000011111111100111110011111111110000000011111111100111110011111111000000000001111111100111110011111111111110000001111111000111110011111111111111000001111111000001111111111111111110000001111111000111111111110111111110000001111111000111111111110111110000000001111111000111111100000111000000000011111111100111110000000111110000000111111111100001110000000111111111111111100011110111110011110111111111111111100011110111110011110111111111111111100011111111110011110011111111111111000000110001100000110';
function hasExpLabel(image,box){
 const spans=whiteSpans(image,box.x-box.h*5,box.x,box.y-box.h*.7,box.y+box.h*1.1),candidates=[];
 for(let end=spans.length-1;end>=0;end--)for(let n=1;n<=4&&end-n+1>=0;n++){
  const group=spans.slice(end-n+1,end+1),x=group[0].x,y=Math.min(...group.map(b=>b.y)),w=group.at(-1).x+group.at(-1).w-x,h=Math.max(...group.map(b=>b.y+b.h))-y;candidates.push({x,y,w,h});
 }
 // A bright panel border can join every column in a projection. Connected ink
 // components isolate the EXP letters from that border instead of widening the crop.
 const left=Math.max(0,Math.floor(box.x-box.h*5)),top=Math.max(0,Math.floor(box.y-box.h*.7)),patch=crop(image,{x:left,y:top,w:box.x-left,h:box.h*1.8});
 const ink=components(patch,'white',0).map(b=>({...b,x:b.x+left,y:b.y+top}));candidates.push(...ink);
 // At some scales EX and P are disconnected, while a panel border joins the
 // column projection. Group aligned letter components before checking the label.
 for(const first of ink.filter(b=>b.h>=box.h*.65)){
  const row=ink.filter(b=>b.x>=first.x&&Math.abs(b.y-first.y)<=first.h*.2&&Math.abs(b.h-first.h)<=first.h*.25).sort((a,b)=>a.x-b.x);
  let right=first.x+first.w,bottom=first.y+first.h,top=first.y;
  for(const next of row.slice(1)){if(next.x-right>first.h*.35)break;right=Math.max(right,next.x+next.w);top=Math.min(top,next.y);bottom=Math.max(bottom,next.y+next.h);candidates.push({x:first.x,y:top,w:right-first.x,h:bottom-top});}
 }
 for(const {x,y,w,h} of candidates){
  if(h<box.h*.65||w/h<1.8||w/h>3.3||box.x-x-w>box.h*.8)continue;
  let error=0;for(let yy=0;yy<16;yy++)for(let xx=0;xx<36;xx++){const px=x+Math.min(w-1,Math.floor((xx+.5)*w/36)),py=y+Math.min(h-1,Math.floor((yy+.5)*h/16)),i=(py*image.width+px)*4,on=Math.min(image.data[i],image.data[i+1],image.data[i+2])>135;error+=Number(on)!==Number(expLabelMask[yy*36+xx]);}
  if(error/576<.24)return true;
 }
 return false;
}

// Locate the bold EXP label before asking any reader to decode its value.
function labelledExpBoxes(image,levelBox){
 if(!levelBox)return [];
 const ink=components(image,'white').filter(b=>b.h>=6&&b.h<=levelBox.h*1.5&&Math.abs(b.y-levelBox.y)<levelBox.h*1.5&&b.x>levelBox.x+levelBox.w),labels=[],out=[];
 for(const first of ink){
  const row=ink.filter(b=>b.x>=first.x&&Math.abs(b.y-first.y)<first.h*.2&&Math.abs(b.h-first.h)<first.h*.25).sort((a,b)=>a.x-b.x);let right=first.x+first.w;
  for(let n=0;n<Math.min(4,row.length);n++){
   const next=row[n];if(next.x-right>first.h*.4)break;right=Math.max(right,next.x+next.w);const w=right-first.x,h=first.h;if(w/h<1.8||w/h>3.3)continue;
   let error=0;for(let yy=0;yy<16;yy++)for(let xx=0;xx<36;xx++){const x=first.x+Math.min(w-1,Math.floor((xx+.5)*w/36)),y=first.y+Math.min(h-1,Math.floor((yy+.5)*h/16)),i=(y*image.width+x)*4;error+=Number(Math.min(image.data[i],image.data[i+1],image.data[i+2])>135)!==Number(expLabelMask[yy*36+xx]);}
   if(error/576<.24)labels.push({x:first.x,y:first.y,w,h});
  }
 }
 for(const label of labels){
  const left=label.x+label.w+1,top=Math.max(0,label.y-1),bottom=Math.min(image.height,label.y+label.h+2);let last=left,started=false,gap=0;
  for(let x=left;x<Math.min(image.width,left+label.h*24);x++){
   let on=false;for(let y=label.y;y<label.y+label.h;y++){const i=(y*image.width+x)*4,r=image.data[i],g=image.data[i+1],b=image.data[i+2];if((Math.min(r,g,b)>120&&Math.max(r,g,b)-Math.min(r,g,b)<65)||(g-r>8&&g-b>12)){on=true;break;}}
   if(on){last=x+1;started=true;gap=0;}else if(++gap>label.h*.8){break;}
  }
  if(started&&last-left>label.h*2)out.push({x:left,y:top,w:last-left+2,h:bottom-top});
 }return out;
}
function detectText(image,levelOcr,expOcr,previous){
 if(previous?.width===image.width&&previous?.height===image.height&&previous.level&&previous.exp){
  const box=r=>({x:Math.round(r.x*image.width),y:Math.round(r.y*image.height),w:Math.round(r.w*image.width),h:Math.round(r.h*image.height)}),l=box(previous.level),e=box(previous.exp),lr=levelOcr.recognize(crop(image,l)),er=expOcr.recognize(crop(image,e));
  if(/^\d{1,3}$/.test(lr.data.text)&&hasLvLabel(image,l)&&(/^\d[\d.]*\[\d+\.\d{2}%\]$/.test(er.text)||(/^(?:\[\d{1,3}\.\d{2}%\]|\d{1,3}\.\d{2}%)$/.test(er.text)&&hasExpLabel(image,e))))return {level:previous.level,exp:previous.exp};
 }
 const orange=components(image,'orange').filter(b=>b.h>=5&&b.h<=image.height*.09&&b.w>=b.h*.35&&b.w<=b.h*3.5),levels=[];
 for(const first of orange){const group=[first];let last=first;
  if(orange.some(b=>b.x+b.w<=first.x&&first.x-b.x-b.w<=first.h*.4&&Math.abs(b.y-first.y)<first.h*.2))continue;
  for(let n=0;n<2;n++){const next=orange.filter(b=>b.x>=last.x+last.w&&b.x-last.x-last.w<=first.h*.4&&Math.abs(b.y-first.y)<=first.h*.2&&Math.abs(b.h-first.h)<=first.h*.25).sort((a,b)=>a.x-b.x)[0];if(!next)break;group.push(next);last=next;}
  if(!hasLvLabel(image,first))continue;
  const box={x:Math.max(0,first.x-1),y:Math.max(0,first.y-1),w:last.x+last.w-first.x+2,h:Math.max(...group.map(b=>b.y+b.h))-first.y+2},read=levelOcr.recognize(crop(image,box));
  if(!read.expectedDigits)continue;
  levels.push({box,level:read.data.text,score:first.y/image.height+(read.data.text.includes('?')?0:1)+group.length*.05});
 }
 levels.sort((a,b)=>b.score-a.score);
 const row=levels[0]?.box;
 const brackets=components(image,'green').filter(b=>b.h>=2&&b.h<=image.height*.06&&b.w<=b.h&&(!row||(b.x>row.x+row.w&&Math.abs(b.y-row.y)<row.h*2))).sort((a,b)=>b.y-a.y).slice(0,256),exps=[];
 for(const left of brackets)for(const right of brackets){
  const h=Math.max(left.h,right.h),gap=right.x-left.x-left.w;
  if(gap<h*2.5||gap>h*22||Math.abs(left.y-right.y)>h*.3||Math.abs(left.h-right.h)>h*.4)continue;
  const nearby=h<4?whiteSpans(image,left.x,right.x,left.y-h,left.y+h*2).filter(b=>b.h>=h&&b.h<=h*3):[];
  const textHeight=Math.max(h,...nearby.map(b=>b.h)),y=Math.max(0,Math.min(left.y,right.y,...nearby.map(b=>b.y))-1),bottom=Math.min(image.height,Math.max(left.y+left.h,right.y+right.h,...nearby.map(b=>b.y+b.h))+1),spans=whiteSpans(image,left.x-textHeight*14,left.x,y,bottom);
  const heights=whiteSpans(image,left.x+left.w,right.x,y,bottom).map(b=>b.h).filter(v=>v>=h*.5).sort((a,b)=>a-b),glyphHeight=heights[Math.floor(heights.length/2)]||h;
  // The bold EXP label is taller/wider than the numeric font. Never rank a truncated suffix above a longer uncertain amount.
  for(const span of spans){let fullHeight=span.h;for(let x=span.x;x<span.x+span.w;x++){let top=span.y;for(let yy=span.y;yy>=Math.max(0,y-h*.7);yy--){const i=(Math.floor(yy)*image.width+x)*4,r=image.data[i],g=image.data[i+1],b=image.data[i+2];if(Math.min(r,g,b)<=135||Math.max(r,g,b)-Math.min(r,g,b)>=65)break;top=yy;}fullHeight=Math.max(fullHeight,span.y+span.h-top);}if(span.h<h*.5||fullHeight>glyphHeight*1.15||span.w>glyphHeight*1.3)continue;const box={x:Math.max(0,span.x-1),y,w:right.x+right.w-span.x+3,h:bottom-y},read=expOcr.recognize(crop(image,box));
   if(/^\d[\d.]*\[\d+\.\d{2}%\]$/.test(read.text))exps.push({box,complete:true,score:read.text.length*20+5+read.confidence/100+left.y/image.height});
   else if(/^[\d?][\d.?]*\[[\d.?]+%\]$/.test(read.text))exps.push({box,score:read.text.length*20+read.confidence/100+left.y/image.height});
  }
 }
 // Percentage-only text still needs its EXP label and a recognizable EXP label.
 // This prevents a cropped full reading or an HP/MP percentage becoming estimated EXP.
 if(!exps.some(e=>e.complete)){
  const levelBox=levels[0]?.box;
  const consider=box=>{const read=expOcr.recognize(crop(image,box)),clear=/^(?:\[\d{1,3}\.\d{2}%\]|\d{1,3}\.\d{2}%)$/.test(read.text),uncertain=/^\[[\d?.]{3,7}[%?]\]$/.test(read.text);
   // Locate the labelled HUD even when recognition is uncertain. Saving still
   // requires the strict parser and frame agreement; detection never repairs text.
   if((clear||uncertain)&&hasExpLabel(image,box))exps.push({box,score:(clear?200:0)+read.text.length*20+read.confidence/100});};
  for(const left of brackets)for(const right of brackets){const h=Math.max(left.h,right.h);if(right.x-left.x<h*3||right.x-left.x>h*14||Math.abs(left.y-right.y)>h*.3||Math.abs(left.h-right.h)>h*.6)continue;const top=Math.max(0,Math.min(left.y,right.y)-Math.ceil(h*.25));consider({x:left.x-1,y:top,w:right.x+right.w-left.x+3,h:Math.max(left.y+left.h,right.y+right.h)+2-top});}
  if(levelBox)for(const glyph of components(image,'white').filter(b=>b.h>=5&&b.w/b.h>.3&&b.w/b.h<1.5&&b.x>levelBox.x+levelBox.w&&Math.abs(b.y-levelBox.y)<levelBox.h*1.5)){
   const y=glyph.y-1,bottom=glyph.y+glyph.h+1;
   for(const span of whiteSpans(image,glyph.x-glyph.h*7,glyph.x,y,bottom)){if(span.h<glyph.h*.5)continue;consider({x:span.x-1,y,w:glyph.x+glyph.w-span.x+2,h:bottom-y});}
  }
 }
 if(!exps.length)for(const box of labelledExpBoxes(image,levels[0]?.box))exps.push({box,score:1});
 exps.sort((a,b)=>b.score-a.score);
 return {level:levels[0]?normal(levels[0].box,image):null,exp:exps[0]?normal(exps[0].box,image):null};
}
// Register the native HUD using the red Cash Shop panel and its two blue
// neighbors. Geometry proposes a search area; it never supplies digit labels.
function anchors(image){
 // Coarse alignment only: always read actual glyphs at native resolution.
 if(image.width>1600){
  const scale=1600/image.width,width=1600,height=Math.max(1,Math.round(image.height*scale)),data=new Uint8ClampedArray(width*height*4);
  for(let y=Math.floor(height*.65);y<height;y++)for(let x=0;x<width;x++){const i=(Math.min(image.height-1,Math.floor(y/scale))*image.width+Math.floor(x/scale))*4,j=(y*width+x)*4;data[j]=image.data[i];data[j+1]=image.data[i+1];data[j+2]=image.data[i+2];data[j+3]=255;}
  return anchors({width,height,data}).map(b=>({x:b.x/scale,y:b.y/scale,w:b.w/scale,h:b.h/scale,area:b.area/(scale*scale)}));
 }
 const blue=(x,y)=>{x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=image.width||y>=image.height)return false;const i=(y*image.width+x)*4,r=image.data[i],g=image.data[i+1],b=image.data[i+2];return b>90&&b>r*1.4&&g>r*1.2;};
 return components(image,'cash').filter(b=>{
  if(b.h<12||b.w/b.h<1.6||b.w/b.h>2.6||b.area/(b.w*b.h)<.35)return false;
  // Sample the plain upper corners, avoiding each button's central icon/text.
  return [1,2].every(n=>[.12,.85].filter(t=>blue(b.x+b.w*(n+t),b.y+b.h*.18)).length===2);
 }).sort((a,b)=>b.y-a.y);
}
function detect(image,levelOcr,expOcr,previous){
 if(previous?.width===image.width&&previous?.height===image.height&&previous.level&&previous.exp){
  const box=r=>({x:r.x*image.width,y:r.y*image.height,w:r.w*image.width,h:r.h*image.height}),l=box(previous.level),e=box(previous.exp);
  if(hasLvLabel(image,l)&&hasExpLabel(image,e))return {level:previous.level,exp:previous.exp};
 }
 for(const button of anchors(image)){
  const x=Math.max(0,Math.floor(button.x-button.w*9)),y=Math.max(0,Math.floor(button.y-button.h*3)),patch=crop(image,{x,y,w:button.x-x,h:button.h*4.2});
  const found=detectText(patch,levelOcr,expOcr);
  // When labels are too small to match, the independently checked control
  // row still defines conservative field windows. Readers may reject the ink.
  if(!found.level){
   const tiles=components(patch,'orange',0).filter(t=>Math.abs((x+t.x)-(button.x-button.w*7.25))<button.w*.65&&Math.abs((y+t.y)-(button.y+button.h*.3))<button.h*.35&&t.h>button.h*.2&&t.h<button.h*.8);
   if(tiles.length){const l=Math.min(...tiles.map(t=>t.x)),top=Math.min(...tiles.map(t=>t.y)),r=Math.max(...tiles.map(t=>t.x+t.w)),bottom=Math.max(...tiles.map(t=>t.y+t.h));found.level=normal({x:l-1,y:top-1,w:r-l+2,h:bottom-top+2},patch);}
  }
  if(!found.exp)found.exp=normal({x:button.x-x-button.w*1.58,y:button.y-y,w:button.w*1.48,h:button.h*.48},patch);
  if(!found.level)continue;
  const map=r=>({x:(x+r.x*patch.width)/image.width,y:(y+r.y*patch.height)/image.height,w:r.w*patch.width/image.width,h:r.h*patch.height/image.height});
  const level=map(found.level),exp=map(found.exp);
  // The native panels must share a row and retain the fixed left-to-right order.
  if(level.x>=exp.x||Math.abs(level.y-exp.y)*image.height>button.h*.6||exp.x*image.width<button.x-button.w*2.5)continue;
  return {level,exp};
 }
 return detectText(image,levelOcr,expOcr,previous);
}
return {detect,crop,anchors};
});
