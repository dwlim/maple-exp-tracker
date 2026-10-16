"""Extract HUD glyphs from local, manually transcribed game screenshots."""
from PIL import Image
from pathlib import Path
import json
items=json.loads(Path('tools/font-captures.json').read_text())
labels=['5|14.71%','1|1.75%','3|3.26%','2|1.48%','3|0.81%','22|3.93%','34|4.05%','39|2.27%','227|13.23%','15|0.64%','2|0.06%','11|0.26%','2|0.04%','9|0.13%','4|0.05%','5|0.05%','22|0.16%','5|0.03%','1|0.00%','13|0.05%','7|0.02%','5|0.01%','18|0.04%','13|0.03%','43|0.07%','26|0.04%','12|0.01%','16|0.02%','17,429|18.21%','18|0.02%']
templates=[];fixtures=[]
for index in range(len(items)):
 im=Image.open(items[index]['path']).convert('RGB');w,h=im.size
 x0,y0,x1,y1=round(w*.548),round(h*.962),round(w*.62),round(h*.975)
 im=im.crop((x0,y0,x1,y1));mask=[]
 for y in range(im.height):
  mask.append([int(min(im.getpixel((x,y)))>155 and max(im.getpixel((x,y)))-min(im.getpixel((x,y)))<65 and im.getpixel((x,y))[1]-im.getpixel((x,y))[0]<15) for x in range(im.width)])
 for x in range(im.width):
  green=sum(1 for y in range(im.height) if (lambda p:p[1]-p[0]>12 and p[1]-p[2]>20)(im.getpixel((x,y))))
  if green>=2:
   for y in range(im.height):mask[y][x]=0
 spans=[];start=None
 for x in range(im.width+1):
  on=x<im.width and any(row[x] for row in mask)
  if on and start is None:start=x
  if not on and start is not None:spans.append((start,x));start=None
 chars=labels[index].replace('|','')
 if len(spans)!=len(chars):raise ValueError((index,spans,chars))
 for char,(left,right) in zip(chars,spans):
  ys=[y for y in range(im.height) if any(mask[y][x] for x in range(left,right))];top,bottom=min(ys),max(ys)+1
  rows=[''.join('1' if mask[y][x] else '0' for x in range(left,right)) for y in range(top,bottom)]
  if index<17 or index in [17,22,25,28] or (index in [19,23] and char=='3') or (index in [19,21] and char=='5'):templates.append({'char':char,'rows':rows})
 fixtures.append({'width':im.width,'height':im.height,'data':[v for p in im.getdata() for v in (*p,255)],'expected':labels[index],'training':index<17 or index in [17,19,21,22,23,25,28]})
Path('tools/hud-font-templates.json').write_text(json.dumps(templates))
Path('tools/hud-font-fixtures.json').write_text(json.dumps(fixtures))
print(f'Built {len(templates)} glyph templates and {len(fixtures)} test crops (6 held out).')
