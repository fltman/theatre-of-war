#!/usr/bin/env python3
"""Röster till den röstade frasboken (src/press/phrasebook.js) via ElevenLabs.

ElevenLabs kostar riktiga pengar: kör alltid --count först. Nyckeln ligger i ~/.zprofile utan export:
  zsh -c 'source ~/.zprofile; export ELEVENLABS_API_KEY; python3 tools/gen_voice.py --count'

Lägen:
  --count            antal repliker och tecken per röst, uppskattade krediter (inget API-anrop)
  --design [roll]    Voice Design: tre förhandslyssningar per roll -> build/voice-previews/ (skapar ALDRIG röster)
  --sample           provpaketet (tools/voice_lines.json "sample") -> build/voice-samples/<roll>/<id>.mp3
  --create           sparar de valda röstdesignerna ("chosen") som röster i kontot och skriver voice-id:n till "voices"
  --sample2          provpaket v2 med de valda rösterna: en replik per anrop OCH batchat (flera repliker per anrop,
                     isärklippta vid tidsstämplarna), krediter mäts per metod -> build/voice-samples-v2/
  --all --yes        hela frasboken -> public/audio/voice/<id>.mp3 + manifest.json (befintliga filer görs aldrig om)
  --all --yes --batch   samma men flera repliker per anrop (se speak_batch)
  --only id,id --yes bara vissa repliker

Modell: eleven_v4 via Text-to-Dialogue (en replik per anrop). Framförandetaggar ("[urgent]") skickas till ElevenLabs
men står aldrig i undertexten. Förbrukade krediter mäts mot prenumerationen före och efter och loggas i
build/voice-costs.log. Lyssna själv – transkribera aldrig klippen för att kontrollera dem.
"""
import base64
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = json.loads((ROOT / "tools" / "voice_lines.json").read_text(encoding="utf-8"))
OUT = ROOT / "public" / "audio" / "voice"
SAMPLES = ROOT / "build" / "voice-samples"
PREVIEWS = ROOT / "build" / "voice-previews"
LOG = ROOT / "build" / "voice-costs.log"
args = sys.argv[1:]


def phrasebook():
    js = ("import('./src/press/phrasebook.js').then((m) => process.stdout.write(JSON.stringify("
          "m.LINES.map((l) => ({ ...l, say: m.spoken(l) })))))")
    r = subprocess.run(["node", "--input-type=module", "-e", js], cwd=ROOT, capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def client():
    from elevenlabs import ElevenLabs
    return ElevenLabs(api_key=os.environ["ELEVENLABS_API_KEY"])


def used_credits():
    import requests
    r = requests.get("https://api.elevenlabs.io/v1/user/subscription", headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"]})
    r.raise_for_status()
    j = r.json()
    return j["character_count"], j["character_limit"]


def credits_since(t0):
    """Exakt förbrukning sedan t0 (unix-tid) ur genereringshistoriken – prenumerationens räknare släpar ibland en minut."""
    import requests
    H = {"xi-api-key": os.environ["ELEVENLABS_API_KEY"]}
    total, after = 0, None
    while True:
        params = {"page_size": 100, **({"start_after_history_item_id": after} if after else {})}
        for attempt in range(5):
            try:
                j = requests.get("https://api.elevenlabs.io/v1/history", headers=H, params=params, timeout=30).json()
                break
            except Exception:  # noqa: BLE001 – nätverksfel: försök igen
                if attempt == 4:
                    return None
                time.sleep(2 ** attempt)
        items = j.get("history", [])
        for h in items:
            if h["date_unix"] < t0:
                return total
            if h.get("character_count_change_from") is not None and h.get("character_count_change_to") is not None:
                total += h["character_count_change_to"] - h["character_count_change_from"]
        if not j.get("has_more") or not items:
            return total
        after = j.get("last_history_item_id") or items[-1]["history_item_id"]


def log_cost(what, before, after, chars):
    LOG.parent.mkdir(parents=True, exist_ok=True)
    used, limit = used_credits()
    # before/after är unix-tider: kostnaden läses ur historiken (exakt per anrop)
    cost = credits_since(before)
    line = f"{time.strftime('%Y-%m-%d %H:%M')}  {what}: {cost} krediter för {chars} tecken (kvar i perioden ca {limit - used})\n"
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line)
    print(line.strip())
    return cost


def seconds(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                       capture_output=True, text=True)
    try:
        return round(float(r.stdout.strip()), 3)
    except ValueError:
        return None


def speak(c, line, voice_id, dst):
    kw = {"model_id": SPEC["model"], "output_format": SPEC["format"]}
    if SPEC.get("language"):
        kw["language_code"] = SPEC["language"]
    audio = b"".join(c.text_to_dialogue.convert(inputs=[{"text": line["say"], "voice_id": voice_id}], **kw))
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(audio)


def text_hash(line, voice_id):
    return hashlib.sha1(f"{SPEC['model']}|{voice_id}|{line['say']}".encode()).hexdigest()[:10]


SR = 44100


def pcm(path):
    """mp3 -> mono float32 (44,1 kHz) via ffmpeg."""
    import numpy as np
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                       capture_output=True, check=True)
    return np.frombuffer(r.stdout, dtype=np.float32)


