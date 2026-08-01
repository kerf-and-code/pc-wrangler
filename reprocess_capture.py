#!/usr/bin/env python3
"""
reprocess_capture.py - push a RESCUED capture directory through the sidecar's own finalize.

WHY THIS EXISTS
The 2026-07-30/31 incident left a session's audio as loose per-speaker .ogg chunks on the sidecar's
ephemeral disk, with capture_control at 'done', capture_job_id NULL and no audio_tracks rows. Nothing
in the pipeline can see audio in that state: advance-jobs only picks up a capture_control row that is
'done' AND has a capture_job_id.

WHY IT IMPORTS sidecar.py INSTEAD OF REIMPLEMENTING
finalize() is where per-speaker CONSENT is enforced, and consent is the one thing that must not be
re-implemented from memory in a one-off script. Reusing it means speaker->character resolution, the
GM-narrator exemption, the opt-out check, silence padding for alignment, concat, upload, insert_track
with its retry/backoff, blob deletion on final failure, job creation and the capture_job_id stamp all
behave exactly as they do in production. This script's only job is to rebuild the Recording object
that finalize expects.

DEFAULT IS A DRY RUN. Nothing is uploaded, inserted or patched unless you pass --commit. The dry run
still reads the database (to resolve speakers and consent) so the report tells you who WOULD be
uploaded, who is unmapped, and who has not consented, before anything is written.

PREREQUISITES
  * ffmpeg on PATH. finalize shells out to it to concat each speaker's chunks into one track.
    ffprobe is NOT required: chunk durations are read from the Ogg granule positions directly, and
    ffprobe is only a fallback for a chunk whose container will not parse.
  * pip install httpx
  * Supabase credentials. Easiest is to run this from the repo root and let it read .env.local,
    which already holds them for the Next app. NOTE .env.local is a NEXT convention: Next loads it,
    Python does not, so this script parses it itself. It reads NEXT_PUBLIC_SUPABASE_URL (or
    SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY. Real environment variables win over the file, so
    `set` still works if you prefer. The service role key is required; the publishable/anon key
    cannot read or write these tables.

USAGE
  cd C:\\Users\\Test\\wrangler\\pc-wrangler
  python reprocess_capture.py --tar capture-717d7d09.tar.gz --rid 717d7d09-93d3-47c9-a5db-3054134aeac5
  python reprocess_capture.py --tar capture-717d7d09.tar.gz --rid 717d7d09-... --cutoff 2026-07-31T03:07:00Z
  python reprocess_capture.py --tar capture-717d7d09.tar.gz --rid 717d7d09-... --cutoff ... --commit

THE CUTOFF. Chunks are dropped when their file mtime is AFTER --cutoff. For this incident the real
session ran until roughly 03:07 UTC; everything after that is the investigation, recorded while one
person sat alone in the channel debugging. tar preserves mtimes, so the timestamps survive the
rescue. Run without --cutoff first to see the actual spread before choosing one.
"""

from __future__ import annotations

import argparse
import asyncio
import datetime
import os
import re
import shutil
import struct
import subprocess
import sys
import tarfile
import tempfile
import types
from collections import defaultdict

CHUNK_RE = re.compile(r"^(?P<uid>\d+)-(?P<idx>\d+)\.ogg$")


def load_env_local(path: str = ".env.local") -> list:
    """Read KEY=VALUE lines out of .env.local into os.environ.

    .env.local is a Next.js convention. Next loads it automatically for the web app; Python does
    not, so a plain `python script.py` sees none of it. Rather than make the operator copy a service
    role key onto a command line (where it lands in shell history), read the file the key already
    lives in.

    Real environment variables take precedence, so an explicit `set` still overrides the file.
    """
    loaded = []
    if not os.path.exists(path):
        return loaded
    with open(path, "r", encoding="utf-8-sig") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            if key.startswith("export "):
                key = key[len("export "):].strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value
                loaded.append(key)
    # The app calls the project URL NEXT_PUBLIC_SUPABASE_URL; sidecar.py wants SUPABASE_URL.
    if not os.environ.get("SUPABASE_URL") and os.environ.get("NEXT_PUBLIC_SUPABASE_URL"):
        os.environ["SUPABASE_URL"] = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
        loaded.append("SUPABASE_URL (from NEXT_PUBLIC_SUPABASE_URL)")
    return loaded


