#!/usr/bin/env python3
"""Generate core/ui/.../theme/Tokens.kt from design/tokens.json.

Run from the repository root or from android/:  python3 android/tools/gen_tokens.py
The dark palette is not in tokens.json; it comes from public/css/dashboard.css
(.tma-dash[data-theme="dark"]) and is transcribed in DARK below. Keep the two in step.
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
TOKENS = os.path.join(ROOT, 'design', 'tokens.json')
OUT = os.path.join(HERE, '..', 'core', 'ui', 'src', 'main', 'kotlin', 'com', 'tmantoinelaw', 'portal', 'core', 'ui', 'theme', 'Tokens.kt')

T = json.load(open(TOKENS))

def argb(v):
    v = v.strip()
    if v.startswith('#'):
        h = v[1:]
        if len(h) == 3: h = ''.join(c * 2 for c in h)
        return 0xFF000000 | int(h, 16)
    m = re.match(r'rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)', v)
    if not m: raise SystemExit('unparseable colour ' + v)
    r, g, b = int(m[1]), int(m[2]), int(m[3])
    a = round(float(m[4]) * 255) if m[4] is not None else 255
    return (a << 24) | (r << 16) | (g << 8) | b

def mix(hexa, hexb, pct_a):
    """color-mix(in srgb, A pct, B) with both opaque."""
    a = argb(hexa); b = argb(hexb)
    ch = lambda c, s: (c >> s) & 0xFF
    out = 0xFF000000
    for s in (16, 8, 0):
        out |= round(ch(a, s) * pct_a + ch(b, s) * (1 - pct_a)) << s
    return out

def kcol(v): return 'Color(0x%08X)' % v

C = T['colors']; brand, accent, surface, inter, text, border, chart = (C[k] for k in ('brand', 'accent', 'surface', 'interactive', 'text', 'border', 'chart'))

# Light values not in tokens.json (public/css/tokens.css, dashboard.css :root).
LIGHT = {
    'page': argb(surface['page']), 'surface': argb(brand['white']), 'card': argb(surface['card']), 'panel': argb(surface['card']),
    'input': argb(surface['input']), 'popup': argb(surface['popup']), 'popupGlass': argb(surface['popupGlass']), 'tooltip': argb(surface['tooltip']),
    'tag': argb(surface['tag']), 'code': argb(surface['code']),
    'ink': argb(text['primary']), 'inkSecondary': argb(text['secondary']), 'inkMuted': argb('rgba(0,0,0,0.55)'), 'placeholder': argb(text['placeholder']),
    'link': argb(text['link']), 'hint': argb(text['hint']),
    'borderSoft': argb(border['soft']), 'borderMedium': argb(border['medium']), 'borderStrong': argb(border['strong']), 'borderHeavy': argb('rgba(0,0,0,0.80)'),
    'hover': argb(inter['hover']), 'hoverDeep': argb(inter['hoverDeep']), 'active': argb(inter['active']), 'inactive': argb(inter['inactive']),
    'accentBg': (round(0.08 * 255) << 24) | (argb(brand['primaryDark']) & 0xFFFFFF), 'accentBgHover': (round(0.12 * 255) << 24) | (argb(brand['primaryDark']) & 0xFFFFFF),
    'dashCard1': argb('#e6f6fd'), 'dashCard2': argb('#e7f0f6'), 'kpi1': argb(brand['primary']), 'kpi2': argb(brand['primaryDark']),
}
# Dark values: public/css/dashboard.css `.tma-dash[data-theme="dark"]` and dashboard-tma-overrides.css:207.
DARK = {
    'page': argb('#161616'), 'surface': argb('#1c1c1c'), 'card': argb('#2a2a2c'), 'panel': argb('#232325'),
    'input': argb('rgba(255,255,255,0.07)'), 'popup': argb('rgba(40,40,42,0.92)'), 'popupGlass': argb('rgba(40,40,42,0.85)'), 'tooltip': argb(surface['tooltip']),
    'tag': mix(brand['primary'], '#1c1c1c', 0.16), 'code': argb('#111214'),
    'ink': argb('rgba(255,255,255,0.90)'), 'inkSecondary': argb('rgba(255,255,255,0.62)'), 'inkMuted': argb('rgba(255,255,255,0.55)'), 'placeholder': argb('rgba(255,255,255,0.25)'),
    'link': argb(brand['primary']), 'hint': argb(brand['primary']),
    'borderSoft': argb('rgba(255,255,255,0.12)'), 'borderMedium': argb('rgba(255,255,255,0.28)'), 'borderStrong': argb('rgba(255,255,255,0.45)'), 'borderHeavy': argb('rgba(255,255,255,0.85)'),
    'hover': argb('rgba(255,255,255,0.08)'), 'hoverDeep': argb('rgba(255,255,255,0.12)'), 'active': argb('rgba(255,255,255,0.16)'), 'inactive': argb('rgba(255,255,255,0.40)'),
    'accentBg': (round(0.16 * 255) << 24) | (argb(brand['primary']) & 0xFFFFFF), 'accentBgHover': (round(0.24 * 255) << 24) | (argb(brand['primary']) & 0xFFFFFF),
    'dashCard1': argb('#1e2b38'), 'dashCard2': argb('#29243a'), 'kpi1': argb('#0286bd'), 'kpi2': argb('#10557c'),
}

def palette(name, d):
    lines = [f'    object {name} {{']
    for k, v in d.items(): lines.append(f'        val {k} = {kcol(v)}')
    lines.append('    }')
    return '\n'.join(lines)

def colours(name, d):
    lines = [f'    object {name} {{']
    for k, v in d.items(): lines.append(f'        val {k} = {kcol(argb(v))}')
    lines.append('    }')
    return '\n'.join(lines)

ty = T['typography']
weights = {400: 'FontWeight.Normal', 600: 'FontWeight.SemiBold', 700: 'FontWeight.Bold'}
type_lines = ['    object Type {', '        data class Step(val size: Int, val lineHeight: Int, val weight: FontWeight)']
for k, s in ty['scale'].items():
    lh = s.get('lineHeight', s['size'] + 8)
    type_lines.append(f"        val {k} = Step({s['size']}, {lh}, {weights[s['weight']]})")
type_lines.append(f'        const val fontFeatures = "ss01, cv01"')
type_lines.append('    }')

space_lines = ['    object Space {'] + [f"        val s{k} = {v.replace('px', '')}.dp" for k, v in T['spacing'].items()] + ['    }']
radius_lines = ['    object Radius {'] + [f"        val r{k} = {v.replace('px', '')}.dp" if k != 'pill' else f"        val pill = {v.replace('px', '')}.dp" for k, v in T['borderRadius'].items()] + ['    }']
size_lines = ['    object Size {'] + [f"        val {k.replace('2xl', 'xxl').replace('3xl', 'xxxl')} = {v.replace('px', '')}.dp" for k, v in T['componentSizes'].items()] + ['    }']
btn = T['components']['button']['sizes']
btn_lines = ['    object Button {', '        data class Size(val minHeight: Int, val paddingX: Int, val paddingY: Int, val radius: Int, val fontSize: Int, val lineHeight: Int)']
for k, s in btn.items():
    btn_lines.append(f"        val {k} = Size({s['minHeight']}, {s['paddingX']}, {s['paddingY']}, {s['radius']}, {s['fontSize']}, {s['lineHeight']})")
btn_lines.append(f"        val textRadius = {T['components']['button']['textRadius'].replace('px','')}.dp")
btn_lines.append('    }')
comp = T['components']
misc = f'''    object Card {{ val radius = {comp['card']['radius']}.dp; val gap = {comp['card']['gap']}.dp }}
    object Input {{ val radius = {comp['input']['radius']}.dp }}
    object Tag {{ val radius = {comp['tag']['radius']}.dp }}
    object Tooltip {{ val radius = {comp['tooltip']['radius']}.dp; val paddingX = {comp['tooltip']['paddingX']}.dp; val paddingY = {comp['tooltip']['paddingY']}.dp; val maxWidth = {comp['tooltip']['maxWidth']}.dp; val arrow = {comp['tooltip']['arrowSize']}.dp }}
    object Popup {{ val widthCompact = {T['popup']['widthCompact']}.dp; val widthLarge = {T['popup']['widthLarge']}.dp; val radiusCompact = {T['popup']['radiusCompact']}.dp; val radiusLarge = {T['popup']['radiusLarge']}.dp }}
    object Layout {{ val contentMaxWidth = {T['layout']['contentMaxWidth']}.dp; val mobileWidth = {T['layout']['mobileWidth']}.dp }}
    object Motion {{ const val fastMs = 120; const val baseMs = 150 }}
    object Opacity {{ const val inactive = {T['opacity']['inactive']}f; const val white80 = {T['opacity']['white80']}f }}'''

out = f'''// GENERATED by android/tools/gen_tokens.py from design/tokens.json (fetched {T['source']['fetchedAt']}).
// Do not edit by hand: change design/tokens.json (or the DARK table in the generator) and regenerate.
package com.tmantoinelaw.portal.core.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

object Tokens {{
{colours('Brand', brand)}
{colours('Accent', accent)}
{colours('Chart', chart)}
{palette('Light', LIGHT)}
{palette('Dark', DARK)}
{chr(10).join(type_lines)}
{chr(10).join(space_lines)}
{chr(10).join(radius_lines)}
{chr(10).join(size_lines)}
{chr(10).join(btn_lines)}
{misc}
}}
'''
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, 'w').write(out)
print('wrote', os.path.relpath(OUT, ROOT), len(out.splitlines()), 'lines')
