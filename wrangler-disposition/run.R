## ============================================================
## Six Axes — disposition model worker v2 (container entrypoint)
##
## Args: 1 = campaign id (kept for the status row only), 2 = disposition_runs id.
##
## WHAT CHANGED FROM v1, AND WHY.
##
## v1 fit ONE CAMPAIGN at a time. That was fine for a single latent per character.
## It is impossible for a PLAYER latent, because a person's characters span
## campaigns: you cannot pool across a player's stable while looking at one campaign
## through a keyhole. So v2 fits GLOBALLY and campaigns become a level of the model
## rather than a filter on the query.
##
## The campaign id is still accepted, but ONLY to write status back to the
## disposition_runs row the triggering GM is watching. It no longer scopes the fit.
##
## FOUR THINGS THAT ARE EASY TO GET WRONG AND ARE HANDLED EXPLICITLY BELOW:
##
##  1. A character must only be paired with sessions FROM ITS OWN CAMPAIGN. v1 could
##     cross-join blindly because everything in scope was one campaign. Globally, a
##     naive cross join would score Bobert against sessions of a game he was never in.
##
##  2. Characters with no owner (profile_id null) still carry behavioral evidence
##     that informs the shared parameters (alpha, sigma, the session and campaign
##     effects, the NB dispersion). They are INCLUDED in the fit as singleton
##     pseudo-players so that information is not thrown away, and EXCLUDED from
##     write-back, because dispositions.profile_id is not null. v1 also skipped them
##     at write time; the difference is that v2 no longer discards their data.
##
##  3. A missing self-report is not a self-report of exactly average. v1 wrote z = 0
##     when an inventory was absent, and 0 on a standardized scale means "dead
##     average". v2 passes has_zp / has_zc alongside, so absence contributes nothing.
##
##  4. Two GMs can hit the button at once. A global fit that deletes and rewrites
##     every posterior must not interleave with another one doing the same. An
##     advisory lock serializes them.
##
## HONEST LIMITATION, WRITTEN HERE SO IT IS NOT LOST: with almost every player
## holding a single character, the player latent is identified mostly by its prior.
## The model solves cold-start for the NEXT character a person rolls. It does not yet
## reveal how any real person plays across a stable, because almost nobody has one.
## The intervals on phi will say so. Read them.
## ============================================================

suppressPackageStartupMessages({
  library(DBI); library(RPostgres); library(jsonlite); library(cmdstanr)
})

## ---- config -------------------------------------------------------------
args        <- commandArgs(trailingOnly = TRUE)
CAMPAIGN_ID <- if (length(args) >= 1 && nzchar(args[1])) args[1] else Sys.getenv("WRANGLER_CAMPAIGN_ID")
RUN_ID      <- if (length(args) >= 2 && nzchar(args[2])) args[2] else Sys.getenv("WRANGLER_RUN_ID")
MODEL_VERSION   <- "six-axes-disp-v2.0-2level"
SUPERSEDES      <- "wrangler-disp-v1.0-nb"     # v1 posteriors are removed once v2 writes
ANSWERS_COL     <- "answers"
AXES            <- c("N", "T", "O", "S", "E", "I")
STAN_FILE       <- Sys.getenv("STAN_FILE", "disposition.stan")
LOCK_KEY        <- 815124                       # arbitrary, stable: serializes global fits

cat(sprintf("[six-axes] GLOBAL two-level fit%s\n",
            if (nzchar(RUN_ID)) sprintf(" (run %s)", RUN_ID) else ""))

ITEMS <- do.call(rbind, lapply(AXES, function(ax)
  data.frame(id = paste0(tolower(ax), 1:4), axis = ax,
             reverse = c(FALSE, FALSE, FALSE, TRUE), stringsAsFactors = FALSE)))

## ---- connect (direct Postgres; bypasses RLS so the write-back works) -----
con <- dbConnect(RPostgres::Postgres(),
  host     = Sys.getenv("SUPABASE_DB_HOST"),
  port     = as.integer(Sys.getenv("SUPABASE_DB_PORT", "5432")),
  dbname   = Sys.getenv("SUPABASE_DB_NAME", "postgres"),
  user     = Sys.getenv("SUPABASE_DB_USER"),
  password = Sys.getenv("SUPABASE_DB_PASSWORD"),
  sslmode  = "require")