def write_mp3(samples, dst, fade_in=0.008, fade_out=0.02):
    dur = len(samples) / SR
    af = f"afade=t=in:d={fade_in},afade=t=out:st={max(0, dur - fade_out):.4f}:d={fade_out}"
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-", "-af", af,
                    "-c:a", "libmp3lame", "-b:a", "128k", str(dst)], input=samples.tobytes(), check=True)


def frames_db(x, win=0.01):
    import numpy as np
    n = int(SR * win)
    m = len(x) // n
    if m == 0:
        return np.array([-120.0])
    f = x[: m * n].reshape(m, n)
    return 20 * np.log10(np.sqrt((f ** 2).mean(axis=1)) + 1e-9)


def clip_stats(path, thr=-40.0):
    """Tystnad i början/slutet (ms), nivå i första/sista 10 ms (dBFS) och längd – för att bedöma klippen."""
    x = pcm(path)
    db = frames_db(x)
    loud = (db > thr).nonzero()[0]
    lead = int(loud[0]) * 10 if len(loud) else len(db) * 10
    trail = (len(db) - 1 - int(loud[-1])) * 10 if len(loud) else len(db) * 10
    return {"seconds": round(len(x) / SR, 3), "lead_ms": lead, "trail_ms": trail,
            "edge_in_db": round(float(db[0]), 1), "edge_out_db": round(float(db[-1]), 1)}


def speak_batch(c, lines, voice_id, dsts):
    """Flera repliker (samma röst) i ett anrop; klipps isär vid den tystaste punkten mellan segmenten."""
    import numpy as np
    kw = {"model_id": SPEC["model"], "output_format": SPEC["format"]}
    if SPEC.get("language"):
        kw["language_code"] = SPEC["language"]
    res = c.text_to_dialogue.convert_with_timestamps(inputs=[{"text": l["say"], "voice_id": voice_id} for l in lines], **kw)
    raw = dsts[0].parent / "_batch_raw.mp3"
    raw.parent.mkdir(parents=True, exist_ok=True)
    raw.write_bytes(base64.b64decode(res.audio_base_64))
    x = pcm(raw)
    span = {}
    for seg in res.voice_segments:
        a, b = span.get(seg.dialogue_input_index, (seg.start_time_seconds, seg.end_time_seconds))
        span[seg.dialogue_input_index] = (min(a, seg.start_time_seconds), max(b, seg.end_time_seconds))
    db = frames_db(x, 0.02)
    cuts = [max(0.0, span[0][0] - 0.03)]
    for i in range(len(lines) - 1):
        lo = max(0.0, span[i][1] - 0.15)
        hi = min(len(x) / SR, span[i + 1][0] + 0.15)
        a, b = int(lo / 0.02), max(int(lo / 0.02) + 1, int(hi / 0.02))
        q = a + int(np.argmin(db[a:b]))   # tystaste 20 ms-rutan nära gränsen
        cuts.append(q * 0.02 + 0.01)
    cuts.append(len(x) / SR)
    for i, dst in enumerate(dsts):
        write_mp3(x[int(cuts[i] * SR): int(cuts[i + 1] * SR)], dst)
    return {"segments": {i: [round(a, 3), round(b, 3)] for i, (a, b) in sorted(span.items())},
            "cuts": [round(t, 3) for t in cuts], "raw": raw.name}


