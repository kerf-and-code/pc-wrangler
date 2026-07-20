"""
Six Axes voice sidecar - Stage 4: hardened capture for real, multi-hour sessions.

What Stage 4 adds over Stage 3:
  1. Chunked capture: the sink is rotated every FLUSH_SECONDS. Each finished chunk is
     compressed to Opus (.ogg, mono 32kbps) on local disk immediately, so memory stays
     bounded (~one chunk of PCM) instead of holding a whole session of WAV in RAM.
  2. On /stop, each speaker's chunks are concatenated into ONE continuous .ogg,
     time-aligned across speakers (late joiners get leading silence), uploaded to the
     session-audio bucket, and written as a single audio_tracks row per speaker.
  3. OpusError-on-rekey guard: a corrupted packet during a DAVE rekey (someone joins or
     leaves voice) no longer kills the recording; the packet is skipped.
  4. Reconnect handling: if the voice connection drops mid-session (1006 etc.), the
     current chunk is salvaged, the sidecar reconnects to the channel, and recording
     resumes into a new chunk.

The output contract is unchanged from Stage 3: one draft capture job (source 'online'),
one pending audio_tracks row per attributable speaker, consent-gated Deepgram submission
stays the GM's in-app action.

Env:
  DISCORD_BOT_TOKEN
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  POLL_SECONDS               (optional, default 4)
  STOP_READ_DELAY_SECONDS    (optional, default 3; wait after stop_recording before reading sink)
  FLUSH_SECONDS              (optional, default 60; sink rotation interval. This is a
                             MEMORY control: TimelineSink writes dense PCM, so a chunk
                             costs rate * 4 bytes * FLUSH_SECONDS per speaker. At 300 s
                             that is 57.6 MB each, which OOM-killed a 1 GB machine.)
  AUDIO_BUCKET               (optional, default 'session-audio')
  OPUS_BITRATE               (optional, default '32k')
"""

import os
import io
import time
import wave
import shutil
import asyncio
import datetime
import logging
import tempfile
import httpx
import discord

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("discord.voice.receive.reader").setLevel(logging.WARNING)
log = logging.getLogger("sidecar")

TOKEN = os.environ["DISCORD_BOT_TOKEN"]
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
POLL_SECONDS = int(os.environ.get("POLL_SECONDS", "4"))
STOP_READ_DELAY_SECONDS = int(os.environ.get("STOP_READ_DELAY_SECONDS", "3"))
FLUSH_SECONDS = int(os.environ.get("FLUSH_SECONDS", "60"))
# When an audio_tracks row cannot be created, keep the uploaded file (1) or delete it
# (0, default). Keeping it preserves the audio for manual recovery but leaves an object
# the retention cron cannot see, because retention iterates audio_tracks.
KEEP_ORPHANED_AUDIO = os.environ.get("KEEP_ORPHANED_AUDIO", "0") == "1"
AUDIO_BUCKET = os.environ.get("AUDIO_BUCKET", "session-audio")
OPUS_BITRATE = os.environ.get("OPUS_BITRATE", "32k")
# Opt-in probe: when set, log RTCP Sender Reports (ssrc + NTP/RTP pair) so a test
# recording can confirm whether Discord emits the reports needed for frame-exact
# cross-speaker sync. Off in normal operation to keep logs quiet.
RTCP_PROBE = bool(os.environ.get("RTCP_PROBE"))

REST = f"{SUPABASE_URL}/rest/v1"
STORAGE = f"{SUPABASE_URL}/storage/v1/object"
HEADERS = {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"}
WRITE_HEADERS = {**HEADERS, "Content-Type": "application/json", "Prefer": "return=minimal"}
RETURN_HEADERS = {**HEADERS, "Content-Type": "application/json", "Prefer": "return=representation"}


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def install_opus_rekey_guard():
    """A corrupted packet during a DAVE rekey raises OpusError inside PacketRouter._do_run
    and, unguarded, kills the whole recording. The packet is already consumed from the
    jitter buffer at that point, so it is safe to skip it and resume the loop."""
    try:
        from discord.opus import OpusError
        from discord.voice.receive import router as _router
        original = _router.PacketRouter._do_run

        def guarded(self, *a, **kw):
            while True:
                try:
                    return original(self, *a, **kw)
                except OpusError as e:
                    log.warning("OpusError in packet router (rekey glitch); skipping packet: %r", e)

        _router.PacketRouter._do_run = guarded
        log.info("Opus rekey guard installed.")
    except Exception as e:
        log.warning("Opus rekey guard NOT installed (recording still works, rekeys are riskier): %r", e)


async def _after_record(sink, *args):
    # The branch's after-callback is unreliable; all real work reads the sink directly.
    return


async def encode_wav_to_ogg(wav_path: str, out_path: str, pad_to_seconds: float = 0.0) -> bool:
    """Compress a WAV chunk on disk to mono Opus .ogg via ffmpeg, optionally padding it
    with trailing silence so it spans pad_to_seconds.

    Reads from a FILE, not a stdin pipe, and pads inside ffmpeg rather than in Python.
    The previous version took the whole WAV as bytes and was fed a blob that had already
    been copied three times to add the padding, so one 300 s speaker chunk could cost
    over 200 MB of resident memory at flush. Here nothing larger than ffmpeg's own
    buffers is held.

    Padding uses 'apad' (pad forever) plus '-t' (cut at an exact duration), which is the
    robust idiom for 'make this exactly N seconds long'. Because pad_to_seconds is always
    computed as at least the input's own length, this never truncates real audio.
    """
    try:
        args = [
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-i", wav_path, "-ac", "1",
        ]
        if pad_to_seconds and pad_to_seconds > 0:
            args += ["-af", "apad", "-t", f"{pad_to_seconds:.3f}"]
        args += ["-c:a", "libopus", "-b:a", OPUS_BITRATE, "-f", "ogg", "-y", out_path]
        proc = await asyncio.create_subprocess_exec(
            *args,
            stderr=asyncio.subprocess.PIPE,
        )
        _, err = await proc.communicate()
        if proc.returncode != 0:
            log.warning("ffmpeg chunk encode failed: %s", (err or b"").decode(errors="replace")[:300])
            return False
        return True
    except Exception as e:
        log.warning("ffmpeg chunk encode error: %r", e)
        return False


async def make_silence_ogg(seconds: float, out_path: str) -> bool:
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono",
            "-t", f"{max(seconds, 0.05):.3f}", "-c:a", "libopus", "-b:a", OPUS_BITRATE,
            "-f", "ogg", "-y", out_path,
            stderr=asyncio.subprocess.PIPE,
        )
        _, err = await proc.communicate()
        if proc.returncode != 0:
            log.warning("ffmpeg silence gen failed: %s", (err or b"").decode(errors="replace")[:300])
            return False
        return True
    except Exception as e:
        log.warning("ffmpeg silence gen error: %r", e)
        return False


