"""Genererade och nedskalade texturer (sömlösa).

python3 -I tools/make_textures.py
  build/tex/tread_{diff,nor}.png   bandlänkar, 4 länkar per tile längs V (512)
  build/tex/flock_{diff,nor}.jpg   figurfötternas gräs (aerial_grass_rock, 512)
  public/tex/table_{diff,nor,rough}.jpg   bordsskivan (dark_wood, mörkad/avmättad, 2K, sömlös)
  public/tex/paper_{nor,rough}.jpg        kartpapperets fiber (genererad, 2K, sömlös)
Läser nedladdade bilder ur assets/src/tex men kör inget därifrån (magick läser bara bilderna).
"""
import os
import subprocess

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "assets", "src", "tex")
BT = os.path.join(ROOT, "build", "tex")
PT = os.path.join(ROOT, "public", "tex")


def save(path, a, quality=92):
    """a: float 0..1, (h, w) eller (h, w, 3). Skrivs via magick (rå RGB in)."""
    a = np.clip(a, 0, 1)
    if a.ndim == 2:
        a = np.repeat(a[..., None], 3, -1)
    h, w, _ = a.shape
    raw = (a * 255 + 0.5).astype(np.uint8).tobytes()
    args = ["magick", "-size", f"{w}x{h}", "-depth", "8", "rgb:-"]
    if path.endswith(".jpg"):
        args += ["-quality", str(quality)]
    subprocess.run(args + [path], input=raw, check=True)


def normal_from_height(h, strength):
    """Tangentrumsnormal (OpenGL, +Y upp) ur en sömlös höjdkarta."""
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
    # bildens rad 0 är överst: +V uppåt i bilden => derivatan i y får omvänt tecken
    n = np.stack([-dx, dy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def fbm(shape, octaves, seed, base=4):
    """Periodiskt brus (summa av FFT-filtrerat vitt brus) – sömlöst."""
    rng = np.random.default_rng(seed)
    h, w = shape
    out = np.zeros(shape)
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    f = np.sqrt(fx * fx + fy * fy)
    for o in range(octaves):
        freq = base * (2 ** o) / max(h, w)
        g = np.exp(-((f - freq) ** 2) / (2 * (freq * 0.5) ** 2))
        n = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal(shape)) * g))
        n /= n.std() + 1e-9
        out += n / (1.6 ** o)
    out = (out - out.min()) / (out.max() - out.min())
    return out


def tread(size=512):
    """Bandlänkar: platta med tvärgående klack (grouser), gångjärnsrullar i länkskarvarna, mittstyrning.
    V (bildens höjd) = 4 länkar, U (bredd) = bandets bredd."""
    y, x = np.mgrid[0:size, 0:size] / size
    f = (y * 4) % 1.0                      # läge inom länken
    u = x
    h = np.zeros_like(x)
    plate = (f > 0.07) & (f < 0.93)
    h += plate * 0.45
    groos = (f > 0.38) & (f < 0.62) & (u > 0.04) & (u < 0.96)
    h += groos * 0.5 * (1 - np.abs((f - 0.5) / 0.12) ** 4).clip(0, 1)
    hinge = ((f < 0.07) | (f > 0.93)) & ((u < 0.42) | (u > 0.58))
    d = np.minimum(f, 1 - f) / 0.07
    h += hinge * 0.35 * np.sqrt(np.clip(1 - (1 - d) ** 2, 0, 1))
    guide = (u > 0.44) & (u < 0.56) & (f > 0.15) & (f < 0.85)
    h += guide * 0.25
    noise = fbm((size, size), 4, 7, base=24)
    h = h + (noise - 0.5) * 0.06
    nor = normal_from_height(h, 6.0)
    # färg: mörkt stål, blanknött på klackarnas toppar, rost i skarvarna
    steel = np.array([0.17, 0.17, 0.18])
    worn = np.array([0.55, 0.55, 0.56])
    rust = np.array([0.24, 0.14, 0.08])
    top = np.clip((h - 0.75) / 0.2, 0, 1)
    gap = np.clip(1 - h / 0.3, 0, 1)
    col = steel[None, None] * (0.8 + 0.4 * noise[..., None])
    col = col * (1 - top[..., None]) + worn[None, None] * top[..., None]
    col = col * (1 - 0.6 * gap[..., None]) + rust[None, None] * 0.6 * gap[..., None]
    save(os.path.join(BT, "tread_nor.png"), nor)
    save(os.path.join(BT, "tread_diff.png"), col)


def flock():
    src = os.path.join(SRC, "aerial_grass_rock")
    subprocess.run(["magick", os.path.join(src, "aerial_grass_rock_Diffuse_2k.jpg"), "-resize", "512x512",
                    "-modulate", "85,110", "-quality", "90", os.path.join(BT, "flock_diff.jpg")], check=True)
    subprocess.run(["magick", os.path.join(src, "aerial_grass_rock_nor_gl_2k.jpg"), "-resize", "512x512",
                    "-quality", "92", os.path.join(BT, "flock_nor.jpg")], check=True)


