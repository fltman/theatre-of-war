"""Trupperna och tärningen: målade tennfigurer (soldat, stridsvagn, fältkanon, trupptransport), kartnål med
pappersflagga och en celluloidtärning.

blender -b -P blender/units.py -- [--only infantry,tank] [--no-preview]
Skriver build/models/<namn>.glb och build/previews/<namn>*.png. Mått och nodnamn: CONTRACT.md ("Modeller").
Blender: Z upp, framåt = -Y, origo mitt under föremålet (står på z = 0). 1 m här = 1 enhet i three = 1 dm på bordet.

Tennfigurerna: under färgen tenn. Vertexfärgen COLOR_0 bär R = AO, G = krökning (0,5 plant, 1 skarp konvex kant,
0 skarp konkav), B = kavitet (för mörk 'wash' i fördjupningar). Spelet målar `Paint` i fraktionens färg och låter
tennet skina igenom där G är högt (sliten färg). Handmålade detaljer är egna material.
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
import mats  # noqa: E402
from lib import (add_bevel, box, cyl, ellipsoid, empty, join, lathe, limb, loft, orient, prism, set_origin,  # noqa: E402
                 set_parent, smooth, transform, tube, torus, srgb)

BT = os.path.join(lib.ROOT, "build", "tex")

# exportmaterialen (enkla glTF-värden). Paint är neutralt ljusgrå: spelet sätter fraktionsfärgen.
UNIT_MATS = {
    "Paint": ("#cfcfcf", 0.0, 0.45),
    "Metal": ("#45474b", 1.0, 0.35),
    "Brass": ("#c9a24f", 1.0, 0.3),
    "Skin": ("#e9b394", 0.0, 0.5),
    "Blush": ("#d8786a", 0.0, 0.5),       # rosiga kinder och mun
    "Leather": ("#4a2c18", 0.0, 0.5),
    "Wood": ("#7a4424", 0.0, 0.45),
    "Dark": ("#1d1c1b", 0.0, 0.5),
    "Base": ("#ffffff", 0.0, 0.92),       # flocktextur
    "Tread": ("#ffffff", 0.7, 0.55),      # bandlänkar (färg + normalkarta)
    "Hull": ("#7d8285", 0.0, 0.6),
    "Ivory": ("#e8dcc0", 0.0, 0.35),
    "Canvas": ("#6b6a45", 0.0, 0.85),
    "FlagPaper": ("#ece2c6", 0.0, 0.9),
    "DiceBody": ("#efe4cc", 0.0, 0.18),
    "Pip": ("#1a1a1a", 0.0, 0.4),
}
PREVIEW_PAINT = "#c99a2e"   # förhandsbildernas fraktion (Gul)
PEWTER = "#9b9c98"


def finish(parts, name, angle=45):
    for p in parts:
        if p.type == "MESH":
            smooth(p, angle)
    return join(parts, name)


def bev(ob, w, seg=2, angle=0.6):
    add_bevel(ob, w, seg, angle)
    return ob


# ======================================================================= material

def export_material(name):
    """Enkelt glTF-material. Base och Tread får sina delade 512-texturer."""
    col, metal, rough = UNIT_MATS[name]
    m, t = mats.fresh(name)
    if name in ("Base", "Tread"):
        uv = t.n("ShaderNodeUVMap", uv_map="UVMap")
        stem = {"Base": "flock", "Tread": "tread"}[name]
        ext = ".jpg" if name == "Base" else ".png"
        dif = bpy.data.images.load(os.path.join(BT, f"{stem}_diff{ext}"))
        nor = bpy.data.images.load(os.path.join(BT, f"{stem}_nor{ext}"))
        nor.colorspace_settings.name = "Non-Color"
        d = t.n("ShaderNodeTexImage", image=dif)
        n = t.n("ShaderNodeTexImage", image=nor)
        for x in (d, n):
            t.l(uv.outputs["UV"], x.inputs["Vector"])
        t.l(d.outputs["Color"], t.bsdf.inputs["Base Color"])
        nm = t.n("ShaderNodeNormalMap", uv_map="UVMap", inputs={"Strength": 1.0})
        t.l(n.outputs["Color"], nm.inputs["Color"])
        t.set(None, rough, metal, nm.outputs["Normal"])
    else:
        t.set(srgb(col), rough, metal)
    return m


def preview_material(name):
    """Förhandsbildens material: visar hur spelet bör använda vertexfärgen (AO, sliten färg mot tenn, wash)."""
    m = export_material(name)
    if name in ("FlagPaper",):
        return m
    t = mats.Tree(m)
    ca = t.n("ShaderNodeVertexColor", layer_name="Col")
    sep = t.n("ShaderNodeSeparateColor")
    t.l(ca.outputs["Color"], sep.inputs["Color"])
    ao, curv, cav = sep.outputs["Red"], sep.outputs["Green"], sep.outputs["Blue"]
    b = t.bsdf
    base = b.inputs["Base Color"].links[0].from_socket if b.inputs["Base Color"].is_linked else None
    col = base if base is not None else tuple(b.inputs["Base Color"].default_value)
    rough = b.inputs["Roughness"].default_value
    metal = b.inputs["Metallic"].default_value
    if name == "Paint":
        col = srgb(PREVIEW_PAINT)
        noise = t.noise(t.coords(160.0), 3, 4, 0.6)
        wear = t.math("MULTIPLY", t.ramp(curv, 0.6, 0.85), t.ramp(noise, 0.3, 0.7))
        wear = t.ramp(wear, 0.25, 0.45)
        colo = t.mix(wear, col, srgb(PEWTER))
        t.set(None, t.mixf(wear, 0.42, 0.32), t.mixf(wear, 0.0, 1.0))
    else:
        colo = t.mix(1.0, col, col, "MIX")
    # wash i fördjupningar och AO
    colo = t.mix(t.math("MULTIPLY", cav, 0.75), colo, srgb("#1b130c"))
    aon = t.n("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
    aon.inputs["Factor"].default_value = 1.0
    t.l(colo, aon.inputs["A"])
    comb = t.n("ShaderNodeCombineColor")
    for ch in ("Red", "Green", "Blue"):
        t.l(ao, comb.inputs[ch])
    t.l(comb.outputs["Color"], aon.inputs["B"])
    t.l(aon.outputs["Result"], b.inputs["Base Color"])
    if name != "Paint":
        b.inputs["Roughness"].default_value = rough
        b.inputs["Metallic"].default_value = metal
    return m


def use_materials(preview):
    names = {s.material.name for o in bpy.data.objects if o.type == "MESH" for s in o.material_slots if s.material}
    names = [n.split("_old")[0] for n in names if n.split("_old")[0] in UNIT_MATS]
    new = {n: (preview_material(n) if preview else export_material(n)) for n in set(names)}
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        for s in o.material_slots:
            if s.material:
                key = s.material.name.split("_old")[0].split(".")[0]
                if key in new:
                    s.material = new[key]
    for m in list(bpy.data.materials):
        if m.users == 0:
            bpy.data.materials.remove(m)


# ======================================================================= vertexfärg

def bake_unit_colors(objs, size):
    """COLOR_0: R = AO (räckvidd ~0,12·storlek), G = krökning (0,5 plant), B = kavitet (kort AO + konkav krökning)."""
    objs = [o for o in objs if o.type == "MESH"]
    for o in objs:
        lib.apply_mods(o)
    sc = bpy.context.scene
    mats.cycles_gpu(48)
    if sc.world is None:
        sc.world = bpy.data.worlds.new("bakeworld")

    def ao_bake(dist):
        sc.world.light_settings.distance = dist
        res = {}
        for o in objs:
            me = o.data
            for a in list(me.color_attributes):
                me.color_attributes.remove(a)
            col = me.color_attributes.new("Col", "BYTE_COLOR", "POINT")
            me.color_attributes.active_color = col
            bpy.ops.object.select_all(action="DESELECT")
            o.select_set(True)
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")
            a = np.zeros(len(me.vertices) * 4, dtype=np.float32)
            col.data.foreach_get("color", a)
            res[o.name] = a.reshape(-1, 4)[:, 0].copy()
        return res

    ao_big = ao_bake(0.12 * size)
    ao_small = ao_bake(0.025 * size)
    for o in objs:
        me = o.data
        n = len(me.vertices)
        co = np.zeros(n * 3, dtype=np.float32); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
        nr = np.zeros(n * 3, dtype=np.float32); me.vertices.foreach_get("normal", nr); nr = nr.reshape(-1, 3)
        e = np.zeros(len(me.edges) * 2, dtype=np.int32); me.edges.foreach_get("vertices", e); e = e.reshape(-1, 2)
        deg = np.bincount(e.ravel(), minlength=n).astype(np.float32)
        acc = np.zeros_like(co)
        np.add.at(acc, e[:, 0], co[e[:, 1]]); np.add.at(acc, e[:, 1], co[e[:, 0]])
        lap = acc / np.maximum(deg, 1)[:, None] - co
        elen = np.linalg.norm(co[e[:, 0]] - co[e[:, 1]], axis=1)
        avg = np.zeros(n, dtype=np.float32); np.add.at(avg, e[:, 0], elen); np.add.at(avg, e[:, 1], elen)
        avg = avg / np.maximum(deg, 1)
        # medelkrökning i världsskala (≈ 1/R, konvex > 0): 4·(lap·n)/L² för jämna grannavstånd L
        curv = -4.0 * (lap * nr).sum(1) / np.maximum(avg * avg, 1e-10)
        rref = 0.0022  # radie som räknas som skarp kant – samma för alla enheter (samma skala på bordet)

        def smooth_(c, k):
            for _ in range(k):
                a2 = np.zeros(n, dtype=np.float32)
                np.add.at(a2, e[:, 0], c[e[:, 1]]); np.add.at(a2, e[:, 1], c[e[:, 0]])
                c = 0.5 * c + 0.5 * a2 / np.maximum(deg, 1)
            return c

        c1 = smooth_(curv, 1)
        G = np.clip(0.5 + 0.5 * c1 * rref, 0, 1)
        c4 = smooth_(curv, 3)
        B = np.clip((1 - ao_small[o.name]) * 1.3 + np.clip(-c4 * rref, 0, None) * 0.6, 0, 1)
        R = np.clip(0.2 + 0.8 * ao_big[o.name], 0, 1)
        # Per hörn (face corner), inte per vertex: på en bred plan yta (stänkskärmens ovansida, kappans stora
        # partier) dämpas den konvexa kantvärdet mot 0,5, så att bara de smala fasningarna blir höga. Annars
        # interpoleras hörnens höga G över hela tunna plåtar och slitaget blir stora flak.
        npoly = len(me.polygons)
        ls = np.zeros(npoly, dtype=np.int32); me.polygons.foreach_get("loop_start", ls)
        lt = np.zeros(npoly, dtype=np.int32); me.polygons.foreach_get("loop_total", lt)
        area = np.zeros(npoly, dtype=np.float32); me.polygons.foreach_get("area", area)
        nl = len(me.loops)
        lv = np.zeros(nl, dtype=np.int32); me.loops.foreach_get("vertex_index", lv)
        lpoly = np.repeat(np.arange(npoly), lt)
        idx_in = np.arange(nl) - ls[lpoly]
        nxt = ls[lpoly] + (idx_in + 1) % lt[lpoly]
        elen_l = np.linalg.norm(co[lv] - co[lv[nxt]], axis=1)
        maxe = np.zeros(npoly, dtype=np.float32)
        np.maximum.at(maxe, lpoly, elen_l)
        width = area / np.maximum(maxe, 1e-9)
        kface = 1.0 - np.clip((width - 1.5 * rref) / (4.0 * rref - 1.5 * rref), 0, 1)
        Gv = G[lv]
        Gl = np.clip(np.where(Gv > 0.5, 0.5 + (Gv - 0.5) * kface[lpoly] * 1.3, Gv), 0, 1)
        for a in list(me.color_attributes):
            me.color_attributes.remove(a)
        col = me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
        me.color_attributes.active_color = col
        out = np.stack([R[lv], Gl, B[lv], np.ones(nl)], 1).astype(np.float32).ravel()
        col.data.foreach_set("color", out)
        print(f"  färg {o.name}: AO {R.mean():.2f}  kant {Gl.mean():.2f} (p95 {np.percentile(Gl, 95):.2f})"
              f"  kavitet {B.mean():.2f} (p95 {np.percentile(B, 95):.2f})")


# ======================================================================= tennsoldaten

def folded_lathe(name, profile, seg, material, folds=6, amp_fn=None, sy=1.0, center=(0, 0, 0)):
    """Rotationskropp med veck: radien moduleras med sin(folds·a) med amplitud amp_fn(z)."""
    bm = bmesh.new()
    rings = []
    for (r, z) in profile:
        amp = amp_fn(z) if amp_fn else 0.0
        ring = []
        for i in range(seg):
            a = math.tau * i / seg
            wob = 0.4 * math.sin(a * 3 + 1.3)
            rr = r * (1 + amp * math.sin(folds * a + wob))
            ring.append(bm.verts.new((center[0] + math.cos(a) * rr, center[1] + math.sin(a) * rr * sy, center[2] + z)))
        rings.append(ring)
    for k in range(len(rings) - 1):
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return lib._obj_from_bm(name, bm, material)


def puttee(name, x, z0, z1, r0, r1, material, turns=5, seg=7):
    """Benlinda: underben med lindningsvarv som små skarpa åsar (ger höga G på varje varv)."""
    prof = []
    n = turns * 2
    for k in range(n + 1):
        t = k / n
        r = r0 + (r1 - r0) * t
        r *= 1.0 + (0.035 if k % 2 else 0.0)
        prof.append((r, z0 + (z1 - z0) * t))
    ob = lathe(name, [(0.0, z0)] + prof + [(0.0, z1)], seg=seg, material=material, center=(x, 0.0, 0.0))
    return ob


def infantry():
    """Tennsoldat i Britains-stil (54 mm): smal, långbent, vapenrock med kjol, benlindor och kängor, koppel med
    patronväskor, Brodiehjälm med tunt brätte och hakrem, 'slope arms' med geväret på vänster axel.
    Ansiktet har målade ögon och rosiga kinder; mustaschen är en egen nod (`moustache`) som spelet kan dölja
    för variation. Skarpa fasningar på kanter (knappar, axelklaffar, fållen, brättet, geväret) så att G blir
    högt där, mjuka stora ytor."""
    B = 0.012
    P = []
    base = lathe("base", [(0.0, 0.0), (0.047, 0.0), (0.0502, 0.003), (0.0502, 0.0085), (0.047, B), (0.0, B)],
                 seg=16, material="Base")
    lib.uv_box(base, 4.0)
    P.append(base)
    for s in (1, -1):
        hx, tx = 0.0072 * s, 0.0105 * s
        # känga: häl, tå och skaft
        P.append(limb(f"boot{s}", (hx, 0.006, B + 0.0055), (tx, -0.012, B + 0.0048), 0.0056, 0.0052, "Leather",
                      seg=7, n=2))
        P.append(limb(f"ankle{s}", (hx, 0.002, B + 0.004), (hx * 1.02, 0.001, B + 0.017), 0.0062, 0.006, "Leather",
                      seg=7, n=1))
        # benlinda och byxben (knäbyxa som vidgar sig något över knät)
        P.append(puttee(f"puttee{s}", hx * 1.05, B + 0.015, B + 0.06, 0.0061, 0.0074, "Paint"))
        P.append(limb(f"thigh{s}", (hx * 1.1, 0.0, B + 0.058), (0.0098 * s, 0.001, B + 0.108), 0.0078, 0.0096, "Paint",
                      seg=7, n=1))
    # vapenrock: kjol under bältet med skarp fåll, smal midja, bröst, sluttande axlar
    tunic = [(0.0, B + 0.088), (0.0206, B + 0.088), (0.0214, B + 0.0915), (0.0204, B + 0.0935), (0.019, B + 0.104),
             (0.0176, B + 0.118), (0.0194, B + 0.134), (0.0212, B + 0.156), (0.0204, B + 0.174), (0.0158, B + 0.184),
             (0.0084, B + 0.189), (0.0, B + 0.189)]
    P.append(lathe("tunic", tunic, seg=16, material="Paint", sy=0.74, center=(0, 0.001, 0)))
    P.append(cyl("collar", (0, 0.001, B + 0.186), (0, 0.001, B + 0.194), 0.0078, seg=12, material="Paint",
                 bevel=0.0007))
    for s in (1, -1):
        P.append(bev(box(f"epaulette{s}", (0.0155 * s, 0.001, B + 0.1835), (0.0105, 0.0085, 0.0024), "Paint"),
                     0.0008, 1))
        transform(P[-1], rot=(0, -24 * s, 0), pivot=(0.0155 * s, 0.001, B + 0.1835))
        # bröstfickor med lock och knapp
        P.append(bev(box(f"pocket{s}", (0.0098 * s, -0.0149, B + 0.161), (0.011, 0.0015, 0.006), "Paint"),
                     0.00035, 1))
        P.append(ellipsoid(f"pbutton{s}", (0.0098 * s, -0.0166, B + 0.1595), (0.0013, 0.0009, 0.0013), "Brass",
                           seg=6, rings=3))
    for i, z in enumerate((0.172, 0.149, 0.131, 0.104)):
        P.append(ellipsoid(f"button{i}", (0, -0.0158 if z > 0.12 else -0.0153, B + z), (0.0017, 0.0011, 0.0017),
                           "Brass", seg=6, rings=3))
    # koppel: bälte, spänne, patronväskor, axelremmar, ryggsäck
    P.append(torus("belt", (0, 0.001, B + 0.118), 0.0179, 0.0026, "Leather", seg=14, rseg=4, sy=0.76))
    P.append(bev(box("buckle", (0, -0.0153, B + 0.118), (0.0068, 0.0022, 0.0058), "Brass"), 0.0006, 1))
    for s in (1, -1):
        for k, dx in enumerate((0.0085, 0.0145)):
            ang = math.atan2(-0.015, dx * s)
            px, py = math.cos(ang) * 0.0186, 0.001 + math.sin(ang) * 0.0186 * 0.78
            pouch = bev(box(f"pouch{s}{k}", (px, py, B + 0.1245), (0.0058, 0.0044, 0.0072), "Leather"), 0.0008, 1)
            transform(pouch, rot=(0, 0, math.degrees(ang) + 90), pivot=(px, py, B + 0.1245))
            P.append(pouch)
        P.append(tube(f"brace{s}", [(0.0135 * s, -0.009, B + 0.184), (0.0118 * s, -0.016, B + 0.16),
                                    (0.0106 * s, -0.0158, B + 0.13)], 0.0016, "Leather", seg=4))
        P.append(tube(f"bbrace{s}", [(0.0135 * s, 0.01, B + 0.184), (0.011 * s, 0.017, B + 0.165)], 0.0016,
                      "Leather", seg=4))
    P.append(bev(box("pack", (0, 0.0182, B + 0.15), (0.026, 0.011, 0.026), "Canvas"), 0.003, 1))
    P.append(limb("roll", (-0.015, 0.016, B + 0.168), (0.015, 0.016, B + 0.168), 0.0055, 0.0055, "Canvas", seg=7, n=1))
    P.append(tube("scabbard", [(0.0175, 0.01, B + 0.112), (0.0195, 0.016, B + 0.07)], [0.0022, 0.0018], "Leather",
                  seg=5))
    P.append(ellipsoid("canteen", (-0.019, 0.009, B + 0.1), (0.005, 0.0072, 0.0085), "Leather", seg=6, rings=4))
    # armar: höger rak längs sidan, vänster böjd med handen under kolven
    arms = (("r", (-0.0212, 0.001, B + 0.179), (-0.0252, 0.003, B + 0.145), (-0.0236, -0.001, B + 0.113)),
            ("l", (0.0212, 0.001, B + 0.179), (0.0292, 0.006, B + 0.147), (0.0165, -0.0175, B + 0.1385)))
    for nm, a, b_, c in arms:
        P.append(limb(f"uarm_{nm}", a, b_, 0.0068, 0.006, "Paint", seg=7, n=1))
        P.append(limb(f"farm_{nm}", b_, c, 0.006, 0.0055, "Paint", seg=7, n=1))
        cuff = torus(f"cuff_{nm}", (0, 0, 0), 0.0057, 0.001, "Paint", seg=8, rseg=3)
        orient(cuff, (0, 0, 0), tuple(Vector(c) - Vector(b_)))
        transform(cuff, loc=tuple(Vector(b_).lerp(Vector(c), 0.86)))
        P.append(cuff)
    P.append(ellipsoid("hand_r", (-0.0234, -0.002, B + 0.1075), (0.0047, 0.0049, 0.0062), "Skin", seg=7, rings=4))
    P.append(ellipsoid("hand_l", (0.0148, -0.0205, B + 0.1372), (0.0052, 0.0056, 0.0048), "Skin", seg=7, rings=4))
    # geväret på vänster axel ('slope arms')
    butt = Vector((0.0158, -0.0232, B + 0.128))
    muzzle = Vector((0.0302, 0.0402, B + 0.245))
    at = lambda t: butt.lerp(muzzle, t)  # noqa: E731
    P.append(tube("stock", [at(0.0), at(0.02), at(0.16), at(0.42)], [0.0034, 0.0044, 0.0036, 0.0024], "Wood", seg=6))
    P.append(tube("receiver", [at(0.4), at(0.52)], 0.0023, "Metal", seg=6))
    P.append(tube("forend", [at(0.5), at(0.84)], [0.0022, 0.0019], "Wood", seg=6))
    P.append(tube("barrel", [at(0.8), at(1.0)], 0.0012, "Metal", seg=6))
    for tt in (0.62, 0.82):
        P.append(torus(f"band{tt}", (0, 0, 0), 0.0023, 0.0006, "Metal", seg=6, rseg=3))
        orient(P[-1], (0, 0, 0), tuple(muzzle - butt))
        transform(P[-1], loc=tuple(at(tt)))
    P.append(cyl("bolt", tuple(at(0.47)), tuple(at(0.47) + Vector((-0.0045, -0.0018, -0.001))), 0.0007, seg=4,
                 material="Metal"))
    P.append(ellipsoid("boltknob", at(0.47) + Vector((-0.0047, -0.0019, -0.001)), (0.0012, 0.0012, 0.0012), "Metal",
                       seg=5, rings=3))
    off = Vector((0.0022, 0.0015, 0.0))
    P.append(tube("sling", [at(0.12) + off, at(0.32) + off + Vector((0.0026, -0.003, -0.002)),
                            at(0.55) + off + Vector((0.003, -0.0035, -0.002)), at(0.8) + off], 0.0009, "Leather", seg=4))
    # huvud: hals, ansikte med målade ögon och rosiga kinder, näsa, öron
    P.append(cyl("neck", (0, 0.0, B + 0.187), (0, 0.0, B + 0.198), 0.0062, seg=10, material="Skin"))
    P.append(ellipsoid("head", (0, -0.0008, B + 0.2085), (0.0124, 0.0128, 0.0146), "Skin", seg=12, rings=8))
    P.append(ellipsoid("nose", (0, -0.0131, B + 0.2072), (0.0021, 0.0026, 0.003), "Skin", seg=6, rings=4))
    for s in (1, -1):
        P.append(ellipsoid(f"ear{s}", (0.0121 * s, 0.0005, B + 0.2075), (0.0019, 0.0032, 0.0042), "Skin", seg=5,
                           rings=3))
        P.append(ellipsoid(f"eye{s}", (0.0046 * s, -0.0119, B + 0.2112), (0.0014, 0.0008, 0.0012), "Dark", seg=6,
                           rings=3))
        P.append(ellipsoid(f"brow{s}", (0.0048 * s, -0.0117, B + 0.2142), (0.0024, 0.0008, 0.0007), "Dark", seg=5,
                           rings=3))
        P.append(ellipsoid(f"cheek{s}", (0.0068 * s, -0.0104, B + 0.2045), (0.0032, 0.0014, 0.0026), "Blush", seg=6,
                           rings=3))
    # Brodiehjälm: kupol med tunt, brett brätte (skarp kant), hakrem
    P.append(lathe("helmet", [(0.0, 0.0), (0.0212, 0.0), (0.0216, 0.0006), (0.0206, 0.0012), (0.0146, 0.0016),
                              (0.0142, 0.0045), (0.013, 0.0085), (0.0094, 0.0118), (0.0, 0.0134)], seg=14,
                   material="Paint", sy=1.08, center=(0, 0.0, B + 0.2165)))
    P.append(tube("chinstrap", [(0.0126, -0.002, B + 0.2165), (0.0118, -0.006, B + 0.203), (0.006, -0.0108, B + 0.1958),
                                (-0.006, -0.0108, B + 0.1958), (-0.0118, -0.006, B + 0.203), (-0.0126, -0.002, B + 0.2165)],
                  0.0008, "Leather", seg=4, cap=False))
    body = finish(P, "infantry", 50)
    # mustaschen som egen nod (variant: spelet kan dölja den på vissa figurer)
    mo = finish([ellipsoid("m1", (0, -0.0128, B + 0.2032), (0.0052, 0.0018, 0.0015), "Dark", seg=8, rings=4)],
                "moustache", 50)
    set_parent(mo, body)
    return [body]


# ======================================================================= stridsvagnen

def _hull_of_circles(circles, n_out):
    """Konvext hölje kring cirklar (y, z, r), omsamplat till n_out jämnt fördelade punkter, moturs sett från +X."""
    pts = []
    for (cy, cz, r) in circles:
        for i in range(64):
            a = math.tau * i / 64
            pts.append((cy + r * math.cos(a), cz + r * math.sin(a)))
    pts = sorted(set(pts))

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    hull = lower[:-1] + upper[:-1]
    seglen = [math.dist(hull[i], hull[(i + 1) % len(hull)]) for i in range(len(hull))]
    total = sum(seglen)
    out, i, acc = [], 0, 0.0
    for k in range(n_out):
        target = total * k / n_out
        while acc + seglen[i] < target:
            acc += seglen[i]
            i += 1
        t = (target - acc) / seglen[i]
        a, b = hull[i], hull[(i + 1) % len(hull)]
        out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out, total


TREAD_V_PER_UNIT = 20.0   # 1 V = 4 länkar à 0,0125 enheter (texturen har 4 länkar per tile)


def track_band(name, x_c, width, inner, thick):
    """Banddrivslinga. UV: u tvärs bandet (0…1), v = båglängd × TREAD_V_PER_UNIT (V löper längs bandet)."""
    n = len(inner)
    cy = sum(p[0] for p in inner) / n
    cz = sum(p[1] for p in inner) / n
    outer = []
    for i, p in enumerate(inner):
        a, b = inner[i - 1], inner[(i + 1) % n]
        ty, tz = b[0] - a[0], b[1] - a[1]
        L = math.hypot(ty, tz)
        ny, nz = tz / L, -ty / L
        if (p[0] - cy) * ny + (p[1] - cz) * nz < 0:
            ny, nz = -ny, -nz
        outer.append((p[0] + ny * thick, p[1] + nz * thick))
    arc = [0.0]
    for i in range(1, n + 1):
        arc.append(arc[-1] + math.dist(outer[i - 1], outer[i % n]))
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    x0, x1 = x_c - width / 2, x_c + width / 2

    def quad(vs, uvs):
        f = bm.faces.new([bm.verts.new(v) for v in vs])
        for lp, uv in zip(f.loops, uvs):
            lp[uvl].uv = uv

    for i in range(n):
        j = (i + 1) % n
        v0, v1 = arc[i] * TREAD_V_PER_UNIT, arc[i + 1] * TREAD_V_PER_UNIT
        oi, oj, ii, ij = outer[i], outer[j], inner[i], inner[j]
        quad([(x0, *oi), (x0, *oj), (x1, *oj), (x1, *oi)], [(0, v0), (0, v1), (1, v1), (1, v0)])
        quad([(x1, *ii), (x1, *ij), (x0, *ij), (x0, *ii)], [(1, v0), (1, v1), (0, v1), (0, v0)])
        quad([(x1, *oi), (x1, *oj), (x1, *ij), (x1, *ii)], [(1, v0), (1, v1), (0.92, v1), (0.92, v0)])
        quad([(x0, *ii), (x0, *ij), (x0, *oj), (x0, *oi)], [(0.08, v0), (0.08, v1), (0, v1), (0, v0)])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return lib._obj_from_bm(name, bm, "Tread")


def rivets(name, pts, r, material="Paint"):
    """Små halvklotsnitar (åtta trianglar var)."""
    obs = []
    for i, (p, nrm) in enumerate(pts):
        e = ellipsoid(f"{name}{i}", (0, 0, 0), (r, r, r * 0.6), material, seg=4, rings=2)
        orient(e, (0, 0, 0), nrm)
        transform(e, loc=p)
        obs.append(e)
    return obs


def tank():
    """Stridsvagn (tidigt 50-tal): gjutet torn med chefskupol och kulspruta, sluttande glacis med svetsfogar,
    reservlänkar, verktyg, bogserlina, dunkar, rökkastare, gummiklädda bärhjul."""
    H = []
    H.append(bev(prism("lower", [(-0.118, 0.022), (-0.137, 0.046), (-0.123, 0.064), (0.128, 0.064), (0.137, 0.046),
                                 (0.115, 0.022)], 0.104, "Paint", axis="X"), 0.003, 2))
    H.append(bev(prism("upper", [(-0.129, 0.061), (-0.096, 0.0845), (0.118, 0.0845), (0.134, 0.075), (0.134, 0.061)],
                       0.168, "Paint", axis="X"), 0.0035, 2))
    # svetsfogar längs glacisens kanter och däckskarvarna
    for s in (1, -1):
        H.append(tube(f"weld{s}", [(0.084 * s, -0.129, 0.0612), (0.084 * s, -0.096, 0.0847)], 0.0012, "Paint", seg=4))
    H.append(tube("weldf", [(-0.084, -0.096, 0.0848), (0.084, -0.096, 0.0848)], 0.0012, "Paint", seg=4))
    for s in (1, -1):
        H.append(box(f"fender{s}", (0.066 * s, -0.137, 0.0605), (0.034, 0.018, 0.004), "Paint"))
        transform(H[-1], rot=(18, 0, 0), pivot=(0.066 * s, -0.128, 0.0605))
    # förarlucka med handtag, vinkelspegel, strålkastare med skydd, avgasrör, dragkrokar
    H.append(bev(box("hatch", (0.026, -0.103, 0.0815), (0.03, 0.02, 0.006), "Paint"), 0.0015, 1))
    transform(H[-1], rot=(-34, 0, 0), pivot=(0.026, -0.103, 0.0815))
    H.append(box("visor", (-0.02, -0.1, 0.078), (0.022, 0.006, 0.007), "Dark"))
    transform(H[-1], rot=(-34, 0, 0), pivot=(-0.02, -0.1, 0.078))
    for s in (1, -1):
        H.append(lathe(f"lamp{s}", [(0.0065, 0.0), (0.0075, 0.011), (0.0068, 0.0125), (0.0, 0.0125)], seg=8,
                       material="Metal"))
        orient(H[-1], (0.068 * s, -0.115, 0.074), (0.068 * s, -0.13, 0.074))
        H.append(tube(f"guard{s}", [(0.058 * s, -0.112, 0.068), (0.06 * s, -0.135, 0.07), (0.076 * s, -0.135, 0.07),
                                    (0.078 * s, -0.112, 0.068)], 0.0011, "Metal", seg=4, cap=False))
        H.append(cyl(f"exhaust{s}", (0.04 * s, 0.137, 0.07), (0.04 * s, 0.137, 0.052), 0.0065, seg=8, material="Metal"))
        H.append(torus(f"hook{s}", (0.04 * s, -0.139, 0.035), 0.006, 0.0018, "Metal", seg=8, rseg=4))
        transform(H[-1], rot=(0, 90, 0), pivot=(0.04 * s, -0.139, 0.035))
    # motorgaller och reservlänkar på glacisen
    for i in range(4):
        H.append(box(f"grille{i}", (0, 0.096 + 0.009 * i, 0.0853), (0.07, 0.0035, 0.0012), "Dark"))
    for i, x in enumerate((-0.05, -0.036, 0.036, 0.05)):
        H.append(bev(box(f"spare{i}", (x, -0.113, 0.074), (0.012, 0.016, 0.003), "Metal"), 0.0008, 1))
        transform(H[-1], rot=(-34, 0, 0), pivot=(x, -0.113, 0.074))
    # stuvlådor, verktyg (spade, yxa, spett), bogserlina, dunkar bak
    for s in (1, -1):
        H.append(bev(box(f"stow{s}", (0.07 * s, -0.035, 0.0905), (0.022, 0.05, 0.012), "Paint"), 0.0012, 1))
    H.append(cyl("shovel", (-0.072, 0.07, 0.087), (-0.072, 0.02, 0.087), 0.0024, seg=5, material="Wood"))
    H.append(bev(box("blade", (-0.072, 0.077, 0.087), (0.011, 0.016, 0.0025), "Metal"), 0.0008, 1))
    H.append(cyl("axe", (0.075, 0.075, 0.087), (0.075, 0.03, 0.087), 0.0022, seg=5, material="Wood"))
    H.append(bev(box("axehead", (0.075, 0.077, 0.087), (0.012, 0.006, 0.0035), "Metal"), 0.0008, 1))
    H.append(cyl("crowbar", (-0.055, -0.05, 0.0865), (-0.055, -0.0, 0.0865), 0.0015, seg=5, material="Metal"))
    for s in (1, -1):
        H.append(tube(f"cable{s}", [(0.0845 * s, -0.11, 0.072), (0.0855 * s, -0.04, 0.074), (0.0855 * s, 0.04, 0.074),
                                    (0.0845 * s, 0.11, 0.072)], 0.0018, "Metal", seg=5))
        H.append(bev(box(f"jerry{s}", (0.06 * s, 0.128, 0.093), (0.022, 0.012, 0.03), "Paint"), 0.0015, 1))
        H.append(cyl(f"jcap{s}", (0.064 * s, 0.128, 0.108), (0.064 * s, 0.128, 0.112), 0.0025, seg=6, material="Metal"))
    # bärhjul med gummiring och nav, framhjul och drivhjul med tänder
    xc = 0.066
    for s in (1, -1):
        for y in (-0.074, -0.037, 0.0, 0.037, 0.074):
            w = lathe(f"rw{s}{y}", [(0.0165, -0.012), (0.0165, 0.012), (0.0135, 0.0125), (0.0128, 0.0118)], seg=10,
                      material="Dark", cap_bottom=False, cap_top=False)
            transform(w, rot=(0, 90 * s, 0))
            transform(w, loc=(xc * s, y, 0.0225))
            H.append(w)
            hub = lathe(f"hub{s}{y}", [(0.0128, 0.0118), (0.0072, 0.0128), (0.0055, 0.0148), (0.0, 0.015)], seg=10,
                        material="Metal", cap_bottom=False)
            transform(hub, rot=(0, 90 * s, 0))
            transform(hub, loc=(xc * s, y, 0.0225))
            H.append(hub)
        idl = lathe(f"idler{s}", [(0.0195, -0.011), (0.0195, 0.011), (0.007, 0.0115), (0.0, 0.013)], seg=14,
                    material="Metal", cap_bottom=False)
        transform(idl, rot=(0, 90 * s, 0))
        transform(idl, loc=(xc * s, -0.118, 0.04))
        H.append(idl)
        # drivhjulet med tänder: radien moduleras
        bm = bmesh.new()
        teeth = 12
        seg = teeth * 2
        rings = []
        for (zz, rr) in ((-0.011, 1.0), (0.011, 1.0)):
            ring = []
            for i in range(seg):
                a = math.tau * i / seg
                r = 0.021 * (1.12 if i % 2 == 0 else 0.97)
                ring.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, zz)))
            rings.append(ring)
        hubc = bm.verts.new((0, 0, 0.013))
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((rings[0][i], rings[0][j], rings[1][j], rings[1][i]))
            bm.faces.new((rings[1][i], rings[1][j], hubc))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        spr = lib._obj_from_bm(f"sprocket{s}", bm, "Metal")
        transform(spr, rot=(0, 90 * s, 0))
        transform(spr, loc=(xc * s, 0.118, 0.041))
        H.append(spr)
    hull = finish(H, "hull", 40)

    thick = 0.0058
    circles = [(-0.118, 0.04, 0.0195 + 0.0005), (0.118, 0.041, 0.021 * 1.12 + 0.0005)]
    circles += [(y, 0.0225, 0.0165 + 0.0004) for y in (-0.074, 0.074)]
    inner, _ = _hull_of_circles(circles, 36)
    zmin = min(p[1] for p in inner) - thick
    inner = [(p[0], p[1] - zmin) for p in inner]
    tracks = join([track_band(f"band{s}", xc * s, 0.034, inner, thick) for s in (1, -1)], "tracks")
    smooth(tracks, 50)

    ring = (0.0, 0.012, 0.0845)
    T = []
    T.append(lathe("turret", [(0.047, 0.0), (0.0505, 0.007), (0.0488, 0.021), (0.0412, 0.034), (0.026, 0.0428),
                              (0.0, 0.0458)], seg=20, material="Paint", sx=0.95, sy=1.16, center=ring))
    T.append(torus("ringweld", ring, 0.047, 0.0016, "Paint", seg=20, rseg=3, sx=0.95, sy=1.16))
    T.append(bev(box("bustle", (0, 0.062, 0.1), (0.066, 0.03, 0.026), "Paint"), 0.005, 2))
    T.append(lathe("cupola", [(0.0128, 0.0), (0.0128, 0.0085), (0.0118, 0.0105), (0.0098, 0.0118), (0.0, 0.0126)],
                   seg=12, material="Paint", center=(0.019, 0.026, 0.1245)))
    for k in range(5):  # periskopen runt kupolen
        a = math.tau * k / 5 + 0.3
        T.append(box(f"peri{k}", (0.019 + math.cos(a) * 0.0122, 0.026 + math.sin(a) * 0.0122, 0.1295),
                     (0.004, 0.004, 0.003), "Dark"))
    T.append(bev(box("loader", (-0.02, 0.018, 0.1285), (0.022, 0.026, 0.004), "Paint"), 0.0012, 1))
    T.append(torus("handle", (-0.02, 0.018, 0.1305), 0.004, 0.0009, "Metal", seg=6, rseg=3))
    # kulspruta på kupolen
    T.append(box("mgmount", (0.019, 0.02, 0.1385), (0.004, 0.006, 0.004), "Metal"))
    T.append(cyl("mg", (0.019, 0.026, 0.141), (0.019, -0.022, 0.141), 0.0017, seg=6, material="Metal"))
    T.append(bev(box("mgbody", (0.019, 0.03, 0.141), (0.005, 0.016, 0.006), "Metal"), 0.0008, 1))
    T.append(cyl("antenna", (-0.03, 0.07, 0.113), (-0.032, 0.08, 0.2), 0.0011, seg=4, material="Metal"))
    T.append(bev(box("mantlet", (0, -0.043, 0.1065), (0.052, 0.024, 0.031), "Paint"), 0.0075, 2))
    T += rivets("mrivet", [((x, -0.0555, z), (0, -1, 0)) for x in (-0.021, 0.021) for z in (0.097, 0.116)], 0.0018)
    T.append(cyl("coax", (0.016, -0.052, 0.1), (0.016, -0.064, 0.1), 0.0022, seg=5, material="Dark"))
    for s in (1, -1):  # rökkastare
        for k in range(3):
            T.append(cyl(f"smoke{s}{k}", (0.04 * s, -0.02 + k * 0.007, 0.112), (0.05 * s, -0.026 + k * 0.007, 0.12),
                         0.0028, seg=6, material="Metal"))
    turret = finish(T, "turret", 40)
    set_origin(turret, ring)

    pivot = (0.0, -0.054, 0.1075)
    G = []
    G.append(tube("gun", [(0, -0.052, 0.1075), (0, -0.11, 0.1075), (0, -0.19, 0.1075)], [0.0072, 0.0062, 0.0054],
                  "Paint", seg=10))
    G.append(ellipsoid("evacuator", (0, -0.128, 0.1075), (0.0093, 0.017, 0.0093), "Paint", seg=10, rings=6))
    G.append(cyl("brake", (0, -0.186, 0.1075), (0, -0.2, 0.1075), 0.0082, seg=10, material="Metal", bevel=0.0008))
    barrel = finish(G, "barrel", 40)
    set_origin(barrel, pivot)

    set_parent(turret, hull)
    set_parent(barrel, turret)
    set_parent(tracks, hull)
    return [hull]


# ======================================================================= fältkanonen

def artillery():
    """Fältkanon: luftgummihjul med mönster och hjulmuttrar, nitad sköld med skjutlucka, spårlavett med spadar,
    höjd- och sidriktningsrattar, sikte, rekylcylinder och mynningsbroms."""
    C = []
    wz = 0.044
    for s in (1, -1):
        x = 0.072 * s
        # däck med mönster (radien moduleras runt om)
        bm = bmesh.new()
        seg = 40
        prof = [(0.034, -0.0095), (0.041, -0.0102), (0.044, -0.0065), (0.044, 0.0065), (0.041, 0.0102), (0.034, 0.0095)]
        rings = []
        for k, (rr, zz) in enumerate(prof):
            ring = []
            for i in range(seg):
                a = math.tau * i / seg
                m = 1.0 + (0.035 if (2 <= k <= 3 and i % 2 == 0) else 0.0)
                ring.append(bm.verts.new((math.cos(a) * rr * m, math.sin(a) * rr * m, zz)))
            rings.append(ring)
        for k in range(len(rings) - 1):
            for i in range(seg):
                j = (i + 1) % seg
                bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        tire = lib._obj_from_bm(f"tire{s}", bm, "Dark")
        transform(tire, rot=(0, 90, 0))
        transform(tire, loc=(x, 0, wz))
        C.append(tire)
        rim = lathe(f"rim{s}", [(0.0, -0.0075), (0.034, -0.0075), (0.0345, 0.0), (0.034, 0.0075), (0.02, 0.0078),
                                (0.016, 0.0095), (0.009, 0.01), (0.0, 0.0125)], seg=20, material="Paint")
        transform(rim, rot=(0, 90 * s, 0))
        transform(rim, loc=(x, 0, wz))
        C.append(rim)
        for k in range(6):  # hjulmuttrar
            a = math.tau * k / 6
            C.append(cyl(f"nut{s}{k}", (x + 0.0095 * s, math.cos(a) * 0.0125, wz + math.sin(a) * 0.0125),
                         (x + 0.0115 * s, math.cos(a) * 0.0125, wz + math.sin(a) * 0.0125), 0.0018, seg=6,
                         material="Metal"))
    C.append(cyl("axle", (-0.07, 0, wz), (0.07, 0, wz), 0.0055, seg=8, material="Metal"))
    shield_outline = [(-0.082, 0.0), (0.082, 0.0), (0.082, 0.052), (0.06, 0.062), (0.06, 0.09), (0.044, 0.104),
                      (0.0105, 0.104), (0.0105, 0.034), (-0.0105, 0.034), (-0.0105, 0.104), (-0.044, 0.104),
                      (-0.06, 0.09), (-0.06, 0.062), (-0.082, 0.052)]
    shield = bev(prism("shield", shield_outline, 0.0045, "Paint", axis="Y", center=(0, -0.022, 0.03)), 0.0012, 2)
    shutter = bev(prism("shutter", [(-0.017, 0.064), (0.017, 0.064), (0.017, 0.1), (-0.017, 0.1)], 0.004, "Paint",
                        axis="Y", center=(0, -0.0262, 0.03)), 0.001, 1)
    # nitar längs sköldens kanter (framsidan)
    rv = []
    for x in np.linspace(-0.074, 0.074, 11):
        rv.append(((x, -0.0245, 0.036), (0, -1, 0)))
    for z in (0.045, 0.075, 0.098):
        for x in (-0.054, -0.03, 0.03, 0.054):
            if abs(x) > 0.05 and z > 0.09:
                continue
            rv.append(((x, -0.0245, 0.03 + z - 0.03), (0, -1, 0)))
    rvs = rivets("srivet", rv, 0.0019)
    for o in [shield, shutter] + rvs:
        transform(o, rot=(-9, 0, 0), pivot=(0, -0.022, 0.03))
        C.append(o)
    C.append(bev(box("cradle_body", (0, 0.012, 0.07), (0.05, 0.05, 0.026), "Paint"), 0.004, 1))
    for s in (1, -1):
        C.append(cyl(f"trunnion{s}", (0.022 * s, 0.012, 0.078), (0.03 * s, 0.012, 0.078), 0.0075, seg=10,
                     material="Paint"))
    # riktrattar på vänster sida
    for (pos, r) in (((0.033, 0.03, 0.068), 0.009), ((0.033, 0.0, 0.058), 0.0075)):
        w = torus("hwheel", (0, 0, 0), r, 0.0012, "Metal", seg=12, rseg=4)
        transform(w, rot=(0, 90, 0))
        transform(w, loc=pos)
        C.append(w)
        for k in range(3):
            a = math.tau * k / 3
            C.append(cyl("spoke", pos, (pos[0], pos[1] + math.cos(a) * r, pos[2] + math.sin(a) * r), 0.0007, seg=4,
                         material="Metal"))
        C.append(cyl("knob", (pos[0], pos[1], pos[2] + r), (pos[0] + 0.006, pos[1], pos[2] + r), 0.0012, seg=5,
                     material="Wood"))
    C.append(bev(box("sight", (-0.016, 0.0, 0.094), (0.006, 0.02, 0.01), "Dark"), 0.001, 1))
    C.append(cyl("scope", (-0.02, 0.01, 0.102), (-0.02, -0.01, 0.102), 0.0028, seg=8, material="Metal"))
    for s in (1, -1):
        C.append(tube(f"trail{s}", [(0.018 * s, 0.03, 0.06), (0.04 * s, 0.09, 0.034), (0.058 * s, 0.142, 0.012)],
                      [0.011, 0.0092, 0.0075], "Paint", seg=8))
        C.append(bev(box(f"spade{s}", (0.06 * s, 0.149, 0.012), (0.024, 0.006, 0.026), "Metal"), 0.0015, 1))
        transform(C[-1], rot=(20, 0, 0), pivot=(0.06 * s, 0.149, 0.012))
        C.append(cyl(f"handspike{s}", (0.05 * s, 0.128, 0.022), (0.07 * s, 0.128, 0.04), 0.0024, seg=5, material="Wood"))
    C.append(torus("toweye", (0, 0.148, 0.02), 0.007, 0.002, "Metal", seg=10, rseg=4))
    C.append(cyl("towbar", (0, 0.1, 0.03), (0, 0.142, 0.02), 0.003, seg=6, material="Paint"))
    carriage = finish(C, "carriage", 40)

    pivot = (0.0, 0.012, 0.078)
    G = []
    G.append(tube("tube", [(0, 0.05, 0.081), (0, -0.04, 0.081), (0, -0.148, 0.081)], [0.0074, 0.0066, 0.0056],
                  "Metal", seg=10))
    G.append(cyl("muzzle", (0, -0.141, 0.081), (0, -0.147, 0.081), 0.0082, seg=10, material="Metal", bevel=0.0008))
    G.append(cyl("muzzle2", (0, -0.149, 0.081), (0, -0.155, 0.081), 0.0082, seg=10, material="Metal", bevel=0.0008))
    G.append(cyl("recuperator", (0, 0.045, 0.069), (0, -0.07, 0.069), 0.0062, seg=10, material="Paint", bevel=0.0012))
    G.append(bev(box("breech", (0, 0.058, 0.08), (0.018, 0.022, 0.018), "Metal"), 0.002, 1))
    G.append(cyl("lever", (0.009, 0.062, 0.084), (0.018, 0.075, 0.09), 0.0015, seg=5, material="Metal"))
    barrel = finish(G, "barrel", 40)
    set_origin(barrel, pivot)
    set_parent(barrel, carriage)
    return [carriage]


# ======================================================================= trupptransporten

def ship():
    """Trupptransport (Liberty-typ) som vattenlinjemodell: reling, ventiler, livbåtar i dävertar, master med
    utkiksmars, bryggvingar, ventiler, ankare, luftvärn, fraktionsrand och vimpel."""
    Lh = 0.35
    N = 30

    def at(y):
        t = (y + Lh) / (2 * Lh)
        if t < 0.2:
            f = t / 0.2
            return 0.002 + 0.052 * math.sin(f * math.pi / 2) ** 0.85, 0.07 - 0.022 * f ** 1.5
        if t > 0.82:
            f = (t - 0.82) / 0.18
            return 0.054 - 0.03 * f ** 2, 0.048 + 0.006 * f
        return 0.054, 0.048

    secs = []
    for k in range(N + 1):
        t = k / N
        y = -Lh + 2 * Lh * t
        hw, zd = at(y)
        rake = 0.03 * max(0.0, 1 - t / 0.2) ** 1.5
        secs.append([(hw * xs, y - rake * zs, zd * zs) for (xs, zs) in
                     ((-1.0, 1.0), (-0.985, 0.6), (-0.95, 0.2), (-0.92, 0.0), (0.92, 0.0), (0.95, 0.2), (0.985, 0.6),
                      (1.0, 1.0))])
    hullm = loft("hullmesh", secs, "Hull")
    me = hullm.data
    for name in ("Wood", "Dark"):
        me.materials.append(lib.mat(name))
    for poly in me.polygons:
        c = poly.center
        if poly.normal.z > 0.7 and c.z > 0.03:
            poly.material_index = 1
        elif c.z < 0.006:
            poly.material_index = 2
    S = [hullm]
    for s in (1, -1):
        strip = []
        for sec in secs[1:-1]:
            a = Vector(sec[0 if s < 0 else 7])
            b = Vector(sec[1 if s < 0 else 6])
            o = Vector((0.0012 * s, 0, 0))
            strip.append([a + o + (b - a) * 0.06, a + o + (b - a) * 0.2])
        st = loft(f"stripe{s}", strip, "Paint", closed=False)
        if sum(p.normal.x for p in st.data.polygons) * s < 0:
            st.data.flip_normals()
        S.append(st)
        # reling: överliggare och stöttor längs däckskanten
        rail = []
        for sec in secs[2:-1]:
            a = Vector(sec[0 if s < 0 else 7])
            rail.append(a + Vector((-0.0015 * s, 0, 0.012)))
        S.append(tube(f"rail{s}", rail, 0.0011, "Hull", seg=4, cap=False))
        for i, sec in enumerate(secs[2:-1]):
            if i % 2:
                continue
            a = Vector(sec[0 if s < 0 else 7]) + Vector((-0.0015 * s, 0, 0))
            S.append(cyl(f"stanch{s}{i}", tuple(a), tuple(a + Vector((0, 0, 0.012))), 0.0008, seg=3, material="Hull"))
        # ventiler (hyttventiler) längs skrovet
        for k in range(9):
            y = -0.2 + k * 0.05
            hw, zd = at(y)
            S.append(cyl(f"port{s}{k}", (hw * s * 0.997, y, zd * 0.62), (hw * s * 1.01, y, zd * 0.62), 0.0028, seg=8,
                         material="Dark"))
    # överbyggnad i tre våningar med fönsterband, bryggvingar, strålkastare
    S.append(bev(box("house1", (0, 0.03, 0.062), (0.088, 0.14, 0.03), "Hull"), 0.002, 1))
    S.append(bev(box("house2", (0, 0.02, 0.087), (0.072, 0.1, 0.022), "Ivory"), 0.0015, 1))
    S.append(bev(box("bridge", (0, -0.012, 0.106), (0.08, 0.034, 0.018), "Ivory"), 0.0015, 1))
    S.append(bev(box("wings", (0, -0.022, 0.1), (0.112, 0.014, 0.004), "Ivory"), 0.001, 1))
    S.append(box("bridgewin", (0, -0.0295, 0.108), (0.07, 0.0012, 0.006), "Dark"))
    S.append(cyl("searchlight", (0, -0.012, 0.115), (0, -0.012, 0.122), 0.006, seg=10, material="Metal"))
    S.append(cyl("compass", (0.02, 0.0, 0.115), (0.02, 0.0, 0.121), 0.004, seg=8, material="Brass"))
    for s in (1, -1):
        S.append(box(f"win{s}", (0.0442 * s, 0.03, 0.066), (0.0012, 0.12, 0.005), "Dark"))
        S.append(box(f"win2{s}", (0.0362 * s, 0.02, 0.089), (0.0012, 0.085, 0.004), "Dark"))
    # lastluckor med presenning
    for y in (-0.21, -0.13, 0.15, 0.235):
        S.append(bev(box(f"hatch{y}", (0, y, 0.051), (0.05, 0.05, 0.009), "Canvas"), 0.0018, 1))
    # vinschar vid lastluckorna, pollare längs relingen, skvättlist, däckslast under presenning
    for y in (-0.17, 0.19):
        for s_ in (1, -1):
            S.append(bev(box(f"winch{y}{s_}", (0.016 * s_, y + (0.02 if y < 0 else -0.02), 0.052), (0.012, 0.008, 0.007),
                             "Metal"), 0.001, 1))
            S.append(cyl(f"drum{y}{s_}", (0.008 * s_, y + (0.02 if y < 0 else -0.02), 0.057),
                         (0.024 * s_, y + (0.02 if y < 0 else -0.02), 0.057), 0.0028, seg=8, material="Dark"))
    for y in (-0.25, -0.05, 0.12, 0.27):
        hw, zd = at(y)
        for s_ in (1, -1):
            for dy in (-0.006, 0.006):
                S.append(cyl(f"bollard{y}{s_}{dy}", (hw * s_ * 0.86, y + dy, zd), (hw * s_ * 0.86, y + dy, zd + 0.006),
                             0.0018, seg=6, material="Metal"))
    for (y, w, l, h) in ((-0.105, 0.03, 0.022, 0.012), (0.125, 0.026, 0.03, 0.014), (0.215, 0.032, 0.02, 0.011)):
        S.append(bev(box(f"cargo{y}", (0.0, y, 0.048 + h / 2 + 0.009), (w, l, h), "Paint"), 0.0012, 1))
    for s_ in (1, -1):
        rub = []
        for sec in secs[3:-2]:
            a = Vector(sec[0 if s_ < 0 else 7])
            b = Vector(sec[1 if s_ < 0 else 6])
            rub.append(a + (b - a) * 0.45 + Vector((0.0014 * s_, 0, 0)))
        S.append(tube(f"rubrail{s_}", rub, 0.0012, "Hull", seg=4, cap=False))
    # master med utkiksmars, lastbommar och stag
    for (ym, h) in ((-0.17, 0.2), (0.19, 0.18)):
        S.append(cyl(f"mast{ym}", (0, ym, 0.048), (0, ym, 0.048 + h), 0.0028, seg=6, material="Hull", r2=0.0018))
        S.append(box(f"cross{ym}", (0, ym, 0.048 + h * 0.72), (0.05, 0.004, 0.003), "Hull"))
        S.append(lathe(f"nest{ym}", [(0.0065, 0.0), (0.0075, 0.012), (0.0068, 0.012), (0.0, 0.002)], seg=10,
                       material="Hull", center=(0, ym, 0.048 + h * 0.8)))
        d = -1 if ym < 0 else 1
        for s in (1, -1):
            S.append(cyl(f"boom{ym}{s}", (0.006 * s, ym, 0.058), (0.02 * s, ym + 0.075 * d, 0.1), 0.0016, seg=4,
                         material="Wood"))
            S.append(cyl(f"stay{ym}{s}", (0, ym, 0.048 + h * 0.95), (0.05 * s, ym + 0.03, 0.05), 0.0004, seg=3,
                         material="Dark"))
    S.append(prism("pennant", [(0.0, 0.0), (0.0, 0.014), (-0.05, 0.007)], 0.0012, "Paint", axis="X",
                   center=(0, 0.19, 0.218)))
    # svanhalsventiler
    for (x, y) in ((0.025, -0.26), (-0.025, -0.26), (0.03, 0.1), (-0.03, 0.1), (0.022, 0.28), (-0.022, 0.28)):
        z0 = at(y)[1]
        s_ = 1 if x > 0 else -1
        S.append(tube(f"vent{x}{y}", [(x, y, z0), (x, y, z0 + 0.022), (x, y - 0.004, z0 + 0.03)], 0.0025, "Hull", seg=6,
                      cap=False))
        bell = lathe(f"bell{x}{y}", [(0.0026, 0.0), (0.0045, 0.004), (0.0055, 0.008), (0.0, 0.0075)], seg=8,
                     material="Hull")
        orient(bell, (0, 0, 0), (0, -1, 0.3))
        transform(bell, loc=(x, y - 0.004, z0 + 0.03))
        S.append(bell)
        _ = s_
    # livbåtar i dävertar
    for s in (1, -1):
        for y in (0.0, 0.065):
            S.append(ellipsoid(f"boat{s}{y}", (0.05 * s, y, 0.084), (0.009, 0.026, 0.0065), "Ivory", seg=10, rings=5))
            for dy in (-0.018, 0.018):
                S.append(tube(f"davit{s}{y}{dy}", [(0.043 * s, y + dy, 0.074), (0.046 * s, y + dy, 0.096),
                                                   (0.052 * s, y + dy, 0.094)], 0.0008, "Hull", seg=3, cap=False))
    # ankare och klys
    for s in (1, -1):
        y = -0.31
        hw, zd = at(y)
        S.append(bev(box(f"anchor{s}", (hw * s * 1.02, y, zd * 0.75), (0.002, 0.006, 0.008), "Dark"), 0.0006, 1))
    # luftvärn för och akter
    for y in (-0.27, 0.3):
        z = at(y)[1]
        S.append(cyl(f"tub{y}", (0, y, z), (0, y, z + 0.008), 0.01, seg=12, material="Hull"))
        d = -1 if y < 0 else 1
        S.append(cyl(f"gun{y}", (0, y, z + 0.008), (0, y + 0.028 * d, z + 0.016), 0.002, seg=6, material="Metal"))
    hull = finish(S, "hull", 40)

    base = (0.0, 0.045, 0.115)
    F = []
    F.append(lathe("stack", [(0.019, -0.02), (0.019, 0.034)], seg=16, material="Hull", sx=0.82, sy=1.18,
                   center=base, cap_top=False))
    F.append(lathe("band", [(0.0193, 0.034), (0.0193, 0.05)], seg=16, material="Paint", sx=0.82, sy=1.18,
                   center=base, cap_bottom=False, cap_top=False))
    F.append(lathe("soot", [(0.0193, 0.05), (0.0196, 0.058), (0.0165, 0.058), (0.0165, 0.052)], seg=16,
                   material="Dark", sx=0.82, sy=1.18, center=base, cap_bottom=False, cap_top=False))
    F.append(cyl("whistle", (0.0, base[1] - 0.02, base[2] + 0.03), (0.0, base[1] - 0.02, base[2] + 0.045), 0.0018,
                 seg=6, material="Brass"))
    for f in F:
        transform(f, rot=(-8, 0, 0), pivot=base)
    funnel = finish(F, "funnel", 50)
    set_origin(funnel, base)
    top = Vector(base) + Vector((0, 0.058 * math.sin(math.radians(8)), 0.058 * math.cos(math.radians(8))))
    smoke = empty("smoke", top)
    set_parent(funnel, hull)
    set_parent(smoke, funnel)
    return [hull]


# ======================================================================= kartnålen

def flag():
    """Kartnål med mässingsknopp och en pappersflagga (siffran och färgen ritas av spelet).
    Nålen 0,50 hög; duken 0,30 × 0,21 sträcker sig åt +X från nålen, överkant på 0,485."""
    pin = finish([
        cyl("needle", (0, 0, 0.0), (0, 0, 0.49), 0.0032, seg=8, material="Metal", r2=0.0036),
        lathe("tip", [(0.0, -0.014), (0.0032, 0.0)], seg=8, material="Metal"),
        lathe("knob", [(0.0, 0.482), (0.008, 0.484), (0.0135, 0.49), (0.0148, 0.497), (0.0128, 0.503),
                       (0.0068, 0.5065), (0.0, 0.5075)], seg=16, material="Brass"),
    ], "pin", 50)
    w, h, top = 0.30, 0.21, 0.485
    z0 = top - h
    x0 = 0.0036
    nu, nv = 18, 4
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")

    def pos(u, v, side):
        x = x0 + u * w
        y = 0.02 * math.sin(u * 5.0) * (0.25 + 0.75 * u) + 0.0007 * side
        y += 0.005 * max(0.0, 1 - abs(u - 0.5) * 6)  # vikveck mitt på
        return Vector((x, y, z0 + v * h - 0.008 * u * u * (1 - v)))

    for side in (-1, 1):
        verts = [[bm.verts.new(pos(i / nu, j / nv, side)) for j in range(nv + 1)] for i in range(nu + 1)]
        for i in range(nu):
            for j in range(nv):
                vs = [verts[i][j], verts[i + 1][j], verts[i + 1][j + 1], verts[i][j + 1]]
                ij = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
                if side == 1:
                    vs.reverse()
                    ij.reverse()
                f = bm.faces.new(vs)
                for lp, (a, c) in zip(f.loops, ij):
                    u, v = a / nu, c / nv
                    lp[uvl].uv = (u if side == -1 else 1 - u, v)
    flagob = lib._obj_from_bm("flag", bm, "FlagPaper")
    smooth(flagob, 60)
    set_origin(flagob, (0, 0, z0 + h / 2))
    set_parent(flagob, pin)
    return [pin]


# ======================================================================= tärningen

# Sidornas siffror i three-koordinater: +Y = 1, -Y = 6, +X = 3, -X = 4, +Z = 2, -Z = 5 (motsatta sidor = 7).
# Blender (Z upp, -Y framåt; three (x, y, z) = Blender (x, z, -y)): +Z = 1, -Z = 6, +X = 3, -X = 4, -Y = 2, +Y = 5.
DICE_FACES = {1: (0, 0, 1), 6: (0, 0, -1), 3: (1, 0, 0), 4: (-1, 0, 0), 2: (0, -1, 0), 5: (0, 1, 0)}
PIPS = {
    1: [(0, 0)],
    2: [(-1, -1), (1, 1)],
    3: [(-1, -1), (0, 0), (1, 1)],
    4: [(-1, -1), (1, -1), (-1, 1), (1, 1)],
    5: [(-1, -1), (1, -1), (0, 0), (-1, 1), (1, 1)],
    6: [(-1, -1), (-1, 0), (-1, 1), (1, -1), (1, 0), (1, 1)],
}


def dice():
    """Tärning 0,16 på kanten, origo i mitten, rundade kanter, borrade (konkava) prickar. Material DiceBody, Pip."""
    s = 0.16
    body = box("dice", (0, 0, 0), (s, s, s), "DiceBody")
    add_bevel(body, 0.018, 6, 0.6)
    lib.apply_mods(body)
    cut = []
    r = 0.0145
    step = 0.042
    for num, nrm in DICE_FACES.items():
        n = Vector(nrm)
        # två axlar i sidans plan
        a = Vector((0, 0, 1)) if abs(n.z) < 0.5 else Vector((1, 0, 0))
        u = n.cross(a).normalized()
        v = n.cross(u).normalized()
        for (i, j) in PIPS[num]:
            c = n * (s / 2 + r * 0.55) + u * (i * step) + v * (j * step)
            sp = ellipsoid(f"pip{num}{i}{j}", tuple(c), (r, r, r), "Pip", seg=16, rings=10)
            cut.append(sp)
    cutter = join(cut, "pips")
    bo = body.modifiers.new("Pips", "BOOLEAN")
    bo.operation = "DIFFERENCE"
    bo.solver = "EXACT"
    bo.object = cutter
    bo.material_mode = "TRANSFER"
    lib.apply_mods(body)
    bpy.data.objects.remove(cutter)
    smooth(body, 35)
    # prickarnas ytor har fått materialet Pip via TRANSFER
    return [body]


def dice_preview_materials():
    """Celluloidkänsla i förhandsbilden: röd, halvgenomskinlig, blank, med vita prickar.
    Nya material (exportens material har fått keep_uvs-noder som låser Base Color)."""
    body = bpy.data.objects["dice"]
    m, t = mats.fresh("DiceBody")
    p, pt = mats.fresh("Pip")
    for slot in body.material_slots:
        slot.material = m if slot.material.name.startswith("DiceBody") else p
    b = t.bsdf
    b.inputs["Base Color"].default_value = srgb("#b3121a")
    b.inputs["Roughness"].default_value = 0.12
    b.inputs["Subsurface Weight"].default_value = 0.6
    b.inputs["Subsurface Radius"].default_value = (0.02, 0.004, 0.004)
    b.inputs["Subsurface Scale"].default_value = 0.4
    b.inputs["Transmission Weight"].default_value = 0.25
    b.inputs["Coat Weight"].default_value = 0.6
    pt.bsdf.inputs["Base Color"].default_value = srgb("#f4efe2")
    pt.bsdf.inputs["Roughness"].default_value = 0.45


# ======================================================================= förhandsbilder och export

BUILDERS = {
    # namn: (byggare, kamera: mål, avstånd, höjd, azimut), storlek för AO
    "infantry": (infantry, ((0, 0, 0.125), 0.62, 14, -32), 0.26),
    "tank": (tank, ((0, 0, 0.06), 0.85, 24, -38), 0.34),
    "artillery": (artillery, ((0, 0, 0.05), 0.78, 22, -40), 0.31),
    "ship": (ship, ((0, 0, 0.06), 1.5, 24, -42), 0.73),
    "flag": (flag, ((0.1, 0, 0.26), 1.1, 12, -28), 0.52),
    "dice": (dice, ((0, 0, 0.0), 0.75, 30, -35), 0.16),
}
DETAIL = {
    "infantry": ((0.0, -0.01, 0.2), 0.16, 6, -25),
    "tank": ((0.04, -0.06, 0.08), 0.32, 22, -40),
    "artillery": ((0.0, -0.03, 0.08), 0.3, 18, -30),
    "ship": ((0.0, 0.02, 0.09), 0.45, 28, -55),
}


def build(name, preview=True):
    lib.reset()
    fn, cam, size = BUILDERS[name]
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
    meshes = [o for o in objs if o.type == "MESH"]
    total = 0
    for o in meshes:
        n = lib.tris(o)
        total += n
        print(f"  {name}/{o.name}: tris={n}")
    if name == "dice":
        # tärningen ligger i luften i förhandsbilden: lyft den till bordet
        pass
    else:
        bake_unit_colors(meshes, size)
    use_materials(preview=False)
    lib.export_glb(os.path.join(lib.RAW, f"{name}.glb"), roots, tangents=name in ("tank", "infantry"),
                   colors=name != "dice")
    if preview:
        if name == "dice":
            dice_preview_materials()
            for r in roots:
                r.location.z = 0.08
                r.rotation_euler = (math.radians(12), math.radians(-8), math.radians(30))
        else:
            use_materials(preview=True)
        t, d, e, a = cam
        lib.preview_setup(target=t, dist=d, elev=e, azim=a, lens=55, res=(900, 900), cycles=True, samples=128)
        preview_paper()
        lib.render(os.path.join(lib.PREVIEWS, f"{name}.png"))
        if name in DETAIL:
            lib.set_cam(*DETAIL[name])
            lib.render(os.path.join(lib.PREVIEWS, f"{name}_detail.png"))
    print(f"UNIT {name} tris={total}")


def preview_paper():
    """Förhandsbildernas underlag: kartpapperet (färg ur spelets palett, fiberstruktur ur public/tex)."""
    g = bpy.data.objects.get("PreviewGround")
    if not g:
        return
    m, t = mats.fresh("PreviewPaper")
    path = os.path.join(lib.ROOT, "public", "tex", "paper_nor.jpg")
    if os.path.exists(path):
        im = bpy.data.images.load(path)
        im.colorspace_settings.name = "Non-Color"
        node = t.n("ShaderNodeTexImage", image=im)
        t.l(t.coords(1.5), node.inputs["Vector"])
        nm = t.n("ShaderNodeNormalMap", inputs={"Strength": 0.6})
        t.l(node.outputs["Color"], nm.inputs["Color"])
        t.set(srgb("#d9c9a3"), 0.85, 0.0, nm.outputs["Normal"])
    else:
        t.set(srgb("#d9c9a3"), 0.85, 0.0)
    g.data.materials.clear()
    g.data.materials.append(m)


def main():
    only = lib.arg("--only")
    names = only.split(",") if only else list(BUILDERS)
    for n in names:
        if n in BUILDERS:
            build(n, preview="--no-preview" not in lib.argv())


if __name__ == "__main__":
    main()
