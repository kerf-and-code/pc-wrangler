// Six Axes — disposition model, v2: two levels.
//
// WHAT CHANGED, AND WHY.
//
// v1 had one latent per character: theta[c,a], with the TPDI self-report entering as
// a covariate whose loading beta[a] was ESTIMATED rather than assumed. That last part
// was the good idea in v1 and it survives intact: we never claim self-report is
// truth, we let the data say how much it predicts behavior, per axis.
//
// v2 puts a PLAYER latent above it. phi[p,a] is how person p tends to play on axis a,
// across every character they have ever played. Each character is then partially
// pooled toward the player they belong to:
//
//     phi[p,a]   = beta_p[a] * zp[p,a] + sigma_player[a] * phi_raw[p,a]
//     theta[c,a] = phi[owner(c),a] + beta_c[a] * zc[c,a] + sigma_char[a] * theta_raw[c,a]
//
// Read that second line carefully, because it is the whole product:
//
//   phi[owner(c),a]     a new character does not start at the population mean. It
//                       starts shrunk toward how its player tends to play. COLD START
//                       SOLVED.
//   beta_c[a]*zc[c,a]   this particular character's own self-report still moves it.
//   sigma_char[a]       and behavior pulls it away as evidence accumulates.
//
// sigma_char[a] IS the pooling strength, and it is ESTIMATED, not set. Small means a
// person's characters resemble each other; large means they play each one differently.
// That is a substantive finding about a table, not a knob to be tuned, so the model
// should learn it rather than be told it. (A fixed tau can be reintroduced as a
// `data` block scalar if you ever want a lever; you almost certainly do not.)
//
// THE IDENTIFIABILITY CAVEAT, STATED HONESTLY. If a player has exactly ONE character,
// phi[p] and theta[c] are separated only by their priors: there is nothing to pool
// over. The model is still correct and still solves cold-start for that person's NEXT
// character, but it is not learning a player latent from data today. This matters
// only for interpretation, not for correctness, and the fit will show it as wide
// intervals on phi.
//
// CAMPAIGN NESTING. v1 fit one campaign at a time, so it could ignore campaigns. A
// player's characters span campaigns, so v2 fits globally and sessions must nest:
//
//     delta[k]  ~ normal(0, sigma_camp)              campaign-level rate offset
//     gamma[s]  ~ normal(delta[campaign(s)], sigma_sess)   session within campaign
//
// Without this, sessions from a chatty campaign and a terse one would be treated as
// exchangeable draws from one pool, and the difference between GMs would be smeared
// into the players.
//
// Likelihood is unchanged: negative binomial on response counts, with log(opportunities)
// as an exposure offset, so we model a RATE per opportunity rather than a raw count.
// A quiet session does not make everyone look disengaged.

data {
  int<lower=1> N;                        // observations (character x session x axis, exposure >= 1)
  int<lower=1> C;                        // characters (PCs)
  int<lower=1> P;                        // players (profiles owning at least one PC)
  int<lower=1> S;                        // sessions
  int<lower=1> K;                        // campaigns
  int<lower=1> A;                        // axes (6)

  array[N] int<lower=0> y;               // response-event counts
  vector[N] logE;                        // log exposure = log(opportunities)
  array[N] int<lower=1, upper=C> cc;     // character index
  array[N] int<lower=1, upper=S> ss;     // session index
  array[N] int<lower=1, upper=A> aa;     // axis index

  array[C] int<lower=1, upper=P> owner;  // which player owns character c
  array[S] int<lower=1, upper=K> camp;   // which campaign session s belongs to

  matrix[P, A] zp;                       // standardized PLAYER self-report   (0 where absent)
  matrix[C, A] zc;                       // standardized CHARACTER self-report (0 where absent)
  matrix[P, A] has_zp;                   // 1 where a player self-report exists, else 0
  matrix[C, A] has_zc;                   // 1 where a character self-report exists, else 0
}

parameters {
  vector[A] alpha;                       // axis baseline (log rate per opportunity)

  vector[A] beta_p;                      // player self-report -> player latent
  vector[A] beta_c;                      // character self-report -> character latent

  matrix[P, A] phi_raw;                  // non-centered player effects
  matrix[C, A] theta_raw;                // non-centered character effects
  vector<lower=0>[A] sigma_player;       // spread of players around the population
  vector<lower=0>[A] sigma_char;         // spread of characters around THEIR PLAYER  <- the pooling strength

  vector[K] delta_raw;                   // non-centered campaign effects
  vector[S] gamma_raw;                   // non-centered session effects
  real<lower=0> sigma_camp;
  real<lower=0> sigma_sess;

  real<lower=0> nb_phi;                  // NB dispersion (named to avoid colliding with the player latent)
}

transformed parameters {
  matrix[P, A] phi;                      // PLAYER latent   (log scale)
  matrix[C, A] theta;                    // CHARACTER latent (log scale)
  vector[K] delta;
  vector[S] gamma;

  delta = sigma_camp * delta_raw;
  for (s in 1:S)
    gamma[s] = delta[camp[s]] + sigma_sess * gamma_raw[s];

  for (a in 1:A) {
    for (p in 1:P)
      // has_zp zeroes the self-report term where no elicitation exists, so an
      // absent inventory contributes nothing rather than silently acting as a
      // score of exactly average.
      phi[p, a] = beta_p[a] * zp[p, a] * has_zp[p, a]
                  + sigma_player[a] * phi_raw[p, a];

    for (c in 1:C)
      theta[c, a] = phi[owner[c], a]
                    + beta_c[a] * zc[c, a] * has_zc[c, a]
                    + sigma_char[a] * theta_raw[c, a];
  }
}

model {
  vector[N] mu;

  alpha        ~ normal(0, 2);

  // Regularized: lets self-report matter, does not force it to. A beta near zero on
  // some axis is a REAL RESULT (people's self-perception on that axis does not
  // predict their behavior), not a failure.
  beta_p       ~ normal(0, 0.7);
  beta_c       ~ normal(0, 0.7);

  sigma_player ~ normal(0, 1);           // half-normal via <lower=0>
  sigma_char   ~ normal(0, 1);
  sigma_camp   ~ normal(0, 0.5);
  sigma_sess   ~ normal(0, 0.5);

  to_vector(phi_raw)   ~ normal(0, 1);
  to_vector(theta_raw) ~ normal(0, 1);
  delta_raw    ~ normal(0, 1);
  gamma_raw    ~ normal(0, 1);
  nb_phi       ~ exponential(1);

  for (n in 1:N)
    mu[n] = exp(logE[n] + alpha[aa[n]] + theta[cc[n], aa[n]] + gamma[ss[n]]);

  y ~ neg_binomial_2(mu, nb_phi);
}

generated quantities {
  // The gap between what a person SAYS about themselves and how they actually play.
  // This is the quantity the whole design exists to produce, and it is deliberately
  // NOT shown to players by default (see disposition_reveals). It is computed here so
  // that it is a first-class output with an interval around it, rather than something
  // reconstructed later by subtracting two numbers and pretending the uncertainty
  // went away.
  matrix[P, A] player_gap;
  for (a in 1:A)
    for (p in 1:P)
      player_gap[p, a] = phi[p, a] - beta_p[a] * zp[p, a] * has_zp[p, a];
}
