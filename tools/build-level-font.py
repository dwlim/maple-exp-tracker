"""Build native soft-mask training crops from manually verified level labels."""
from PIL import Image
from pathlib import Path
import json
items=json.loads(Path('tools/font-captures.json').read_text())
labels=['2','3','4','5','6','7','8','10','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','27','28','29','30','30','31']
fixtures=[]
for i,(item,label) in enumerate(zip(items,labels)):
 im=Image.open(item['path']).convert('RGB');w,h=im.size
 x,y=round(w*.215),round(h*.942);im=im.crop((x,y,x+round(w*.055),y+round(h*.048)))
 fixtures.append({'width':im.width,'height':im.height,'data':[v for p in im.getdata() for v in (*p,255)],'expected':label,'training':i<17 or i in [17,18,19,22,24,25,26,27]})
Path('tools/level-font-fixtures.local.json').write_text(json.dumps(fixtures))
