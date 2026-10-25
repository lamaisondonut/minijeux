"""Build a practice-only, offline expedition demo from unchanged original artwork."""
from pathlib import Path
import base64,json,re,shutil
root=Path(__file__).resolve().parents[1]
source=root/'v3';target=root/'work'/'expedition-demo'
target.mkdir(parents=True,exist_ok=True)
html=(source/'index.html').read_text()
images={}
for name in ['jacques-atlas.png','forest-panorama.png','forest-landscape.png','forest-trees.png']:
 images['assets/'+name]='data:image/png;base64,'+base64.b64encode((source/'assets'/name).read_bytes()).decode('ascii')
blob=json.dumps({'images':images,'jacques':json.loads((source/'assets/jacques-atlas.json').read_text())},ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')
html=html.replace('<script src="mechanics.js"></script>','<script>window.BorealEmbeddedAssets='+blob+';</script>\n<script src="mechanics.js"></script>')
for name in ['mechanics.js','expeditions.js','scenery.js','jacques.js']:
 script=(source/name).read_text()
 if re.search(r'</script',script,re.I):raise ValueError(name)
 html=html.replace('<script src="'+name+'"></script>','<script>\n'+script+'\n</script>')
assert not re.search(r'<script\b[^>]*\bsrc=',html,re.I)
(target/'index.html').write_text(html)
controller=(source/'essais.html').read_text().replace('href="/?','href="./index.html?').replace('href="/"','href="./index.html"')
(target/'essais.html').write_text(controller)
(target/'LISEZ-MOI.txt').write_text('LE DÉFI BORÉAL — EXPÉDITIONS, VERSION D’ESSAI\n\nExtraire complètement le ZIP, puis ouvrir essais.html dans Chrome, Edge ou Safari.\nChaque parcours se joue sans compte et sans connexion réseau.\nLes récompenses affichées en fin de partie sont fictives. Aucun code réel n’est émis.\nLe jeu publié, Netlify, Framer et le budget du restaurant ne sont pas modifiés.\nLes scénarios d’essai sont expliqués seulement sur la page essais.html.\n')
print(target)
