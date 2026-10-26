"""Maskinerna och rekvisitan runt kartan: 50-talsradio, tv i träkabinett, bankirlampa, askkopp, telefon, kaffekopp,
krupiärräfsa och bläckhorn. En av varje, så de får vara tunga (20–60k tris) och bakas till egna atlaser.

blender -b -P blender/props.py -- [--only radio,tv,props] [--no-preview] [--fast]
  --fast: lägre bakupplösning och färre sampel (utkast)
Skriver build/models/<namn>.glb, build/bake/<namn>_*.png och build/previews/<namn>*.png.
Mått och nodnamn: CONTRACT.md ("Modeller"). Blender: Z upp, framåt = -Y, origo mitt under föremålet.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
import mats  # noqa: E402
from lib import (add_bevel, box, cyl, ellipsoid, empty, join, lathe, loft, orient, plate, prism,  # noqa: E402
                 rounded_rect, set_origin, set_parent, smooth, transform, tube, torus)

FAST = "--fast" in lib.argv()


def res(r):
    return r // 2 if FAST else r


def finish(parts, name, angle=40):
    for p in parts:
        if p.type == "MESH":
            smooth(p, angle)
    return join(parts, name)


def rrect4(w, h, rt, rb, n=6, cx=0.0, cy=0.0):
    """Rundad rektangel med egen radie upptill (rt) och nedtill (rb), moturs."""
    pts = []
    for (ox, oy, a0, r) in ((w / 2 - rt, h / 2 - rt, 0, rt), (-w / 2 + rt, h / 2 - rt, 90, rt),
                            (-w / 2 + rb, -h / 2 + rb, 180, rb), (w / 2 - rb, -h / 2 + rb, 270, rb)):
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cx + ox + r * math.cos(a), cy + oy + r * math.sin(a)))
    return pts


def ring_plate(name, outer, inner, y_outer, y_inner, material, steps=1, curve=1.0):
    """Ram mellan två konturer med lika många punkter: yttre kanten på y_outer, inre på y_inner.
    steps > 1 ger en mjukt rundad tratt (curve > 1 = rundare mot ytterkanten)."""
    secs = []
    for k in range(steps + 1):
        t = k / steps
        ty = t ** curve
        secs.append([(o[0] + (i[0] - o[0]) * t, y_outer + (y_inner - y_outer) * ty, o[1] + (i[1] - o[1]) * t)
                     for o, i in zip(outer, inner)])
    ob = loft(name, secs, material, cap_start=False, cap_end=False)
    if sum(p.normal.y for p in ob.data.polygons) > 0:
        ob.data.flip_normals()
    return ob


def bar(name, a, b, t, d, material, bevel=None):
    """Avfasad list mellan två punkter i XZ-planet (framsidan), djup d längs Y."""
    a, b = Vector(a), Vector(b)
    c = (a + b) / 2
    L = (b - a).length
    horiz = abs(b.z - a.z) < abs(b.x - a.x)
    size = (L + t, d, t) if horiz else (t, d, L + t)
    return box(name, tuple(c), size, material, bevel=bevel or t * 0.35, segments=3)


def frame(name, x0, x1, z0, z1, y, t, d, material):
    return [bar(f"{name}_t", (x0 - t / 2, y, z1 + t / 2), (x1 + t / 2, y, z1 + t / 2), t, d, material),
            bar(f"{name}_b", (x0 - t / 2, y, z0 - t / 2), (x1 + t / 2, y, z0 - t / 2), t, d, material),
            bar(f"{name}_l", (x0 - t / 2, y, z0), (x0 - t / 2, y, z1), t, d, material),
            bar(f"{name}_r", (x1 + t / 2, y, z0), (x1 + t / 2, y, z1), t, d, material)]


def knurled(name, r, depth, material, ridges=36, cap_material=None, seg_per=2):
    """Ratt med räfflad kant: rotationskropp längs +Z där kantbandets radie moduleras med räfflorna.
    Profilen: fot, räfflat band, rundad överkant, svagt kupad topp."""
    seg = ridges * seg_per
    prof = [(r * 1.04, 0.0), (r * 1.06, depth * 0.06), (r, depth * 0.14), (r, depth * 0.72), (r * 0.97, depth * 0.86),
            (r * 0.88, depth * 0.96), (r * 0.7, depth * 1.0), (r * 0.35, depth * 1.03), (0.0, depth * 1.04)]
    bm = bmesh.new()
    rings = []
    for k, (rr, z) in enumerate(prof):
        ring = []
        for i in range(seg):
            a = math.tau * i / seg
            mod = 1.0
            if 2 <= k <= 3:  # räfflat band
                mod = 1.0 + 0.045 * (1 if i % seg_per == 0 else -1)
            ring.append(bm.verts.new((math.cos(a) * rr * mod, math.sin(a) * rr * mod, z)))
        rings.append(ring)
    for k in range(len(rings) - 1):
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
    bm.faces.new(list(reversed(rings[0])))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = lib._obj_from_bm(name, bm, material)
    return ob


def knob(name, center, r, depth, material, ring_mat=None, pointer_mat=None):
    """Räfflad bakelitratt med mässingsring och visare; axeln pekar framåt (-Y). Origo i rattens centrum."""
    parts = [knurled(name, r, depth, material)]
    if ring_mat:
        parts.append(torus(name + "_ring", (0, 0, depth * 0.03), r * 1.12, r * 0.07, ring_mat, seg=48, rseg=10))
    if pointer_mat:
        parts.append(box(name + "_mark", (0, r * 0.5, depth * 1.03), (r * 0.12, r * 0.5, r * 0.06), pointer_mat,
                         bevel=r * 0.02, segments=2))
    ob = finish(parts, name, 40)
    transform(ob, rot=(90, 0, 0))
    transform(ob, loc=center)
    set_origin(ob, center)
    return ob


def screw(name, center, r, normal=(0, -1, 0), material="Brass"):
    """Skruvskalle med spår (liten kupol + spår)."""
    s = lathe(name, [(r, 0.0), (r * 0.95, r * 0.3), (r * 0.7, r * 0.55), (0.0, r * 0.62)], seg=16, material=material)
    slot = box(name + "_slot", (0, 0, r * 0.6), (r * 1.5, r * 0.22, r * 0.2), "Dark")
    ob = join([s, slot], name)
    orient(ob, (0, 0, 0), normal)
    transform(ob, loc=center)
    return ob


def cam_at(parent, name, pos, target):
    """Tom nod som 'kamera': i three tittar nodens lokala -Z mot target (= nodens lokala +Y här i Blender)."""
    e = empty(name, pos)
    d = Vector(target) - Vector(pos)
    e.rotation_euler = d.to_track_quat("Y", "Z").to_euler()
    set_parent(e, parent)
    return e


def cord(name, pts, r, material):
    """Sladd längs en mjuk kurva (Catmull–Rom genom punkterna)."""
    P = [Vector(p) for p in pts]
    out = []
    for i in range(len(P) - 1):
        p0, p1, p2, p3 = P[max(i - 1, 0)], P[i], P[i + 1], P[min(i + 2, len(P) - 1)]
        for k in range(6):
            t = k / 6
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-1])
    # kurvan får inte översvänga ner genom bordet
    out = [Vector((p.x, p.y, max(p.z, r))) for p in out]
    return tube(name, out, r, material, seg=10)


FONTS = {
    "din": "/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf",
    "script": "/System/Library/Fonts/Supplemental/Brush Script.ttf",
}


def text_mesh(name, body, size, depth, material, font="din", max_width=None, align="CENTER"):
    """Text som mesh i XY-planet (läses ovanifrån, framsidan mot +Z), origo i textens mitt. Typsnittet används bara
    för att generera geometri. max_width skalar ned texten så att den får plats."""
    cu = bpy.data.curves.new(name + "_curve", "FONT")
    cu.body = body
    path = FONTS.get(font)
    if path and os.path.exists(path):
        cu.font = bpy.data.fonts.load(path, check_existing=True)
    cu.size = size
    cu.extrude = depth / 2
    cu.align_x = align
    cu.align_y = "CENTER"
    cu.resolution_u = 2
    ob = bpy.data.objects.new(name + "_c", cu)
    lib.link(ob)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    mo = bpy.data.objects.new(name, me)
    lib.link(mo)
    me.materials.clear()
    me.materials.append(lib.mat(material))
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    w = max(xs) - min(xs)
    s = min(1.0, max_width / w) if max_width else 1.0
    me.transform(Matrix.Scale(s, 4) @ Matrix.Translation((-cx, -cy, depth / 2)))
    return mo


def front_text(name, body, size, depth, material, center, font="din", max_width=None, normal=(0, -1, 0)):
    """Text som står på en yta med normalen normal (standard: framsidan, -Y), placerad i center."""
    ob = text_mesh(name, body, size, depth, material, font, max_width)
    n = Vector(normal).normalized()
    if abs(n.z) > 0.999:
        rot = Vector((0, 0, 1)).rotation_difference(n)
    else:
        # textens +Z (framsida) mot n och textens +Y (uppåt) så nära världens +Z som möjligt
        rot = (Vector((0, 0, 1)).rotation_difference(n))
        up_after = rot @ Vector((0, 1, 0))
        want = (Vector((0, 0, 1)) - n * n.z).normalized()
        twist = up_after.rotation_difference(want)
        rot = twist @ rot
    ob.data.transform(Matrix.Translation(Vector(center)) @ rot.to_matrix().to_4x4())
    return ob


def smooth_path(pts, per=8):
    P = [Vector(p) for p in pts]
    out = []
    for i in range(len(P) - 1):
        p0, p1, p2, p3 = P[max(i - 1, 0)], P[i], P[i + 1], P[min(i + 2, len(P) - 1)]
        for k in range(per):
            t = k / per
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-1])
    return out


def twisted_cord(name, pts, r, material, pitch=0.1, per_pitch=6, seg=6):
    """Textilomspunnen tvinnad sladd (två parter som snor sig kring varandra) längs en mjuk kurva."""
    path = smooth_path(pts, 12)
    path = [Vector((p.x, p.y, max(p.z, r))) for p in path]
    # omsampla efter båglängd
    L = [0.0]
    for i in range(1, len(path)):
        L.append(L[-1] + (path[i] - path[i - 1]).length)
    step = pitch / per_pitch
    n_out = max(2, int(L[-1] / step))
    pts_r, j = [], 0
    for k in range(n_out + 1):
        s = L[-1] * k / n_out
        while j < len(L) - 2 and L[j + 1] < s:
            j += 1
        t = (s - L[j]) / max(L[j + 1] - L[j], 1e-9)
        pts_r.append((path[j].lerp(path[j + 1], t), s))
    strands = [[], []]
    t0 = (pts_r[1][0] - pts_r[0][0]).normalized()
    ref = Vector((0, 0, 1)) if abs(t0.z) < 0.9 else Vector((1, 0, 0))
    nrm = t0.cross(ref).normalized()
    for i, (p, s) in enumerate(pts_r):
        a = pts_r[min(i + 1, len(pts_r) - 1)][0] - pts_r[max(i - 1, 0)][0]
        tt = a.normalized()
        nrm = (nrm - tt * nrm.dot(tt)).normalized()
        b = tt.cross(nrm)
        ang = math.tau * s / pitch
        for k in (0, 1):
            off = (nrm * math.cos(ang + math.pi * k) + b * math.sin(ang + math.pi * k)) * r * 0.48
            strands[k].append(p + off)
    obs = [tube(f"{name}{k}", strands[k], r * 0.56, material, seg=seg) for k in (0, 1)]
    return join(obs, name)


def knob3(name, center, r, depth, material, ring_mat=None, print_mat=None, ticks=0, skirt_mat=None):
    """Räfflad ratt med visarstreck; valfri kjol (skirt) med tryckta skalstreck. Axeln pekar framåt (-Y)."""
    parts = [knurled(name, r, depth, material, ridges=40)]
    if ring_mat:
        parts.append(torus(name + "_ring", (0, 0, depth * 0.03), r * 1.12, r * 0.07, ring_mat, seg=48, rseg=8))
    if skirt_mat:
        parts.append(lathe(name + "_skirt", [(r * 1.05, -0.002), (r * 1.55, -0.002), (r * 1.6, 0.01),
                                             (r * 1.5, depth * 0.18), (r * 1.05, depth * 0.2)], seg=48,
                           material=skirt_mat))
        for k in range(ticks):
            a = math.radians(-135 + 270 * k / max(ticks - 1, 1))
            parts.append(box(f"{name}_tick{k}", (math.sin(a) * r * 1.32, math.cos(a) * r * 1.32, depth * 0.19),
                             (r * 0.05, r * (0.22 if k % 2 == 0 else 0.13), 0.004), print_mat))
            transform(parts[-1], rot=(0, 0, -math.degrees(a)), pivot=(math.sin(a) * r * 1.32, math.cos(a) * r * 1.32,
                                                                     depth * 0.19))
    if print_mat:
        parts.append(box(name + "_mark", (0, r * 0.52, depth * 1.035), (r * 0.09, r * 0.62, 0.004), print_mat))
    ob = finish(parts, name, 40)
    transform(ob, rot=(90, 0, 0))
    transform(ob, loc=center)
    set_origin(ob, center)
    return ob


def slotted_panel(name, center, size, slots, material, inner_mat):
    """Bakstycke med genomgående ventilationsspringor (boolean) och mörk insida bakom."""
    pnl = box(name, center, size, material)
    cut = []
    for (x, z, w, h) in slots:
        cut.append(box(f"{name}_slot", (x, center[1], z), (w, size[1] * 4, h), material, bevel=min(w, h) * 0.45,
                       segments=3))
    cutter = join(cut, name + "_cutter")
    bo = pnl.modifiers.new("Slots", "BOOLEAN")
    bo.operation = "DIFFERENCE"
    bo.solver = "EXACT"
    bo.object = cutter
    add_bevel(pnl, 0.008, 2, 0.6)
    lib.apply_mods(pnl)
    bpy.data.objects.remove(cutter)
    inner = box(name + "_inner", (center[0], center[1] - 0.06 * (1 if center[1] > 0 else -1), center[2]),
                (size[0] * 0.95, 0.01, size[2] * 0.95), inner_mat)
    return [pnl, inner]


# ======================================================================= radion

def radio():
    """ARMSTRONG-radio, ca 1952, som stått 25 år i ett rökigt krigsrum: teakfanér (solblekt och repigt ovanpå,
    kaffekoppsringar, nött lack kring rattarna), kantstött bakelit, patinerad mässing med fingeravtryck, gulnad
    högtalarduk i tuskaft med vattenfläck och en liten reva, pianotangenter med halvt bortnötta texter,
    räfflade rattar med skala, gummifötter, bakstycke med ventilationsspringor och tvinnad textilsladd."""
    W, H, D = 4.2, 2.8, 1.8
    foot = 0.16
    yf = -D / 2
    knobs = [((-1.72, yf, 0.52), 0.6), ((1.72, yf, 0.52), 0.6)]
    mats.wood_worn("RadioWood", "black_walnut_veneer_02", tint="#a8703f", scale=0.9, darken=1.35, gloss=0.22,
                   sat=0.95, knobs=knobs, rings=[((0.95, 0.28), 0.3), ((1.35, -0.12), 0.28)], bleach=0.6)
    mats.bakelite_worn("RadioBakelite", prints=[(-1.55, yf - 0.05, 0.78), (1.5, yf - 0.05, 0.3), (1.6, yf, 0.75)])
    mats.brass_worn("RadioBrass", prints=[(0.55, yf - 0.06, 2.0), (-0.3, yf - 0.06, 1.32), (1.7, yf - 0.1, 0.62)])
    mats.brass_worn("BadgeBrass", polish=1.6, patina=0.35)
    mats.ivory_worn("RadioIvory")
    mats.print_worn("KeyPrint", "#1e140c", "#e2d0a6", 0.38)
    mats.print_worn("KnobPrint", "#ece2c8", "#2a1a10", 0.45)
    mats.painted("Needle", "#8a1f16", wear=0.35)
    mats.painted("Masonite", "#3d2b1d", rough=0.85, wear=0.0)
    mats.dark_metal("RadioSteel", "#2a2a2c")
    mats.rubber("RadioRubber")
    mats.cloth_cord("RadioCord")
    mats.fabric_worn("RadioCloth", 0.25, "#e8cf9c", z_range=(1.0, 1.95),
                     stains=[((-1.25, yf - 0.042, 1.72), 0.2)], bleach=[((0.85, yf - 0.042, 1.0), 0.28)],
                     tears=[((-0.92, yf - 0.042, 1.36), 28, 0.1, 0.014)])
    for s in ("DialGlass", "Eye"):
        mats.special(s)
    mats.grime_overlay("DialGrime", os.path.join(lib.ROOT, "build", "tex", "dial_grime.png"))

    P = []
    cab = prism("cabinet", rrect4(W, H - foot, 0.46, 0.16, n=12, cy=(H - foot) / 2), D, "RadioWood", axis="Y",
                center=(0, 0, foot))
    add_bevel(cab, 0.11, 6, 0.7)
    P.append(cab)
    pan = prism("panel", rounded_rect(3.84, 2.32, 0.2, n=8, cy=foot + 0.2 + 1.16), 0.06, "RadioBakelite", axis="Y",
                center=(0, yf - 0.012, 0))
    add_bevel(pan, 0.022, 4, 0.7)
    P.append(pan)
    P += frame("grillframe", -1.75, 1.75, 0.82, 1.9, yf - 0.056, 0.065, 0.065, "RadioWood")
    for z in (1.1, 1.62):
        P.append(bar(f"strip{z}", (-1.75, yf - 0.056, z), (1.75, yf - 0.056, z), 0.026, 0.026, "RadioBrass"))
    for x in (-1.2, -0.6, 0.6, 1.2):
        P.append(bar(f"rod{x}", (x, yf - 0.05, 0.84), (x, yf - 0.05, 1.88), 0.015, 0.015, "RadioBrass"))
    # märkesbricka: bakelitplatta med upphöjda mässingsbokstäver (påhittat märke)
    badge = prism("badge", [(-0.5, 0.0), (0.5, 0.0), (0.58, 0.11), (0.5, 0.22), (-0.5, 0.22), (-0.58, 0.11)],
                  0.04, "RadioBakelite", axis="Y", center=(0, yf - 0.07, 1.19))
    add_bevel(badge, 0.014, 3, 0.7)
    P.append(badge)
    P.append(front_text("brand", "ARMSTRONG", 0.24, 0.016, "BadgeBrass", (0, yf - 0.098, 1.3), max_width=0.9))
    # skalan: mässingsram, mörk bakgrund, mässingsskena som nålen löper på
    P += frame("dialframe", -1.75, 1.75, 2.05, 2.55, yf - 0.065, 0.065, 0.09, "RadioBrass")
    P.append(plate("dialback", rounded_rect(3.56, 0.56, 0.05, n=3, cy=2.3), yf - 0.045, "RadioBakelite"))
    P.append(cyl("rail", (-1.72, yf - 0.078, 2.085), (1.72, yf - 0.078, 2.085), 0.012, seg=12, material="RadioBrass"))
    for x in (-1.72, 1.72):
        P.append(cyl(f"railpost{x}", (x, yf - 0.05, 2.085), (x, yf - 0.09, 2.085), 0.022, seg=12,
                     material="RadioBrass", bevel=0.004))
    # magiskt öga
    P.append(lathe("eyering", [(0.1, 0.0), (0.135, 0.0), (0.142, 0.02), (0.13, 0.045), (0.105, 0.05), (0.098, 0.03)],
                   seg=40, material="RadioBrass"))
    transform(P[-1], rot=(90, 0, 0))
    transform(P[-1], loc=(1.38, yf - 0.05, 1.36))
    # pianotangenter med tryckta, delvis bortnötta texter
    P.append(box("keyslot", (0, yf - 0.035, 0.52), (3.2, 0.07, 0.3), "RadioBakelite", bevel=0.025, segments=3))
    for i, lab in enumerate(("AV", "L", "M", "K", "UK", "GR")):
        x = -1.3 + i * 0.52
        P.append(box(f"key{i}", (x, yf - 0.105, 0.525), (0.44, 0.18, 0.23), "RadioIvory", bevel=0.05, segments=4))
        P.append(front_text(f"keytext{i}", lab, 0.11, 0.002, "KeyPrint", (x, yf - 0.1962, 0.52), max_width=0.3))
    # gummifötter
    for x in (-1.75, 1.75):
        for y in (-0.6, 0.6):
            P.append(lathe(f"foot{x}{y}", [(0.0, 0.0), (0.12, 0.0), (0.15, 0.03), (0.155, foot - 0.02),
                                           (0.13, foot + 0.02), (0.0, foot + 0.02)], seg=24,
                           material="RadioRubber", center=(x, y, 0)))
    # bakstycke av masonit med ventilationsspringor, skruvar, tvinnad textilsladd
    slots = [(-1.36 + i * 0.34, 1.95, 0.09, 0.8) for i in range(9)] + [(-1.2 + i * 0.4, 0.75, 0.25, 0.08)
                                                                     for i in range(7)]
    P += slotted_panel("back", (0, D / 2 + 0.008, 1.45), (3.7, 0.025, 2.25), slots, "Masonite", "RadioSteel")
    for (x, z) in ((-1.75, 0.45), (1.75, 0.45), (-1.75, 2.45), (1.75, 2.45)):
        P.append(screw(f"screw{x}{z}", (x, D / 2 + 0.022, z), 0.05, (0, 1, 0), "RadioBrass"))
    P.append(twisted_cord("cord", [(0.9, D / 2 + 0.02, 0.35), (1.0, D / 2 + 0.35, 0.12), (1.3, D / 2 + 0.9, 0.04),
                                   (2.2, D / 2 + 1.3, 0.04)], 0.04, "RadioCord", pitch=0.11))
    body = finish(P, "radio", 40)

    grille = plate("grille", rounded_rect(3.5, 1.08, 0.08, n=4, cy=1.36), yf - 0.048, "RadioCloth",
                   uv_rect=(-1.75, 0.82, 1.75, 1.9))
    dial = plate("dial", rounded_rect(3.5, 0.5, 0.04, n=3, cy=2.3), yf - 0.05, "DialGlass",
                 uv_rect=(-1.75, 2.05, 1.75, 2.55))
    set_origin(dial, (0, yf - 0.05, 2.3))
    grime = plate("grime", rounded_rect(3.5, 0.5, 0.04, n=3, cy=2.3), yf - 0.054, "DialGrime",
                  uv_rect=(-1.75, 2.05, 1.75, 2.55))
    # nålen: röd visare på en mässingshylsa som löper på skenan; origo i skalans mitt, flyttas längs X
    cap = lathe("needle_cap", [(0.03, 0.0), (0.03, 0.018), (0.0, 0.026)], seg=16, material="RadioBrass")
    transform(cap, rot=(90, 0, 0))
    transform(cap, loc=(0, yf - 0.088, 2.5))
    sleeve = cyl("needle_sleeve", (-0.045, yf - 0.078, 2.085), (0.045, yf - 0.078, 2.085), 0.02, seg=14,
                 material="RadioBrass", bevel=0.005)
    needle = finish([box("needle_bar", (0, yf - 0.086, 2.3), (0.022, 0.01, 0.4), "Needle", bevel=0.004, segments=2),
                     cap, sleeve], "needle")
    set_origin(needle, (0, yf - 0.08, 2.3))
    eye = lathe("eye", [(0.0, 0.0), (0.1, 0.0), (0.1, 0.02), (0.08, 0.04), (0.0, 0.048)], seg=32, material="Eye")
    transform(eye, rot=(90, 0, 0))
    transform(eye, loc=(1.38, yf - 0.052, 1.36))
    knob_l = knob3("knob_l", (-1.72, yf - 0.012, 0.52), 0.2, 0.17, "RadioBakelite", "RadioBrass", "KnobPrint",
                   ticks=0)
    knob_r = knob3("knob_r", (1.72, yf - 0.012, 0.52), 0.2, 0.17, "RadioBakelite", "RadioBrass", "KnobPrint",
                   ticks=0)

    mats.bake_set([body, needle, knob_l, knob_r], "Radio", res(2048), ao_dist=0.35)
    mats.bake_set([grille], "RadioFabric", (res(2048), res(1024)), ao_dist=0.1, unwrap=False)
    body = join([body, eye, grille, grime], "radio")
    for o in (dial, needle, knob_l, knob_r):
        set_parent(o, body)
    cam_at(body, "cam", (0, -5.4, 2.05), (0, yf, 2.1))
    return body


# ======================================================================= tv:n

def tv():
    """Royal Tone-tv, ca 1953, sliten: palisander med cigarettbränna och repor ovanpå, nött lack kring rattarna,
    djup elfenbensram kring bildröret, kromad skrivstilsskylt, kanalväljare med siffror, gulnad högtalarduk,
    anlöpt och böjd kaninöronantenn med tejp, tvinnad textilsladd."""
    W, H, Dfront = 5.5, 5.0, 2.6
    leg = 0.55
    y0, y1 = -2.25, -2.25 + Dfront
    sx, sz, sw, sh, sr = -0.6, 2.95, 3.5, 2.625, 0.42
    gx = 2.0
    knobs = [((gx, y0, 1.95), 0.75), ((gx, y0, 1.24), 0.5), ((gx, y0, 0.8), 0.4)]
    mats.wood_worn("TvWood", "rosewood_veneer1", tint="#a35a33", scale=1.6, darken=1.2, gloss=0.18, rot=(0, 90, 0),
                   knobs=knobs, burns=[((-1.75, -1.95, 5.0), 75, 0.24, 0.05)], bleach=0.75)
    mats.bakelite_worn("TvBakelite", color="#17100b", prints=[(gx + 0.1, y0 - 0.1, 2.15), (gx - 0.15, y0 - 0.1, 1.2)])
    mats.brass_worn("TvBrass", prints=[(gx, y0 - 0.04, 2.5), (-1.8, y0 - 0.04, 4.15)])
    mats.ivory_worn("TvIvory", "#e8dab8")
    mats.bakelite_worn("TvBlack", color="#0d0c0b", mottle="#1b1917", gloss=0.18)
    mats.chrome_worn("TvChrome")
    mats.print_worn("TvPrint", "#1d1510", "#e2d2ad", 0.45)
    mats.print_worn("TvKnobPrint", "#ece2c8", "#1d120c", 0.45)
    mats.painted("TvBackboard", "#3b2c1f", rough=0.85, wear=0.0)
    mats.dark_metal("TvSteel", "#232325")
    mats.painted("Tape", "#cdbb8e", rough=0.8, wear=0.4, under="#8a7a58")
    mats.cloth_cord("TvCord")
    mats.fabric_worn("TvCloth", 0.22, "#e3c792", z_range=(2.8, 4.45), stains=[((gx + 0.15, y0 - 0.012, 4.05), 0.16)],
                     bleach=[((gx - 0.1, y0 - 0.012, 2.9), 0.2)], tears=[((gx - 0.2, y0 - 0.012, 3.55), 70, 0.08, 0.012)])
    mats.special("Screen")

    inner = rounded_rect(sw, sh, sr, n=12, cx=sx, cy=sz)
    outer = rounded_rect(sw + 0.52, sh + 0.48, sr + 0.2, n=12, cx=sx, cy=sz)
    lip = rounded_rect(sw + 0.66, sh + 0.62, sr + 0.27, n=12, cx=sx, cy=sz)
    P = []
    body = prism("cabinet", rounded_rect(W, H - leg, 0.38, n=12, cy=(H - leg) / 2), Dfront, "TvWood", axis="Y",
                 center=(0, (y0 + y1) / 2, leg))
    cutter = prism("cutter", rounded_rect(sw + 0.46, sh + 0.42, sr + 0.18, n=12, cx=sx, cy=sz), 1.0, "TvBlack",
                   axis="Y", center=(0, y0, 0))
    bo = body.modifiers.new("Hole", "BOOLEAN")
    bo.operation = "DIFFERENCE"
    bo.solver = "EXACT"
    bo.object = cutter
    add_bevel(body, 0.11, 6, 0.7)
    lib.apply_mods(body)
    bpy.data.objects.remove(cutter)
    P.append(body)
    secs = []
    for (y, w, h, cz) in ((y1 - 0.05, 4.7, 3.8, 2.95), (y1 + 0.5, 4.4, 3.55, 2.97), (y1 + 1.1, 3.6, 2.95, 3.02),
                          (2.25, 2.3, 1.9, 3.1)):
        secs.append([(u, y, v) for (u, v) in rounded_rect(w, h, 0.45, n=10, cy=cz)])
    hood = loft("hood", secs, "TvBakelite")
    add_bevel(hood, 0.05, 3, 0.5)
    P.append(hood)
    for i in range(7):
        y = y1 + 0.35 + i * 0.22
        P.append(box(f"vent{i}", (0, y, 4.83 - (y - y1) * 0.36), (2.0 - i * 0.1, 0.07, 0.03), "TvSteel", bevel=0.015,
                     segments=2))
        transform(P[-1], rot=(-20, 0, 0), pivot=(0, y, 4.83 - (y - y1) * 0.36))
    slots = [(-0.75 + i * 0.25, 3.1, 0.1, 1.1) for i in range(7)]
    P += slotted_panel("backboard", (0, 2.27, 3.1), (2.0, 0.03, 1.6), slots, "TvBackboard", "TvSteel")
    for x in (-2.35, 2.35):
        for y in (y0 + 0.35, y1 - 0.35):
            top = (x * 0.97, y, leg + 0.02)
            bot = (x * 1.02 + (0.07 if x > 0 else -0.07), y + (-0.09 if y < -1 else 0.09), 0.08)
            P.append(lathe(f"leg{x}{y}", [(0.0, 0.0), (0.07, 0.0), (0.11, 0.98), (0.125, 1.0), (0.0, 1.0)], seg=20,
                           material="TvBlack"))
            Lg = (Vector(top) - Vector(bot)).length
            transform(P[-1], scale=(1, 1, Lg))
            orient(P[-1], bot, top)
            P.append(lathe(f"shoe{x}{y}", [(0.06, -0.08), (0.072, -0.06), (0.075, 0.05), (0.06, 0.07), (0.0, 0.072)],
                           seg=20, material="TvBrass", cap_bottom=False))
            orient(P[-1], bot, (2 * bot[0] - top[0], 2 * bot[1] - top[1], 2 * bot[2] - top[2]))
    # djup bildrörsram: mjukt rundad tratt i elfenben, mässingslist utanför, mörkt i djupet
    P.append(ring_plate("mask", outer, inner, y0 - 0.03, y0 + 0.34, "TvIvory", steps=7, curve=0.55))
    P.append(ring_plate("lip", lip, outer, y0 - 0.05, y0 - 0.03, "TvBrass", steps=3))
    P.append(plate("tube_back", outer, y0 + 0.48, "TvBlack"))
    # högtalare: ram och ribbor (duken bakas för sig)
    P += frame("grillframe", gx - 0.4, gx + 0.4, 2.45, 4.45, y0 - 0.03, 0.05, 0.06, "TvBrass")
    for i in range(5):
        P.append(bar(f"slat{i}", (gx - 0.4, y0 - 0.045, 2.7 + i * 0.38), (gx + 0.4, y0 - 0.045, 2.7 + i * 0.38), 0.04,
                     0.04, "TvWood"))
    # kromlist och skrivstilsskylt under bildrutan, kromad kantlist
    P.append(bar("trim", (-2.6, y0 - 0.016, 0.98), (1.4, y0 - 0.016, 0.98), 0.035, 0.03, "TvChrome"))
    P.append(front_text("brand", "Royal Tone", 0.3, 0.02, "TvChrome", (-0.6, y0 - 0.02, 1.16), font="script",
                        max_width=1.4))
    P.append(front_text("model", "MODELL 53  ·  21 RÖR", 0.07, 0.004, "TvChrome", (-0.6, y0 - 0.012, 0.86),
                        max_width=1.1))
    # kanalväljarens sifferskiva (elfenben) med kanalerna 2–13 runt kanalratten
    P.append(lathe("chanring", [(0.0, 0.0), (0.42, 0.0), (0.43, 0.01), (0.42, 0.022), (0.0, 0.024)], seg=64,
                   material="TvIvory"))
    transform(P[-1], rot=(90, 0, 0))
    transform(P[-1], loc=(gx, y0 - 0.005, 1.95))
    for k, ch in enumerate(range(2, 14)):
        a = math.radians(-150 + 300 * k / 11)
        pos = (gx + math.sin(a) * 0.33, y0 - 0.031, 1.95 + math.cos(a) * 0.33)
        P.append(front_text(f"ch{ch}", str(ch), 0.07, 0.003, "TvPrint", pos, max_width=0.075))
    # kaninöronantenn: anlöpt krom, ena spröt lätt böjt, tejp vid leden
    P.append(lathe("ant_base", [(0.0, 0.0), (0.42, 0.0), (0.44, 0.03), (0.38, 0.14), (0.22, 0.24), (0.1, 0.27),
                                (0.0, 0.28)], seg=40, material="TvBakelite", center=(0.6, -0.4, H)))
    for s in (1, -1):
        base = Vector((0.6 + 0.08 * s, -0.4, H + 0.24))
        d = Vector((math.sin(math.radians(28)) * s, 0.25, math.cos(math.radians(28)))).normalized()
        bend = Vector((0.0, -0.18, 0.0)) if s > 0 else Vector((0, 0, 0))
        for k, (L0, L1, r) in enumerate(((0.0, 0.8, 0.032), (0.78, 1.5, 0.024), (1.48, 2.15, 0.017))):
            a = base + d * L0 + bend * max(0.0, (L0 - 0.8) / 1.35) ** 2
            b = base + d * L1 + bend * max(0.0, (L1 - 0.8) / 1.35) ** 2
            P.append(cyl(f"ant{s}{k}", tuple(a), tuple(b), r, seg=12, material="TvChrome"))
            if k:
                P.append(cyl(f"antj{s}{k}", tuple(a), tuple(a + (b - a).normalized() * 0.04), r * 1.35, seg=12,
                             material="TvChrome", bevel=0.004))
        tip = base + d * 2.16 + bend
        P.append(ellipsoid(f"ant_tip{s}", tuple(tip), (0.032, 0.032, 0.032), "TvChrome", seg=14, rings=8))
        P.append(lathe(f"ant_hinge{s}", [(0.06, -0.05), (0.065, -0.04), (0.065, 0.04), (0.06, 0.05)], seg=16,
                       material="TvBrass"))
        orient(P[-1], (0, 0, 0), (1, 0, 0))
        transform(P[-1], loc=tuple(base))
        if s < 0:
            tp = base + d * 0.55
            P.append(cyl("tape", tuple(tp - d * 0.07), tuple(tp + d * 0.07), 0.042, seg=14, material="Tape",
                         bevel=0.006))
    P.append(twisted_cord("cord", [(1.0, 2.27, 2.0), (1.1, 2.6, 1.0), (1.3, 3.0, 0.04), (2.2, 3.4, 0.04)], 0.045,
                          "TvCord", pitch=0.12))
    cab = finish(P, "tv", 40)

    grille = plate("grille", rounded_rect(0.8, 2.0, 0.08, n=4, cx=gx, cy=3.45), y0 - 0.012, "TvCloth",
                   uv_rect=(gx - 0.4, 2.45, gx + 0.4, 4.45))
    screen = plate("screen", inner, y0 + 0.37, "Screen", uv_rect=(sx - sw / 2, sz - sh / 2, sx + sw / 2, sz + sh / 2),
                   bulge=0.1, grid=8)
    smooth(screen, 80)
    set_origin(screen, (sx, y0 + 0.37, sz))
    knobs_o = [knob3("knob_channel", (gx, y0 - 0.03, 1.95), 0.22, 0.2, "TvBakelite", "TvBrass", "TvKnobPrint"),
               knob3("knob_volume", (gx, y0 - 0.01, 1.24), 0.15, 0.16, "TvBakelite", "TvBrass", "TvKnobPrint",
                     ticks=11, skirt_mat="TvBakelite"),
               knob3("knob_contrast", (gx, y0 - 0.01, 0.8), 0.1, 0.11, "TvBakelite", None, "TvKnobPrint")]
    mats.bake_set([cab] + knobs_o, "Tv", res(2048), ao_dist=0.5)
    mats.bake_set([grille], "TvFabric", (res(1024), res(2048)), ao_dist=0.1, unwrap=False)
    cab = join([cab, grille], "tv")
    for o in [screen] + knobs_o:
        set_parent(o, cab)
    cam_at(cab, "cam", (sx, -9.6, sz + 0.1), (sx, y0, sz))
    return cab


# ======================================================================= rekvisitan

def lamp():
    """Bankirlampa: mässingsfot i två steg med patina, böjd stång, grön glasskärm (damm ovanpå, bakat) med varm
    vit opal på insidan (emissiv), glödlampa, dragkedja. Returnerar (kropp, skärm, specialdelar)."""
    mats.brass_worn("LampBrass", polish=0.7, patina=0.85, prints=[(0.55, 0.0, 0.36), (0.8, -0.36, 1.55)])
    mats.felt("LampFelt", "#1f3a26")
    mats.cloth_cord("LampCord", "#2a2420")
    m, t = mats.fresh("LampShadeSrc")  # glaset i atlasen: grönt med damm på ovansidan
    col, rough, _ = mats.dust(t, mats.srgb("#0c4321"), 0.08, 0.7)
    t.set(col, rough, 0.0)
    for s in ("Opal", "Bulb"):
        mats.special(s)
    P, S = [], []
    pl = prism("plinth", rounded_rect(2.0, 1.3, 0.3, n=8), 0.2, "LampBrass", axis="Z", center=(0, 0, 0.11))
    add_bevel(pl, 0.06, 4, 0.7)
    P.append(pl)
    pl2 = prism("plinth2", rounded_rect(1.3, 0.8, 0.22, n=8, cy=0.1), 0.12, "LampBrass", axis="Z", center=(0, 0, 0.27))
    add_bevel(pl2, 0.04, 4, 0.7)
    P.append(pl2)
    P.append(prism("felt", rounded_rect(1.9, 1.2, 0.28, n=8), 0.012, "LampFelt", axis="Z", center=(0, 0, 0.006)))
    P.append(tube("stem", [(0, 0.25, 0.3), (0, 0.25, 1.6), (0, 0.23, 2.2), (0, 0.15, 2.5), (0, 0.04, 2.66),
                           (0, -0.05, 2.7)], [0.065, 0.058, 0.054, 0.05, 0.046, 0.044], "LampBrass", seg=16))
    for z in (0.32, 1.2):
        P.append(lathe(f"collar{z}", [(0.08, 0.0), (0.1, 0.03), (0.1, 0.08), (0.08, 0.11)], seg=24,
                       material="LampBrass", center=(0, 0.25, z), cap_bottom=False, cap_top=False))
    P.append(knurled("switch", 0.08, 0.1, "LampBrass", ridges=16))
    transform(P[-1], loc=(0.55, 0.0, 0.33))
    L, R = 2.4, 0.6
    outer, inner_ = [], []
    for i in range(17):
        x = -L / 2 + L * i / 16
        arc_o, arc_i = [], []
        for k in range(25):
            a = math.radians(200 - 220 * k / 24)
            arc_o.append((x, math.cos(a) * R, 2.25 + math.sin(a) * R * 0.85))
            arc_i.append((x, math.cos(a) * (R - 0.035), 2.25 + math.sin(a) * (R - 0.035) * 0.85))
        outer.append(arc_o)
        inner_.append(arc_i)
    shade = loft("shade", outer, "LampShadeSrc", closed=False)
    sh_i = loft("shade_in", inner_, "Opal", closed=False)
    if sum((p.center - Vector((p.center.x, 0, 2.25))).dot(p.normal) for p in shade.data.polygons) < 0:
        shade.data.flip_normals()
    if sum((p.center - Vector((p.center.x, 0, 2.25))).dot(p.normal) for p in sh_i.data.polygons) > 0:
        sh_i.data.flip_normals()
    S.append(sh_i)
    for k in (0, 24):
        P.append(tube(f"rim{k}", [(x, outer[0][k][1] * 1.03, outer[0][k][2]) for x in (-L / 2 - 0.02, L / 2 + 0.02)],
                      0.025, "LampBrass", seg=10))
    arc = [(math.cos(math.radians(200 - 220 * k / 24)) * (R + 0.025),
            2.25 + math.sin(math.radians(200 - 220 * k / 24)) * (R + 0.025) * 0.85) for k in range(25)]
    for s in (1, -1):
        cp = prism(f"cap{s}", list(reversed(arc)), 0.045, "LampBrass", axis="X", center=(s * (L / 2 + 0.012), 0, 0))
        add_bevel(cp, 0.012, 3, 0.7)
        P.append(cp)
    P.append(box("clamp", (0, -0.05, 2.25 + R * 0.85 + 0.02), (0.2, 0.18, 0.06), "LampBrass", bevel=0.025, segments=3))
    for i in range(10):
        P.append(ellipsoid(f"chain{i}", (0.8, -0.36, 1.95 - i * 0.04), (0.012, 0.012, 0.02), "LampBrass", seg=8,
                           rings=5))
    P.append(ellipsoid("bead", (0.8, -0.36, 1.52), (0.035, 0.035, 0.05), "LampBrass", seg=16, rings=10))
    P.append(lathe("socket", [(0.07, 0.0), (0.08, 0.05), (0.08, 0.2), (0.06, 0.22)], seg=24, material="LampBrass",
                   center=(0, -0.05, 2.2), cap_top=False))
    transform(P[-1], rot=(180, 0, 0), pivot=(0, -0.05, 2.32))
    S.append(lathe("bulb", [(0.0, -0.32), (0.08, -0.3), (0.13, -0.22), (0.12, -0.12), (0.06, -0.04), (0.06, 0.0)],
                   seg=24, material="Bulb", center=(0, -0.05, 2.12)))
    for p in P + S + [shade]:
        if p.name.startswith(("shade", "cap", "chain", "bead", "rim", "clamp", "socket", "bulb")):
            transform(p, rot=(-8, 0, 0), pivot=(0, 0, 2.25))
    P.append(twisted_cord("cord", [(0, 0.66, 0.08), (0.1, 1.0, 0.04), (0.6, 1.6, 0.04), (1.6, 1.9, 0.04)], 0.04,
                          "LampCord", pitch=0.11))
    ob = finish(P, "lamp", 40)
    smooth(shade, 60)
    return ob, shade, S


def ashtray():
    """Tung mässingsaskkopp (patina, fingeravtryck) med tre skåror, lös aska och en utfimpad cigarett. Cigarren
    har en kort sprucken askkon, en tunn glödande ring (emissiv textur) och en påhittad cigarrring."""
    mats.brass_worn("AshBrass", polish=0.5, patina=0.9, scale=0.35, prints=[(0.6, -0.3, 0.3)])
    mats.cigar("Cigar")
    mats.ash("Ash")
    mats.painted("CigarBand", "#8c1c14", rough=0.4, wear=0.0)
    mats.painted("BandGold", "#c9a24f", rough=0.3, wear=0.0)
    mats.print_worn("BandPrint", "#f2e6c8", "#8c1c14", 0.15)
    mats.ivory_worn("CigPaper", "#ece6d8")
    mats.ember_tex("Ember")
    P, S = [], []
    bowl = lathe("bowl", [(0.0, 0.0), (0.66, 0.0), (0.7, 0.025), (0.73, 0.26), (0.71, 0.32), (0.66, 0.345),
                          (0.56, 0.35), (0.5, 0.31), (0.47, 0.14), (0.42, 0.11), (0.0, 0.1)], seg=96,
                 material="AshBrass")
    for i in range(3):
        a = math.radians(30 + i * 120)
        c = cyl(f"notch{i}", (math.cos(a) * 0.4, math.sin(a) * 0.4, 0.4), (math.cos(a) * 0.95, math.sin(a) * 0.95, 0.4),
                0.1, seg=24, material="AshBrass")
        bo = bowl.modifiers.new(f"n{i}", "BOOLEAN")
        bo.operation = "DIFFERENCE"
        bo.solver = "EXACT"
        bo.object = c
    add_bevel(bowl, 0.012, 3, 0.6)
    lib.apply_mods(bowl)
    for o in [o for o in bpy.data.objects if o.name.startswith("notch")]:
        bpy.data.objects.remove(o)
    P.append(bowl)
    pile = lathe("ash_pile", [(0.0, 0.1), (0.38, 0.1), (0.28, 0.125), (0.14, 0.15), (0.0, 0.16)], seg=40,
                 material="Ash")
    for v in pile.data.vertices:
        if v.co.z > 0.105:
            v.co.z += math.sin(v.co.x * 23) * math.cos(v.co.y * 19) * 0.014
    P.append(pile)
    import random
    rnd = random.Random(4)
    for k in range(14):  # lösa askflagor
        a, r = rnd.uniform(0, math.tau), rnd.uniform(0.12, 0.42)
        e = ellipsoid(f"flake{k}", (math.cos(a) * r, math.sin(a) * r, 0.118 + rnd.uniform(0, 0.02)),
                      (rnd.uniform(0.02, 0.045), rnd.uniform(0.015, 0.03), 0.008), "Ash", seg=8, rings=4)
        transform(e, rot=(rnd.uniform(-20, 20), rnd.uniform(-20, 20), rnd.uniform(0, 180)),
                  pivot=(math.cos(a) * r, math.sin(a) * r, 0.12))
        P.append(e)
    # cigarren: tobak, kort askkon i den brinnande änden, tunn glödring mellan aska och tobak
    a = math.radians(30)
    d = Vector((math.cos(a), math.sin(a), 0.12)).normalized()
    start = Vector((math.cos(a) * 0.12, math.sin(a) * 0.12, 0.335))
    pts = [start + d * t for t in (0.0, 0.05, 0.3, 0.7, 1.05, 1.2)]
    P.append(tube("cigar", pts, [0.07, 0.075, 0.078, 0.078, 0.07, 0.055], "Cigar", seg=24))
    P.append(tube("ash", [start - d * 0.16, start - d * 0.11, start - d * 0.04, start - d * 0.004],
                  [0.045, 0.06, 0.066, 0.068], "Ash", seg=24))
    ring = torus("ember", (0, 0, 0), 0.069, 0.007, "Ember", seg=40, rseg=8)
    lib.uv_box(ring, 18.0)
    orient(ring, (0, 0, 0), tuple(d))
    transform(ring, loc=tuple(start - d * 0.003))
    S.append(ring)
    # cigarrringen: röd med guldkanter och påhittat namn ovanpå
    band = start + d * 0.85
    P.append(tube("band", [band - d * 0.065, band + d * 0.065], [0.081, 0.081], "CigarBand", seg=24))
    for off in (-0.065, 0.065):
        P.append(tube(f"bandgold{off}", [band + d * (off - 0.008), band + d * (off + 0.008)], [0.083, 0.083],
                      "BandGold", seg=24))
    upv = (Vector((0, 0, 1)) - d * d.z).normalized()
    side = upv.cross(d)
    txt = text_mesh("bandtext", "LA PALOMA", 0.045, 0.002, "BandPrint", max_width=0.115)
    M = Matrix((tuple(d) + (0,), tuple(side) + (0,), tuple(upv) + (0,), (0, 0, 0, 1))).transposed()
    txt.data.transform(Matrix.Translation(band + upv * 0.0815) @ M)
    P.append(txt)
    # utfimpad cigarett
    b2 = Vector((-0.2, -0.15, 0.165))
    d2 = Vector((-0.9, 0.3, 0.25)).normalized()
    P.append(tube("butt", [b2, b2 + d2 * 0.22], [0.028, 0.03], "CigPaper", seg=12))
    P.append(tube("butt_ash", [b2 - d2 * 0.02, b2 + d2 * 0.01], [0.022, 0.028], "Ash", seg=12))
    ob = finish(P, "ashtray", 40)
    smoke_at = tuple(start - d * 0.17 + Vector((0, 0, 0.04)))
    return ob, S, smoke_at


def phone():
    """Klassisk svart bakelittelefon (40/50-tal): mjukt rundad gjuten bas med formlinje, nummerskiva i nickel med
    fingerhål, siffror och fingerstopp (egen nod `dial`, vrids kring sin axel), lur i klykan (egen nod `handset`),
    nummerlapp under plastfönster, tvinnade textilsladdar, gummifötter. Sliten: matt nött bakelit där händerna tar,
    repor, damm i skrevorna, halvt bortnötta siffror. Returnerar (bas, [dial, handset], specialdelar för dial)."""
    mats.bakelite_worn("PhoneBakelite", color="#0a0908", mottle="#15120f", gloss=0.08,
                       prints=[(0.0, 0.25, 1.33), (0.55, 0.25, 1.3), (-0.3, -0.75, 0.75)], dust_amt=0.35, chips=0.5)
    mats.chrome_worn("PhoneNickel", scale=0.12)
    mats.ivory_worn("PhoneEnamel", "#ece6d6")
    mats.print_worn("PhoneDigits", "#151210", "#e8e1cf", 0.4)
    mats.ivory_worn("PhoneCard", "#f1ead8")
    mats.print_worn("PhoneCardPrint", "#7a1d14", "#f1ead8", 0.25)
    mats.cloth_cord("PhoneCord", "#1f1915")
    mats.rubber("PhoneRubber")
    mats.special("Glass")

    # ---- basen: loft av rundade rektanglar (bred fot, smalare topp, sluttande front) + subdivision = gjuten form
    secs = []
    for (z, w, d, cy, r) in ((0.0, 1.86, 2.04, 0.01, 0.42), (0.06, 1.9, 2.08, 0.01, 0.44), (0.13, 1.9, 2.08, 0.01, 0.44),
                             (0.16, 1.84, 2.0, 0.01, 0.42), (0.4, 1.74, 1.738, 0.131, 0.4), (0.62, 1.56, 1.447, 0.217, 0.36),
                             (0.8, 1.3, 1.148, 0.256, 0.3), (0.86, 1.18, 1.01, 0.255, 0.26)):
        secs.append([(u, v, z) for (u, v) in rounded_rect(w, d, r, n=6, cy=cy)])
    base = loft("base", secs, "PhoneBakelite")
    lib.add_subsurf(base, 1)
    P = [base]
    # formlinje: en mjuk vulst runt foten
    ring = [(u * 1.0, v, 0.135) for (u, v) in rounded_rect(1.93, 2.13, 0.45, n=6)]
    ring.append(ring[0])
    P.append(tube("formline", ring, 0.018, "PhoneBakelite", seg=8, cap=False))
    # nummerskivans säte på den sluttande fronten
    c = Vector((0, -0.66, 0.48))
    nrm = Vector((0, -1.0, 1.05)).normalized()
    xr = Vector((1, 0, 0))
    yr = nrm.cross(xr).normalized()  # uppåt längs sluttningen
    seat = lathe("seat", [(0.0, -0.08), (0.42, -0.08), (0.43, -0.03), (0.41, 0.0), (0.33, 0.005), (0.0, 0.005)],
                 seg=48, material="PhoneBakelite")
    numring = lathe("numring", [(0.19, 0.006), (0.37, 0.006), (0.375, 0.014), (0.19, 0.014)], seg=48,
                    material="PhoneEnamel", cap_bottom=False)
    for o in (seat, numring):
        orient(o, (0, 0, 0), tuple(nrm))
        transform(o, loc=tuple(c))
    P += [seat, numring]
    # siffror på emaljringen under fingerhålen (1 överst till höger, 0 längst ned)
    for i, dg in enumerate("1234567890"):
        ang = math.radians(60 + i * 27)
        pos = c + nrm * 0.016 + xr * (math.cos(ang) * 0.315) + yr * (math.sin(ang) * 0.315)
        P.append(front_text(f"digit{dg}", dg, 0.06, 0.002, "PhoneDigits", tuple(pos), max_width=0.05,
                            normal=tuple(nrm)))
    # fingerstopp i nickel (fast i basen)
    sa = math.radians(-38)
    rim = lambda rr, h: c + nrm * h + xr * (math.cos(sa) * rr) + yr * (math.sin(sa) * rr)  # noqa: E731
    stop = tube("stop", [rim(0.42, 0.0), rim(0.4, 0.06), rim(0.34, 0.085), rim(0.3, 0.08)],
                [0.02, 0.019, 0.017, 0.015], "PhoneNickel", seg=10)
    P.append(stop)
    # klykan: två gafflar och kontaktsprinten mellan dem
    for s in (1, -1):
        P.append(lathe(f"post{s}", [(0.09, 0.0), (0.08, 0.06), (0.07, 0.22), (0.075, 0.26), (0.0, 0.27)], seg=20,
                       material="PhoneBakelite", center=(0.6 * s, 0.27, 0.8)))
        fk = prism(f"fork{s}", [(-0.13, 0.0), (0.13, 0.0), (0.14, 0.09), (0.08, 0.085), (0.0, 0.035), (-0.08, 0.085),
                                (-0.14, 0.09)], 0.17, "PhoneBakelite", axis="X", center=(0.6 * s, 0.27, 1.05))
        add_bevel(fk, 0.025, 3, 0.6)
        P.append(fk)
    P.append(cyl("plunger", (0, 0.27, 0.84), (0, 0.27, 0.93), 0.045, seg=14, material="PhoneNickel", bevel=0.01))
    # gummifötter
    for x in (-0.72, 0.72):
        for y in (-0.82, 0.82):
            P.append(lathe(f"foot{x}{y}", [(0.0, -0.03), (0.1, -0.03), (0.12, -0.01), (0.12, 0.02), (0.0, 0.02)],
                           seg=16, material="PhoneRubber", center=(x, y, 0)))
    # sladdar: från basens sida upp till luren, och nätsladden bakåt ut på bordet (tvinnade, textilomspunna)
    P.append(twisted_cord("cord", [(0.86, 0.45, 0.32), (1.14, 0.5, 0.45), (1.22, 0.36, 0.8), (1.08, 0.27, 1.0)],
                          0.034, "PhoneCord", pitch=0.11, per_pitch=4, seg=5))
    P.append(twisted_cord("line", [(-0.45, 0.98, 0.18), (-0.55, 1.35, 0.04), (-1.2, 1.9, 0.04), (-2.2, 2.0, 0.04)],
                          0.03, "PhoneCord", pitch=0.14, per_pitch=4, seg=4))
    # förhöj baslinjen: lyft allt så att gummifötterna står på z = 0
    body = finish(P, "phone", 40)
    transform(body, loc=(0, 0, 0.03))

    # ---- nummerskivan (egen nod): fingerhjul i nickel med tio hål, nummerlapp under plastfönster
    D = []
    wheel = lathe("fingerwheel", [(0.0, 0.0), (0.345, 0.0), (0.358, 0.012), (0.36, 0.035), (0.348, 0.05),
                                  (0.15, 0.05), (0.138, 0.04), (0.0, 0.04)], seg=48, material="PhoneNickel")
    for i in range(10):
        ang = math.radians(60 + i * 27)
        h = cyl(f"hole{i}", (math.cos(ang) * 0.315, math.sin(ang) * 0.315, -0.1),
                (math.cos(ang) * 0.315, math.sin(ang) * 0.315, 0.2), 0.05, seg=14, material="PhoneNickel")
        bo = wheel.modifiers.new(f"h{i}", "BOOLEAN")
        bo.operation = "DIFFERENCE"
        bo.solver = "EXACT"
        bo.object = h
    add_bevel(wheel, 0.005, 1, 0.6)
    lib.apply_mods(wheel)
    for o in [o for o in bpy.data.objects if o.name.startswith("hole")]:
        bpy.data.objects.remove(o)
    D.append(wheel)
    D.append(lathe("card", [(0.0, 0.042), (0.13, 0.042), (0.13, 0.046), (0.0, 0.046)], seg=40, material="PhoneCard"))
    D.append(text_mesh("cardtext", "KUNGSHOLM 12 34", 0.04, 0.001, "PhoneCardPrint", max_width=0.2))
    transform(D[-1], loc=(0, 0.018, 0.047))
    D.append(text_mesh("cardtext2", "ARMSTRONG TELEFON", 0.025, 0.001, "PhoneCardPrint", max_width=0.17))
    transform(D[-1], loc=(0, -0.04, 0.047))
    D.append(torus("retainer", (0, 0, 0.055), 0.136, 0.012, "PhoneNickel", seg=36, rseg=6))
    dial = finish(D, "dial", 40)
    window = lathe("window", [(0.0, 0.055), (0.13, 0.055), (0.13, 0.06), (0.0, 0.065)], seg=40, material="Glass")
    # skivan byggd längs +Z: rikta mot sluttningens normal och sätt nodens rotation (spelet vrider kring axeln)
    q = Vector((0, 0, 1)).rotation_difference(nrm)
    for o in (dial, window):
        o.rotation_mode = "QUATERNION"
        o.rotation_quaternion = q
        o.location = c + nrm * 0.012 + Vector((0, 0, 0.03))
    bpy.context.view_layer.update()

    # ---- luren (egen nod): handtag, hörlur och mikrofon med perforerade lock, sladdstump
    Hs = []
    Hs.append(tube("handle", [(-0.82, 0.0, -0.06), (-0.45, 0.0, 0.01), (0.0, 0.0, 0.035), (0.45, 0.0, 0.01),
                              (0.82, 0.0, -0.06)], [0.11, 0.104, 0.1, 0.104, 0.11], "PhoneBakelite", seg=20))
    for s in (1, -1):
        cup = lathe(f"cup{s}", [(0.09, 0.0), (0.17, 0.06), (0.24, 0.15), (0.26, 0.21), (0.255, 0.245), (0.21, 0.255),
                                (0.0, 0.25)], seg=40, material="PhoneBakelite")
        transform(cup, rot=(180, 0, 0))
        transform(cup, loc=(0.95 * s, 0.0, 0.0))
        Hs.append(cup)
        lid = lathe(f"lid{s}", [(0.0, 0.0), (0.19, 0.0), (0.2, 0.012), (0.16, 0.022), (0.0, 0.026)], seg=40,
                    material="PhoneBakelite")
        transform(lid, rot=(180, 0, 0))
        transform(lid, loc=(0.95 * s, 0.0, -0.255))
        Hs.append(lid)
        for k in range(13):
            ang = math.tau * k / 6
            rr = 0.0 if k == 0 else (0.06 if k <= 6 else 0.12)
            ang += 0.0 if k <= 6 else math.pi / 6
            Hs.append(cyl(f"perf{s}{k}", (0.95 * s + math.cos(ang) * rr, math.sin(ang) * rr, -0.27),
                          (0.95 * s + math.cos(ang) * rr, math.sin(ang) * rr, -0.284), 0.016, seg=6,
                          material="PhoneRubber"))
    handset = finish(Hs, "handset", 40)
    hpos = Vector((0.0, 0.27, 1.24))
    handset.location = hpos
    bpy.context.view_layer.update()
    return body, [dial, handset], [window]


def cup():
    """Kaffekopp på fat: elfenbensvitt porslin med krakelerad glasyr, guldkant, kafferand som runnit ned på
    utsidan, kaffering på fatet, ett kantstött hack i koppkanten, en sked."""
    mats.porcelain_worn("Porcelain", "#efe5cf", drip=(-55, 0.72, 0.38), ring=((0.06, -0.04), 0.3))
    mats.bisque("Bisque")
    mats.gilt("Gilt")
    mats.coffee("Coffee")
    mats.chrome_worn("Spoon", 0.1)
    P = []
    P.append(lathe("saucer", [(0.0, 0.0), (0.46, 0.0), (0.48, 0.012), (0.5, 0.03), (0.7, 0.055), (0.77, 0.095),
                              (0.785, 0.112), (0.77, 0.12), (0.5, 0.072), (0.33, 0.08), (0.31, 0.075), (0.0, 0.07)],
                   seg=96, material="Porcelain"))
    P.append(torus("saucer_rim", (0, 0, 0.113), 0.778, 0.009, "Gilt", seg=96, rseg=8))
    cupb = lathe("cup", [(0.0, 0.07), (0.24, 0.07), (0.26, 0.085), (0.27, 0.11), (0.38, 0.3), (0.425, 0.6),
                         (0.435, 0.715), (0.43, 0.73), (0.415, 0.73), (0.41, 0.71), (0.395, 0.6), (0.35, 0.32),
                         (0.25, 0.14), (0.0, 0.13)], seg=96, material="Porcelain")
    # kantstött hack i kanten (boolean), ytan blir oglaserad
    chip = ellipsoid("chipcut", (math.cos(math.radians(150)) * 0.43, math.sin(math.radians(150)) * 0.43, 0.732),
                     (0.03, 0.022, 0.018), "Bisque", seg=16, rings=10)
    bo = cupb.modifiers.new("Chip", "BOOLEAN")
    bo.operation = "DIFFERENCE"
    bo.solver = "EXACT"
    bo.object = chip
    bo.material_mode = "TRANSFER"
    lib.apply_mods(cupb)
    bpy.data.objects.remove(chip)
    P.append(cupb)
    rim = torus("cup_rim", (0, 0, 0.726), 0.424, 0.011, "Gilt", seg=96, rseg=8)
    # guldkanten är borta där hacket sitter
    import bmesh as _bm
    bm = _bm.new()
    bm.from_mesh(rim.data)
    kill = [v for v in bm.verts if math.atan2(v.co.y, v.co.x) > math.radians(140)
            and math.atan2(v.co.y, v.co.x) < math.radians(160)]
    _bm.ops.delete(bm, geom=kill, context="VERTS")
    bm.to_mesh(rim.data)
    bm.free()
    P.append(rim)
    P.append(torus("foot_ring", (0, 0, 0.1), 0.262, 0.008, "Gilt", seg=64, rseg=6))
    P.append(lathe("coffee", [(0.0, 0.6), (0.392, 0.6)], seg=64, material="Coffee", cap_bottom=False))
    pts = [(0.39 + 0.17 * math.sin(math.radians(a)), 0, 0.46 + 0.17 * math.cos(math.radians(a))) for a in range(10, 191, 12)]
    P.append(tube("handle", pts, 0.038, "Porcelain", seg=14))
    P.append(tube("spoon", [(-0.15, -0.44, 0.115), (0.12, -0.56, 0.13), (0.3, -0.62, 0.12)], [0.02, 0.016, 0.024],
                  "Spoon", seg=10))
    P.append(ellipsoid("spoon_bowl", (-0.25, -0.41, 0.1), (0.11, 0.07, 0.022), "Spoon", seg=20, rings=10))
    return finish(P, "cup", 40)


def rake():
    """Krupiärräfsa som i krigsrummen: lång, tunn, polerad trästång som smalnar av mot bladet, mässingshylsa i
    skarven och ändhylsa, platt T-blad i trä med filtad undersida och mässingskant, nött grepp.
    Ligger på bordet, bladet mot +X, origo mitt under stången."""
    mats.wood_worn("RakeWood", "black_walnut_veneer_02", tint="#c98c4c", scale=0.7, darken=1.15, gloss=0.14,
                   rot=(0, 90, 0), knobs=[((-3.6, 0.0, 0.06), 0.8)], bleach=0.3, wear=1.0)
    mats.brass_worn("RakeBrass", polish=1.2, patina=0.6, prints=[(4.25, 0.0, 0.1)])
    mats.felt("RakeFelt", "#264a2b")
    P = []
    # stången: avsmalnande mot bladet, lätt nedåt mot greppet där den vilar på bordet
    pts = [(-4.35 + 8.55 * t, 0.0, 0.05 + 0.085 * t) for t in (0.0, 0.25, 0.5, 0.75, 1.0)]
    P.append(tube("pole", pts, [0.05, 0.047, 0.043, 0.039, 0.034], "RakeWood", seg=24))
    P.append(lathe("endcap", [(0.0, -0.06), (0.04, -0.058), (0.052, -0.04), (0.054, 0.04), (0.05, 0.05)], seg=24,
                   material="RakeBrass"))
    orient(P[-1], (0, 0, 0), (1, 0, 0.01))
    transform(P[-1], loc=(-4.35, 0, 0.05))
    # mässingshylsan i skarven och fästet mot bladet
    P.append(lathe("ferrule", [(0.036, -0.02), (0.045, 0.0), (0.045, 0.05), (0.04, 0.06), (0.04, 0.16), (0.048, 0.17),
                               (0.048, 0.2), (0.03, 0.22)], seg=28, material="RakeBrass", cap_bottom=False))
    orient(P[-1], (0, 0, 0), (1, 0, 0.01))
    transform(P[-1], loc=(4.06, 0, 0.134))
    # T-bladet: platt träskiva på högkant med rundade ändar, filt under, mässingskant längs nederkanten
    blade_outline = rrect4(1.6, 0.24, 0.1, 0.03, n=8)
    blade = prism("blade", blade_outline, 0.055, "RakeWood", axis="X", center=(4.33, 0, 0.135))
    add_bevel(blade, 0.012, 3, 0.6)
    P.append(blade)
    P.append(box("felt", (4.33, 0, 0.0075), (0.05, 1.56, 0.015), "RakeFelt", bevel=0.004, segments=2))
    P.append(box("edge_f", (4.302, 0, 0.032), (0.006, 1.58, 0.035), "RakeBrass", bevel=0.002, segments=2))
    P.append(box("edge_b", (4.358, 0, 0.032), (0.006, 1.58, 0.035), "RakeBrass", bevel=0.002, segments=2))
    P.append(box("bracket", (4.27, 0, 0.14), (0.04, 0.22, 0.12), "RakeBrass", bevel=0.01, segments=2))
    for y in (-0.07, 0.07):
        P.append(screw(f"screw{y}", (4.248, y, 0.14), 0.016, (-1, 0, 0), "RakeBrass"))
    return finish(P, "rake", 40)


def inkwell():
    """Bläckhorn i tjockt glas med mässingslock (intorkat bläck vid locket) på ett läskunderlägg med bläckfläckar,
    och en doppenna med stålstift."""
    mats.brass_worn("InkBrass", polish=0.6, patina=0.8)
    m, t = mats.fresh("InkLid")  # locket: mässing med intorkat bläck kring kanten
    v = t.coords(1.0 / 0.15)
    col = t.mix(t.math("MULTIPLY", t.cavity(0.04), 0.9), mats.srgb("#c8994f"), mats.srgb("#4a3a1c"))
    col, rough, _ = mats.ink_crust(t, col, 0.3, 0.57, 0.66)
    t.set(col, rough, 0.85)
    mats.ink("Ink")
    mats.wood("PenWood", "black_walnut_veneer_02", tint="#5a2a14", scale=0.3, darken=1.5, gloss=0.12,
              rot=(0, 90, 0))
    mats.chrome_worn("Nib", 0.05)
    mats.painted("Leather", "#3a2416", rough=0.6, wear=0.5, under="#6a4a32")
    mats.blotter("Blotter", blots=[((0.42, -0.35, 0.02), 0.09), ((-0.3, 0.38, 0.02), 0.05), ((0.55, 0.2, 0.02), 0.035),
                                   ((-0.5, -0.25, 0.02), 0.06)])
    mats.special("Glass")
    P, S = [], []
    P.append(box("blotter", (0.15, 0.0, 0.01), (2.0, 1.5, 0.02), "Blotter", bevel=0.006, segments=2))
    for sx_ in (1, -1):
        for sy_ in (1, -1):
            c = prism(f"corner{sx_}{sy_}", [(0, 0), (-0.28 * sx_, 0), (0, -0.28 * sy_)], 0.026, "Leather", axis="Z",
                      center=(0.15 + 1.0 * sx_, 0.75 * sy_, 0.013))
            add_bevel(c, 0.006, 2, 0.6)
            P.append(c)
    lift = 0.02
    S.append(box("glass", (0, 0, 0.26 + lift), (0.75, 0.75, 0.52), "Glass", bevel=0.08, segments=4))
    P.append(lathe("ink", [(0.0, 0.1 + lift), (0.2, 0.1 + lift), (0.205, 0.4 + lift), (0.0, 0.4 + lift)], seg=32,
                   material="Ink"))
    P.append(lathe("collar", [(0.22, 0.5 + lift), (0.26, 0.52 + lift), (0.265, 0.58 + lift), (0.24, 0.6 + lift),
                              (0.22, 0.6 + lift)], seg=48, material="InkLid", cap_bottom=False))
    P.append(lathe("lid", [(0.275, 0.585 + lift), (0.28, 0.62 + lift), (0.22, 0.69 + lift), (0.08, 0.73 + lift),
                           (0.05, 0.76 + lift), (0.065, 0.8 + lift), (0.0, 0.83 + lift)], seg=48, material="InkLid"))
    P.append(cyl("hinge", (-0.08, 0.29, 0.6 + lift), (0.08, 0.29, 0.6 + lift), 0.03, seg=16, material="InkBrass",
                 bevel=0.006))
    # doppennan: trähållare, mässingshylsa, stålstift med spets och skåra
    z = 0.02 + 0.045
    P.append(tube("pen", [(0.55, -0.6, z), (0.8, -0.1, z), (1.0, 0.3, z), (1.12, 0.52, z - 0.005)],
                  [0.036, 0.042, 0.04, 0.028], "PenWood", seg=14))
    P.append(tube("ferrule", [(1.1, 0.48, z - 0.005), (1.14, 0.56, z - 0.007)], [0.03, 0.026], "InkBrass", seg=14))
    nib = prism("nib", [(0.0, -0.022), (0.1, -0.012), (0.17, 0.0), (0.1, 0.012), (0.0, 0.022)], 0.006, "Nib", axis="Z",
                center=(0, 0, 0))
    add_bevel(nib, 0.0015, 1, 0.6)
    lib.apply_mods(nib)
    d = Vector((1.25 - 1.14, 0.78 - 0.56, -0.01)).normalized()
    ang = math.degrees(math.atan2(d.y, d.x))
    transform(nib, rot=(0, 0, ang))
    transform(nib, loc=(1.14, 0.56, z - 0.008))
    P.append(nib)
    return finish(P, "inkwell", 40), S


def props():
    """Alla rekvisita som egna rotnoder (origo under sig själva), utspridda så att de inte överlappar.
    Varje föremål bakas till en egen atlas."""
    roots = []
    lp, shade, lp_s = lamp()
    lp_mat = mats.bake_set([lp, shade], "Lamp", res(2048), ao_dist=0.3)
    gg = mats.variant(lp_mat, "GreenGlass", transmission=0.3, emission="#2f9a50", strength=0.25)
    for slot in shade.material_slots:
        slot.material = gg
    lp = join([lp, shade] + lp_s, "lamp")
    empty("bulb", (0, -0.08, 2.0), parent=lp)
    at, at_s, smoke_at = ashtray()
    mats.bake_set([at], "Ashtray", res(1024), ao_dist=0.12)
    at = join([at] + at_s, "ashtray")
    empty("smoke", smoke_at, parent=at)
    ph, ph_nodes, ph_s = phone()
    mats.bake_set([ph] + ph_nodes, "Phone", res(1024), ao_dist=0.25)
    dial = join([ph_nodes[0]] + ph_s, "dial")  # plastfönstret följer skivan
    for o in (dial, ph_nodes[1]):
        set_parent(o, ph)
    cp = cup()
    mats.bake_set([cp], "Cup", res(1024), ao_dist=0.12)
    ik, ik_s = inkwell()
    mats.bake_set([ik], "Inkwell", res(1024), ao_dist=0.12)
    ik = join([ik] + ik_s, "inkwell")
    rk = rake()
    mats.bake_set([rk], "Rake", res(1024), ao_dist=0.1)
    for ob, pos in ((lp, (-4.3, 1.7, 0)), (at, (-1.7, -0.5, 0)), (ph, (0.9, 1.1, 0)), (cp, (3.1, -0.4, 0)),
                    (ik, (4.7, 1.3, 0)), (rk, (0, -2.5, 0))):
        ob.location = pos
        roots.append(ob)
    bpy.context.view_layer.update()
    return roots

# ======================================================================= förhandsbilder och export

BUILDERS = {
    "radio": (radio, ((0, 0, 1.4), 9.0, 14, -28)),
    "tv": (tv, ((0, 0, 3.0), 15.5, 12, -30)),
    "props": (props, ((0, 0, 0.7), 14.0, 30, -10)),
}


def build(name, preview=True):
    lib.reset()
    fn, cam = BUILDERS[name]
    roots = fn()
    if not isinstance(roots, list):
        roots = [roots]
    objs = []

    def walk(o):
        objs.append(o)
        for c in o.children:
            walk(c)

    for r in roots:
        walk(r)
    total = 0
    for o in objs:
        if o.type == "MESH":
            n = lib.tris(o)
            total += n
            print(f"  {name}/{o.name}: tris={n}")
    lib.export_glb(os.path.join(lib.RAW, f"{name}.glb"), roots, tangents=True, colors=False)
    if preview:
        t, d, e, a = cam
        lib.preview_setup(target=t, dist=d, elev=e, azim=a, lens=50 if name != "props" else 38, res=(1200, 900),
                          cycles=True, samples=64 if FAST else 128)
        preview_table()
        if name in ("radio", "tv"):
            preview_uvcheck()
        lib.render(os.path.join(lib.PREVIEWS, f"{name}.png"))
        if name == "props":
            for r in roots:
                dims = max(r.dimensions)
                c = r.location + Vector((0, 0, r.dimensions.z * 0.45))
                lib.set_cam(tuple(c), max(dims, 1.2) * 2.2, 24, -30)
                lib.render(os.path.join(lib.PREVIEWS, f"props_{r.name}.png"))
        else:
            lib.set_cam(t, d, 6, 0)
            lib.render(os.path.join(lib.PREVIEWS, f"{name}_front.png"))
            # närbilder av slitaget
            shots = {
                "radio": [("detail", (1.2, -0.9, 0.9), 2.4, 18, -38), ("top", (1.0, 0.15, 2.8), 2.4, 52, -20),
                          ("grille", (-0.9, -0.95, 1.35), 1.2, 6, -12), ("dial", (0.6, -0.95, 2.2), 1.6, 8, -12)],
                "tv": [("detail", (1.6, -2.25, 1.6), 3.4, 14, -40), ("top", (-1.6, -1.6, 5.0), 2.4, 48, -15),
                       ("antenna", (0.6, -0.4, 6.0), 3.6, 12, -30), ("channel", (2.0, -2.25, 1.5), 1.7, 6, -12)],
            }[name]
            for (key, tgt, dd, ee, aa) in shots:
                lib.set_cam(tgt, dd, ee, aa)
                lib.render(os.path.join(lib.PREVIEWS, f"{name}_{key}.png"))
    print(f"PROP {name} tris={total}")


def preview_table():
    """Förhandsbildernas bord: samma mörka trä som spelets bordsskiva."""
    g = bpy.data.objects.get("PreviewGround")
    if not g:
        return
    m, t = mats.fresh("PreviewTable")
    v = t.coords(0.12)

    def tex(f, color):
        im = bpy.data.images.load(os.path.join(lib.ROOT, "public", "tex", f))
        im.colorspace_settings.name = "sRGB" if color else "Non-Color"
        node = t.n("ShaderNodeTexImage", image=im, projection="BOX")
        t.l(v, node.inputs["Vector"])
        return node.outputs["Color"]

    # samma bordsskiva som spelet (public/tex/table_*)
    nm = t.n("ShaderNodeNormalMap", inputs={"Strength": 0.5})
    t.l(tex("table_nor.jpg", False), nm.inputs["Color"])
    t.set(tex("table_diff.jpg", True), t.bw(tex("table_rough.jpg", False)), 0.0, nm.outputs["Normal"])
    g.data.materials.clear()
    g.data.materials.append(m)


def preview_uvcheck():
    """Bara förhandsbilden: rutnät på skalan/rutan för att visa att UV:erna sitter rätt (u höger, v upp)."""
    img = bpy.data.images.new("uvcheck", 256, 256)
    px = []
    for j in range(256):
        for i in range(256):
            line = (i % 32 < 2) or (j % 32 < 2)
            if i < 40 and j < 40:
                px += [0.9, 0.1, 0.1, 1]
            elif i > 215 and j > 215:
                px += [0.1, 0.8, 0.1, 1]
            else:
                v = 0.15 if line else 0.85
                px += [v, v * 0.95, v * 0.8, 1]
    img.pixels = px
    for mname in ("DialGlass", "Screen"):
        m = bpy.data.materials.get(mname)
        if not m:
            continue
        nt = m.node_tree
        tx = nt.nodes.new("ShaderNodeTexImage")
        tx.image = img
        tx.name = "uvcheck"
        b = nt.nodes["Principled BSDF"]
        nt.links.new(tx.outputs["Color"], b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = 0.8


def main():
    only = lib.arg("--only")
    names = only.split(",") if only else list(BUILDERS)
    for n in names:
        if n in BUILDERS:
            build(n, preview="--no-preview" not in lib.argv())


if __name__ == "__main__":
    main()