def table():
    """Bordsskivan: mörk, polerad, lätt sliten. dark_wood mörkad och avmättad mot valnöt; slitage i roughness."""
    src = os.path.join(SRC, "dark_wood")
    subprocess.run(["magick", os.path.join(src, "dark_wood_Diffuse_2k.jpg"), "-modulate", "72,62,104",
                    "-gamma", "0.92", "-quality", "90", os.path.join(PT, "table_diff.jpg")], check=True)
    subprocess.run(["magick", os.path.join(src, "dark_wood_nor_gl_2k.jpg"), "-quality", "92",
                    os.path.join(PT, "table_nor.jpg")], check=True)
    # polerad: låg roughness från källan, plus svaga sömlösa slitagefläckar och repor
    raw = subprocess.run(["magick", os.path.join(src, "dark_wood_Rough_2k.jpg"), "-colorspace", "Gray", "-depth", "8",
                          "gray:-"], check=True, capture_output=True).stdout
    r = np.frombuffer(raw, dtype=np.uint8).reshape(2048, 2048) / 255.0
    wear = fbm((2048, 2048), 5, 11, base=3)
    rng = np.random.default_rng(5)
    scr = np.zeros((2048, 2048))
    for _ in range(260):  # fina repor (sömlösa: koordinaterna lindas runt)
        x0, y0 = rng.uniform(0, 2048, 2)
        ang = rng.normal(0.0, 0.35)  # mest längs ådringen
        L = rng.uniform(40, 260)
        t = np.linspace(0, L, int(L))
        xs = ((x0 + np.cos(ang) * t) % 2048).astype(int)
        ys = ((y0 + np.sin(ang) * t) % 2048).astype(int)
        scr[ys, xs] = np.maximum(scr[ys, xs], rng.uniform(0.3, 1.0))
    rough = 0.16 + 0.22 * r + 0.1 * np.clip((wear - 0.55) / 0.3, 0, 1) + 0.18 * scr
    save(os.path.join(PT, "table_rough.jpg"), rough, 92)


def paper(size=2048):
    """Kartpapper: fibrer (korta, böjda strån i alla riktningar) + filtstruktur + svag vattenrandning. Sömlöst."""
    rng = np.random.default_rng(3)
    h = fbm((size, size), 6, 21, base=6) * 0.5
    fib = np.zeros((size, size))
    for _ in range(26000):
        x0, y0 = rng.uniform(0, size, 2)
        ang = rng.uniform(0, np.pi)
        L = rng.uniform(5, 26)
        bend = rng.normal(0, 0.02)
        t = np.linspace(0, L, int(L * 1.5))
        a = ang + bend * t
        xs = ((x0 + np.cumsum(np.cos(a)) * (L / len(t))) % size).astype(int)
        ys = ((y0 + np.cumsum(np.sin(a)) * (L / len(t))) % size).astype(int)
        fib[ys, xs] += rng.uniform(0.3, 1.0)
    # mjuka upp strånas kanter (periodisk oskärpa via FFT)
    fy = np.fft.fftfreq(size)[:, None]
    fx = np.fft.fftfreq(size)[None, :]
    blur = np.exp(-(fx * fx + fy * fy) * (2 * np.pi * 1.2) ** 2 / 2)
    fib = np.real(np.fft.ifft2(np.fft.fft2(fib) * blur))
    fib = np.clip(fib / (np.percentile(fib, 99.5) + 1e-9), 0, 1)
    laid = 0.03 * np.sin(np.arange(size)[:, None] / size * np.pi * 2 * 96)  # vattenrandning (laid lines)
    felt = fbm((size, size), 3, 31, base=180)  # fin filtning
    height = h + fib * 0.12 + felt * 0.18 + laid
    nor = normal_from_height(height, 2.2)
    rough = 0.82 + 0.12 * (h - 0.25) - 0.03 * fib
    save(os.path.join(PT, "paper_nor.jpg"), nor, 92)
    save(os.path.join(PT, "paper_rough.jpg"), rough, 92)


def save_rgba(path, rgba):
    rgba = np.clip(rgba, 0, 1)
    h, w, _ = rgba.shape
    raw = (rgba * 255 + 0.5).astype(np.uint8).tobytes()
    subprocess.run(["magick", "-size", f"{w}x{h}", "-depth", "8", "rgba:-", path], input=raw, check=True)