mark_run <- function(status, msg = NULL) {
  if (!nzchar(RUN_ID)) return(invisible())
  tryCatch(
    dbExecute(con,
      "update disposition_runs set status = $1, error = $2 where id = $3",
      params = list(status, if (is.null(msg)) NA_character_ else substr(msg, 1, 500), RUN_ID)),
    error = function(e) cat(sprintf("[six-axes] could not update run row: %s\n", conditionMessage(e))))
}

## Score one TPDI answers blob into a 6-vector on the standardized scale.
## 5-point Likert, centered at 3, scaled by 1.2. The 4th item of each axis is
## reverse-keyed. "NB" (not-applicable) items are dropped, not imputed.
score_answers <- function(answers_json) {
  ans <- tryCatch(fromJSON(answers_json), error = function(e) NULL)
  if (is.null(ans)) return(NULL)
  out <- setNames(rep(NA_real_, length(AXES)), AXES)
  for (ax in AXES) {
    its  <- ITEMS[ITEMS$axis == ax, ]
    vals <- c()
    for (k in seq_len(nrow(its))) {
      raw <- ans[[its$id[k]]]
      if (is.null(raw) || identical(as.character(raw), "NB")) next
      raw <- suppressWarnings(as.numeric(raw)); if (is.na(raw)) next
      vals <- c(vals, if (its$reverse[k]) 6 - raw else raw)
    }
    if (length(vals) > 0) out[ax] <- (mean(vals) - 3) / 1.2
  }
  out
}

