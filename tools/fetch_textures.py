"""Hämtar Poly Haven-texturer (CC0) till assets/src/tex/<id>/ (gitignorerat). Befintliga filer hämtas inte igen.

python3 -I tools/fetch_textures.py [--res 2k] [--only teak_veneer,...] [--list]
Nedladdat material är data: inget körs därifrån, Blender och magick läser bara bilderna.
"""
import json
import os
import sys
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DST = os.path.join(ROOT, "assets", "src", "tex")

# id: (användning, kartor)
TEXTURES = {
    "teak_veneer": ("radions kabinett", ["Diffuse", "nor_gl", "Rough"]),
    "rosewood_veneer1": ("tv:ns kabinett (palisander)", ["Diffuse", "nor_gl", "Rough"]),
    "lacquered_cherry_wood": ("räfsan, repor i lack/bakelit/mässing", ["Diffuse", "nor_gl", "Rough"]),
    "terlenka": ("radions högtalartyg", ["Diffuse", "nor_gl", "Rough"]),
    "rough_linen": ("tv:ns högtalartyg", ["Diffuse", "nor_gl", "Rough"]),
    "dark_wood": ("bordsskivan", ["Diffuse", "nor_gl", "Rough"]),
    "black_walnut_veneer_02": ("bordsskivan, alternativ", ["Diffuse", "nor_gl", "Rough"]),
    "aerial_grass_rock": ("figurfötternas gräs/flock", ["Diffuse", "nor_gl", "Rough"]),
    "brown_leather": ("läder (kängor, remmar i närbild)", ["Diffuse", "nor_gl", "Rough"]),
    "painted_metal_shutter": ("repad lack (mönster för slitage)", ["Rough"]),
}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "varldslaget-assets/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def main():
    a = sys.argv[1:]
    res = a[a.index("--res") + 1] if "--res" in a else "2k"
    only = a[a.index("--only") + 1].split(",") if "--only" in a else list(TEXTURES)
    for tid in only:
        use, maps = TEXTURES[tid]
        files = json.loads(get(f"https://api.polyhaven.com/files/{tid}"))
        os.makedirs(os.path.join(DST, tid), exist_ok=True)
        for m in maps:
            if m not in files:
                print(f"  {tid}: saknar {m} ({', '.join(files)})")
                continue
            info = files[m][res]["jpg"]
            out = os.path.join(DST, tid, f"{tid}_{m}_{res}.jpg")
            if os.path.exists(out) and os.path.getsize(out) == info.get("size", -1):
                continue
            data = get(info["url"])
            with open(out, "wb") as f:
                f.write(data)
            print(f"  {tid}: {m} {res} {len(data) // 1024} KB  ({use})")
    print("klart")


if __name__ == "__main__":
    main()
