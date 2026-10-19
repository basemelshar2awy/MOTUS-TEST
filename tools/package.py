#!/usr/bin/env python3
"""Builds the two release ZIPs.  python3 tools/package.py [outdir]
 motus-fleet-source-<ver>.zip      complete source (server, web, tests, migrations, docs, deploy scripts, vendored pg)
 motus-fleet-windows-x64-<ver>.zip extracts into C:\\Website\\Motus (app\\server.js, iis\\web.config, Start-Motus.cmd ...)"""
import os, sys, json, zipfile, hashlib, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(ROOT), 'out')
os.makedirs(OUT, exist_ok=True)
ver = json.load(open(os.path.join(ROOT, 'package.json')))['version']
WIN = os.path.join(ROOT, 'deploy', 'windows')
SKIP_NAMES = {'.DS_Store', 'Thumbs.db'}
SKIP_DIRS = {'__pycache__', '.git'}
FIXED = (2026, 10, 17, 0, 0, 0)

def walk(base):
    for d, dirs, files in os.walk(base):
        dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS)
        for f in sorted(files):
            if f in SKIP_NAMES or f.endswith('.pyc'): continue
            yield os.path.join(d, f)

def data_for(path):
    b = open(path, 'rb').read()
    if path.endswith(('.ps1', '.cmd', '.bat', '.txt', '.config')) and (os.sep + 'windows' + os.sep in path or path.endswith('.config')):
        b = b.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')   # Windows line endings for Windows files
    return b

def add(z, arc, b):
    zi = zipfile.ZipInfo(arc.replace(os.sep, '/'), FIXED); zi.compress_type = zipfile.ZIP_DEFLATED; zi.external_attr = 0o644 << 16
    z.writestr(zi, b)
def add_dir(z, arc):
    zi = zipfile.ZipInfo(arc.rstrip('/') + '/', FIXED); zi.external_attr = (0o40755 << 16) | 0x10; z.writestr(zi, b'')

def check_no_secrets(entries):
    bad = []
    for arc, b in entries:
        low = arc.lower()
        if low.endswith(('.pfx', '.key', '.pem', '.p12')) or low.endswith('motus.env') or 'initial-credentials' in low or 'postgres-superuser' in low or low.endswith('.dump'):
            bad.append(arc)
    if bad: raise SystemExit('refusing to package secret-looking files: ' + ', '.join(bad))

# ---------------- deployment package
dep = []
def put(arc, path): dep.append((arc, data_for(path)))
for sub in ('server', 'web', 'node_modules'):
    for p in walk(os.path.join(ROOT, sub)): put('app/' + os.path.relpath(p, ROOT), p)
put('app/server.js', os.path.join(ROOT, 'server.js')); put('app/package.json', os.path.join(ROOT, 'package.json'))
put('iis/web.config', os.path.join(WIN, 'iis', 'web.config')); put('iis/motus-iis-check.txt', os.path.join(WIN, 'iis', 'motus-iis-check.txt'))
for p in walk(os.path.join(WIN, 'scripts')): put('scripts/' + os.path.relpath(p, os.path.join(WIN, 'scripts')), p)
for f in sorted(os.listdir(WIN)):
    fp = os.path.join(WIN, f)
    if os.path.isfile(fp) and f.endswith(('.ps1', '.cmd', '.html', '.txt')): put(f, fp)
put('config/motus.env.example', os.path.join(WIN, 'config', 'motus.env.example'))
for p in walk(os.path.join(ROOT, 'docs')): put('docs/' + os.path.relpath(p, os.path.join(ROOT, 'docs')), p)
dep.append(('VERSION.txt', ('MOTUS Fleet %s\r\nBuilt %s UTC\r\n' % (ver, time.strftime('%Y-%m-%d %H:%M', time.gmtime()))).encode()))
manifest = ''.join('%s  %s\n' % (hashlib.sha256(b).hexdigest(), a) for a, b in sorted(dep))
dep.append(('MANIFEST.sha256', manifest.replace('\n', '\r\n').encode()))
check_no_secrets(dep)
dz = os.path.join(OUT, 'motus-fleet-windows-x64-%s.zip' % ver)
with zipfile.ZipFile(dz, 'w') as z:
    for d in ('config', 'logs', 'backups', 'runtime'): add_dir(z, d)
    for a, b in dep: add(z, a, b)

# ---------------- source package
src = []
top = 'motus-fleet-%s/' % ver
for sub in ('server', 'web', 'test', 'deploy', 'docs', 'node_modules', 'tools'):
    for p in walk(os.path.join(ROOT, sub)): src.append((top + os.path.relpath(p, ROOT), data_for(p)))
for f in ('server.js', 'package.json', 'README.md'):
    if os.path.exists(os.path.join(ROOT, f)): src.append((top + f, open(os.path.join(ROOT, f), 'rb').read()))
check_no_secrets([(a[len(top):], b) for a, b in src])
sz = os.path.join(OUT, 'motus-fleet-source-%s.zip' % ver)
with zipfile.ZipFile(sz, 'w') as z:
    for a, b in src: add(z, a, b)
for p in (dz, sz): print('%s  %.1f MB  %s' % (hashlib.sha256(open(p, 'rb').read()).hexdigest()[:16], os.path.getsize(p) / 1e6, p))