# --------------------------------------------------------------------------- sidecar import

def import_sidecar(sidecar_path: str):
    """Import sidecar.py without needing py-cord installed.

    Only the class definitions are needed here (Recording is rebuilt by hand and Sidecar is
    instantiated with object.__new__), so a stub that satisfies `class Sidecar(discord.Client)` and
    `class TimelineSink(discord.sinks.WaveSink)` at import time is enough. main() is behind an
    __main__ guard so nothing connects to Discord.
    """
    if "discord" not in sys.modules:
        stub = types.ModuleType("discord")

        class _Client:
            def __init__(self, *a, **k):
                pass

        class _WaveSink:
            def __init__(self, *a, **k):
                pass

        sinks = types.ModuleType("discord.sinks")
        sinks.WaveSink = _WaveSink
        stub.Client = _Client
        stub.sinks = sinks
        stub.__version__ = "stub"
        sys.modules["discord"] = stub
        sys.modules["discord.sinks"] = sinks

    directory = os.path.dirname(os.path.abspath(sidecar_path))
    if directory not in sys.path:
        sys.path.insert(0, directory)
    import importlib
    try:
        return importlib.import_module(os.path.splitext(os.path.basename(sidecar_path))[0])
    except ModuleNotFoundError as e:
        if e.name == "httpx":
            raise SystemExit(
                "sidecar.py needs httpx, which is not installed.\n"
                "  pip install httpx"
            ) from None
        raise


# --------------------------------------------------------------------------- chunk scanning

def ogg_seconds_native(path: str):
    """Duration read straight out of the Ogg container. Returns None if the file cannot be parsed.

    An Ogg page header carries a granule position, and for Opus that granule counts 48kHz samples,
    so the last page of the file gives the exact length once the encoder pre-skip (from OpusHead) is
    subtracted. No decoding and no subprocess.

    This exists because the ffprobe route does not scale to a rescued session. ~900 chunks means
    ~900 process launches, and on Windows that is minutes of wall clock dominated by process
    creation and antivirus scanning, during which the script looks hung. Reading the container is
    milliseconds for the whole set, and it is MORE accurate: ffprobe reports container duration
    including pre-skip, this subtracts it.
    """
    try:
        size = os.path.getsize(path)
        if size < 32:
            return None
        with open(path, "rb") as fh:
            head = fh.read(65536)
            pre_skip = 0
            i = head.find(b"OpusHead")
            if i != -1 and len(head) >= i + 12:
                pre_skip = struct.unpack_from("<H", head, i + 10)[0]
            tail_len = min(size, 65536)
            fh.seek(size - tail_len)
            tail = fh.read(tail_len)
        j = tail.rfind(b"OggS")
        if j == -1 or len(tail) < j + 14:
            return None
        granule = struct.unpack_from("<q", tail, j + 6)[0]
        if granule < 0:
            return None
        return max(0.0, (granule - pre_skip) / 48000.0)
    except Exception:
        return None


def ogg_seconds(path: str) -> float:
    """Duration of one chunk. finalize needs it twice: to pad speakers who missed a chunk so
    everyone stays time-aligned, and for audio_tracks.duration_seconds. Container read first,
    ffprobe only as a fallback for anything that will not parse."""
    native = ogg_seconds_native(path)
    if native is not None:
        return native
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            capture_output=True, text=True, timeout=60,
        )
        return float(out.stdout.strip())
    except Exception:
        return 0.0


