import sys, types, os, asyncio, json, re, time, tempfile
d = types.ModuleType("discord")
class Client:
    def __init__(self, **kw): pass
d.Client = Client
sinks = types.ModuleType("discord.sinks"); 
class WaveSink:
    def __init__(self, *a, **k): self.audio_data = {}
sinks.WaveSink = WaveSink
core = types.SimpleNamespace(AudioData=object)
sinks.core = core
d.sinks = sinks
d.opus = types.SimpleNamespace(OpusError=Exception)
sys.modules["discord"] = d; sys.modules["discord.sinks"] = sinks
os.environ.update(DISCORD_BOT_TOKEN="x", SUPABASE_URL="https://sb.test", SUPABASE_SERVICE_ROLE_KEY="k")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sidecar as S

store = {}   # path -> bytes
class Resp:
    def __init__(self, status=200, body=None, content=b""): self.status_code=status; self._b=body; self.content=content
    def raise_for_status(self):
        if self.status_code >= 400: raise Exception(f"HTTP {self.status_code}")
    def json(self): return self._b
def lst(prefix):
    prefix = prefix.rstrip("/") + "/"
    seen, out = set(), []
    for p in sorted(store):
        if not p.startswith(prefix): continue
        rest = p[len(prefix):]
        if "/" in rest:
            f = rest.split("/")[0]
            if f not in seen: seen.add(f); out.append({"name": f, "id": None})
        else: out.append({"name": rest, "id": "x"})
    return out
B = f"{S.STORAGE}/{S.AUDIO_BUCKET}/"
class Fake:
    def __init__(self, *a, **k): pass
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False
    async def post(self, url, headers=None, content=None, json=None, params=None):
        if url.startswith(S.STORAGE_LIST):
            return Resp(body=lst(json["prefix"])[json["offset"]:json["offset"]+json["limit"]])
        store[url[len(B):]] = content; return Resp()
    async def get(self, url, headers=None, params=None):
        if url.startswith(B): return Resp(content=store[url[len(B):]])
        if "capture_control" in url: return Resp(body=[{"id": i, "status": "done", "updated_at": "2026-01-01T00:00:00Z"} for i in params["id"][4:-1].split(",")])
        return Resp(body=[])
    async def patch(self, *a, **k): return Resp()
    async def request(self, method, url, headers=None, json=None):
        for p in json["prefixes"]: store.pop(p, None)
        return Resp()
S.httpx.AsyncClient = Fake

async def main():
    sc = S.Sidecar.__new__(S.Sidecar); sc.recordings = {}; sc.finalizing = 0; sc.last_tick = 0
    rid = "11111111-1111-1111-1111-111111111111"
    tmp = tempfile.mkdtemp()
    for idx in range(3):
        files = []
        for uid in (["a", "b"] if idx != 1 else ["a"]):
            p = os.path.join(tmp, f"{uid}{idx}.ogg"); open(p, "wb").write(f"{uid}{idx}".encode()); files.append((uid, p))
        assert await sc.persist_chunk(rid, idx, 60.0 + idx, files)
    # chunk 3: speaker file uploaded but marker never written (process died mid-save)
    store[f"_chunks/{rid}/a/00003.ogg"] = b"partial"
    print("stored", len(store))
    rec = S.Recording(rid, None, "c", "g", "camp", "sess")
    async with Fake() as http:
        n, last = await sc.recover_chunks(http, rec)
    print("recovered", n, "index", rec.chunk_index, {k: sorted(i for i, _, _ in v) for k, v in rec.speaker_chunks.items()}, rec.chunk_seconds)
    assert n == 3 and rec.chunk_index == 3 and sorted(i for i,_,_ in rec.speaker_chunks["a"]) == [0,1,2] and rec.chunk_seconds[2] == 62.0
    assert open([p for i,p,_ in rec.speaker_chunks["b"] if i==2][0],"rb").read() == b"b2"
    await sc.add_restart_gap(rec, int((time.time() - 400) * 1000))
    print("gap", rec.chunk_seconds.get(3), "next index", rec.chunk_index)
    assert 399 < rec.chunk_seconds[3] < 402 and rec.chunk_index == 4
    async with Fake() as http:
        assert await sc.delete_chunks(http, rid)
    print("left after delete", [p for p in store if rid in p])
    assert not [p for p in store if rid in p]
    # sweep: a leftover from a finished recording
    rid2 = "22222222-2222-2222-2222-222222222222"
    store[f"_chunks/{rid2}/_wall/00000-60000-1"] = b"1"; store[f"_chunks/{rid2}/a/00000.ogg"] = b"x"
    async with Fake() as http:
        await sc.sweep_chunks(http)
    print("left after sweep", list(store))
    assert not store
    print("ALL OK")
asyncio.run(main())
