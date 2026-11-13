"""test_v12.py - offline self-checks for v1.2 logic (no server, no network):  .venv\\Scripts\\python tests\\test_v12.py"""
import asyncio, os, pathlib, sys, tempfile
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))
import narrate, ops, place

# narration cap: at most 3 sentences and 65 words
out = []
for s in ["One two three four five six seven eight nine ten."] * 5:
    if narrate._room(out, s):
        out.append(s)
assert len(out) == 3, out
assert narrate._room(["w " * 60], "five more words right here")              # exactly 65: allowed
assert not narrate._room(["w " * 60], "six more words right here now")      # 66: dropped

# only story narrations and the fixed demo places persist to disk
assert narrate._persistable(("change", "presets:palm_jumeirah__2001_2008", "en"))
assert not narrate._persistable(("change", "live:abc", "en"))
assert narrate._persistable(("place", "kyoto", 135.77, 35.01, "en")) and not narrate._persistable(("place", "evil", 0, 0, "en"))

# explore highlights drop restaurants, hotels and retail
for bad in ("Armani Ristorante", "Address Downtown hotel", "Dubai Mall shopping centre"):
    assert place.BORING.search(bad), bad
assert not place.BORING.search("Dubai Creek") and not place.BORING.search("Lake Mead")


# RAM guard: byte budget with FIFO eviction, and per-file cap
async def fetch(app, path):
    sent = []

    async def send(m):
        sent.append(m)
    await app({"type": "http", "method": "GET", "path": path, "headers": []}, None, send)
    return sent

with tempfile.TemporaryDirectory() as d:
    for i in range(4):
        pathlib.Path(d, f"{i}.png").write_bytes(b"x" * 400)
    pathlib.Path(d, "big.png").write_bytes(b"x" * 2000)

    async def fallthrough(scope, receive, send):
        await send({"type": "http.response.start", "status": 404, "headers": []})
    m = ops.MemoryStatic(fallthrough, d, max_bytes=1000, max_total=1000)
    for i in range(4):
        assert asyncio.run(fetch(m, f"/cache/{i}.png"))[0]["status"] == 200
    assert m.total <= 1000 and len(m.files) == 2, (m.total, len(m.files))
    assert asyncio.run(fetch(m, "/cache/big.png"))[0]["status"] == 404          # over the per-file cap: served from disk instead
print("test_v12: PASS")
