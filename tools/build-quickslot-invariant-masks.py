"""Adapt MIT-licensed invariant glyph masks to the measured native count grid.
Usage: python tools/build-quickslot-invariant-masks.py /path/to/potion_digits.npz
Input is data only (NumPy pickle loading is disabled). See third_party notice.
"""
import hashlib,json,math,sys
from pathlib import Path
import numpy as np
source=Path(sys.argv[1]);z=np.load(source,allow_pickle=False);glyphs={}
for digit in '0123456789':
 mask=z['m'+digit];width=3 if digit=='1' else 7;out=[]
 # Native digits advance 8 px, or 5 for 1. Their body starts after the
 # reference model's five rows above the text; retain only invariant corners.
 for y in range(1,10):
  for x in range(2,width+2):
   xx=(x-1)*(7/5 if digit=='1' else 11/8);yy=5+y*13/10
   samples=[mask[r,c] for r in {math.floor(yy),math.ceil(yy)} for c in {math.floor(xx),math.ceil(xx)} if r<mask.shape[0] and c<mask.shape[1]]
   out.append(int(bool(samples) and min(samples)>.9))
 glyphs[digit]=out
output={'source':'https://github.com/beanguri/Maple-Classic-Exp-Overlay/blob/main/assets/potion_digits.npz','sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'license':'MIT; see third_party/maple-classic-exp-overlay/LICENSE.txt','glyphs':glyphs}
Path(__file__).with_name('quickslot-invariant-masks.json').write_text(json.dumps(output,indent=2)+'\n',encoding='utf-8')