async def _run_concat(list_path: str, out_path: str, copy: bool) -> bool:
    """One ffmpeg concat pass. copy=True stream-copies, copy=False re-encodes."""
    codec = ["-c", "copy"] if copy else ["-c:a", "libopus", "-b:a", OPUS_BITRATE]
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-f", "concat", "-safe", "0", "-i", list_path,
            *codec, "-f", "ogg", "-y", out_path,
            stderr=asyncio.subprocess.PIPE,
        )
        _, err = await proc.communicate()
        if proc.returncode != 0:
            log.info("concat (%s) failed: %s",
                     "copy" if copy else "re-encode",
                     (err or b"").decode(errors="replace")[:300])
            return False
        return True
    except Exception as e:
        log.info("concat (%s) error: %r", "copy" if copy else "re-encode", e)
        return False


async def concat_oggs(paths: list, out_path: str) -> bool:
    """Concatenate ogg chunks into one continuous ogg.

    STREAM COPY FIRST, re-encode only as a fallback.

    Every chunk here was written by encode_wav_to_ogg with identical parameters (same
    codec, same bitrate, same channel count), which is exactly the condition under which
    the concat demuxer can stitch them with -c copy: it moves the existing packets and
    never decodes a sample.

    The old version always re-encoded. On a 2h34m seven-speaker session at 60-second
    chunks that meant decoding and re-encoding 147 files per speaker, which took about 35
    minutes EACH and 3.5 hours in total on a shared-cpu-1x, while the capture_control row
    sat at 'stopping' and held the guild lock the whole time. Stream copy does the same
    job in seconds.

    The fallback matters: a malformed or truncated chunk can make the demuxer refuse, and
    re-encoding is more tolerant. Degrading to slow is much better than losing a session.

    A copy that "succeeds" but silently truncates would be worse than a failure, so the
    output is size-checked against the sum of its inputs before being accepted. Stream
    copy preserves the audio payload almost exactly, so anything under 90 percent means
    parts went missing and we re-encode instead. This deliberately avoids ffprobe, which
    is not guaranteed to be present in the image."""
    list_path = out_path + ".txt"
    try:
        with open(list_path, "w") as f:
            for p in paths:
                f.write(f"file '{p}'\n")

        expected = 0
        for p in paths:
            try:
                expected += os.path.getsize(p)
            except Exception:
                pass

        if await _run_concat(list_path, out_path, copy=True):
            try:
                produced = os.path.getsize(out_path)
            except Exception:
                produced = 0
            if expected == 0 or produced >= expected * 0.9:
                log.info("concat: stream copied %d part(s), %d KB", len(paths), produced // 1024)
                return True
            log.warning("concat: stream copy produced %d KB from %d KB of parts; re-encoding instead.",
                        produced // 1024, expected // 1024)

        log.info("concat: falling back to re-encode for %d part(s)", len(paths))
        return await _run_concat(list_path, out_path, copy=False)
    except Exception as e:
        log.warning("ffmpeg concat error: %r", e)
        return False
    finally:
        try:
            os.remove(list_path)
        except Exception:
            pass


# PCM shape that WaveSink writes, taken from the branch's OpusDecoder: 48 kHz,
# 2 channels, 16-bit. One 48 kHz sample frame is CHANNELS * width = 4 bytes, and a
# 20 ms Opus packet is 960 sample frames, which is also the RTP timestamp step.
_PCM_RATE = 48000
_PCM_FRAME_BYTES = 4          # 2 channels * 2 bytes
_MAX_SILENCE_FRAMES = _PCM_RATE * 30   # never fabricate more than 30 s in one gap


def _wav_seconds(path: str) -> float:
    """Duration of a WAV on disk, read from its HEADER only. Never loads the samples,
    which is the point: flush needs every speaker's length before it can decide the
    chunk window, and reading frames to get it was one of the copies that OOMed the
    machine."""
    try:
        with wave.open(path, "rb") as w:
            frames, rate = w.getnframes(), w.getframerate()
        return (frames / rate) if (frames and rate) else 0.0
    except Exception:
        return 0.0


class TimelineSink(discord.sinks.WaveSink):
    """A WaveSink that reconstructs real time.

    Stock WaveSink writes only the PCM it receives, so a speaker's silences (before
    their first word and between utterances) are dropped and every speaker collapses
    to their own talk-time on a private clock. That is what made 3-hour sessions look
    like 70 minutes and scrambled the transcript timeline.

    This sink restores the silence so each speaker's chunk buffer spans the real
    chunk window:

      * Leading silence: perf_counter() at a speaker's first packet in the chunk,
        minus the chunk start, positions them within the window. This is arrival
        based, so it is accurate to the jitter-buffer depth, not frame-exact. RTP
        timestamps are per-speaker (each SSRC has its own random base) and cannot
        align speakers to one another, so arrival time is the only shared reference
        available for intra-chunk position.
      * Interior silence: the RTP timestamp gap between a speaker's own consecutive
        packets is an exact 48 kHz sample count, so their internal timing is
        reconstructed precisely.

    Trailing silence to fill the window is added at flush by ffmpeg, once
    the chunk's real duration is known. The chunk boundary itself is the shared clock
    that keeps speakers aligned across the whole session.
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.start_perf = time.perf_counter()   # chunk start, arrival clock
        self.stop_perf = None                   # set by rotate_chunk when the chunk closes
        self._expected: dict = {}               # user -> next expected RTP timestamp
        self._seen: set = set()                 # users already anchored with leading silence

    # The event router registers listeners it finds in __sink_listeners__ as
    # (lookup_key, method_name); it dispatches "rtcp_packet" to the "on_rtcp_packet"
    # key and calls the method as handler(packet, guild). Registering here is safe:
    # if the mechanism ever differs, the handler simply never fires, and listener
    # exceptions are caught by the router rather than affecting the recording.
    __sink_listeners__ = [("on_rtcp_packet", "on_rtcp_packet")]

    def on_rtcp_packet(self, packet, guild):
        # Probe only. Sender Reports (RTCP type 200) carry the NTP/RTP pair that would
        # let us map every speaker's private RTP clock onto one shared wall clock, for
        # frame-exact cross-speaker alignment. This logs them so a test recording can
        # confirm Discord actually sends them; it changes nothing about capture.
        if not RTCP_PROBE:
            return
        try:
            if getattr(packet, "type", None) == 200:
                info = getattr(packet, "info", None)
                log.info("RTCP SR: ssrc=%s ntp_ts=%s rtp_ts=%s",
                         getattr(packet, "ssrc", None),
                         getattr(info, "ntp_ts", None),
                         getattr(info, "rtp_ts", None))
        except Exception as e:
            log.warning("rtcp probe error: %r", e)

    def _silence(self, frames: int) -> bytes:
        n = max(0, min(int(frames), _MAX_SILENCE_FRAMES))
        return b"\x00" * (n * _PCM_FRAME_BYTES)

    def write(self, data, user):
        # Extract PCM and the RTP timestamp without importing branch internals: a
        # VoiceData exposes .pcm and .packet.timestamp; a raw bytes payload does not.
        if hasattr(data, "pcm"):
            pcm = data.pcm
            pkt = getattr(data, "packet", None)
            rtp = getattr(pkt, "timestamp", None) if pkt is not None else None
        else:
            pcm = data
            rtp = None
        if not pcm:
            return

        if user not in self.audio_data:
            self.audio_data[user] = discord.sinks.core.AudioData(io.BytesIO())
        buf = self.audio_data[user]
        samples = len(pcm) // _PCM_FRAME_BYTES   # per-channel sample frames in this packet

        if user not in self._seen:
            # First packet from this speaker in this chunk: place them in the window.
            self._seen.add(user)
            lead = int(max(0.0, time.perf_counter() - self.start_perf) * _PCM_RATE)
            if lead > 0:
                buf.write(self._silence(lead))
            buf.write(pcm)
            if rtp is not None:
                self._expected[user] = (rtp + samples) & 0xFFFFFFFF
            return

        if rtp is not None and user in self._expected:
            gap = (rtp - self._expected[user]) & 0xFFFFFFFF   # unsigned 32-bit delta
            # Only fabricate silence for a plausible gap. A huge delta is an SSRC
            # reset or a wraparound, not real silence, so we do not invent it.
            if 0 < gap <= _MAX_SILENCE_FRAMES:
                buf.write(self._silence(gap))
            buf.write(pcm)
            self._expected[user] = (rtp + samples) & 0xFFFFFFFF
        else:
            buf.write(pcm)


class Recording:
    """State for one capture_control request being recorded."""

    def __init__(self, rid, vc, channel_id, guild_id, campaign_id, session_id):
        self.rid = rid
        self.vc = vc
        self.channel_id = channel_id
        self.guild_id = guild_id
        self.campaign_id = campaign_id
        self.session_id = session_id
        self.sink = None
        self.chunk_index = 0
        self.chunk_started_at = time.monotonic()
        self.tmpdir = tempfile.mkdtemp(prefix=f"capture-{rid[:8]}-")
        # uid -> list of (chunk_index, ogg_path, seconds)
        self.speaker_chunks: dict = {}
        # chunk_index -> canonical seconds (max over speakers), for silence padding
        self.chunk_seconds: dict = {}
        self.flush_tasks: list = []
        self.reconnect_attempts = 0
        self.notify_channel_id = None   # campaign's linked Discord text channel
        self.notified_drop = False      # one drop notice per outage, cleared on reconnect

    def cleanup(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)


class Sidecar(discord.Client):
    def __init__(self, **kw):
        super().__init__(**kw)
        self.voice_locations: dict = {}   # (guild_id, user_id) -> channel_id
        self.recordings: dict = {}        # rid -> Recording
        self.waiting_logged: set = set()
        self._started = False

    async def on_ready(self):
        log.info("Sidecar connected as %s. py-cord %s.", self.user, discord.__version__)
        for guild in self.guilds:
            for ch in guild.voice_channels:
                for member in ch.members:
                    self.voice_locations[(str(guild.id), str(member.id))] = str(ch.id)
        log.info("Seeded %d voice location(s).", len(self.voice_locations))
        if not self._started:
            self._started = True
            asyncio.create_task(self.poll_loop())

    async def on_voice_state_update(self, member, before, after):
        key = (str(member.guild.id), str(member.id))
        if after.channel is not None:
            self.voice_locations[key] = str(after.channel.id)
            log.info("voice: user %s -> channel %s", member.id, after.channel.id)
        else:
            self.voice_locations.pop(key, None)
            log.info("voice: user %s left voice", member.id)

    # ------------------------------------------------------------------ poll

    async def poll_loop(self):
        await self.wait_until_ready()
        log.info("Poller started (every %ss, chunk rotation every %ss).", POLL_SECONDS, FLUSH_SECONDS)
        ticks = 0
        async with httpx.AsyncClient(timeout=60) as http:
            while not self.is_closed():
                try:
                    r = await http.get(
                        f"{REST}/capture_control",
                        params={"status": "in.(requested,stopping)", "select": "*"},
                        headers=HEADERS,
                    )
                    r.raise_for_status()
                    for row in r.json():
                        try:
                            await self.handle_control_row(http, row)
                        except Exception as e:
                            log.warning("row %s error: %r", row.get("id"), e)
                    await self.maintain_recordings(http)
                    ticks += 1
                    if ticks % 15 == 0:
                        log.info("poll alive: tick %d, %d active recording(s), tracking %d voice location(s)",
                                 ticks, len(self.recordings), len(self.voice_locations))
                except Exception as e:
                    log.warning("poll error: %r", e)
                await asyncio.sleep(POLL_SECONDS)

    async def handle_control_row(self, http, row):
        status = row.get("status")
        if status == "requested":
            await self.try_start(http, row)
        elif status == "stopping":
            await self.do_stop(http, row)

    async def maintain_recordings(self, http):
        """Per-tick upkeep on active recordings: chunk rotation and dead-connection recovery."""
        for rec in list(self.recordings.values()):
            # Recover a dropped voice connection (1006 etc.).
            if not rec.vc.is_connected():
                log.warning("recording %s: voice connection lost; salvaging chunk and reconnecting.", rec.rid)
                # Tell the GM once per outage, and explicitly ask them NOT to re-run
                # /record. The bot comes back on its own; a manual restart during the
                # gap is exactly what lands a recording in the wrong channel.
                if not rec.notified_drop:
                    rec.notified_drop = True
                    await self.notify(
                        rec.notify_channel_id,
                        "\u26A0\uFE0F Six Axes lost its voice connection and is reconnecting. "
                        "Please stay in the voice channel and do NOT run /record again; "
                        "it will come back on its own.",
                    )
                await self.rotate_chunk(rec, restart=False)
                if await self.reconnect(rec):
                    rec.notified_drop = False
                    await self.notify(
                        rec.notify_channel_id,
                        "\u2705 Six Axes reconnected and is recording again.",
                    )
                else:
                    rec.reconnect_attempts += 1
                    if rec.reconnect_attempts >= 5:
                        log.warning("recording %s: reconnect failed %d times; finalizing with what we have.",
                                    rec.rid, rec.reconnect_attempts)
                        await self.notify(
                            rec.notify_channel_id,
                            "\u274C Six Axes could not reconnect after several tries and has finalized "
                            "this recording with what it captured. Run /record to start a new segment.",
                        )
                        await self.finalize(http, rec, note="connection lost; partial capture")
                continue
            rec.reconnect_attempts = 0
            # Rotate the sink on schedule to bound memory.
            if time.monotonic() - rec.chunk_started_at >= FLUSH_SECONDS:
                await self.rotate_chunk(rec, restart=True)

    # ----------------------------------------------------------- start / stop

    async def try_start(self, http, row):
        rid = row["id"]
        if rid in self.recordings:
            return
        g = str(row.get("guild_id"))
        u = str(row.get("requested_by_discord_id"))
        chan_id = self.voice_locations.get((g, u))
        if not chan_id:
            if rid not in self.waiting_logged:
                self.waiting_logged.add(rid)
                log.info("request %s: user %s not in a voice channel yet; waiting to join.", rid, u)
            return
        channel = self.get_channel(int(chan_id))
        if channel is None:
            log.warning("request %s: channel %s not in cache; skipping this tick.", rid, chan_id)
            return
        try:
            vc = await channel.connect(timeout=30.0, reconnect=False)
        except Exception as e:
            log.warning("request %s: connect failed: %r", rid, e)
            await self.patch_status(http, rid, "error", error=f"connect failed: {e}")
            return
        rec = Recording(rid, vc, chan_id, g, row.get("campaign_id"), row.get("session_id"))
        rec.sink = TimelineSink()
        try:
            vc.start_recording(rec.sink, _after_record)
        except Exception as e:
            log.warning("request %s: start_recording failed: %r", rid, e)
            try:
                await vc.disconnect()
            except Exception:
                pass
            rec.cleanup()
            await self.patch_status(http, rid, "error", error=f"start_recording failed: {e}")
            return
        rec.notify_channel_id = await self.get_notify_channel(http, rec.campaign_id)
        self.recordings[rid] = rec
        self.waiting_logged.discard(rid)
        # Persist the voice channel (Layer 2) so recovery and diagnostics never have
        # to guess it from in-memory voice tracking.
        await self.patch_status(http, rid, "active", channel_id=chan_id)
        log.info("RECORDING started: request %s in channel %s (session %s).", rid, chan_id, row.get("session_id"))

    async def rotate_chunk(self, rec: Recording, restart: bool):
        """Stop the current sink, (optionally) start a fresh one immediately, then read and
        compress the finished sink in the background. Keeps memory to ~one chunk of PCM."""
        old_sink = rec.sink
        idx = rec.chunk_index
        # Stamp the chunk's real close time on the same clock the sink started on, so
        # flush knows the true wall-clock length of this chunk window.
        if old_sink is not None and getattr(old_sink, "stop_perf", None) is None:
            old_sink.stop_perf = time.perf_counter()
        try:
            rec.vc.stop_recording()
        except Exception as e:
            log.warning("recording %s: stop_recording during rotation raised: %r", rec.rid, e)
        if restart:
            new_sink = TimelineSink()
            try:
                rec.vc.start_recording(new_sink, _after_record)
                rec.sink = new_sink
            except Exception as e:
                log.warning("recording %s: restart after rotation failed (%r); trying full reconnect.", rec.rid, e)
                rec.sink = None
                await self.reconnect(rec)
        rec.chunk_index += 1
        rec.chunk_started_at = time.monotonic()
        task = asyncio.create_task(self.flush_sink(rec, old_sink, idx))
        rec.flush_tasks.append(task)

    async def flush_sink(self, rec: Recording, sink, idx: int):
        """Read a finished sink (direct read, after the proven delay) and encode each
        speaker's chunk to .ogg on disk.

        MEMORY. TimelineSink buffers are dense: every speaker holds
        FLUSH_SECONDS * 48000 * 4 bytes whether they spoke or not. The old flush then
        multiplied that, holding every speaker's blob at once (it needed them all before
        it could pick the chunk window), making three more copies per speaker to pad, and
        piping a fourth through ffmpeg's stdin, all while the replacement sink was already
        filling. That is what exhausted a 1 GB machine mid-session.

        This version never holds a whole track in Python. Pass one streams each speaker
        out to a temp WAV and takes the duration from the header. The sink's buffers are
        then released. Pass two encodes one file at a time, padding inside ffmpeg, and
        deletes each staging WAV as it goes. Peak resident memory during flush is now
        roughly the copy buffer, and the transient cost moved to disk."""
        await asyncio.sleep(STOP_READ_DELAY_SECONDS)
        try:
            audio = getattr(sink, "audio_data", {}) or {}
        except Exception as e:
            log.warning("chunk %d: sink read failed: %r", idx, e)
            return

        # Pass 1: stage every speaker to disk and measure it from the header. The sink
        # already inserted leading and interior silence, so each staged WAV spans from
        # chunk start to that speaker's last packet.
        staged = {}
        max_secs = 0.0
        for key, data in list(audio.items()):
            uid = str(getattr(key, "id", key))
            wav_path = os.path.join(rec.tmpdir, f"{uid}-{idx}.wav")
            try:
                data.file.seek(0)
                with open(wav_path, "wb") as fh:
                    shutil.copyfileobj(data.file, fh, 1024 * 1024)
            except Exception as e:
                log.warning("chunk %d: could not stage track for %s: %r", idx, uid, e)
                continue
            secs = _wav_seconds(wav_path)
            staged[uid] = (wav_path, secs)
            max_secs = max(max_secs, secs)

        # Everything is on disk now, so drop the sink's buffers. This is the single
        # biggest reclaim: without it the retired sink stays alive for the whole encode
        # while the new sink is already growing beside it.
        try:
            audio.clear()
        except Exception:
            pass

        # The chunk's real wall-clock length, from the sink's own start/stop stamps,
        # never shorter than the longest reconstructed speaker. Every speaker (present
        # or absent) is aligned to this one length, which is what keeps chunks lined
        # up when they are concatenated across the whole session.
        start_perf = getattr(sink, "start_perf", None)
        stop_perf = getattr(sink, "stop_perf", None)
        timed = (stop_perf - start_perf) if (start_perf is not None and stop_perf is not None) else 0.0
        chunk_wall = max(timed, max_secs)

        # Pass 2: one speaker at a time, staging WAV deleted as soon as it is encoded.
        for uid, (wav_path, secs) in staged.items():
            # chunk_wall is >= every speaker's own length by construction, so this max is
            # defensive only. It preserves the old padder's contract: never truncate.
            target = max(chunk_wall, secs)
            try:
                staged_kb = os.path.getsize(wav_path) // 1024
            except Exception:
                staged_kb = 0
            out = os.path.join(rec.tmpdir, f"{uid}-{idx}.ogg")
            ok = await encode_wav_to_ogg(wav_path, out, pad_to_seconds=target)
            try:
                os.remove(wav_path)
            except Exception:
                pass
            if ok:
                rec.speaker_chunks.setdefault(uid, []).append((idx, out, target))
                log.info("  chunk %d: speaker %s %.1fs speech, padded to %.1fs (%d KB staged wav -> ogg)",
                         idx, uid, secs, target, staged_kb)
        rec.chunk_seconds[idx] = chunk_wall

    async def reconnect(self, rec: Recording) -> bool:
        try:
            try:
                await rec.vc.disconnect(force=True)
            except Exception:
                pass
            channel = self.get_channel(int(rec.channel_id))
            if channel is None:
                return False
            rec.vc = await channel.connect(timeout=30.0, reconnect=False)
            rec.sink = TimelineSink()
            rec.vc.start_recording(rec.sink, _after_record)
            rec.chunk_started_at = time.monotonic()
            log.info("recording %s: reconnected and resumed (chunk %d).", rec.rid, rec.chunk_index)
            return True
        except Exception as e:
            log.warning("recording %s: reconnect failed: %r", rec.rid, e)
            return False

    async def do_stop(self, http, row):
        rid = row["id"]
        rec = self.recordings.get(rid)
        self.waiting_logged.discard(rid)
        if rec is None:
            log.info("stop %s: no active recording in this process; marking done.", rid)
            await self.patch_status(http, rid, "done")
            return
        # Final rotation (no restart), then finalize.
        if rec.sink is not None:
            await self.rotate_chunk(rec, restart=False)
        await self.finalize(http, rec)

    async def finalize(self, http, rec: Recording, note=None):
        self.recordings.pop(rec.rid, None)
        try:
            await rec.vc.disconnect()
        except Exception:
            pass
        if rec.flush_tasks:
            await asyncio.gather(*rec.flush_tasks, return_exceptions=True)

        if not rec.speaker_chunks:
            log.info("stop %s: no audio captured; marking done.", rec.rid)
            await self.patch_status(http, rec.rid, "done", error=note)
            rec.cleanup()
            return
        if not (rec.campaign_id and rec.session_id):
            await self.patch_status(http, rec.rid, "error", error="missing campaign or session")
            rec.cleanup()
            return

        # Attribute speakers -> a player character or the GM narrator; build one
        # continuous ogg per mapped speaker.
        job_id = await self.create_job(http, rec.campaign_id, rec.session_id)
        if not job_id:
            await self.patch_status(http, rec.rid, "error", error="could not create capture job")
            rec.cleanup()
            return

        # Per-speaker consent, resolved ONCE for the whole job.
        #
        # Consent is enforced HERE, at finalize, rather than downstream at transcription.
        # The difference matters: a speaker who has not consented never has their audio
        # uploaded at all, so it never reaches the session-audio bucket and there is
        # nothing to retain, sign a URL for, or delete later. The temp files go with
        # rec.cleanup() when this returns. That is the difference between "we do not
        # transcribe your voice" and "we do not record your voice", and only the second
        # one is true if the skip happens here.
        #
        # This replaces the old all-or-nothing model, where session_consent_ok blocked the
        # ENTIRE job unless every attendee had consented. One un-consented player used to
        # stop the whole table's transcription. Now each stream stands alone, which is
        # possible because Discord gives one stream per microphone: skipping a speaker
        # removes their voice, with no bleed from a shared room mic.
        #
        # Honest limit, worth remembering when writing anything user-facing: this removes
        # the person's VOICE, not their presence. Other speakers naming or quoting them
        # still land in consented streams.
        consented, opted_out = await self.load_consent(http, rec.campaign_id, rec.session_id)

        uploaded = 0
        unmapped = 0
        refused = 0
        orphaned = 0
        failed = 0
        for uid, chunks in rec.speaker_chunks.items():
            # Resolve the GM narrator first: linking a Discord id as narrator is a
            # deliberate, owner-gated act, so it wins over a (possibly stale) PC
            # claim on the same id. A speaker who never linked as narrator misses
            # here and falls through to character attribution.
            gm_id = await self.resolve_gm_identity(http, rec.campaign_id, uid)
            char_id = None if gm_id else await self.resolve_character(http, rec.campaign_id, uid)
            if not char_id and not gm_id:
                unmapped += 1
                log.warning("  unmapped speaker discord_id=%s (%d chunk(s)); skipping.", uid, len(chunks))
                continue
            # Consent gate. The GM narrator is exempt: running /record is itself the
            # operator's act, and the GM identity is linked deliberately and owner-gated.
            # A player character needs standing (campaign-wide) consent AND no opt-out for
            # this specific session.
            if char_id and (char_id not in consented or char_id in opted_out):
                refused += 1
                log.info("  speaker %s -> character %s has not consented; audio discarded, never uploaded.",
                         uid, char_id)
                continue
            chunks.sort(key=lambda c: c[0])
            have = {c[0] for c in chunks}
            # Leading/interior silence for chunks this speaker missed, keeping speakers aligned.
            parts = []
            total_secs = 0.0
            max_idx = max(have)
            for idx in range(0, max_idx + 1):
                if idx in have:
                    path = next(c[1] for c in chunks if c[0] == idx)
                    secs = next(c[2] for c in chunks if c[0] == idx)
                    parts.append(path)
                    total_secs += secs
                else:
                    pad = rec.chunk_seconds.get(idx, 0.0)
                    if pad > 0.2:
                        sil = os.path.join(rec.tmpdir, f"sil-{idx}.ogg")
                        if not os.path.exists(sil):
                            await make_silence_ogg(pad, sil)
                        if os.path.exists(sil):
                            parts.append(sil)
                            total_secs += pad
            final_path = os.path.join(rec.tmpdir, f"final-{uid}.ogg")
            if len(parts) == 1:
                shutil.copyfile(parts[0], final_path)
            elif not await concat_oggs(parts, final_path):
                # A speaker lost here used to vanish silently: warned once, skipped, and
                # counted nowhere in the stop summary. On 2026-07-20 that cost a player's
                # entire track and it took a day to notice, because the summary said
                # "6 uploaded" and nothing said seven had been recorded.
                failed += 1
                log.error("  LOST SPEAKER: concat failed for %s (%d chunk(s), character=%s, gm=%s); "
                          "their audio for this session is gone.",
                          uid, len(chunks), char_id, gm_id)
                continue
            slot = char_id if char_id else f"gm-{gm_id}"
            storage_path = f"{rec.campaign_id}/{job_id}/{slot}-{int(time.time() * 1000)}.ogg"
            with open(final_path, "rb") as f:
                blob = f.read()
            if not await self.upload_blob(http, storage_path, blob, "audio/ogg"):
                failed += 1
                log.error("  LOST SPEAKER: upload failed for %s (%s); their audio for this "
                          "session is gone.", slot, storage_path)
                continue
            if await self.insert_track(http, job_id, rec.campaign_id, storage_path, round(total_secs),
                                       character_id=char_id, gm_identity_id=gm_id):
                uploaded += 1
                who = f"character={char_id}" if char_id else f"gm_identity={gm_id}"
                log.info("  uploaded track: %s %.0fs %d KB -> %s",
                         who, total_secs, len(blob) // 1024, storage_path)
            else:
                # The row could not be created after retries, so this file is unreachable:
                # nothing will transcribe it, and the retention cron cannot see it to
                # delete it at 60 days. Leaving it would quietly break the deletion promise
                # on the privacy page, so by default it is removed.
                #
                # Set KEEP_ORPHANED_AUDIO=1 to keep the file instead, which trades that
                # promise for the chance to reattach the audio by hand. The storage path is
                # logged either way so the object can be found.
                orphaned += 1
                if KEEP_ORPHANED_AUDIO:
                    log.error("  ORPHANED AUDIO: no audio_tracks row for %s. File KEPT and is "
                              "invisible to retention; attach it by hand or delete it.", storage_path)
                else:
                    deleted = await self.delete_blob(http, storage_path)
                    log.error("  ORPHANED AUDIO: no audio_tracks row for %s. File %s.",
                              storage_path, "deleted" if deleted else "COULD NOT BE DELETED")

        await self.patch_status(http, rec.rid, "done", capture_job_id=job_id, error=note)
        # Every speaker the sink heard is accounted for in exactly one bucket, so the
        # numbers add up to the headcount at the table. If uploaded is less than the number
        # of people who were there and every other counter is zero, something is wrong that
        # this line does not yet name.
        heard = len(rec.speaker_chunks)
        log.info("STOPPED: request %s -> job %s; %d speaker(s) heard: %d uploaded, %d unmapped, "
                 "%d without consent, %d LOST to concat/upload failure, %d orphaned upload(s), "
                 "%d chunk(s).",
                 rec.rid, job_id, heard, uploaded, unmapped, refused, failed, orphaned,
                 rec.chunk_index)
        if failed or orphaned:
            log.error("STOPPED WITH LOSSES: %d speaker(s) recorded but not delivered for job %s.",
                      failed + orphaned, job_id)
        rec.cleanup()

    # ------------------------------------------------------------ data helpers

    async def resolve_character(self, http, campaign_id, discord_uid):
        if not campaign_id or not discord_uid:
            return None
        try:
            r = await http.get(
                f"{REST}/characters",
                params={
                    "campaign_id": f"eq.{campaign_id}",
                    "discord_user_id": f"eq.{discord_uid}",
                    "kind": "eq.pc",
                    "active": "eq.true",
                    "select": "id",
                    "limit": "1",
                },
                headers=HEADERS,
            )
            r.raise_for_status()
            rows = r.json()
            return rows[0]["id"] if rows else None
        except Exception as e:
            log.warning("resolve_character(%s) failed: %r", discord_uid, e)
            return None

    async def load_consent(self, http, campaign_id, session_id):
        """(consented_character_ids, opted_out_character_ids) for this campaign/session.

        Mirrors the two halves of the session_consent_ok SQL function exactly:

          blanket  recording_consents rows with session_id NULL and consented true, which
                   is the standing consent a player gives when they claim a character
          optout   recording_consents rows for THIS session with consented false, which is
                   the GM excluding someone from one game

        Fetched once per job rather than per speaker. If either request fails we return
        EMPTY sets, which means nothing is treated as consented and no audio is uploaded.
        Failing closed is the only safe direction here: a transient error must never turn
        into uploading someone who declined."""
        consented: set = set()
        opted_out: set = set()
        if not campaign_id:
            return consented, opted_out
        try:
            r = await http.get(
                f"{REST}/recording_consents",
                params={
                    "campaign_id": f"eq.{campaign_id}",
                    "session_id": "is.null",
                    "consented": "is.true",
                    "select": "character_id",
                },
                headers=HEADERS,
            )
            r.raise_for_status()
            for row in r.json():
                if row.get("character_id"):
                    consented.add(row["character_id"])
        except Exception as e:
            log.warning("load_consent(blanket) failed, treating nobody as consented: %r", e)
            return set(), set()
        if session_id:
            try:
                r = await http.get(
                    f"{REST}/recording_consents",
                    params={
                        "session_id": f"eq.{session_id}",
                        "consented": "is.false",
                        "select": "character_id",
                    },
                    headers=HEADERS,
                )
                r.raise_for_status()
                for row in r.json():
                    if row.get("character_id"):
                        opted_out.add(row["character_id"])
            except Exception as e:
                log.warning("load_consent(optout) failed, treating nobody as consented: %r", e)
                return set(), set()
        log.info("consent: %d character(s) with standing consent, %d opted out of this session.",
                 len(consented), len(opted_out))
        return consented, opted_out

    async def resolve_gm_identity(self, http, campaign_id, discord_uid):
        """A speaker who is not an active PC may be the GM narrator. Match their
        Discord id against gm_identities so their stream is tagged for the GM
        extractor instead of being dropped as unmapped."""
        if not campaign_id or not discord_uid:
            return None
        try:
            r = await http.get(
                f"{REST}/gm_identities",
                params={
                    "campaign_id": f"eq.{campaign_id}",
                    "discord_user_id": f"eq.{discord_uid}",
                    "select": "id",
                    "limit": "1",
                },
                headers=HEADERS,
            )
            r.raise_for_status()
            rows = r.json()
            return rows[0]["id"] if rows else None
        except Exception as e:
            log.warning("resolve_gm_identity(%s) failed: %r", discord_uid, e)
            return None

    async def create_job(self, http, campaign_id, session_id):
        try:
            r = await http.post(
                f"{REST}/capture_jobs",
                headers=RETURN_HEADERS,
                json={
                    "campaign_id": campaign_id,
                    "session_id": session_id,
                    "source": "online",
                    "status": "draft",
                },
            )
            r.raise_for_status()
            rows = r.json()
            return rows[0]["id"] if rows else None
        except Exception as e:
            log.warning("create_job failed: %r", e)
            return None

    async def upload_blob(self, http, path, blob, content_type):
        try:
            r = await http.post(
                f"{STORAGE}/{AUDIO_BUCKET}/{path}",
                headers={**HEADERS, "Content-Type": content_type, "x-upsert": "true"},
                content=blob,
            )
            r.raise_for_status()
            return True
        except Exception as e:
            log.warning("upload(%s) failed: %r", path, e)
            return False

    async def insert_track(self, http, job_id, campaign_id, storage_path, duration,
                           character_id=None, gm_identity_id=None, attempts=4):
        """Create the audio_tracks row for an uploaded file. Retries with backoff.

        This row is not bookkeeping, it is the only handle anything downstream has on the
        audio: /api/transcribe/submit reads audio_tracks to find what to send to Deepgram,
        and the retention cron iterates audio_tracks to delete files at 60 days. A file in
        the bucket with no row is therefore both untranscribable AND invisible to
        retention, which turns a transient database blip into an indefinite retention of
        someone's voice.

        It happened on 2026-07-20: one insert failed, the warning went unnoticed, and the
        file sat in the bucket unreferenced until it was found by hand.

        Retries are only for TRANSIENT failures. A 4xx other than timeout, conflict, or
        rate-limit means the row will never be accepted (a bad foreign key, a constraint
        violation) and retrying just delays the inevitable, so those break out
        immediately."""
        body = {
            "job_id": job_id,
            "campaign_id": campaign_id,
            "storage_path": storage_path,
            "status": "pending",
        }
        # A track belongs to exactly one of: a player character, or the GM
        # narrator identity. Send only the column that applies.
        if character_id:
            body["character_id"] = character_id
        if gm_identity_id:
            body["gm_identity_id"] = gm_identity_id
        if duration:
            body["duration_seconds"] = duration

        delay = 1.0
        for attempt in range(1, attempts + 1):
            try:
                r = await http.post(f"{REST}/audio_tracks", headers=WRITE_HEADERS, json=body)
                r.raise_for_status()
                if attempt > 1:
                    log.info("insert_track succeeded on attempt %d for %s", attempt, storage_path)
                return True
            except Exception as e:
                status = getattr(getattr(e, "response", None), "status_code", None)
                permanent = status is not None and 400 <= status < 500 and status not in (408, 409, 425, 429)
                detail = ""
                try:
                    detail = e.response.text[:200]
                except Exception:
                    pass
                log.warning("insert_track attempt %d/%d failed (status=%s): %r %s",
                            attempt, attempts, status, e, detail)
                if permanent:
                    log.error("insert_track: %s is a permanent rejection, not retrying.", status)
                    return False
                if attempt < attempts:
                    await asyncio.sleep(delay)
                    delay *= 2
        log.error("insert_track FAILED after %d attempts for %s", attempts, storage_path)
        return False

    async def delete_blob(self, http, path):
        """Remove an uploaded object. Used when its audio_tracks row could not be created,
        so the file does not linger in the bucket where retention cannot see it."""
        try:
            r = await http.delete(f"{STORAGE}/{AUDIO_BUCKET}/{path}", headers=HEADERS)
            r.raise_for_status()
            return True
        except Exception as e:
            log.warning("delete(%s) failed: %r", path, e)
            return False

    async def patch_status(self, http, rid, status, error=None, capture_job_id=None, channel_id=None):
        body = {"status": status, "updated_at": _now_iso()}
        if error is not None:
            body["error"] = str(error)[:500]
        if capture_job_id is not None:
            body["capture_job_id"] = capture_job_id
        if channel_id is not None:
            body["channel_id"] = channel_id
        try:
            r = await http.patch(
                f"{REST}/capture_control",
                params={"id": f"eq.{rid}"},
                headers=WRITE_HEADERS,
                json=body,
            )
            r.raise_for_status()
        except Exception as e:
            log.warning("patch %s -> %s failed: %r", rid, status, e)

    async def get_notify_channel(self, http, campaign_id):
        """The campaign's linked Discord text channel, where GM status notices go.
        Returns None if the campaign has no linked channel, in which case notices
        are simply skipped."""
        if not campaign_id:
            return None
        try:
            r = await http.get(
                f"{REST}/campaigns",
                params={"id": f"eq.{campaign_id}", "select": "discord_channel_id", "limit": "1"},
                headers=HEADERS,
            )
            r.raise_for_status()
            rows = r.json()
            return rows[0].get("discord_channel_id") if rows else None
        except Exception as e:
            log.warning("get_notify_channel(%s) failed: %r", campaign_id, e)
            return None

    async def notify(self, channel_id, content):
        """Post a GM-facing status notice to the campaign's Discord text channel.
        Strictly best-effort: a failed notice (missing channel, missing Send
        Messages permission, API hiccup) is logged and never affects the recording."""
        if not channel_id:
            return
        try:
            ch = self.get_channel(int(channel_id)) or await self.fetch_channel(int(channel_id))
            await ch.send(content)
        except Exception as e:
            log.warning("notify to channel %s failed: %r", channel_id, e)


def main():
    install_opus_rekey_guard()
    intents = discord.Intents.none()
    intents.guilds = True
    intents.voice_states = True
    Sidecar(intents=intents).run(TOKEN)


if __name__ == "__main__":
    main()
