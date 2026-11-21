// Verification suite for the token-radar-01 entry (radar-2) — ticket 07, spec D6.
//
// Checks V1–V14, all local, no network, stdlib only (Node 22). V13 renders the
// dashboard headlessly by spawning the system Python Playwright (the same
// method as the pre-build screenshot run); the script itself imports nothing
// but node: builtins. V12 recomputes implied values from the snapshot with an
// independent re-implementation of the spec D1 formula written here — it never
// imports lib/model.ts, so a bug shared with the entry cannot hide.
//
// Run from the entry repo root:
//   node scripts/verify.mjs [--snapshot <file>] [--keep <dir>]
// Exit 0 only when every V-check passes. A failure names the check and the
// offending row/file. What this suite cannot verify (there is no local grade
// for this bounty — the AI judge is pairwise only, server-side) is stated in
// the closing section, not claimed.
//
// The suite runs main.ts itself, twice, into two fresh scratch dirs under a
// temp dir (deleted afterwards unless --keep is given); it never trusts a
// previous run's output.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const KIT_SNAPSHOT = '/home/hatch/workspace/makefun/scout-2026-11-21/kits/token-radar-01/input/snapshot.json';
const MAIN = join(ROOT, 'main.ts');
const VENDOR = join(ROOT, 'vendor', 'makefun-board.ts');

// --- spec D1r constants, copied from the spec table (NOT read from lib/model.ts) ---
const SPEC = {
  fallback: 0.214,
  multiples: {
    'Liquid Staking': 0.08, CEX: 0.08, Lending: 0.132, Yield: 0.191,
    RWA: 0.275, Dexs: 0.342, Bridge: 0.557, 'Basis Trading': 0.6,
    'Canonical Bridge': 0.6,
  },
  sizeRef: 50_000_000, sizeExp: 0.1, sizeLo: 0.7, sizeHi: 1.3,
  growthWeight: 0.6, growthLo: -40, growthHi: 60,
  maturityFloor: 0.7, maturityRange: 0.3, maturityDays: 1095, unknownAge: 365,
};
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i === -1) return fallback;
  const a = argv[i];
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[i + 1] ?? fallback;
};
const SNAPSHOT = opt('snapshot', KIT_SNAPSHOT);
const KEEP = opt('keep', null);

const results = [];
function record(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} — ${detail}`);
}
const fail = (id, detail) => record(id, false, detail);
const ok = (id, detail) => record(id, true, detail);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const DAY_MS = 86_400_000;

/** Independent radar-2 recompute from one snapshot row (spec D1r, written here). */
function impliedIndependent(p, asOf) {
  const age = p.listed_at === null ? null
    : Math.max(0, Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${p.listed_at}T00:00:00Z`)) / DAY_MS));
  const base = SPEC.multiples[p.category] ?? SPEC.fallback;
  const size = clamp((SPEC.sizeRef / p.tvl_usd) ** SPEC.sizeExp, SPEC.sizeLo, SPEC.sizeHi);
  const growthPct = clamp(p.change_7d ?? 0, SPEC.growthLo, SPEC.growthHi);
  const growth = 1 + (SPEC.growthWeight * growthPct) / 100;
  const ageForModel = age ?? SPEC.unknownAge;
  const maturity = SPEC.maturityFloor + (Math.min(Math.max(ageForModel, 0), SPEC.maturityDays) / SPEC.maturityDays) * SPEC.maturityRange;
  return { implied: Math.max(1, Math.round(p.tvl_usd * base * size * growth * maturity)), base, size, growthPct, growth, maturity, age };
}

/** PNG/JPEG dimensions from the file header (no decoder). */
function imageDims(buf, name) {
  if (PNG_MAGIC.every((b, i) => buf[i] === b)) {
    if (buf.length < 33 || buf.readUInt32BE(12) !== 0x49484452) throw new Error(`${name}: PNG without IHDR`);
    return { type: 'PNG', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (JPEG_MAGIC.every((b, i) => buf[i] === b)) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) throw new Error(`${name}: bad JPEG marker`);
      const marker = buf[off + 1];
      const len = buf.readUInt16BE(off + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: 'JPEG', w: buf.readUInt16BE(off + 7), h: buf.readUInt16BE(off + 5) };
      }
      off += 2 + len;
    }
    throw new Error(`${name}: JPEG with no SOF marker`);
  }
  throw new Error(`${name}: neither PNG nor JPEG magic`);
}

