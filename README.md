# The Pixel Exchange

Every business in Pixel City, trading. Commerce, phase 1, of the Pixel Universe. Follows the Pixel Universe Shared Conventions.

Live at `https://dvexperiments.github.io/Exchange/`. Add `?at=2026-07-20T12:00` to watch any moment.

## What it does

**What pixels buy.** Shops sell charge (Charge Bars), fresh colours (Palette Shops), fixes for glitches (Patch Shops), a little shading (Shader Parlours), the race feed (Signal Kiosks) and staples (Refresh Pantries, Cache & Carries). Offices sell typesetting, colour consultancy, gradients, alignment, refresh services, font licences, calibration and brightness advice.

**What the city makes.** Raw colour comes in by sea and is refined into palettes (Palette Refineries); palettes are cast into textures (Texture Foundries); codecs come from the Compression Works; textures and codecs are rendered into sprites (Render Plants), which sell to the city and beyond the margin. Caches, Packet Haulage and Data Distribution move it all, and Buffer Handlers load the ships at the export dock.


The city's 2,535 businesses (the Census Office's register) make and sell what pixels use, need and want each set their own prices, compete for customers, take on and shed staff, run up debts and, now and then, fail. An empty premises stays empty for a while, then someone new opens there under a new name.

Nothing is scripted. Every trading day:

- **Demand** comes from the city as it is. Shops follow their district's residents, the weather (charge on grey, cold days, colours in spring, patches after a storm), weekends (shading), Grand Prix days (the race feed, and every shop in the stadium's district), blackouts, smog, traffic limits and business confidence. Sprites sell beyond the margin, on a market that wanders and occasionally lurches. The buffer handlers follow the ships that call, and stop when the wind does.
- **Demand flows down a supply chain, a day behind.** Sprites need textures and codecs, textures need palettes, palettes and codecs need imported raw colour (dearer when ships are held outside the harbour), shops need data distribution, industry needs packet haulage, the export dock needs caching, and every business needs offices.
- **Costs** are wages (the Job Centre's sector rates), power (priced from the day's mix on the grid: gas is dear, coal and the national link cheaper), inputs at today's market prices, and rent (dearer downtown). Wages and rent are paid whether anything sells or not.
- **Each business decides** its price (its costs per unit it can actually make, plus its own markup and a premium when customers are being turned away, leaning down when goods sit unsold), its staff (hiring when busy and profitable, letting people go when quiet or short of cash), and its quality (good years pay for improvements).
- **Failure**: past the bank's patience (a credit line of a few weeks' costs), or more bad days than the owner will stand (thin losses are tolerated). Each owner's patience is different. Premises reopen sooner in a strong market and stay empty longer in a weak one.
- **Confidence** follows profits, closures, blackouts and smog over a fortnight, and feeds back into what pixels spend. Closures can cascade.
- **Senate laws** reach business through the grid's power mix, emissions caps (factory output), traffic limits (shops) and the construction budget (offices).

## Files

| File | What it does |
| --- | --- |
| `universe.js` | The simulation. No DOM code. Registers `PixelUniverse.commerce`. |
| `app.js` | The pages: the market, businesses, each premises, the register, about. |
| `exchange.css` | Styles, on Glacial's tokens. |
| `index.html` | The site. |

## Dependencies

Hard dependencies, loaded in this order: the Weather Bureau, the Senate, City's `universe.js` and City's `census.js` (the business register). If any fails, the Exchange refuses to run rather than compute a different history.

## API

| Function | Returns |
| --- | --- |
| `stateAt(t)` | The market at the last close: confidence, shopping basket (CPI), power and import indices, businesses trading, staff, and each market's price, demand and shortage |
| `firmsAt(t)` | Every premises: who trades there, price, staff, takings, profit, cash, standing |
| `marketsAt(t)` | Every market (each shop trade in each district, each good, each service) |
| `business(id, t)` | One premises by its Census Office id (`b<tile>`), with everyone who has traded there and the monthly ledger |
| `premisesAt(id, t)` | Phase 2 hook: is anyone trading there, under what name, with how many staff |
| `historyBetween(from, to)` | Daily summaries |
| `eventsBetween(from, to)` | Events in the shared format, source `commerce`: `business.opened`, `business.closed`, `market.shortage`, `market.pricewar`, `market.boom`, `market.slump`, `market.report` |

## Time

Trading days run 00:00 to 00:00 UTC (noon to noon, city time). Results are posted at the close, at 00:00 UTC, with the new Daily Pixel. Records begin with the city, on 3 December 2025. The Exchange is a reader, so starting in the past rewrites nobody's history.

## Performance

The run steps forward a day at a time, about 1 ms per trading day in a typical browser, and keeps a checkpoint every 30 days, so an earlier moment rebuilds from the nearest checkpoint.

