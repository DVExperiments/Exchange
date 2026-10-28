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
 * Tier: a reader. It reads the Exchange (firms, monthly results, closures) and Society's network, the day before;
 * nothing reads it, so it changes nothing that happens in the city. Phase 2 may give prices one way back in.
 *
 * Load after Weather, Senate, City universe.js, City census.js, the Exchange universe.js and City society.js.
 * Seeds start "shares:". Simulation maths uses only + - * / Math.floor Math.imul (and comparisons).
 * Registers window.PixelUniverse.shares.
 */
(function (root) {
  'use strict';

  const VERSION = '1.0.0';
  const H = 3600000, DAY = 86400000;
  const START = Date.UTC(2027, 1, 1); // listing day: the February Grand Prix, with the Bank
  const LISTED = { factory: 10, shop: 8, office: 8, warehouse: 8, port: 6 }; // forty businesses, by sector
  const MAXM = 0.85; // even the keenest community keeps some investors who look at the business
  const P0 = 100; // every share lists at 100 W
  const LIMIT = 0.10; // the most a share may move in a day
  // the market's dials: how hard each kind of trader pushes, how fast investors change their minds, and what it costs
  // a value investor each day to keep working out what businesses are worth (momentum costs nothing to follow)
  const K = { value: 0.06, momentum: 1.1, noise: 0.012, home: 0.6, learn: 1.5, talk: 0.04, settle: 0.02, memory: 0.94, mult: 7, cost: 0.0008 };

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
  // the largest sound businesses in a sector, not already listed: comfortable ones first, then by size
  function candidates(firms, sector, taken) {
    const sound = (f) => (f.standing === 'comfortable' ? 1 : 0);
    return firms.filter((f) => f.open && f.sector === sector && !taken.has(f.premises))
      .sort((a, b) => sound(b) - sound(a) || b.capacity - a.capacity || (a.premises < b.premises ? -1 : 1));
  }
  function listFirm(f, slot, t) {
    const m = lastMonth(f.premises, t), v = worth(m.cash, m.profit), floor = 30 * f.capacity * 30, total = v > floor ? v : floor;
    return { i: slot, premises: f.premises, name: f.name, sector: f.sector, line: f.line, district: f.district, districtName: f.districtName, generation: f.generation, shares: total / P0, floor };
  }
  let LIST = null;
  function listing() {
    if (LIST) return LIST;
    const firms = Com().firmsAt(START), out = [], taken = new Set();
    for (const sector of Object.keys(LISTED))
      for (const f of candidates(firms, sector, taken).slice(0, LISTED[sector])) { taken.add(f.premises); out.push(listFirm(f, out.length, START)); }
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
      bubble: new Uint8Array(N), bubbleK: new Int32Array(N).fill(-999), burst: new Uint8Array(N), hot: new Uint8Array(16), crashed: new Int32Array(N).fill(-1), limitK: new Int32Array(N).fill(-99), majority: false,
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
      const firms = Com().firmsAt(day), taken = new Set(L.filter((f) => RUN.live[f.i]).map((f) => f.premises));
      for (const g of L.slice()) {
        if (RUN.live[g.i]) continue;
        const f = candidates(firms, g.sector, taken)[0]; if (!f) continue;
        taken.add(f.premises);
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
      if (was > 0 && (was - now) / was >= 0.25) emit('shares.results', 2, 'results:' + f.premises + ':' + ymd(day), { firm: f.name, premises: f.premises, change: -pct((was - now) / was) }, f.name + '\u2019s results cut its value by ' + pct((was - now) / was) + '%', 1 + f.i);
    }

    // a business that has closed is struck off, and its shares are worth nothing
    if (k > 0) for (const e of Com().eventsBetween(day - DAY, day + 12 * H)) {
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
    const net = RUN.net, m2 = RUN.m.slice();
    let cityM = 0, cityV = 0; for (let d = 0; d < 16; d++) { cityM += RUN.perfM[d] / 16; cityV += RUN.perfV[d] / 16; }
    for (const c of net.communities) {
      const d = c.district, edge = cnt[d] ? RUN.perfM[d] - RUN.perfV[d] : cityM - cityV;
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

  root.PixelUniverse = root.PixelUniverse || {};
  root.PixelUniverse.shares = {
    version: VERSION, source: 'shares', startDate: ymd(START), start: START, ready,
    stateAt, shareHistory, historyBetween, eventsBetween,
    /** The forty businesses listed at t (the Pixel 40), as they stood at the last close. */
    listedAt: (t) => { if (!ready() || t < START + DAY) return []; const j = daysTo(t) - 1; runTo(j + 1); return RUN.slots.map((f) => slotAt(f.i, j)).map((f) => ({ premises: f.premises, name: f.name, sector: f.sector, district: f.districtName })); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