def create():
    c = client()
    for role, ch in SPEC["chosen"].items():
        if role.startswith("_") or SPEC["voices"].get(role, {}).get("voice_id"):
            continue
        v = c.text_to_voice.create(voice_name=ch["name"], voice_description=SPEC["design"][role]["description"],
                                   generated_voice_id=ch["generated_voice_id"])
        SPEC["voices"][role] = {"voice_id": v.voice_id, "name": ch["name"], "source": "design",
                                "take": ch["take"], "generated_voice_id": ch["generated_voice_id"]}
        print(f"  {role}: {v.voice_id} ({ch['name']})")
    (ROOT / "tools" / "voice_lines.json").write_text(json.dumps(SPEC, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def sample2():
    lines = {l["id"]: l for l in phrasebook()}
    c = client()
    out = ROOT / "build" / "voice-samples-v2"
    report = {"model": SPEC["model"], "single": {"clips": {}}, "batch": {"clips": {}, "calls": {}}}
    # en replik per anrop
    before = int(time.time()) - 2
    chars = 0
    for role, plan in SPEC["sample2"].items():
        v = SPEC["voices"][role]["voice_id"]
        for i, lid in enumerate(plan["single"], 1):
            dst = out / "single" / role / f"{i:02d}_{lid}.mp3"
            speak(c, lines[lid], v, dst)
            chars += len(lines[lid]["say"])
            report["single"]["clips"][str(dst.relative_to(out))] = {"id": lid, "chars": len(lines[lid]["say"]), **clip_stats(dst)}
            print(f"  ok single {role} {lid}")
    report["single"].update({"chars": chars, "credits": log_cost("provpaket v2, en replik per anrop", before, None, chars)})
    # batchat: en röst per anrop
    before = int(time.time()) - 1
    chars = 0
    for role, plan in SPEC["sample2"].items():
        v = SPEC["voices"][role]["voice_id"]
        ls = [lines[lid] for lid in plan["batch"]]
        dsts = [out / "batch" / role / f"{i:02d}_{l['id']}.mp3" for i, l in enumerate(ls, 1)]
        info = speak_batch(c, ls, v, dsts)
        report["batch"]["calls"][role] = info
        for l, dst in zip(ls, dsts):
            chars += len(l["say"])
            report["batch"]["clips"][str(dst.relative_to(out))] = {"id": l["id"], "chars": len(l["say"]), **clip_stats(dst)}
        print(f"  ok batch {role} ({len(ls)} repliker)")
    report["batch"].update({"chars": chars, "credits": log_cost("provpaket v2, batchat", before, None, chars)})
    (out / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))
    listen_page()


def count():
    lines = phrasebook()
    lo, hi = SPEC["credits_per_char"]
    total = 0
    per = {}
    for l in lines:
        n = len(l["say"])
        total += n
        p = per.setdefault(l["speaker"], [0, 0])
        p[0] += 1
        p[1] += n
    print(f"{len(lines)} repliker, {total} tecken (med taggar) -> uppskattat {round(total * lo)}–{round(total * hi)} krediter")
    for s, (n, ch) in per.items():
        print(f"  {s:10} {n:4} repliker {ch:6} tecken")
    done = [l for l in lines if (OUT / f"{l['id']}.mp3").exists()]
    print(f"redan inspelade: {len(done)}; kvar: {sum(len(l['say']) for l in lines if l not in done)} tecken")


def design(roles):
    c = client()
    d = SPEC["design"]
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    before = int(time.time()) - 2
    chars = 0
    index = json.loads((PREVIEWS / "previews.json").read_text()) if (PREVIEWS / "previews.json").exists() else {}
    for role in roles:
        spec = d[role]
        res = c.text_to_voice.design(voice_description=spec["description"], text=spec["text"], model_id=d["model"],
                                     output_format="mp3_44100_192")
        chars += len(spec["text"])
        takes = []
        for i, p in enumerate(res.previews, 1):
            f = PREVIEWS / f"{role}-design-take{i}.mp3"
            f.write_bytes(base64.b64decode(p.audio_base_64))
            takes.append({"file": f.name, "generated_voice_id": p.generated_voice_id})
            print(f"  {f.relative_to(ROOT)}  generated_voice_id={p.generated_voice_id}")
        index[role] = {"description": spec["description"], "text": spec["text"], "takes": takes}
    (PREVIEWS / "previews.json").write_text(json.dumps(index, indent=2, ensure_ascii=False))
    after = None
    log_cost(f"röstdesign {','.join(roles)}", before, after, chars)


def sample():
    lines = {l["id"]: l for l in phrasebook()}
    c = client()
    before = int(time.time()) - 2
    chars = 0
    for role, ids in SPEC["sample"].items():
        v = SPEC["voices"][role]
        for i, lid in enumerate(ids, 1):
            line = lines[lid]
            dst = SAMPLES / role / f"{i:02d}_{lid}.mp3"
            if dst.exists():
                continue
            try:
                speak(c, line, v["voice_id"], dst)
                chars += len(line["say"])
                print(f"  ok {dst.relative_to(ROOT)}  | {line['text']}")
            except Exception as e:  # noqa: BLE001
                print(f"  FEL {role} {lid}: {e}")
    log_cost("provpaket", before, None, chars)
    listen_page()


def listen_page():
    rows = []
    lines = {l["id"]: l for l in phrasebook()}
    v2 = ROOT / "build" / "voice-samples-v2"
    rep = json.loads((v2 / "report.json").read_text()) if (v2 / "report.json").exists() else None
    if rep:
        rows.append("<h1>Provpaket v2 — de valda rösterna (eleven_v4)</h1>")
        for method, label in (("single", "A. En replik per anrop"), ("batch", "B. Batchat: flera repliker per anrop, isärklippta")):
            m = rep[method]
            per = m["credits"] / m["chars"] if m.get("chars") else 0
            rows.append(f"<h2>{label}</h2><p>{m.get('credits')} krediter för {m.get('chars')} tecken ({per:.2f} per tecken)</p>")
            for path, cl in m["clips"].items():
                rows.append(f"<p><audio controls src='../voice-samples-v2/{path}'></audio> <b>{path.split('/')[1]}</b> "
                            f"{lines[cl['id']]['text']} <small>({cl['seconds']} s)</small></p>")
        rows.append("<hr><h1>Tidigare prov</h1>")
    rows.append("<h2>Röstdesign (valda: announcer take3, reporter take3, narrator take1)</h2>")
    lib_voices = SPEC.get("rejected_library", {}).get("voices", {})
    for role, ids in SPEC["sample"].items():
        v = lib_voices.get(role, {"name": "?"})
        rows.append(f"<h2>{role} — biblioteket (förkastad): {v['name']}</h2>")
        for i, lid in enumerate(ids, 1):
            rows.append(f"<p><audio controls src='../voice-samples/{role}/{i:02d}_{lid}.mp3'></audio> {lines[lid]['text']}</p>")
    lib = sorted((PREVIEWS / "library").glob("*.mp3")) if (PREVIEWS / "library").exists() else []
    if lib:
        rows.append("<h2>Bibliotekets egna förhandslyssningar (gratis, rösternas egen text)</h2>")
        rows += [f"<p><audio controls src='library/{f.name}'></audio> {f.stem}</p>" for f in lib]
    idx = PREVIEWS / "previews.json"
    if idx.exists():
        for role, d in json.loads(idx.read_text()).items():
            rows.append(f"<h2>{role} — röstdesign</h2><p><i>{d['description']}</i></p><p>{d['text']}</p>")
            for t in d["takes"]:
                rows.append(f"<p><audio controls src='{t['file']}'></audio> {t['file']} <code>{t['generated_voice_id']}</code></p>")
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    (PREVIEWS / "listen.html").write_text(
        "<!doctype html><meta charset=utf-8><title>Röster – provlyssning</title>"
        "<body style='font:15px system-ui;margin:2em;max-width:900px'>" + "".join(rows), encoding="utf-8")
    print(f"lyssna: {PREVIEWS / 'listen.html'}")


RAW = ROOT / "build" / "voice-raw"


def speak_retry(c, line, voice_id, dst, tries=6):
    """Ett anrop med omförsök och backoff vid 429/5xx och nätverksfel. Returnerar antal omförsök."""
    import random
    for k in range(tries):
        try:
            speak(c, line, voice_id, dst)
            return k
        except Exception as e:  # noqa: BLE001
            code = getattr(e, "status_code", None)
            if code is not None and code < 500 and code != 429:
                raise
            if k == tries - 1:
                raise
            time.sleep(min(60, 2 ** (k + 1)) + random.random())
    return tries


def trim_tail_blip(raw):
    """Klipper bort en kort blipp efter utklingningen (modellen lägger ibland ett klick i sista 10–30 ms):
    finns en tyst dal (< -52 dB) bland de sista 300 ms och sedan en stigning mot slutet, klipps det vid dalen."""
    x = pcm(raw)
    db = frames_db(x)
    tail = db[-30:]
    if len(tail) < 30 or tail[-1] < -45:
        return False
    valley = int(tail[:-3].argmin())
    if tail[valley] > -52:
        return False
    cut = len(db) - 30 + valley + 1
    keep = raw.with_suffix(".blip.mp3")
    if not keep.exists():
        keep.write_bytes(raw.read_bytes())
    write_mp3(x[: cut * int(SR * 0.01)], raw, fade_out=0.03)
    return True


def normalize(raw, dst, lufs=-18.0, tp=-1.5):
    """Tvåpass-loudnorm till jämn nivå (linjär förstärkning när det går). Inga filter – spelet lägger på radioljudet."""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(raw), "-af", f"loudnorm=I={lufs}:TP={tp}:LRA=11:print_format=json",
                        "-f", "null", "-"], capture_output=True, text=True)
    txt = r.stderr
    m = json.loads(txt[txt.rindex("{"): txt.rindex("}") + 1])
    af = (f"loudnorm=I={lufs}:TP={tp}:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
          f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-af", af, "-ar", str(SR), "-ac", "1",
                    "-c:a", "libmp3lame", "-b:a", "128k", str(dst)], check=True)
    return float(m["input_i"])


