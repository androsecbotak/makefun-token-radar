// Token Radar, dark edition. Reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the board, the early finds, the farming playbooks, and a detail drawer with the
// model's factors, an opportunity score, the reason it ranks, snapshot analytics and risk
// signals. No network: every byte is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, view: 'all', nav: 'overview' };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
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
  function fmtMult(n) { return (Math.round(n * 10000) / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0'); }
  function ordinal(n) { return n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'; }
  var RISK_CAVEAT = 'Structural signals only. The snapshot holds no audit, liquidity, or contract data, so this is not a smart-contract audit and cannot detect a scam or a contract bug.';

  // The radar-2 model in one function: the page recomputes a row and checks the number
  // board.json carries, so page and board are visibly the same arithmetic. Base x growth
  // (momentum past 50%) x maturity (tapering past 3 years) x category x chain breadth.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight + (growth > model.momentum_threshold ? ((growth - model.momentum_threshold) / 100) * model.momentum_weight : 0);
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity;
    if (age <= model.maturity_days) maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    else maturity = (model.maturity_floor + model.maturity_range) - model.maturity_taper * (Math.min(age - model.maturity_days, model.maturity_taper_days) / model.maturity_taper_days);
    var categoryMult = row.category !== null && model.category_factors[row.category] !== undefined ? model.category_factors[row.category] : model.category_default;
    var chainMult = 1 + model.chain_step * Math.min(Math.max((row.chains || []).length - 1, 0), model.chain_cap_extra);
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * categoryMult * chainMult));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
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

  // The farm plan lives in the row itself: main.ts writes each row's six steps to board.json
  // and data.js, so the page renders the board's own strings instead of re-deriving them.
  // Only the capital tier and the hold time are computed here, for the farming cards.
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function firstMove(step) {
    var at = step.indexOf(' Cost: ');
    return at >= 0 ? step.slice(0, at) : step;
  }
  // The row's TVL rank on the board (1 = largest), computed once for the score's size part.
  // Ties break by slug so the rank is the same on every load.
  var TVL_RANK = {};
  DATA.rows.slice().sort(function (a, b) {
    if (a.tvl_usd !== b.tvl_usd) return b.tvl_usd - a.tvl_usd;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  }).forEach(function (r, i) { TVL_RANK[r.slug] = i + 1; });

  // Opportunity score, 0-100, in the page only: it never changes a rank or an implied value.
  // score = 0.35 x size + 0.20 x growth + 0.20 x maturity + 0.15 x category + 0.10 x chains.
  // Size is the TVL rank (1 = largest) mapped to 100; growth is the clamped seven-day change
  // mapped -60..+120 to 0..100 (unreported = 50); maturity and category are the model's own
  // multipliers mapped to 0..100; chains is min(chains - 1, 4) / 4.
  function opportunityScore(row) {
    var n = DATA.rows.length;
    var parts = {
      size: ((n - (TVL_RANK[row.slug] || n) + 1) / n) * 100,
      growth: ((row.change_7d === null || row.change_7d === undefined ? 0 : Math.min(120, Math.max(-60, row.change_7d))) + 60) / 180 * 100,
      maturity: (row.maturity_multiplier - 0.6) / 0.4 * 100,
      category: (row.category_multiplier - 0.95) / 0.2 * 100,
      chains: Math.min(Math.max((row.chains || []).length - 1, 0), 4) / 4 * 100
    };
    var total = Math.max(0, Math.min(100, Math.round(0.35 * parts.size + 0.20 * parts.growth + 0.20 * parts.maturity + 0.15 * parts.category + 0.10 * parts.chains)));
    Object.keys(parts).forEach(function (k) { parts[k] = Math.round(parts[k]); });
    return { total: total, parts: parts };
  }
  function ringColor(score) { return score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#64748b'; }

  // Structural risk signals, from snapshot fields only. The snapshot holds no audit,
  // liquidity or contract data, so this is a structural signal, NOT a smart-contract audit
  // and NOT a fraud detector. A Low signal is not a promise that a protocol is safe.
  function riskOf(row) {
    var signals = [];
    var age = row.age_days;
    if (age === null || age === undefined) signals.push('Listing date unlisted');
    else if (age < 90) signals.push('Listed ' + fmtAge(age) + ' ago — less proven');
    if ((row.chains || []).length <= 1) signals.push('Single chain');
    if (row.change_7d !== null && row.change_7d !== undefined && Math.abs(row.change_7d) >= 30) signals.push('Volatile week (' + fmtPct(row.change_7d) + ')');
    var c = (row.category || '').toLowerCase();
    if (c.indexOf('bridge') >= 0 || c === 'chain' || c.indexOf('cex') >= 0 || c.indexOf('cedefi') >= 0) signals.push('Bridge or chain-adjacent');
    var level = signals.length === 0 ? 'Low' : signals.length === 1 ? 'Moderate' : 'Elevated';
    return { level: level, signals: signals };
  }

  // Why this ranks here: the entry's own explanation, from the row's figures.
  // Not a live chat and not a live model.
  function whyRanks(row) {
    var out = [];
    var base = Math.round(row.tvl_usd * DATA.model.base_multiple);
    out.push('TVL ' + fmtUsd(row.tvl_usd) + ' is the ' + TVL_RANK[row.slug] + ordinal(TVL_RANK[row.slug]) + ' largest on the board, so the base alone is ' + fmtUsd(base) + '.');
    if (row.change_7d === null || row.change_7d === undefined) out.push('No seven-day change was reported, so growth is scored as flat.');
    else if (row.change_7d >= 10) out.push('A strong week (' + fmtPct(row.change_7d) + ') lifts it past the momentum line.');
    else if (row.change_7d <= -10) out.push('A weak week (' + fmtPct(row.change_7d) + ') holds it back.');
    else out.push('Its week was quiet (' + fmtPct(row.change_7d) + '), so growth is neutral.');
    if (row.age_days === null || row.age_days === undefined) out.push('Its listing date is not in the record, so the model gives it one year of age.');
    else if (row.age_days >= 1095) out.push('Three-plus years with no token gives full maturity credit, now tapering.');
    else if (row.age_days < 180) out.push('It is young (' + fmtAge(row.age_days) + '), so maturity credit is still low.');
    else out.push('At ' + fmtAge(row.age_days) + ' it carries most of its maturity credit.');
    if (row.category_multiplier >= 1.15) out.push('Its category earns the top factor (x' + fmtMult(row.category_multiplier) + ').');
    else if (row.category_multiplier <= 0.95) out.push('Its category earns the lowest factor (x' + fmtMult(row.category_multiplier) + ').');
    var n = (row.chains || []).length;
    if (n >= 5) out.push('It runs on ' + n + ' chains, the full breadth credit.');
    else if (n <= 1) out.push('A single chain gives it no breadth credit.');
    out.push('The farm plan assumes $' + capitalFor(row) + ' of capital held for at least ' + holdDaysFor(row.age_days) + ' days.');
    return out;
  }

  function median(nums) {
    if (!nums.length) return null;
    var s = nums.slice().sort(function (a, b) { return a - b; });
    return s[Math.floor(s.length / 2)];
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('view') === 'early' || params.get('view') === 'watchlist') state.view = params.get('view');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.view !== 'all') params.set('view', state.view);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.view === 'early' && r.watchlist) return false;
      if (state.view === 'watchlist' && !r.watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (!r.chains || r.chains.indexOf(state.chain) < 0)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var keys = {
      name: function (r) { return r.name.toLowerCase(); },
      tvl: function (r) { return r.tvl_usd; },
      growth: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; },
      score: function (r) { return opportunityScore(r).total; },
      implied: function (r) { return r.implied_value_usd; }
    };
    var f = keys[state.sort] || keys.implied;
    return list.slice().sort(function (a, b) {
      var av = f(a), bv = f(b);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function scrollToId(id) {
    var t = document.getElementById(id);
    if (t) t.scrollIntoView();
  }
  function goNav(name) {
    state.nav = name;
    if (name === 'overview') { scrollToId('overview'); }
    else if (name === 'discover') { state.view = 'early'; writeHash(); render(); scrollToId('board'); }
    else if (name === 'watchlist') { state.view = 'watchlist'; writeHash(); render(); scrollToId('board'); }
    else if (name === 'farming') { scrollToId('farming'); }
    else if (name === 'risk') { scrollToId('risk'); }
    else if (name === 'research') { scrollToId('research'); }
  }

  function sidebar() {
    var items = [
      ['overview', '⌂', 'Overview'],
      ['discover', '◎', 'Discover'],
      ['watchlist', '★', 'Watchlist'],
      ['farming', '⚒', 'Farming Intel'],
      ['risk', '⛨', 'Risk Center'],
      ['research', '✦', 'AI Research']
    ];
    return el('aside', { class: 'sidebar' },
      el('div', { class: 'brand' },
        el('span', { class: 'radar-mark', 'aria-hidden': 'true' }),
        el('span', { class: 'brand-name' }, 'TOKEN', el('span', { text: 'RADAR' }))
      ),
      el('nav', { class: 'nav', 'aria-label': 'Sections' }, items.map(function (it) {
        return el('button', {
          type: 'button', 'aria-pressed': state.nav === it[0] ? 'true' : 'false',
          onclick: function () { goNav(it[0]); }
        }, el('span', { class: 'ic', 'aria-hidden': 'true', text: it[1] }), it[2]);
      })),
      el('div', { class: 'sidebar-foot' },
        el('div', { class: 'snap-card' },
          el('h3', { text: 'Sealed snapshot' }),
          el('p', { text: 'Snapshot 14 Nov 2026 · ' + DATA.protocols_total + ' protocols · DefiLlama index. One frozen day.' })
        ),
        el('div', { class: 'snap-live' },
          el('span', { class: 'dot', 'aria-hidden': 'true' }),
          el('span', { text: 'Snapshot — frozen for the competition' })
        )
      )
    );
  }

  function topbar() {
    var search = el('input', { type: 'search', id: 'q', class: 'search', placeholder: 'Search protocols...', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All Chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    return el('div', { class: 'topbar' },
      search,
      chainSelect,
      el('span', { class: 'pill', text: '7D window' }),
      el('span', { class: 'pill snap' }, el('span', { class: 'dot', 'aria-hidden': 'true' }), 'Snapshot')
    );
  }

  function hero() {
    return el('section', { class: 'hero', id: 'overview' },
      el('span', { class: 'radar-mark', 'aria-hidden': 'true' }),
      el('div', null,
        el('h1', null, 'Early Opportunity ', el('span', { class: 'green', text: 'Radar' })),
        el('p', { text: 'Discover promising DeFi protocols before they launch tokens' })
      )
    );
  }

  function kpis() {
    var boardTvl = DATA.rows.reduce(function (s, r) { return s + r.tvl_usd; }, 0);
    var withCh = DATA.rows.filter(function (r) { return r.change_7d !== null && r.change_7d !== undefined; });
    var wAvg = withCh.reduce(function (s, r) { return s + r.tvl_usd * r.change_7d; }, 0) / withCh.reduce(function (s, r) { return s + r.tvl_usd; }, 0);
    function kpi(icon, label, value, sub) {
      return el('div', { class: 'kpi' },
        el('span', { class: 'label' }, el('span', { class: 'ic', 'aria-hidden': 'true', text: icon }), label),
        el('b', { text: value }),
        el('small', { text: sub })
      );
    }
    return el('div', { class: 'kpis' },
      kpi('▣', 'Protocols Tracked', String(DATA.protocols_total), 'in the sealed snapshot'),
      kpi('◉', 'Pre-token rows', String(DATA.board_size), DATA.watchlist_size + ' watchlist + ' + DATA.early_size + ' early finds'),
      kpi('✓', 'Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size, 'every watchlist protocol ranked'),
      kpi('▤', 'TVL of the pre-token board', fmtUsd(boardTvl), 'TVL-weighted 7d change: ' + fmtPct(wAvg))
    );
  }

  function chartPanel() {
    var top10 = DATA.rows.slice(0, 10);
    var max = top10[0].implied_value_usd || 1;
    return el('section', { class: 'panel anchor', id: 'chart' },
      el('div', { class: 'panel-head' },
        el('h2', { text: 'Top 10 by implied value' }),
        el('button', { type: 'button', class: 'linklike', text: 'View All →', onclick: function () { scrollToId('board'); } })
      ),
      el('div', { class: 'panel-body' },
        el('div', { class: 'bars' }, top10.map(function (r) {
          return el('div', { class: 'row' },
            el('span', { class: 'nm' }, el('b', { text: '#' + r.rank + ' ' }), r.name),
            el('div', { class: 'track', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
            el('b', { class: 'val', text: fmtUsd(r.implied_value_usd) })
          );
        })),
        el('p', { class: 'chart-note', text: 'Implied value, top 10 of the pre-token board. Snapshot 14 Nov 2026 — one day, no trend line.' })
      )
    );
  }

  function signalsPanel() {
    var n = DATA.rows.length;
    var pos = DATA.rows.filter(function (r) { return r.change_7d !== null && r.change_7d !== undefined && r.change_7d > 0; }).length;
    var multi = DATA.rows.filter(function (r) { return (r.chains || []).length >= 2; }).length;
    function sig(icon, name, sub, value) {
      return el('div', { class: 'signal' },
        el('span', { class: 'ic', 'aria-hidden': 'true', text: icon }),
        el('div', { class: 'tx' }, el('b', { text: name }), el('span', { text: sub })),
        el('span', { class: 'num', text: value })
      );
    }
    return el('section', { class: 'panel anchor', id: 'signals' },
      el('div', { class: 'panel-head' }, el('h2', { text: 'Opportunity Signals' })),
      el('div', { class: 'panel-body' },
        el('div', { class: 'signals' },
          sig('↗', 'Positive 7-day growth', pos + ' of ' + n + ' rows grew in 7 days', Math.round((pos / n) * 100) + '%'),
          sig('▦', 'Multi-chain reach', multi + ' of ' + n + ' rows run on 2+ chains', Math.round((multi / n) * 100) + '%'),
          sig('◎', 'Early finds', DATA.early_size + ' protocols below the $50M floor', String(DATA.early_size)),
          sig('✓', 'Watchlist covered', 'every watchlist protocol is ranked', DATA.watchlist_size + ' / ' + DATA.watchlist_size)
        )
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    function pill(view, label) {
      return el('button', {
        type: 'button', 'aria-pressed': state.view === view ? 'true' : 'false',
        onclick: function () { state.view = view; writeHash(); render(); }
      }, label);
    }
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'viewpills' },
        pill('all', 'All pre-token'),
        pill('early', 'Early finds'),
        pill('watchlist', 'Watchlist')
      ),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.view = 'all'; writeHash(); render(); } })
      ));
    }
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var score = opportunityScore(r);
      var risk = riskOf(r);
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: 'Implied ' + fmtUsd(r.implied_value_usd) }))),
        el('td', { text: r.category || 'Other' }),
        el('td', { text: (r.chains && r.chains.length ? r.chains[0] + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : '') : '—') }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', null, el('span', { class: 'ring', style: '--p:' + score.total + ';--ring:' + ringColor(score.total) }, el('b', { text: String(score.total) }))),
        el('td', null, el('span', { class: 'risk risk-' + (risk.level === 'Low' ? 'low' : risk.level === 'Moderate' ? 'mod' : 'high'), title: risk.signals.length ? risk.signals.join('; ') : 'No structural risk signals', text: risk.level })),
        el('td', null, r.watchlist ? el('span', { class: 'badge watch', text: 'Watchlist' }) : el('span', { class: 'badge early', text: 'Early find' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Chain' }),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7D'),
            sortHeader('score', 'Score'),
            el('th', { scope: 'col', text: 'Risk' }),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('b', { text: r.name })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'These protocols already trade, so their market cap is a fact, not a model. Set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7D' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function briefRow() {
    if (state.selected) {
      var found = DATA.rows.filter(function (r) { return r.slug === state.selected; })[0];
      if (found) return found;
    }
    return DATA.rows[0];
  }
  function briefSignals(row) {
    var out = [];
    out.push('TVL ' + fmtUsd(row.tvl_usd) + ' — the ' + TVL_RANK[row.slug] + ordinal(TVL_RANK[row.slug]) + ' largest on the board');
    var n = (row.chains || []).length;
    if (n >= 5) out.push(n + ' chains — the full breadth credit');
    else if (n <= 1) out.push('A single chain — no breadth credit');
    else out.push(n + ' chains');
    if (row.category_multiplier >= 1.15) out.push('Category factor x' + fmtMult(row.category_multiplier) + ' — top of the model table');
    else if (row.category_multiplier <= 0.95) out.push('Category factor x' + fmtMult(row.category_multiplier) + ' — bottom of the model table');
    if (row.change_7d !== null && row.change_7d !== undefined && row.change_7d >= 10) out.push('Seven-day growth ' + fmtPct(row.change_7d) + ' — a strong week');
    return out.slice(0, 3);
  }

  function briefPanel() {
    var row = briefRow();
    var why = whyRanks(row);
    var risk = riskOf(row);
    var score = opportunityScore(row);
    return el('section', { class: 'panel anchor', id: 'research' },
      el('div', { class: 'panel-head' },
        el('h2', { text: 'Research Brief' }),
        el('button', { type: 'button', class: 'linklike', text: 'View Details →', onclick: function () { openDetail(row.slug); } })
      ),
      el('div', { class: 'brief' },
        el('div', { class: 'brief-head' },
          el('span', { class: 'brief-mark', 'aria-hidden': 'true', text: '✦' }),
          el('div', null,
            el('h3', { text: row.name }),
            el('p', { class: 'sub', text: (row.category || 'Other') + ' · ' + (row.chains && row.chains.length ? row.chains[0] + (row.chains.length > 1 ? ' +' + (row.chains.length - 1) : '') : 'an unnamed chain') + ' · Rank ' + row.rank + ' of ' + DATA.board_size })
          ),
          el('span', { class: 'ring big', style: '--p:' + score.total + ';--ring:' + ringColor(score.total) }, el('b', { text: String(score.total) }))
        ),
        el('div', { class: 'brief-sec' },
          el('h4', { class: 'why', text: '✓ Why it ranks' }),
          el('p', { text: why[0] + ' ' + why[1] })
        ),
        el('div', { class: 'brief-sec' },
          el('h4', { text: '▦ Signals' }),
          el('p', { text: briefSignals(row).join('; ') + '.' })
        ),
        el('div', { class: 'brief-sec' },
          el('h4', { class: 'warn', text: '⚠ Risks to verify' }),
          el('p', { text: (risk.signals.length ? risk.signals.join('; ') + '. ' : 'No structural risk signals in the snapshot. ') + 'Check the team, audit status, and token launch roadmap on official sources.' })
        )
      )
    );
  }

  function farmView() {
    var byCat = {};
    DATA.rows.forEach(function (r) {
      var c = r.category || 'Other';
      if (!byCat[c]) byCat[c] = [];
      byCat[c].push(r);
    });
    var cats = Object.keys(byCat).sort(function (a, b) { return byCat[b][0].implied_value_usd - byCat[a][0].implied_value_usd; });
    return el('section', { class: 'anchor', id: 'farming' },
      el('div', { class: 'panel-head' }, el('h2', { text: 'Farming Intelligence' })),
      el('div', { class: 'panel-body' },
        el('p', { class: 'sub', text: 'One playbook per category, derived from its rows. Open a card to filter the board to it.' }),
        el('div', { class: 'farm-grid' }, cats.map(function (c) {
          var list = byCat[c];
          var top = list[0];
          var cap = capitalFor({ tvl_usd: median(list.map(function (r) { return r.tvl_usd; })) || 0 });
          var hold = holdDaysFor(median(list.map(function (r) { return r.age_days === null ? 365 : r.age_days; })));
          return el('button', {
            type: 'button', class: 'farm-card',
            onclick: function () { state.category = c; state.view = 'all'; state.nav = 'overview'; writeHash(); render(); scrollToId('board'); }
          },
            el('h3', { text: c }),
            el('span', { class: 'meta', text: list.length + ' protocol' + (list.length === 1 ? '' : 's') + ' · top: ' + top.name + ' (' + fmtUsd(top.implied_value_usd) + ' implied)' }),
            el('span', { class: 'move', text: firstMove(top.farm_steps[1] || '') }),
            el('span', { class: 'chips' },
              el('span', { class: 'chip', text: 'Capital $' + cap }),
              el('span', { class: 'chip', text: 'Hold ' + hold + ' days' })
            ),
            el('span', { class: 'link', text: 'View in board →' })
          );
        }))
      )
    );
  }

  function riskCenter() {
    var dist = { Low: 0, Moderate: 0, Elevated: 0 };
    DATA.rows.forEach(function (r) { dist[riskOf(r).level]++; });
    return el('section', { class: 'anchor', id: 'risk' },
      el('div', { class: 'panel-head' }, el('h2', { text: 'Risk Center' })),
      el('div', { class: 'risk-cards' },
        el('div', { class: 'risk-card' }, el('b', { text: String(dist.Low) }), el('span', { text: 'Low — no structural signals' })),
        el('div', { class: 'risk-card' }, el('b', { text: String(dist.Moderate) }), el('span', { text: 'Moderate — one structural signal' })),
        el('div', { class: 'risk-card' }, el('b', { text: String(dist.Elevated) }), el('span', { text: 'Elevated — two or more signals' }))
      ),
      el('div', { class: 'panel model' },
        el('h3', { text: 'What the signal is built from' }),
        el('p', { class: 'sub', text: 'Age under 90 days or unlisted; a single chain; a seven-day move of 30% or more; a bridge or chain-adjacent category. One signal is Moderate, two or more is Elevated.' }),
        el('p', { class: 'caveat', text: RISK_CAVEAT })
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var tiers = [
      ['Yield-bearing vaults & curators', 'x1.15'],
      ['Markets: Dexs, Lending, RWA, Derivatives', 'x1.10'],
      ['Debt, basis, staking & prediction', 'x1.05'],
      ['Everything else', 'x1.00'],
      ['Chain & cross-chain bridge', 'x0.95']
    ];
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How the radar scores' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + m.base_multiple + ' x growth x maturity x category x chains )'
      ),
      el('div', { class: 'formula' },
        'growth = 1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ' + max(0, change_7d - ' + m.momentum_threshold + ') / 100 x ' + m.momentum_weight
      ),
      el('div', { class: 'formula' },
        'maturity = ' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ', tapering ' + m.maturity_taper + ' over ' + m.maturity_taper_days + ' days past that'
      ),
      el('div', { class: 'formula' },
        'chains = 1 + ' + m.chain_step + ' x min(chains - 1, ' + m.chain_cap_extra + ')'
      ),
      el('div', { class: 'factor-table' }, tiers.map(function (t) {
        return el('div', null, el('span', { text: t[0] }), el('b', { text: t[1] }));
      })),
      el('h3', { text: 'Opportunity score (0–100)' }),
      el('div', { class: 'formula' },
        'score = round( 0.35 x size + 0.20 x growth + 0.20 x maturity + 0.15 x category + 0.10 x chains )'
      ),
      el('p', { class: 'sub', text: 'Size is the TVL rank, growth the clamped seven-day change, maturity and category the model’s multipliers (each 0–100), chains min(chains − 1, 4) / 4. It never changes a rank or an implied value.' }),
      el('h3', { text: 'Risk signals' }),
      el('p', { class: 'sub', text: 'Four structural signals — age, a single chain, a sharp seven-day move, a bridge or chain-adjacent category. One signal is Moderate, two or more is Elevated.' }),
      el('p', { class: 'caveat', text: RISK_CAVEAT }),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot of ' + DATA.as_of + '. Age is the time since the protocol was first listed; an unlisted age uses ' + m.unknown_age_days + ' days. "No token" means the record carries no token — a protocol may still have one its record does not name.' })
    );
  }

  function guidePanel() {
    var guide = DATA.guide || [];
    if (guide.length === 0) return null;
    return el('section', { class: 'panel guide' },
      el('h2', { text: 'Reading the radar' }),
      el('p', { class: 'sub', text: 'The board is one function of the snapshot figures. This is how each part of it is meant to be read, and what it cannot tell you.' }),
      el('div', { class: 'guide-items' }, guide.map(function (g, i) {
        return el('details', { class: 'guide-item', open: i === 0 ? 'open' : null },
          el('summary', null, el('h3', { text: g.title })),
          el('p', { text: g.body })
        );
      }))
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function analyticsStrip(row) {
    var maxTvl = DATA.rows[0].tvl_usd;
    var g = row.change_7d;
    var gPct = g === null || g === undefined ? null : Math.max(-60, Math.min(120, g));
    var gBar = gPct === null ? null : el('div', { class: 'abar' },
      el('i', { class: gPct < 0 ? 'neg' : '', style: 'width:' + Math.max(2, Math.round(((gPct + 60) / 180) * 100)) + '%' })
    );
    var agePct = row.age_days === null || row.age_days === undefined ? null : Math.min(100, Math.round((row.age_days / DATA.model.maturity_days) * 100));
    return el('div', { class: 'analytics' },
      el('div', { class: 'row' }, el('span', { text: '7-day change' }), gBar || el('span', { class: 'sub', text: 'not reported' }), el('b', { text: fmtPct(g) })),
      el('div', { class: 'row' }, el('span', { text: 'TVL' }), el('div', { class: 'abar' }, el('i', { class: 'slate', style: 'width:' + Math.max(2, Math.round((row.tvl_usd / maxTvl) * 100)) + '%' })), el('b', { text: fmtUsd(row.tvl_usd) })),
      el('div', { class: 'row' }, el('span', { text: 'Implied value' }), el('div', { class: 'abar' }, el('i', { style: 'width:' + Math.max(2, Math.round((row.implied_value_usd / maxTvl) * 100)) + '%' })), el('b', { text: fmtUsd(row.implied_value_usd) })),
      el('div', { class: 'row' }, el('span', { text: 'Age (3y scale)' }), el('div', { class: 'abar' }, agePct === null ? null : el('i', { class: 'slate', style: 'width:' + agePct + '%' })), el('b', { text: fmtAge(row.age_days) }))
    );
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = row.farm_steps || [];
    var m = DATA.model;
    var base = Math.round(row.tvl_usd * m.base_multiple);
    var recomputed = impliedOf(row, m);
    var score = opportunityScore(row);
    var risk = riskOf(row);
    var why = whyRanks(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? '  ·  Watchlist' : '  ·  Early find') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? (row.chains.length > 4 ? row.chains.slice(0, 4).join(', ') + ' +' + (row.chains.length - 4) + ' more' : row.chains.join(', ')) : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Opportunity score' }),
      el('div', { style: 'display:flex;align-items:center;gap:16px' },
        el('span', { class: 'ring big', style: '--p:' + score.total + ';--ring:' + ringColor(score.total) }, el('b', { text: String(score.total) })),
        el('p', { class: 'sub', text: 'A second reading of the same figures. It never changes rank or implied value.' })
      ),
      el('p', { class: 'sub', text: 'Size ' + score.parts.size + ' · Growth ' + score.parts.growth + ' · Maturity ' + score.parts.maturity + ' · Category ' + score.parts.category + ' · Chains ' + score.parts.chains + ' (each 0–100).' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Why this ranks here' }),
      el('p', { text: why.join(' ') }),
      el('p', { class: 'caveat', text: 'The entry’s own explanation, from the row’s figures.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Base: TVL x ' + m.base_multiple }), el('b', { class: 'num', text: fmtUsd(base) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: fmtMult(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: fmtMult(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Category: ' + (row.category || 'Other') }), el('b', { class: 'num', text: 'x' + fmtMult(row.category_multiplier) })),
        el('div', null, el('span', { text: 'Chains: ' + (row.chains ? row.chains.length : 0) }), el('b', { class: 'num', text: 'x' + fmtMult(row.chain_multiplier) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' An estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Snapshot analytics' }),
      analyticsStrip(row),
      el('p', { class: 'caveat', text: 'All figures are from the sealed snapshot of ' + DATA.as_of + ' — one day, no history, no trend line.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Risk signals' }),
      el('p', null, el('span', { class: 'risk risk-' + (risk.level === 'Low' ? 'low' : risk.level === 'Moderate' ? 'mod' : 'high'), text: risk.level })),
      risk.signals.length ? el('ul', { class: 'risk-list' }, risk.signals.map(function (s) { return el('li', { text: s }); })) : el('p', { class: 'sub', text: 'No structural risk signals in the snapshot.' }),
      el('p', { class: 'caveat', text: RISK_CAVEAT })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
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
  }

  function boardSection() {
    var note = null;
    if (state.view === 'early') {
      note = el('div', { class: 'note' },
        el('h2', { text: 'Early finds' }),
        el('p', { text: 'The watchlist floor is $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. These ' + DATA.early_size + ' sit below it, scored by the same model. The watchlist is a floor, never a ceiling.' })
      );
    }
    return el('section', { class: 'anchor', id: 'board' },
      note,
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' },
          el('h2', { text: '🏆 Top Opportunities' }),
          el('span', { class: 'sub', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
        ),
        controls(),
        state.tab === 'pre-token' ? boardTable() : liveTable()
      )
    );
  }

  function banner() {
    return el('div', { class: 'banner' },
      el('span', { text: '⚠  Research signals are not guarantees; verify official sources before interacting.' }),
      el('button', { type: 'button', text: 'Learn more →', onclick: function () { scrollToId('guide'); } })
    );
  }

  function render() {
    var focusId = document.activeElement && document.activeElement.id;
    app.textContent = '';
    var shell = el('div', { class: 'app' });
    shell.appendChild(sidebar());
    var main = el('main', { class: 'main' });
    main.appendChild(topbar());
    main.appendChild(hero());
    main.appendChild(kpis());
    var split1 = el('div', { class: 'split' });
    split1.appendChild(chartPanel());
    split1.appendChild(signalsPanel());
    main.appendChild(split1);
    var split2 = el('div', { class: 'split' });
    split2.appendChild(boardSection());
    split2.appendChild(briefPanel());
    main.appendChild(split2);
    main.appendChild(farmView());
    main.appendChild(riskCenter());
    main.appendChild(modelPanel());
    var guide = guidePanel();
    if (guide) { guide.id = 'guide'; guide.classList.add('anchor'); main.appendChild(guide); }
    main.appendChild(banner());
    shell.appendChild(main);
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (focusId) {
      var f = document.getElementById(focusId);
      if (f) f.focus();
    }
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