tryCatch({

  ## Serialize global fits. Two GMs clicking at once would otherwise both delete and
  ## rewrite every posterior, and the interleaving is not something to find out about
  ## from a support ticket.
  dbGetQuery(con, "select pg_advisory_lock($1)", params = list(LOCK_KEY))

  ## ---- pull (GLOBAL: no campaign filter anywhere) ------------------------

  ## Opportunities define exposure, per session x axis. Campaign-wide, not per
  ## character: the session presented the opening, whoever took it.
  opp <- dbGetQuery(con, "
    select e.session_id, e.campaign_id, e.axis, count(*)::int as opp
    from events e join event_types et on et.key = e.event_type
    where et.category = 'opportunity' and e.axis is not null
    group by e.session_id, e.campaign_id, e.axis")

  resp <- dbGetQuery(con, "
    select e.character_id, e.session_id, e.axis, count(*)::int as resp
    from events e join event_types et on et.key = e.event_type
    where et.category = 'response' and e.axis is not null and e.character_id is not null
    group by e.character_id, e.session_id, e.axis")

  pcs <- dbGetQuery(con, "
    select id, name, campaign_id, profile_id
    from characters
    where kind = 'pc'
    order by campaign_id, created_at")

  ## CHARACTER self-reports: the latest per character. Once the instrument stops
  ## overwriting itself, there will be a series; take the most recent snapshot.
  tpdi_char <- dbGetQuery(con, sprintf("
    select distinct on (assigned_character_id)
           assigned_character_id as character_id, %s::text as answers, created_at
    from tpdi_responses
    where scope = 'character' and assigned_character_id is not null
    order by assigned_character_id, created_at desc", ANSWERS_COL))

  ## PLAYER self-reports: the latest per person. THIS IS THE ANCHOR OF THE NEW LEVEL.
  ## It will be empty until the player-scope instrument ships, and the model handles
  ## that correctly: has_zp = 0 everywhere means the player latent is driven purely by
  ## its characters' behavior and its own prior.
  tpdi_player <- dbGetQuery(con, sprintf("
    select distinct on (respondent_id)
           respondent_id as profile_id, %s::text as answers, created_at
    from tpdi_responses
    where scope = 'player' and respondent_id is not null
    order by respondent_id, created_at desc", ANSWERS_COL))

  if (nrow(opp) == 0) stop("No opportunity events with an axis anywhere. The model needs exposure.")
  if (nrow(pcs) == 0) stop("No player characters.")

  ## ---- indices ----------------------------------------------------------
  sess_tbl <- unique(opp[, c("session_id", "campaign_id")])
  sessions   <- sess_tbl$session_id
  campaigns  <- sort(unique(sess_tbl$campaign_id))

  ## Keep only characters whose campaign actually has sessions with exposure. A
  ## character in a campaign that has never been recorded has no observations, and
  ## including it would only produce a "posterior" that is entirely prior.
  pcs <- pcs[pcs$campaign_id %in% campaigns, , drop = FALSE]
  if (nrow(pcs) == 0) stop("No player characters in any campaign that has recorded sessions.")

  ## PLAYERS. Characters with an owner map to that profile. Characters WITHOUT an
  ## owner get their own singleton pseudo-player, so their behavioral evidence still
  ## informs the shared parameters. They are excluded from write-back later.
  real_players  <- sort(unique(pcs$profile_id[!is.na(pcs$profile_id) & nzchar(pcs$profile_id)]))
  orphan_ids    <- pcs$id[is.na(pcs$profile_id) | !nzchar(pcs$profile_id)]
  player_keys   <- c(real_players, paste0("orphan:", orphan_ids))

  Cn <- nrow(pcs); Sn <- length(sessions); Kn <- length(campaigns)
  Pn <- length(player_keys); An <- length(AXES)

  ci <- setNames(seq_len(Cn), pcs$id)
  si <- setNames(seq_len(Sn), sessions)
  ki <- setNames(seq_len(Kn), campaigns)
  pi <- setNames(seq_len(Pn), player_keys)
  ai <- setNames(seq_len(An), AXES)

  owner_key <- ifelse(is.na(pcs$profile_id) | !nzchar(pcs$profile_id),
                      paste0("orphan:", pcs$id), pcs$profile_id)
  owner_idx <- as.integer(pi[owner_key])
  camp_idx  <- as.integer(ki[sess_tbl$campaign_id[match(sessions, sess_tbl$session_id)]])

  ## ---- observation grid --------------------------------------------------
  ## THE TRAP. A character is paired ONLY with sessions from ITS OWN campaign. A
  ## naive global cross join would score every character against every session in the
  ## database, including games they were never in, and every one of those cells would
  ## read as a zero-response opportunity. It would look like universal disengagement.
  grid <- do.call(rbind, lapply(seq_len(Cn), function(i) {
    cells <- opp[opp$campaign_id == pcs$campaign_id[i], c("session_id", "axis", "opp")]
    if (nrow(cells) == 0) return(NULL)
    data.frame(character_id = pcs$id[i], cells, stringsAsFactors = FALSE)
  }))
  if (is.null(grid) || nrow(grid) == 0) stop("No observation cells could be built.")

  Rmap <- setNames(resp$resp, paste(resp$character_id, resp$session_id, resp$axis))
  gk   <- paste(grid$character_id, grid$session_id, grid$axis)
  grid$y    <- as.integer(ifelse(is.na(Rmap[gk]), 0L, Rmap[gk]))
  grid$logE <- log(grid$opp)

  ## ---- self-report matrices, with explicit presence masks -----------------
  zc     <- matrix(0, nrow = Cn, ncol = An, dimnames = list(pcs$id, AXES))
  has_zc <- matrix(0, nrow = Cn, ncol = An, dimnames = list(pcs$id, AXES))
  for (r in seq_len(nrow(tpdi_char))) {
    cid <- tpdi_char$character_id[r]; if (!(cid %in% pcs$id)) next
    sc <- score_answers(tpdi_char$answers[r]); if (is.null(sc)) next
    for (ax in AXES) if (!is.na(sc[[ax]])) { zc[cid, ax] <- sc[[ax]]; has_zc[cid, ax] <- 1 }
  }

  zp     <- matrix(0, nrow = Pn, ncol = An, dimnames = list(player_keys, AXES))
  has_zp <- matrix(0, nrow = Pn, ncol = An, dimnames = list(player_keys, AXES))
  for (r in seq_len(nrow(tpdi_player))) {
    pid <- tpdi_player$profile_id[r]; if (!(pid %in% player_keys)) next
    sc <- score_answers(tpdi_player$answers[r]); if (is.null(sc)) next
    for (ax in AXES) if (!is.na(sc[[ax]])) { zp[pid, ax] <- sc[[ax]]; has_zp[pid, ax] <- 1 }
  }

  n_multi <- sum(table(owner_key[owner_key %in% real_players]) > 1)
  cat(sprintf(paste0("[six-axes] characters: %d (%d owned, %d orphan) | players: %d (%d real, %d with >1 character)\n",
                     "[six-axes] campaigns: %d | sessions: %d | observations: %d\n",
                     "[six-axes] self-reports bound: %d character-scope, %d player-scope\n"),
              Cn, Cn - length(orphan_ids), length(orphan_ids), Pn, length(real_players), n_multi,
              Kn, Sn, nrow(grid), sum(rowSums(has_zc) > 0), sum(rowSums(has_zp) > 0)))
  if (n_multi == 0)
    cat("[six-axes] NOTE: no player holds more than one character, so the player latent has nothing to pool over. It is identified by its prior. Read the intervals on phi accordingly.\n")

  ## ---- fit ---------------------------------------------------------------
  stan_data <- list(
    N = nrow(grid), C = Cn, P = Pn, S = Sn, K = Kn, A = An,
    y = grid$y, logE = grid$logE,
    cc = as.integer(ci[grid$character_id]),
    ss = as.integer(si[grid$session_id]),
    aa = as.integer(ai[grid$axis]),
    owner = owner_idx,
    camp  = camp_idx,
    zp = zp, zc = zc, has_zp = has_zp, has_zc = has_zc)

  mod <- cmdstan_model(STAN_FILE)
  fit <- mod$sample(data = stan_data, chains = 4, parallel_chains = 4,
                    iter_warmup = 1000, iter_sampling = 1000,
                    adapt_delta = 0.95, refresh = 200, seed = 1)

  cat("\n[six-axes] self-report -> behavior loadings (a value near zero is a REAL result,\n")
  cat("           not a failure: it means self-perception on that axis does not predict play)\n")
  print(fit$summary(c("beta_p", "beta_c"))[, c("variable", "mean", "q5", "q95")])
  cat("\n[six-axes] pooling: sigma_char is how far characters drift from their player.\n")
  cat("           Small = a person plays everyone the same way. Large = they inhabit each one.\n")
  print(fit$summary(c("sigma_player", "sigma_char"))[, c("variable", "mean", "q5", "q95")])

  th <- fit$summary("theta")
  ph <- fit$summary("phi")
  inv_logit <- function(x) 1 / (1 + exp(-x))
  getv <- function(tbl, var, field) tbl[tbl$variable == var, ][[field]]

  ## Evidence counts, so a posterior that is really a prior says so out loud.
  ev <- aggregate(cbind(sessions = session_id) ~ character_id,
                  data = unique(resp[, c("character_id", "session_id")]),
                  FUN = length)
  ev_n <- setNames(ev$sessions, ev$character_id)
  ev_e <- setNames(tapply(resp$resp, resp$character_id, sum), names(tapply(resp$resp, resp$character_id, sum)))

  pack <- function(tbl, prefix, i) {
    ax_scores <- list(); wts <- list()
    for (a in seq_len(An)) {
      v  <- sprintf("%s[%d,%d]", prefix, i, a)
      m  <- getv(tbl, v, "mean"); sdv <- getv(tbl, v, "sd")
      lo <- getv(tbl, v, "q5");   hi  <- getv(tbl, v, "q95")
      ax_scores[[AXES[a]]] <- round(inv_logit(m), 4)
      wts[[AXES[a]]] <- list(theta_mean = round(m, 4), theta_sd = round(sdv, 4),
                             lo = round(lo, 4), hi = round(hi, 4))
    }
    list(scores = ax_scores, weights = wts)
  }

  ## ---- write back (one transaction) --------------------------------------
  dbBegin(con)

  ## v2 supersedes v1 globally. Both are removed so nothing stale outlives the fit.
  dbExecute(con, "delete from dispositions where source = 'posterior' and model_version in ($1, $2)",
            params = list(MODEL_VERSION, SUPERSEDES))

  latest_sess_by_camp <- dbGetQuery(con, "
    select distinct on (campaign_id) campaign_id, id as session_id
    from sessions
    where session_number is not null
    order by campaign_id, session_number desc")
  ls_map <- setNames(latest_sess_by_camp$session_id, latest_sess_by_camp$campaign_id)

  ## CHARACTER scope.
  written_c <- 0L; skipped <- character(0)
  for (i in seq_len(Cn)) {
    pid <- pcs$profile_id[i]
    if (is.na(pid) || !nzchar(pid)) { skipped <- c(skipped, pcs$name[i]); next }
    pk <- pack(th, "theta", i)
    nsess <- if (!is.na(ev_n[pcs$id[i]])) as.integer(ev_n[pcs$id[i]]) else 0L
    nev   <- if (!is.na(ev_e[pcs$id[i]])) as.integer(ev_e[pcs$id[i]]) else 0L
    w <- pk$weights
    ## Honesty in the payload: a character with no sessions has a posterior that IS
    ## its prior, and whatever renders it should be able to say so.
    w[["_evidence"]] <- list(sessions = nsess, response_events = nev)
    dbExecute(con, "
      insert into dispositions
        (profile_id, campaign_id, character_id, scope, source, axis_scores, weights, model_version, session_id, as_of)
      values ($1, $2, $3, 'character', 'posterior', $4::jsonb, $5::jsonb, $6, $7, now())",
      params = list(pid, pcs$campaign_id[i], pcs$id[i],
                    as.character(toJSON(pk$scores, auto_unbox = TRUE)),
                    as.character(toJSON(w, auto_unbox = TRUE)),
                    MODEL_VERSION,
                    if (is.na(ls_map[pcs$campaign_id[i]])) NA else ls_map[[pcs$campaign_id[i]]]))
    written_c <- written_c + 1L
  }

  ## PLAYER scope. Real players only: an orphan pseudo-player is a modelling device,
  ## not a person, and has no profile to attach to. character_id and campaign_id are
  ## null by definition (the check constraint enforces it).
  written_p <- 0L
  for (pid in real_players) {
    i  <- as.integer(pi[[pid]])
    pk <- pack(ph, "phi", i)
    nchar_held <- sum(owner_key == pid)
    w <- pk$weights
    w[["_evidence"]] <- list(characters = nchar_held,
                             self_report = as.integer(any(has_zp[pid, ] > 0)))
    dbExecute(con, "
      insert into dispositions
        (profile_id, campaign_id, character_id, scope, source, axis_scores, weights, model_version, session_id, as_of)
      values ($1, null, null, 'player', 'posterior', $2::jsonb, $3::jsonb, $4, null, now())",
      params = list(pid,
                    as.character(toJSON(pk$scores, auto_unbox = TRUE)),
                    as.character(toJSON(w, auto_unbox = TRUE)),
                    MODEL_VERSION))
    written_p <- written_p + 1L
  }

  dbCommit(con)

  cat(sprintf("\n[six-axes] wrote %d character posteriors and %d player posteriors.\n", written_c, written_p))
  if (length(skipped))
    cat(sprintf("[six-axes] no owner, so no disposition written: %s\n", paste(skipped, collapse = ", ")))

  mark_run("done")
  cat("[six-axes] done.\n")

}, error = function(e) {
  msg <- conditionMessage(e)
  cat(sprintf("[six-axes] ERROR: %s\n", msg))
  try(dbRollback(con), silent = TRUE)
  mark_run("error", msg)
  try(dbGetQuery(con, "select pg_advisory_unlock($1)", params = list(LOCK_KEY)), silent = TRUE)
  try(dbDisconnect(con), silent = TRUE)
  quit(save = "no", status = 1)
})

try(dbGetQuery(con, "select pg_advisory_unlock($1)", params = list(LOCK_KEY)), silent = TRUE)
try(dbDisconnect(con), silent = TRUE)
