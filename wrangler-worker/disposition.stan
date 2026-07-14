// Wrangler — disposition model
// Hierarchical negative-binomial. Response-event counts per character x session
// x axis, with an exposure offset for how many opportunities of that axis the
// session presented, and an informative prior from the TPDI self-report.
//
// theta[c,a] is the quantity of interest: character c's behavioral disposition
// on axis a (log-rate scale). beta[a] is how strongly self-report predicts
// behavior on axis a (a validity diagnostic, estimated, not assumed).

data {
  int<lower=1> N;                       // observations (char x session x axis, exposure >= 1)
  int<lower=1> C;                       // characters (PCs)
  int<lower=1> S;                       // sessions
  int<lower=1> A;                       // axes (6)
  array[N] int<lower=0> y;              // response-event counts
  vector[N] logE;                       // log exposure = log(opportunities)
  array[N] int<lower=1, upper=C> cc;    // character index
  array[N] int<lower=1, upper=S> ss;    // session index
  array[N] int<lower=1, upper=A> aa;    // axis index
  matrix[C, A] z;                       // standardized TPDI prior (0 where missing)
}

parameters {
  vector[A] alpha;                      // axis baseline (log rate per opportunity)
  vector[A] beta;                       // self-report -> behavior loading
  matrix[C, A] theta_raw;               // non-centered character x axis effects
  vector<lower=0>[A] sigma_axis;        // residual disposition spread, per axis
  vector[S] gamma_raw;                  // non-centered session effects
  real<lower=0> sigma_sess;             // session spread
  real<lower=0> phi;                    // NB dispersion
}

transformed parameters {
  matrix[C, A] theta;                   // latent disposition (log scale)
  vector[S] gamma;
  for (a in 1:A)
    for (c in 1:C)
      theta[c, a] = beta[a] * z[c, a] + sigma_axis[a] * theta_raw[c, a];
  gamma = sigma_sess * gamma_raw;
}

model {
  vector[N] mu;

  alpha       ~ normal(0, 2);
  beta        ~ normal(0, 0.7);         // regularized; lets self-report matter, doesn't force it
  sigma_axis  ~ normal(0, 1);           // half-normal via <lower=0>
  sigma_sess  ~ normal(0, 0.5);
  to_vector(theta_raw) ~ normal(0, 1);
  gamma_raw   ~ normal(0, 1);
  phi         ~ exponential(1);

  for (n in 1:N)
    mu[n] = exp(logE[n] + alpha[aa[n]] + theta[cc[n], aa[n]] + gamma[ss[n]]);

  y ~ neg_binomial_2(mu, phi);
}
