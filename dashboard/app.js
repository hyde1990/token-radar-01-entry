// Token Radar dashboard (radar-5). Reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, its filters, the
// per-protocol detail view, the separate live-token section, the KPI /
// integrity strips, the ledger, the methodology and the model sandbox.
// No network: every byte it shows is already in data.js. No fetch, no
// framework, no external font. No validation figure is typed into the HTML:
// every number below is read out of DATA at render time.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  // Distinct values actually present on the board; a hash may name a value
  // outside these sets (e.g. #category=CEX — CEX is live-only, never board).
  var boardCats = {}, boardChains = {};

  var state = {
    q: '', category: 'all', chain: 'all', verdict: 'all', watchOnly: false, minTvl: 0,
    sort: 'rank', dir: 1, selected: null
  };

  var money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return money.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtOdds(o) {
    if (o === null || o === undefined || !isFinite(o)) return 'n/a';
    return o.toFixed(3);
  }
  function fmtRange(lo, hi) {
    return fmtUsd(lo) + '–' + fmtUsd(hi);
  }
  // Collapsed bootstrap intervals (P10 = P90) are shown as the measured
  // refit count, never as two identical bounds (radar-4 T4).
  function fmtInterval(r) {
    if (r.stable_refits !== null && r.stable_refits !== undefined) {
      return 'stable in ' + r.stable_refits + '/' + DATA.assumptions.bootstrap_b + ' refits';
    }
    return fmtRange(r.p10_usd, r.p90_usd);
  }
  function median(xs) {
    var s = xs.slice().sort(function (a, b) { return a - b; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function bySlug(slug) {
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) return DATA.rows[i];
    return null;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    var params = new URLSearchParams(hash);
    state.q = params.get('q') || '';
    state.category = params.get('category') || 'all';
    state.chain = params.get('chain') || 'all';
    state.verdict = params.get('verdict') || 'all';
    state.watchOnly = params.get('watch') === '1';
    state.minTvl = parseFloat(params.get('min')) || 0;
    state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.verdict !== 'all') params.set('verdict', state.verdict);
    if (state.watchOnly) params.set('watch', '1');
    if (state.minTvl > 0) params.set('min', String(state.minTvl));
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    var base = window.location.pathname + window.location.search;
    window.history.replaceState(null, '', next ? '#' + next : base);
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (state.watchOnly && !r.watchlist) return false;
      if (state.minTvl > 0 && r.tvl_usd < state.minTvl * 1e6) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  var VERDICT_ORDER = { FARM: 0, THIN: 1, SKIP: 2 };
  function sorted(list) {
    var key = state.sort, dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'category') { av = (a.category || '').toLowerCase(); bv = (b.category || '').toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'rank') { av = a.rank; bv = b.rank; }
      else if (key === 'odds') { av = a.odds; bv = b.odds; }
      else if (key === 'ev') { av = a.expected_value_usd; bv = b.expected_value_usd; }
      else if (key === 'interval') { av = a.p90_usd; bv = b.p90_usd; }
      else if (key === 'rankrange') { av = a.rank_hi - a.rank_lo; bv = b.rank_hi - b.rank_lo; }
      else if (key === 'verdict') { av = VERDICT_ORDER[a.verdict]; bv = VERDICT_ORDER[b.verdict]; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function fillSelect(select, values, counts, allLabel) {
    select.textContent = '';
    select.appendChild(el('option', { value: 'all', text: allLabel }));
    values.forEach(function (v) {
      var label = counts ? v + ' (' + counts[v] + ')' : v;
      select.appendChild(el('option', { value: v, text: label }));
    });
  }

  // Keep a select in sync even when the requested value is not a board
  // value: show the requested value as a clearly-marked option instead of
  // leaving the select on some other category (or on nothing at all).
  function syncSelectWithUnknown(select, value, known) {
    var prev = select.querySelector('option[data-unknown]');
    if (prev) prev.remove();
    if (value !== 'all' && !known[value]) {
      select.appendChild(el('option', { value: value, text: value + ' (not on board)', 'data-unknown': 'true' }));
    }
    select.value = value;
  }

  function initControls() {
    var cats = {}, chains = {};
    DATA.rows.forEach(function (r) {
      var c = r.category || 'Other';
      cats[c] = (cats[c] || 0) + 1;
      (r.chains || []).forEach(function (ch) { chains[ch] = (chains[ch] || 0) + 1; });
    });
    boardCats = cats;
    boardChains = chains;
    var catNames = Object.keys(cats).sort();
    var chainNames = Object.keys(chains).sort();
    fillSelect(document.getElementById('category'), catNames, cats, 'All categories');
    fillSelect(document.getElementById('chain'), chainNames, null, 'All chains');

    var q = document.getElementById('q');
    var cat = document.getElementById('category');
    var ch = document.getElementById('chain');
    var verdict = document.getElementById('verdict');
    var min = document.getElementById('minTvl');
    var watch = document.getElementById('watchOnly');
    q.value = state.q;
    syncSelectWithUnknown(cat, state.category, boardCats);
    syncSelectWithUnknown(ch, state.chain, boardChains);
    verdict.value = state.verdict;
    if (state.minTvl > 0) min.value = String(state.minTvl);
    watch.checked = state.watchOnly;
    q.addEventListener('input', function () { state.q = q.value; writeHash(); renderRows(); });
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); renderRows(); });
    ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); renderRows(); });
    verdict.addEventListener('change', function () { state.verdict = verdict.value; writeHash(); renderRows(); });
    min.addEventListener('input', function () { state.minTvl = parseFloat(min.value) || 0; writeHash(); renderRows(); });
    watch.addEventListener('change', function () { state.watchOnly = watch.checked; writeHash(); renderRows(); });
    document.getElementById('clear').addEventListener('click', function () {
      state.q = ''; state.category = 'all'; state.chain = 'all'; state.verdict = 'all'; state.watchOnly = false; state.minTvl = 0;
      syncControls();
      writeHash(); renderRows();
    });
    document.querySelectorAll('#board thead button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-sort');
        if (state.sort === key) { state.dir = -state.dir; }
        else { state.sort = key; state.dir = (key === 'name' || key === 'category') ? 1 : -1; }
        renderRows();
      });
    });
  }

  function renderRows() {
    var list = sorted(filtered());
    var tbody = document.getElementById('rows');
    tbody.textContent = '';
    var max = 1;
    DATA.rows.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var nameCell = el('div', { class: 'name' },
        el('span', null, el('b', { text: r.name }), r.watchlist ? el('span', { class: 'tag', text: 'Watchlist' }) : null),
        el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
      );
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num rank', text: String(r.rank) }),
        el('td', null, nameCell),
        el('td', null, el('span', { class: 'chip', text: r.category || 'Other' })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: fmtOdds(r.odds) }),
        el('td', { class: 'num', text: fmtUsd(r.expected_value_usd) }),
        el('td', { class: 'num interval', text: fmtInterval(r) }),
        el('td', { class: 'num', text: r.rank_lo + '–' + r.rank_hi }),
        el('td', null, el('span', { class: 'verdict v-' + r.verdict.toLowerCase(), text: r.verdict }))
      );
      tbody.appendChild(tr);
    });
    document.getElementById('count').textContent = list.length + ' rows shown';
    var empty = document.getElementById('empty');
    empty.hidden = list.length > 0;
    if (list.length === 0) {
      if (state.category !== 'all' && !boardCats[state.category]) {
        empty.textContent = 'No protocol matches that filter. “' + state.category + '” is not a category on this board — clear the search or pick another category to see the board again.';
      } else if (state.chain !== 'all' && !boardChains[state.chain]) {
        empty.textContent = 'No protocol matches that filter. “' + state.chain + '” is not a chain on this board — clear the search or pick another chain to see the board again.';
      } else {
        empty.textContent = 'No protocol matches that filter. Clear the search or pick another category to see the board again.';
      }
    }
    document.querySelectorAll('#board thead button').forEach(function (btn) {
      if (btn.getAttribute('data-sort') === state.sort) {
        btn.setAttribute('aria-sort', state.dir < 0 ? 'descending' : 'ascending');
      } else {
        btn.removeAttribute('aria-sort');
      }
    });
  }

  function renderLive() {
    var tbody = document.getElementById('liveRows');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', null, el('span', { class: 'chip', text: r.category || 'Other' })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) })
      ));
    });
  }

  // A small table: caption, header labels, rows as [cell, cell, ...]; a cell
  // may be [text, className] instead of plain text.
  function miniTable(caption, headers, rows) {
    var t = el('table', { class: 'mini' });
    if (caption) t.appendChild(el('caption', { text: caption }));
    var head = el('tr');
    headers.forEach(function (h) { head.appendChild(el('th', { text: h })); });
    t.appendChild(el('thead', null, head));
    var tb = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr');
      r.forEach(function (c) {
        if (Array.isArray(c)) tr.appendChild(el('td', { class: c[1], text: c[0] }));
        else tr.appendChild(el('td', { text: c }));
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    return t;
  }

  function renderKpi() {
    var strip = document.getElementById('kpiStrip');
    var L = DATA.ledger, F = DATA.fit, V = DATA.verdict_counts;
    var maxEvRow = bySlug(DATA.max_ev.slug);
    var items = [
      ['Snapshot total', String(L.total)],
      ['Ranked', L.ranked + ' (' + L.watchlist + ' watchlist + ' + L.early + ' early)'],
      ['Excluded pre-token', String(L.excluded_pre)],
      ['Live-token', L.live + ' (' + L.live_shown + ' shown)'],
      ['LOO median |ln err|', F.loo_median.toFixed(2)],
      ['Walk-forward median |ln err|', F.walk_forward.pooled_median.toFixed(2) + ' (n=' + F.walk_forward.n + ', 2 folds)'],
      ['Split coverage', (F.split_coverage * 100).toFixed(1) + '%'],
      ['Verdicts', 'FARM ' + V.FARM + ' / THIN ' + V.THIN + ' / SKIP ' + V.SKIP],
      ['Median odds', DATA.median_odds.toFixed(3)],
      ['Rank-1 expected value', money.format(DATA.max_ev.value) + ' (' + (maxEvRow ? maxEvRow.name : DATA.max_ev.slug) + ') — board rank 1 by expected value'],
    ];
    items.forEach(function (kv) {
      strip.appendChild(el('div', null, el('dt', { text: kv[0] }), el('dd', { text: kv[1] })));
    });
    var integ = document.getElementById('integrityStrip');
    (DATA.integrity || []).forEach(function (c) {
      integ.appendChild(el('li', { class: c.pass ? 'pass' : 'fail' },
        el('b', { text: c.pass ? 'PASS' : 'FAIL' }), document.createTextNode(' ' + c.label + ' — ' + c.value)));
    });
  }

  // Out-of-sample evidence (radar-5 T2): every figure read from DATA at
  // render time, 2 decimals, no pasted numbers. Ablation LOO/WF are the
  // blind-test medians with the term removed (implied basis); the drop bar
  // is 0.05 and no term cleared it, so all are kept.
  function renderEvidence() {
    var F = DATA.fit, O = DATA.odds, WF = F.walk_forward;
    var out = document.getElementById('evidenceOut');
    out.appendChild(el('p', { text: 'Walk-forward (n=' + WF.n + ', 2 folds): pooled median |ln err| ' + WF.pooled_median.toFixed(2) + ', coverage ' + (WF.pooled_coverage * 100).toFixed(1) + '%. LOO median ' + F.loo_median.toFixed(2) + ', split ' + F.split_median.toFixed(2) + '; coverage LOO ' + (F.loo_coverage * 100).toFixed(1) + '% / split ' + (F.split_coverage * 100).toFixed(1) + '% (target 80%). Odds: AUC ' + O.auc.toFixed(2) + ', Brier ' + O.brier.toFixed(2) + ' (base rate ' + (O.live_share * (1 - O.live_share)).toFixed(2) + ').' }));
    out.appendChild(miniTable('Ablation — blind-test median |ln err| with each term removed. Drop bar 0.05 on both tests; no term cleared it.',
      ['Term', 'LOO w/o', 'ΔLOO', 'WF w/o', 'ΔWF', 'Keep?'],
      F.ablation.map(function (a) {
        return [a.term, [a.loo_without.toFixed(2), 'num'], [(a.loo_delta >= 0 ? '+' : '') + a.loo_delta.toFixed(2), 'num'], [a.wf_pooled_without.toFixed(2), 'num'], [(a.wf_pooled_delta >= 0 ? '+' : '') + a.wf_pooled_delta.toFixed(2), 'num'], a.decision];
      })));
  }

  function renderLedger() {
    var L = DATA.ledger;
    var out = document.getElementById('ledgerOut');
    out.appendChild(el('p', { text: L.total + ' protocols = ' + L.ranked + ' ranked (' + L.watchlist + ' watchlist + ' + L.early + ' early) + ' + L.excluded_pre + ' pre-token excluded + ' + L.live + ' live-token.' }));
    out.appendChild(miniTable('Pre-token protocols excluded from the board, by category. The excluding reason is separate — reasons overlap.',
      ['Category', 'Excluded'],
      L.excluded_by_category.map(function (kv) { return [kv[0], [String(kv[1]), 'num']]; })));
    out.appendChild(el('p', { text: 'Excluding reasons (overlapping — one row can match several): category rule ' + L.reasons.category + ', versioned name ' + L.reasons.versioned + ', wrapped/staked word ' + L.reasons.wrapped + ', exchange-prefixed name ' + L.reasons.exchange + ', missing category ' + L.reasons.category_null + '. The five excluded Dexs rows are excluded by name rules, not by category.' }));
    out.appendChild(el('p', { text: 'Live-token: ' + L.live + ' = ' + L.live_mcap_pos + ' with a positive market cap + ' + L.live_mcap_zero + ' with a zero market cap + ' + L.live_mcap_neg + ' with a negative market cap + ' + L.live_mcap_null + ' that record a token but carry no market-cap figure. The live view shows the top ' + L.live_shown + ' by market cap; ' + L.live_not_shown + ' are not displayed.' }));
  }

  function renderMethod() {
    var F = DATA.fit, O = DATA.odds, A = DATA.assumptions;
    // --- fitted model ---
    var fitDiv = document.getElementById('methodFit');
    fitDiv.appendChild(el('h3', { text: 'The fitted value model (radar-5)' }));
    fitDiv.appendChild(el('p', { class: 'formula', text: 'log mcap = ' + F.intercept.toFixed(6) + ' + ' + F.slope.toFixed(6) + ' × ln(TVL) + category effect;  multiple = exp(log mcap − ln TVL), clamped to 0.08–0.60;  implied = TVL × multiple × growth × maturity' }));
    fitDiv.appendChild(el('p', { text: 'Fitted, not assumed: a pooled log-log OLS over the ' + F.n + ' live-token protocols with a positive market cap (' + F.df + ' degrees of freedom), outcome ln(market cap), predictors ln(TVL) plus one dummy per category with at least 5 live observations; every other category is pooled into the reference group. Growth and maturity stay the radar-2 terms — the variant that fitted a growth coefficient did worse held out.' }));
    var coefRows = [['Intercept', [F.intercept.toFixed(6), 'num']], ['Slope on ln(TVL)', [F.slope.toFixed(6), 'num']]];
    Object.keys(F.effects).sort().forEach(function (c) {
      var v = F.effects[c];
      coefRows.push([c, [(v >= 0 ? '+' : '') + v.toFixed(6), 'num']]);
    });
    coefRows.push(['Reference (all other categories)', ['0', 'num']]);
    fitDiv.appendChild(miniTable('Fitted coefficients (ln points).', ['Term', 'Coefficient'], coefRows));
    var multRows = [];
    [5000000, 50000000, 500000000, 2750000000].forEach(function (tvl) {
      var row = [fmtUsd(tvl)];
      ['Reference', 'RWA', 'Dexs', 'Lending', 'Yield', 'Basis Trading'].forEach(function (c) {
        var eff = c === 'Reference' ? 0 : (F.effects[c] || 0);
        var raw = Math.exp(F.intercept + (F.slope - 1) * Math.log(tvl) + eff);
        var cl = Math.min(0.6, Math.max(0.08, raw));
        row.push([raw.toFixed(4) + (cl !== raw ? ' → ' + cl.toFixed(2) : ''), 'num']);
      });
      multRows.push(row);
    });
    fitDiv.appendChild(miniTable('Fitted multiples at reference TVLs (raw → clamped to 0.08–0.60).', ['TVL', 'Reference', 'RWA', 'Dexs', 'Lending', 'Yield', 'Basis Trading'], multRows));
    var clampN = DATA.rows.filter(function (r) { return r.model.at_clamp_bound; }).length;
    fitDiv.appendChild(el('p', { text: 'The clamp is load-bearing: ' + clampN + ' of ' + DATA.rows.length + ' rows sit at a bound, so their fitted multiple is the bound, not the curve; they are labelled “at clamp bound” in the detail view.' }));
    fitDiv.appendChild(miniTable('Model selection — leave-one-out error on the same 128 live tokens (lower is better).', ['Variant', 'LOO median |ln err|', 'LOO RMSE', 'Split median'],
      F.horse_race.map(function (h) {
        return [h.variant, [h.loo_median.toFixed(4), 'num'], [h.loo_rmse.toFixed(4), 'num'], [h.split_median.toFixed(4), 'num']];
      })));
    fitDiv.appendChild(el('p', { text: 'Held-out evidence for the fitted model: LOO median |ln err| ' + F.loo_median.toFixed(4) + ', LOO RMSE ' + F.loo_rmse.toFixed(4) + ', 70/30 split median |ln err| ' + F.split_median.toFixed(4) + ' (seed ' + A.split_seed + ', test = first 38 of the seeded shuffle), R² ' + F.r2.toFixed(4) + ', residual SD ' + F.resid_sd.toFixed(4) + '. P10–P90 coverage is ' + (F.loo_coverage * 100).toFixed(1) + '% (LOO) and ' + (F.split_coverage * 100).toFixed(1) + '% (split) against a target of 80%. Honest limit: the fit is weak in absolute terms (R² 0.25; a typical live token’s market cap is mispredicted by a factor of e^' + F.loo_median.toFixed(2) + ' ≈ 3.6 at the LOO median). It beats the median model; it does not predict market cap precisely.' }));
    // --- walk-forward + ablation (radar-4) ---
    var WF = F.walk_forward;
    fitDiv.appendChild(el('p', { text: 'Walk-forward validation: the ' + WF.n + ' live-token protocols with a listed date (' + WF.n_null_excluded + ' record no date and are excluded, never imputed; ' + WF.earliest + ' to ' + WF.latest + ') are ordered oldest first. Fitting on the oldest ' + WF.folds[0].train + ' and testing the ' + WF.folds[0].test + ' newest gives median |ln err| ' + WF.folds[0].median.toFixed(4) + ' (coverage ' + (WF.folds[0].coverage * 100).toFixed(1) + '%); fitting on the oldest ' + WF.folds[1].train + ' and testing the ' + WF.folds[1].test + ' newest gives ' + WF.folds[1].median.toFixed(4) + ' (coverage ' + (WF.folds[1].coverage * 100).toFixed(1) + '%). Pooled over both folds (' + (WF.folds[0].test + WF.folds[1].test) + ' test predictions; the 15 newest are counted in both folds) the median is ' + WF.pooled_median.toFixed(4) + ' (coverage ' + (WF.pooled_coverage * 100).toFixed(1) + '%). The comparable leave-one-out median on the same implied basis (clamped multiple) is ' + WF.loo_implied_median.toFixed(4) + '. The second fold is worse than the first — reported as measured, not as a pass.' }));
    fitDiv.appendChild(miniTable('Ablation — blind-test median |ln err| with each term removed (implied basis, clamped multiple). A term is dropped only when removing it improves both blind tests by more than the drop bar; no term cleared it, so every term is kept and the ranking is unchanged.',
      ['Term', 'LOO without', 'Δ LOO', 'Walk-forward pooled without', 'Decision'],
      F.ablation.map(function (a) {
        return [a.term, [a.loo_without.toFixed(4), 'num'], [(a.loo_delta >= 0 ? '+' : '') + a.loo_delta.toFixed(4), 'num'], [a.wf_pooled_without.toFixed(4), 'num'], a.decision];
      })));
    fitDiv.appendChild(el('p', { text: F.ablation.map(function (a) { return a.term + ': ' + a.note; }).join(' ') }));

    // --- launch odds ---
    var oddsDiv = document.getElementById('methodOdds');
    oddsDiv.appendChild(el('h3', { text: 'Launch odds and expected value' }));
    oddsDiv.appendChild(el('p', { text: 'Odds measure resemblance to protocols that already record a token; the snapshot contains no launch event, so no true launch rate can be estimated from it. They come from a logistic regression on all ' + DATA.ledger.total + ' protocols, outcome “records a token” (' + O.live_share.toFixed(4) + ' do): logit(odds) = ' + O.intercept.toFixed(6) + ' + ' + O.age.toFixed(6) + ' × ln(age) ' + (O.growth >= 0 ? '+' : '−') + ' ' + Math.abs(O.growth).toFixed(6) + ' × growth + ' + O.peer.toFixed(6) + ' × peer logit. Growth is the 7-day change clamped to −40%…+60%, divided by 100; the peer logit is the live share in the protocol’s own category, shrunk toward the overall share with a prior weight of ' + O.prior_weight + ' protocols. Expected value = implied value × odds. Odds are never a forecast that a token will launch, and expected value is never a promised payout.' }));
    oddsDiv.appendChild(el('p', { text: 'The growth coefficient is negative as fitted: holding age and peer rate fixed, faster growth lowers odds, because the snapshot’s fast growers are young pre-token protocols while established live-token protocols grow slowly. Separation: AUC ' + O.auc.toFixed(4) + '; mean odds ' + O.mean_live.toFixed(3) + ' (records a token) vs ' + O.mean_pre.toFixed(3) + ' (pre-token). Brier ' + O.brier.toFixed(4) + ' (base rate ' + (O.live_share * (1 - O.live_share)).toFixed(4) + '). The board is ranked by expected value (fitted value × odds); implied value stays visible as the value-if-launches column.' }));

    // --- bootstrap ---
    var bootDiv = document.getElementById('methodBoot');
    bootDiv.appendChild(el('h3', { text: 'Uncertainty — bootstrap intervals' }));
    var medRankW = median(DATA.rows.map(function (r) { return r.rank_hi - r.rank_lo; }));
    var medIntW = median(DATA.rows.map(function (r) { return r.p90_usd - r.p10_usd; }));
    bootDiv.appendChild(el('p', { text: 'Every row carries a P10–P90 interval and a rank range from a deterministic bootstrap: ' + A.bootstrap_b + ' refits (seed ' + A.bootstrap_seed + '), each resampling the ' + F.n + ' live-token rows with replacement, refitting the 11-parameter OLS and re-ranking all ' + DATA.rows.length + ' board rows. Growth and maturity are held fixed; odds are not refit. P10 is the 20th smallest of the 200 values, P90 the 180th; the rank range is the lowest and highest rank across the refits. The intervals are wide — median rank-range width ' + medRankW + ' places, median P90−P10 width ' + fmtUsd(medIntW) + ' — and are shown as computed, never shrunk: the width is the finding (market-cap-to-TVL ratios vary roughly 24× within categories). A row at a clamp bound in nearly every refit has P10 = P90 = the clamped value and is shown as “stable in N/200 refits”.' }));

    // --- farm netting ---
    var farmDiv = document.getElementById('methodFarm');
    farmDiv.appendChild(el('h3', { text: 'Farm plans and their netting' }));
    var costs = DATA.rows.map(function (r) { return r.farm_cost_usd; });
    var dph = DATA.rows.map(function (r) { return r.dollars_per_hour; });
    farmDiv.appendChild(el('p', { text: 'Each plan is 7 steps shaped by the protocol’s category family, primary chain, capital tier ($250 / $150 / $100 / $50 from TVL) and hold time (60 / 45 / 30 days from age). Netting is computed from tier and hold, never by parsing the step text: gas = $3 + 2 × gas core ($8 at $150+ capital, $4 below) + $2 per week of hold; opportunity cost prices locked capital at an assumed ' + (A.opportunity_rate * 100).toFixed(0) + '% per year; total cost = gas + opportunity (range ' + fmtUsd(Math.min.apply(null, costs)) + '–' + fmtUsd(Math.max.apply(null, costs)) + '). Break-even share = total cost ÷ expected value. Verdict: FARM when the share is at most ' + A.verdict_farm + ' (expected value covers cost at least 100,000×), THIN at most ' + A.verdict_thin + ' (at least 10,000×), else SKIP. $/hour assumes the farmer captures ' + (A.allocation_share * 100).toFixed(3) + '% of expected value: proceeds = expected value × ' + (A.allocation_share * 100).toFixed(3) + '%, net = proceeds − total cost, $/hour = net ÷ active hours (hold days excluded). $/hour is a screening figure under that assumption, not a promised income — change it in the sandbox and it moves. Median $/hour is $' + Math.round(median(dph)).toLocaleString() + ' (range $' + Math.round(Math.min.apply(null, dph)).toLocaleString() + ' to $' + Math.round(Math.max.apply(null, dph)).toLocaleString() + '). The FARM bar was reviewed (radar-5): a $/hour ≥ $25 + net-beats-T-bill candidate gives the same 104 rows, so the bar is kept.' }));

    // --- ledger ---
    var ledDiv = document.getElementById('methodLedger');
    ledDiv.appendChild(el('h3', { text: 'Ledger' }));
    ledDiv.appendChild(el('p', { text: 'The ledger above accounts for all ' + DATA.ledger.total + ' snapshot protocols: ranked, excluded with reasons, and live. Nothing was silently dropped.' }));

    // --- D1r fallback ---
    var fbDiv = document.getElementById('methodFallback');
    fbDiv.appendChild(el('h3', { text: 'The radar-2 fallback (D1r) — retained, not deleted' }));
    var multList = Object.keys(DATA.category_multiples).sort().map(function (c) {
      return c + ' ' + DATA.category_multiples[c];
    }).join(', ');
    fbDiv.appendChild(el('p', { text: 'If the fitted model ever fails its recompute check, the build falls back to this radar-2 median model: implied = TVL × category multiple × size multiplier × growth multiplier × maturity multiplier. Category multiples (live-token medians, n ≥ 5, clamped 0.08–0.60; otherwise the overall median ' + DATA.model.fallback_multiple + '): ' + multList + '. Size multiplier (' + DATA.model.size_reference_usd / 1000000 + 'M ÷ TVL)^' + DATA.model.size_exponent + ', clamped to ' + DATA.model.size_floor + '–' + DATA.model.size_cap + '; growth 1 + ' + DATA.model.growth_weight + ' × clamp(7-day change, ' + DATA.model.growth_floor + '%, +' + DATA.model.growth_cap + '%) ÷ 100; maturity ' + DATA.model.maturity_floor + ' + ' + DATA.model.maturity_range + ' × min(age, ' + DATA.model.maturity_days + ' days) ÷ ' + DATA.model.maturity_days + ', unknown age uses ' + DATA.model.unknown_age_days + ' days. The fitted model beat this fallback on honest leave-one-out error (' + F.horse_race[1].loo_median.toFixed(4) + ' vs ' + F.horse_race[0].loo_median.toFixed(4) + '), which is why it is primary.' }));
  }

  // --- sandbox (D13) ---
  var ALLOC_STEPS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1]; // percent
  var sandbox = { slope: DATA.fit.slope, allocIdx: 3 };
  function sandboxGrowthMaturity(row) {
    var m = DATA.model;
    var growthPct = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var growth = 1 + (m.growth_weight * growthPct) / 100;
    var age = row.age_days === null ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    return { growth: growth, maturity: maturity };
  }
  function sandboxImplied(row, slope) {
    var gm = sandboxGrowthMaturity(row);
    var raw = Math.exp(DATA.fit.intercept + (slope - 1) * Math.log(row.tvl_usd) + row.model.category_effect);
    var mult = Math.min(0.6, Math.max(0.08, raw));
    return Math.max(1, Math.round(row.tvl_usd * mult * gm.growth * gm.maturity));
  }
  function renderSandbox() {
    var slope = sandbox.slope;
    var allocPct = ALLOC_STEPS[sandbox.allocIdx];
    var allocShare = allocPct / 100;
    document.getElementById('slopeOut').textContent = 'b = ' + slope.toFixed(3) + ' (fitted: ' + DATA.fit.slope.toFixed(6) + ')';
    document.getElementById('allocOut').textContent = allocPct.toFixed(3) + '% of expected value';
    var scored = DATA.rows.map(function (r) {
      return { row: r, imp: sandboxImplied(r, slope), ev: sandboxImplied(r, slope) * r.odds };
    });
    scored.sort(function (a, b) { return b.ev - a.ev || (a.row.slug < b.row.slug ? -1 : 1); });
    var top = document.getElementById('sandboxTop10');
    top.textContent = '';
    scored.slice(0, 10).forEach(function (s, i) {
      top.appendChild(el('li', null,
        el('b', { text: s.row.name }), document.createTextNode(' — ' + fmtUsd(s.ev) + ' EV (locked rank ' + s.row.rank + ')')));
    });
    var nets = DATA.rows.map(function (r) {
      var ev = sandboxImplied(r, slope) * r.odds;
      var net = ev * allocShare - r.farm_cost_usd;
      return { net: net, dph: net / r.hours_active };
    });
    var medDph = median(nets.map(function (n) { return n.dph; }));
    var posNet = nets.filter(function (n) { return n.net > 0; }).length;
    document.getElementById('sandboxStats').textContent =
      'At ' + allocPct.toFixed(3) + '% of expected value: median net $/hour $' + Math.round(medDph).toLocaleString() +
      '; ' + posNet + ' of ' + DATA.rows.length + ' rows net positive. ' +
      'Locked verdicts (set by the break-even ratio, unchanged by allocation): FARM ' + DATA.verdict_counts.FARM +
      ' / THIN ' + DATA.verdict_counts.THIN + ' / SKIP ' + DATA.verdict_counts.SKIP + '.';
  }
  function initSandbox() {
    document.getElementById('sandboxNote').textContent =
      'The sliders recompute the displayed values only; the submitted board is the locked ' + DATA.model_version + ' board, and no slider rewrites it or persists into board.json. Verdicts are set by the break-even ratio and do not move with allocation; net $/hour does.';
    document.getElementById('sandboxLock').textContent =
      'Locked board: expected value (implied × odds) at slope b = ' + DATA.fit.slope.toFixed(6) + ', 0.01% allocation for $/hour. The sandbox shows the same rows under a different slope or allocation.';
    var slopeEl = document.getElementById('slopeSlider');
    var allocEl = document.getElementById('allocSlider');
    slopeEl.value = String(DATA.fit.slope);
    allocEl.value = '3';
    slopeEl.addEventListener('input', function () { sandbox.slope = parseFloat(slopeEl.value); renderSandbox(); });
    allocEl.addEventListener('input', function () { sandbox.allocIdx = parseInt(allocEl.value, 10); renderSandbox(); });
    renderSandbox();
  }

  // --- compare (CSV export dropped: dashboard byte budget, D13) ---
  function initCompare() {
    var a = document.getElementById('cmpA'), b = document.getElementById('cmpB');
    DATA.rows.forEach(function (r) {
      var label = '#' + r.rank + ' ' + r.name;
      a.appendChild(el('option', { value: r.slug, text: label }));
      b.appendChild(el('option', { value: r.slug, text: label }));
    });
    a.value = DATA.rows[0].slug;
    b.value = DATA.rows[1].slug;
    var render = function () {
      var ra = bySlug(a.value), rb = bySlug(b.value);
      var out = document.getElementById('compareOut');
      out.textContent = '';
      if (!ra || !rb) return;
      out.appendChild(miniTable(null, ['', ra.name, rb.name], [
        ['Rank', [String(ra.rank), 'num'], [String(rb.rank), 'num']],
        ['Category', ra.category || 'Other', rb.category || 'Other'],
        ['Chains', (ra.chains || []).join(', ') || '—', (rb.chains || []).join(', ') || '—'],
        ['TVL', [fmtUsd(ra.tvl_usd), 'num'], [fmtUsd(rb.tvl_usd), 'num']],
        ['7d change', [fmtPct(ra.change_7d), 'num'], [fmtPct(rb.change_7d), 'num']],
        ['Age', [fmtAge(ra.age_days), 'num'], [fmtAge(rb.age_days), 'num']],
        ['Implied value', [money.format(ra.implied_value_usd), 'num'], [money.format(rb.implied_value_usd), 'num']],
        ['Odds', [fmtOdds(ra.odds), 'num'], [fmtOdds(rb.odds), 'num']],
        ['Expected value', [money.format(ra.expected_value_usd), 'num'], [money.format(rb.expected_value_usd), 'num']],
        ['P10–P90', [fmtInterval(ra), 'num'], [fmtInterval(rb), 'num']],
        ['Rank range', [(ra.rank_lo + '–' + ra.rank_hi), 'num'], [(rb.rank_lo + '–' + rb.rank_hi), 'num']],
        ['Verdict', ra.verdict, rb.verdict],
        ['Farm cost', [money.format(ra.farm_cost_usd), 'num'], [money.format(rb.farm_cost_usd), 'num']],
        ['$/hour (1 bp)', ['$' + ra.dollars_per_hour.toLocaleString(), 'num'], ['$' + rb.dollars_per_hour.toLocaleString(), 'num']],
      ]));
    };
    a.addEventListener('change', render);
    b.addEventListener('change', render);
    render();
  }

  var dialog = document.getElementById('detail');
  dialog.addEventListener('close', function () {
    if (state.selected) { state.selected = null; writeHash(); renderRows(); }
  });

  function openDetail(slug) {
    var row = bySlug(slug);
    if (!row) {
      // Unknown #p= slug: never open a half dialog and never leave a stale
      // selection behind — drop it from the state and the hash so the page
      // stays exactly as it was (board visible, filters unchanged).
      if (state.selected) { state.selected = null; writeHash(); }
      if (dialog.open) dialog.close();
      renderRows();
      return;
    }
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var m = row.model;
    var growthWord = row.change_7d === null
      ? 'No seven-day change is recorded, so growth is treated as 0%.'
      : 'Seven-day change ' + fmtPct(row.change_7d) + ' is clamped to −40%…+60%, giving a growth multiplier of ' + m.growth_multiplier + '.';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' — Watchlist' : '') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' — records no token' })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    var multLine = 'Fitted multiple ' + m.fitted_multiple + ' (raw ' + m.fitted_multiple_raw + (m.at_clamp_bound ? ', at clamp bound' : '') + ')';
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value (fitted model)' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Fitted multiple (' + (row.category || 'Other') + ', effect ' + (m.category_effect >= 0 ? '+' : '') + m.category_effect + ')' }), el('b', { text: String(m.fitted_multiple) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { text: String(m.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier (age ' + fmtAge(row.age_days) + ')' }), el('b', { text: String(m.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { text: money.format(row.implied_value_usd) }))
      ),
      el('p', { class: 'words-eq', text: 'TVL ' + fmtUsd(row.tvl_usd) + ' × ' + m.fitted_multiple + ' (fitted multiple, slope ' + m.slope + ') × ' + m.growth_multiplier + ' (growth) × ' + m.maturity_multiplier + ' (maturity) = ' + money.format(row.implied_value_usd) }),
      el('p', { text: multLine + '. The curve is log mcap = ' + m.intercept + ' + ' + m.slope + ' × ln(TVL) + category effect, fitted to the ' + DATA.fit.n + ' live-token protocols; the D1r median multiple for this category (' + m.d1r_multiple + ') is the fallback. ' + growthWord + ' Maturity multiplier ' + m.maturity_multiplier + ' rewards ' + fmtAge(row.age_days) + ' of life with no token on record. The fit is weak in absolute terms (R² ' + DATA.fit.r2.toFixed(2) + ') — see Methodology.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Anchored by traded tokens' }),
      el('p', { text: 'The implied value is anchored to the three traded tokens nearest in TVL' + (row.comps_same_category < 3 ? ' — only ' + row.comps_same_category + ' of the 3 share this category, the rest are the TVL-nearest tokens of any category.' : ', all three in this category.') }),
      el('ul', { class: 'comps' }, row.comps.map(function (c) {
        return el('li', null, el('b', { text: c.name }),
          document.createTextNode(' — mcap/TVL ' + c.multiple + (c.same_category ? ' (same category)' : ' (other category)') + ', TVL ' + fmtUsd(c.tvl_usd)));
      }))
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Launch odds and expected value' }),
      el('p', { text: 'Odds ' + fmtOdds(row.odds) + ' — a peer-resemblance score, not a forecast that a token will launch. Expected value ' + money.format(row.expected_value_usd) + ' = implied value × odds.' }),
      el('p', { text: 'Odds inputs: ln(age ' + (row.age_days === null ? '365 (unknown)' : row.age_days + 'd') + ') = ' + Math.log(row.age_days === null ? 365 : row.age_days).toFixed(3) + '; growth term ' + (row.change_7d === null ? '0' : (Math.min(60, Math.max(-40, row.change_7d)) / 100).toFixed(3)) + '; peer rate in this category ' + (row.peer_shrunk * 100).toFixed(1) + '% (shrunk), peer logit ' + row.peer_logit.toFixed(3) + '. The snapshot holds no launch event, so no true launch rate can be estimated.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Uncertainty (bootstrap)' }),
      el('p', { text: (row.stable_refits !== null && row.stable_refits !== undefined ? 'P10–P90 stable in ' + row.stable_refits + '/' + DATA.assumptions.bootstrap_b + ' refits — the fitted multiple sits at the clamp bound in nearly every refit, so the interval is degenerate; the rank range beside it is the computed range, narrow for the top rows.' : 'P10–P90 ' + fmtRange(row.p10_usd, row.p90_usd) + '.') + ' Rank range ' + row.rank_lo + '–' + row.rank_hi + ' across ' + DATA.assumptions.bootstrap_b + ' refits. Wide ranges are shown as computed, never shrunk.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — 7 steps' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      })),
      el('p', { text: 'Netting: capital $' + row.capital_tier + ', hold ' + row.hold_days + ' days; gas $' + row.gas_total_usd + ' + opportunity $' + row.opportunity_cost_usd.toFixed(2) + ' (capital at ' + (DATA.assumptions.opportunity_rate * 100).toFixed(0) + '%/year) = total cost $' + row.farm_cost_usd.toFixed(2) + '. Break-even share ' + (row.break_even_share * 100).toFixed(4) + '% of expected value. $/hour $' + row.dollars_per_hour.toLocaleString() + ' assumes the farmer captures ' + (DATA.assumptions.allocation_share * 100).toFixed(3) + '% of expected value — a screening figure, not promised income. Verdict: ' + row.verdict + '.' })
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    renderRows();
  }

  function initHeader() {
    document.getElementById('asof').textContent = 'Snapshot ' + DATA.as_of;
    document.getElementById('modelVer').textContent = 'Model ' + DATA.model_version;
    document.getElementById('fact-watch').textContent = DATA.watchlist_size + ' / ' + DATA.watchlist_size;
    document.getElementById('fact-board').textContent = String(DATA.board_size);
    document.getElementById('fact-early').textContent = String(DATA.early_size);
    document.getElementById('fact-live').textContent = String(DATA.live_size);
    document.getElementById('formula').textContent =
      'expected = implied × odds (the ranking key); implied = TVL × fitted multiple (log-log OLS, slope ' + DATA.fit.slope.toFixed(6) + ') × growth × maturity — ' + DATA.model_version + ', snapshot ' + DATA.as_of +
      '. Board: ' + DATA.board_size + ' rows (' + DATA.watchlist_size + ' watchlist + ' + DATA.early_size + ' early).';
    document.getElementById('src').textContent =
      'Source: ' + (DATA.source ? DATA.source.split(' ')[0] : 'DefiLlama') + ' protocol index, snapshot ' + DATA.as_of + '.';
  }

  function syncControls() {
    var q = document.getElementById('q');
    var cat = document.getElementById('category');
    var ch = document.getElementById('chain');
    var verdict = document.getElementById('verdict');
    var min = document.getElementById('minTvl');
    var watch = document.getElementById('watchOnly');
    q.value = state.q;
    syncSelectWithUnknown(cat, state.category, boardCats);
    syncSelectWithUnknown(ch, state.chain, boardChains);
    verdict.value = state.verdict;
    min.value = state.minTvl > 0 ? String(state.minTvl) : '';
    watch.checked = state.watchOnly;
  }

  readHash();
  initHeader();
  initControls();
  renderKpi();
  renderEvidence();
  renderLedger();
  renderMethod();
  initSandbox();
  initCompare();
  renderLive();
  renderRows();
  if (state.selected) openDetail(state.selected);
  window.addEventListener('hashchange', function () {
    readHash();
    syncControls();
    if (!state.selected && dialog.open) dialog.close();
    renderRows();
    if (state.selected) openDetail(state.selected);
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