def measure_all(paths: list, workers: int = 8) -> dict:
    """ffprobe every kept chunk, in parallel, with progress.

    A rescued session is ~900 chunks and each measurement is a separate ffprobe process. Done
    sequentially on Windows that is minutes of wall clock, almost all of it process creation and
    antivirus scanning rather than decoding, during which the script printed nothing and looked
    hung. The calls are independent and read-only, and subprocess.run releases the GIL while it
    waits, so a small thread pool collapses it to seconds.
    """
    from concurrent.futures import ThreadPoolExecutor

    total = len(paths)
    print(f"  measuring {total} chunk(s) ...", flush=True)
    out, done = {}, 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for path, secs in zip(paths, ex.map(ogg_seconds, paths)):
            out[path] = secs
            done += 1
            if done % 200 == 0 or done == total:
                print(f"    {done}/{total}", flush=True)
    return out


def scan(directory: str, cutoff: datetime.datetime | None):
    """Walk the capture directory and split chunks into kept and dropped."""
    kept = defaultdict(list)          # uid -> [(idx, path, seconds)]
    dropped = defaultdict(list)       # uid -> [(idx, path, mtime)]
    skipped: list[str] = []
    oldest = newest = None

    names = []
    for root, _dirs, files in os.walk(directory):
        for fn in files:
            m = CHUNK_RE.match(fn)
            if m:
                names.append((m.group("uid"), int(m.group("idx")), os.path.join(root, fn)))
            elif fn.lower().endswith((".ogg", ".wav")):
                skipped.append(fn)

    for uid, idx, path in sorted(names, key=lambda t: (t[0], t[1])):
        try:
            st = os.stat(path)
        except OSError:
            skipped.append(os.path.basename(path))
            continue
        mtime = datetime.datetime.fromtimestamp(st.st_mtime, datetime.timezone.utc)
        oldest = mtime if oldest is None or mtime < oldest else oldest
        newest = mtime if newest is None or mtime > newest else newest
        if st.st_size == 0:
            skipped.append(os.path.basename(path))
            continue
        if cutoff is not None and mtime > cutoff:
            dropped[uid].append((idx, path, mtime))
            continue
        kept[uid].append((idx, path, None))   # duration filled in below, in one parallel pass

    durations = measure_all([c[1] for chunks in kept.values() for c in chunks])
    for uid, chunks in kept.items():
        kept[uid] = [(idx, path, durations.get(path, 0.0)) for idx, path, _ in chunks]

    return kept, dropped, skipped, oldest, newest


# --------------------------------------------------------------------------- main

