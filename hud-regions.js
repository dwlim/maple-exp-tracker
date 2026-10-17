(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MapleHudRegions=api;})(typeof window==='undefined'?globalThis:window,function(){
function crop(image,box){
 const x=Math.max(0,Math.floor(box.x)),y=Math.max(0,Math.floor(box.y)),width=Math.max(1,Math.min(image.width-x,Math.ceil(box.w))),height=Math.max(1,Math.min(image.height-y,Math.ceil(box.h))),data=new Uint8ClampedArray(width*height*4);
 for(let row=0;row<height;row++)data.set(image.data.slice(((y+row)*image.width+x)*4,((y+row)*image.width+x+width)*4),row*width*4);
 return {width,height,data};
}
function components(image,kind){
 const {width,height,data}=image,top=Math.floor(height*.65),h=height-top,mask=new Uint8Array(width*h),out=[];
 for(let y=top;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,r=data[i],g=data[i+1],b=data[i+2];mask[(y-top)*width+x]=kind==='orange'?(r>100&&g/r>.25&&g/r<.85&&b/r<.4):(g-r>12&&g-b>20);}
 for(let seed=0;seed<mask.length;seed++)if(mask[seed]){const queue=[seed];mask[seed]=0;let l=width,r=0,t=h,b=0;
  for(let head=0;head<queue.length;head++){const i=queue[head],x=i%width,y=Math.floor(i/width);l=Math.min(l,x);r=Math.max(r,x+1);t=Math.min(t,y);b=Math.max(b,y+1);
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy,j=ny*width+nx;if(nx>=0&&nx<width&&ny>=0&&ny<h&&mask[j]){mask[j]=0;queue.push(j);}}
  }
  if(queue.length>=3)out.push({x:l,y:t+top,w:r-l,h:b-t,area:queue.length});
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

function detect(image,levelOcr,expOcr,previous){
 if(previous?.width===image.width&&previous?.height===image.height&&previous.level&&previous.exp){
  const box=r=>({x:Math.round(r.x*image.width),y:Math.round(r.y*image.height),w:Math.round(r.w*image.width),h:Math.round(r.h*image.height)}),l=box(previous.level),e=box(previous.exp),lr=levelOcr.recognize(crop(image,l)),er=expOcr.recognize(crop(image,e));
  if(/^\d{1,3}$/.test(lr.data.text)&&hasLvLabel(image,l)&&/^\d[\d.]*\[\d+\.\d{2}%\]$/.test(er.text))return {level:previous.level,exp:previous.exp};
 }
 const orange=components(image,'orange').filter(b=>b.h>=5&&b.h<=image.height*.09&&b.w>=b.h*.35&&b.w<=b.h*3.5),levels=[];
 for(const first of orange){const group=[first];let last=first;
  if(orange.some(b=>b.x+b.w<=first.x&&first.x-b.x-b.w<=first.h*.4&&Math.abs(b.y-first.y)<first.h*.2))continue;
  for(let n=0;n<2;n++){const next=orange.filter(b=>b.x>=last.x+last.w&&b.x-last.x-last.w<=first.h*.4&&Math.abs(b.y-first.y)<=first.h*.2&&Math.abs(b.h-first.h)<=first.h*.25).sort((a,b)=>a.x-b.x)[0];if(!next)break;group.push(next);last=next;}
  if(!hasLvLabel(image,first))continue;
  const box={x:Math.max(0,first.x-1),y:Math.max(0,first.y-1),w:last.x+last.w-first.x+2,h:Math.max(...group.map(b=>b.y+b.h))-first.y+2},read=levelOcr.recognize(crop(image,box));
  if(!read.expectedDigits)continue;
  levels.push({box,score:first.y/image.height+(read.data.text.includes('?')?0:1)+group.length*.05});
 }
 levels.sort((a,b)=>b.score-a.score);
 const brackets=components(image,'green').filter(b=>b.h>=2&&b.h<=image.height*.06&&b.w<=b.h),exps=[];
 for(const left of brackets)for(const right of brackets){
  const h=Math.max(left.h,right.h),gap=right.x-left.x-left.w;
  if(gap<h*2.5||gap>h*22||Math.abs(left.y-right.y)>h*.3||Math.abs(left.h-right.h)>h*.4)continue;
  const nearby=h<4?whiteSpans(image,left.x,right.x,left.y-h,left.y+h*2).filter(b=>b.h>=h&&b.h<=h*3):[];
  const textHeight=Math.max(h,...nearby.map(b=>b.h)),y=Math.max(0,Math.min(left.y,right.y,...nearby.map(b=>b.y))-1),bottom=Math.min(image.height,Math.max(left.y+left.h,right.y+right.h,...nearby.map(b=>b.y+b.h))+1),spans=whiteSpans(image,left.x-textHeight*14,left.x,y,bottom);
  const heights=whiteSpans(image,left.x+left.w,right.x,y,bottom).map(b=>b.h).filter(v=>v>=h*.5).sort((a,b)=>a-b),glyphHeight=heights[Math.floor(heights.length/2)]||h;
  // The bold EXP label is taller/wider than the numeric font. Never rank a truncated suffix above a longer uncertain amount.
  for(const span of spans){if(span.h<h*.5||span.h>glyphHeight*1.15||span.w>glyphHeight*1.3)continue;const box={x:Math.max(0,span.x-1),y,w:right.x+right.w-span.x+3,h:bottom-y},read=expOcr.recognize(crop(image,box));
   if(/^\d[\d.]*\[\d+\.\d{2}%\]$/.test(read.text))exps.push({box,score:read.text.length*20+5+read.confidence/100+left.y/image.height});
   else if(/^[\d?][\d.?]*\[[\d.?]+%\]$/.test(read.text))exps.push({box,score:read.text.length*20+read.confidence/100+left.y/image.height});
  }
 }
 exps.sort((a,b)=>b.score-a.score);
 return {level:levels[0]?normal(levels[0].box,image):null,exp:exps[0]?normal(exps[0].box,image):null};
}
return {detect,crop};
});
