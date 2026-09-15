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

Five tabs, each named for the question it answers, and the scope control above
them (All races / House / Senate / Governors) applies to every one of them at
once. On a wide screen the left rail lists the sections of the open tab.

- **Who wins** — the headline probabilities, then every seat lined up from
  safest Democratic to safest Republican with each party's majority seat marked
  (governorships too), then seat totals and both chambers together.
- **Which seats** — the seats most likely to change hands in all three chambers,
  the races the answer rests on, the map, and all 506 as a swarm and a table.
- **What changed** — what moved the forecast since the last run, which races
  moved, the full history, and what is still to arrive before November.
- **What if** — what the forecast does if the national polling is off, how errors
  travel together, and how far the districts and state borders sit from the
  country.
- **Can you trust it** — whether this model has been right before, what could be
  wrong, what it is built from, and one race walked step by step.

Click any race anywhere — a map, a chart, a table row — for its full working:
who is on the ballot, what the prior said, what the polls said, and the weight
given to each. Clicking a race again holds its result fixed and re-reads every
number on the page from only the simulations that agree.

**What could be wrong**, on the Can you trust it tab, is not a footnote: it is the list of
things this model is known to get wrong, and it is there because a forecast
without one is a claim rather than a measurement.
