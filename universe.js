/*
 * The Pixel Exchange: every business in Pixel City, trading.
 *
 * Commerce, phase 1. The city's 2,535 businesses (the Census Office's register: shops, offices, factories, warehouses
 * and the stevedores at the docks) each set their own prices, compete for customers, take on and shed staff, run up
 * debts and, now and then, fail. An empty premises stays empty for a while, then someone new opens there.
 *
 * Nothing here is scripted. Each trading day, demand comes from the city as it is: the weather, blackouts in each
 * district, the Senate's laws, ships at the port, Grand Prix days, the price of power, and a world market for screens.
 * Demand flows down a supply chain (screens need diodes and glass, diodes need phosphor, shops need distribution,
 * everyone needs offices), one day behind, so a shock in one place arrives somewhere else days or weeks later. Business
 * confidence follows profits, closures, blackouts and smog, and feeds back into what pixels spend.
 *
 * Tier: a reader. It reads City (map, power history, laws, port), the Weather Bureau and the Census Office's business
 * register (labour.employers(), which is fixed by the map). Nothing reads it yet. Phase 2: the Job Centre reads which
 * businesses are open and how many staff they keep.
 *
 * Time: trading days run 00:00 to 00:00 UTC (noon to noon, city time). Results are posted at the close, when the new
 * edition of the Daily Pixel comes out. Records begin with the city, 3 December 2025.
 *
 * Load after Weather, Senate, City universe.js and City census.js. Seeds start "exchange:". Simulation maths uses only
 * + - * / Math.floor Math.imul (and comparisons). Registers window.PixelUniverse.commerce.
 */
