/*
 * The Pixel Exchange: every business in Pixel City, trading.
 *
 * Commerce, phase 1. The city's 2,535 businesses (the Census Office's register: shops, offices, factories, warehouses
 * and the stevedores at the docks) each set their own prices, compete for customers, take on and shed staff, run up
 * debts and, now and then, fail. An empty premises stays empty for a while, then someone new opens there.
 *
 * Nothing here is scripted. Each trading day, demand comes from the city as it is: the weather, blackouts in each
 * district, the Senate's laws, ships at the port, Grand Prix days, the price of power, and orders for sprites from beyond the margin.
 * Demand flows down a supply chain (sprites need textures and codecs, textures need palettes, shops need distribution,
 * everyone needs offices), one day behind, so a shock in one place arrives somewhere else days or weeks later. Business
 * confidence follows profits, closures, blackouts and smog, and feeds back into what pixels spend.
 *
 * Tier: a reader. It reads City (map, power history, laws, port), the Weather Bureau and the Census Office's business
 * register (labour.employers(), which is fixed by the map). Phase 2: working lives (the Census Office's
 * careers, read by the Job Centre) follow it: a closure lays its staff off, and businesses hire as many as they want.
 *
 * Time: trading days run 00:00 to 00:00 UTC (noon to noon, city time). Results are posted at the close, when the new
 * edition of the Daily Pixel comes out. Records begin with the city, 3 December 2025.
 *
 * Load after Weather, Senate, City universe.js and City census.js. Seeds start "exchange:". Simulation maths uses only
 * + - * / Math.floor Math.imul (and comparisons). Registers window.PixelUniverse.commerce.
 */