/** Walk a directory tree (sorted, regular files only) as {rel: size}. */
function walkFiles(dir, base = dir) {
  const out = {};
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = join(dir, e.name);
    const rel = p.slice(base.length + 1);
    if (e.isDirectory()) Object.assign(out, walkFiles(p, base));
    else if (e.isFile()) out[rel] = statSync(p).size;
    else out[rel] = -1; // not a regular file: flagged by callers
  }
  return out;
}

console.log('token-radar verify: entry ' + ROOT);
console.log('token-radar verify: snapshot ' + SNAPSHOT);
if (!existsSync(MAIN)) { console.error('FAIL setup — main.ts missing at ' + MAIN); process.exit(2); }
if (!existsSync(SNAPSHOT)) { console.error('FAIL setup — snapshot missing at ' + SNAPSHOT); process.exit(2); }
const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
const snapBySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
const watchlist = snapshot.watchlist;

const scratch = mkdtempSync(join(tmpdir(), 'radar-verify-'));
const outA = join(scratch, 'runA');
const outB = join(scratch, 'runB');
const timed = join(scratch, 'runTimed');

function runEntry(outDir) {
  const start = Date.now();
  const r = spawnSync('node', [MAIN, '--input', SNAPSHOT], {
    env: { ...process.env, MAKEFUN_OUTPUT_DIR: outDir },
    encoding: 'utf8',
  });
  const ms = Date.now() - start;
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ms };
}

/** A timed run that also samples the child's peak RSS (VmHWM) from /proc. */
async function runTimed(outDir) {
  const start = Date.now();
  const child = spawn('node', [MAIN, '--input', SNAPSHOT], {
    env: { ...process.env, MAKEFUN_OUTPUT_DIR: outDir },
    stdio: 'pipe',
  });
  let peakKb = 0;
  const sample = () => {
    try {
      const st = readFileSync(`/proc/${child.pid}/status`, 'utf8');
      const m = st.match(/VmHWM:\s*(\d+)\s*kB/);
      if (m) peakKb = Math.max(peakKb, Number(m[1]));
    } catch { /* child already gone */ }
  };
  const timer = setInterval(sample, 5);
  const code = await new Promise((res) => child.on('close', res));
  clearInterval(timer);
  sample();
  return { status: code, ms: Date.now() - start, peakKb };
}

// ---------------------------------------------------------------- V1 + V14
const runA = runEntry(outA);
const runB = runEntry(outB);
if (runA.status !== 0 || runB.status !== 0) {
  fail('V1 double-run determinism', `exit ${runA.status}/${runB.status}; stderr: ${(runA.stderr || runB.stderr).trim().split('\n').slice(-2).join(' | ')}`);
} else {
  const d = spawnSync('diff', ['-r', outA, outB], { encoding: 'utf8' });
  if (d.status === 0) ok('V1 double-run determinism', `two fresh runs exit 0 (${runA.ms} ms, ${runB.ms} ms); diff -r clean — byte-identical trees`);
  else fail('V1 double-run determinism', `diff -r exit ${d.status}: ${(d.stdout || '').split('\n').slice(0, 5).join(' | ')}`);
}
const runT = await runTimed(timed);
if (runT.status !== 0) {
  fail('V14 runtime budget', `timed run exit ${runT.status}`);
} else {
  const rssMb = (runT.peakKb / 1024).toFixed(1) + ' MB';
  const pass = runT.ms < 120_000 && runT.peakKb < 1024 * 1024;
  record('V14 runtime budget', pass, `timed run ${runT.ms} ms wall, peak RSS ${rssMb} (VmHWM ${runT.peakKb} KiB, sampled every 5 ms) — budget 120 s / 1024 MB`);
}

const OUT = outA; // the verified tree (byte-identical to runB per V1)
const boardPath = join(OUT, 'board.json');
const dataPath = join(OUT, 'data.js');
const dossierPath = join(OUT, 'dossier.json');
const dashDir = join(OUT, 'dashboard');
const shotsDir = join(OUT, 'screenshots');
const board = JSON.parse(readFileSync(boardPath, 'utf8'));
const rows = board.rows;
const boardBytes = statSync(boardPath).size;

