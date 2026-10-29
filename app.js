/* The Pixel Exchange's pages. Reads the Exchange (and through it the city); never changes anything. Display only. */
(function () {
  const U = window.PixelUniverse || {};
  const X = U.commerce, F = U.freight, W = U.climate, C = U.city, S = U.shares;
  const DAY = 86400000, H = 3600000;
  const main = document.getElementById('main');

  const q = new URLSearchParams(location.search);
  const at = q.get('at');
  const parsed = at ? Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(at) ? at + 'T00:00:00Z' : at.length <= 16 ? at + ':00Z' : at) : NaN;
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
  // why a business closed, from the Exchange's books
  const why = (causes) => (causes && causes.length ? causes.map((c) => c.label + ' (' + c.share + '%)').join(', ') : '');
  const SECTOR = { shop: 'Shop', office: 'Office', factory: 'Industry', warehouse: 'Caches and haulage', port: 'Export buffer' };
  const STANDING = { comfortable: 'Comfortable', steady: 'Steady', stretched: 'Stretched', 'in difficulty': 'In difficulty', empty: 'Empty' };
  const move = (a, b) => { const d = a - b; return Math.abs(d) < 0.05 ? '<span class="flat">0.0</span>' : d > 0 ? '<span class="up">\u25b2 ' + d.toFixed(1) + '</span>' : '<span class="down">\u25bc ' + (-d).toFixed(1) + '</span>'; };
  const news = (list) => '<ul class="timeline">' + (list.length ? list.map((e) => '<li><time>' + esc(fShort.format(Date.parse(e.time) - 1)) + '</time><span>' + esc(e.headline) + '</span></li>').join('') : '<li class="muted">A quiet stretch.</li>') + '</ul>';

  // a line chart in pixels: one series, its own scale, a baseline at 100
  function chart(points, label, base) {
    if (points.length < 2) return '';
    if (base === undefined) base = 100;
    const w = 640, h = 150, vals = points.map((p) => p[1]), pad = base === 100 ? 2 : 0.5, lo = Math.min(base === 100 ? 95 : 0, ...vals) - pad, hi = Math.max(base === 100 ? 105 : base * 2, ...vals) + pad;
    const x = (i) => (i / (points.length - 1)) * (w - 8) + 4, y = (v) => h - 6 - ((v - lo) / (hi - lo)) * (h - 12);
    let d = '';
    points.forEach((p, i) => { d += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p[1]).toFixed(1); });
    return '<figure class="chart"><svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(label) + '" preserveAspectRatio="none"><line x1="0" x2="' + w + '" y1="' + y(base) + '" y2="' + y(base) + '" class="base"/><path d="' + d + '"/></svg>' +
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
      const ev = X.eventsBetween(t - 30 * DAY, t), fev = F ? F.eventsBetween(t - 30 * DAY, t) : [];
      const closed = ev.filter((e) => e.type === 'business.closed').length, opened = ev.filter((e) => e.type === 'business.opened').length;
      const order = ['shop', 'office', 'sprites', 'textures', 'codecs', 'palettes', 'distribution', 'haulage', 'cache', 'buffers'];
      const sectors = st.sectors.slice().sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
      const short = sectors.filter((g) => g.shortage >= 8).sort((a, b) => b.shortage - a.shortage)[0];
      const c = st.confidence, status = short ? 'Business is ' + (c >= 104 ? 'brisk' : c >= 98 ? 'steady' : 'nervous') + ', and ' + short.label.toLowerCase() + ' ' + (short.kind === 'shop' || short.kind === 'office' ? 'are' : 'is') + ' running short.'
        : c >= 106 ? 'Business is brisk across Pixel City.' : c >= 100 ? 'Business is steady across Pixel City.' : c >= 94 ? 'Business is nervous in Pixel City.' : 'Business is in retreat across Pixel City.';
      const board = sectors.map((g) => '<tr>' + td('<b>' + esc(g.label) + '</b>') + td(g.priceIdx.toFixed(1), 1) + td(wkBy[g.kind] ? move(g.priceIdx, wkBy[g.kind].priceIdx) : '', 1) + td(g.demandIdx.toFixed(0), 1) +
        td(g.shortage >= 1 ? g.shortage.toFixed(0) + '%' : '\u2013', 1, g.shortage >= 8 ? 'warn' : '') + td(num(g.open) + (g.open < g.firms ? '<small> of ' + num(g.firms) + '</small>' : ''), 1) + '</tr>');
      return '<section class="page-head"><p class="kicker">The close of trading, ' + esc(fDate.format(cityMs(Date.parse(st.asOf)))) + ', noon city time.</p><h1 class="status">' + esc(status) + '</h1></section>' +
        '<figure class="screen board"><table><thead><tr><th>Market</th><th class="n">Price</th><th class="n">Week</th><th class="n">Demand</th><th class="n">Unfilled</th><th class="n">Trading</th></tr></thead><tbody>' + board.join('') + '</tbody></table>' +
        '<figcaption class="screen-bar"><span>Prices and demand against the first trading day (100).</span><span>Power ' + st.powerIdx + ', imports ' + st.importIdx + ', sprites abroad ' + st.worldIdx + '</span></figcaption></figure>' +
        '<dl class="facts">' + fact('Business confidence', c.toFixed(1)) + fact('Shopping basket', st.cpi.toFixed(1), 'first day 100') + fact('Trading', num(st.open), 'of ' + num(st.businesses)) +
        fact('Staff kept on', num(st.staff)) + fact('Closed this month', closed) + fact('Opened this month', opened) +
        (S && S.ready() && S.stateAt(t).started ? fact(link('shares', 'Pixel 40'), S.stateAt(t).index.toFixed(1)) : '') + '</dl>' +
        '<div class="two-col"><section><h2>Confidence over the year</h2>' + chart(hist.map((d) => [d.date, d.confidence]), 'Business confidence') +
        '<h2>The shopping basket</h2>' + chart(hist.map((d) => [d.date, d.cpi]), 'What a district\u2019s shopping costs') + '</section>' +
        '<section><h2>From the trading floor</h2>' + news(ev.concat(fev).filter((e) => e.importance >= 2).sort((a, b) => (a.time < b.time ? -1 : 1)).reverse().slice(0, 18)) + '<p>' + link('register', 'The full register of openings and closures') + '</p></section></div>';
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
        '<div class="filters" data-arg="' + esc(arg || '') + '">' + sel('District', dsel, [['', 'All districts']].concat(names.map((n, i) => [i, n]))) + sel('Sector', ssel, [['', 'All sectors']].concat(Object.keys(SECTOR).map((k) => [k, SECTOR[k]]))) +
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
      const occ = b.history.slice().reverse().map((o) => '<tr>' + td(esc(o.name)) + td(esc(day(o.from))) + td(o.to ? esc(day(o.to)) : 'Trading') + td(esc(o.reason) + (o.causes && o.causes.length ? '<br><small>' + esc(why(o.causes)) + '</small>' : '')) + '</tr>');
      // who opened it: a resident of the district, chosen from the Census Office's files (display only)
      let founder = '';
      const K = U.census;
      if (b.open && b.generation > 0 && K && K.residentsOf) {
        let h = 0; const key = b.premises + ':' + b.generation; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
        const p = (K.residentsOf(b.district, Date.parse(b.since + 'T12:00:00Z'), h % 300, 1) || [])[0];
        if (p) { const id = p.id || p, c = K.character(id);
          founder = '<p>Opened by <a href="https://dvexperiments.github.io/City/census.html' + AT + '#/resident/' + esc(id) + '">' + esc(c ? c.name : id) + '</a>' + (b.loan > 0 ? ', who still owes the Bank of Pixel City ' + watts(b.loan) + ' on the start-up loan.' : '.') + '</p>'; }
      }
      return head(esc(b.open ? b.name : b.lastName), lede, SECTOR[b.sector] + ', ' + esc(b.districtName)) + founder + '<dl class="facts">' + facts + '</dl>' +
        '<h2>The books, month by month</h2>' + table([{ l: 'Month' }, { l: 'Trading as' }, { l: 'Takings', n: 1 }, { l: 'Profit', n: 1 }, { l: 'Staff', n: 1 }, { l: 'Cash at month end', n: 1 }], ledger) +
        '<h2>Who has traded here</h2>' + table([{ l: 'Business' }, { l: 'Opened' }, { l: 'Closed' }, { l: 'Why' }], occ) +
        '<p class="muted">Premises ' + esc(b.premises) + ', block ' + b.x + ', ' + b.y + ' on the <a href="https://dvexperiments.github.io/City/">city map</a>.</p>';
    }
  };


  // ================================================================ freight: the docks and the rounds
  V.freight = {
    title: 'Freight',
    render() {
      const t = now(), f = F.stateAt(t);
      if (!f.started) return head('Freight', 'From the December Grand Prix, goods have to get somewhere. Raw colour comes in by sea, sprites go out the same way, and every district\u2019s shelves are restocked on the data distribution rounds. The docks open to freight on ' + esc(day(F.startDate)) + '.');
      const low = f.districts.filter((d) => d.shelfDays < 1);
      const status = f.rawDays < 2 ? 'Raw colour is running out at the export dock.' : f.dockFill > 85 ? 'The export dock is full, and sprites are waiting for ships.' : low.length > 3 ? 'Shelves are running low across Pixel City.' : low.length ? 'Shelves are running low in ' + low.map((d) => d.name).join(' and ') + '.' : f.deliveries < 85 ? 'The delivery rounds are behind, and the shelves are thin.' : f.rawDays < 4 ? 'Raw colour stocks are thin at the export dock.' : 'Goods are moving freely through Pixel City.';
      const bar = (v, max, warnBelow) => '<span class="meter"><i style="width:' + Math.max(2, Math.min(100, v / max * 100)).toFixed(0) + '%"' + (warnBelow !== undefined && v < warnBelow ? ' class="warn"' : '') + '></i></span>';
      const row = (name, val, meter, note) => '<tr><td><b>' + name + '</b></td><td class="n">' + val + '</td><td>' + meter + '</td><td class="note">' + note + '</td></tr>';
      const board = [
        row('Raw colour at the dock', f.rawDays.toFixed(1) + ' days', bar(f.rawDays, 16, 2.5), f.rawDays < 2 ? 'Refineries rationing' : 'For the refineries and compression works'),
        row('Sprites at the export dock', f.dockFill.toFixed(0) + '% full', bar(f.dockFill, 100), f.dockFill > 85 ? 'Orders from beyond the margin turned away' : f.dockDays.toFixed(1) + ' days of exports waiting'),
        row('Deliveries to the shops', f.deliveries.toFixed(0) + '%', bar(f.deliveries, 100, 80), 'Of what the shelves needed yesterday'),
        row('Data distribution', f.distribution.toFixed(0) + '%', bar(f.distribution, 110, 90), 'Of the rounds the shops want'),
        row('Packet haulage', f.haulage.toFixed(0) + '%', bar(f.haulage, 110, 90), 'Raw colour to the refineries, sprites to the dock'),
        row('Buffer handlers', f.buffers.toFixed(0) + '%', bar(f.buffers, 110, 90), 'Loading ships as they sail')].join('');
      const shelves = f.districts.slice().sort((a, b) => a.shelfDays - b.shelfDays).map((d) => '<tr>' + td(esc(d.name)) + td(d.shelfDays.toFixed(1) + ' days', 1) + td(bar(d.shelfDays, 2.2, 1)) + td(d.status, 0, d.shelfDays < 1 ? 'warn' : '') + '</tr>');
      const hours = (ms) => Math.floor(ms / H);
      const ships = f.ships.map((sh) => '<tr>' + td('<b>' + esc(sh.name) + '</b>') + td(esc(sh.from)) + td(esc(fShort.format(cityMs(Date.parse(sh.arrive))))) + td(sh.held >= 6 * H ? hours(sh.held) + ' h' : '\u2013', 1, sh.held >= 24 * H ? 'warn' : '') +
        td(num(sh.teu), 1) + td(num(sh.raw), 1) + td(sh.sailed ? num(sh.loaded || 0) : '<span class="muted">alongside</span>', 1) + '</tr>');
      const hist = F.historyBetween(t - 120 * DAY, t);
      return '<section class="page-head"><p class="kicker">The docks and the delivery rounds at the close of trading, ' + esc(fDate.format(cityMs(Date.parse(f.asOf)))) + '.</p><h1 class="status">' + esc(status) + '</h1></section>' +
        '<figure class="screen board freight"><table><thead><tr><th>At the docks and on the rounds</th><th class="n">Now</th><th></th><th></th></tr></thead><tbody>' + board + '</tbody></table>' +
        '<figcaption class="screen-bar"><span>Container ships land raw colour and sail with sprites.</span><span>' + f.landed + ' ship' + (f.landed === 1 ? '' : 's') + ' berthed yesterday, ' + f.sailed + ' sailed</span></figcaption></figure>' +
        '<div class="two-col"><section><h2>The shelves, district by district</h2><p class="muted">Days of trade on the shelves. Shops keep about two.</p>' + table([{ l: 'District' }, { l: 'On the shelves', n: 1 }, { l: '' }, { l: 'Status' }], shelves) +
        '<h2>Raw colour at the dock</h2>' + chart(hist.map((d) => [d.date, d.rawDays]), 'Days of raw colour in store', 2) + '</section>' +
        '<section><h2>From the docks</h2>' + news(F.eventsBetween(t - 45 * DAY, t).filter((e) => e.importance >= 2).reverse().slice(0, 14)) + '</section></div>' +
        '<h2>The shipping register</h2>' + table([{ l: 'Ship' }, { l: 'From' }, { l: 'Berthed' }, { l: 'Held outside', n: 1 }, { l: 'TEU', n: 1 }, { l: 'Raw colour landed', n: 1 }, { l: 'Sprites loaded', n: 1 }], ships);
    }
  };

  // ================================================================ the register
  V.register = {
    title: 'Register',
    render() {
      const t = now(), ev = X.eventsBetween(X.start, t).filter((e) => e.type === 'business.closed' || e.type === 'business.opened').reverse().slice(0, 150);
      const rows = ev.map((e) => '<tr>' + td(esc(fShort.format(Date.parse(e.time) - 1))) + td(e.type === 'business.closed' ? '<span class="down">Closed</span>' : '<span class="up">Opened</span>') +
        td(link('business/' + e.data.premises, esc(e.data.name))) + td(esc(e.data.district)) + td(e.data.jobs, 1) + td(esc(e.data.reason || '') + (e.data.causes && e.data.causes.length ? '<br><small>' + esc(why(e.data.causes)) + '</small>' : '')) + '</tr>');
      return head('The register', 'Every business that has closed or opened, latest first. Jobs are the staff on the books on the day.') +
        table([{ l: 'Date' }, { l: '' }, { l: 'Business' }, { l: 'District' }, { l: 'Jobs', n: 1 }, { l: 'Why' }], rows);
    }
  };

  V.about = {
    title: 'About',
    render() {
      return head('About the Exchange', 'Where Pixel City\u2019s businesses are counted, every trading day.') + '<div class="prose">' +
        '<p>Every shop, office, render plant, refinery, foundry, cache and buffer handler in the city trades here, selling what pixels use: charge, colour, shading, patches, the race feed, and the sprites the city sends beyond the margin.</p><p>Each one sets its own prices, competes for customers, takes on staff when it is busy and lets them go when it is not. Labour and rent are paid whether anything sells or not, so a quiet season is dangerous. When the cash and the patience run out, the business closes, and after a while someone new opens in the empty premises.</p>' +
        '<p>Nothing is scripted. Demand comes from the city as it is: the weather, blackouts, smog, the Senate\u2019s laws, ships at the port, Grand Prix days and the appetite beyond the margin for Pixel City sprites. It passes down a chain, a day at a time. Raw colour comes in by sea and is refined into palettes, palettes are cast into textures, and textures and codecs are rendered into sprites. Shops need data distribution, and everyone needs an office. A good month abroad for the Render Plants is a good month for the palette refineries a few weeks later.</p><p>Since 1 December 2026 goods have to get somewhere: raw colour arrives in container ships and waits at the export dock, sprites wait there for a ship to sail, and every district\u2019s shelves are restocked on the data distribution rounds, which storms, blackouts and Grand Prix crowds slow down. And since then the businesses employ the city\u2019s pixels. When a business fails, its staff are laid off and join the queue at the Job Centre; a busy one takes more people on.</p>' +
        '<p>Trading days run from noon to noon, city time, and results are posted at the close. Everything is computed in your browser from the date, so every visitor sees the same market. Prices and demand are measured against the first trading day, 3 December 2025, which counts as 100.</p></div>';
    }
  };


  // ================================================================ the Pixel 40
  // two lines on one scale: a share's price and what its business is worth
  function chart2(points, label) {
    if (points.length < 2) return '';
    const w = 640, h = 170, all = []; for (const p of points) all.push(p[1], p[2]);
    const lo = Math.min(0, ...all), hi = Math.max(...all) * 1.08 || 1;
    const x = (i) => (i / (points.length - 1)) * (w - 8) + 4, y = (v) => h - 6 - ((v - lo) / (hi - lo)) * (h - 12);
    const path = (j) => points.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p[j]).toFixed(1)).join('');
    return '<figure class="chart"><svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(label) + '" preserveAspectRatio="none">' +
      '<path d="' + path(2) + '" fill="none" stroke="var(--muted, #8496A0)" stroke-width="2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>' +
      '<path d="' + path(1) + '" fill="none" stroke="currentColor" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>' +
      '<figcaption><span>' + esc(day(points[0][0])) + '</span><span>' + esc(label) + ' \u00b7 solid: price, dashed: worth</span><span>' + esc(day(points[points.length - 1][0])) + '</span></figcaption></figure>';
  }
  const SH_TYPES = /^shares\./;
  const pctMove = (v) => (Math.abs(v) < 0.05 ? '<span class="flat">0.0%</span>' : v > 0 ? '<span class="up">\u25b2 ' + v.toFixed(1) + '%</span>' : '<span class="down">\u25bc ' + (-v).toFixed(1) + '%</span>');
  V.shares = {
    title: 'The Pixel 40',
    render() {
      if (!S || !S.ready()) return head('The Pixel 40 is closed', 'The share market needs the Exchange and Pixel City Society, and one of them could not be reached. Please try again shortly.');
      const t = now(), st = S.stateAt(t);
      if (!st.started) return head('The Pixel 40', 'Forty of Pixel City\u2019s largest businesses list their shares on ' + esc(new Intl.DateTimeFormat('en-NZ', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(Date.parse(S.startDate + 'T12:00:00Z'))) + ', the February Grand Prix. From then, their prices move every trading day on what the city\u2019s investors do.') + about40();
      const listed = st.listed.filter((f) => f.listed);
      const status = (st.indexChange >= 15 ? 'The Pixel 40 rallies' : st.indexChange <= -15 ? 'The Pixel 40 slides' : 'The Pixel 40 is quiet') +
        (st.momentum >= 50 ? ', and the momentum traders are in charge.' : st.momentum >= 35 ? ', with the city\u2019s investors divided.' : ', and the value investors are in charge.');
      const rows = listed.slice().sort((a, b) => b.premium - a.premium).map((f) => '<tr>' + td(link('share/' + f.premises, '<b>' + esc(f.name) + '</b>')) + td(esc(f.district)) +
        td(f.price.toFixed(2), 1) + td(pctMove(f.change), 1) + td(f.value.toFixed(2), 1) + td((f.premium > 0 ? '+' : '') + f.premium + '%', 1, f.premium >= 50 ? 'warn' : '') + '</tr>');
      const hist = S.historyBetween(t - 365 * DAY, t);
      const ev = S.eventsBetween(t - 90 * DAY, t);
      const bubbles = ev.filter((e) => e.type === 'shares.bubble').length;
      const grid = '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:8px 0 4px">' + st.districts.map((d) => {
        const name = (X.districts()[d.id] || 'District ' + (d.id + 1));
        return '<div style="padding:10px;border-radius:6px;background:rgba(224,79,255,' + (0.06 + d.momentum / 120).toFixed(2) + ')"><small>' + esc(name) + '</small><br><b>' + d.momentum + '%</b></div>';
      }).join('') + '</div>';
      return '<section class="page-head"><p class="kicker">The Pixel 40 at the close, ' + esc(fDate.format(cityMs(Date.parse(st.asOf)))) + ', noon city time.</p><h1 class="status">' + esc(status) + '</h1></section>' +
        '<figure class="screen board"><table><thead><tr><th>Business</th><th>District</th><th class="n">Price</th><th class="n">Day</th><th class="n">Worth</th><th class="n">Premium</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>' +
        '<figcaption class="screen-bar"><span>Each share listed at 100 W. Worth is what value investors make of the business from a year of its results.</span><span>Sorted by premium</span></figcaption></figure>' +
        '<dl class="facts">' + fact('Pixel 40', st.index.toFixed(1), 'listing day 1,000') + fact('Today', (st.indexChange > 0 ? '+' : '') + st.indexChange.toFixed(1)) + fact('Trading on momentum', st.momentum + '%') +
        fact('Looking at the businesses', (100 - st.momentum) + '%') + fact('Listed', listed.length, 'of 40') + fact('Bubbles this season', bubbles) + '</dl>' +
        '<div class="two-col"><section><h2>The Pixel 40 over the year</h2>' + chart(hist.map((d) => [d.date, d.index]), 'Pixel 40 index', 1000) +
        '<h2>Who is chasing trends</h2>' + chart(hist.map((d) => [d.date, d.momentum]), 'Investors trading on momentum, %', 50) +
        '<h2>District by district</h2><p class="muted">The share of each district\u2019s investors trading on momentum. Investors pick up their habits from the communities they know (Pixel City Society), and each business\u2019s shares are held mostly in its own district.</p>' + grid + '</section>' +
        '<section><h2>From the trading floor</h2>' + news(ev.filter((e) => e.importance >= 2 && e.type !== 'shares.results').reverse().slice(0, 18)) + about40() + '</section></div>';
    }
  };
  function about40() {
    return '<h2>How the Pixel 40 works</h2><div class="prose"><p>Two kinds of investor trade every share. Value investors work out what a business is worth from a year of its results, posted on the 1st of each month, and buy when the price is below that. Momentum traders ignore the business and buy whatever has been rising.</p>' +
      '<p>The investors are Pixel City Society\u2019s communities. Each community\u2019s mix of the two moves with whichever has been paying in its district, with what the communities it knows are doing, and against a trade that has become crowded. No share may move more than 10% in a day. A business that closes is struck off, and the next-largest sound business in its sector takes its place.</p>' +
      '<p>From 1 March 2027 the market reaches the city in one way only: on results day, a business whose shares trade at least 40% above what it is worth sells new shares, no more than once in six months, and the money is in its accounts the next day. Nothing else about share prices changes what happens in Pixel City.</p></div>';
  }
  V.share = {
    title: 'Shares',
    render(arg) {
      if (!S || !S.ready()) return V.shares.render();
      const t = now(), st = S.stateAt(t), id = decodeURIComponent(arg || '');
      const f = st.started ? st.listed.find((x) => x.premises === id) : null;
      const hist = S.shareHistory(id, S.start, t);
      if (!hist.length) return head('Not on the Pixel 40', 'This business has never been listed. ' + link('shares', 'See the Pixel 40') + '.');
      const ev = S.eventsBetween(S.start, t).filter((e) => e.data && e.data.premises === id).reverse();
      const last = hist[hist.length - 1], name = f ? f.name : (ev[0] && ev[0].data.firm) || id;
      const peak = Math.max(...hist.map((h) => h.price)), low = Math.min(...hist.map((h) => h.price));
      return head(esc(name), f && f.listed ? 'Listed on the Pixel 40.' : 'Struck off the Pixel 40.', link('shares', 'The Pixel 40')) +
        '<dl class="facts">' + fact('Price', last.price.toFixed(2) + '\u00a0W') + fact('Worth', last.value.toFixed(2) + '\u00a0W') + fact('Premium', last.value ? ((last.price - last.value) / last.value * 100).toFixed(0) + '%' : '\u2013') +
        fact('Highest', peak.toFixed(2) + '\u00a0W') + fact('Lowest', low.toFixed(2) + '\u00a0W') + fact('Since', esc(day(hist[0].date))) + '</dl>' +
        '<div class="two-col"><section><h2>Price and worth</h2>' + chart2(hist.map((h) => [h.date, h.price, h.value]), name) + '<p>' + link('business/' + encodeURIComponent(id), 'The business on the Exchange') + '</p></section>' +
        '<section><h2>On the trading floor</h2>' + news(ev.slice(0, 20)) + '</section></div>';
    }
  };

  // ---------------------------------------------------------------- routing
  const ROUTES = { '': 'market', businesses: 'businesses', business: 'business', shares: 'shares', share: 'share', freight: 'freight', register: 'register', about: 'about' };
  const NAV = { business: 'businesses', share: 'shares' };
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