(function (root) {
  'use strict';

  const VERSION = '1.11.0';
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
  // the register of businesses only: working lives depend on the Exchange, so asking for them here would go round in a circle
  const ready = () => ok(City()) && ok(Wx()) && !!(Lab() && Lab().registryReady && Lab().registryReady()) && !!U().society;

  // ---------------------------------------------------------------- what each kind of business is
  // Shares of the price of one unit (one worker-day of output) at normal prices: labour, power, inputs, rent.
  // The rest is margin. Labour and rent are paid whether or not anything sells; that is what makes a quiet month dangerous.
  const KIND = {
    palettes: { sector: 'factory', label: 'Palettes', labour: 0.32, power: 0.2, rent: 0.08, inputs: [['import', 0.22]] },
    textures: { sector: 'factory', label: 'Textures', labour: 0.32, power: 0.16, rent: 0.08, inputs: [['palettes', 0.26]] },
    codecs: { sector: 'factory', label: 'Codecs', labour: 0.3, power: 0.24, rent: 0.08, inputs: [['import', 0.2]] },
    sprites: { sector: 'factory', label: 'Sprites', labour: 0.3, power: 0.1, rent: 0.06, inputs: [['textures', 0.22], ['codecs', 0.16]] },
    haulage: { sector: 'warehouse', label: 'Packet haulage', labour: 0.48, power: 0.08, rent: 0.22, inputs: [] },
    cache: { sector: 'warehouse', label: 'Caching', labour: 0.48, power: 0.1, rent: 0.22, inputs: [] },
    distribution: { sector: 'warehouse', label: 'Data distribution', labour: 0.48, power: 0.08, rent: 0.22, inputs: [] },
    buffers: { sector: 'port', label: 'Export buffering', labour: 0.5, power: 0.06, rent: 0.2, inputs: [] },
    office: { sector: 'office', label: 'Office services', labour: 0.58, power: 0.05, rent: 0.2, inputs: [] },
    shop: { sector: 'shop', label: 'Shops', labour: 0.42, power: 0.05, rent: 0.1, inputs: [['distribution', 0.3]] }
  };
  // what the city makes: raw colour comes in by sea and is refined into palettes, palettes are cast into textures,
  // textures and codecs are rendered into sprites, and sprites are what Pixel City sells to the world
  const FACTORY = { 'Palette Refinery': 'palettes', 'Texture Foundry': 'textures', 'Compression Works': 'codecs', 'Render Plant': 'sprites' };
  const WAREHOUSE = { 'Packet Haulage': 'haulage', Cache: 'cache', 'Data Distribution': 'distribution' };
  // what pixels buy: a top-up of charge, fresh colours, a patch for a glitch, a little shading, the race feed, and staples
  const SHOPS = ['Refresh Pantry', 'Cache & Carry', 'Palette Shop', 'Charge Bar', 'Patch Shop', 'Shader Parlour', 'Signal Kiosk'];
  const OFFICES = ['Typesetting', 'Colour Consultants', 'Gradient Partners', 'Alignment Bureau', 'Refresh Services', 'Font Licensing', 'Calibration Services', 'Brightness Advisory'];
  // names for businesses that open later in an empty premises, in the same style as the Census Office's register
  const NAME_A = ['Halftone', 'Gridley', 'Kerning', 'Lumen', 'Raster', 'Gamut', 'Pica', 'Serif', 'Vector', 'Glyph', 'Phosphor', 'Contrast', 'Aperture', 'Prism', 'Bitwell', 'Dotson', 'Inkwell', 'Scanlon',
    'Bezelton', 'Luma', 'Chromwell', 'Pixley', 'Nibbs', 'Ditherby', 'Hexley', 'Moirette', 'Voxel', 'Sprite', 'Bitmap', 'Palette'];
  const SUFFIX_NEW = { palettes: 'Palette Refinery', textures: 'Texture Foundry', codecs: 'Compression Works', sprites: 'Render Plant', haulage: 'Packet Haulage', cache: 'Cache', distribution: 'Data Distribution', buffers: 'Buffer Handlers' };

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
      if (e.sector === 'factory') { sub = Object.keys(FACTORY).filter((s) => e.name.endsWith(s))[0] || 'Render Plant'; kind = FACTORY[sub]; mk = market('goods:' + kind, kind, KIND[kind].label, -1); }
      else if (e.sector === 'warehouse') { sub = Object.keys(WAREHOUSE).filter((s) => e.name.endsWith(s))[0] || 'Cache'; kind = WAREHOUSE[sub]; mk = market('trade:' + kind, kind, KIND[kind].label, -1); }
      else if (e.sector === 'port') { sub = 'Buffer Handlers'; kind = 'buffers'; mk = market('trade:buffers', kind, 'Export buffering', -1); }
      else if (e.sector === 'office') { sub = OFFICES.filter((s) => e.name.endsWith(s))[0] || 'Calibration Services'; kind = 'office'; mk = market('office:' + sub, kind, sub, -1); }
      else { sub = SHOPS.filter((s) => e.name.endsWith(s))[0] || 'Cache & Carry'; kind = 'shop'; mk = market('shop:' + sub + ':' + e.district, kind, sub, e.district); }
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
  function byDay(cache, k, fn) {
    if (!cache.has(k)) { cache.set(k, k < 0 ? [] : fn(dayStart(k), dayStart(k + 1))); if (cache.size > 60) cache.delete(cache.keys().next().value); }
    return cache.get(k);
  }
  function conditions(k) {
    const d0 = dayStart(k), C = City(), W = Wx();
    const wx = chunk(wxCache, k, (a, b) => { const out = {}; for (const d of W.historyBetween(a, b)) out[d.day] = d; return out; })[d0] || {};
    const wy = chunk(wxCache, k - 1, (a, b) => { const out = {}; for (const d of W.historyBetween(a, b)) out[d.day] = d; return out; })[d0 - DAY] || {};
    const ch = byDay(cityCache, k, (a, b) => C.historyBetween(a, b))[0] || null;
    // City's history and ships are read one day at a time and never ahead: the city's future depends on the Senate,
    // whose elections depend on Society, which depends on this day's close
    const shipsOn = (kk) => byDay(portCache, kk, (a, b) => C.portBetween(a, b - 1));
    const containers = shipsOn(k).filter((s) => s.type === 'container');
    const departing = [];
    for (let kk = k - 5; kk <= k; kk++) for (const s of shipsOn(kk)) if (s.type === 'container' && s.depart >= d0 && s.depart < d0 + DAY) departing.push(s);
    const ships = shipsOn(k);
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
    // glitches (City): how much of the day each district lost, and who is still patching up afterwards
    const gSupply = new Float64Array(16).fill(1), gDeliver = new Float64Array(16).fill(1), gPatch = new Float64Array(16).fill(1), gBleed = new Float64Array(16).fill(1);
    let leak = false;
    if (C.glitchesBetween) for (const g of C.glitchesBetween(d0 - 3 * DAY, d0 + DAY)) {
      const frac = clamp(((g.end < d0 + DAY ? g.end : d0 + DAY) - (g.start > d0 ? g.start : d0)) / DAY, 0, 1), d = g.district;
      if (g.end > d0 - 3 * DAY) gPatch[d] = 1.8; // a glitch, or its aftermath: everyone needs patching
      if (frac <= 0) continue;
      if (g.type === 'corruption') gSupply[d] *= 1 - frac * 0.15 * g.severity;
      else if (g.type === 'stuck') { gSupply[d] *= 1 - frac * 0.8; gDeliver[d] *= 1 - frac * 0.9; }
      else if (g.type === 'bleed') gBleed[d] = 1.3;
      else if (g.type === 'leak' && g.start >= d0 && g.start < d0 + DAY) leak = true;
    }
    return {
      glitch: { supply: gSupply, deliver: gDeliver, patch: gPatch, bleed: gBleed, leak },
      k, day: d0, date: ymd(d0), month, weekend: wd === 0 || wd === 6, gp: new Date(d0).getUTCDate() === 1,
      max: wx.max === undefined ? 18 : wx.max, rain: wx.rain || 0, gust: wx.gust || 0, sunshine: wx.sunshine === undefined ? 6 : wx.sunshine, storm: !!wx.storm || wx.cat === 'stormy',
      stormYesterday: !!wy.storm || wy.cat === 'stormy' || (wy.rain || 0) > 40,
      aqi: ch ? ch.aqi : 40, blackoutHours: ch ? ch.blackoutHours : 0, darkFrac, powerIdx, levels, cargo, held, portClosed: (wx.gust || 0) >= 88, containers, departing
    };
  }
  // how much a district's pixels want from each kind of shop, today
  function shopMood(sub, x, district) {
    let f = 1;
    const spring = x.month >= 8 && x.month <= 10, summer = x.month === 11 || x.month <= 1, winter = x.month >= 5 && x.month <= 7;
    // charge runs low on grey, cold days; new colours sell in spring; glitches need patching after a storm; shading is
    // a weekend treat; the race feed sells on Grand Prix day; staples sell whatever happens
    if (sub === 'Charge Bar') { if (x.sunshine < 3) f *= 1.16; if (x.max < 12) f *= 1.08; if (x.weekend) f *= 1.06; }
    else if (sub === 'Palette Shop') { f *= x.glitch.bleed[district]; f *= spring ? 1.22 : summer ? 1.08 : winter ? 0.74 : 0.95; f *= 0.9 + x.sunshine * 0.02; if (x.rain > 8) f *= 0.8; }
    else if (sub === 'Patch Shop') { if (x.stormYesterday) f *= 1.6; if (x.weekend) f *= 1.15; f *= x.glitch.patch[district]; }
    else if (sub === 'Signal Kiosk') { if (x.gp) f *= 1.6; }
    else if (sub === 'Shader Parlour') { if (x.weekend) f *= 1.18; if (x.sunshine > 8) f *= 1.06; }
    if (x.storm) f *= sub === 'Cache & Carry' ? 0.85 : 0.6;
    else if (x.rain > 10) f *= 0.88;
    if (x.gp && district === STADIUM_DISTRICT) f *= 1.35;
    f *= 1 - 0.85 * x.darkFrac[district];
    if (x.aqi > 100) f *= 1 - lo(0.18, (x.aqi - 100) / 600);
    f *= 1 - 0.05 * (x.levels['policy.trafficLimits'] || 0);
    // a craze for a kind of shop, spreading through the district's communities (Pixel City Society)
    const S = U().society; if (S && S.productBoost) f *= S.productBoost(district, sub, x.day);
    return f;
  }
  let STADIUM_DISTRICT = 9;
  // a district's shops sell to the pixels who still live there (Pixel City Society's migration, as of the day before)
  const popOf = (d, day) => { const S = U().society; return S && S.populationAt ? S.populationAt(d, day) : 1; };
  // From the December 2026 Grand Prix, a factory buys the inputs each unit needs whatever they cost: textures, codecs and
  // palettes answer to what is made from them, and barely to their own price. (Before then, as it was.)
  const CHAIN_START = Date.UTC(2026, 11, 1), CHAIN_ELASTIC = { textures: 0.2, codecs: 0.2, palettes: 0.2 };
  const ELASTIC = { shop: 1.2, office: 1, sprites: 0.8, textures: 0.7, codecs: 0.7, palettes: 0.7, haulage: 0.6, cache: 0.6, distribution: 0.6, buffers: 0.4 };

  // ---------------------------------------------------------------- the state of the market, day by day
  // Per business: the occupant now (generation), price, staff (share of the premises' capacity), cash, quality,
  // efficiency, appetite for a price war, reputation, the margin it has been making, days in loss, and what it sold.
  const FIELDS = ['want', 'lB', 'lG', 'lL', 'lF', 'cPow', 'cInp', 'cDem', 'cCom', 'cBla', 'cGli', 'cDel', 'cLaw', 'cInt', 'cRen', 'cStf', 'loan', 'sf', 'util', 'patience', 'price', 'staff', 'cash', 'q', 'eff', 'aggr', 'rep', 'margin', 'loss', 'sales', 'rev', 'profit', 'open', 'gen', 'since', 'reopen', 'credit', 'supply'];
  function blank(N) { const s = {}; for (const f of FIELDS) s[f] = new Float64Array(N); return s; }
  function clone(s) { const c = {}; for (const f of FIELDS) c[f] = s[f].slice(); for (const k of ['k', 'conf', 'importIdx', 'world', 'mkPrice', 'mkOut', 'mkUnmet', 'mkDemand', 'shopUnits', 'factoryUnits', 'revOther', 'closures7', 'cargoAvg', 'raw', 'dock', 'shelf', 'rounds', 'haulR', 'distR', 'bufR', 'fOn', 'exportShare', 'rentIdx', 'bOn', 'bRate', 'bCapital', 'bDeposits', 'bMort', 'bArr', 'bRisk', 'bApp', 'bIncome', 'bWO', 'bEmp0', 'bMort0']) c[k] = s[k] && s[k].slice ? s[k].slice() : s[k]; return c; }

  function newOccupant(s, R, i, k, gen, mkPrice) {
    const p = R.prem[i], r = seeded('firm:' + p.id + ':' + gen);
    s.gen[i] = gen; s.open[i] = 1; s.since[i] = k; s.reopen[i] = -1; s.loss[i] = 0; s.margin[i] = 0;
    s.q[i] = 0.85 + r() * 0.3; s.eff[i] = 0.86 + r() * 0.28; s.aggr[i] = r();
    s.price[i] = (mkPrice || p.P0) * (gen ? 0.88 + r() * 0.16 : 0.95 + r() * 0.13);
    s.staff[i] = gen ? 0.45 + r() * 0.2 : 0.7 + r() * 0.25;
    const fixed = p.capacity * (p.wage + KIND[p.kind].rent * p.P0 * p.rentK);
    s.cash[i] = fixed * (gen ? 18 + r() * 30 : 20 + r() * 45);
    s.credit[i] = fixed * (14 + r() * 26);
    s.rep[i] = gen ? 0.5 : 1; s.util[i] = 0.85; s.sf[i] = 1;
    s.patience[i] = 75 + Math.floor(r() * 150); // how many losing days an owner will stand
    return r;
  }
  function nameOf(R, i, gen) {
    const p = R.prem[i];
    if (!gen) return p.name0;
    const r = seeded('name:' + p.id + ':' + gen);
    if (p.kind === 'shop' || p.kind === 'office') return pick(r, NAME_A) + ' ' + p.sub;
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
    s.k = 0; s.conf = 1; s.cargoAvg = 2; s.rentIdx = new Float64Array(16).fill(1); s.fOn = 0; s.raw = 0; s.dock = 0; s.shelf = new Float64Array(16); s.haulR = 1; s.distR = 1; s.bufR = 1; s.exportShare = 0.6; s.importIdx = 1; s.world = 1;
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
    RUN.F = freightConstants(R); RUN.freightDays = []; RUN.ships = []; RUN.shipById = {};
  }

  const CAUSES = [['power', 'power got expensive'], ['supplies', 'its supplies got dearer'], ['customers', 'customers stopped buying'], ['rivals', 'rivals took its customers'],
    ['blackouts', 'blackouts stopped work'], ['glitches', 'glitches stopped work'], ['deliveries', 'deliveries failed'], ['senate', 'the Senate capped its output'], ['interest', 'the Bank\u2019s interest'], ['rent', 'the rent went up'], ['staff', 'employees left']];
  /** Why a business has been losing money lately: its top causes, each with its share. */
  function causesOf(s, i) {
    const v = [s.cPow[i], s.cInp[i], s.cDem[i], s.cCom[i], s.cBla[i], s.cGli[i], s.cDel[i], s.cLaw[i], s.cInt[i], s.cRen[i], s.cStf[i]];
    let tot = 0; for (const x of v) tot += x;
    if (tot <= 0) return [];
    return v.map((x, j) => ({ cause: CAUSES[j][0], label: CAUSES[j][1], share: Math.round(x / tot * 100) })).filter((c) => c.share >= 10).sort((a, b) => b.share - a.share).slice(0, 3);
  }
  function phaseSupply(s, x, lawCap) {
    const R = RUN.R, N = R.N;
    const { sf, util, patience, price, staff, cash, q, eff, aggr, rep, margin, loss, sales, rev, profit, open, gen, since, reopen, credit, loan, supply, mkPrice, mkOut, mkUnmet, mkDemand } = s;
    // each business's supply: staff, skill, the lights being on, the weather at the docks, the Senate's limits
    for (let i = 0; i < N; i++) {
      if (!open[i]) { supply[i] = 0; continue; }
      const p = R.prem[i];
      let sup = p.capacity * staff[i] * eff[i];
      const full = sup;
      if (p.kind !== 'shop') sup *= 1 - x.darkFrac[p.district];
      s.lB[i] = full - sup; // lost to blackouts
      if (p.kind === 'buffers' && x.portClosed) sup *= 0.15;
      const beforeLaw = sup;
      if (KIND[p.kind].sector === 'factory') sup *= p.kind === 'palettes' || p.kind === 'codecs' ? lawCap - 0.04 * (x.levels['policy.emissionsCap'] || 0) : lawCap;
      s.lL[i] = beforeLaw - sup; // lost to the Senate's caps
      s.lG[i] = sup * (1 - x.glitch.supply[p.district]); // lost to glitches
      sf[i] = sf[i] * 0.9 + 0.1 * (sup / (p.capacity * staff[i] * eff[i])); // how much of a full day's work the law, the weather and the lights allow
      supply[i] = sup * x.glitch.supply[p.district];
    }

  }
  function phaseClear(s) {
    const R = RUN.R, N = R.N;
    const { sf, util, patience, price, staff, cash, q, eff, aggr, rep, margin, loss, sales, rev, profit, open, gen, since, reopen, credit, loan, supply, mkPrice, mkOut, mkUnmet, mkDemand } = s;
    // the market clears: customers go where quality is high and prices low, then spill over to whoever has room
    const a = new Float64Array(N);
    let shopUnits = 0, factoryUnits = 0, revOther = 0;
    for (const mk of R.markets) {
      const F = mk.firms;
      let A = 0;
      for (const i of F) if (open[i]) { a[i] = q[i] * rep[i] / (price[i] * price[i] / (mk.P0 * mk.P0)); A += a[i]; } else a[i] = 0;
      const D = mkDemand[mk.i];
      let left = 0;
      for (const i of F) { if (!open[i]) { sales[i] = 0; continue; } const want = A > 0 ? D * a[i] / A : 0; s.want[i] = want; sales[i] = lo(want, supply[i]); left += want - sales[i]; }
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
    const { sf, util, patience, price, staff, cash, q, eff, aggr, rep, margin, loss, sales, rev, profit, open, gen, since, reopen, credit, loan, supply, mkPrice, mkOut, mkUnmet, mkDemand } = s;
    // the books, and each business's decisions for tomorrow
    const goodsPrice = (kind) => kind === 'import' ? s.importIdx : mkPrice[R.goodsMk[kind]] / R.markets[R.goodsMk[kind]].P0;
    const inputCost = {}; // what one unit's inputs cost today, by kind of business (the same for every business of a kind)
    for (const kind in KIND) { let c = 0; for (const [g, share] of KIND[kind].inputs) c += share * goodsPrice(g); inputCost[kind] = c; }
    let closures = 0, profitSum = 0, revSum = 0;
    // From the December 2026 Grand Prix, would-be owners look at the books as well as the customers: while the
    // businesses already in a market are losing money on average, nobody opens another one there for another month
    const choosy = dayStart(k) >= CHAIN_START, mkMargin = new Float64Array(R.markets.length), mkN = new Float64Array(R.markets.length);
    if (choosy) for (let j = 0; j < N; j++) if (open[j]) { mkMargin[R.prem[j].market] += margin[j]; mkN[R.prem[j].market]++; }
    for (let i = 0; i < N; i++) {
      const p = R.prem[i], K = KIND[p.kind];
      if (!open[i]) {
        if (choosy && reopen[i] >= 0 && k >= reopen[i] && mkN[p.market] && mkMargin[p.market] / mkN[p.market] < 0) { reopen[i] = k + 30; continue; }
        if (reopen[i] >= 0 && k >= reopen[i]) { // someone new takes the empty premises
          const g2 = gen[i] + 1;
          newOccupant(s, R, i, k, g2, mkPrice[p.market]);
          if (s.bOn) { loan[i] = cash[i] * 0.8; s.bLent = (s.bLent || 0) + loan[i]; } // the Bank lends most of the start-up money
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
      const rent = K.rent * p.P0 * p.capacity * p.rentK * s.rentIdx[p.district];
      const interestI = s.bOn ? bankInterest(s, i, p, K) : 0; // what the Bank charges on the overdraft and any loan
      const profitI = revI - labour - power - rent - unitInputs * sold - interestI;
      rev[i] = revI; profit[i] = profitI; cash[i] += profitI;
      { // what this business lost money to today, and why (a month's memory): explanation only, it changes nothing
        const P = price[i], normalRev = p.capacity * 0.78 * p.P0, D = mkDemand[p.market], base = R.markets[p.market].base;
        let nOpen = 0; for (const j of R.markets[p.market].firms) if (open[j]) nOpen++;
        const short = s.want[i] > sold ? (s.want[i] - sold) * P : 0, lossU = s.lB[i] + s.lG[i] + s.lL[i] + s.lF[i];
        const part = (u) => (lossU > 0 ? short * u / lossU : 0);
        let inShare = 0; for (const pr of K.inputs) inShare += pr[1];
        const today = [K.power * p.P0 * hi(0, x.powerIdx - 1) * (0.3 * p.capacity * staff[i] + 0.7 * sold), hi(0, unitInputs - p.P0 * inShare) * sold,
          hi(0, 1 - D / base) * normalRev * 0.6, hi(0, mkOut[p.market] / hi(1, nOpen) - sold) * P * 0.5, part(s.lB[i]), part(s.lG[i]), part(s.lF[i]), part(s.lL[i]), interestI, hi(0, s.rentIdx[p.district] - 1) * K.rent * p.P0 * p.capacity * p.rentK];
        const F2 = [s.cPow, s.cInp, s.cDem, s.cCom, s.cBla, s.cGli, s.cDel, s.cLaw, s.cInt, s.cRen];
        for (let j = 0; j < 10; j++) F2[j][i] += (today[j] - F2[j][i]) / 30;
      }
      margin[i] = margin[i] * 0.93 + (revI > 0 ? profitI / revI : -1) * 0.07;
      loss[i] = profitI < -0.05 * revI ? loss[i] + 1 : hi(0, loss[i] - 2); // thin losses are tolerated; it's the bad days that count
      profitSum += profitI; revSum += revI;
      // price: up when sold out and others are short, down when goods sit unsold; never far below cost for long
      const ri = r();
      // each business aims for its costs at a normal day's trade plus its own markup (the bold ones take less, to win
      // customers), then leans on that: up when sold out with customers turned away, down when goods sit unsold
      const normalCost = p.wage / (eff[i] * hi(0.3, sf[i])) + K.power * p.P0 * x.powerIdx + unitInputs + K.rent * p.P0 * p.rentK * s.rentIdx[p.district] / eff[i];
      // when customers are being turned away, everyone can charge more: the scarcer, the dearer
      const scarce = u > 0.85 ? lo(0.6, mkUnmet[p.market] * (1.2 - 0.6 * aggr[i])) : 0;
      price[i] += (normalCost * (1.06 + 0.16 * (1 - aggr[i])) * (1 + scarce) - price[i]) * 0.04;
      if (u < 0.7) price[i] *= 1 - (0.002 + 0.008 * aggr[i]) * (0.7 - u) / 0.7 * 3;
      price[i] *= 1 + (ri - 0.5) * 0.004;
      price[i] = clamp(price[i], hi(normalCost * (0.82 - 0.12 * aggr[i]), p.P0 * 0.5), p.P0 * 2.6); // a slump can't be priced away
      // staff: take people on when sold out and making money; let them go when quiet or short of cash
      if (u > 0.93 && margin[i] > 0.02 && cash[i] > 0) staff[i] = lo(1, staff[i] + 0.02 + 0.02 * r());
      else if (u < 0.6 || (cash[i] < -0.5 * credit[i] && u < 0.85)) staff[i] = hi(margin[i] < -0.1 ? 0.15 : 0.3, staff[i] - 0.015 - 0.015 * r());
      // quality follows money: good years pay for improvements, bad ones wear things down
      q[i] = clamp(q[i] + (margin[i] > 0.08 ? 0.0004 : margin[i] < -0.05 ? -0.0004 : 0), 0.7, 1.35);
      if (rep[i] < 1) rep[i] = lo(1, rep[i] + 0.008);
      // failure: past the bank's patience, or a year of losses
      if (s.bOn) { // repay a little of any loan each day, and the Bank sets today's limit from the firm's record
        if (loan[i] > 0) { const pay = loan[i] / 1095; loan[i] -= pay; cash[i] -= pay; }
        credit[i] = bankLimit(s, i, p, K, k);
      }
      if (cash[i] < -credit[i] || loss[i] > patience[i]) {
        open[i] = 0; closures++;
        // nobody rushes to open in a market that's going nowhere: the weaker demand is, the longer premises stay empty
        const health = mkDemand[p.market] / R.markets[p.market].base;
        reopen[i] = k + 14 + Math.floor(r() * (30 + 240 * clamp(1.15 - health, 0, 0.8)) * (s.bOn ? 1 + 1.5 * clamp(1 - s.bApp, 0, 0.85) : 1) * s.rentIdx[p.district]); // cheap premises find takers sooner // no loan, no opening
        if (s.bOn) bankWriteOff(s, i, p, k, record);
        if (record) {
          const occ = RUN.occupants[i][RUN.occupants[i].length - 1];
          occ.to = k; occ.reason = cash[i] < -credit[i] ? 'ran out of credit' : 'months of losses'; occ.causes = causesOf(s, i);
          const months = Math.floor((k - since[i]) / 30.44), jobs = Math.round(workers);
          const age = gen[i] === 0 && k - since[i] < 400 ? 'after trading since the city began' : months < 1 ? 'within a month of opening' : months < 12 ? 'after ' + months + ' month' + (months === 1 ? '' : 's') : 'after ' + Math.floor(months / 12) + ' year' + (months < 24 ? '' : 's');
          emit('business.closed', jobs >= 25 ? 3 : 2, 'close:' + p.id + ':' + gen[i], { premises: p.id, name: occ.name, district: dn(p.district), sector: p.sector, jobs, reason: occ.reason, causes: occ.causes },
            occ.name + ' in ' + dn(p.district) + ' closes ' + age + ', with ' + (jobs === 1 ? 'one job' : jobs + ' jobs') + ' lost', 3 + (i % 50));
        }
      }
    }

    return { closures, profitSum, revSum };
  }

  function phaseRecord(s, x, k, emit, dn, at, closures, profitSum, revSum, cityMargin) {
    const R = RUN.R, N = R.N;
    const { sf, util, patience, price, staff, cash, q, eff, aggr, rep, margin, loss, sales, rev, profit, open, gen, since, reopen, credit, loan, supply, mkPrice, mkOut, mkUnmet, mkDemand } = s;
    {
      // shortages and price wars, noticed by the Exchange's reporters (each market at most once a month)
      for (const mk of R.markets) {
        const ck = RUN.cool[mk.i] || -999;
        if (k - ck < 30) continue;
        const name = mk.kind === 'shop' ? mk.sub.toLowerCase() : mk.label.toLowerCase();
        const past3 = RUN.days[k - 2], past2 = RUN.days[k - 1];
        if (mk.kind !== 'shop' && mk.kind !== 'office' && mkUnmet[mk.i] > 0.12 && past3 && past3.unmet[mk.i] > 0.12 && past2.unmet[mk.i] > 0.12) {
          const past = RUN.days[k - 7];
          const was = past && past.prices[mk.i], change = was ? (mkPrice[mk.i] / was - 1) * 100 : 0;
          RUN.cool[mk.i] = k;
          const why = [0, 0, 0, 0]; for (const i of mk.firms) { why[0] += s.lB[i]; why[1] += s.lG[i]; why[2] += s.lF[i]; why[3] += s.lL[i]; }
          const wt = why[0] + why[1] + why[2] + why[3], wl = ['blackouts', 'glitches', 'deliveries', 'senate'], wlab = ['blackouts stopped work', 'glitches stopped work', 'raw materials ran short', 'the Senate capped output'];
          const causes = wt > 0 ? why.map((v, j) => ({ cause: wl[j], label: wlab[j], share: Math.round(v / wt * 100) })).filter((c) => c.share >= 10).sort((a, b) => b.share - a.share) : [{ cause: 'demand', label: 'demand outgrew the trade', share: 100 }];
          emit('market.shortage', 3, 'short:' + mk.key + ':' + ymd(dayStart(k)), { market: mk.label, unmet: rd(mkUnmet[mk.i] * 100, 1), price: rd(change, 10), causes },
            'A shortage of ' + name + ' leaves ' + Math.round(mkUnmet[mk.i] * 100) + '% of orders unfilled' + (change > 1 ? ', and prices are up ' + Math.round(change) + '% in a week' : ''), 2);
        } else if (mk.kind === 'shop' && mk.firms.length >= 3 && k >= 21) {
          const past = RUN.days[k - 21];
          if (past && mk.firms.length >= 4 && mkDemand[mk.i] > past.demand[mk.i] * 0.92 && mkPrice[mk.i] < past.prices[mk.i] * 0.86 && k - (RUN.cool['w' + mk.i] || -999) > 180 && k - (RUN.cool.war || -999) > 7) {
            RUN.cool.war = k;
            RUN.cool['w' + mk.i] = k;
            RUN.cool[mk.i] = k;
            const plural = { 'Refresh Pantry': 'refresh pantries', 'Cache & Carry': 'cache-and-carries', 'Palette Shop': 'palette shops', 'Charge Bar': 'charge bars', 'Patch Shop': 'patch shops', 'Shader Parlour': 'shader parlours', 'Signal Kiosk': 'signal kiosks' }[mk.sub] || 'shops';
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
      const staffD = new Float32Array(16), rentD = Float32Array.from(s.rentIdx);
      for (let i = 0; i < N; i++) if (open[i]) { nOpen++; nStaff += R.prem[i].capacity * staff[i]; staffD[R.prem[i].district] += R.prem[i].capacity * staff[i]; }
      // a consumer price index: what a district's shopping basket costs, against the first day (100)
      let basket = 0, basket0 = 0;
      for (const mk of R.markets) if (mk.kind === 'shop') { basket += mk.base * mkPrice[mk.i]; basket0 += mk.base * mk.P0; }
      RUN.days.push({ k, day: dayStart(k), date: x.date, conf: rd(s.conf * 100, 10), cpi: rd(basket / basket0 * 100, 10), power: rd(x.powerIdx * 100, 1), imports: rd(s.importIdx * 100, 1), world: rd(s.world * 100, 1),
        open: nOpen, staff: Math.round(nStaff), staffD, rentD, closures, margin: rd(cityMargin * 100, 10), revenue: Math.round(revSum), profit: Math.round(profitSum),
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

  // ================================================================ freight: goods that have to get somewhere
  // From the December Grand Prix, goods are physical. Raw colour arrives in container ships, in proportion to their
  // cargo, and waits in the cache at the export dock until packet haulage takes it to the refineries and compression
  // works. Sprites sold beyond the margin wait at the export dock until a container ship sails with them, loaded by the
  // buffer handlers. Every district's shops sell from shelves that data distribution keeps stocked, round by round.
  // Storms, blackouts, Grand Prix crowds on the buses and the Senate's traffic limits all slow the rounds; a shortage
  // of haulage or distribution firms slows everything downstream.
  const FREIGHT_START = Date.UTC(2026, 11, 1); // the December Grand Prix
  function freightConstants(R) {
    const C = City(), F = { shopNeed: new Float64Array(16) };
    for (const mk of R.markets) if (mk.kind === 'shop') F.shopNeed[mk.district] += mk.base;
    const base = (kind) => R.markets[R.goodsMk[kind]].base;
    F.rawNeed = base('palettes') + base('codecs'); // one unit of raw colour per unit refined or compressed
    F.exportNormal = 0.6 * base('sprites');
    // what an ordinary year of container ships carries, to size a TEU of cargo, with a quarter to spare each way so
    // that only storms and held ships, not ordinary days, leave the city short
    let teu = 0; for (const sh of C.portBetween(START, START + 365 * DAY)) if (sh.type === 'container') teu += sh.cargo;
    F.teuPerDay = teu / 365;
    F.rawPerTEU = F.rawNeed / F.teuPerDay * 1.25;
    F.exportPerTEU = F.exportNormal / F.teuPerDay * 1.25;
    F.rawCap = 16 * F.rawNeed; F.dockCap = 14 * F.exportNormal;
    return F;
  }
  function freightBegin(s) {
    const F = RUN.F;
    s.fOn = 1; s.raw = 16 * F.rawNeed; s.dock = 0.5 * F.exportNormal; // the raw store opens about as full as it settles, the export dock nearly clear
    s.rounds = new Float64Array(16).fill(1.15); // each district's delivery rounds: room for 15% more than a normal day
    const sh = new Float64Array(16); for (let d = 0; d < 16; d++) sh[d] = 2 * F.shopNeed[d]; s.shelf = sh;
  }
  // what can be made and sold today, given what is in stock
  function freightLimits(s) {
    const R = RUN.R, F = RUN.F, { supply } = s;
    const rawF = clamp(s.raw / (2 * F.rawNeed), 0, 1) * lo(1, s.haulR + 0.15); // refineries ration below two days' raw colour
    const shelfF = new Float64Array(16);
    for (let d = 0; d < 16; d++) shelfF[d] = F.shopNeed[d] > 0 ? clamp(s.shelf[d] / (1.5 * F.shopNeed[d]), 0, 1) : 1;
    for (let i = 0; i < R.N; i++) {
      const p = R.prem[i], before = supply[i];
      if (p.kind === 'palettes' || p.kind === 'codecs') supply[i] *= rawF;
      else if (p.kind === 'shop') supply[i] *= shelfF[p.district];
      s.lF[i] = before - supply[i]; // lost to deliveries that didn't come
    }
  }
  const disruption = (x, d) => x.glitch.deliver[d] * (x.storm ? 0.2 : x.rain > 25 ? 0.7 : 1) * (1 - x.darkFrac[d]) * (x.gp ? (d === STADIUM_DISTRICT ? 0.5 : 0.9) : 1) * (1 - 0.06 * (x.levels['policy.trafficLimits'] || 0));
  function freightMove(s, x, k, record) {
    const R = RUN.R, F = RUN.F, { mkOut, mkDemand } = s, g = R.goodsMk;
    const ratio = (kind) => (mkDemand[g[kind]] > 0 ? clamp(mkOut[g[kind]] / mkDemand[g[kind]], 0, 1.1) : 1);
    // raw colour: used up by the refineries and compression works, landed by container ships
    s.raw = hi(0, s.raw - mkOut[g.palettes] - mkOut[g.codecs]);
    if (x.glitch.leak) s.raw *= 0.7; // a memory leak eats into the store
    const landed = [];
    for (const sh of x.containers) { const amt = lo(sh.cargo * F.rawPerTEU, hi(0, F.rawCap - s.raw)); s.raw += amt; landed.push([sh, amt]); }
    // sprites for beyond the margin go to the dock; ships sail with as much as the buffer handlers can load
    s.dock += mkOut[g.sprites] * s.exportShare;
    const loaded = [];
    // the buffer handlers only hold ships up when they fall well short (as haulage does for the refineries); before
    // the December 2026 Grand Prix's freight began this rule did not exist
    const bufF = clamp(s.bufR + 0.15, 0.3, 1);
    for (const sh of x.departing) { const amt = lo(s.dock, sh.cargo * F.exportPerTEU * bufF); s.dock -= amt; loaded.push([sh, amt]); }
    // the shops' shelves: sold from, then restocked on the day's rounds, as far as the rounds can reach
    const sold = new Float64Array(16), deliv = new Float64Array(16), want = new Float64Array(16);
    for (const mk of R.markets) if (mk.kind === 'shop') sold[mk.district] += mkOut[mk.i];
    const sh2 = s.shelf.slice();
    for (let d = 0; d < 16; d++) {
      sh2[d] = hi(0, sh2[d] - sold[d]);
      want[d] = hi(0, 2 * F.shopNeed[d] - sh2[d]); // shops keep about two days on the shelves
      deliv[d] = lo(want[d], s.rounds[d] * F.shopNeed[d] * clamp(s.distR, 0, 1.1) * disruption(x, d));
      sh2[d] += deliv[d];
      // the distributors adapt: when a district's shelves keep running low they add rounds (night runs, bigger vans),
      // a little each day, and let them go once the shelves are full again
      if (sh2[d] < 1.5 * F.shopNeed[d]) s.rounds[d] = lo(1.7, s.rounds[d] + 0.004);
      else if (sh2[d] >= 1.95 * F.shopNeed[d]) s.rounds[d] = hi(1.15, s.rounds[d] - 0.001);
    }
    s.shelf = sh2;
    s.haulR = ratio('haulage'); s.distR = ratio('distribution'); s.bufR = ratio('buffers');
    if (!record) return;
    // the shipping register
    for (const [sh, amt] of landed) { const e = { id: sh.id, name: sh.name, from: sh.from, arrive: sh.arrive, depart: sh.depart, teu: sh.cargo, held: sh.held, raw: Math.round(amt), loaded: null }; RUN.ships.push(e); RUN.shipById[sh.id] = e; }
    for (const [sh, amt] of loaded) { const e = RUN.shipById[sh.id]; if (e) e.loaded = Math.round(amt); }
    const dn = (d) => R.districts[d], at = dayStart(k) + DAY;
    const emitF = (type, importance, idPart, data, headline, sec) => RUN.events.push({ id: 'freight:' + idPart, time: iso(at + sec * 1000), ms: at + sec * 1000, source: 'freight', type, importance, data, headline });
    const cool = RUN.cool, rawDays = s.raw / F.rawNeed, dockFill = s.dock / F.dockCap;
    if (rawDays < 3 && k - (cool.raw || -999) > 30) {
      cool.raw = k;
      emitF('freight.rawlow', 3, 'rawlow:' + ymd(dayStart(k)), { days: rd(rawDays, 10), held: x.held }, 'Raw colour at the export dock is down to ' + (rawDays < 2 ? 'a day\u2019s' : Math.floor(rawDays) + ' days\u2019') + ' supply' + (x.held ? ', with ships held outside the harbour' : '') + '; the Palette Refineries and Compression Works are rationing', 4);
    }
    if (dockFill > 0.9 && k - (cool.dock || -999) > 30) {
      cool.dock = k;
      emitF('freight.dockfull', 3, 'dockfull:' + ymd(dayStart(k)), { fill: rd(dockFill * 100, 1) }, 'The export dock is full: sprites are waiting for ships, and the Render Plants are turning away orders from beyond the margin', 5);
    }
    // shelves running low: one report a day, naming every district affected
    const low = [];
    for (let d = 0; d < 16; d++) {
      const days = F.shopNeed[d] > 0 ? s.shelf[d] / F.shopNeed[d] : 3;
      if (days < 0.8 && k - (cool['sh' + d] || -999) > 25) { cool['sh' + d] = k; low.push([d, days]); }
    }
    if (low.length) {
      const d0 = low[0][0], worst = Math.min(...low.map((l) => l[1]));
      const why = x.storm ? ' since the storm' : low.some((l) => x.darkFrac[l[0]] > 0.2) ? ' through the blackout' : x.gp && low.some((l) => l[0] === STADIUM_DISTRICT) ? ' with Grand Prix crowds on the buses' : s.distR < 0.9 ? ', with too few data distributors left to make the rounds' : (x.levels['policy.trafficLimits'] || 0) ? ' under the Senate\u2019s traffic limits' : '';
      const names = low.map((l) => dn(l[0])), list = names.length <= 2 ? names.join(' and ') : names.length > 5 ? names.length + ' districts' : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
      emitF('freight.shelves', worst < 0.4 || low.length > 5 ? 3 : 2, 'shelves:' + ymd(dayStart(k)) + ':' + d0, { districts: names, days: rd(worst, 10) }, 'Shelves are emptying in ' + list + ': deliveries have fallen behind' + why, 6);
    }
    for (const [sh] of landed) if (sh.held >= 24 * H) emitF('freight.arrival', rawDays < 4 ? 2 : 1, 'late:' + sh.id, { ship: sh.name, hours: Math.floor(sh.held / H), teu: sh.cargo }, 'The ' + sh.name + ' berths at last after ' + Math.floor(sh.held / H) + ' hours held outside the harbour, with ' + sh.cargo + ' TEU of raw colour', 7);
    let minShelf = 99, sumShelf = 0, delivered = 0, wanted = 0;
    for (let d = 0; d < 16; d++) { const v = F.shopNeed[d] > 0 ? s.shelf[d] / F.shopNeed[d] : 3; if (v < minShelf) minShelf = v; sumShelf += v; delivered += deliv[d]; wanted += want[d]; }
    RUN.freightDays.push({ k, day: dayStart(k), date: ymd(dayStart(k)), rawDays: rd(rawDays, 10), dockDays: rd(s.dock / F.exportNormal, 10), dockFill: rd(dockFill * 100, 1), shelves: Array.from(s.shelf, (v, d) => rd(F.shopNeed[d] > 0 ? v / F.shopNeed[d] : 3, 10)),
      minShelf: rd(minShelf, 10), avgShelf: rd(sumShelf / 16, 10), deliveries: wanted > 0 ? rd(delivered / wanted * 100, 1) : 100, haulage: rd(s.haulR * 100, 1), distribution: rd(s.distR * 100, 1), buffers: rd(s.bufR * 100, 1), landed: landed.length, sailed: loaded.length });
  }

  // ================================================================ the Bank of Pixel City
  // Opens on 1 February 2027 and takes over the city's credit. Its rate is set on the 1st of each month from the
  // shopping basket and business confidence. Businesses borrow on overdraft up to a limit the Bank sets from their record
  // and its own appetite, and new businesses borrow most of their start-up money. Households borrow to buy homes, district
  // by district. When borrowers fail, the Bank writes off what it can't recover; its capital shrinks, it marks the
  // borrower's sector as riskier, and it lends less to everyone, which can push the next firm over. A dear rate cools
  // spending in the shops. Before the Bank opens, businesses keep the simple credit lines they always had.
  const BANK_OPENS = Date.UTC(2027, 1, 1);
  const SECTORS = ['shop', 'office', 'factory', 'warehouse', 'port'];
  const fixedOf = (p, K) => p.capacity * (p.wage + K.rent * p.P0 * p.rentK);
  function districtStaff(s) { const R = RUN.R, out = new Float64Array(16); for (let i = 0; i < R.N; i++) if (s.open[i]) out[R.prem[i].district] += R.prem[i].capacity * s.staff[i]; return out; }
  function bankBegin(s, k, record) {
    const R = RUN.R, C = City(), m = C.map(Date.UTC(2026, 10, 2));
    s.bOn = 1; s.bRate = 0.04; s.bApp = 1; s.bRisk = new Float64Array(5); s.bEmp0 = districtStaff(s);
    s.bMort0 = new Float64Array(16); for (let d = 0; d < 16; d++) s.bMort0[d] = (m.districts[d] ? m.districts[d].residents : 0) * 2600;
    s.bMort = s.bMort0.slice(); s.bArr = new Float64Array(16).fill(0.012);
    let book = 0; for (let d = 0; d < 16; d++) book += s.bMort[d];
    for (let i = 0; i < R.N; i++) if (s.open[i] && s.cash[i] < 0) book -= s.cash[i];
    s.bCapital = book * 0.14; s.bDeposits = book * 1.05; s.bIncome = 0; s.bWO = 0;
    if (record) RUN.events.push({ id: 'bank:opened', time: iso(BANK_OPENS + 30 * 1000), ms: BANK_OPENS + 30 * 1000, source: 'bank', type: 'bank.opened', importance: 4, data: { rate: 4 },
      headline: 'The Bank of Pixel City opens its doors, lending at 4%' });
  }
  const scoreOf = (s, i, k) => clamp(0.45 + s.margin[i] * 3 + lo(1, (k - s.since[i]) / 365) * 0.25 + (s.q[i] - 1), 0, 1);
  function bankLimit(s, i, p, K, k) { return fixedOf(p, K) * (20 + 28 * scoreOf(s, i, k)) * (0.5 + 0.5 * s.bApp) * (1 - 0.4 * s.bRisk[SECTORS.indexOf(p.sector)]); }
  function bankInterest(s, i, p, K) {
    const k = s.k_ || 0, od = s.cash[i] < 0 ? -s.cash[i] : 0;
    const v = (od * (s.bRate + 0.02 + 0.02 * (1 - scoreOf(s, i, k))) + s.loan[i] * (s.bRate + 0.025)) / 365;
    s.bIncome += v; return v;
  }
  function bankWriteOff(s, i, p, k, record) {
    const wo = (s.cash[i] < 0 ? -s.cash[i] : 0) + s.loan[i] * 0.6; // a closed business's fittings cover a little of its loan
    s.loan[i] = 0; s.bWO += wo; s.bCapital -= wo;
    const sec = SECTORS.indexOf(p.sector);
    s.bRisk[sec] = lo(0.6, s.bRisk[sec] + wo / hi(1, s.bCapital) * 1.2); // the Bank grows wary of the whole trade
    if (record && wo > 60000) RUN.events.push({ id: 'bank:default:' + p.id + ':' + s.gen[i], time: iso(dayStart(k) + DAY + 20000), ms: dayStart(k) + DAY + 20000, source: 'bank', type: 'bank.default', importance: wo > 250000 ? 3 : 2,
      data: { premises: p.id, name: nameOf(RUN.R, i, s.gen[i]), sector: p.sector, writtenOff: Math.round(wo), causes: causesOf(s, i) }, headline: 'The Bank of Pixel City writes off ' + Math.round(wo / 1000) + ',000 W lent to ' + nameOf(RUN.R, i, s.gen[i]) });
  }
  function bankRate(s, k, record) {
    const d = RUN.days, now = d[k - 1], then = d[k - 91] || d[0];
    if (!now) return;
    const infl = (now.cpi / then.cpi - 1) * 4, conf = now.conf / 100; // inflation over the last quarter, as a yearly rate
    const target = clamp(0.035 + 0.8 * (infl - 0.02) - 1.0 * (1 - conf), 0.005, 0.12); // prices against a nervous city
    const step = clamp(target - s.bRate, -0.005, 0.005), old = s.bRate;
    s.bRate = Math.floor((s.bRate + step) * 400 + 0.5) / 400; // quarter-point steps
    if (!record) return;
    const pct = (r) => (r * 100).toFixed(2).replace(/0$/, '').replace(/\.0$/, '') + '%';
    const head = s.bRate > old ? 'raises its rate to ' + pct(s.bRate) : s.bRate < old ? 'cuts its rate to ' + pct(s.bRate) : 'holds its rate at ' + pct(s.bRate);
    const why = s.bRate > old ? ', as prices in the shops rise' : s.bRate < old ? (conf < 0.95 ? ', to lift a nervous city' : ', as prices settle') : '';
    RUN.events.push({ id: 'bank:rate:' + ymd(dayStart(k)), time: iso(dayStart(k) + 21 * H), ms: dayStart(k) + 21 * H, source: 'bank', type: 'bank.rate', importance: s.bRate !== old ? 3 : 1,
      data: { rate: rd(s.bRate * 100, 100), was: rd(old * 100, 100), inflation: rd(infl * 100, 10) }, headline: 'The Bank of Pixel City ' + head + why });
  }
  const MORTGAGE_DAYS = (25 * 365.25) / 12; // 25 Pixel Years, in days
  function bankDay(s, x, k, record) {
    const R = RUN.R, emp = districtStaff(s);
    let mort = 0, newLoans = 0, wo = 0, arrearsW = 0;
    const m2 = s.bMort.slice(), a2 = s.bArr.slice();
    const conf = s.conf;
    for (let d = 0; d < 16; d++) {
      const er = s.bEmp0[d] > 0 ? emp[d] / s.bEmp0[d] : 1;
      const demand = clamp(conf * er * (1 - 6 * (s.bRate - 0.04)) * s.bApp, 0.15, 1.8);
      // home loans run 25 Pixel Years (about 761 days): the census's mortgages are measured on the life clock
      const lend = s.bMort0[d] / MORTGAGE_DAYS * 1.15 * demand, repay = m2[d] / MORTGAGE_DAYS;
      a2[d] += (0.01 + 0.25 * hi(0, 1 - er) + hi(0, s.bRate - 0.05) - a2[d]) / 30; // arrears follow lost jobs and a dear rate
      const def = m2[d] * a2[d] * 0.0008, loss = def * 0.35; // the home is sold; the Bank recovers most of it
      m2[d] += lend - repay - def; newLoans += lend; wo += loss; mort += m2[d]; arrearsW += m2[d] * a2[d];
      s.bIncome += m2[d] * (s.bRate + 0.018) / 365;
    }
    s.bMort = m2; s.bArr = a2; s.bWO += wo; s.bCapital -= wo;
    let od = 0, startup = 0, wages = 0;
    for (let i = 0; i < R.N; i++) { if (s.open[i] && s.cash[i] < 0) od -= s.cash[i]; startup += s.loan[i]; if (s.open[i]) wages += R.prem[i].capacity * s.staff[i] * R.prem[i].wage; }
    const book = mort + od + startup;
    s.bDeposits += wages * 0.02 * (1.2 - conf) - s.bDeposits * 0.0004; // pixels save more when they're nervous
    const cost = s.bDeposits * hi(0, s.bRate - 0.015) / 365 + book * 0.008 / 365;
    s.bCapital += s.bIncome - cost;
    const ratio = s.bCapital / hi(1, book);
    for (let j = 0; j < 5; j++) s.bRisk[j] *= 0.996; // memories of bad debts fade
    const was = s.bApp;
    s.bApp = clamp((ratio - 0.05) / 0.06, 0.15, 1.2) * (0.75 + 0.25 * clamp(conf, 0.8, 1.15));
    if (!record) return;
    const at = dayStart(k) + DAY + 25000;
    const ev = (type, imp, key, data, headline) => RUN.events.push({ id: 'bank:' + key + ':' + ymd(dayStart(k)), time: iso(at), ms: at, source: 'bank', type, importance: imp, data, headline });
    if (s.bApp < 0.6 && was >= 0.6 && k - (RUN.cool.squeeze || -999) > 45) { RUN.cool.squeeze = k; ev('bank.squeeze', 3, 'squeeze', { capitalRatio: rd(ratio * 100, 10) }, 'The Bank of Pixel City tightens lending after its losses: overdraft limits are cut across the city'); }
    if (s.bApp > 0.9 && was <= 0.9 && RUN.cool.squeeze && k - (RUN.cool.ease || -999) > 45) { RUN.cool.ease = k; ev('bank.eases', 2, 'ease', { capitalRatio: rd(ratio * 100, 10) }, 'The Bank of Pixel City is lending freely again'); }
    if (ratio < 0.06 && k - (RUN.cool.capital || -999) > 60) { RUN.cool.capital = k; ev('bank.capital', 4, 'capital', { capitalRatio: rd(ratio * 100, 10) }, 'The Bank of Pixel City\u2019s capital falls to ' + (ratio * 100).toFixed(1) + '% of its lending, and it stops lending to anyone it can avoid'); }
    const arrears = arrearsW / hi(1, mort);
    if (arrears > 0.04 && k - (RUN.cool.arrears || -999) > 60) { RUN.cool.arrears = k; let worst = 0; for (let d = 1; d < 16; d++) if (a2[d] > a2[worst]) worst = d; ev('bank.arrears', 3, 'arrears', { share: rd(arrears * 100, 10), district: R.districts[worst] }, (arrears * 100).toFixed(1) + '% of home loans are in arrears, the most in ' + R.districts[worst] + ', where jobs have gone'); }
    (RUN.bankDays = RUN.bankDays || []).push({ k, day: dayStart(k), date: ymd(dayStart(k)), rate: rd(s.bRate * 100, 100), capital: Math.round(s.bCapital), capitalRatio: rd(ratio * 100, 10), appetite: rd(s.bApp * 100, 1),
      deposits: Math.round(s.bDeposits), mortgages: Math.round(mort), overdrafts: Math.round(od), startup: Math.round(startup), newMortgages: Math.round(newLoans), writtenOff: Math.round(s.bWO), income: Math.round(s.bIncome),
      arrears: rd(arrears * 100, 10), districts: Array.from(m2, (v, d) => ({ mortgages: Math.round(v), arrears: rd(a2[d] * 100, 10) })), risk: Array.from(s.bRisk, (v) => rd(v * 100, 10)) });
  }

  // ================================================================ staff who leave (from 1 September 2027)
  // Where life is hard (Pixel City Society's wellbeing), staff leave: a business loses some of its people, pays to
  // replace them, and records it among the reasons it is struggling ("employees left").
  const STAFF_START = Date.UTC(2027, 8, 1);
  function staffDay(s, x) {
    const S = U().society, R = RUN.R, wb = new Float64Array(16);
    for (let d = 0; d < 16; d++) { const n = S && S.needsAt ? S.needsAt(d, x.day) : null; wb[d] = n ? n.wellbeing : 0.75; }
    for (let i = 0; i < R.N; i++) {
      if (!s.open[i]) { s.cStf[i] += (0 - s.cStf[i]) / 30; continue; }
      const p = R.prem[i], q = 0.01 * hi(0, 0.85 - wb[p.district]) * (s.margin[i] < 0 ? 1.5 : 1);
      const left = q * s.staff[i], cost = left * p.capacity * p.wage * 8; // recruiting and training their replacements
      s.staff[i] = hi(0.15, s.staff[i] - left); s.cash[i] -= cost;
      s.cStf[i] += (cost + left * p.capacity * p.P0 * 30 - s.cStf[i]) / 30; // and a month of their work, while they're replaced
    }
  }

  // ================================================================ rents (from 1 June 2027)
  // Each district's rent follows how many of its premises are trading and how many pixels still live there. A district
  // in decline gets cheap: businesses there pay less, empty premises find takers sooner, and (in Society) cheap rents
  // draw new residents back. A booming, full district gets dear. Rents move slowly, over a season.
  const RENT_START = Date.UTC(2027, 5, 1);
  function rentDay(s, x, k, record) {
    const R = RUN.R, open = new Float64Array(16), all = new Float64Array(16);
    for (let i = 0; i < R.N; i++) { const d = R.prem[i].district; all[d]++; if (s.open[i]) open[d]++; }
    const r2 = s.rentIdx.slice();
    for (let d = 0; d < 16; d++) {
      const share = all[d] ? open[d] / all[d] : 1, pop = popOf(d, x.day);
      const target = clamp(0.55 + 0.45 * share + 0.6 * (pop - 1) + (share > 0.995 && pop > 0.995 ? 0.1 : 0), 0.5, 1.15);
      const was = r2[d]; r2[d] += (target - r2[d]) / 90;
      if (record && was >= 0.85 && r2[d] < 0.85 && k - (RUN.cool['rent' + d] || -999) > 120) {
        RUN.cool['rent' + d] = k;
        RUN.events.push({ id: 'commerce:rents:' + d + ':' + ymd(dayStart(k)), time: iso(dayStart(k) + DAY + 58000), ms: dayStart(k) + DAY + 58000, source: 'commerce', type: 'market.rents', importance: 2,
          data: { district: R.districts[d], rent: rd(r2[d] * 100, 1) }, headline: 'Rents in ' + R.districts[d] + ' have fallen by 15%: empty premises are going cheap, and the first takers are moving in' });
      }
    }
    s.rentIdx = r2;
  }

  // one trading day. record: whether this is the forward run (which keeps history and events) or a rebuild.
  function step(s, record) {
    const R = RUN.R, k = s.k, x = conditions(k), r = seeded('day:' + k), N = R.N, M = R.M;
    const { sf, util, patience, price, staff, cash, q, eff, aggr, rep, margin, loss, sales, rev, profit, open, gen, since, reopen, credit, loan, supply, mkPrice, mkOut, mkUnmet, mkDemand } = s;
    const ev = record ? RUN.events : null;
    const at = dayStart(k) + DAY; // results are posted at the close
    const emit = (type, importance, idPart, data, headline, sec) => { if (ev) ev.push({ id: 'commerce:' + idPart, time: iso(at + (sec || 0) * 1000), ms: at + (sec || 0) * 1000, source: 'commerce', type, importance, data, headline }); };
    const dn = (d) => R.districts[d];
    // From 1 March 2027, money a listed business raised on the Pixel Exchange yesterday reaches its accounts today (the
    // share market lives at the end of this file, and only ever answers for days already finished)
    const SH = U().shares;
    if (SH && SH.raisesFor && dayStart(k) >= SH.raiseStart) for (const rz of SH.raisesFor(dayStart(k) - DAY)) {
      const i = premisesIndex(rz.premises);
      if (i !== undefined && open[i] && gen[i] === rz.generation) cash[i] += rz.amount;
    }

    // orders for sprites from beyond the margin wander, and now and then lurch
    let lurch = 0;
    if (r() < 1 / 150) lurch = (r() < 0.5 ? -1 : 1) * (0.12 + r() * 0.12);
    s.world = clamp(1 + (s.world - 1) * 0.97 + (r() - 0.5) * 0.035 + lurch, 0.55, 1.55);
    if (lurch && record) emit(lurch > 0 ? 'market.boom' : 'market.slump', 3, 'world:' + ymd(dayStart(k)), { good: 'sprites', change: rd(lurch * 100, 1) },
      lurch > 0 ? 'Orders from beyond the margin for Pixel City sprites jump by ' + Math.round(lurch * 100) + '%; the Render Plants are working late' : 'Orders from beyond the margin for Pixel City sprites fall by ' + Math.round(-lurch * 100) + '%; the Render Plants go quiet', 1);
    // raw colour comes in by sea: dearer when ships are held outside the harbour
    s.importIdx = clamp(1 + (s.importIdx - 1) * 0.96 + (r() - 0.5) * 0.02 + (x.portClosed ? 0.03 : 0) + x.held * 0.01, 0.75, 1.6);

    // demand, market by market. Factories, warehouses and offices answer to the rest of the city one day behind.
    const out = (kind) => mkOut[R.goodsMk[kind]] / R.markets[R.goodsMk[kind]].base;
    const spritesR = out('sprites'), texturesR = out('textures');
    s.cargoAvg = s.cargoAvg * 0.97 + x.cargo * 0.03;
    const portR = x.portClosed ? 0.15 : clamp(x.cargo / hi(0.3, s.cargoAvg), 0.2, 2.2);
    const lawCap = 1 - 0.07 * (x.levels['policy.emissionsCap'] || 0);
    for (const mk of R.markets) {
      let f;
      const sub = mk.sub;
      const mood = 0.5 + 0.5 * s.conf; // confidence moves spending, but pixels still need what they need
      if (mk.kind === 'shop') f = shopMood(sub, x, mk.district) * popOf(mk.district, x.day) * mood * (s.bOn ? clamp(1 - 3 * (s.bRate - 0.04), 0.8, 1.08) : 1); // borrowing costs reach the tills
      else if (mk.kind === 'sprites') { // orders from beyond the margin only count while the export dock has room for them
        const room = s.fOn ? clamp((RUN.F.dockCap - s.dock) / (0.25 * RUN.F.dockCap), 0, 1) : 1;
        const abroad = 0.6 * s.world * room, home = 0.4 * s.shopUnits * mood;
        f = abroad + home; s.exportShare = f > 0 ? abroad / f : 0;
      }
      else if (mk.kind === 'textures' || mk.kind === 'codecs') f = spritesR;
      else if (mk.kind === 'palettes') f = texturesR;
      else if (mk.kind === 'haulage') f = s.factoryUnits;
      else if (mk.kind === 'cache') f = 0.55 * portR + 0.45 * s.factoryUnits;
      else if (mk.kind === 'distribution') f = s.shopUnits;
      else if (mk.kind === 'buffers') f = portR;
      else f = s.revOther * mood * (1 + 0.03 * (x.levels['policy.constructionBudget'] || 0)) * (x.weekend ? 0.55 : 1.15) * (1 - 0.6 * x.darkFrac[7]);
      // dearer markets sell less: how much depends on whether pixels can do without it
      const rel = clamp(mkPrice[mk.i] / mk.P0, 0.4, 3), E = dayStart(k) >= CHAIN_START && CHAIN_ELASTIC[mk.kind] !== undefined ? CHAIN_ELASTIC[mk.kind] : ELASTIC[mk.kind];
      mkDemand[mk.i] = mk.base * f * clamp(1 / (1 + E * (rel - 1)), 0.3, 1.6) * (0.97 + r() * 0.06);
    }

    phaseSupply(s, x, lawCap);
    if (!s.bOn && dayStart(k) >= BANK_OPENS) bankBegin(s, k, record);
    if (s.bOn) { s.bIncome = 0; s.bWO = 0; if (new Date(dayStart(k)).getUTCDate() === 1) bankRate(s, k, record); }
    if (!s.fOn && dayStart(k) >= FREIGHT_START) freightBegin(s);
    if (s.fOn) freightLimits(s);
    const { shopUnits, factoryUnits, revOther } = phaseClear(s);
    if (s.fOn) freightMove(s, x, k, record);
    s.k_ = k;
    const { closures, profitSum, revSum } = phaseBooks(s, x, k, r, record, emit, dn);
    // confidence: profits, closures, blackouts and smog, felt over a fortnight
    s.closures7 = s.closures7.slice(1); const c7 = new Float64Array(7); c7.set(s.closures7); c7[6] = closures; s.closures7 = c7;
    let c7sum = 0; for (let j = 0; j < 7; j++) c7sum += s.closures7[j];
    const cityMargin = revSum > 0 ? profitSum / revSum : 0;
    // closures count as a rate (a bad week in a big city is not the end of the world), and confidence drifts back
    // towards normal on its own, as memories fade
    const target = clamp(1 + (cityMargin - 0.08) * 0.9 - lo(0.1, c7sum / R.N * 2.5) - x.blackoutHours * 0.008 - hi(0, x.aqi - 90) * 0.0005, 0.85, 1.15);
    s.conf = s.conf + (target - s.conf) / 14 + (1 - s.conf) / 120;
    s.shopUnits = shopUnits / RUN.shopBase; s.factoryUnits = factoryUnits / RUN.factoryBase; s.revOther = revOther / RUN.revBase;

    if (dayStart(k) >= STAFF_START) staffDay(s, x);
    if (dayStart(k) >= RENT_START) rentDay(s, x, k, record);
    if (s.bOn) bankDay(s, x, k, record);
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
      loan: Math.round(s.loan[i]), reopens: !open && s.reopen[i] >= 0 ? ymd(dayStart(s.reopen[i])) : null, market: R.markets[p.market].key, losingDays: s.loss[i]
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
  /**
   * One premises' monthly results for the months completed before t, read straight from the ledger (no rebuilding of
   * the day's state, so it is cheap to call for many businesses): month, occupant, generation, days traded, revenue,
   * profit, cash and whether it was open at the month's end.
   */
  function ledgerOf(id, t) {
    if (!ready() || t < START + DAY) return null;
    const i = premisesIndex(id); if (i === undefined) return null;
    const k = closedDays(t); advance(k);
    const R = register(), mEnd = monthOf(dayStart(k));
    return RUN.ledger.filter((L) => L.month < mEnd).map((L) => ({ month: Math.floor(L.month / 12) + '-' + pad(L.month % 12 + 1), name: L.days[i] ? nameOf(R, i, L.gen[i]) : null, generation: L.gen[i],
      days: L.days[i], revenue: Math.round(L.rev[i]), profit: Math.round(L.profit[i]), cash: Math.round(L.cash[i]), open: !!L.open[i] }));
  }
  function firmsAt(t) { if (!ready() || t < START + DAY) return []; const k = closedDays(t), R = register(), s = stateFor(k); const out = []; for (let i = 0; i < R.N; i++) out.push(firmView(R, s, i, k)); return out; }
  function marketsAt(t) { if (!ready() || t < START + DAY) return []; const k = closedDays(t), R = register(), s = stateFor(k); return R.markets.map((mk) => marketView(R, s, mk)); }
  function premisesIndex(id) { const R = register(); if (!R.byId) { R.byId = {}; R.prem.forEach((p, i) => (R.byId[p.id] = i)); } return R.byId[id]; }
  /** One premises at time t: who trades there, how they're doing, everyone who traded there before, and the monthly ledger. */
  function business(id, t) {
    if (!ready() || t < START + DAY) return null;
    const i = premisesIndex(id); if (i === undefined) return null;
    const k = closedDays(t), R = register(), s = stateFor(k), v = firmView(R, s, i, k);
    v.history = RUN.occupants[i].filter((o) => o.from < k).map((o) => ({ name: o.name, generation: o.gen, from: ymd(dayStart(o.from)), to: o.to >= 0 && o.to < k ? ymd(dayStart(o.to)) : null, reason: o.to >= 0 && o.to < k ? o.reason : '', causes: o.to >= 0 && o.to < k ? o.causes || [] : [] }));
    const mEnd = monthOf(dayStart(k));
    v.ledger = RUN.ledger.filter((L) => L.month < mEnd).map((L) => ({ month: Math.floor(L.month / 12) + '-' + pad(L.month % 12 + 1), name: L.days[i] ? nameOf(R, i, L.gen[i]) : null, days: L.days[i], revenue: Math.round(L.rev[i]), profit: Math.round(L.profit[i]),
      units: Math.round(L.units[i]), staff: Math.round(L.staff[i] * R.prem[i].capacity * (L.open[i] ? 1 : 0)), cash: Math.round(L.cash[i]), price: rd(L.price[i], 100) }));
    return v;
  }
  function historyBetween(from, to) {
    if (!ready()) return [];
    const k1 = closedDays(to); advance(k1);
    return RUN.days.filter((d) => d.day + DAY > from && d.day + DAY <= to).map((d) => ({ day: d.day, date: d.date, confidence: d.conf, cpi: d.cpi, powerIdx: d.power, importIdx: d.imports, worldIdx: d.world, open: d.open, staff: d.staff, staffD: d.staffD ? Array.from(d.staffD) : null, rentD: d.rentD ? Array.from(d.rentD) : null, closures: d.closures, margin: d.margin, revenue: d.revenue, profit: d.profit }));
  }
  function eventsBetween(from, to) {
    if (!ready()) return [];
    advance(closedDays(to));
    return RUN.events.filter((e) => e.source === 'commerce' && e.ms >= from && e.ms < to).map((e) => ({ id: e.id, time: e.time, source: e.source, type: e.type, importance: e.importance, data: e.data, headline: e.headline }));
  }
  /** Phase 2 hook for the Job Centre: is anyone trading at this premises at t, and how many staff do they keep? */
  function premisesAt(id, t) {
    if (!ready() || t < START + DAY) return { open: true, staff: null };
    const i = premisesIndex(id); if (i === undefined) return null;
    const R = register(), s = stateFor(closedDays(t));
    return { open: !!s.open[i], generation: s.gen[i], name: nameOf(R, i, s.gen[i]), staff: s.open[i] ? Math.round(R.prem[i].capacity * s.staff[i]) : 0 };
  }

  // ---------------------------------------------------------------- phase 2: what working lives need to know
  // A business is active from the close of its first trading day to the close of its last. Nothing is known about a day
  // until it has closed, so working lives never learn of a failure before it happens.
  const activeFrom = (o) => dayStart(o.from) + DAY, activeTo = (o) => (o.to >= 0 ? dayStart(o.to) + DAY : Infinity);
  function occupant(id, t) {
    const i = premisesIndex(id); if (i === undefined) return null;
    advance(closedDays(t));
    const list = RUN.occupants[i];
    for (let j = list.length - 1; j >= 0; j--) { const o = list[j]; if (activeFrom(o) <= t && t < activeTo(o) && activeFrom(o) <= dayStart(RUN.s.k)) return o; }
    return null;
  }
  /** Is anyone trading at this premises at t? */
  const openAt = (id, t) => (!ready() || t < START + DAY ? true : !!occupant(id, t));
  /** Who trades here at t: { generation, name, since } or null if empty. */
  function occupantAt(id, t) { if (!ready()) return null; const o = occupant(id, t); return o ? { generation: o.gen, name: o.name, since: iso(activeFrom(o)) } : null; }
  /** When the occupant of this generation closed, if it closed by upTo; otherwise null. */
  function closeOf(id, gen, upTo) {
    const i = premisesIndex(id); if (i === undefined) return null;
    advance(closedDays(upTo));
    for (const o of RUN.occupants[i]) if (o.gen === gen) return o.to >= 0 && activeTo(o) <= upTo ? activeTo(o) : null;
    return null;
  }
  /** The staff every business wants at t, by premises id (0 if empty). One call per month is plenty. */
  function staffAt(t) {
    const R = register(), s = stateFor(closedDays(t)), out = {};
    for (let i = 0; i < R.N; i++) out[R.prem[i].id] = s.open[i] ? Math.round(R.prem[i].capacity * s.staff[i]) : 0;
    return out;
  }

  // ---------------------------------------------------------------- freight: reading the docks and the rounds
  const fReady = (t) => ready() && t >= FREIGHT_START + DAY;
  function freightStateAt(t) {
    if (!fReady(t)) return { started: false, startDate: ymd(FREIGHT_START) };
    const k = closedDays(t); advance(k);
    const d = RUN.freightDays[RUN.freightDays.length - 1 - (RUN.s.k - k)] || RUN.freightDays[RUN.freightDays.length - 1];
    const R = register();
    return Object.assign({ started: true, asOf: iso(d.day + DAY) }, d, {
      districts: d.shelves.map((v, i) => ({ id: i, name: R.districts[i], shelfDays: v, status: v < 0.4 ? 'empty' : v < 1 ? 'running low' : v < 2 ? 'thin' : 'stocked' })),
      ships: RUN.ships.filter((e) => e.arrive < t).slice(-14).reverse().map((e) => Object.assign({}, e, { arrive: iso(e.arrive), depart: iso(e.depart), sailed: e.depart < t, loaded: e.depart < t ? e.loaded : null })) });
  }
  const freightAPI = {
    source: 'freight', startDate: ymd(FREIGHT_START), start: FREIGHT_START, ready: () => ready(),
    /** The docks and the rounds at the last close: raw colour in days, the export dock, haulage, every district's shelves, recent ships. */
    stateAt: freightStateAt,
    historyBetween(from, to) { if (!ready()) return []; advance(closedDays(to)); return RUN.freightDays.filter((d) => d.day + DAY > from && d.day + DAY <= to).map((d) => Object.assign({}, d)); },
    shipsBetween(from, to) { if (!ready()) return []; advance(closedDays(to)); return RUN.ships.filter((e) => e.arrive >= from && e.arrive < to && e.arrive < dayStart(RUN.s.k)).map((e) => Object.assign({}, e, { arrive: iso(e.arrive), depart: iso(e.depart), loaded: e.depart < to ? e.loaded : null })); },
    eventsBetween(from, to) { if (!ready()) return []; advance(closedDays(to)); return RUN.events.filter((e) => e.source === 'freight' && e.ms >= from && e.ms < to).map((e) => ({ id: e.id, time: e.time, source: e.source, type: e.type, importance: e.importance, data: e.data, headline: e.headline })); }
  };

  // ---------------------------------------------------------------- the Bank: reading its books
  const bankAPI = {
    source: 'bank', startDate: ymd(BANK_OPENS), opens: BANK_OPENS, ready: () => ready(), SECTORS,
    /** The Bank at the last close: its rate, capital, appetite, the book by kind and by district, and its biggest borrowers. */
    stateAt(t) {
      if (!ready() || t < BANK_OPENS + DAY) return { open: false, opens: iso(BANK_OPENS) };
      const k = closedDays(t), R = register(), s = stateFor(k); advance(k);
      const days = RUN.bankDays || [], d = days.filter((x) => x.k < k).slice(-1)[0];
      if (!d) return { open: false, opens: iso(BANK_OPENS) };
      const borrowers = [];
      for (let i = 0; i < R.N; i++) if (s.open[i] && (s.cash[i] < 0 || s.loan[i] > 0)) borrowers.push({ premises: R.prem[i].id, name: nameOf(R, i, s.gen[i]), sector: R.prem[i].sector, district: R.districts[R.prem[i].district],
        overdraft: Math.round(s.cash[i] < 0 ? -s.cash[i] : 0), limit: Math.round(s.credit[i]), loan: Math.round(s.loan[i]), use: s.credit[i] > 0 ? rd((s.cash[i] < 0 ? -s.cash[i] : 0) / s.credit[i] * 100, 1) : 0 });
      borrowers.sort((a, b) => b.overdraft + b.loan - a.overdraft - a.loan);
      return Object.assign({}, d, { open: true, asOf: iso(d.day + DAY), borrowers: borrowers.slice(0, 40), borrowerCount: borrowers.length,
        sectors: SECTORS.map((x, j) => ({ sector: x, risk: d.risk[j] })), districts: d.districts.map((v, j) => Object.assign({ name: R.districts[j] }, v)) });
    },
    historyBetween(from, to) { if (!ready()) return []; advance(closedDays(to)); return (RUN.bankDays || []).filter((d) => d.day + DAY > from && d.day + DAY <= to).map((d) => Object.assign({}, d)); },
    eventsBetween(from, to) { if (!ready()) return []; advance(closedDays(to)); return RUN.events.filter((e) => e.source === 'bank' && e.ms >= from && e.ms < to).map((e) => ({ id: e.id, time: e.time, source: e.source, type: e.type, importance: e.importance, data: e.data, headline: e.headline })); }
  };

  root.PixelUniverse = root.PixelUniverse || {};
  root.PixelUniverse.bank = bankAPI;
  root.PixelUniverse.freight = freightAPI;
  root.PixelUniverse.commerce = {
    version: VERSION, source: 'commerce', startDate: ymd(START), start: START, ready,
    stateAt, firmsAt, marketsAt, business, ledgerOf, premisesAt, historyBetween, eventsBetween, openAt, occupantAt, closeOf, staffAt,
    districts: () => (ready() ? register().districts : []), KIND
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* ==================================================================== the Pixel Exchange share market */
/*
 * The Pixel Exchange share market: the city's biggest businesses, listed and traded.
 *
 * On 1 February 2027 forty of the city's largest businesses list their shares. Every trading day their prices move on
 * what two kinds of trader do:
 *
 *   Value traders work out what a business is worth from its results (posted on the 1st of each month, from the
 *   Exchange's ledger) and buy when the price is below that, sell when it is above. They pull prices back to earth.
 *   Momentum traders ignore the business and buy whatever has been rising. They push prices further the way they move.
 *
 * The traders are Pixel City Society's communities. Each community's investors are some mix of the two, and the mix
 * moves with which way has been paying in their district, and with what the communities they know are doing (Society's
 * own network). So momentum can catch on in one part of town, a bubble can grow in that district's businesses, and the
 * crash can send everyone back to value. A trading limit stops any share moving more than 10% in a day.
 *
 * Tier: world loop, with one channel back. It reads the Exchange (firms, monthly results, closures) and Society's
 * network, only for days already finished. From 1 March 2027 one thing it does reaches the city: on results day a listed
 * business whose shares trade well above its worth sells new shares, and the Exchange puts the money in its accounts
 * the next day. Nothing else about share prices touches the city.
 *
 * This module is part of the Exchange's universe.js, so every page that runs the Exchange runs the market with it (the
 * Exchange's history depends on it from 1 March 2027). The separate shares.js is kept only so older pages still load.
 * Seeds start "shares:". Simulation maths uses only + - * / Math.floor Math.imul (and comparisons).
 * Registers window.PixelUniverse.shares.
 */
(function (root) {
  'use strict';

  const VERSION = '2.0.0';
  const H = 3600000, DAY = 86400000;
  const START = Date.UTC(2027, 1, 1); // listing day: the February Grand Prix, with the Bank
  const LISTED = { factory: 10, shop: 10, office: 8, warehouse: 8, port: 4 }; // forty businesses, by sector
  const MAXM = 0.85; // even the keenest community keeps some investors who look at the business
  const P0 = 100;
  // raising money: on results day, a business whose shares close at least 40% above its worth sells a tenth more
  // shares at that price, no more than once in six months; the Exchange banks the money the next day
  const RAISE = { start: Date.UTC(2027, 2, 1), premium: 0.4, issue: 0.10, gap: 180 }; // every share lists at 100 W
  const LIMIT = 0.10; // the most a share may move in a day
  // the market's dials: how hard each kind of trader pushes, how fast investors change their minds, and what it costs
  // a value investor each day to keep working out what businesses are worth (momentum costs nothing to follow), and how
  // much a crowded trade puts investors off: the more of the city chasing trends, the less there is in it for the next
  const K = { value: 0.06, momentum: 1.1, noise: 0.012, home: 0.6, learn: 1.5, talk: 0.04, settle: 0.02, memory: 0.94, mult: 7, cost: 0.0008, crowd: 0.05 };

  function rng(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  const seeded = (s) => rng(hash('shares:' + s));
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const rd = (x, k) => Math.floor(x * k + 0.5) / k;
  const pad = (n) => (n < 10 ? '0' : '') + n;
  const ymd = (ms) => { const d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };
  const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
  const dayStart = (k) => START + k * DAY;
  const daysTo = (t) => Math.floor((t - START) / DAY);
  const firstOfMonth = (ms) => new Date(ms).getUTCDate() === 1;
  const pct = (x) => Math.round(x * 100);

  const U = () => root.PixelUniverse || {};
  const Com = () => U().commerce, Soc = () => U().society;
  const ready = () => !!(Com() && Com().ready && Com().ready() && Com().ledgerOf && Soc() && Soc().networkOf);

  // ---------------------------------------------------------------- listing day
  // The largest businesses in each sector, as they stood at the close before listing day. Each is valued from its cash
  // and its last month's profit, and issues enough shares to list at 100 W.
  function worth(cash, monthProfit) { const v = 0.5 * (cash > 0 ? cash : 0) + 12 * K.mult * monthProfit; return v; }
  // a business's results: its cash, and its profit per month over up to a year (this occupant only), so that a
  // summer lull is not mistaken for decline
  function lastMonth(id, t) {
    const rows = Com().ledgerOf(id, t); if (!rows || !rows.length) return null;
    const last = rows[rows.length - 1]; let p = 0, n = 0;
    for (let j = rows.length - 1; j >= 0 && n < 12; j--) { const L = rows[j]; if (!L.days || L.generation !== last.generation) break; p += L.profit * 30 / L.days; n++; }
    return { open: last.open, generation: last.generation, name: last.name, cash: last.cash, profit: n ? p / n : 0 };
  }
  // the most valuable sound businesses in a sector that may list: comfortable ones first, then by what they are worth
  // (cash and a year of results). The Pixel 40 never lists two businesses of the same name, nor more than six from one
  // district, so it stays readable and spread across the city
  const PER_DISTRICT = 6;
  function candidates(firms, sector, listed, t) {
    const sound = (f) => (f.standing === 'comfortable' ? 1 : 0), names = new Set(), perD = {};
    for (const g of listed) { names.add(g.name); perD[g.district] = (perD[g.district] || 0) + 1; }
    const xs = firms.filter((f) => f.open && f.sector === sector && !names.has(f.name) && (perD[f.district] || 0) < PER_DISTRICT);
    const val = {}; for (const f of xs) { const m = lastMonth(f.premises, t); val[f.premises] = m ? worth(m.cash, m.profit) : 0; }
    return xs.sort((a, b) => sound(b) - sound(a) || val[b.premises] - val[a.premises] || (a.premises < b.premises ? -1 : 1));
  }
  function listFirm(f, slot, t) {
    const m = lastMonth(f.premises, t), v = worth(m.cash, m.profit), floor = 30 * f.capacity * 30, total = v > floor ? v : floor;
    return { i: slot, premises: f.premises, name: f.name, sector: f.sector, line: f.line, district: f.district, districtName: f.districtName, generation: f.generation, shares: total / P0, floor };
  }
  let LIST = null;
  function listing() {
    if (LIST) return LIST;
    const firms = Com().firmsAt(START), out = [];
    for (const sector of Object.keys(LISTED))
      for (let n = 0; n < LISTED[sector]; n++) { const f = candidates(firms, sector, out, START)[0]; if (!f) break; out.push(listFirm(f, out.length, START)); }
    LIST = out;
    return LIST;
  }

  // ---------------------------------------------------------------- the run
  let RUN = null;
  function init() {
    const L = listing(), N = L.length, net = Soc().networkOf(), C = net.communities.length;
    const m = new Float64Array(C), base = new Float64Array(C);
    for (const c of net.communities) { const r = seeded('mind:' + c.id); base[c.id] = clamp(0.12 + 0.3 * c.novelty * c.novelty + 0.08 * (r() - 0.5), 0.05, 0.6); m[c.id] = base[c.id]; }
    RUN = {
      k: 0, net, m, base, slots: L.slice(), log: L.map((f) => ({ k: 0, f })), everListed: new Set(L.map((f) => f.premises)), divisor: 1, perfM: new Float64Array(16), perfV: new Float64Array(16),
      price: Float64Array.from(L.map(() => P0)), value: Float64Array.from(L.map(() => P0)), hist: L.map(() => [P0, P0, P0, P0, P0]),
      peak: Float64Array.from(L.map(() => P0)), peakK: new Int32Array(N), live: Uint8Array.from(L.map(() => 1)),
      raisedK: new Int32Array(N).fill(-999), raises: {}, bubble: new Uint8Array(N), bubbleK: new Int32Array(N).fill(-999), burst: new Uint8Array(N), hot: new Uint8Array(16), crashed: new Int32Array(N).fill(-1), limitK: new Int32Array(N).fill(-99), majority: false,
      days: [], events: []
    };
  }
  // the index: the listed businesses' combined market value, against listing day (1,000)
  const capOf = () => { let c = 0; for (const f of RUN.slots) if (RUN.live[f.i]) c += RUN.price[f.i] * f.shares; return c; };
  const mixOf = (d) => { // the momentum share among the investors of a district, and of the city
    const net = RUN.net; let s = 0, w = 0, cs = 0, cw = 0;
    for (const c of net.communities) { cs += RUN.m[c.id] * c.members; cw += c.members; if (c.district === d) { s += RUN.m[c.id] * c.members; w += c.members; } }
    return { district: w ? s / w : cs / cw, city: cs / cw };
  };

  function step() {
    const L = RUN.slots, N = L.length, k = RUN.k, day = dayStart(k), at = day + DAY, r = seeded('day:' + k);
    const emit = (type, importance, idPart, data, headline, sec) => RUN.events.push({ id: 'shares:' + idPart, time: iso(at + sec * 1000), ms: at + sec * 1000, source: 'shares', type, importance, data, headline });
    if (k === 0) emit('shares.listed', 4, 'listed:' + ymd(day), { listed: N, sectors: LISTED },
      'Forty of Pixel City\u2019s largest businesses list their shares on the Pixel Exchange, each at 100 W', 1 - DAY / 1000); // at the opening bell

    // results day: an empty place in the Pixel 40 goes to the next-largest sound business in its sector
    if (k > 0 && firstOfMonth(day) && L.some((f) => !RUN.live[f.i])) {
      const firms = Com().firmsAt(day);
      for (const g of L.slice()) {
        if (RUN.live[g.i]) continue;
        const f = candidates(firms, g.sector, L.filter((x) => RUN.live[x.i]), day)[0]; if (!f) continue;
        const capBefore = capOf();
        const nf = listFirm(f, g.i, day); L[g.i] = nf; RUN.log.push({ k, f: nf });
        RUN.live[g.i] = 1; RUN.price[g.i] = P0; RUN.value[g.i] = P0; RUN.hist[g.i] = [P0, P0, P0, P0, P0];
        RUN.peak[g.i] = P0; RUN.peakK[g.i] = k; RUN.bubble[g.i] = 0; RUN.crashed[g.i] = -1;
        RUN.divisor = RUN.divisor * capOf() / capBefore; // the index carries on where it was
        emit('shares.joins', 2, 'joins:' + f.premises + ':' + ymd(day), { firm: f.name, premises: f.premises, sector: f.sector, replaces: g.name, again: RUN.everListed.has(f.premises) },
          f.name + ' joins the Pixel 40 in place of ' + g.name, 2 + g.i);
        RUN.everListed.add(f.premises);
      }
    }
    // results day: value traders re-value every business from its recent results
    if (k > 0 && firstOfMonth(day)) for (const f of L) {
      if (!RUN.live[f.i]) continue;
      const mo = lastMonth(f.premises, day);
      if (!mo || !mo.open || mo.generation !== f.generation) continue; // closures are handled below
      const v = worth(mo.cash, mo.profit), was = RUN.value[f.i], now = (v > f.floor ? v : f.floor) / f.shares;
      RUN.value[f.i] = now;
      if (was > 0 && (now - was) / was >= 0.25) emit('shares.results', 2, 'results:' + f.premises + ':' + ymd(day), { firm: f.name, premises: f.premises, change: pct((now - was) / was) }, f.name + '\u2019s results lift its value by ' + pct((now - was) / was) + '%', 1 + f.i);
      // a business riding high sells new shares while it can
      const p1 = RUN.price[f.i];
      if (day >= RAISE.start && k - RUN.raisedK[f.i] >= RAISE.gap && p1 >= (1 + RAISE.premium) * now) {
        const issued = f.shares * RAISE.issue, amount = Math.floor(issued * p1), capBefore = capOf();
        RUN.raisedK[f.i] = k;
        RUN.value[f.i] = (now * f.shares + 0.5 * amount) / (f.shares + issued); // half the new cash counts towards its worth, as for any cash
        f.shares += issued;
        RUN.divisor = RUN.divisor * capOf() / capBefore; // new shares don't move the index
        (RUN.raises[k] = RUN.raises[k] || []).push({ premises: f.premises, generation: f.generation, amount });
        emit('shares.raise', 3, 'raise:' + f.premises + ':' + ymd(day), { firm: f.name, premises: f.premises, district: f.districtName, amount, premium: pct((p1 - now) / now), issued: Math.round(issued) },
          f.name + ' raises ' + amount.toLocaleString('en') + ' W by selling new shares, which trade at ' + pct((p1 - now) / now) + '% above what the business is worth', 50 + f.i);
      }
      if (was > 0 && (was - now) / was >= 0.25) emit('shares.results', 2, 'results:' + f.premises + ':' + ymd(day), { firm: f.name, premises: f.premises, change: -pct((was - now) / was) }, f.name + '\u2019s results cut its value by ' + pct((was - now) / was) + '%', 1 + f.i);
    }

    // a business that has closed is struck off, and its shares are worth nothing
    if (k > 0) for (const e of Com().eventsBetween(day - DAY, day)) { // yesterday's closures: only days the Exchange has finished
      if (e.type !== 'business.closed') continue;
      for (const f of L) if (RUN.live[f.i] && e.data && e.data.premises === f.premises) {
        RUN.live[f.i] = 0;
        emit('shares.delisted', 4, 'delisted:' + f.premises, { firm: f.name, premises: f.premises, last: rd(RUN.price[f.i], 100), closure: e.id },
          f.name + ' is struck off the Pixel Exchange; its shares, last traded at ' + rd(RUN.price[f.i], 1) + ' W, are worth nothing', 60 + f.i);
        RUN.price[f.i] = 0;
      }
    }

    // the day's trading
    const mix = []; for (let d = 0; d < 16; d++) mix.push(mixOf(d));
    const city = mix[0].city, gainM = new Float64Array(16), gainV = new Float64Array(16), cnt = new Float64Array(16);
    let live = 0;
    for (const f of L) {
      const i = f.i; if (!RUN.live[i]) continue;
      const h = RUN.hist[i], p1 = h[h.length - 1], p5 = h[h.length - 5], v = RUN.value[i];
      const trend = (p1 - p5) / (4 * p5), gap = clamp((v - p1) / p1, -0.9, 3); // trend: the average daily move over four days
      const sM = K.home * mix[f.district].district + (1 - K.home) * city;
      const pull = gap * (1 + 2 * (gap > 0 ? gap : -gap)); // the further from its worth, the harder value investors lean
      let ret = K.value * (1 - sM) * pull + K.momentum * sM * trend + K.noise * 2 * (r() - 0.5);
      ret = clamp(ret, -LIMIT, LIMIT);
      const p = p1 * (1 + ret);
      // how each way of trading did on this share today
      gainM[f.district] += (trend > 0 ? ret : -ret); gainV[f.district] += (gap > 0 ? ret : -ret); cnt[f.district]++;
      RUN.price[i] = p; h.push(p); if (h.length > 30) h.shift();
      if (p > RUN.peak[i]) { RUN.peak[i] = p; RUN.peakK[i] = k; }
      live++;

      // what the newspaper notices
      const prem = (p - v) / v;
      if (!RUN.bubble[i] && prem >= 0.5 && p >= 1.3 * h[0]) { // well above its worth, and climbing: not just bad results
        RUN.bubble[i] = 1; RUN.bubbleK[i] = k;
        emit('shares.bubble', 3, 'bubble:' + f.premises + ':' + ymd(day), { firm: f.name, premises: f.premises, district: f.districtName, price: rd(p, 100), value: rd(v, 100), premium: pct(prem), momentum: pct(sM) },
          f.name + ' shares trade at ' + pct(prem) + '% above what the business is worth, as momentum traders pile in', 20 + i);
      }
      if (RUN.bubble[i] && prem < 0.15) RUN.bubble[i] = 0;
      const fall = (RUN.peak[i] - p) / RUN.peak[i];
      if (RUN.crashed[i] < 0 && fall >= 0.3 && k - RUN.peakK[i] <= 30) {
        // a burst bubble if the share had been in a bubble in the last two months; otherwise just a hard fall
        const burst = k - RUN.bubbleK[i] <= 60;
        RUN.crashed[i] = k; RUN.burst[i] = burst ? 1 : 0; const bubbleId = 'shares:bubble:' + f.premises + ':' + ymd(dayStart(RUN.bubbleK[i])); if (burst) RUN.bubbleK[i] = -999; // one bubble bursts once
        emit('shares.crash', 4, 'crash:' + f.premises + ':' + ymd(day), { firm: f.name, premises: f.premises, district: f.districtName, from: rd(RUN.peak[i], 100), to: rd(p, 100), fall: pct(fall), days: k - RUN.peakK[i], burst,
          bubble: burst ? bubbleId : null },
          (burst ? 'The bubble in ' + f.name + ' shares bursts: down ' : f.name + ' shares fall ') + pct(fall) + '% in ' + (k - RUN.peakK[i]) + ' trading days', 30 + i);
      }
      if (ret <= -LIMIT && k - RUN.limitK[i] > 10) {
        RUN.limitK[i] = k;
        emit('shares.limit', 2, 'limit:' + f.premises + ':' + ymd(day), { firm: f.name, premises: f.premises }, 'Trading in ' + f.name + ' is halted after its shares fall the daily limit of 10%', 70 + i);
      }
      if (RUN.crashed[i] >= 0 && (p - v) / v < 0.1 && (v - p) / v < 0.1) {
        if (RUN.burst[i]) emit('shares.vindicated', 2, 'vindicated:' + f.premises + ':' + ymd(day), { firm: f.name, premises: f.premises, price: rd(p, 100), value: rd(v, 100), crash: 'shares:crash:' + f.premises + ':' + ymd(dayStart(RUN.crashed[i])) },
          f.name + ' shares are back to what the business is worth, and the city\u2019s value investors say they told everyone so', 40 + i);
        RUN.crashed[i] = -1; RUN.peak[i] = p; RUN.peakK[i] = k;
      }
    }

    // investors change their minds: towards whichever way has been paying in their district, towards what the
    // communities they know are doing, and slowly back to their old habits
    for (let d = 0; d < 16; d++) if (cnt[d]) { RUN.perfM[d] = RUN.perfM[d] * K.memory + gainM[d] / cnt[d]; RUN.perfV[d] = RUN.perfV[d] * K.memory + gainV[d] / cnt[d] - K.cost; }
    const net = RUN.net, m2 = RUN.m.slice(), crowdNow = mixOf(0).city;
    let cityM = 0, cityV = 0; for (let d = 0; d < 16; d++) { cityM += RUN.perfM[d] / 16; cityV += RUN.perfV[d] / 16; }
    for (const c of net.communities) {
      const d = c.district, edge = (cnt[d] ? RUN.perfM[d] - RUN.perfV[d] : cityM - cityV) - K.crowd * (crowdNow - 0.3);
      let s = 0, w = 0; for (const t of net.ties[c.id]) { s += t.weight * RUN.m[t.id]; w += t.weight; }
      const x = RUN.m[c.id] + K.learn * edge * RUN.m[c.id] * (1 - RUN.m[c.id]) + K.talk * ((w ? s / w : RUN.m[c.id]) - RUN.m[c.id]) + K.settle * (RUN.base[c.id] - RUN.m[c.id]);
      m2[c.id] = clamp(x, 0.03, MAXM);
    }
    RUN.m = m2;
    // a district where momentum has caught on (or cooled), and the community that led the way
    for (let d = 0; d < 16; d++) {
      const md = mixOf(d).district, name = (net.communities.find((c) => c.district === d) || {}).districtName;
      if (!RUN.hot[d] && md >= 0.5) {
        RUN.hot[d] = 1;
        let lead = null; for (const c of net.communities) if (c.district === d && (!lead || RUN.m[c.id] > RUN.m[lead.id])) lead = c;
        // who they heard it from: the community they know with the most momentum investors, if it isn't from round here
        let from = null; for (const t of net.ties[lead.id]) { const o = net.communities[t.id]; if (!from || RUN.m[o.id] > RUN.m[from.id]) from = o; }
        const elsewhere = from && from.district !== d && RUN.m[from.id] > RUN.m[lead.id] - 0.05 ? from : null;
        emit('shares.catches', 3, 'catches:' + d + ':' + ymd(day), { district: name, districtId: d, share: pct(md), community: lead.name, from: elsewhere ? elsewhere.name : null,
          causes: [{ cause: 'district', label: 'momentum trading paid in ' + name, share: elsewhere ? 50 : 100 }].concat(elsewhere ? [{ cause: 'network', label: 'the ' + lead.name + ' heard about it from the ' + elsewhere.name, share: 50 }] : []) },
          'Momentum trading has caught on in ' + name + ', led by the ' + lead.name + (elsewhere ? ', who heard about it from the ' + elsewhere.name : ''), 12 + d);
      }
      if (RUN.hot[d] && md < 0.35) {
        RUN.hot[d] = 0;
        emit('shares.cools', 2, 'cools:' + d + ':' + ymd(day), { district: name, districtId: d, share: pct(md) }, name + '’s investors have gone back to looking at the businesses', 28 + d);
      }
    }
    const nowCity = mixOf(0).city;
    if (!RUN.majority && nowCity >= 0.5) {
      RUN.majority = true;
      let top = null; for (const c of net.communities) if (!top || RUN.m[c.id] - RUN.base[c.id] > RUN.m[top.id] - RUN.base[top.id]) top = c;
      emit('shares.momentum', 3, 'momentum:' + ymd(day), { share: pct(nowCity), first: top.name, district: top.districtName },
        'Momentum traders are now the majority on the Pixel Exchange; the ' + top.name + ' were among the first to change their ways', 10);
    }
    if (RUN.majority && nowCity < 0.42) {
      RUN.majority = false;
      emit('shares.value', 3, 'value:' + ymd(day), { share: pct(nowCity) }, 'Value investors are the majority on the Pixel Exchange again', 11);
    }

    const cap = capOf(); if (k === 0) { let c0 = 0; for (const f of RUN.slots) c0 += P0 * f.shares; RUN.divisor = c0; } // listing day is 1,000
    let vcap = 0; for (const f of L) if (RUN.live[f.i]) vcap += RUN.value[f.i] * f.shares;
    RUN.days.push({ k, day, index: rd(1000 * cap / RUN.divisor, 100), valueIndex: rd(1000 * vcap / RUN.divisor, 100), live, momentum: nowCity, price: Float32Array.from(RUN.price), value: Float32Array.from(RUN.value),
      district: Float32Array.from(mix.map((x) => x.district)) });
    RUN.k = k + 1;
  }
  function runTo(k) { if (!RUN) init(); while (RUN.k < k) step(); }
  /** The close of trading day j (the day starting dayStart(j)), as recorded. */
  function record(j) { if (j < 0) return null; runTo(j + 1); return RUN.days[j]; }

  // ---------------------------------------------------------------- reading the market
  const slotAt = (i, j) => { let f = null; for (const x of RUN.log) if (x.f.i === i && x.k <= j) f = x.f; return f; };
  /** The market at t, as of the last close: the Pixel 40 index, each listed share, and who is trading how. */
  function stateAt(t) {
    if (!ready() || t < START + DAY) return { started: false, startDate: ymd(START) };
    const j = daysTo(t) - 1, d = record(j), prev = record(j - 1), L = RUN.slots.map((f) => slotAt(f.i, j));
    return {
      started: true, asOf: iso(dayStart(j) + DAY), index: d.index, indexChange: prev ? rd(d.index - prev.index, 100) : 0, momentum: pct(d.momentum),
      districts: Array.from(d.district).map((x, i) => ({ id: i, momentum: pct(x) })),
      listed: L.map((f) => ({ premises: f.premises, name: f.name, sector: f.sector, line: f.line, district: f.districtName, listed: d.price[f.i] > 0,
        price: rd(d.price[f.i], 100), value: rd(d.value[f.i], 100), premium: d.value[f.i] ? pct((d.price[f.i] - d.value[f.i]) / d.value[f.i]) : 0,
        change: prev && prev.price[f.i] && slotAt(f.i, j - 1) === f ? rd((d.price[f.i] - prev.price[f.i]) / prev.price[f.i] * 100, 10) : 0 }))
    };
  }
  /** One listed business's share price and value, close by close. */
  function shareHistory(premises, from, to) {
    if (!ready()) return [];
    const j1 = daysTo(to); runTo(j1);
    const entry = RUN.log.find((x) => x.f.premises === premises); if (!entry) return [];
    const f = entry.f, next = RUN.log.find((x) => x.f.i === f.i && x.k > entry.k), until = next ? next.k : Infinity;
    return RUN.days.filter((d) => d.day + DAY > from && d.day + DAY <= to && d.k >= entry.k && d.k < until).map((d) => ({ date: ymd(d.day), price: rd(d.price[f.i], 100), value: rd(d.value[f.i], 100) }));
  }
  function historyBetween(from, to) {
    if (!ready() || to < START + DAY) return [];
    runTo(daysTo(to));
    return RUN.days.filter((d) => d.day + DAY > from && d.day + DAY <= to).map((d) => ({ day: d.day, date: ymd(d.day), index: d.index, valueIndex: d.valueIndex, momentum: pct(d.momentum) }));
  }
  function eventsBetween(from, to) {
    if (!ready() || to < START) return [];
    runTo(daysTo(to));
    return RUN.events.filter((e) => e.ms >= from && e.ms < to).sort((a, b) => a.ms - b.ms)
      .map((e) => ({ id: e.id, time: e.time, source: e.source, type: e.type, importance: e.importance, data: e.data, headline: e.headline }));
  }

  /** The money businesses raised by selling shares on the trading day starting at t, for the Exchange to bank the next
   *  day: [{ premises, generation, amount }]. Answers only for a day the market has finished. */
  function raisesFor(t) {
    if (!ready() || t < RAISE.start) return [];
    const j = daysTo(t); if (j < 0) return [];
    runTo(j + 1);
    return (RUN.raises[j] || []).map((r) => ({ premises: r.premises, generation: r.generation, amount: r.amount }));
  }

  root.PixelUniverse = root.PixelUniverse || {};
  root.PixelUniverse.shares = {
    version: VERSION, source: 'shares', startDate: ymd(START), start: START, ready,
    stateAt, shareHistory, historyBetween, eventsBetween, raisesFor, raiseStart: RAISE.start,
    /** The forty businesses listed at t (the Pixel 40), as they stood at the last close. */
    listedAt: (t) => { if (!ready() || t < START + DAY) return []; const j = daysTo(t) - 1; runTo(j + 1); return RUN.slots.map((f) => slotAt(f.i, j)).map((f) => ({ premises: f.premises, name: f.name, sector: f.sector, district: f.districtName })); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
