// Token Radar dashboard. Reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, its filters, the per-protocol detail
// view and the separate live-token section. No network: every byte it shows
// is already in data.js. No fetch, no framework, no external font.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  var state = {
    q: '', category: 'all', chain: 'all', watchOnly: false, minTvl: 0,
    sort: 'implied', dir: -1, selected: null
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
    state.watchOnly = params.get('watch') === '1';
    state.minTvl = parseFloat(params.get('min')) || 0;
    state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
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
      if (state.watchOnly && !r.watchlist) return false;
      if (state.minTvl > 0 && r.tvl_usd < state.minTvl * 1e6) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
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

  function initControls() {
    var cats = {}, chains = {};
    DATA.rows.forEach(function (r) {
      var c = r.category || 'Other';
      cats[c] = (cats[c] || 0) + 1;
      (r.chains || []).forEach(function (ch) { chains[ch] = (chains[ch] || 0) + 1; });
    });
    var catNames = Object.keys(cats).sort();
    var chainNames = Object.keys(chains).sort();
    fillSelect(document.getElementById('category'), catNames, cats, 'All categories');
    fillSelect(document.getElementById('chain'), chainNames, null, 'All chains');

    var q = document.getElementById('q');
    var cat = document.getElementById('category');
    var ch = document.getElementById('chain');
    var min = document.getElementById('minTvl');
    var watch = document.getElementById('watchOnly');
    q.value = state.q; cat.value = state.category; ch.value = state.chain;
    if (state.minTvl > 0) min.value = String(state.minTvl);
    watch.checked = state.watchOnly;
    q.addEventListener('input', function () { state.q = q.value; writeHash(); renderRows(); });
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); renderRows(); });
    ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); renderRows(); });
    min.addEventListener('input', function () { state.minTvl = parseFloat(min.value) || 0; writeHash(); renderRows(); });
    watch.addEventListener('change', function () { state.watchOnly = watch.checked; writeHash(); renderRows(); });
    document.getElementById('clear').addEventListener('click', function () {
      state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; state.minTvl = 0;
      q.value = ''; cat.value = 'all'; ch.value = 'all'; min.value = ''; watch.checked = false;
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
        el('td', { text: r.category || 'Other' }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        ))
      );
      tbody.appendChild(tr);
    });
    document.getElementById('count').textContent = list.length + ' rows shown';
    document.getElementById('empty').hidden = list.length > 0;
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
        el('td', { text: r.category || 'Other' }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) })
      ));
    });
  }

  var dialog = document.getElementById('detail');
  dialog.addEventListener('close', function () {
    if (state.selected) { state.selected = null; writeHash(); renderRows(); }
  });

  function openDetail(slug) {
    var row = bySlug(slug);
    if (!row) return;
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
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple (' + (row.category || 'Other') + ')' }), el('b', { text: String(m.base_multiple) })),
        el('div', null, el('span', { text: 'Size multiplier' }), el('b', { text: String(m.size_multiplier) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { text: String(m.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier (age ' + fmtAge(row.age_days) + ')' }), el('b', { text: String(m.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { text: 'Category multiple ' + m.base_multiple + ' is the live-token median for ' + (row.category || 'Other') + ' (or the overall median 0.205 where the category has too few live comparators). Size multiplier ' + m.size_multiplier + ' damps giant TVLs. ' + growthWord + ' Maturity multiplier ' + m.maturity_multiplier + ' rewards ' + fmtAge(row.age_days) + ' of life with no token on record. Model radar-2; the same function scores every row.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — 7 steps' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
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
    document.getElementById('fact-watch').textContent = DATA.watchlist_size + ' / ' + DATA.watchlist_size;
    document.getElementById('fact-board').textContent = String(DATA.board_size);
    document.getElementById('fact-early').textContent = String(DATA.early_size);
    document.getElementById('fact-live').textContent = String(DATA.live_size);
    document.getElementById('formula').textContent =
      'implied = TVL × category multiple × size × growth × maturity — radar-2, snapshot ' + DATA.as_of +
      '. Board: ' + DATA.board_size + ' rows (' + DATA.watchlist_size + ' watchlist + ' + DATA.early_size + ' early).';
    document.getElementById('src').textContent =
      'Source: ' + (DATA.source ? DATA.source.split(' ')[0] : 'DefiLlama') + ' protocol index, snapshot ' + DATA.as_of + '.';
  }

  function syncControls() {
    var q = document.getElementById('q');
    var cat = document.getElementById('category');
    var ch = document.getElementById('chain');
    var min = document.getElementById('minTvl');
    var watch = document.getElementById('watchOnly');
    q.value = state.q; cat.value = state.category; ch.value = state.chain;
    min.value = state.minTvl > 0 ? String(state.minTvl) : '';
    watch.checked = state.watchOnly;
  }

  readHash();
  initHeader();
  initControls();
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