async def run(args) -> int:
    sc_mod = import_sidecar(args.sidecar)
    import httpx

    cutoff = None
    if args.cutoff:
        raw = args.cutoff.replace("Z", "+00:00")
        cutoff = datetime.datetime.fromisoformat(raw)
        if cutoff.tzinfo is None:
            cutoff = cutoff.replace(tzinfo=datetime.timezone.utc)

    # --- source directory -------------------------------------------------
    workdir = None
    if args.tar:
        workdir = tempfile.mkdtemp(prefix="reprocess-")
        print(f"extracting {args.tar} -> {workdir}")
        print("  (a rescued session is ~900 small files; if this crawls, extract once with")
        print("   Windows' own tar and re-run with --dir, which also skips it on later runs)")
        # Extract member by member rather than extractall, purely so there is PROGRESS. Python's
        # tarfile writing ~900 small files into %TEMP% can be slow when antivirus inspects each one,
        # and extractall prints nothing while it happens, which is indistinguishable from a hang.
        #
        # The filter is pinned rather than inherited: the default moved (3.12 warns when unset, 3.14
        # defaults to "data"). "data" is the safe one and PRESERVES MTIME, which this script depends
        # on entirely since --cutoff is applied by file mtime. Older Pythons lack the argument.
        count = 0
        with tarfile.open(args.tar, "r:gz") as tf:
            while True:
                member = tf.next()
                if member is None:
                    break
                try:
                    tf.extract(member, workdir, filter="data")
                except TypeError:
                    tf.extract(member, workdir)
                count += 1
                if count % 100 == 0:
                    print(f"    extracted {count} ...", flush=True)
        print(f"    extracted {count} member(s)")
        source = workdir
    else:
        source = args.dir

    kept, dropped, skipped, oldest, newest = scan(source, cutoff)
    if not kept:
        print("No usable chunks found. Nothing to do.")
        return 1

    print()
    print("CHUNKS ON DISK")
    print(f"  earliest chunk mtime : {oldest}")
    print(f"  latest chunk mtime   : {newest}")
    print(f"  cutoff               : {cutoff if cutoff else 'none (keeping everything)'}")
    if skipped:
        print(f"  skipped (unparsable or empty): {len(skipped)} -> {skipped[:5]}")
    print()
    print(f"{'SPEAKER':<22}{'KEPT':>7}{'DROPPED':>9}{'SECONDS':>10}")
    total_kept = total_dropped = 0
    for uid in sorted(set(list(kept) + list(dropped))):
        k, d = kept.get(uid, []), dropped.get(uid, [])
        total_kept += len(k)
        total_dropped += len(d)
        print(f"{uid:<22}{len(k):>7}{len(d):>9}{sum(c[2] for c in k):>10.1f}")
    print(f"{'TOTAL':<22}{total_kept:>7}{total_dropped:>9}")

    measured = [c[2] for chunks in kept.values() for c in chunks]
    zero = sum(1 for s in measured if s <= 0.0)
    if zero:
        print()
        print(f"  WARNING: {zero} of {len(measured)} kept chunks measured 0.0 seconds.")
        print("  Their Ogg pages could not be read AND ffprobe could not measure them either, so")
        print("  they are probably truncated or corrupt. finalize uses these durations to pad")
        print("  speakers who missed a chunk, so zeroes make the tracks drift out of alignment and")
        print("  write a wrong audio_tracks.duration_seconds. Investigate before using --commit.")

    # --- the control row --------------------------------------------------
    async with httpx.AsyncClient(timeout=60) as http:
        r = await http.get(
            f"{sc_mod.REST}/capture_control",
            params={"id": f"eq.{args.rid}", "select": "*"},
            headers=sc_mod.HEADERS,
        )
        r.raise_for_status()
        rows = r.json()
        if not rows:
            print(f"\nNo capture_control row with id {args.rid}.")
            return 1
        row = rows[0]
        campaign_id, session_id = row.get("campaign_id"), row.get("session_id")
        print()
        print("CONTROL ROW")
        print(f"  status         : {row.get('status')}")
        print(f"  capture_job_id : {row.get('capture_job_id')}")
        print(f"  campaign_id    : {campaign_id}")
        print(f"  session_id     : {session_id}")
        print(f"  error          : {row.get('error')}")
        if row.get("capture_job_id"):
            print("\n  This row ALREADY has a capture_job_id. Re-running would create a SECOND job")
            print("  and a second set of tracks. Stopping.")
            return 1
        if not (campaign_id and session_id):
            print("\n  Row is missing campaign_id or session_id; finalize cannot run.")
            return 1

        # --- build the Sidecar + Recording finalize expects ----------------
        bot = object.__new__(sc_mod.Sidecar)
        bot.recordings = {}

        class _VC:
            async def disconnect(self):
                return None

        rec = object.__new__(sc_mod.Recording)
        rec.rid = args.rid
        rec.vc = _VC()
        rec.campaign_id = campaign_id
        rec.session_id = session_id
        rec.flush_tasks = []
        rec.tmpdir = source
        rec.speaker_chunks = {uid: list(chunks) for uid, chunks in kept.items()}
        # Canonical length of each chunk window, taken as the max across speakers. finalize uses it
        # to pad a speaker who was silent for a chunk, which is what keeps the tracks aligned.
        canonical: dict = {}
        for chunks in kept.values():
            for idx, _path, secs in chunks:
                if secs > canonical.get(idx, 0.0):
                    canonical[idx] = secs
        rec.chunk_seconds = canonical
        rec.chunk_index = (max(canonical) + 1) if canonical else 0
        bot.recordings[rec.rid] = rec

        # --- who maps to whom, and who consented --------------------------
        consented, opted_out = await bot.load_consent(http, campaign_id, session_id)
        print()
        print("SPEAKER RESOLUTION (read-only)")
        would_upload = 0
        for uid in sorted(rec.speaker_chunks):
            gm_id = await bot.resolve_gm_identity(http, campaign_id, uid)
            char_id = None if gm_id else await bot.resolve_character(http, campaign_id, uid)
            if gm_id:
                verdict = f"GM narrator {gm_id} -> UPLOAD"
                would_upload += 1
            elif not char_id:
                verdict = "unmapped -> SKIP"
            elif char_id not in consented or char_id in opted_out:
                verdict = f"character {char_id} -> NO CONSENT, discarded"
            else:
                verdict = f"character {char_id} -> UPLOAD"
                would_upload += 1
            print(f"  {uid:<22} {verdict}")

        if not args.commit:
            print()
            print(f"DRY RUN. {would_upload} speaker track(s) would be uploaded.")
            print("Re-run with --commit to concat, upload, insert audio_tracks and create the job.")
            if workdir:
                shutil.rmtree(workdir, ignore_errors=True)
            return 0

        print()
        print("COMMITTING: running the sidecar's finalize ...")
        await bot.finalize(http, rec, note="manual reprocess of rescued capture")
        print("finalize returned. Check the STOPPED line above for the per-speaker accounting,")
        print("then confirm capture_control.capture_job_id is set and audio_tracks rows exist.")

    if workdir and os.path.isdir(workdir):
        shutil.rmtree(workdir, ignore_errors=True)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Reprocess a rescued sidecar capture directory.")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--tar", help="path to the rescued capture tar.gz")
    src.add_argument("--dir", help="path to an already-extracted capture directory (searched "
                                   "recursively; faster than --tar and skips re-extraction on "
                                   "repeat runs)")
    ap.add_argument("--rid", required=True, help="capture_control row id")
    ap.add_argument("--cutoff", help="drop chunks with mtime after this ISO time, e.g. 2026-07-31T03:07:00Z")
    ap.add_argument("--sidecar", default=os.path.join("sidecar", "sidecar.py"),
                    help="path to sidecar.py (default: sidecar/sidecar.py)")
    ap.add_argument("--env-file", default=".env.local",
                    help="env file to read credentials from (default: .env.local in the cwd)")
    ap.add_argument("--commit", action="store_true",
                    help="actually upload, insert tracks and create the job (default is a dry run)")
    args = ap.parse_args()

    if not os.path.exists(args.sidecar):
        print(f"Cannot find sidecar.py at {args.sidecar}. Pass --sidecar <path>.")
        return 1

    # Do this BEFORE importing sidecar.py, which reads os.environ["SUPABASE_URL"] at import time.
    loaded = load_env_local(args.env_file)
    if loaded:
        print(f"read {args.env_file}: {', '.join(loaded)}")

    if not os.environ.get("SUPABASE_URL"):
        print("No Supabase URL. Either run this from the repo root so .env.local is found, or:")
        print("  set NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co")
        return 1
    if not os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        print("SUPABASE_SERVICE_ROLE_KEY is not set, and was not in .env.local.")
        print("It is in the Supabase dashboard under Project Settings -> API. The publishable")
        print("key will not work: these tables are service-role only.")
        return 1
    os.environ.setdefault("DISCORD_BOT_TOKEN", "unused-by-this-script")
    return asyncio.run(run(args))


if __name__ == "__main__":
    sys.exit(main())
