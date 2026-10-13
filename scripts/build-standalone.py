"""Build a single playable HTML with no external assets or runtime requests."""
from pathlib import Path
import base64
import json
import re

root = Path(__file__).resolve().parents[1]
source = root / 'v3'
html = (source / 'index.html').read_text()
images = {}
for name in ['jacques-atlas.png', 'forest-panorama.png', 'forest-landscape.png', 'forest-trees.png']:
    images['assets/' + name] = 'data:image/png;base64,' + base64.b64encode((source / 'assets' / name).read_bytes()).decode('ascii')
embedded = {
    'images': images,
    'jacques': json.loads((source / 'assets/jacques-atlas.json').read_text()),
}
blob = json.dumps(embedded, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
html = html.replace('<script src="mechanics.js"></script>', '<script>window.BorealEmbeddedAssets=' + blob + ';</script>\n<script src="mechanics.js"></script>')
for name in ['mechanics.js', 'scenery.js', 'jacques.js']:
    text = (source / name).read_text()
    if re.search(r'</script', text, re.I):
        raise ValueError('Unescaped script closing sequence: ' + name)
    html = html.replace('<script src="' + name + '"></script>', '<script>\n' + text + '\n</script>')
if re.search(r'<script\b[^>]*\bsrc=', html, re.I):
    raise ValueError('External script remains in standalone')
target = root / 'downloads' / 'defi-boreal-v3-autonome.html'
target.parent.mkdir(exist_ok=True)
target.write_text(html)
print(target.name, target.stat().st_size, 'bytes; all images and scripts embedded')
