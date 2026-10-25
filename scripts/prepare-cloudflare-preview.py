"""Stage the unchanged V3 for Pages; never create or deploy a remote project."""
from pathlib import Path
import hashlib
import json
import shutil

root = Path(__file__).resolve().parents[1]
source = root / 'v3'
target = root / 'dist' / 'cloudflare-preview'
files = sorted(p for p in source.rglob('*') if p.is_file())
if target.exists():
    raise SystemExit('Output already exists; choose a clean checkout to avoid overwriting files.')
target.mkdir(parents=True)
manifest = {}
for item in files:
    relative = item.relative_to(source)
    destination = target / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(item, destination)
    digest = hashlib.sha256(item.read_bytes()).hexdigest()
    assert hashlib.sha256(destination.read_bytes()).hexdigest() == digest
    assert destination.stat().st_size <= 25 * 1024 * 1024
    manifest[str(relative)] = digest
assert (target / 'index.html').is_file()
(target.parent / 'cloudflare-preview-sha256.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(f'{len(files)} unchanged files staged in {target}')