(function (root) {
  'use strict';

  const VERSION = '1.0.0';
  const MIN = 60000, H = 3600000, DAY = 86400000;
  const START = Date.UTC(2025, 11, 3); // the first trading day: the first Daily Crawl

  // ---------------------------------------------------------------- shared RNG (identical to Glacial's)
  function rng(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  const seeded = (s) => rng(hash('exchange:' + s));
  const pick = (r, a) => a[Math.floor(r() * a.length)];
  const lo = (a, b) => (a < b ? a : b), hi = (a, b) => (a > b ? a : b);
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const rd = (x, k) => Math.floor(x * k + 0.5) / k;
  const pad = (n) => (n < 10 ? '0' : '') + n;
  const ymd = (ms) => { const d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };
  const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

  // ---------------------------------------------------------------- upstream (all hard dependencies)
  const U = () => root.PixelUniverse || {};
  const City = () => U().city, Wx = () => U().climate, Lab = () => U().labour;
  const ok = (x) => !!(x && (!x.ready || x.ready()));
  const ready = () => ok(City()) && ok(Wx()) && ok(Lab());

  // ---------------------------------------------------------------- what each kind of business is
  // Shares of the price of one unit (one worker-day of output) at normal prices: labour, power, inputs, rent.
  // The rest is margin. Labour and rent are paid whether or not anything sells; that is what makes a quiet month dangerous.
  const KIND = {
    phosphor: { sector: 'factory', label: 'Phosphor', unit: 'drums', labour: 0.32, power: 0.2, rent: 0.08, inputs: [['import', 0.22]] },
    diodes: { sector: 'factory', label: 'Diodes', unit: 'reels', labour: 0.32, power: 0.16, rent: 0.08, inputs: [['phosphor', 0.26]] },
    glass: { sector: 'factory', label: 'Glass', unit: 'panes', labour: 0.3, power: 0.24, rent: 0.08, inputs: [['import', 0.2]] },
    screens: { sector: 'factory', label: 'Screens', unit: 'screens', labour: 0.3, power: 0.1, rent: 0.06, inputs: [['diodes', 0.22], ['glass', 0.16]] },
    freight: { sector: 'warehouse', label: 'Freight', labour: 0.48, power: 0.08, rent: 0.22, inputs: [] },
    storage: { sector: 'warehouse', label: 'Storage', labour: 0.48, power: 0.1, rent: 0.22, inputs: [] },
    distribution: { sector: 'warehouse', label: 'Distribution', labour: 0.48, power: 0.08, rent: 0.22, inputs: [] },
    stevedores: { sector: 'port', label: 'Stevedoring', labour: 0.5, power: 0.06, rent: 0.2, inputs: [] },
    office: { sector: 'office', label: 'Office services', labour: 0.58, power: 0.05, rent: 0.2, inputs: [] },
    shop: { sector: 'shop', label: 'Shops', labour: 0.42, power: 0.05, rent: 0.1, inputs: [['distribution', 0.3]] }
  };
  const FACTORY = { 'Phosphor Mills': 'phosphor', 'Diode Works': 'diodes', 'Glass & Light': 'glass', 'Screen Works': 'screens' };
  const WAREHOUSE = { Freight: 'freight', Storage: 'storage', Distribution: 'distribution' };
  const SHOPS = ['Pixel Pantry', 'Corner Store', 'Florist', 'Coffee', 'Hardware', 'Bakery', 'News & Sweets'];
  const OFFICES = ['Typesetting', 'Colour Consultants', 'Gradient Partners', 'Alignment Bureau', 'Refresh Services', 'Font Licensing', '& Associates', 'Brightness Advisory'];
  // names for businesses that open later in an empty premises, in the same style as the Census Office's register
  const NAME_A = ['Halftone', 'Gridley', 'Kerning', 'Lumen', 'Raster', 'Gamut', 'Pica', 'Serif', 'Vector', 'Glyph', 'Phosphor', 'Contrast', 'Aperture', 'Prism', 'Bitwell', 'Dotson', 'Inkwell', 'Scanlon',
    'Bezelton', 'Luma', 'Chromwell', 'Pixley', 'Nibbs', 'Ditherby', 'Hexley', 'Moirette', 'Voxel', 'Sprite', 'Bitmap', 'Palette'];
  const NAME_F = ['Ada', 'Amber', 'Arlo', 'Bea', 'Bit', 'Bram', 'Cass', 'Cyan', 'Dot', 'Edie', 'Ember', 'Fen', 'Flint', 'Glint', 'Halo', 'Hex', 'Ines', 'Juno', 'Kit', 'Lux', 'Mag', 'Nell', 'Opal', 'Pix', 'Quin', 'Rue', 'Sol', 'Tess', 'Umber', 'Vera'];
  const SUFFIX_NEW = { phosphor: 'Phosphor Mills', diodes: 'Diode Works', glass: 'Glass & Light', screens: 'Screen Works', freight: 'Freight', storage: 'Storage', distribution: 'Distribution', stevedores: 'Stevedores' };

  // ---------------------------------------------------------------- the register: premises, businesses and markets
  let REG = null;
  function register() {
    if (REG) return REG;
    const C = City(), L = Lab();
    const m = C.map(Date.UTC(2026, 10, 2)); // the renewed map: the premises the Census Office registers
    const list = L.employers().filter((e) => e.kind === 'business');
    const markets = [], byKey = {};
    const market = (key, kind, label, district) => {
      if (byKey[key] === undefined) { byKey[key] = markets.length; markets.push({ i: markets.length, key, kind, label, district, firms: [], cap: 0 }); }
      return byKey[key];
    };
    const prem = list.map((e, i) => {
      let kind, sub, mk;
      if (e.sector === 'factory') { sub = Object.keys(FACTORY).filter((s) => e.name.endsWith(s))[0] || 'Screen Works'; kind = FACTORY[sub]; mk = market('goods:' + kind, kind, KIND[kind].label, -1); }
      else if (e.sector === 'warehouse') { sub = Object.keys(WAREHOUSE).filter((s) => e.name.endsWith(s))[0] || 'Storage'; kind = WAREHOUSE[sub]; mk = market('trade:' + kind, kind, KIND[kind].label, -1); }
      else if (e.sector === 'port') { sub = 'Stevedores'; kind = 'stevedores'; mk = market('trade:stevedores', kind, 'Stevedoring', -1); }
      else if (e.sector === 'office') { sub = OFFICES.filter((s) => e.name.endsWith(s))[0] || '& Associates'; kind = 'office'; mk = market('office:' + sub, kind, sub.replace(/^& /, ''), -1); }
      else { sub = SHOPS.filter((s) => e.name.endsWith(s))[0] || 'Corner Store'; kind = 'shop'; mk = market('shop:' + sub + ':' + e.district, kind, sub, e.district); }
      markets[mk].firmList = markets[mk].firmList || []; markets[mk].firmList.push(i);
      markets[mk].cap += e.capacity;
      markets[mk].sub = sub;
      return { i, id: e.id, name0: e.name, sector: e.sector, kind, sub, district: e.district, x: e.x, y: e.y, capacity: e.capacity, market: mk, wage: L.SECTOR[e.sector].wage / 7 };
    });
    // the price of one unit at normal times: a worker-day's wage is the labour share of it
    for (const p of prem) p.P0 = p.wage / KIND[p.kind].labour;
    for (const mk of markets) { mk.firms = Int32Array.from(mk.firmList); delete mk.firmList; }
    for (const mk of markets) {
      mk.P0 = prem[mk.firms[0]].P0;
      mk.base = mk.cap * 0.78; // demand at normal times: a little under what the market can make, so there is competition
    }
    // rent: dearer downtown, cheaper at the edges
    for (const p of prem) { const dx = p.x - 70, dy = p.y - 58, d = (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy); p.rentK = 1.25 - clamp(d / 110, 0, 0.5); }
    const residents = m.districts.map((d) => d.residents);
    const totalRes = residents.reduce((a, b) => a + b, 0);
    // shops serve their own district: a district's shop demand follows its residents, scaled so the city as a whole is normal
    const shopCap = markets.filter((x) => x.kind === 'shop').reduce((a, x) => a + x.cap, 0);
    for (const mk of markets) if (mk.kind === 'shop') {
      const capD = markets.filter((x) => x.kind === 'shop' && x.district === mk.district).reduce((a, x) => a + x.cap, 0);
      const fairShare = shopCap * residents[mk.district] / totalRes;
      mk.base = mk.cap * 0.78 * clamp(fairShare / capD, 0.7, 1.35);
    }
    const goodsMk = {};
    for (const mk of markets) if (mk.key.startsWith('goods:') || mk.key.startsWith('trade:')) goodsMk[mk.kind] = mk.i;
    REG = { prem, markets, byKey, goodsMk, districts: m.districts.map((d) => d.name), residents, N: prem.length, M: markets.length };
    return REG;
  }

  // ---------------------------------------------------------------- the world outside: what each trading day brings
  const dayStart = (k) => START + k * DAY;
  const CHUNK = 30;
  const wxCache = new Map(), cityCache = new Map(), portCache = new Map();
  function chunk(cache, k, fn) {
    const c = Math.floor(k / CHUNK);
    if (!cache.has(c)) { cache.set(c, fn(dayStart(c * CHUNK), dayStart(c * CHUNK + CHUNK))); if (cache.size > 40) cache.delete(cache.keys().next().value); }
    return cache.get(c);
  }
  function conditions(k) {
    const d0 = dayStart(k), C = City(), W = Wx();
    const wx = chunk(wxCache, k, (a, b) => { const out = {}; for (const d of W.historyBetween(a, b)) out[d.day] = d; return out; })[d0] || {};
    const wy = chunk(wxCache, k - 1, (a, b) => { const out = {}; for (const d of W.historyBetween(a, b)) out[d.day] = d; return out; })[d0 - DAY] || {};
    const ch = chunk(cityCache, k, (a, b) => { const out = {}; for (const d of C.historyBetween(a, b)) out[d.day] = d; return out; })[d0] || null;
    const ships = chunk(portCache, k, (a, b) => { const out = {}; for (const s of C.portBetween(a, b - 1)) { const dd = s.arrive - (((s.arrive % DAY) + DAY) % DAY); (out[dd] = out[dd] || []).push(s); } return out; })[d0] || [];
    let levels = {};
    try { levels = C.stateAt(d0 + 12 * H).levels || {}; } catch (e) { levels = {}; }
    // power: what the day's mix cost, against a coal-heavy normal of 40 W a unit
    let powerIdx = 1;
    if (ch && ch.energy) {
      const e = ch.energy, tot = e.solar + e.wind + e.coal + e.link + e.gas;
      if (tot > 0) powerIdx = clamp((e.coal * 34 + e.gas * 118 + e.link * 78 + e.solar * 42 + e.wind * 44) / tot / 40, 0.7, 2.4);
    }
    const dark = (ch && ch.dark) || {}, darkFrac = [];
    for (let i = 0; i < 16; i++) darkFrac.push(clamp((dark[i] || 0) / 24, 0, 1));
    let cargo = 0, held = 0;
    for (const s of ships) { cargo += s.type === 'container' ? 1 : s.type === 'bulk' ? 0.8 : s.type === 'tanker' ? 0.6 : 0; if (s.held && s.held >= 6 * H) held++; }
    const date = new Date(d0 + 12 * H), wd = date.getUTCDay(), month = date.getUTCMonth();
    return {
      k, day: d0, date: ymd(d0), month, weekend: wd === 0 || wd === 6, gp: new Date(d0).getUTCDate() === 1,
      max: wx.max === undefined ? 18 : wx.max, rain: wx.rain || 0, gust: wx.gust || 0, sunshine: wx.sunshine === undefined ? 6 : wx.sunshine, storm: !!wx.storm || wx.cat === 'stormy',
      stormYesterday: !!wy.storm || wy.cat === 'stormy' || (wy.rain || 0) > 40,
      aqi: ch ? ch.aqi : 40, blackoutHours: ch ? ch.blackoutHours : 0, darkFrac, powerIdx, levels, cargo, held, portClosed: (wx.gust || 0) >= 88
    };
  }
  // how much a district's pixels want from each kind of shop, today
  function shopMood(sub, x, district) {
    let f = 1;
    const spring = x.month >= 8 && x.month <= 10, summer = x.month === 11 || x.month <= 1, winter = x.month >= 5 && x.month <= 7;
    if (sub === 'Coffee') { if (x.max < 14) f *= 1.16; else if (x.max > 24) f *= 0.88; if (x.weekend) f *= 1.08; }
    else if (sub === 'Florist') { f *= spring ? 1.22 : summer ? 1.08 : winter ? 0.74 : 0.95; f *= 0.9 + x.sunshine * 0.02; if (x.rain > 8) f *= 0.8; }
    else if (sub === 'Hardware') { if (x.stormYesterday) f *= 1.6; if (x.weekend) f *= 1.15; }
    else if (sub === 'News & Sweets') { if (x.gp) f *= 1.6; }
    else if (sub === 'Bakery') { if (x.weekend) f *= 1.1; }
    if (x.storm) f *= sub === 'Corner Store' ? 0.85 : 0.6;
    else if (x.rain > 10) f *= 0.88;
    if (x.gp && district === STADIUM_DISTRICT) f *= 1.35;
    f *= 1 - 0.85 * x.darkFrac[district];
    if (x.aqi > 100) f *= 1 - lo(0.18, (x.aqi - 100) / 600);
    f *= 1 - 0.05 * (x.levels['policy.trafficLimits'] || 0);
    return f;
  }
  let STADIUM_DISTRICT = 9;
  const ELASTIC = { shop: 1.2, office: 1, screens: 1.1, diodes: 0.7, glass: 0.7, phosphor: 0.7, freight: 0.6, storage: 0.6, distribution: 0.6, stevedores: 0.4 };

  // ---------------------------------------------------------------- the state of the market, day by day
  // Per business: the occupant now (generation), price, staff (share of the premises' capacity), cash, quality,
  // efficiency, appetite for a price war, reputation, the margin it has been making, days in loss, and what it sold.
  const FIELDS = ['util', 'patience', 'price', 'staff', 'cash', 'q', 'eff', 'aggr', 'rep', 'margin', 'loss', 'sales', 'rev', 'profit', 'open', 'gen', 'since', 'reopen', 'credit', 'supply'];
  function blank(N) { const s = {}; for (const f of FIELDS) s[f] = new Float64Array(N); return s; }
  function clone(s) { const c = {}; for (const f of FIELDS) c[f] = s[f].slice(); for (const k of ['k', 'conf', 'importIdx', 'world', 'mkPrice', 'mkOut', 'mkUnmet', 'mkDemand', 'shopUnits', 'factoryUnits', 'revOther', 'closures7', 'cargoAvg']) c[k] = s[k] && s[k].slice ? s[k].slice() : s[k]; return c; }

  function newOccupant(s, R, i, k, gen, mkPrice) {
    const p = R.prem[i], r = seeded('firm:' + p.id + ':' + gen);
    s.gen[i] = gen; s.open[i] = 1; s.since[i] = k; s.reopen[i] = -1; s.loss[i] = 0; s.margin[i] = 0;
    s.q[i] = 0.85 + r() * 0.3; s.eff[i] = 0.86 + r() * 0.28; s.aggr[i] = r();
    s.price[i] = (mkPrice || p.P0) * (gen ? 0.88 + r() * 0.16 : 0.95 + r() * 0.13);
    s.staff[i] = gen ? 0.45 + r() * 0.2 : 0.7 + r() * 0.25;
    const fixed = p.capacity * (p.wage + KIND[p.kind].rent * p.P0 * p.rentK);
    s.cash[i] = fixed * (gen ? 18 + r() * 30 : 20 + r() * 45);
    s.credit[i] = fixed * (14 + r() * 26);
    s.rep[i] = gen ? 0.5 : 1; s.util[i] = 0.85;
    s.patience[i] = 75 + Math.floor(r() * 150); // how many losing days an owner will stand
    return r;
  }
  function nameOf(R, i, gen) {
    const p = R.prem[i];
    if (!gen) return p.name0;
    const r = seeded('name:' + p.id + ':' + gen);
    if (p.kind === 'shop') return pick(r, NAME_F) + '\u2019s ' + p.sub;
    if (p.kind === 'office') return pick(r, NAME_A) + ' ' + p.sub;
    return pick(r, NAME_A) + ' ' + SUFFIX_NEW[p.kind];
  }

  // the forward run: one state, advanced day by day and never rewound. Earlier moments are rebuilt from monthly
  // checkpoints. Daily summaries, events and each occupant's monthly ledger are recorded as the run passes.
  let RUN = null;
  function init() {
    const R = register();
    const C = City(), m0 = C.map(Date.UTC(2026, 10, 2));
    const st = m0.features.find((f) => f.type === 'stadium'); if (st) STADIUM_DISTRICT = st.district;
    const s = blank(R.N);
    s.k = 0; s.conf = 1; s.cargoAvg = 2; s.importIdx = 1; s.world = 1;
    s.mkPrice = new Float64Array(R.M); s.mkOut = new Float64Array(R.M); s.mkUnmet = new Float64Array(R.M); s.mkDemand = new Float64Array(R.M);
    for (const mk of R.markets) { s.mkPrice[mk.i] = mk.P0; s.mkOut[mk.i] = mk.base; s.mkDemand[mk.i] = mk.base; }
    s.shopUnits = 1; s.factoryUnits = 1; s.revOther = 1; s.closures7 = new Float64Array(7);
    for (let i = 0; i < R.N; i++) newOccupant(s, R, i, 0, 0, 0);
    // what normal looks like, for the ratios that pass demand down the chain
    let shopBase = 0, factoryBase = 0, revBase = 0;
    for (const mk of R.markets) { if (mk.kind === 'shop') shopBase += mk.base; if (KIND[mk.kind].sector === 'factory') factoryBase += mk.base; if (mk.kind !== 'office') revBase += mk.base * mk.P0; }
    RUN = { R, s, days: [], events: [], ledger: [], occupants: R.prem.map((p, i) => [{ gen: 0, name: p.name0, from: 0, to: -1, reason: '' }]), checkpoints: new Map(), shopBase, factoryBase, revBase,
      cool: {} };
    RUN.checkpoints.set(0, clone(s));
  }

  function phaseSupply(s, x, lawCap) {
    const R = RUN.R, N = R.N;
    const { util, patience, price, staff, cash, q, eff, aggr, rep, margin, loss, sales, rev, profit, open, gen, since, reopen, credit, supply, mkPrice, mkOut, mkUnmet, mkDemand } = s;
    // each business's supply: staff, skill, the lights being on, the weather at the docks, the Senate's limits
    for (let i = 0; i < N; i++) {
      if (!open[i]) { supply[i] = 0; continue; }
      const p = R.prem[i];
      let sup = p.capacity * staff[i] * eff[i];
      if (p.kind !== 'shop') sup *= 1 - x.darkFrac[p.district];
      if (p.kind === 'stevedores' && x.portClosed) sup *= 0.15;
      if (KIND[p.kind].sector === 'factory') sup *= p.kind === 'phosphor' || p.kind === 'glass' ? lawCap - 0.04 * (x.levels['policy.emissionsCap'] || 0) : lawCap;
      supply[i] = sup;
    }

  }
  function phaseClear(s) {
    const R = RUN.R, N = R.N;
    const { util, patience, price, staff, cash, q, eff, aggr, rep, margin, loss, sales, rev, profit, open, gen, since, reopen, credit, supply, mkPrice, mkOut, mkUnmet, mkDemand } = s;
    // the market clears: customers go where quality is high and prices low, then spill over to whoever has room
    const a = new Float64Array(N);
    let shopUnits = 0, factoryUnits = 0, revOther = 0;
    for (const mk of R.markets) {
      const F = mk.firms;
      let A = 0;
      for (const i of F) if (open[i]) { a[i] = q[i] * rep[i] / (price[i] * price[i] / (mk.P0 * mk.P0)); A += a[i]; } else a[i] = 0;
      const D = mkDemand[mk.i];
      let left = 0;
      for (const i of F) { if (!open[i]) { sales[i] = 0; continue; } const want = A > 0 ? D * a[i] / A : 0; sales[i] = lo(want, supply[i]); left += want - sales[i]; }
      if (left > 0) { // spill-over, once
        let A2 = 0;
        for (const i of F) if (open[i] && supply[i] > sales[i]) A2 += a[i];
        if (A2 > 0) { let moved = 0; for (const i of F) if (open[i] && supply[i] > sales[i]) { const extra = lo(left * a[i] / A2, supply[i] - sales[i]); sales[i] += extra; moved += extra; } left -= moved; }
      }
      let units = 0, value = 0, pr = 0, n = 0;
      for (const i of F) if (open[i]) { units += sales[i]; value += sales[i] * price[i]; pr += price[i]; n++; }
      mkOut[mk.i] = units; mkUnmet[mk.i] = D > 0 ? hi(0, left) / D : 0;
      mkPrice[mk.i] = units > 0 ? value / units : n ? pr / n : mkPrice[mk.i];
      if (mk.kind === 'shop') shopUnits += units;
      if (KIND[mk.kind].sector === 'factory') factoryUnits += units;
      if (mk.kind !== 'office') revOther += units * mk.P0; // real activity, at normal prices, so offices don't chase inflation
    }

    return { shopUnits, factoryUnits, revOther };
  }
  function phaseBooks(s, x, k, r, record, emit, dn) {
    const R = RUN.R, N = R.N;
    const { util, patience, price, staff, cash, q, eff, aggr, rep, margin, loss, sales, rev, profit, open, gen, since, reopen, credit, supply, mkPrice, mkOut, mkUnmet, mkDemand } = s;
    // the books, and each business's decisions for tomorrow
    const goodsPrice = (kind) => kind === 'import' ? s.importIdx : mkPrice[R.goodsMk[kind]] / R.markets[R.goodsMk[kind]].P0;
    const inputCost = {}; // what one unit's inputs cost today, by kind of business (the same for every business of a kind)
    for (const kind in KIND) { let c = 0; for (const [g, share] of KIND[kind].inputs) c += share * goodsPrice(g); inputCost[kind] = c; }
    let closures = 0, profitSum = 0, revSum = 0;
    for (let i = 0; i < N; i++) {
      const p = R.prem[i], K = KIND[p.kind];
      if (!open[i]) {
        if (reopen[i] >= 0 && k >= reopen[i]) { // someone new takes the empty premises
          const g2 = gen[i] + 1;
          newOccupant(s, R, i, k, g2, mkPrice[p.market]);
          if (record) {
            const prev = RUN.occupants[i][RUN.occupants[i].length - 1];
            RUN.occupants[i].push({ gen: g2, name: nameOf(R, i, g2), from: k, to: -1, reason: '' });
            emit('business.opened', p.capacity >= 25 ? 2 : 1, 'open:' + p.id + ':' + g2, { premises: p.id, name: nameOf(R, i, g2), district: dn(p.district), sector: p.sector, jobs: Math.round(p.capacity * staff[i]) },
              nameOf(R, i, g2) + ' opens in ' + dn(p.district) + ', in the premises left empty by ' + prev.name, 3 + (i % 50));
          }
        }
        continue;
      }
      const sold = sales[i], sup = supply[i], ud = sup > 0 ? sold / sup : 0;
      util[i] = util[i] * 0.85 + ud * 0.15; // owners judge by the last week or two, not one quiet Sunday
      const u = util[i];
      const revI = sold * price[i];
      const workers = p.capacity * staff[i];
      const unitInputs = inputCost[p.kind] * p.P0;
      const labour = workers * p.wage;
      const power = K.power * p.P0 * x.powerIdx * (0.3 * p.capacity * staff[i] + 0.7 * sold);
      const rent = K.rent * p.P0 * p.capacity * p.rentK;
      const profitI = revI - labour - power - rent - unitInputs * sold;
      rev[i] = revI; profit[i] = profitI; cash[i] += profitI;
      margin[i] = margin[i] * 0.93 + (revI > 0 ? profitI / revI : -1) * 0.07;
      loss[i] = profitI < 0 ? loss[i] + 1 : hi(0, loss[i] - 2);
      profitSum += profitI; revSum += revI;
      // price: up when sold out and others are short, down when goods sit unsold; never far below cost for long
      const ri = r();
      // each business aims for its costs at a normal day's trade plus its own markup (the bold ones take less, to win
      // customers), then leans on that: up when sold out with customers turned away, down when goods sit unsold
      const unitCost = (labour + power + rent) / hi(1, sold) + unitInputs;
      const normalCost = p.wage / eff[i] + K.power * p.P0 * x.powerIdx + unitInputs + K.rent * p.P0 * p.rentK / eff[i];
      price[i] += (normalCost * (1.06 + 0.16 * (1 - aggr[i])) - price[i]) * 0.05;
      if (ud > 0.97 && u > 0.9 && mkUnmet[p.market] > 0.02) price[i] *= 1.002 + 0.006 * (1 - aggr[i]) + ri * 0.003;
      else if (u < 0.7) price[i] *= 1 - (0.002 + 0.008 * aggr[i]) * (0.7 - u) / 0.7 * 3;
      price[i] *= 1 + (ri - 0.5) * 0.004;
      price[i] = clamp(price[i], hi(unitCost * (0.82 - 0.12 * aggr[i]), p.P0 * 0.5), p.P0 * 2.6);
      // staff: take people on when sold out and making money; let them go when quiet or short of cash
      if (u > 0.93 && margin[i] > 0.02 && cash[i] > 0) staff[i] = lo(1, staff[i] + 0.02 + 0.02 * r());
      else if (u < 0.6 || (cash[i] < -0.5 * credit[i] && u < 0.85)) staff[i] = hi(0.3, staff[i] - 0.015 - 0.015 * r());
      // quality follows money: good years pay for improvements, bad ones wear things down
      q[i] = clamp(q[i] + (margin[i] > 0.08 ? 0.0004 : margin[i] < -0.05 ? -0.0004 : 0), 0.7, 1.35);
      if (rep[i] < 1) rep[i] = lo(1, rep[i] + 0.008);
      // failure: past the bank's patience, or a year of losses
      if (cash[i] < -credit[i] || loss[i] > patience[i]) {
        open[i] = 0; closures++;
        const health = mkPrice[p.market] / R.markets[p.market].P0;
        reopen[i] = k + 12 + Math.floor(r() * (25 + 90 * clamp(1.4 - health, 0.2, 1.2)));
        if (record) {
          const occ = RUN.occupants[i][RUN.occupants[i].length - 1];
          occ.to = k; occ.reason = cash[i] < -credit[i] ? 'ran out of credit' : 'months of losses';
          const months = Math.floor((k - since[i]) / 30.44), jobs = Math.round(workers);
          const age = gen[i] === 0 && k - since[i] < 400 ? 'after trading since the city began' : months < 1 ? 'within a month of opening' : months < 12 ? 'after ' + months + ' month' + (months === 1 ? '' : 's') : 'after ' + Math.floor(months / 12) + ' year' + (months < 24 ? '' : 's');
          emit('business.closed', jobs >= 25 ? 3 : 2, 'close:' + p.id + ':' + gen[i], { premises: p.id, name: occ.name, district: dn(p.district), sector: p.sector, jobs, reason: occ.reason },
            occ.name + ' in ' + dn(p.district) + ' closes ' + age + ', with ' + (jobs === 1 ? 'one job' : jobs + ' jobs') + ' lost', 3 + (i % 50));
        }
      }
    }

    return { closures, profitSum, revSum };
  }

  function phaseRecord(s, x, k, emit, dn, at, closures, profitSum, revSum, cityMargin) {
    const R = RUN.R, N = R.N;
    const { util, patience, price, staff, cash, q, eff, aggr, rep, margin, loss, sales, rev, profit, open, gen, since, reopen, credit, supply, mkPrice, mkOut, mkUnmet, mkDemand } = s;
    {
      // shortages and price wars, noticed by the Exchange's reporters (each market at most once a month)
      for (const mk of R.markets) {
        const ck = RUN.cool[mk.i] || -999;
        if (k - ck < 30) continue;
        const name = mk.kind === 'shop' ? mk.sub.replace(/^& /, '').toLowerCase() : mk.label.toLowerCase();
        const past3 = RUN.days[k - 2], past2 = RUN.days[k - 1];
        if (mk.kind !== 'shop' && mk.kind !== 'office' && mkUnmet[mk.i] > 0.12 && past3 && past3.unmet[mk.i] > 0.12 && past2.unmet[mk.i] > 0.12) {
          const past = RUN.days[k - 7];
          const was = past && past.prices[mk.i], change = was ? (mkPrice[mk.i] / was - 1) * 100 : 0;
          RUN.cool[mk.i] = k;
          emit('market.shortage', 3, 'short:' + mk.key + ':' + ymd(dayStart(k)), { market: mk.label, unmet: rd(mkUnmet[mk.i] * 100, 1), price: rd(change, 10) },
            'A shortage of ' + name + ' leaves ' + Math.round(mkUnmet[mk.i] * 100) + '% of orders unfilled' + (change > 1 ? ', and prices are up ' + Math.round(change) + '% in a week' : ''), 2);
        } else if (mk.kind === 'shop' && mk.firms.length >= 3 && k >= 21) {
          const past = RUN.days[k - 21];
          if (past && mk.firms.length >= 4 && mkDemand[mk.i] > past.demand[mk.i] * 0.92 && mkPrice[mk.i] < past.prices[mk.i] * 0.86 && k - (RUN.cool['w' + mk.i] || -999) > 180 && k - (RUN.cool.war || -999) > 7) {
            RUN.cool.war = k;
            RUN.cool['w' + mk.i] = k;
            RUN.cool[mk.i] = k;
            const plural = { 'Pixel Pantry': 'pantries', 'Corner Store': 'corner stores', Florist: 'florists', Coffee: 'coffee shops', Hardware: 'hardware stores', Bakery: 'bakeries', 'News & Sweets': 'newsagents' }[mk.sub] || 'shops';
            emit('market.pricewar', 2, 'war:' + mk.key + ':' + ymd(dayStart(k)), { market: mk.sub, district: dn(mk.district), drop: rd((1 - mkPrice[mk.i] / past.prices[mk.i]) * 100, 10) },
              'A price war among the ' + plural + ' of ' + dn(mk.district) + ' has cut prices by ' + Math.round((1 - mkPrice[mk.i] / past.prices[mk.i]) * 100) + '% in three weeks', 2);
          }
        }
      }
      { let D = 0, Un = 0; for (const mk of R.markets) if (mk.kind === 'office') { D += mkDemand[mk.i]; Un += mkUnmet[mk.i] * mkDemand[mk.i]; }
        const un = D > 0 ? Un / D : 0;
        RUN.officeUn = (RUN.officeUn || 0) * 0.7 + un * 0.3;
        if (RUN.officeUn > 0.1 && k - (RUN.cool.office || -999) > 45) { RUN.cool.office = k; emit('market.shortage', 2, 'short:office:' + ymd(dayStart(k)), { market: 'Office services', unmet: rd(un * 100, 1) },
          'The city\u2019s offices are turning work away: ' + Math.round(un * 100) + '% of orders for typesetting, alignment and colour advice go unfilled', 2); } }
      let nOpen = 0, nStaff = 0;
      for (let i = 0; i < N; i++) if (open[i]) { nOpen++; nStaff += R.prem[i].capacity * staff[i]; }
      // a consumer price index: what a district's shopping basket costs, against the first day (100)
      let basket = 0, basket0 = 0;
      for (const mk of R.markets) if (mk.kind === 'shop') { basket += mk.base * mkPrice[mk.i]; basket0 += mk.base * mk.P0; }
      RUN.days.push({ k, day: dayStart(k), date: x.date, conf: rd(s.conf * 100, 10), cpi: rd(basket / basket0 * 100, 10), power: rd(x.powerIdx * 100, 1), imports: rd(s.importIdx * 100, 1), world: rd(s.world * 100, 1),
        open: nOpen, staff: Math.round(nStaff), closures, margin: rd(cityMargin * 100, 10), revenue: Math.round(revSum), profit: Math.round(profitSum),
        prices: Float64Array.from(s.mkPrice), output: Float64Array.from(s.mkOut), unmet: Float64Array.from(s.mkUnmet), demand: Float64Array.from(s.mkDemand) });
      // the monthly ledger: each occupant's revenue, profit, staff and cash at the end of each calendar month
      const L = RUN.ledgerMonth || (RUN.ledgerMonth = { month: monthOf(dayStart(k)), rev: new Float64Array(N), profit: new Float64Array(N), units: new Float64Array(N), days: new Float64Array(N) });
      for (let i = 0; i < N; i++) if (open[i]) { L.rev[i] += rev[i]; L.profit[i] += profit[i]; L.units[i] += sales[i]; L.days[i]++; }
      if (monthOf(dayStart(k + 1)) !== L.month) {
        RUN.ledger.push({ month: L.month, rev: Float32Array.from(L.rev), profit: Float32Array.from(L.profit), units: Float32Array.from(L.units), days: Uint8Array.from(L.days),
          staff: Float32Array.from(s.staff), cash: Float32Array.from(s.cash), price: Float32Array.from(s.price), gen: Uint16Array.from(s.gen), open: Uint8Array.from(s.open) });
        RUN.ledgerMonth = null;
        // the first of each month: the Exchange's report
        if (k >= 30) {
          const prev = RUN.days[k - 30], d = RUN.days[k];
          let shut = 0, opened = 0;
          for (const e of RUN.events) if (e.ms > dayStart(k - 30) && e.ms <= at) { if (e.type === 'business.closed') shut++; if (e.type === 'business.opened') opened++; }
          const dc = d.conf - prev.conf;
          emit('market.report', 2, 'report:' + ymd(dayStart(k + 1)), { confidence: d.conf, cpi: d.cpi, closed: shut, opened },
            'Business confidence ' + (dc > 0.5 ? 'rises to ' : dc < -0.5 ? 'falls to ' : 'holds at ') + d.conf.toFixed(1) + '; ' + (shut === 0 ? 'no businesses closed' : shut + ' business' + (shut === 1 ? '' : 'es') + ' closed') + ' and ' + opened + ' opened last month', 0);
        }
      }
    }
  }

  // one trading day. record: whether this is the forward run (which keeps history and events) or a rebuild.
  function step(s, record) {
    const R = RUN.R, k = s.k, x = conditions(k), r = seeded('day:' + k), N = R.N, M = R.M;
    const { util, patience, price, staff, cash, q, eff, aggr, rep, margin, loss, sales, rev, profit, open, gen, since, reopen, credit, supply, mkPrice, mkOut, mkUnmet, mkDemand } = s;
    const ev = record ? RUN.events : null;
    const at = dayStart(k) + DAY; // results are posted at the close
    const emit = (type, importance, idPart, data, headline, sec) => { if (ev) ev.push({ id: 'commerce:' + idPart, time: iso(at + (sec || 0) * 1000), ms: at + (sec || 0) * 1000, source: 'commerce', type, importance, data, headline }); };
    const dn = (d) => R.districts[d];

    // the world market for screens wanders, and now and then lurches
    let lurch = 0;
    if (r() < 1 / 150) lurch = (r() < 0.5 ? -1 : 1) * (0.12 + r() * 0.12);
    s.world = clamp(1 + (s.world - 1) * 0.97 + (r() - 0.5) * 0.035 + lurch, 0.55, 1.55);
    if (lurch && record) emit(lurch > 0 ? 'market.boom' : 'market.slump', 3, 'world:' + ymd(dayStart(k)), { good: 'screens', change: rd(lurch * 100, 1) },
      lurch > 0 ? 'Overseas orders for Pixel City screens jump by ' + Math.round(lurch * 100) + '%; the Screen Works are working late' : 'Overseas orders for Pixel City screens fall by ' + Math.round(-lurch * 100) + '%; the Screen Works go quiet', 1);
    // raw colour comes in by sea: dearer when ships are held outside the harbour
    s.importIdx = clamp(1 + (s.importIdx - 1) * 0.96 + (r() - 0.5) * 0.02 + (x.portClosed ? 0.03 : 0) + x.held * 0.01, 0.75, 1.6);

    // demand, market by market. Factories, warehouses and offices answer to the rest of the city one day behind.
    const out = (kind) => mkOut[R.goodsMk[kind]] / R.markets[R.goodsMk[kind]].base;
    const screensR = out('screens'), diodesR = out('diodes');
    s.cargoAvg = s.cargoAvg * 0.97 + x.cargo * 0.03;
    const portR = x.portClosed ? 0.15 : clamp(x.cargo / hi(0.3, s.cargoAvg), 0.2, 2.2);
    const lawCap = 1 - 0.07 * (x.levels['policy.emissionsCap'] || 0);
    for (const mk of R.markets) {
      let f;
      const sub = mk.sub;
      if (mk.kind === 'shop') f = shopMood(sub, x, mk.district) * s.conf;
      else if (mk.kind === 'screens') f = 0.6 * s.world + 0.4 * s.shopUnits * s.conf;
      else if (mk.kind === 'diodes' || mk.kind === 'glass') f = screensR;
      else if (mk.kind === 'phosphor') f = diodesR;
      else if (mk.kind === 'freight') f = s.factoryUnits;
      else if (mk.kind === 'storage') f = 0.55 * portR + 0.45 * s.factoryUnits;
      else if (mk.kind === 'distribution') f = s.shopUnits;
      else if (mk.kind === 'stevedores') f = portR;
      else f = s.revOther * s.conf * (1 + 0.03 * (x.levels['policy.constructionBudget'] || 0)) * (x.weekend ? 0.55 : 1.15) * (1 - 0.6 * x.darkFrac[7]);
      // dearer markets sell less: how much depends on whether pixels can do without it
      const rel = clamp(mkPrice[mk.i] / mk.P0, 0.4, 3), E = ELASTIC[mk.kind];
      mkDemand[mk.i] = mk.base * f * clamp(1 / (1 + E * (rel - 1)), 0.3, 1.6) * (0.97 + r() * 0.06);
    }

    phaseSupply(s, x, lawCap);
    const { shopUnits, factoryUnits, revOther } = phaseClear(s);
    const { closures, profitSum, revSum } = phaseBooks(s, x, k, r, record, emit, dn);
    // confidence: profits, closures, blackouts and smog, felt over a fortnight
    s.closures7 = s.closures7.slice(1); const c7 = new Float64Array(7); c7.set(s.closures7); c7[6] = closures; s.closures7 = c7;
    let c7sum = 0; for (let j = 0; j < 7; j++) c7sum += s.closures7[j];
    const cityMargin = revSum > 0 ? profitSum / revSum : 0;
    const target = clamp(1 + (cityMargin - 0.1) * 1.6 - c7sum * 0.012 - x.blackoutHours * 0.01 - hi(0, x.aqi - 90) * 0.0006, 0.78, 1.18);
    s.conf = s.conf + (target - s.conf) / 14;
    s.shopUnits = shopUnits / RUN.shopBase; s.factoryUnits = factoryUnits / RUN.factoryBase; s.revOther = revOther / RUN.revBase;

    if (record) phaseRecord(s, x, k, emit, dn, at, closures, profitSum, revSum, cityMargin);
    s.k = k + 1;
  }
  const monthOf = (ms) => { const d = new Date(ms); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };

  // advance the forward run to the start of day k (so days 0..k-1 are complete)
  function advance(k) {
    if (!RUN) init();
    while (RUN.s.k < k) {
      step(RUN.s, true);
      if (RUN.s.k % 30 === 0) RUN.checkpoints.set(RUN.s.k, clone(RUN.s));
    }
    // count the day's openings into its summary (they are recorded as events as they happen)
    return RUN.s;
  }
  // the market as it stood at the start of day k
  function stateFor(k) {
    advance(k);
    if (RUN.s.k === k) return RUN.s;
    const c = Math.floor(k / 30) * 30, s = clone(RUN.checkpoints.get(c));
    while (s.k < k) step(s, false);
    return s;
  }
  const closedDays = (t) => clamp(Math.floor((t - START) / DAY), 0, 1e7); // trading days complete by time t

  // ---------------------------------------------------------------- reading the market
  function firmView(R, s, i, k) {
    const p = R.prem[i], open = !!s.open[i], gen = s.gen[i];
    const fixed = p.capacity * (p.wage + KIND[p.kind].rent * p.P0 * p.rentK);
    const cashDays = fixed > 0 ? s.cash[i] / fixed : 0;
    return {
      premises: p.id, name: open ? nameOf(R, i, gen) : null, lastName: nameOf(R, i, gen), open, generation: gen, sector: p.sector, kind: p.kind, line: p.sub, district: p.district, districtName: R.districts[p.district],
      x: p.x, y: p.y, capacity: p.capacity, staff: open ? Math.round(p.capacity * s.staff[i]) : 0, since: open ? ymd(dayStart(s.since[i])) : null,
      price: rd(s.price[i], 100), marketPrice: rd(s.mkPrice[p.market], 100), relPrice: rd(s.price[i] / s.mkPrice[p.market] * 100, 1), quality: rd(s.q[i] * 100, 1),
      sales: rd(s.sales[i], 10), revenue: Math.round(s.rev[i]), profit: Math.round(s.profit[i]), margin: rd(s.margin[i] * 100, 10), cash: Math.round(s.cash[i]), cashDays: rd(cashDays, 10),
      standing: !open ? 'empty' : cashDays > 30 ? 'comfortable' : cashDays > 5 ? 'steady' : cashDays > -0.4 * s.credit[i] / fixed ? 'stretched' : 'in difficulty',
      reopens: !open && s.reopen[i] >= 0 ? ymd(dayStart(s.reopen[i])) : null, market: R.markets[p.market].key, losingDays: s.loss[i]
    };
  }
  function marketView(R, s, mk) {
    let open = 0, staff = 0;
    for (const i of mk.firms) if (s.open[i]) { open++; staff += R.prem[i].capacity * s.staff[i]; }
    return { key: mk.key, kind: mk.kind, label: mk.label, sector: KIND[mk.kind].sector, district: mk.district, districtName: mk.district >= 0 ? R.districts[mk.district] : null,
      firms: mk.firms.length, open, staff: Math.round(staff), price: rd(s.mkPrice[mk.i], 100), priceIdx: rd(s.mkPrice[mk.i] / mk.P0 * 100, 10),
      demand: rd(s.mkDemand[mk.i], 10), output: rd(s.mkOut[mk.i], 10), demandIdx: rd(s.mkDemand[mk.i] / mk.base * 100, 10), shortage: rd(s.mkUnmet[mk.i] * 100, 10) };
  }

  /** The market at time t, as of the last close. */
  function stateAt(t) {
    if (!ready() || t < START + DAY) return { started: false, startDate: ymd(START) };
    const k = closedDays(t), R = register(), s = stateFor(k), d = RUN.days[k - 1];
    const sectors = {};
    for (const mk of R.markets) {
      const sec = mk.kind === 'shop' || mk.kind === 'office' ? mk.kind : mk.kind;
      const g = sectors[sec] || (sectors[sec] = { kind: sec, label: mk.kind === 'shop' ? 'Shops' : mk.kind === 'office' ? 'Office services' : mk.label, sector: KIND[mk.kind].sector, firms: 0, open: 0, value: 0, base: 0, bu: 0, out: 0, dem: 0, unmet: 0 });
      for (const i of mk.firms) { g.firms++; if (s.open[i]) g.open++; }
      g.value += s.mkPrice[mk.i] * mk.base; g.base += mk.P0 * mk.base; g.bu += mk.base; g.out += s.mkOut[mk.i]; g.dem += s.mkDemand[mk.i]; g.unmet += s.mkUnmet[mk.i] * s.mkDemand[mk.i];
    }
    const sec = Object.values(sectors).map((g) => ({ kind: g.kind, label: g.label, sector: g.sector, firms: g.firms, open: g.open, priceIdx: rd(g.value / g.base * 100, 10), demandIdx: rd(g.dem / g.bu * 100, 10), outputVsDemand: rd(g.out / hi(1, g.dem) * 100, 10), shortage: rd(g.unmet / hi(1, g.dem) * 100, 10) }));
    return { started: true, asOf: iso(dayStart(k)), day: d.date, confidence: d.conf, cpi: d.cpi, powerIdx: d.power, importIdx: d.imports, worldIdx: d.world, open: d.open, businesses: R.N, staff: d.staff,
      revenue: d.revenue, profit: d.profit, margin: d.margin, sectors: sec };
  }
  function firmsAt(t) { if (!ready() || t < START + DAY) return []; const k = closedDays(t), R = register(), s = stateFor(k); const out = []; for (let i = 0; i < R.N; i++) out.push(firmView(R, s, i, k)); return out; }
  function marketsAt(t) { if (!ready() || t < START + DAY) return []; const k = closedDays(t), R = register(), s = stateFor(k); return R.markets.map((mk) => marketView(R, s, mk)); }
  function premisesIndex(id) { const R = register(); if (!R.byId) { R.byId = {}; R.prem.forEach((p, i) => (R.byId[p.id] = i)); } return R.byId[id]; }
  /** One premises at time t: who trades there, how they're doing, everyone who traded there before, and the monthly ledger. */
  function business(id, t) {
    if (!ready() || t < START + DAY) return null;
    const i = premisesIndex(id); if (i === undefined) return null;
    const k = closedDays(t), R = register(), s = stateFor(k), v = firmView(R, s, i, k);
    v.history = RUN.occupants[i].filter((o) => o.from < k).map((o) => ({ name: o.name, generation: o.gen, from: ymd(dayStart(o.from)), to: o.to >= 0 && o.to < k ? ymd(dayStart(o.to)) : null, reason: o.to >= 0 && o.to < k ? o.reason : '' }));
    const mEnd = monthOf(dayStart(k));
    v.ledger = RUN.ledger.filter((L) => L.month < mEnd).map((L) => ({ month: Math.floor(L.month / 12) + '-' + pad(L.month % 12 + 1), name: L.days[i] ? nameOf(R, i, L.gen[i]) : null, days: L.days[i], revenue: Math.round(L.rev[i]), profit: Math.round(L.profit[i]),
      units: Math.round(L.units[i]), staff: Math.round(L.staff[i] * R.prem[i].capacity * (L.open[i] ? 1 : 0)), cash: Math.round(L.cash[i]), price: rd(L.price[i], 100) }));
    return v;
  }
  function historyBetween(from, to) {
    if (!ready()) return [];
    const k1 = closedDays(to); advance(k1);
    return RUN.days.filter((d) => d.day + DAY > from && d.day + DAY <= to).map((d) => ({ day: d.day, date: d.date, confidence: d.conf, cpi: d.cpi, powerIdx: d.power, importIdx: d.imports, worldIdx: d.world, open: d.open, staff: d.staff, closures: d.closures, margin: d.margin, revenue: d.revenue, profit: d.profit }));
  }
  function eventsBetween(from, to) {
    if (!ready()) return [];
    advance(closedDays(to));
    return RUN.events.filter((e) => e.ms >= from && e.ms < to).map((e) => ({ id: e.id, time: e.time, source: e.source, type: e.type, importance: e.importance, data: e.data, headline: e.headline }));
  }
  /** Phase 2 hook for the Job Centre: is anyone trading at this premises at t, and how many staff do they keep? */
  function premisesAt(id, t) {
    if (!ready() || t < START + DAY) return { open: true, staff: null };
    const i = premisesIndex(id); if (i === undefined) return null;
    const R = register(), s = stateFor(closedDays(t));
    return { open: !!s.open[i], generation: s.gen[i], name: nameOf(R, i, s.gen[i]), staff: s.open[i] ? Math.round(R.prem[i].capacity * s.staff[i]) : 0 };
  }

  root.PixelUniverse = root.PixelUniverse || {};
  root.PixelUniverse.commerce = {
    version: VERSION, source: 'commerce', startDate: ymd(START), start: START, ready,
    stateAt, firmsAt, marketsAt, business, premisesAt, historyBetween, eventsBetween,
    districts: () => (ready() ? register().districts : []), KIND
  };
})(typeof window !== 'undefined' ? window : globalThis);
