# Wrangler disposition worker.
# R + CmdStan, with the model precompiled into the image so a run never pays
# compile time. Cloud Run Jobs invokes this once per execution; it fits and exits.

FROM rocker/r-ver:4.4.1

# System libraries:
#  - build-essential: CmdStan compiles C++ to fit the model
#  - libpq-dev: RPostgres talks to Supabase Postgres
#  - libcurl/libssl: cmdstanr downloads + TLS to the database
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      libpq-dev \
      libcurl4-openssl-dev \
      libssl-dev \
      ca-certificates \
      curl \
    && rm -rf /var/lib/apt/lists/*

# R packages. cmdstanr is on the Stan R-universe; the rest are on CRAN.
RUN Rscript -e 'install.packages(c("DBI","RPostgres","jsonlite","posterior"), repos="https://cloud.r-project.org")' \
 && Rscript -e 'install.packages("cmdstanr", repos=c("https://stan-dev.r-universe.dev","https://cloud.r-project.org"))'

# Build CmdStan into /opt and pin a stable symlink so CMDSTAN never depends on
# the version number.
RUN Rscript -e 'cmdstanr::install_cmdstan(dir="/opt", cores=2, overwrite=TRUE)' \
 && ln -s /opt/cmdstan-* /opt/cmdstan
ENV CMDSTAN=/opt/cmdstan

WORKDIR /app

# Precompile the model. This produces /app/disposition (the executable) next to
# the source, so at runtime cmdstan_model() sees it's current and skips the
# compile entirely.
#
# v2 NOTE: the two-level model has more parameters than v1 (a player latent, a
# campaign level, and two separate self-report loadings), so this layer takes
# somewhat longer to build. It is still a BUILD cost, paid once, not a RUN cost.
COPY disposition.stan /app/disposition.stan
RUN Rscript -e 'cmdstanr::cmdstan_model("/app/disposition.stan")'

COPY run.R /app/run.R

# One execution = one fit, then exit.
#
# v2 NOTE: the campaign id is still accepted as the first argument, but it no
# longer scopes the fit. v2 fits every campaign at once (a player's characters
# span campaigns, so a player latent cannot be estimated through a one-campaign
# keyhole). The argument now only identifies the disposition_runs row that the
# triggering GM is watching.
ENTRYPOINT ["Rscript", "/app/run.R"]
