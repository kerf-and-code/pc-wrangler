FROM python:3.12-slim

# git: to pip-install the pinned py-cord branch. libopus0: voice decode (used from Stage 2).
RUN apt-get update && apt-get install -y --no-install-recommends \
      git libopus0 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# py-cord's fix/voice-rec-2 branch (the one that receives DAVE audio), with the [voice] extra pulling
# PyNaCl + davey. Pinned to a COMMIT, not the branch (push 10, audit T20): a branch can move or vanish
# under the next deploy. 10a5e8c is the branch head of 2026-09-05 ("Merge branch 'master' into
# fix/voice-rec-2"), unchanged since, so it is what the current machine was built from. To move it on,
# test a newer commit on a scratch table first, then change the hash here.
#
# davey PINNED (push 58, 2026-11-13). The [voice] extra asks only for davey>=0.1.4,<1, so the image
# rebuilt for pushes 43 and 50 on 2026-11-12 picked up davey 0.2.0 (released 2026-11-02). 0.2.0 changed
# how DAVE keys take effect: after process_welcome / process_commit the caller must now call
# prepare_transition and execute_transition before the new keys are used. The pinned py-cord commit
# predates that and never calls them, so incoming voice was not decrypted and the opus decoder turned
# ciphertext into noise. Crowned Calamity session 19 (2026-11-12) was recorded that way: every track is
# broadband noise bursts, which Whisper transcribed as nonsense. 0.1.7 is the last release with the
# old behaviour. Do NOT lift this pin without also moving py-cord to a commit that calls the
# transition methods, and testing on a scratch table first.
RUN pip install --no-cache-dir \
      "py-cord[voice] @ git+https://github.com/Pycord-Development/pycord@10a5e8cf13bd8db21f95baf62cf866056d1e1091" \
      "davey==0.1.7" \
      "httpx>=0.27"

COPY sidecar.py .

# -u so logs stream to Fly in real time.
CMD ["python", "-u", "sidecar.py"]
