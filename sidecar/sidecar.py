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
  FLUSH_SECONDS              (optional, default 300; sink rotation interval)
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
FLUSH_SECONDS = int(os.environ.get("FLUSH_SECONDS", "300"))
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


def _wav_params(blob: bytes):
    """(frames, rate) from a WAV blob, or (None, None)."""
    try:
        with wave.open(io.BytesIO(blob), "rb") as w:
            return w.getnframes(), w.getframerate()
    except Exception:
        return None, None


async def encode_wav_to_ogg(wav_blob: bytes, out_path: str) -> bool:
    """Compress a WAV chunk to mono Opus .ogg via ffmpeg (stdin -> file)."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-i", "pipe:0", "-ac", "1", "-c:a", "libopus", "-b:a", OPUS_BITRATE,
            "-f", "ogg", "-y", out_path,
            stdin=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, err = await proc.communicate(input=wav_blob)
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


async def concat_oggs(paths: list, out_path: str) -> bool:
    """Concatenate ogg chunks into one continuous ogg (re-encode for a clean single stream)."""
    list_path = out_path + ".txt"
    try:
        with open(list_path, "w") as f:
            for p in paths:
                f.write(f"file '{p}'\n")
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-f", "concat", "-safe", "0", "-i", list_path,
            "-c:a", "libopus", "-b:a", OPUS_BITRATE, "-f", "ogg", "-y", out_path,
            stderr=asyncio.subprocess.PIPE,
        )
        _, err = await proc.communicate()
        if proc.returncode != 0:
            log.warning("ffmpeg concat failed: %s", (err or b"").decode(errors="replace")[:300])
            return False
        return True
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


def _pad_wav_trailing(blob: bytes, target_seconds: float) -> bytes:
    """Return a WAV extended with trailing silence to reach target_seconds. Never
    truncates: if the audio is already longer, it is returned unchanged. Used so
    every speaker's chunk fills the same wall-clock window and chunks line up when
    concatenated across the session."""
    try:
        with io.BytesIO(blob) as bi, wave.open(bi, "rb") as w:
            nch, sw, fr, nframes = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
            data = w.readframes(nframes)
    except Exception:
        return blob
    target_frames = int(max(0.0, target_seconds) * fr)
    if target_frames <= nframes:
        return blob
    pad = b"\x00" * ((target_frames - nframes) * nch * sw)
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(nch)
        w.setsampwidth(sw)
        w.setframerate(fr)
        w.writeframes(data + pad)
    return out.getvalue()


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

    Trailing silence to fill the window is added at flush (_pad_wav_trailing), once
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
        speaker's chunk to .ogg on disk."""
        await asyncio.sleep(STOP_READ_DELAY_SECONDS)
        try:
            audio = getattr(sink, "audio_data", {}) or {}
        except Exception as e:
            log.warning("chunk %d: sink read failed: %r", idx, e)
            return

        # Read every speaker's reconstructed WAV first, so we know the longest one.
        # The sink already inserted leading and interior silence; these blobs span
        # from chunk start to each speaker's last packet.
        blobs = {}
        max_secs = 0.0
        for key, data in audio.items():
            try:
                data.file.seek(0)
                blob = data.file.read()
            except Exception as e:
                log.warning("chunk %d: could not read track for %s: %r", idx, key, e)
                continue
            frames, rate = _wav_params(blob)
            secs = (frames / rate) if (frames and rate) else 0.0
            uid = str(getattr(key, "id", key))
            blobs[uid] = (blob, secs)
            max_secs = max(max_secs, secs)

        # The chunk's real wall-clock length, from the sink's own start/stop stamps,
        # never shorter than the longest reconstructed speaker. Every speaker (present
        # or absent) is aligned to this one length, which is what keeps chunks lined
        # up when they are concatenated across the whole session.
        start_perf = getattr(sink, "start_perf", None)
        stop_perf = getattr(sink, "stop_perf", None)
        timed = (stop_perf - start_perf) if (start_perf is not None and stop_perf is not None) else 0.0
        chunk_wall = max(timed, max_secs)

        for uid, (blob, secs) in blobs.items():
            padded = _pad_wav_trailing(blob, chunk_wall)
            out = os.path.join(rec.tmpdir, f"{uid}-{idx}.ogg")
            if await encode_wav_to_ogg(padded, out):
                rec.speaker_chunks.setdefault(uid, []).append((idx, out, chunk_wall))
                log.info("  chunk %d: speaker %s %.1fs speech, padded to %.1fs (%d KB wav -> ogg)",
                         idx, uid, secs, chunk_wall, len(padded) // 1024)
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

        uploaded = 0
        unmapped = 0
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
                log.warning("  concat failed for speaker %s; skipping.", uid)
                continue
            slot = char_id if char_id else f"gm-{gm_id}"
            storage_path = f"{rec.campaign_id}/{job_id}/{slot}-{int(time.time() * 1000)}.ogg"
            with open(final_path, "rb") as f:
                blob = f.read()
            if not await self.upload_blob(http, storage_path, blob, "audio/ogg"):
                log.warning("  upload failed for %s; skipping.", slot)
                continue
            if await self.insert_track(http, job_id, rec.campaign_id, storage_path, round(total_secs),
                                       character_id=char_id, gm_identity_id=gm_id):
                uploaded += 1
                who = f"character={char_id}" if char_id else f"gm_identity={gm_id}"
                log.info("  uploaded track: %s %.0fs %d KB -> %s",
                         who, total_secs, len(blob) // 1024, storage_path)

        await self.patch_status(http, rec.rid, "done", capture_job_id=job_id, error=note)
        log.info("STOPPED: request %s -> job %s; %d track(s) uploaded, %d unmapped speaker(s), %d chunk(s).",
                 rec.rid, job_id, uploaded, unmapped, rec.chunk_index)
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
                           character_id=None, gm_identity_id=None):
        try:
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
            r = await http.post(f"{REST}/audio_tracks", headers=WRITE_HEADERS, json=body)
            r.raise_for_status()
            return True
        except Exception as e:
            log.warning("insert_track failed: %r", e)
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
