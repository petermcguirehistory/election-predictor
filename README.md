# 2026 midterm forecast — the published site

**<https://petermcguire.info/election-predictor/>**

A probabilistic forecast of the 2026 US House, Senate and gubernatorial
elections: what is likely to happen, how confident the model is, and — on the
page itself — what it cannot do.

## What is in this repository

Only the site. `index.html`, its scripts and styles, and the payload the page
reads: one JSON file of race-level forecasts and one packed file holding the
simulation draws themselves, which is what lets the page answer conditional
questions ("if Republicans hold NC-SEN, what happens to the House") from the
model's own draws rather than from a formula.

Everything here is **generated**. Editing it by hand would be overwritten by the
next publish.

## What is not in it

The engine — the feeds, the poll averaging, the priors, the simulation, the
calibration harness and the backtests — is a separate private repository. This
repo is its output, not its source.

## How current is it

The page states its own as-of date at the top. The model is re-run daily and
published when the run has nothing unusual to report; when a data feed stops
publishing or a new alarm appears, publishing stops and the page keeps the last
good forecast rather than quietly showing one built on stale inputs. So a date
that has not moved for a few days means something is being looked at.

## How to read it

Six tabs, and the scope control above them (All races / House / Senate /
Governors) applies to every one of them at once:

- **Forecast** — the headline probabilities, what moved them since the last run,
  seat totals, and the races the answer rests on.
- **Map** — every seat by district or by state, with colour drained toward grey
  where the model knows least.
- **Races** — all 506, as a swarm and as a sortable table.
- **Playing field** — how far the districts and the state borders sit from the
  country, and what the forecast does if the national polling is off.
- **Track record** — whether this model has been right before, scored out of
  sample.
- **Method** — one race walked step by step, and what could be wrong.

Click any race anywhere — a map, a chart, a table row — for its full working:
who is on the ballot, what the prior said, what the polls said, and the weight
given to each. Clicking a race again holds its result fixed and re-reads every
number on the page from only the simulations that agree.

**What could be wrong**, on the Method tab, is not a footnote: it is the list of
things this model is known to get wrong, and it is there because a forecast
without one is a claim rather than a measurement.