## Freight

From the December Grand Prix (1 December 2026), goods are physical, and City's container ships carry them:

- **Raw colour** arrives in container ships, in proportion to each ship's TEU, and waits in the cache at the export dock (room for 16 days). Packet haulage takes it to the Palette Refineries and Compression Works, which ration their output when less than two days' supply is left. Ships held outside the harbour by storms leave the store to run down.
- **Sprites** sold beyond the margin wait at the export dock until a container ship sails, loaded by the buffer handlers. When the dock is nearly full, the Render Plants turn orders from beyond the margin away.
- **The shelves**: every district's shops sell from about two days of stock, restocked on the data distribution rounds. Storms, heavy rain, blackouts in the district, Grand Prix crowds on the buses (worst around the stadium) and the Senate's traffic limits slow the rounds; a shortage of data distribution firms slows them everywhere. Shops can only sell what is on the shelves.

Everything feeds back into the market: rationed refineries starve the texture foundries and render plants, empty shelves cut shops' takings, and the firms that make the rounds and load the ships live or die by the same market as everyone else.

`PixelUniverse.freight` (from the same `universe.js`): `stateAt(t)` (raw colour in days, the export dock, haulage, distribution and loading capacity, every district's shelves, recent ships), `historyBetween`, `shipsBetween` (the shipping register: each ship's TEU, raw colour landed and sprites loaded) and `eventsBetween`, source `freight`: `freight.rawlow`, `freight.dockfull`, `freight.shelves`, `freight.arrival`.

The Freight page shows the docks and the rounds, the shelves district by district, and the shipping register.

## Crazes

A craze for a kind of shop (Pixel City Society's tastes run) raises demand for that kind of shop in each district, by up to 60% where everyone has taken it up. The Exchange requires `society.js`; it only ever reads the tastes run, which doesn't read the Exchange.

## Working lives (phase 2)

From 1 December 2026, when working lives begin, the Census Office's careers follow the Exchange:

- a business hires in proportion to the staff it wants (a busy one takes on more than its premises' usual share);
- a business that has closed doesn't hire;
- when a business fails, everyone working for it is laid off, on the day, and joins the queue at the Job Centre;
- a resident's job record shows the name of the business they actually worked for, even if the premises later changed hands.

The census reads `occupantAt`, `closeOf`, `staffAt` and `openAt`. The Exchange reads only the census's register (`labour.employers()`), which doesn't depend on it, so there's no loop. Every page that shows working lives loads the Exchange after City's `census.js`; without it, the census and the Job Centre refuse to run.

## What to expect

In ordinary times about 4 to 5% of businesses close in a year, more in winter. When power is dear for months (as during the Senate's move from coal to gas), industry is hit first, then haulage and offices, and closures can reach a fifth of all businesses in a year. Confidence recovers as memories fade.

## Still to come

The Exchange needs a building in the city. The Bank of Pixel City could take over the simple credit lines.

## The Bank of Pixel City

From 1 February 2027, the Bank of Pixel City runs in the Exchange's daily step and takes over the city's credit (before then, businesses keep the simple credit lines they always had, so nothing earlier changes):

- **The rate** is set on the 1st of each month from the shopping basket's inflation over the last quarter and business confidence, in quarter-point steps, at most half a point a month. A dear rate cools spending in the shops.
- **Overdrafts**: each business's limit is set daily from its record (margins, age, quality), the Bank's appetite and how it feels about the business's trade. Overdrafts and loans carry interest.
- **Start-up loans**: a business opening in empty premises borrows most of its start-up money, repaid over three years. When the Bank is cautious, premises stay empty longer.
- **Home loans**, district by district, follow confidence, the jobs a district has kept and the rate. Arrears follow lost jobs and a dear rate; homes in default are sold and most of the loan recovered.
- **Defaults spread**: every write-off cuts the Bank's capital and marks the failed business's trade as riskier; appetite follows capital, so every limit in the city tightens. Below 6% capital it all but stops lending.

`PixelUniverse.bank` (from this `universe.js`): `stateAt(t)` (rate, capital, appetite, deposits, the book by kind and district, sector risk, biggest borrowers), `historyBetween`, `eventsBetween` (source `bank`: `bank.opened`, `bank.rate`, `bank.default`, `bank.squeeze`, `bank.eases`, `bank.capital`, `bank.arrears`). The Bank's own site is at `dvexperiments.github.io/Bank/`.

From 1 March 2027 the Exchange reads City's glitches (corrupted and frozen districts make less, patch shops are mobbed during and for three days after, palette shops do well in a bleed, frozen districts get no deliveries, a leak at the dock eats 30% of the raw colour in store) and Society's migration (a district's shops sell to the pixels who still live there). It records staff by district each day (`staffD`), which Society's migration reads.