def check(line, path):
    """Rimlighetskontroll utan transkribering: längd mot textlängd och tystnad i kanterna."""
    st = clip_stats(path)
    spoken_chars = len(line["text"])
    rate = spoken_chars / max(0.05, st["seconds"] - (st["lead_ms"] + st["trail_ms"]) / 1000)
    problems = []
    if st["seconds"] < 0.6:
        problems.append("för kort")
    if rate > 30 or rate < 6:
        problems.append(f"orimlig takt {rate:.1f} tecken/s")
    if st["lead_ms"] > 900:
        problems.append(f"lång tystnad före ({st['lead_ms']} ms)")
    if st["trail_ms"] > 1500:
        problems.append(f"lång tystnad efter ({st['trail_ms']} ms)")
    if st["edge_out_db"] > -45 and st["trail_ms"] < 40:
        problems.append("avhuggen i slutet")
    return {**st, "rate": round(rate, 1), "problems": problems}


def full(only=None):
    if "--yes" not in args:
        sys.exit("Hela frasboken kostar riktiga pengar: lägg till --yes när användaren har godkänt rösterna.")
    from concurrent.futures import ThreadPoolExecutor, as_completed
    lines = phrasebook()
    if only:
        lines = [l for l in lines if l["id"] in only]
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() and manifest_path.read_text().strip() not in ("", "{}") else {}
    reuse = {p.name.split("_", 1)[1][:-4]: p for p in (ROOT / "build" / "voice-samples-v2" / "single").glob("*/*.mp3")}
    c = client()
    t0 = int(time.time()) - 2
    workers = int(os.environ.get("VOICE_WORKERS", "4"))
    log = {"retries": 0, "errors": [], "regenerated": [], "reused": []}

    # 1) rå tagningar (cache: build/voice-raw/<id>.mp3 görs aldrig om)
    todo = []
    for l in lines:
        raw = RAW / f"{l['id']}.mp3"
        if raw.exists():
            continue
        if l["id"] in reuse:
            raw.parent.mkdir(parents=True, exist_ok=True)
            raw.write_bytes(reuse[l["id"]].read_bytes())
            log["reused"].append(l["id"])
            continue
        todo.append(l)
    estimate = sum(len(l["say"]) for l in todo)
    print(f"{len(todo)} repliker att spela in, {estimate} tecken (≈ {estimate} krediter); återanvänder {len(log['reused'])}")
    if int(os.environ.get("VOICE_CAP", "0")) and estimate > int(os.environ["VOICE_CAP"]):
        sys.exit(f"Uppskattningen {estimate} är över taket VOICE_CAP={os.environ['VOICE_CAP']} – inget spelas in.")
    spent = 0
    done = 0
    aborted = None
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(speak_retry, c, l, SPEC["voices"][l["speaker"]]["voice_id"], RAW / f"{l['id']}.mp3"): l for l in todo}
        for f in as_completed(futs):
            l = futs[f]
            try:
                log["retries"] += f.result()
                spent += len(l["say"])
            except Exception as e:  # noqa: BLE001
                log["errors"].append(f"{l['id']}: {e}")
                (RAW / f"{l['id']}.mp3").unlink(missing_ok=True)
            done += 1
            if done % 50 == 0 or done == len(todo):
                actual = credits_since(t0)
                print(f"  {done}/{len(todo)} klara, {actual} krediter hittills (förväntat {spent})")
                cap = int(os.environ.get("VOICE_CAP", "0"))
                if actual is not None and (actual > spent * 1.15 + 300 or actual > estimate * 1.15 or (cap and actual > cap)):
                    aborted = f"kostnaden {actual} ligger mer än 15 % över förväntat ({spent})"
                    for g in futs:
                        g.cancel()
                    break
    if aborted:
        print("AVBRUTET:", aborted)

    # 2) kontroll av råtagningarna; misstänkta görs om en gång
    bad = []
    for l in todo:  # bara det som spelades in nu – äldre tagningar är redan kontrollerade
        raw = RAW / f"{l['id']}.mp3"
        if raw.exists() and raw.stat().st_size > 0:
            if check(l, raw)["problems"]:
                bad.append(l)
    cap = int(os.environ.get("VOICE_CAP", "0"))  # hårt tak i krediter för hela körningen (0 = inget)
    if bad and not aborted and cap:
        room = cap - (credits_since(t0) or spent)
        keep_bad, used = [], 0
        for l in bad:
            if used + len(l["say"]) <= room:
                keep_bad.append(l)
                used += len(l["say"])
        if len(keep_bad) < len(bad):
            print(f"taket {cap}: gör bara om {len(keep_bad)} av {len(bad)} misstänkta")
        bad = keep_bad
    if bad and not aborted:
        print(f"{len(bad)} misstänkta tagningar görs om:", ", ".join(l["id"] for l in bad))
        for l in bad:
            raw = RAW / f"{l['id']}.mp3"
            keep = raw.with_suffix(".first.mp3")
            raw.replace(keep)
            try:
                log["retries"] += speak_retry(c, l, SPEC["voices"][l["speaker"]]["voice_id"], raw)
                if check(l, raw)["problems"] and not check(l, keep)["problems"]:
                    keep.replace(raw)  # nya tagningen var inte bättre
                else:
                    keep.unlink()
                log["regenerated"].append(l["id"])
            except Exception as e:  # noqa: BLE001
                keep.replace(raw)
                log["errors"].append(f"{l['id']} (omtagning): {e}")

    # 3) normalisering till -18 LUFS och manifest
    def finish(l):
        raw = RAW / f"{l['id']}.mp3"
        dst = OUT / f"{l['id']}.mp3"
        if not raw.exists():
            return l, None
        if dst.exists() and l["id"] in manifest and dst.stat().st_mtime >= raw.stat().st_mtime:
            return l, None  # redan normaliserad från samma tagning
        v = SPEC["voices"][l["speaker"]]["voice_id"]
        h = text_hash(l, v)
        if trim_tail_blip(raw):
            log.setdefault("trimmed", []).append(l["id"])
        src_lufs = normalize(raw, dst)
        st = check(l, dst)
        return l, {"file": dst.name, "seconds": st["seconds"], "speaker": l["speaker"], "hash": h,
                   "lufs_in": round(src_lufs, 1), "problems": st["problems"]}
    with ThreadPoolExecutor(max_workers=6) as pool:
        for l, entry in pool.map(finish, lines):
            if entry:
                problems = entry.pop("problems")
                manifest[l["id"]] = entry
                if problems:
                    log.setdefault("flagged", {})[l["id"]] = problems
    manifest_path.write_text(json.dumps(dict(sorted(manifest.items())), indent=1, ensure_ascii=False))

    cost = log_cost("frasboken" + (" (urval)" if only else ""), t0, None, spent)
    missing = [l["id"] for l in phrasebook() if l["id"] not in manifest]
    total = sum(e["seconds"] for e in manifest.values())
    summary = {"clips": len(manifest), "missing": missing, "seconds": round(total, 1), "credits": cost,
               "estimate": estimate, **log}
    (ROOT / "build" / "voice-run.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False))
    print(json.dumps({k: (v if not isinstance(v, list) or len(v) < 12 else f"{len(v)} st") for k, v in summary.items()}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    if "--count" in args:
        count()
    elif "--design" in args:
        rest = [a for a in args if not a.startswith("--")]
        design(rest or ["announcer", "reporter", "narrator"])
    elif "--sample2" in args:
        sample2()
    elif "--create" in args:
        create()
    elif "--sample" in args:
        sample()
    elif "--listen" in args:
        listen_page()
    elif "--all" in args:
        full()
    elif "--only" in args:
        full(set(args[args.index("--only") + 1].split(",")))
    else:
        sys.exit(__doc__)
