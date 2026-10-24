# The Pixel Exchange

Every business in Pixel City, trading. Commerce, phase 1, of the Pixel Universe. Follows the Pixel Universe Shared Conventions.

Live at `https://dvexperiments.github.io/Exchange/`. Add `?at=2026-07-20T12:00` to watch any moment.

## What it does

The city's 2,535 businesses (the Census Office's register: shops, offices, factories, warehouses and the stevedores at the docks) each set their own prices, compete for customers, take on and shed staff, run up debts and, now and then, fail. An empty premises stays empty for a while, then someone new opens there under a new name.

Nothing is scripted. Every trading day:

- **Demand** comes from the city as it is. Shops follow their district's residents, the weather (coffee in the cold, florists in spring, hardware after a storm), weekends, Grand Prix days (newsagents, and every shop in the stadium's district), blackouts, smog, traffic limits and business confidence. Screens sell abroad, on a world market that wanders and occasionally lurches. The stevedores follow the ships that call, and stop when the wind does.
- **Demand flows down a supply chain, a day behind.** Screens need diodes and glass, diodes need phosphor, phosphor and glass need imported raw colour (dearer when ships are held outside the harbour), shops need distribution, factories need freight, the port needs storage, and every business needs offices.
- **Costs** are wages (the Job Centre's sector rates), power (priced from the day's mix on the grid: gas is dear, coal and the national link cheaper), inputs at today's market prices, and rent (dearer downtown). Wages and rent are paid whether anything sells or not.
- **Each business decides** its price (its costs plus its own markup, leaning up when sold out and down when goods sit unsold), its staff (hiring when busy and profitable, letting people go when quiet or short of cash), and its quality (good years pay for improvements).
- **Failure**: past the bank's patience (a credit line of a few weeks' costs), or more losing days than the owner will stand. Each owner's patience is different.
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

## Next: phase 2

The Job Centre reads `premisesAt`, so a closure lays its staff off and a new business hires. Careers begin on 30 November 2026 at 12:00 UTC, so phase 2 must be published before then, or given a later start date, to avoid rewriting anyone's working life.

The Exchange also needs a building in the city.
