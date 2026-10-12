"""Package frontend and complete source without credentials or development caches."""
from pathlib import Path
import zipfile

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

frontend = root / 'v3'
write_archive(dist / 'defi-boreal-v3-jouable.zip', [
    (p, p.relative_to(frontend)) for p in sorted(frontend.rglob('*')) if p.is_file()
])
files = []
# Explicit project members: no .git, uploads, credential files, caches or previous ZIPs.
for name in ['README.md', 'CHANGELOG.md', 'package.json', 'package-lock.json', '.gitignore']:
    files.append((root / name, name))
for directory in ['current', 'v3', 'versions', 'docs', 'tests', 'scripts', 'artifacts/v3']:
    for p in sorted((root / directory).rglob('*')):
        if p.is_file():
            files.append((p, p.relative_to(root)))
write_archive(dist / 'defi-boreal-v3-projet.zip', files)
