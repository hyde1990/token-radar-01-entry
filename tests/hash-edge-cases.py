# Hash edge-case checks for the token-radar-01 dashboard (radar-2).
#
# Covers review non-blocker #7: a #category= naming a category that is not
# on the board, and a #p= with an unknown slug. Both must fail honestly and
# stay in sync — the select must show the requested (non-board) category
# instead of some other category, and an unknown slug must open no dialog
# and leave no stale selection behind. Edge 1b covers the same treatment
# applied symmetrically to the chain select (#chain= naming a chain that is
# not on the board). The two control checks pin the
# existing V13 expectations (#category=Risk Curators -> 34 rows,
# #p=steakhouse-financial -> detail dialog open) so a fix here cannot
# silently break them.
#
# Self-contained: builds a fresh output tree with main.ts into a temp dir,
# then drives it headlessly (Playwright, Chromium, file:// URLs, 1440x900)
# exactly like verify.mjs V13. Stdlib + playwright only. Run from anywhere:
#   python3 tests/hash-edge-cases.py
# Exit 0 only when every check passes.
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT = '/home/hatch/workspace/makefun/token-radar/kit-fresh/token-radar-01-kit/input/snapshot.json'

failures = []


def check(label, ok, detail=''):
    print(f"{'PASS' if ok else 'FAIL'} {label}{(' — ' + detail) if detail else ''}")
    if not ok:
        failures.append(label)


def build_output():
    tmp = tempfile.mkdtemp(prefix='radar-hash-')
    out = Path(tmp) / 'out'
    env = {**os.environ, 'MAKEFUN_OUTPUT_DIR': str(out)}
    r = subprocess.run(['node', str(ROOT / 'main.ts'), '--input', SNAPSHOT],
                       env=env, capture_output=True, text=True)
    if r.returncode != 0:
        print('FAIL setup — main.ts exit', r.returncode, r.stderr[-500:])
        sys.exit(2)
    return out


def main():
    out = build_output()
    base = (out / 'dashboard' / 'index.html').as_uri()
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        pg = b.new_page(viewport={'width': 1440, 'height': 900})
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))

        # --- Edge 1: unknown category -----------------------------------
        pg.goto(base + '#category=CEX')
        pg.wait_for_function("document.querySelector('#count').textContent.length > 0")
        rows = pg.locator('#rows tr').count()
        sel_val = pg.locator('#category').input_value()
        sel_text = pg.evaluate(
            "var s=document.querySelector('#category');"
            "var o=s.options[s.selectedIndex]; o ? o.text : '(none)'")
        empty = pg.locator('#empty').inner_text()
        check('unknown #category=CEX: 0 rows, honest empty state',
              rows == 0 and pg.locator('#count').inner_text() == '0 rows shown'
              and pg.locator('#empty').is_visible(),
              f'{rows} rows, count="{pg.locator("#count").inner_text()}"')
        check('unknown #category=CEX: select shows the requested category',
              sel_val == 'CEX' and 'not on board' in sel_text,
              f'select value="{sel_val}", option="{sel_text}"')
        check('unknown #category=CEX: empty message names the category',
              'CEX' in empty, empty[:120])

        # --- Edge 1b: unknown chain (symmetric to Edge 1) ---------------
        # The chain select got the same unknown-value treatment as the
        # category select; Kadena is a real chain name that is not on the
        # board, so it must fail honestly the same way.
        pg.goto(base + '#chain=Kadena')
        pg.wait_for_function("document.querySelector('#count').textContent.length > 0")
        rows = pg.locator('#rows tr').count()
        sel_val = pg.locator('#chain').input_value()
        sel_text = pg.evaluate(
            "var s=document.querySelector('#chain');"
            "var o=s.options[s.selectedIndex]; o ? o.text : '(none)'")
        empty = pg.locator('#empty').inner_text()
        check('unknown #chain=Kadena: 0 rows, honest empty state',
              rows == 0 and pg.locator('#count').inner_text() == '0 rows shown'
              and pg.locator('#empty').is_visible(),
              f'{rows} rows, count="{pg.locator("#count").inner_text()}"')
        check('unknown #chain=Kadena: select shows the requested chain',
              sel_val == 'Kadena' and 'not on board' in sel_text,
              f'select value="{sel_val}", option="{sel_text}"')
        check('unknown #chain=Kadena: empty message names the chain',
              'Kadena' in empty, empty[:120])

        # --- Edge 2: unknown slug ---------------------------------------
        pg.goto(base + '#p=not-a-real-slug')
        pg.wait_for_function("document.querySelector('#count').textContent.length > 0")
        pg.wait_for_timeout(300)
        check('unknown #p=: no dialog, board intact, no error',
              not pg.evaluate("document.querySelector('#detail').open")
              and pg.locator('#rows tr').count() == 198 and not errors,
              f'dialog open={pg.evaluate("document.querySelector(\'#detail\').open")}, '
              f'rows={pg.locator("#rows tr").count()}, errors={errors}')
        check('unknown #p=: stale selection dropped from hash',
              'p=' not in pg.evaluate('location.hash'),
              pg.evaluate('location.hash'))

        # --- Controls: existing V13 expectations still hold -------------
        pg.goto(base + '#category=Risk%20Curators')
        pg.wait_for_function("document.querySelector('#count').textContent.length > 0")
        cats = pg.locator('#rows tr td:nth-child(3)').all_inner_texts()
        check('control #category=Risk Curators: 34 rows, select in sync',
              pg.locator('#rows tr').count() == 34
              and pg.locator('#category').input_value() == 'Risk Curators'
              and all(c.strip() == 'Risk Curators' for c in cats),
              f'{pg.locator("#rows tr").count()} rows')
        pg.goto(base + '#p=steakhouse-financial')
        pg.wait_for_selector('#detail[open]')
        dlg = pg.locator('#detail').inner_text()
        check('control #p=steakhouse-financial: detail opens with farm plan',
              'Steakhouse Financial' in dlg and 'Cost:' in dlg and 'Time:' in dlg,
              dlg.split('\n')[0][:80])
        b.close()

    print('---')
    if failures:
        print(f'hash edge cases: {len(failures)} check(s) failed: {", ".join(failures)}')
        sys.exit(1)
    print('hash edge cases: all checks passed')


if __name__ == '__main__':
    main()