// ---------------------------------------------------------------- V2
{
  const files = walkFiles(dashDir);
  const names = Object.keys(files);
  const total = names.reduce((n, f) => n + files[f], 0);
  const badName = names.filter((f) => !PLAIN_NAME.test(f.split('/').pop()));
  const nonFile = names.filter((f) => files[f] === -1);
  const hasHtml = names.includes('index.html');
  const css = names.filter((f) => f.endsWith('.css'));
  const js = names.filter((f) => f.endsWith('.js'));
  // Network-address scan: any http(s):// inside an HTML attribute value, a
  // CSS url()/import, or a JS import/export/require/dynamic-import specifier.
  // (Visible text and comments may carry URLs per the gate; the entry avoids
  // them entirely, so any hit is reported here as a failure.)
  const hits = [];
  for (const f of names) {
    const text = readFileSync(join(dashDir, f), 'utf8');
    if (f.endsWith('.html')) {
      for (const m of text.matchAll(/(?:href|src|action)\s*=\s*["'][^"']*https?:\/\/[^"']*["']/gi)) hits.push(`${f}: ${m[0].slice(0, 80)}`);
    }
    if (f.endsWith('.css')) {
      for (const m of text.matchAll(/(?:@import|url\()\s*["']?https?:\/\/[^"')]+/gi)) hits.push(`${f}: ${m[0].slice(0, 80)}`);
    }
    if (f.endsWith('.js')) {
      for (const m of text.matchAll(/(?:import|export|require|from)\s*\(?\s*["']https?:\/\/[^"']+["']/gi)) hits.push(`${f}: ${m[0].slice(0, 80)}`);
      for (const m of text.matchAll(/import\(\s*["']https?:\/\/[^"']+["']\)/gi)) hits.push(`${f}: ${m[0].slice(0, 80)}`);
    }
  }
  const pass = hasHtml && css.length >= 1 && js.length >= 1 && names.length <= 400 && total <= 4_194_304
    && badName.length === 0 && nonFile.length === 0 && hits.length === 0;
  record('V2 dashboard_files', pass,
    `${names.length} files (${names.join(', ')}), ${total} B total (cap 400 files / 4 MiB); index.html ${hasHtml ? 'present' : 'MISSING'}, css ${css.length}, js ${js.length}; bad names: ${badName.join(', ') || 'none'}; non-files: ${nonFile.join(', ') || 'none'}; network-address hits: ${hits.join(' | ') || 'none'}`);
}

// ---------------------------------------------------------------- V3
{
  const problems = [];
  if (!Array.isArray(rows)) problems.push('board.json rows is not an array');
  if (rows.length < 100 || rows.length > 4000) problems.push(`${rows.length} rows outside 100–4000`);
  if (boardBytes > 8 * 1024 * 1024) problems.push(`board.json ${boardBytes} B over 8 MiB`);
  const seen = new Set();
  for (const r of rows) {
    if (!snapBySlug.has(r.slug)) problems.push(`${r.slug}: slug not in snapshot`);
    if (seen.has(r.slug)) problems.push(`${r.slug}: duplicate slug`);
    seen.add(r.slug);
    if (typeof r.name !== 'string' || r.name.trim() === '') problems.push(`${r.slug}: empty name`);
    if (!Number.isSafeInteger(r.rank) || r.rank <= 0) problems.push(`${r.slug}: rank ${r.rank}`);
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) problems.push(`${r.slug}: implied ${r.implied_value_usd}`);
    if (!Array.isArray(r.farm_steps)) problems.push(`${r.slug}: farm_steps missing`);
    if (!r.model || typeof r.model.base_multiple !== 'number') problems.push(`${r.slug}: model breakdown missing`);
  }
  record('V3 board_file', problems.length === 0,
    `${rows.length} rows (expect 198), board.json ${boardBytes} B (cap 8 MiB), sha256 ${sha256(readFileSync(boardPath)).slice(0, 16)}…; problems: ${problems.slice(0, 5).join(' | ') || 'none'}`);
}

// ---------------------------------------------------------------- V4
{
  const ranksOk = rows.every((r, i) => r.rank === i + 1);
  const sortedOk = rows.every((r, i) => i === 0 || r.implied_value_usd <= rows[i - 1].implied_value_usd);
  const distinct = new Set(rows.map((r) => r.implied_value_usd)).size;
  const firstBad = rows.findIndex((r, i) => i > 0 && r.implied_value_usd > rows[i - 1].implied_value_usd);
  record('V4 sorted_by_value', ranksOk && sortedOk && distinct > 1,
    `ranks exactly 1..${rows.length}: ${ranksOk ? 'yes' : 'NO'}; implied non-increasing: ${sortedOk ? 'yes' : 'NO at row ' + (firstBad + 1)}; distinct implied values ${distinct}; top $${rows[0].implied_value_usd.toLocaleString()} (${rows[0].slug}), bottom $${rows[rows.length - 1].implied_value_usd.toLocaleString()} (${rows[rows.length - 1].slug})`);
}

// ---------------------------------------------------------------- V5
{
  const inBoard = new Set(rows.map((r) => r.slug));
  const missing = watchlist.filter((s) => !inBoard.has(s));
  const covered = watchlist.length - missing.length;
  record('V5 coverage', missing.length === 0,
    `watchlist ${covered}/${watchlist.length} on board (${((covered / watchlist.length) * 100).toFixed(0)}%); missing: ${missing.join(', ') || 'none'}`);
}

// ---------------------------------------------------------------- V6
{
  let minLen = Infinity, maxLen = 0, total = 0;
  const problems = [];
  for (const r of rows) {
    if (r.farm_steps.length !== 7) problems.push(`${r.slug}: ${r.farm_steps.length} steps, expect 7`);
    for (const s of r.farm_steps) {
      const t = s.trim();
      total++;
      minLen = Math.min(minLen, t.length);
      maxLen = Math.max(maxLen, t.length);
      if (t.length < 20 || t.length > 600) problems.push(`${r.slug}: step ${t.length} chars`);
      if (!t.includes('Cost:') || !t.includes('Time:')) problems.push(`${r.slug}: step without Cost:/Time: (${t.slice(0, 60)}…)`);
    }
  }
  record('V6 farm_steps', problems.length === 0,
    `${total} steps across ${rows.length} rows, every row exactly 7; length min ${minLen}, max ${maxLen} chars (gate 20–600); every step carries Cost: and Time:; problems: ${problems.slice(0, 5).join(' | ') || 'none'}`);
}

// ---------------------------------------------------------------- V7
{
  const names = readdirSync(shotsDir).filter((f) => !f.startsWith('.')).sort();
  const problems = [];
  const details = [];
  for (const f of names) {
    const buf = readFileSync(join(shotsDir, f));
    try {
      const d = imageDims(buf, f);
      const long = Math.max(d.w, d.h), short = Math.min(d.w, d.h);
      details.push(`${f}: ${d.type} ${d.w}x${d.h}, ${buf.length} B (${(buf.length / 1024).toFixed(0)} KiB)`);
      if (buf.length > 524_288) problems.push(`${f}: ${buf.length} B over 512 KiB`);
      if (long > 1440) problems.push(`${f}: long side ${long} over 1440`);
      if (short < 800) problems.push(`${f}: short side ${short} under 800`);
    } catch (e) { problems.push(e.message); }
  }
  if (names.length < 3 || names.length > 4) problems.push(`${names.length} screenshots, expect 3–4`);
  record('V7 screenshots', problems.length === 0,
    `${names.length} images — ${details.join('; ')}; cap 512 KiB each, long side ≤1440, short side ≥800; problems: ${problems.join(' | ') || 'none'}`);
}

// ---------------------------------------------------------------- V8
{
  let rebuilt = null, err = null;
  try {
    const { buildDossier } = await import(VENDOR);
    rebuilt = buildDossier(OUT, {
      text_max_bytes: 65536,
      screenshots: { max: 4, max_bytes: 524288 },
      dashboard: { max_files: 400, max_bytes: 4194304 },
    });
  } catch (e) { err = e; }
  const actual = readFileSync(dossierPath);
  const identical = rebuilt !== null && Buffer.from(rebuilt).equals(actual);
  const dossier = JSON.parse(actual.toString('utf8'));
  const truncated = typeof dossier.text === 'string' && /\[Cut at/.test(dossier.text);
  record('V8 dossier_matches', identical && actual.length <= 1_572_864,
    `dossier.json ${actual.length} B (cap 1.5 MiB = 1,572,864), sha256 ${sha256(actual)}; independent rebuild ${err ? 'THREW: ' + err.message : identical ? 'byte-identical' : 'DIFFERS (rebuilt sha256 ' + sha256(Buffer.from(rebuilt)).slice(0, 16) + '…)'}; text truncated by cap: ${truncated ? 'YES — see report' : 'no'}`);
}

// ---------------------------------------------------------------- V9
{
  const files = walkFiles(dashDir);
  const total = Object.values(files).reduce((n, s) => n + (s > 0 ? s : 0), 0);
  const parts = Object.entries(files).map(([f, s]) => `${f} ${s} B`).join(', ');
  record('V9 dashboard source size', total <= 60_000,
    `${total} B total (${parts}); target ≤60,000 B, hard cap 65,536 B — ${total <= 60_000 ? 'within target' : total <= 65536 ? 'OVER TARGET but within hard cap' : 'OVER HARD CAP'}`);
}

// ---------------------------------------------------------------- V10
{
  const js = readFileSync(dataPath, 'utf8');
  const m = js.match(/^window\.RADAR=(\{.*\});\n$/s);
  let detail = '';
  let pass = false;
  if (!m) detail = 'data.js does not match /^window.RADAR={...};\\n$/';
  else {
    const d = JSON.parse(m[1]);
    const mism = [];
    if (d.rows.length !== rows.length) mism.push(`row count data.js ${d.rows.length} vs board ${rows.length}`);
    d.rows.forEach((r, i) => {
      if (rows[i] && (r.slug !== rows[i].slug || r.rank !== rows[i].rank || r.implied_value_usd !== rows[i].implied_value_usd)) mism.push(`row ${i + 1}: ${r.slug}/${r.implied_value_usd} vs ${rows[i].slug}/${rows[i].implied_value_usd}`);
    });
    pass = mism.length === 0;
    detail = `data.js ${statSync(dataPath).size} B, ${d.rows.length} rows, live ${d.live.length} rows; mismatches: ${mism.slice(0, 5).join(' | ') || 'none'}`;
  }
  record('V10 data.js / board agreement', pass, detail);
}

// ---------------------------------------------------------------- V11
{
  const js = readFileSync(dataPath, 'utf8');
  const d = JSON.parse(js.match(/^window\.RADAR=(\{.*\});\n$/s)[1]);
  const liveInBoard = rows.filter((r) => r.mcap_usd !== null || r.gecko_id !== null || r.symbol !== null);
  const liveSlugs = new Set(d.live.map((r) => r.slug));
  const boardSlugs = new Set(rows.map((r) => r.slug));
  const overlap = [...liveSlugs].filter((s) => boardSlugs.has(s));
  const liveNoMcap = d.live.filter((r) => !(typeof r.mcap_usd === 'number' && r.mcap_usd > 0));
  const liveSorted = d.live.every((r, i) => i === 0 || r.mcap_usd <= d.live[i - 1].mcap_usd);
  const top24 = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => b.mcap_usd - a.mcap_usd || (a.slug < b.slug ? -1 : 1)).slice(0, 24).map((p) => p.slug);
  const liveIsTop24 = JSON.stringify(d.live.map((r) => r.slug)) === JSON.stringify(top24);
  record('V11 live separation', liveInBoard.length === 0 && overlap.length === 0 && liveNoMcap.length === 0 && d.live.length === 24 && liveIsTop24,
    `board rows carrying a token marker: ${liveInBoard.length}; live slugs also on board: ${overlap.join(', ') || 'none'}; live rows ${d.live.length} (expect 24), all positive mcap: ${liveNoMcap.length === 0 ? 'yes' : 'NO — ' + liveNoMcap.map((r) => r.slug).join(', ')}; live sorted by mcap desc: ${liveSorted ? 'yes' : 'no'}; live set is exactly the top 24 by mcap: ${liveIsTop24 ? 'yes' : 'NO'}; live categories include CEX: ${d.live.filter((r) => r.category === 'CEX').map((r) => r.slug).join(', ') || 'none'}`);
}

// ---------------------------------------------------------------- V12
{
  const mid = Math.floor(rows.length / 2); // rank 99 of 198
  const picks = [rows[0], rows[mid - 1], rows[rows.length - 1]];
  const problems = [];
  const details = [];
  for (const r of picks) {
    const p = snapBySlug.get(r.slug);
    const v = impliedIndependent(p, snapshot.as_of);
    const match = v.implied === r.implied_value_usd;
    if (!match) problems.push(`rank ${r.rank} ${r.slug}: independent $${v.implied.toLocaleString()} vs board $${r.implied_value_usd.toLocaleString()}`);
    details.push(`rank ${r.rank} ${r.slug}: independent $${v.implied.toLocaleString()} (base ${v.base}, size ${v.size.toFixed(4)}, growth ${v.growthPct}%→${v.growth.toFixed(4)}, maturity ${v.maturity.toFixed(4)}, age ${v.age}) vs board $${r.implied_value_usd.toLocaleString()} — ${match ? 'match' : 'MISMATCH'}`);
  }
  record('V12 model spot-check', problems.length === 0, details.join(' || '));
}

// ---------------------------------------------------------------- V13
const V13_PY = `
import json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
out = Path(sys.argv[1]); rank1_slug, rank1_name, board_n, filt_cat, filt_n = sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5], int(sys.argv[6])
res = {}
try:
    from PIL import Image, ImageStat
    pix = {}
    for f in sorted((out / 'screenshots').glob('*.png')):
        im = Image.open(f).convert('L')
        st = ImageStat.Stat(im)
        levels = sum(1 for v in im.histogram() if v)
        pix[f.name] = {'mean': round(st.mean[0], 1), 'stdev': round(st.stddev[0], 1), 'levels': levels}
    res['pixels'] = pix
except Exception as e:
    res['pixels_error'] = str(e)
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={'width': 1440, 'height': 900})
    pg.goto((out / 'dashboard' / 'index.html').as_uri())
    pg.wait_for_selector('#rows tr')
    res['board'] = {'rows': pg.locator('#rows tr').count(), 'count_text': pg.locator('#count').inner_text()}
    pg.goto((out / 'dashboard' / 'index.html').as_uri() + '#p=' + rank1_slug)
    pg.wait_for_selector('#detail[open]')
    dlg = pg.locator('#detail').inner_text()
    res['detail'] = {'open': pg.evaluate("document.querySelector('#detail').open"), 'has_rank1_name': rank1_name in dlg, 'has_cost': 'Cost:' in dlg, 'has_time': 'Time:' in dlg, 'has_farm_plan': 'Farm plan' in dlg or 'farm' in dlg.lower()}
    pg.goto((out / 'dashboard' / 'index.html').as_uri() + '#category=' + filt_cat.replace(' ', '%20'))
    pg.wait_for_selector('#rows tr')
    pg.wait_for_function("document.querySelector('#count').textContent.length > 0")
    cats = pg.locator('#rows tr td:nth-child(3)').all_inner_texts()
    res['filtered'] = {'rows': pg.locator('#rows tr').count(), 'count_text': pg.locator('#count').inner_text(), 'select_value': pg.locator('#category').input_value(), 'all_category': all(c.strip() == filt_cat for c in cats), 'first_rows': cats[:3]}
    b.close()
print(json.dumps(res))
`;
{
  const rank1 = rows[0];
  const filtCat = 'Risk Curators';
  const filtN = rows.filter((r) => r.category === filtCat).length;
  const pyFile = join(scratch, 'v13.py');
  writeFileSync(pyFile, V13_PY);
  const r = spawnSync('python3', [pyFile, OUT, rank1.slug, rank1.name, String(rows.length), filtCat, String(filtN)], { encoding: 'utf8', timeout: 120_000 });
  if (r.status !== 0) {
    fail('V13 screenshot content', `playwright script exit ${r.status}: ${(r.stderr || '').trim().split('\n').slice(-3).join(' | ') || r.stdout}`);
  } else {
    let v13;
    try { v13 = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { v13 = null; }
    if (!v13) fail('V13 screenshot content', 'playwright output was not JSON: ' + r.stdout.slice(0, 200));
    else {
      const pix = v13.pixels || {};
      const pixDetail = Object.entries(pix).map(([f, s]) => `${f} grey mean ${s.mean}/stdev ${s.stdev}/${s.levels} levels`).join('; ') || ('pixels: ' + (v13.pixels_error || 'n/a'));
      const nonBlank = Object.values(pix).every((s) => s.stdev > 5 && s.levels > 50);
      const pass = v13.board.rows === rows.length && v13.board.count_text.includes(String(rows.length))
        && v13.detail.open && v13.detail.has_rank1_name && v13.detail.has_cost && v13.detail.has_time
        && v13.filtered.rows === filtN && v13.filtered.select_value === filtCat && v13.filtered.all_category && nonBlank;
      record('V13 screenshot content', pass,
        `board view: ${v13.board.rows} DOM rows, count "${v13.board.count_text}" (expect ${rows.length}); detail #p=${rank1.slug}: dialog open=${v13.detail.open}, name=${v13.detail.has_rank1_name}, Cost=${v13.detail.has_cost}, Time=${v13.detail.has_time}; filtered #category=${filtCat}: ${v13.filtered.rows} DOM rows (expect ${filtN}), count "${v13.filtered.count_text}", select="${v13.filtered.select_value}", all rows ${filtCat}=${v13.filtered.all_category}; ${pixDetail}`);
    }
  }
}

// ---------------------------------------------------------------- S1 (info): spec-analysis recompute
{
  const livePos = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
  const overall = median(livePos.map((p) => p.mcap_usd / p.tvl_usd));
  const byCat = {};
  for (const p of livePos) (byCat[p.category] ??= []).push(p.mcap_usd / p.tvl_usd);
  const yieldMed = median(byCat.Yield ?? []);
  const modelText = readFileSync(join(ROOT, 'lib', 'model.ts'), 'utf8');
  const constantsMatchD1r = ['fallback_multiple: 0.214', 'Lending: 0.132', 'Yield: 0.191', 'RWA: 0.275', 'Dexs: 0.342', 'Bridge: 0.557', "'Basis Trading': 0.6", "'Canonical Bridge': 0.6"]
    .every((s) => modelText.includes(s));
  const negMcap = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd < 0).map((p) => `${p.slug} (${p.mcap_usd})`);
  const zeroMcap = snapshot.protocols.filter((p) => p.mcap_usd === 0).length;
  console.log(`INFO S1 spec-analysis recompute — live positive-mcap count ${livePos.length} (spec D1 said 129, D1r says 128); overall median mcap/TVL ${overall.toFixed(3)} (D1 0.205, D1r 0.214); Yield median ${yieldMed.toFixed(3)} n=${(byCat.Yield ?? []).length} (D1 0.180 n=10, D1r 0.191 n=9); cause: snapshot carries ${negMcap.join(', ') || 'no negative mcap'} and ${zeroMcap} zero-mcap rows — the spec's D1 counts match a non-zero (mcap != 0) filter, which admits the -1 sentinel; implemented constants match the spec D1r table exactly: ${constantsMatchD1r ? 'yes' : 'NO'}`);
  console.log('INFO S1 note — the D1r table is the normative model definition (strict mcap_usd > 0 filter); D1 is retained in the spec as history. See verification/report.md.');
}

// ---------------------------------------------------------------- summary
const failed = results.filter((r) => !r.pass);
console.log('---');
console.log(`verify: ${results.length - failed.length}/${results.length} checks passed${failed.length ? '; FAILED: ' + failed.map((r) => r.id).join(', ') : ''}`);
console.log('What this suite CANNOT verify (no local grade exists for token-radar-01): the AI judge\'s pairwise verdicts, the Bradley–Terry win rate / dev rate, strength vs the four house anchors (1-weak 0.014, 2-plain 0.593, 3-mid 0.782, 4-strong 1.081) and three rungs, the top-40 final screen, and any prize. The judge (no fixed temperature) may answer the same pair differently if re-asked; verdicts are final. A local "looks better" judgement is not a grade.');
if (KEEP) console.log('verify: scratch kept at ' + scratch);
else rmSync(scratch, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
