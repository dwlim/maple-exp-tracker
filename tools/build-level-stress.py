from PIL import Image
from pathlib import Path
import json
out=[]
for f in json.loads(Path('tools/level-font-fixtures.local.json').read_text()):
 im=Image.frombytes('RGBA',(f['width'],f['height']),bytes(f['data']))
 for scale in [1.25,1.5]:
  for method in [Image.Resampling.NEAREST,Image.Resampling.BILINEAR]:
   resized=im.resize((round(im.width*scale),round(im.height*scale)),method)
   out.append({'width':resized.width,'height':resized.height,'data':list(resized.tobytes()),'expected':f['expected'],'scale':scale,'method':str(method)})
Path('tools/level-scale-fixtures.local.json').write_text(json.dumps(out))
