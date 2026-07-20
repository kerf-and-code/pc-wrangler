# Wrangler disposition model

An offline R/Stan job. It reads your event spine and bound TPDI inventories from
Supabase, fits a hierarchical negative-binomial model, and writes posterior
disposition estimates back to the `dispositions` table. It runs on your machine,
not Vercel.

## What it estimates

For each player character, a six-axis behavioral disposition (`theta`), learned
from how they actually played, starting from their self-report and moving toward
revealed behavior as evidence accumulates.

The likelihood: a character's count of **response** events on an axis in a
session is negative-binomial, with an **exposure offset** for how many
**opportunities** of that axis the session presented. That offset is the whole
point: it separates disposition from the GM's session design, so a player isn't
scored low on Tactics just because there were no fights.

The prior: each bound TPDI inventory is scored (1-5 Likert, reverse items as
`6 - raw`, axis = mean) and enters as an informative prior through an estimated
loading `beta[axis]`. `beta` is reported, it tells you how well self-report
predicts behavior on each axis, which is a validity check, not an assumption.

Partial pooling across players and a session-level effect keep thin data honest:
with few events the posterior stays near the prior with wide intervals, which is
correct, not a bug.

## Prerequisites

- R (4.x)
- Packages: `install.packages(c("DBI","RPostgres","jsonlite","cmdstanr"))`
  (cmdstanr is on its own repo: see https://mc-stan.org/cmdstanr/)
- CmdStan: `cmdstanr::install_cmdstan()` (one time, compiles the toolchain)

## Setup

1. Copy `Renviron.example` to `.Renviron` in this folder and fill in your
   Supabase database host/password and the campaign UUID.
2. If your `tpdi_responses` answer column is not named `responses`, change
   `ANSWERS_COL` at the top of `run.R`.

## Run

From this directory:

```
Rscript run.R
```

It prints how many characters have a bound inventory, the `beta` loadings, and
how many posterior rows it wrote. Re-running replaces the posteriors for this
`model_version`, so it is safe to run after every processed session.

## What it writes

One `dispositions` row per **bound** PC, `source = 'posterior'`,
`model_version = 'wrangler-disp-v1.0-nb'`:

- `axis_scores` (jsonb): `{N,T,O,S,E,I}` on a 0-1 engagement scale, where 0.5 is
  table-typical engagement on that axis given opportunity. This is
  `inv_logit(theta)`.
- `weights` (jsonb): the latent log-rate posterior per axis,
  `{theta_mean, theta_sd, lo, hi}` (lo/hi are the 90% credible interval).
- `character_id`, `profile_id` (the owner, the not-null key), `session_id`
  (latest fitted session), `as_of`.

It also drops `disposition_posteriors.csv` for inspection.

## Important: bind the roster first

A PC with no bound inventory is **skipped** on write-back, because
`dispositions.profile_id` is not null and the owner only exists once you bind the
inventory on the GM Roster page. Bind your players first; the run reports any it
skipped.

## Known scope (v1)

- Campaign-level: one disposition vector per PC across all sessions. Per-session
  **trajectory** (a dynamic `theta` that drifts session to session) is the next
  iteration; the table already has `session_id` for it.
- Responses are counted frame-agnostic (IC and OOC together). Splitting them is
  a later refinement.
- The model is honest about thin data: expect wide intervals until events
  accumulate. That is the Bayesian point, not a failure.
