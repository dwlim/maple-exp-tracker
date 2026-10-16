from PIL import Image,ImageDraw
from pathlib import Path
import json
root=Path(r'C:\Program Files (x86)\Steam\steamapps\common\MapleStory\MSCW')
files=list(root.glob('Maple_*.jpg'))
out=Image.new('RGB',(1000,len(files)*60),'#222222');d=ImageDraw.Draw(out)
items=[]
for i,p in enumerate(files):
 im=Image.open(p);w,h=im.size
 # HUD is centered and bottom anchored at native screenshot resolution.
 box=(int(w*.527),int(h*.954),int(w*.622),int(h*.98))
 crop=im.crop(box);crop.thumbnail((600,50));crop=crop.resize((crop.width*2,crop.height*2)) if crop.height<25 else crop
 out.paste(crop,(220,i*60));d.text((5,i*60+10),str(i)+' '+p.name,fill='white')
 items.append({'path':str(p),'size':[w,h],'box':box})
Path('tools/font-captures.json').write_text(json.dumps(items))
out.save('tools/font-contact-sheet.png')
