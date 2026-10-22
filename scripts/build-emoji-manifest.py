#!/usr/bin/env python3
"""Regenerate renderer/fonts/emoji-manifest.js for the workspace glyph picker.

    python3 scripts/build-emoji-manifest.py [path/to/manifest.json]

Run it whenever renderer/fonts/WhitneysEmoji-colr.woff2 is replaced. Needs
fontTools (pip install fonttools), a DEV dependency only -- the output is
committed, so a normal build and a normal run never need it.

WHY THIS EXISTS AT ALL. The renderer cannot discover shortcodes at runtime: they
live in the font's GSUB ligature table, and the browser renders them without
ever telling JavaScript they exist. So the list has to ship as data.

WHY IT IS A SCRIPT AND NOT JSON. The renderer runs from a file:// origin, where
fetch() and XHR are blocked and ES module imports are fetched with CORS against
an opaque origin. A classic <script> has none of those problems and runs before
the deferred module, so the global is ready when renderer.js starts.

WHO IS THE AUTHORITY. emoji.whitneys.co owns the set and publishes the manifest;
its finish-font.py refuses to publish unless the manifest's code set equals the
ligature set read back from the font. Nothing here second-guesses its grouping or
naming -- "face" vs "shape" is not derivable from a font binary, so inventing it
locally would just be a guess that goes stale. What this script DOES do is refuse
to emit anything unless that upstream manifest actually describes the font we
embed. Two independent checks, because the font and the manifest are copied in
separate steps and nothing else would catch them drifting apart.
"""
import hashlib
import json
import pathlib
import sys

from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONT = ROOT / 'renderer' / 'fonts' / 'WhitneysEmoji-colr.woff2'
OUT = ROOT / 'renderer' / 'fonts' / 'emoji-manifest.js'
UPSTREAM = pathlib.Path(
    '/media/rwhitney/MIR/websites/emoji.whitneys.co/public/font/manifest.json')


def ligatures(font_path):
    """Every shortcode the font will actually render, read from GSUB."""
    f = TTFont(font_path, lazy=False)
    cmap = {}
    for t in f['cmap'].tables:
        cmap.update(t.cmap)
    rev = {}
    for cp, g in cmap.items():
        rev.setdefault(g, cp)
    out = set()
    for lk in f['GSUB'].table.LookupList.Lookup:
        for st in lk.SubTable:
            if st.__class__.__name__ == 'LigatureSubst':
                for first, ligs in st.ligatures.items():
                    for l in ligs:
                        glyphs = [first] + list(l.Component)
                        out.add(''.join(chr(rev[g]) for g in glyphs if g in rev).upper())
    return out


def main():
    src = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else UPSTREAM
    if not FONT.exists():
        sys.exit(f'font not found: {FONT}')
    if not src.exists():
        sys.exit(f'upstream manifest not found: {src}\n'
                 'Pass its path as an argument, or copy it from emoji.whitneys.co.')

    man = json.loads(src.read_text())
    if man.get('schema') != 1:
        sys.exit(f'unsupported manifest schema {man.get("schema")!r}; this script understands 1')

    # Check 1: the manifest is about the font we embed, not some other build.
    sha = hashlib.sha256(FONT.read_bytes()).hexdigest()
    if man['fonts']['colr']['sha256'] != sha:
        sys.exit('REFUSING: manifest describes a different font.\n'
                 f'  embedded {FONT.name}: {sha}\n'
                 f'  manifest fonts.colr : {man["fonts"]["colr"]["sha256"]}\n'
                 'Copy the matching font and manifest together, then re-run.')

    # Check 2: every code it claims is a code the font will really ligate.
    claimed = {c.upper() for b in man['bases'] for c in b['codes'].values()}
    real = ligatures(FONT)
    if claimed != real:
        sys.exit('REFUSING: manifest codes and font ligatures disagree.\n'
                 f'  only in manifest: {sorted(claimed - real)[:5]}\n'
                 f'  only in font    : {sorted(real - claimed)[:5]}')

    # The full codes map is 1,672 strings. It compresses to nothing because every
    # code is derivable: the bare ":name:" for a base's default colour and
    # ":name-colour:" otherwise. Derive it, then prove the derivation reproduces
    # the upstream map EXACTLY before shipping the smaller form -- so the renderer
    # gets an 8 KB file instead of 79 KB without anyone trusting a naming rule.
    def derive(base, colour):
        return f':{base["name"]}:' if colour == base['default'] else f':{base["name"]}-{colour}:'

    for b in man['bases']:
        for colour, code in b['codes'].items():
            if derive(b, colour) != code:
                sys.exit('REFUSING: the naming rule no longer holds, so the compact form '
                         f'would be wrong.\n  base {b["name"]!r} colour {colour!r}: '
                         f'manifest {code!r} != derived {derive(b, colour)!r}\n'
                         'Ship the full codes map instead of deriving it.')

    bases = []
    for b in man['bases']:
        row = {'n': b['name'], 'g': b['group'], 'd': b['default']}
        if b.get('style'):
            row['s'] = b['style']
        if b.get('char'):
            row['c'] = b['char']
        bases.append(row)

    payload = {
        'schema': 1,
        'font': FONT.name,
        'sha256': sha,
        'colours': man['colours'],
        'groups': man['groups'],
        'bases': bases,
    }
    OUT.write_text(
        '// GENERATED by scripts/build-emoji-manifest.py -- do not edit by hand.\n'
        f'// Source: {src}\n'
        f'// Describes {FONT.name} sha256 {sha}\n'
        '// A code is ":name:" for the base\'s default colour, ":name-colour:" otherwise;\n'
        '// the generator verifies that rule against the upstream map before emitting this.\n'
        'window.WHITNEYS_EMOJI = ' + json.dumps(payload, separators=(',', ':')) + ';\n')

    counts = {}
    for b in bases:
        counts[b['g']] = counts.get(b['g'], 0) + 1
    print(f'{OUT.relative_to(ROOT)}: {len(real)} codes, {len(bases)} bases, {counts}')
    print(f'  verified against {FONT.name} ({sha[:16]}...) and {src.name}')
    print(f'  {OUT.stat().st_size:,} bytes (upstream manifest is {src.stat().st_size:,})')


if __name__ == '__main__':
    main()
