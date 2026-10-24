/* The Pixel Exchange's pages. Reads the Exchange (and through it the city); never changes anything. Display only. */
(function () {
  const U = window.PixelUniverse || {};
  const X = U.commerce, W = U.climate, C = U.city;
  const DAY = 86400000, H = 3600000;
  const main = document.getElementById('main');

  const q = new URLSearchParams(location.search);
  const at = q.get('at');
  const parsed = at ? Date.parse(at.length <= 16 ? at + ':00Z' : at) : NaN;
  const offset = isNaN(parsed) ? 0 : parsed - Date.now();
  const now = () => Date.now() + offset;
  const AT = isNaN(parsed) ? '' : '?at=' + encodeURIComponent(at);

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = (n) => Math.round(n).toLocaleString('en');
  const watts = (n) => (n < 0 ? '\u2212' : '') + num(Math.abs(n)) + '\u00a0W';
  const cityMs = (ms) => ms + (W && W.offsetAt ? W.offsetAt(ms) : 0);
  const fDate = new Intl.DateTimeFormat('en-NZ', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const fShort = new Intl.DateTimeFormat('en-NZ', { timeZone: 'UTC', day: 'numeric', month: 'short' });
  const fMonth = new Intl.DateTimeFormat('en-NZ', { timeZone: 'UTC', month: 'short', year: 'numeric' });
  const day = (s) => fShort.format(Date.parse(s + 'T12:00:00Z'));
  const link = (route, text) => '<a href="' + AT + '#/' + route + '">' + text + '</a>';
  const head = (title, lede, kicker) => '<section class="page-head">' + (kicker ? '<p class="kicker">' + kicker + '</p>' : '') + '<h1>' + title + '</h1>' + (lede ? '<p class="lede">' + lede + '</p>' : '') + '</section>';
  const fact = (k, v, small) => '<div><dt>' + k + '</dt><dd>' + v + (small ? ' <small>' + small + '</small>' : '') + '</dd></div>';
  const td = (v, n, cls) => '<td class="' + (n ? 'n ' : '') + (cls || '') + '">' + v + '</td>';
  const table = (cols, rows) => '<div class="table-wrap"><table class="data"><thead><tr>' + cols.map((c) => '<th' + (c.n ? ' class="n"' : '') + '>' + c.l + '</th>').join('') + '</tr></thead><tbody>' +
    (rows.length ? rows.join('') : '<tr><td class="muted" colspan="' + cols.length + '">Nothing yet.</td></tr>') + '</tbody></table></div>';
  const SECTOR = { shop: 'Shop', office: 'Office', factory: 'Factory', warehouse: 'Warehouse', port: 'Docks' };
  const STANDING = { comfortable: 'Comfortable', steady: 'Steady', stretched: 'Stretched', 'in difficulty': 'In difficulty', empty: 'Empty' };
  const move = (a, b) => { const d = a - b; return Math.abs(d) < 0.05 ? '<span class="flat">0.0</span>' : d > 0 ? '<span class="up">\u25b2 ' + d.toFixed(1) + '</span>' : '<span class="down">\u25bc ' + (-d).toFixed(1) + '</span>'; };
  const news = (list) => '<ul class="timeline">' + (list.length ? list.map((e) => '<li><time>' + esc(fShort.format(Date.parse(e.time) - 1)) + '</time><span>' + esc(e.headline) + '</span></li>').join('') : '<li class="muted">A quiet stretch.</li>') + '</ul>';

  // a line chart in pixels: one series, its own scale, a baseline at 100
  function chart(points, label) {
    if (points.length < 2) return '';
    const w = 640, h = 150, vals = points.map((p) => p[1]), lo = Math.min(95, ...vals) - 2, hi = Math.max(105, ...vals) + 2;
    const x = (i) => (i / (points.length - 1)) * (w - 8) + 4, y = (v) => h - 6 - ((v - lo) / (hi - lo)) * (h - 12);
    let d = '';
    points.forEach((p, i) => { d += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p[1]).toFixed(1); });
    return '<figure class="chart"><svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(label) + '" preserveAspectRatio="none"><line x1="0" x2="' + w + '" y1="' + y(100) + '" y2="' + y(100) + '" class="base"/><path d="' + d + '"/></svg>' +
      '<figcaption><span>' + esc(day(points[0][0])) + '</span><span>' + esc(label) + '</span><span>' + esc(day(points[points.length - 1][0])) + '</span></figcaption></figure>';
  }

  const V = {};
  // ================================================================ the market today
  V.market = {
    title: '',
    render() {
      const t = now(), st = X.stateAt(t);
      if (!st.started) return head('The Exchange has not opened', 'Trading begins on ' + esc(X.startDate) + ', with the first Daily Crawl.');
      const wk = X.stateAt(t - 7 * DAY), wkBy = {};
      for (const g of wk.sectors || []) wkBy[g.kind] = g;
      const hist = X.historyBetween(t - 365 * DAY, t);
      const ev = X.eventsBetween(t - 30 * DAY, t);
      const closed = ev.filter((e) => e.type === 'business.closed').length, opened = ev.filter((e) => e.type === 'business.opened').length;
      const order = ['shop', 'office', 'screens', 'diodes', 'glass', 'phosphor', 'distribution', 'freight', 'storage', 'stevedores'];
      const sectors = st.sectors.slice().sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
      const short = sectors.filter((g) => g.shortage >= 8).sort((a, b) => b.shortage - a.shortage)[0];
      const c = st.confidence, status = short ? 'Business is ' + (c >= 104 ? 'brisk' : c >= 98 ? 'steady' : 'nervous') + ', and ' + short.label.toLowerCase() + ' ' + (short.kind === 'shop' || short.kind === 'office' ? 'are' : 'is') + ' running short.'
        : c >= 106 ? 'Business is brisk across Pixel City.' : c >= 100 ? 'Business is steady across Pixel City.' : c >= 94 ? 'Business is nervous in Pixel City.' : 'Business is in retreat across Pixel City.';
      const board = sectors.map((g) => '<tr>' + td('<b>' + esc(g.label) + '</b>') + td(g.priceIdx.toFixed(1), 1) + td(wkBy[g.kind] ? move(g.priceIdx, wkBy[g.kind].priceIdx) : '', 1) + td(g.demandIdx.toFixed(0), 1) +
        td(g.shortage >= 1 ? g.shortage.toFixed(0) + '%' : '\u2013', 1, g.shortage >= 8 ? 'warn' : '') + td(num(g.open) + (g.open < g.firms ? '<small> of ' + num(g.firms) + '</small>' : ''), 1) + '</tr>');
      return '<section class="page-head"><p class="kicker">The close of trading, ' + esc(fDate.format(cityMs(Date.parse(st.asOf)))) + ', noon city time.</p><h1 class="status">' + esc(status) + '</h1></section>' +
        '<figure class="screen board"><table><thead><tr><th>Market</th><th class="n">Price</th><th class="n">Week</th><th class="n">Demand</th><th class="n">Unfilled</th><th class="n">Trading</th></tr></thead><tbody>' + board.join('') + '</tbody></table>' +
        '<figcaption class="screen-bar"><span>Prices and demand against the first trading day (100).</span><span>Power ' + st.powerIdx + ', imports ' + st.importIdx + ', screens abroad ' + st.worldIdx + '</span></figcaption></figure>' +
        '<dl class="facts">' + fact('Business confidence', c.toFixed(1)) + fact('Shopping basket', st.cpi.toFixed(1), 'first day 100') + fact('Trading', num(st.open), 'of ' + num(st.businesses)) +
        fact('Staff kept on', num(st.staff)) + fact('Closed this month', closed) + fact('Opened this month', opened) + '</dl>' +
        '<div class="two-col"><section><h2>Confidence over the year</h2>' + chart(hist.map((d) => [d.date, d.confidence]), 'Business confidence') +
        '<h2>The shopping basket</h2>' + chart(hist.map((d) => [d.date, d.cpi]), 'What a district\u2019s shopping costs') + '</section>' +
        '<section><h2>From the trading floor</h2>' + news(ev.filter((e) => e.importance >= 2).reverse().slice(0, 18)) + '<p>' + link('register', 'The full register of openings and closures') + '</p></section></div>';
    }
  };

  // ================================================================ every business
  const PAGE = 60;
  V.businesses = {
    title: 'Businesses',
    render(arg) {
      const t = now(), p = new URLSearchParams(arg || ''), dsel = p.get('d') || '', ssel = p.get('s') || '', page = +(p.get('p') || 0), sort = p.get('o') || 'rev';
      const all = X.firmsAt(t), names = X.districts();
      let list = all.filter((f) => (dsel === '' || f.district === +dsel) && (ssel === '' || f.sector === ssel));
      const key = { rev: (f) => (f.open ? f.revenue : -1e12), staff: (f) => f.staff, cash: (f) => (f.open ? f.cashDays : -1e12), new: (f) => (f.open ? Date.parse(f.since) : 0) }[sort] || ((f) => f.revenue);
      list.sort((a, b) => key(b) - key(a));
      const sel = (name, val, opts) => '<label class="filter">' + name + ' <select data-k="' + name[0].toLowerCase() + '">' + opts.map(([v, l]) => '<option value="' + v + '"' + (String(v) === val ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>';
      const rows = list.slice(page * PAGE, page * PAGE + PAGE).map((f) => '<tr>' + td(link('business/' + f.premises, '<b>' + esc(f.open ? f.name : f.lastName) + '</b>') + (f.open ? '' : ' <span class="tag">closed</span>')) + td(esc(f.line)) + td(esc(f.districtName)) +
        td(f.open ? watts(f.revenue) : '\u2013', 1) + td(f.open ? f.staff : '\u2013', 1) + td(f.open ? f.relPrice.toFixed(0) : '\u2013', 1) + td(STANDING[f.standing], 0, f.standing === 'in difficulty' ? 'warn' : '') + '</tr>');
      const pages = Math.ceil(list.length / PAGE), qs = (k, v) => { const n = new URLSearchParams(arg || ''); n.set(k, v); if (k !== 'p') n.delete('p'); return AT + '#/businesses/' + n.toString(); };
      return head('Businesses', num(all.filter((f) => f.open).length) + ' businesses trading in Pixel City, and ' + num(all.filter((f) => !f.open).length) + ' empty premises waiting for someone new.') +
        '<div class="filters" data-arg="' + esc(arg || '') + '">' + sel('District', dsel, [['', 'All districts']].concat(names.map((n, i) => [i, n]))) + sel('Sector', ssel, [['', 'All sectors']].concat(Object.keys(SECTOR).map((k) => [k, SECTOR[k] + 's']))) +
        sel('Order', sort, [['rev', 'Takings yesterday'], ['staff', 'Staff'], ['cash', 'Cash in hand'], ['new', 'Newest']]) + '</div>' +
        table([{ l: 'Business' }, { l: 'Trade' }, { l: 'District' }, { l: 'Takings yesterday', n: 1 }, { l: 'Staff', n: 1 }, { l: 'Price vs market', n: 1 }, { l: 'Standing' }], rows) +
        (pages > 1 ? '<p class="pager">' + (page > 0 ? '<a href="' + qs('p', page - 1) + '">Previous</a> ' : '') + 'Page ' + (page + 1) + ' of ' + pages + (page < pages - 1 ? ' <a href="' + qs('p', page + 1) + '">Next</a>' : '') + '</p>' : '');
    },
    mount(arg) {
      document.querySelectorAll('.filters select').forEach((s) => s.addEventListener('change', () => {
        const n = new URLSearchParams(arg || ''); n.set(s.dataset.k === 'o' ? 'o' : s.dataset.k, s.value); if (!s.value) n.delete(s.dataset.k); n.delete('p');
        location.hash = '#/businesses/' + n.toString();
      }));
    }
  };

  // ================================================================ one premises
  V.business = {
    title: 'Business',
    render(id) {
      const t = now(), b = X.business(id, t);
      if (!b) return head('No such premises', 'The register has no business at that address.');
      const lede = b.open ? esc(b.line) + ' in ' + esc(b.districtName) + ', trading since ' + esc(day(b.since)) + '.' + (b.generation ? '' : ' One of the city\u2019s founding businesses.')
        : 'Empty since ' + esc(day(b.history[b.history.length - 1].to || b.since || X.startDate)) + '. ' + (b.reopens ? 'Someone new is expected to take it on around ' + esc(day(b.reopens)) + '.' : '');
      const facts = b.open ? fact('Staff', b.staff, 'of ' + b.capacity) + fact('Takings yesterday', watts(b.revenue)) + fact('Profit yesterday', watts(b.profit)) +
        fact('Price', b.relPrice.toFixed(0), 'market 100') + fact('Quality', b.quality.toFixed(0)) + fact('Standing', STANDING[b.standing], b.cashDays.toFixed(0) + ' days of costs in hand') : fact('Capacity', b.capacity + ' staff') + fact('Previous occupants', b.history.length);
      const ledger = b.ledger.slice().reverse().slice(0, 18).map((L) => '<tr>' + td(esc(fMonth.format(Date.parse(L.month + '-15')))) + td(L.name ? esc(L.name) : '<span class="muted">empty</span>') + td(L.days ? watts(L.revenue) : '\u2013', 1) +
        td(L.days ? watts(L.profit) : '\u2013', 1, L.profit < 0 ? 'neg' : '') + td(L.staff || '\u2013', 1) + td(L.days ? watts(L.cash) : '\u2013', 1, L.cash < 0 ? 'neg' : '') + '</tr>');
      const occ = b.history.slice().reverse().map((o) => '<tr>' + td(esc(o.name)) + td(esc(day(o.from))) + td(o.to ? esc(day(o.to)) : 'Trading') + td(esc(o.reason)) + '</tr>');
      return head(esc(b.open ? b.name : b.lastName), lede, SECTOR[b.sector] + ', ' + esc(b.districtName)) + '<dl class="facts">' + facts + '</dl>' +
        '<h2>The books, month by month</h2>' + table([{ l: 'Month' }, { l: 'Trading as' }, { l: 'Takings', n: 1 }, { l: 'Profit', n: 1 }, { l: 'Staff', n: 1 }, { l: 'Cash at month end', n: 1 }], ledger) +
        '<h2>Who has traded here</h2>' + table([{ l: 'Business' }, { l: 'Opened' }, { l: 'Closed' }, { l: 'Why' }], occ) +
        '<p class="muted">Premises ' + esc(b.premises) + ', block ' + b.x + ', ' + b.y + ' on the <a href="https://dvexperiments.github.io/City/">city map</a>.</p>';
    }
  };

  // ================================================================ the register
  V.register = {
    title: 'Register',
    render() {
      const t = now(), ev = X.eventsBetween(X.start, t).filter((e) => e.type === 'business.closed' || e.type === 'business.opened').reverse().slice(0, 150);
      const rows = ev.map((e) => '<tr>' + td(esc(fShort.format(Date.parse(e.time) - 1))) + td(e.type === 'business.closed' ? '<span class="down">Closed</span>' : '<span class="up">Opened</span>') +
        td(link('business/' + e.data.premises, esc(e.data.name))) + td(esc(e.data.district)) + td(e.data.jobs, 1) + td(esc(e.data.reason || '')) + '</tr>');
      return head('The register', 'Every business that has closed or opened, latest first. Jobs are the staff on the books on the day.') +
        table([{ l: 'Date' }, { l: '' }, { l: 'Business' }, { l: 'District' }, { l: 'Jobs', n: 1 }, { l: 'Why' }], rows);
    }
  };

  V.about = {
    title: 'About',
    render() {
      return head('About the Exchange', 'Where Pixel City\u2019s businesses are counted, every trading day.') + '<div class="prose">' +
        '<p>Every shop, office, factory, warehouse and stevedore in the city trades here. Each one sets its own prices, competes for customers, takes on staff when it is busy and lets them go when it is not. Labour and rent are paid whether anything sells or not, so a quiet season is dangerous. When the cash and the patience run out, the business closes, and after a while someone new opens in the empty premises.</p>' +
        '<p>Nothing is scripted. Demand comes from the city as it is: the weather, blackouts, smog, the Senate\u2019s laws, ships at the port, Grand Prix days and the world\u2019s appetite for Pixel City screens. It passes down a chain, a day at a time. Screens need diodes and glass, diodes need phosphor, shops need distribution, and everyone needs an office. A good month abroad for the Screen Works is a good month for the phosphor mills a few weeks later.</p>' +
        '<p>Trading days run from noon to noon, city time, and results are posted at the close. Everything is computed in your browser from the date, so every visitor sees the same market. Prices and demand are measured against the first trading day, 3 December 2025, which counts as 100.</p></div>';
    }
  };

  // ---------------------------------------------------------------- routing
  const ROUTES = { '': 'market', businesses: 'businesses', business: 'business', register: 'register', about: 'about' };
  const NAV = { business: 'businesses' };
  let unmount = null;
  function render() {
    if (unmount) { unmount(); unmount = null; }
    if (!X || !X.ready()) {
      main.innerHTML = head('The trading floor is dark', 'The Exchange needs the Weather Bureau, the Senate and Pixel City to know what has happened, and one of them could not be reached. Please try again shortly.');
      return;
    }
    const h = location.hash.replace(/^#\/?/, ''), cut = h.indexOf('/'), name = cut < 0 ? h : h.slice(0, cut), arg = cut < 0 ? '' : h.slice(cut + 1);
    const key = ROUTES[name] || 'market', view = V[key];
    main.innerHTML = view.render(arg);
    document.title = (view.title ? view.title + ' \u2013 ' : '') + 'The Pixel Exchange';
    document.querySelectorAll('.nav a').forEach((a) => (a.dataset.view === (NAV[key] || key) ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    if (view.mount) unmount = view.mount(arg) || null;
    window.scrollTo(0, 0);
  }
  if (AT) { const b = document.getElementById('travel'); b.hidden = false; b.innerHTML = 'Watching the Exchange at ' + esc(at) + '. <a href="' + location.pathname + location.hash + '">Return to the present</a>.'; }
  window.addEventListener('hashchange', render);
  render();
  // the board refreshes itself at the close
  let lastClose = Math.floor(now() / DAY);
  setInterval(() => { const c = Math.floor(now() / DAY); if (c !== lastClose) { lastClose = c; if ((location.hash.replace(/^#\/?/, '') || '') === '') render(); } }, 30000);
})();
