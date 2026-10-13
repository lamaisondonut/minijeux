"""Package frontend and complete source without credentials or development caches."""
from pathlib import Path
import zipfile
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
dist = root / 'dist'
dist.mkdir(exist_ok=True)

def write_archive(target, files):
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
        for source, relative in files:
            archive.write(source, str(relative))
    with zipfile.ZipFile(target) as archive:
        assert archive.testzip() is None, 'Corrupt ZIP'
    print(target.name, target.stat().st_size, 'bytes')

subprocess.run([sys.executable, str(root / 'scripts/build-standalone.py')], check=True)
standalone = root / 'downloads/defi-boreal-v3-autonome.html'
# One-file index works even when the OS opens an isolated file from a ZIP.
write_archive(dist / 'defi-boreal-v3-jouable.zip', [(standalone, 'index.html')])
write_archive(root / 'downloads/defi-boreal-v3-autonome.zip', [(standalone, 'index.html')])
files = []
# Explicit project members: no .git, uploads, credential files, caches or previous ZIPs.
for name in ['README.md', 'CHANGELOG.md', 'package.json', 'package-lock.json', '.gitignore']:
    files.append((root / name, name))
for directory in ['current', 'v3', 'versions', 'docs', 'tests', 'scripts', 'artifacts/v3']:
    for p in sorted((root / directory).rglob('*')):
        if p.is_file():
            files.append((p, p.relative_to(root)))
files.append((standalone, 'downloads/defi-boreal-v3-autonome.html'))
write_archive(dist / 'defi-boreal-v3-projet.zip', files)
