#!/usr/bin/env python3
"""Convert Phosphor / TMA icon SVGs (public/images/icons/**) to Android VectorDrawables.

    python3 android/tools/svg2vector.py House ChartPieSlice tma/Rightbar ...

Each name is looked up as public/images/icons/phosphor/<Name>.svg unless it carries a
folder prefix (tma/Rightbar). Output: android/core/ui/src/main/res/drawable/ic_<snake>.xml.
The set is path-only (a handful of <rect>/<g> wrappers), so this handles exactly that and
refuses anything else rather than emitting a wrong drawing. Icons are drawn in ink and
tinted at use, the masked-span rule of the web (memory: icons must be masked spans).
"""
import os, re, sys, html

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'public', 'images', 'icons')
OUT = os.path.join(ROOT, 'android', 'core', 'ui', 'src', 'main', 'res', 'drawable')

def snake(name):
    s = re.sub(r'[^A-Za-z0-9]+', '_', name)
    s = re.sub(r'(?<=[a-z0-9])(?=[A-Z])', '_', s).lower()
    return re.sub(r'_+', '_', s).strip('_')

def convert(name):
    folder, base = ('phosphor', name) if '/' not in name else name.split('/', 1)
    path = os.path.join(SRC, folder, base + '.svg')
    svg = open(path).read()
    vb = re.search(r'viewBox="([\d.\s-]+)"', svg)
    minx, miny, w, h = (float(x) for x in vb.group(1).split()) if vb else (0, 0, 256, 256)
    body = re.sub(r'<svg[^>]*>|</svg>', '', svg)
    body = re.sub(r'<(g|/g)[^>]*>', '', body)           # plain wrappers only
    if re.search(r'<(circle|line|polyline|polygon|ellipse|text|use|defs|style)\b', body):
        raise SystemExit(f'{name}: unsupported element; convert it in Android Studio instead')
    paths = []
    for m in re.finditer(r'<path\b([^>]*)/?>', body):
        attrs = m.group(1)
        d = re.search(r'\bd="([^"]+)"', attrs)
        if not d: continue
        if re.search(r'\bstroke="(?!none)', attrs):
            raise SystemExit(f'{name}: stroked path; convert it in Android Studio instead')
        paths.append(('path', d.group(1).strip()))
    for m in re.finditer(r'<rect\b([^>]*)/?>', body):
        a = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
        x, y, rw, rh = (float(a.get(k, 0)) for k in ('x', 'y', 'width', 'height'))
        paths.append(('path', f'M{x},{y}h{rw}v{rh}h{-rw}z'))
    if not paths:
        raise SystemExit(f'{name}: nothing drawable found')
    out = [f'<vector xmlns:android="http://schemas.android.com/apk/res/android"',
           f'    android:width="24dp" android:height="24dp"',
           f'    android:viewportWidth="{w:g}" android:viewportHeight="{h:g}">']
    for _, d in paths:
        out.append(f'    <path android:fillColor="@android:color/black" android:pathData="{html.escape(d, quote=True)}"/>')
    out.append('</vector>')
    os.makedirs(OUT, exist_ok=True)
    dest = os.path.join(OUT, f'ic_{snake(base)}.xml')
    open(dest, 'w').write('\n'.join(out) + '\n')
    return os.path.relpath(dest, ROOT)

if __name__ == '__main__':
    failed = []
    for n in sys.argv[1:]:
        try:
            print(convert(n))
        except SystemExit as e:
            failed.append(str(e)); print('skip:', e, file=sys.stderr)
    if failed: sys.exit(1)