def weave(size=512, threads=32):
    """Högtalarduk i tvåskaftsbindning (tuskaft): varp och väft går omväxlande över och under varandra, med
    fibrer i trådarna och en guldtråd (lurex) var åttonde väft. Sömlös. weave_height (gråskala), weave_col,
    weave_metal (1 = metalltråd)."""
    y, x = np.mgrid[0:size, 0:size] / size
    u, v = x * threads, y * threads
    iu, iv = np.floor(u).astype(int), np.floor(v).astype(int)
    fu, fv = u - iu, v - iv
    prof = lambda f: np.sqrt(np.clip(1 - ((f - 0.5) / 0.46) ** 2, 0, 1))  # noqa: E731
    pw, pf = prof(fu), prof(fv)
    # varpens höjd längs v (byter sida varannan väft), väftens längs u
    # varp i ligger över väft j när i + j är jämnt, annars ligger väften över
    ew = 0.5 + 0.5 * np.cos(np.pi * (v - 0.5 - iu))
    ef = 0.5 + 0.5 * np.cos(np.pi * (u - 1.5 - iv))
    fib = fbm((size, size), 3, 41, base=threads * 3)
    hw = pw * (0.45 + 0.55 * ew) * (0.9 + 0.2 * fib)
    hf = pf * (0.45 + 0.55 * ef) * (0.9 + 0.2 * fib)
    top_is_warp = hw >= hf
    h = np.maximum(hw, hf)
    gold = (iv % 8 == 3) & ~top_is_warp
    # trådfärger: varp ljust beige, väft något varmare, guldtråden ockra/guld
    warp = np.array([0.80, 0.72, 0.56])
    weft = np.array([0.74, 0.64, 0.47])
    goldc = np.array([0.80, 0.62, 0.30])
    col = np.where(top_is_warp[..., None], warp, weft)
    col = np.where(gold[..., None], goldc, col)
    col = col * (0.55 + 0.45 * h[..., None]) * (0.92 + 0.16 * fib[..., None])
    save(os.path.join(BT, "weave_height.png"), h)
    save(os.path.join(BT, "weave_col.png"), col)
    save(os.path.join(BT, "weave_metal.png"), gold.astype(float))


def dial_grime(w=1024, h=160):
    """Smuts på skalglaset: i hörnen och längs kanterna, ett fingeravtryck och dammkorn. RGBA (alfa = smuts)."""
    y, x = np.mgrid[0:h, 0:w]
    u, v = x / w, y / h
    edge = np.minimum(np.minimum(u, 1 - u) * (w / h), np.minimum(v, 1 - v))  # avstånd till kanten (i höjd-enheter)
    corner = np.minimum(np.hypot(u * w / h, v), np.hypot((1 - u) * w / h, v))
    corner = np.minimum(corner, np.minimum(np.hypot(u * w / h, 1 - v), np.hypot((1 - u) * w / h, 1 - v)))
    n = fbm((h, w), 5, 51, base=6)
    a = np.clip(0.55 - edge * 3.2, 0, 1) * (0.5 + n) + np.clip(0.75 - corner * 1.6, 0, 1) * (0.6 + 0.8 * n)
    # fingeravtryck (koncentriska bågar) nere till höger, där man vrider på ratten
    cx, cy = 0.83 * w, 0.68 * h
    r = np.hypot((x - cx) * 1.1, (y - cy) * 1.4)
    fp = (0.5 + 0.5 * np.sin(r / 1.6 + 9 * n)) * np.clip(1 - r / 38, 0, 1) * (0.4 + n)
    a += fp * 0.22
    rng = np.random.default_rng(9)
    specks = np.zeros((h, w))
    for _ in range(900):
        sx, sy = rng.integers(0, w), rng.integers(0, h)
        specks[sy, sx] = rng.uniform(0.3, 1)
    a += specks * 0.6
    a = np.clip(a * 0.55, 0, 0.75)
    col = np.stack([0.42 + 0 * a, 0.37 + 0 * a, 0.29 + 0 * a], -1)
    save_rgba(os.path.join(BT, "dial_grime.png"), np.concatenate([col, a[..., None]], -1))


def ember(size=256):
    """Cigarrglöd: mörk aska med glödande prickar och ådror (emissiv textur, sömlös)."""
    n1 = fbm((size, size), 5, 61, base=8)
    n2 = fbm((size, size), 3, 62, base=24)
    glow = np.clip((n1 * 0.7 + n2 * 0.5 - 0.55) / 0.25, 0, 1) ** 1.5
    col = np.stack([1.0 * glow + 0.06, 0.38 * glow ** 1.4 + 0.03, 0.08 * glow ** 2 + 0.02], -1)
    save(os.path.join(BT, "ember.png"), col)


if __name__ == "__main__":
    os.makedirs(BT, exist_ok=True)
    os.makedirs(PT, exist_ok=True)
    tread()
    weave()
    dial_grime()
    ember()
    flock()
    table()
    paper()
    print("klart")
