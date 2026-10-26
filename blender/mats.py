"""Material och bakning för Världsläget (Blender 5.2, headless).

Rekvisitan byggs med 'rika' Cycles-material (Poly Haven-texturer i lådprojektion, kant- och smutsmasker ur Bevel/AO,
repor, patina) och bakas sedan per föremål till en atlas: baseColor, normal och ORM (R = AO, G = roughness,
B = metallic). Exporten får ett enkelt glTF-material per föremål som pekar på atlasen. Material som spelet byter
(Screen, DialGlass, Eye) eller som behöver transmission/emission (Glass, GreenGlass, Ember, Bulb) bakas inte.

Texturerna läses från assets/src/tex (tools/fetch_textures.py). Bakade bilder skrivs till build/bake/.
"""
import math
import os
import time

import bpy
import numpy as np

import lib
from lib import srgb

TEX = os.path.join(lib.ROOT, "assets", "src", "tex")
BAKE = os.path.join(lib.ROOT, "build", "bake")

# material som aldrig bakas in i atlasen (spelet byter dem, eller de behöver transmission/emission)
SPECIAL = {"Screen", "DialGlass", "Eye", "Glass", "GreenGlass", "Ember", "Bulb"}


# ---------------------------------------------------------------- nodbygge

class Tree:
    """Liten hjälpare för nodträd: t.n('ShaderNodeMix', blend_type='MULTIPLY'), t.l(a, b)."""

    def __init__(self, mat):
        self.mat = mat
        self.nt = mat.node_tree
        self.bsdf = self.nt.nodes.get("Principled BSDF")
        self.out = self.nt.nodes.get("Material Output")
        self._co = None
        self._edge = None
        self._cav = None

    def n(self, kind, inputs=None, **props):
        node = self.nt.nodes.new(kind)
        for k, v in props.items():
            setattr(node, k, v)
        for k, v in (inputs or {}).items():
            node.inputs[k].default_value = v
        return node

    def l(self, a, b):
        self.nt.links.new(a, b)

    # -------- byggstenar

    def coords(self, scale=1.0, rot=(0, 0, 0), offset=(0, 0, 0)):
        """Objektkoordinater, skalade (scale = upprepningar per meter = per enhet)."""
        tc = self.n("ShaderNodeTexCoord")
        mp = self.n("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (scale, scale, scale) if isinstance(scale, (int, float)) else scale
        mp.inputs["Rotation"].default_value = [math.radians(a) for a in rot]
        mp.inputs["Location"].default_value = offset
        self.l(tc.outputs["Object"], mp.inputs["Vector"])
        return mp.outputs["Vector"]

    def image(self, tid, m, vec, color=True, blend=0.3, res="2k"):
        path = os.path.join(TEX, tid, f"{tid}_{m}_{res}.jpg")
        name = os.path.basename(path)
        im = bpy.data.images.get(name) or bpy.data.images.load(path)
        im.colorspace_settings.name = "sRGB" if color else "Non-Color"
        node = self.n("ShaderNodeTexImage", image=im, projection="BOX", projection_blend=blend)
        self.l(vec, node.inputs["Vector"])
        return node.outputs["Color"]

    def noise(self, vec, scale=10.0, detail=4.0, rough=0.55, dist=0.0):
        node = self.n("ShaderNodeTexNoise", inputs={"Scale": scale, "Detail": detail, "Roughness": rough,
                                                     "Distortion": dist})
        if vec is not None:
            self.l(vec, node.inputs["Vector"])
        return node.outputs["Fac"]

    def math(self, op, a, b=None, clamp=False):
        node = self.n("ShaderNodeMath", operation=op, use_clamp=clamp)
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                node.inputs[i].default_value = v
            else:
                self.l(v, node.inputs[i])
        return node.outputs[0]

    def ramp(self, fac, a, b):
        """Linjär map range fac från [a, b] till [0, 1], klämd."""
        node = self.n("ShaderNodeMapRange", clamp=True)
        for sock, v in (("From Min", a), ("From Max", b)):
            if isinstance(v, (int, float)):
                node.inputs[sock].default_value = v
            else:
                self.l(v, node.inputs[sock])
        self.l(fac, node.inputs["Value"])
        return node.outputs["Result"]

    def mix(self, fac, a, b, blend="MIX"):
        """Färgblandning (a och b är färger eller uttag)."""
        node = self.n("ShaderNodeMix", data_type="RGBA", blend_type=blend)
        for sock, v in (("Factor", fac), ("A", a), ("B", b)):
            if isinstance(v, (int, float)):
                node.inputs[sock].default_value = v
            elif isinstance(v, tuple):
                node.inputs[sock].default_value = v
            else:
                self.l(v, node.inputs[sock])
        return node.outputs["Result"]

    def mixf(self, fac, a, b):
        """Talblandning."""
        node = self.n("ShaderNodeMix", data_type="FLOAT")
        for sock, v in (("Factor", fac), ("A", a), ("B", b)):
            if isinstance(v, (int, float)):
                node.inputs[sock].default_value = v
            else:
                self.l(v, node.inputs[sock])
        return node.outputs["Result"]

    def gamma(self, col, g):
        node = self.n("ShaderNodeGamma", inputs={"Gamma": g})
        self.l(col, node.inputs["Color"])
        return node.outputs["Color"]

    def hsv(self, col, h=0.5, s=1.0, v=1.0):
        node = self.n("ShaderNodeHueSaturation", inputs={"Hue": h, "Saturation": s, "Value": v})
        self.l(col, node.inputs["Color"])
        return node.outputs["Color"]

    def bw(self, col):
        node = self.n("ShaderNodeRGBToBW")
        self.l(col, node.inputs["Color"])
        return node.outputs["Val"]

    def edge(self, radius=0.02):
        """Kantmask (konvexa och konkava kanter) ur skillnaden mellan Bevel-normalen och den sanna normalen."""
        if self._edge is None:
            bev = self.n("ShaderNodeBevel", samples=8, inputs={"Radius": radius})
            geo = self.n("ShaderNodeNewGeometry")
            dot = self.n("ShaderNodeVectorMath", operation="DOT_PRODUCT")
            self.l(bev.outputs["Normal"], dot.inputs[0])
            self.l(geo.outputs["Normal"], dot.inputs[1])
            e = self.math("SUBTRACT", 1.0, dot.outputs["Value"])
            self._edge = self.ramp(e, 0.0, 0.06)
        return self._edge

    def cavity(self, dist=0.05):
        """Fördjupningar (1 = djupt): inverterad AO med kort räckvidd."""
        if self._cav is None:
            ao = self.n("ShaderNodeAmbientOcclusion", samples=16, inputs={"Distance": dist})
            self._cav = self.ramp(self.math("SUBTRACT", 1.0, ao.outputs["AO"]), 0.05, 0.7)
        return self._cav

    def wear(self, vec, radius=0.02, amount=1.0, breakup=14.0):
        """Slitage: kanter där händer tar, uppbrutna med brus, inte i fördjupningar."""
        n = self.ramp(self.noise(vec, breakup, 6, 0.65), 0.38, 0.68)
        w = self.math("MULTIPLY", self.edge(radius), n)
        w = self.math("MULTIPLY", w, amount, clamp=True)
        return w

    def bump(self, height, strength=0.2, dist=0.01, normal=None):
        node = self.n("ShaderNodeBump", inputs={"Strength": strength, "Distance": dist})
        self.l(height, node.inputs["Height"])
        if normal is not None:
            self.l(normal, node.inputs["Normal"])
        return node.outputs["Normal"]

    def set(self, base=None, rough=None, metal=None, normal=None, coat=None, sheen=None):
        b = self.bsdf
        for sock, v in (("Base Color", base), ("Roughness", rough), ("Metallic", metal), ("Normal", normal)):
            if v is None:
                continue
            if isinstance(v, (int, float, tuple)):
                b.inputs[sock].default_value = v
            else:
                self.l(v, b.inputs[sock])
        if coat:
            b.inputs["Coat Weight"].default_value = coat
            b.inputs["Coat Roughness"].default_value = 0.08
        if sheen:
            b.inputs["Sheen Weight"].default_value = sheen
            b.inputs["Sheen Roughness"].default_value = 0.6


def fresh(name):
    """Nytt material med Principled + utgång (ersätter ett befintligt med samma namn)."""
    old = bpy.data.materials.get(name)
    if old:
        old.name = name + "_old"
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, Tree(m)


# ---------------------------------------------------------------- rika material (bakas)

def wood(name, tid, tint="#9a5a2c", scale=0.25, darken=1.35, gloss=0.22, rot=(0, 0, 0), wear=0.6, sat=1.1):
    """Lackat fanér: Poly Haven-ådring (lådprojektion, ådringen följer X), mättad och mörkad som oljad lack,
    ljusare/mattare kanter där lacken nötts, smuts i skrevor."""
    m, t = fresh(name)
    v = t.coords(1.0 / scale, rot)
    col = t.gamma(t.image(tid, "Diffuse", v), darken)
    col = t.mix(1.0, col, srgb(tint), "MULTIPLY")
    col = t.hsv(col, s=sat)
    w = t.wear(v, 0.015, wear)
    col = t.mix(w, col, t.mix(1.0, col, (1.35, 1.25, 1.15, 1), "MULTIPLY"))
    col = t.mix(t.math("MULTIPLY", t.cavity(0.04), 0.7), col, srgb("#1c120b"))
    r_tex = t.bw(t.image(tid, "Rough", v, color=False))
    scr = t.bw(t.image("lacquered_cherry_wood", "Rough", t.coords(1.0 / (scale * 1.7), (0, 0, 37)), color=False))
    rough = t.math("ADD", gloss, t.math("MULTIPLY", t.ramp(scr, 0.35, 0.8), 0.18))
    rough = t.math("ADD", rough, t.math("MULTIPLY", r_tex, 0.08))
    rough = t.mixf(w, rough, 0.55)
    nrm = t.bump(r_tex, 0.08, 0.003)
    nrm = t.bump(t.bw(col), 0.05, 0.002, nrm)
    t.set(col, rough, 0.0, nrm)
    return m


def fabric(name, tid, tint="#b49a6a", scale=0.35, sat=0.4, value=1.0):
    """Vävt högtalartyg: tygets struktur som relief, tonat, damm i vecken."""
    m, t = fresh(name)
    v = t.coords(1.0 / scale)
    tex = t.image(tid, "Diffuse", v)
    lum = t.bw(tex)
    col = t.hsv(tex, s=sat, v=value)
    col = t.mix(0.75, col, srgb(tint), "MULTIPLY")
    col = t.mix(0.35, col, srgb(tint))
    gold = t.ramp(t.noise(t.coords((40.0, 1.5, 40.0)), 3, 2, 0.4), 0.62, 0.66)  # glesa guldtrådar
    col = t.mix(t.math("MULTIPLY", gold, 0.5), col, srgb("#c9a24f"))
    col = t.mix(t.math("MULTIPLY", t.cavity(0.03), 0.6), col, srgb("#2a2118"))
    nrm = t.bump(lum, 0.6, 0.004)
    t.set(col, t.mixf(gold, 0.88, 0.45), t.mixf(gold, 0.0, 0.6), nrm, sheen=0.4)
    return m


def brass(name, polish=0.5, patina=0.7, scale=0.15):
    """Mässing med patina: mörk, brunaktig anlöpning i skrevor och på flata ytor, blankpolerad där händer tar,
    fina repor i glansen."""
    m, t = fresh(name)
    v = t.coords(1.0 / scale)
    n1 = t.noise(v, 2.2, 4, 0.5)
    tarn = t.math("MULTIPLY", t.ramp(n1, 0.3, 0.85), patina * 0.55)
    tarn = t.math("MAXIMUM", tarn, t.math("MULTIPLY", t.cavity(0.04), 0.9 * patina + 0.1))
    w = t.wear(v, 0.012, 1.0 + polish)
    tarn = t.math("MULTIPLY", tarn, t.math("SUBTRACT", 1.0, w), clamp=True)
    bright = srgb("#d9ad5b")
    col = t.mix(tarn, bright, srgb("#8a6a34"))
    col = t.mix(t.math("MULTIPLY", t.cavity(0.04), 0.6), col, srgb("#2e2a17"))  # grönsvart i djupet
    scr = t.bw(t.image("lacquered_cherry_wood", "Rough", t.coords(1.0 / (scale * 2.3), (20, 0, 61)), color=False))
    rough = t.math("ADD", 0.16, t.math("MULTIPLY", t.ramp(scr, 0.3, 0.85), 0.22))
    rough = t.mixf(tarn, rough, 0.55)
    rough = t.mixf(w, rough, 0.1)
    nrm = t.bump(scr, 0.03, 0.001)
    t.set(col, rough, t.mixf(tarn, 1.0, 0.75), nrm)
    return m


def bakelite(name, color="#1e130d", mottle="#3a2416", scale=0.3, gloss=0.12):
    """Bakelit: djup glans, svaga marmoreringar, repor och matta kanter."""
    m, t = fresh(name)
    v = t.coords(1.0 / scale)
    swirl = t.ramp(t.noise(v, 3.5, 8, 0.7, dist=1.2), 0.45, 0.75)
    col = t.mix(t.math("MULTIPLY", swirl, 0.55), srgb(color), srgb(mottle))
    w = t.wear(v, 0.01, 0.9)
    col = t.mix(t.math("MULTIPLY", w, 0.5), col, srgb("#5b3a22"))
    scr = t.bw(t.image("lacquered_cherry_wood", "Rough", t.coords(1.0 / (scale * 1.4), (0, 30, 12)), color=False))
    rough = t.math("ADD", gloss, t.math("MULTIPLY", t.ramp(scr, 0.35, 0.85), 0.25))
    rough = t.mixf(w, rough, 0.45)
    nrm = t.bump(scr, 0.02, 0.001)
    t.set(col, rough, 0.0, nrm, coat=0.0)
    return m


def chrome(name, scale=0.15):
    m, t = fresh(name)
    v = t.coords(1.0 / scale)
    scr = t.bw(t.image("lacquered_cherry_wood", "Rough", t.coords(1.0 / (scale * 2), (40, 10, 5)), color=False))
    col = t.mix(t.math("MULTIPLY", t.cavity(0.03), 0.8), srgb("#e4e4e2"), srgb("#3a3630"))
    rough = t.math("ADD", 0.05, t.math("MULTIPLY", t.ramp(scr, 0.4, 0.9), 0.14))
    t.set(col, rough, 1.0, t.bump(scr, 0.02, 0.001))
    return m


def porcelain(name, color="#f2eee4"):
    m, t = fresh(name)
    v = t.coords(8.0)
    n = t.noise(v, 3, 3, 0.5)
    col = t.mix(t.math("MULTIPLY", t.ramp(n, 0.4, 0.8), 0.15), srgb(color), srgb("#e2d9c4"))
    col = t.mix(t.math("MULTIPLY", t.cavity(0.03), 0.4), col, srgb("#9c907a"))
    t.set(col, t.math("ADD", 0.06, t.math("MULTIPLY", n, 0.05)), 0.0)
    return m


def gilt(name):
    """Guldkant på porslin: tunn förgyllning som nötts på krönet."""
    m, t = fresh(name)
    v = t.coords(20.0)
    w = t.wear(v, 0.006, 0.9, breakup=40)
    col = t.mix(w, srgb("#e6b552"), srgb("#f2eee4"))
    t.set(col, t.mixf(w, 0.18, 0.08), t.mixf(w, 1.0, 0.0))
    return m


def ivory(name, color="#e9dcbc"):
    m, t = fresh(name)
    v = t.coords(5.0)
    n = t.noise(v, 4, 4, 0.5)
    col = t.mix(t.math("MULTIPLY", t.ramp(n, 0.35, 0.8), 0.3), srgb(color), srgb("#d8c497"))
    col = t.mix(t.math("MULTIPLY", t.cavity(0.04), 0.7), col, srgb("#7a6a48"))
    w = t.wear(v, 0.01, 0.7)
    col = t.mix(w, col, srgb("#f6efdf"))
    t.set(col, t.mixf(w, 0.28, 0.18), 0.0)
    return m


def dark_metal(name, color="#2c2d30", rough=0.42, scale=0.2):
    """Gjutjärn/gunmetal: mörk, svagt fläckig, blanknött på kanterna."""
    m, t = fresh(name)
    v = t.coords(1.0 / scale)
    n = t.noise(v, 8, 6, 0.6)
    col = t.mix(t.math("MULTIPLY", t.ramp(n, 0.3, 0.8), 0.4), srgb(color), srgb("#45403a"))
    w = t.wear(v, 0.01, 1.0)
    col = t.mix(w, col, srgb("#8a8a8c"))
    t.set(col, t.mixf(w, rough + 0.1 * 0, 0.25), 1.0, t.bump(n, 0.05, 0.002))
    return m


def rubber_cord(name, color="#191715"):
    """Tygklädd sladd: flätad struktur längs sladden."""
    m, t = fresh(name)
    wave = t.n("ShaderNodeTexWave", wave_type="RINGS", inputs={"Scale": 1.0, "Distortion": 0.0})
    t.l(t.coords(30.0), wave.inputs["Vector"])
    col = t.mix(t.math("MULTIPLY", wave.outputs["Fac"], 0.25), srgb(color), srgb("#3a342c"))
    t.set(col, 0.8, 0.0, t.bump(wave.outputs["Fac"], 0.25, 0.002))
    return m


def cigar(name):
    """Täckblad: brunt med ljusare ådror längs cigarren och fläckar."""
    m, t = fresh(name)
    wave = t.n("ShaderNodeTexWave", wave_type="BANDS", bands_direction="X",
               inputs={"Scale": 18.0, "Distortion": 6.0, "Detail": 3.0})
    t.l(t.coords(1.0), wave.inputs["Vector"])
    n = t.noise(t.coords(6.0), 5, 6, 0.6)
    col = t.mix(t.math("MULTIPLY", t.ramp(wave.outputs["Fac"], 0.75, 0.95), 0.6), srgb("#5c351c"), srgb("#a26b3d"))
    col = t.mix(t.math("MULTIPLY", t.ramp(n, 0.5, 0.8), 0.5), col, srgb("#3a1f0f"))
    t.set(col, 0.72, 0.0, t.bump(wave.outputs["Fac"], 0.2, 0.002))
    return m


def ash(name):
    """Cigarraska: grå, sprucken, med svarta ringar."""
    m, t = fresh(name)
    vor = t.n("ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE", inputs={"Scale": 60.0})
    t.l(t.coords(1.0), vor.inputs["Vector"])
    cracks = t.ramp(vor.outputs["Distance"], 0.0, 0.06)
    n = t.noise(t.coords(30.0), 6, 8, 0.7)
    col = t.mix(t.ramp(n, 0.3, 0.8), srgb("#5e5b56"), srgb("#c9c5bc"))
    col = t.mix(t.math("SUBTRACT", 1.0, cracks), col, srgb("#1d1b19"))
    t.set(col, 0.95, 0.0, t.bump(t.math("MULTIPLY", cracks, n), 0.4, 0.002))
    return m


def coffee(name):
    """Svart kaffe med en ljusare ring där det möter koppen."""
    m, t = fresh(name)
    tc = t.n("ShaderNodeTexCoord")
    length = t.n("ShaderNodeVectorMath", operation="LENGTH")
    sep = t.n("ShaderNodeSeparateXYZ")
    comb = t.n("ShaderNodeCombineXYZ")
    t.l(tc.outputs["Object"], sep.inputs["Vector"])
    t.l(sep.outputs["X"], comb.inputs["X"])
    t.l(sep.outputs["Y"], comb.inputs["Y"])
    t.l(comb.outputs["Vector"], length.inputs[0])
    ring = t.ramp(length.outputs["Value"], 0.33, 0.39)
    col = t.mix(t.math("MULTIPLY", ring, 0.8), srgb("#160a04"), srgb("#5a3418"))
    t.set(col, 0.04, 0.0)
    return m


def ink(name):
    m, t = fresh(name)
    t.set(srgb("#0a0c1a"), 0.03, 0.0)
    return m


def opal(name):
    """Lampskärmens vita opalglas på insidan."""
    m, t = fresh(name)
    t.set(srgb("#f4f0e2"), 0.25, 0.0)
    return m


def painted(name, color, rough=0.45, wear=0.6, under="#8a8a8c"):
    """Målad metall med nött färg (spak, nummerskivans stopp m.m.)."""
    m, t = fresh(name)
    v = t.coords(8.0)
    w = t.wear(v, 0.01, wear)
    col = t.mix(w, srgb(color), srgb(under))
    t.set(col, t.mixf(w, rough, 0.3), t.mixf(w, 0.0, 1.0))
    return m


def fabric_tiled(name, tid, tint="#c9ad7c", rough=0.9, normal=1.0, res="1k"):
    """Högtalartyg som tilande glTF-material (bakas inte – väven är för fin för atlasen): tygbild × färgfaktor
    (exportens baseColorFactor), normalkarta. Objektets UV ska vara skalade till upprepningar (lib.uv_tile)."""
    SPECIAL.add(name)
    m, t = fresh(name)
    uv = t.n("ShaderNodeUVMap", uv_map="UVMap")

    def load(m_, color):
        path = os.path.join(TEX, tid, f"{tid}_{m_}_{res}.jpg")
        if color:
            # gråskala med jämn ljushet, så att färgfaktorn ensam bestämmer tygets ton (rough_linen är blå)
            import subprocess
            os.makedirs(os.path.join(lib.ROOT, "build", "tex"), exist_ok=True)
            gray = os.path.join(lib.ROOT, "build", "tex", f"{tid}_gray_{res}.jpg")
            if not os.path.exists(gray):
                subprocess.run(["magick", path, "-colorspace", "Gray", "-auto-level", "-level", "-35%,100%",
                                "-quality", "90", gray], check=True)
            path = gray
        im = bpy.data.images.get(os.path.basename(path)) or bpy.data.images.load(path)
        im.colorspace_settings.name = "sRGB" if color else "Non-Color"
        node = t.n("ShaderNodeTexImage", image=im)
        t.l(uv.outputs["UV"], node.inputs["Vector"])
        return node.outputs["Color"]

    col = t.mix(1.0, load("Diffuse", True), srgb(tint), "MULTIPLY")
    nm = t.n("ShaderNodeNormalMap", uv_map="UVMap", inputs={"Strength": normal})
    t.l(load("nor_gl", False), nm.inputs["Color"])
    t.set(col, rough, 0.0, nm.outputs["Normal"])
    return m


# ---------------------------------------------------------------- specialmaterial (bakas inte)

def special(name):
    m, t = fresh(name)
    b = t.bsdf
    if name == "Glass":
        t.set(srgb("#eef3ee"), 0.03, 0.0)
        b.inputs["Transmission Weight"].default_value = 1.0
        b.inputs["IOR"].default_value = 1.5
    elif name == "GreenGlass":
        t.set(srgb("#1d6b3b"), 0.08, 0.0)
        b.inputs["Transmission Weight"].default_value = 0.55
        b.inputs["IOR"].default_value = 1.5
        b.inputs["Emission Color"].default_value = srgb("#3fae5f")
        b.inputs["Emission Strength"].default_value = 0.35
    elif name == "Ember":
        t.set(srgb("#ff5a14"), 0.9, 0.0)
        b.inputs["Emission Color"].default_value = srgb("#ff6a1a")
        b.inputs["Emission Strength"].default_value = 6.0
    elif name == "Opal":
        t.set(srgb("#f6efe0"), 0.25, 0.0)
        b.inputs["Emission Color"].default_value = srgb("#ffe6bf")
        b.inputs["Emission Strength"].default_value = 1.6
    elif name == "Bulb":
        t.set(srgb("#fff2d6"), 0.2, 0.0)
        b.inputs["Emission Color"].default_value = srgb("#ffd9a0")
        b.inputs["Emission Strength"].default_value = 8.0
    elif name == "Eye":
        t.set(srgb("#2c8a52"), 0.1, 0.0)
        b.inputs["Emission Color"].default_value = srgb("#3dff8a")
        b.inputs["Emission Strength"].default_value = 2.0
    elif name == "DialGlass":
        t.set(srgb("#e9d9a8"), 0.15, 0.0)
        b.inputs["Emission Color"].default_value = srgb("#e9d9a8")
        b.inputs["Emission Strength"].default_value = 0.6
    elif name == "Screen":
        t.set(srgb("#3a403c"), 0.12, 0.0)
    return m


# ---------------------------------------------------------------- bakning

def cycles_gpu(samples=16):
    """Cycles på CPU. Metal-GPU:n (M5, Blender 5.2) ger 'GPU Address Fault' och hänger – välj den bara med GPU=1."""
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    if os.environ.get("GPU") != "1":
        return
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == "METAL"
        sc.cycles.device = "GPU"
    except Exception:  # noqa: BLE001
        sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False


def _source(t, sock):
    """Det som driver ett Principled-uttag: en länkad utgång eller ett konstant värde."""
    inp = t.bsdf.inputs[sock]
    if inp.is_linked:
        return inp.links[0].from_socket
    val = inp.default_value
    if sock == "Base Color":
        rgb = t.n("ShaderNodeRGB")
        rgb.outputs[0].default_value = tuple(val)
        return rgb.outputs[0]
    v = t.n("ShaderNodeValue")
    v.outputs[0].default_value = val
    return v.outputs[0]


def bake_set(objs, name, res=2048, ao_dist=0.3, margin=8, unwrap=True):
    """Smart UV-projektion över alla objs i ett gemensamt UV-rum, bakar baseColor/roughness/metallic/normal/AO
    till build/bake/<name>_*.png och byter alla icke-speciella material mot ett glTF-material <name>."""
    os.makedirs(BAKE, exist_ok=True)
    rx, ry = (res, res) if isinstance(res, int) else res
    objs = [o for o in objs if o.type == "MESH"]
    for o in objs:
        lib.apply_mods(o)
        if not unwrap:
            continue
        me = o.data
        for uv in list(me.uv_layers):
            me.uv_layers.remove(uv)
        me.uv_layers.new(name="UVMap")
    # Smart UV över alla objekt samtidigt (flerobjektsredigering)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if unwrap:
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0025, area_weight=0.0,
                                 correct_aspect=True, scale_to_bounds=False)
        bpy.ops.uv.pack_islands(margin=0.0025, rotate=True)
        bpy.ops.object.mode_set(mode="OBJECT")

    cycles_gpu(1)
    sc = bpy.context.scene
    # Cycles fyller ut kanterna per objekt och skriver då över andra objekts öar i samma bild (rattarnas svarta
    # bakelit hamnade på tangenterna). Baka utan utfyllnad och fyll ut efteråt med en täckningsmask (dilate).
    sc.render.bake.margin = 0
    if sc.world is None:
        sc.world = bpy.data.worlds.new("bakeworld")
    sc.world.light_settings.distance = ao_dist

    mats = []
    for o in objs:
        for s in o.material_slots:
            if s.material and s.material.name not in SPECIAL and s.material not in mats:
                mats.append(s.material)
    imgs = {}

    def target(key, color):
        im = bpy.data.images.new(f"{name}_{key}", rx, ry, alpha=False, float_buffer=(key == "normal"))
        im.colorspace_settings.name = "sRGB" if color else "Non-Color"
        imgs[key] = im
        for m in mats:
            nt = m.node_tree
            node = nt.nodes.get("__bake__") or nt.nodes.new("ShaderNodeTexImage")
            node.name = "__bake__"
            node.image = im
            nt.nodes.active = node
        return im

    def emit_pass(key, sock, color):
        target(key, color)
        saved = []
        for m in mats:
            t = Tree(m)
            if sock is None:  # täckningsmask: allt vitt
                src = t.n("ShaderNodeRGB").outputs[0]
                src.default_value = (1, 1, 1, 1)
            else:
                src = _source(t, sock)
            em = t.n("ShaderNodeEmission")
            t.l(src, em.inputs["Color"])
            prev = t.out.inputs["Surface"].links[0].from_socket
            saved.append((t, prev, em))
            t.l(em.outputs["Emission"], t.out.inputs["Surface"])
        t0 = time.time()
        sc.cycles.samples = 16  # kant- och skrevmaskerna (Bevel/AO-noder) är brusiga med ett sampel
        bpy.ops.object.bake(type="EMIT")
        print(f"    bake {name}/{key}: {time.time() - t0:.1f} s")
        for t, prev, em in saved:
            t.l(prev, t.out.inputs["Surface"])
            t.nt.nodes.remove(em)

    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    emit_pass("mask", None, False)
    emit_pass("base", "Base Color", True)
    emit_pass("rough", "Roughness", False)
    emit_pass("metal", "Metallic", False)
    target("normal", False)
    sc.cycles.samples = 8
    bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT")
    target("ao", False)
    sc.cycles.samples = 32
    t0 = time.time()
    bpy.ops.object.bake(type="AO")
    print(f"    bake {name}/ao: {time.time() - t0:.1f} s")

    # ORM: R = AO (mjukad), G = roughness, B = metallic
    def arr(im):
        a = np.empty(rx * ry * 4, dtype=np.float32)
        im.pixels.foreach_get(a)
        return a.reshape(ry, rx, 4)

    cover = arr(imgs["mask"])[..., 0] > 0.5
    for key in ("base", "normal"):
        a = dilate(arr(imgs[key]), cover, margin)
        imgs[key].pixels.foreach_set(a.ravel())
    ao = np.clip(0.35 + 0.65 * arr(imgs["ao"])[..., 0], 0, 1)
    orm = np.stack([ao, arr(imgs["rough"])[..., 0], arr(imgs["metal"])[..., 0], np.ones_like(ao)], -1)
    orm = dilate(orm, cover, margin)
    orm_im = bpy.data.images.new(f"{name}_orm", rx, ry, alpha=False)
    orm_im.colorspace_settings.name = "Non-Color"
    orm_im.pixels.foreach_set(orm.ravel())
    files = {}
    for key, im, color in (("base", imgs["base"], True), ("normal", imgs["normal"], False), ("orm", orm_im, False)):
        path = os.path.join(BAKE, f"{name}_{key}.png")
        im.filepath_raw = path
        im.file_format = "PNG"
        im.save()
        files[key] = path
    for key in ("rough", "metal", "ao", "mask"):
        bpy.data.images.remove(imgs[key])
    for m in mats:
        node = m.node_tree.nodes.get("__bake__")
        if node:
            m.node_tree.nodes.remove(node)
    out = gltf_material(name, files, res)
    for o in objs:
        for i, s in enumerate(o.material_slots):
            if s.material and s.material.name not in SPECIAL:
                s.material = out
    return out


def dilate(a, cover, n):
    """Fyll ut n pixlar runt de täckta öarna med medelvärdet av täckta grannar (inget täckt skrivs över)."""
    a = a.copy()
    cov = cover.copy()
    a[~cov] = 0
    for _ in range(n):
        acc = np.zeros_like(a)
        cnt = np.zeros(cov.shape, dtype=np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            sh = np.roll(np.roll(cov, dy, 0), dx, 1)
            acc += np.roll(np.roll(a, dy, 0), dx, 1) * sh[..., None]
            cnt += sh
        grow = (~cov) & (cnt > 0)
        a[grow] = acc[grow] / cnt[grow][:, None]
        cov = cov | grow
    return a


def gltf_material(name, files, res, jpeg_res=None):
    """Exportvänligt material: baseColor, ORM (occlusion via 'glTF Material Output', roughness/metallic via
    Separate Color) och normalkarta, alla på UVMap. Bilderna sparas om som JPEG (exporten bäddar in dem)."""
    m, t = fresh(name)
    uv = t.n("ShaderNodeUVMap", uv_map="UVMap")

    def load(key, color):
        src = files[key]
        im = bpy.data.images.load(src)
        im.colorspace_settings.name = "sRGB" if color else "Non-Color"
        im.name = f"{name}_{key}"
        node = t.n("ShaderNodeTexImage", image=im)
        t.l(uv.outputs["UV"], node.inputs["Vector"])
        return node

    base = load("base", True)
    orm = load("orm", False)
    nor = load("normal", False)
    t.l(base.outputs["Color"], t.bsdf.inputs["Base Color"])
    sep = t.n("ShaderNodeSeparateColor")
    t.l(orm.outputs["Color"], sep.inputs["Color"])
    t.l(sep.outputs["Green"], t.bsdf.inputs["Roughness"])
    t.l(sep.outputs["Blue"], t.bsdf.inputs["Metallic"])
    nm = t.n("ShaderNodeNormalMap", uv_map="UVMap")
    t.l(nor.outputs["Color"], nm.inputs["Color"])
    t.l(nm.outputs["Normal"], t.bsdf.inputs["Normal"])
    grp = gltf_output_group()
    g = t.n("ShaderNodeGroup")
    g.node_tree = grp
    sepo = t.n("ShaderNodeSeparateColor")
    t.l(orm.outputs["Color"], sepo.inputs["Color"])
    t.l(sepo.outputs["Red"], g.inputs["Occlusion"])
    return m


def gltf_output_group():
    """Nodgruppen som glTF-exporten läser occlusion ur."""
    g = bpy.data.node_groups.get("glTF Material Output")
    if g:
        return g
    g = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    g.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    g.interface.new_socket("Thickness", in_out="INPUT", socket_type="NodeSocketFloat")
    return g


def to_jpeg(paths_quality, max_res):
    """PNG -> JPEG (magick) med maxupplösning; returnerar nya sökvägar."""
    import subprocess
    out = {}
    for key, (path, q) in paths_quality.items():
        jp = path.replace(".png", ".jpg")
        subprocess.run(["magick", path, "-resize", f"{max_res}x{max_res}>", "-quality", str(q), jp], check=True)
        out[key] = jp
    return out


# ================================================================ slitage (tredje rundan: radio och tv)
# Masker i objektkoordinater (föremålen bakas med origo i världens origo, ovridna), så positioner kan anges
# direkt i meter: rattar där lacken nöts, kaffekoppsringar, cigarettbrännor, fingeravtryck.

def objco(t):
    return t.n("ShaderNodeTexCoord").outputs["Object"]


def up(t, a=0.55, b=0.95):
    """Uppåtvända ytor (1 = rakt upp)."""
    geo = t.n("ShaderNodeNewGeometry")
    sep = t.n("ShaderNodeSeparateXYZ")
    t.l(geo.outputs["Normal"], sep.inputs["Vector"])
    return t.ramp(sep.outputs["Z"], a, b)


def point_mask(t, center, radius, soft=0.35):
    d = t.n("ShaderNodeVectorMath", operation="DISTANCE")
    t.l(objco(t), d.inputs[0])
    d.inputs[1].default_value = center
    return t.math("SUBTRACT", 1.0, t.ramp(d.outputs["Value"], radius * soft, radius))


def local(t, center, angle=0.0, scale=(1, 1, 1)):
    """Objektkoordinater i en lokal ram: (p - center) roterad -angle kring Z och delad med scale."""
    mp = t.n("ShaderNodeMapping", vector_type="TEXTURE")
    mp.inputs["Location"].default_value = center
    mp.inputs["Rotation"].default_value = (0, 0, math.radians(angle))
    mp.inputs["Scale"].default_value = scale
    t.l(objco(t), mp.inputs["Vector"])
    return mp.outputs["Vector"]


def xy_len(t, vec):
    sep = t.n("ShaderNodeSeparateXYZ")
    t.l(vec, sep.inputs["Vector"])
    comb = t.n("ShaderNodeCombineXYZ")
    t.l(sep.outputs["X"], comb.inputs["X"])
    t.l(sep.outputs["Y"], comb.inputs["Y"])
    ln = t.n("ShaderNodeVectorMath", operation="LENGTH")
    t.l(comb.outputs["Vector"], ln.inputs[0])
    return ln.outputs["Value"]


def ring_mask(t, center, r, w):
    """Kaffekoppsring på en vågrät yta: en smal ring, tjockare och mörkare på ena sidan, uppbruten av brus."""
    d = xy_len(t, local(t, (center[0], center[1], 0)))
    band = t.math("SUBTRACT", 1.0, t.ramp(t.math("ABSOLUTE", t.math("SUBTRACT", d, r)), 0.0, w))
    n = t.ramp(t.noise(objco(t), 9.0, 4, 0.6), 0.25, 0.75)
    side = t.ramp(t.noise(objco(t), 1.5, 2, 0.5), 0.3, 0.7)
    inner = t.math("MULTIPLY", t.math("SUBTRACT", 1.0, t.ramp(d, r * 0.6, r)), 0.25)
    return t.math("MAXIMUM", t.math("MULTIPLY", band, t.math("ADD", 0.4, t.math("MULTIPLY", n, side))), inner)


def ellipse_mask(t, center, angle, ax, ay):
    """1 inne i en ellips (halvaxlar ax, ay) på en vågrät yta, mjuk kant."""
    d = xy_len(t, local(t, center, angle, (ax, ay, 1.0)))
    return t.math("SUBTRACT", 1.0, t.ramp(d, 0.55, 1.0)), d


def fingerprints(t, centers, radius=0.05):
    """Fingeravtryck: förvrängda koncentriska bågar inom små ovaler. Returnerar mask 0…1."""
    out = None
    for i, c in enumerate(centers):
        v = local(t, c, 23 * i, (radius, radius * 1.3, radius))
        wave = t.n("ShaderNodeTexWave", wave_type="RINGS", rings_direction="SPHERICAL",
                   inputs={"Scale": 6.0, "Distortion": 3.0, "Detail": 2.0, "Detail Scale": 2.0})
        t.l(v, wave.inputs["Vector"])
        ln = t.n("ShaderNodeVectorMath", operation="LENGTH")
        t.l(v, ln.inputs[0])
        m = t.math("MULTIPLY", t.math("SUBTRACT", 1.0, t.ramp(ln.outputs["Value"], 0.4, 1.0)),
                   t.ramp(wave.outputs["Fac"], 0.45, 0.8))
        out = m if out is None else t.math("MAXIMUM", out, m)
    return out


def dents(t, scale=3.0, density=0.12, size=0.06):
    """Små stötmärken: glesa Voronoi-celler med mjuk grop. Returnerar gropdjup 0…1."""
    vor = t.n("ShaderNodeTexVoronoi", feature="F1", inputs={"Scale": scale, "Randomness": 1.0})
    t.l(objco(t), vor.inputs["Vector"])
    sep = t.n("ShaderNodeSeparateColor")
    t.l(vor.outputs["Color"], sep.inputs["Color"])
    pick = t.math("LESS_THAN", sep.outputs["Red"], density)
    pit = t.math("SUBTRACT", 1.0, t.ramp(vor.outputs["Distance"], 0.0, size))
    return t.math("MULTIPLY", t.math("POWER", pit, 2.0), pick)


def dust(t, col, rough, amount=1.0):
    """Damm i skrevor, längs lister och på uppåtvända ytor (rökigt krigsrum): gråbeige, matt."""
    n = t.ramp(t.noise(t.coords(7.0), 4, 6, 0.6), 0.3, 0.75)
    cav = t.math("MULTIPLY", t.cavity(0.04), 1.0)
    m = t.math("MAXIMUM", cav, t.math("MULTIPLY", up(t, 0.6, 0.98), 0.3))
    m = t.math("MULTIPLY", t.math("MULTIPLY", m, n), amount, clamp=True)
    col = t.mix(m, col, srgb("#8d826f"))
    rough = t.mixf(m, rough, 0.92)
    return col, rough, m


def wood_worn(name, tid, tint, scale, darken, gloss, rot=(0, 0, 0), sat=1.0, knobs=(), rings=(), burns=(),
              bleach=0.7, wear=0.9):
    """Lackat fanér, 25 år i ett rökigt krigsrum: solblekt och repigt ovanpå, lacken nött på kanter och runt
    rattarna, stötmärken, damm i skrevor, kaffekoppsringar, cigarettbrännor."""
    m, t = fresh(name)
    v = t.coords(1.0 / scale, rot)
    tex = t.image(tid, "Diffuse", v)
    col = t.gamma(tex, darken)
    col = t.mix(1.0, col, srgb(tint), "MULTIPLY")
    col = t.hsv(col, s=sat)
    r_tex = t.bw(t.image(tid, "Rough", v, color=False))
    upm = up(t)
    nb = t.ramp(t.noise(t.coords(1.2), 3, 3, 0.5), 0.2, 0.8)
    # solblekt ovansida: ljusare, gråare, mattare lack
    bl = t.math("MULTIPLY", t.math("MULTIPLY", upm, nb), bleach)
    faded = t.mix(0.6, t.hsv(col, s=0.45, v=1.1), srgb("#7d6046"))  # blekt lack drar mot gråbrun, inte rosa
    col = t.mix(bl, col, faded)
    # repor: tätare och synligare på ovansidan
    scr = t.ramp(t.bw(t.image("lacquered_cherry_wood", "Rough", t.coords(1.0 / (scale * 1.3), (0, 0, 37)),
                              color=False)), 0.4, 0.75)
    scr2 = t.ramp(t.bw(t.image("painted_metal_shutter", "Rough", t.coords(1.6, (0, 0, 12)), color=False)), 0.55, 0.8)
    scr_all = t.math("MAXIMUM", t.math("MULTIPLY", scr, 0.6), t.math("MULTIPLY", scr2, t.math("ADD", 0.3, upm)))
    col = t.mix(t.math("MULTIPLY", scr_all, 0.35), col, t.hsv(col, s=0.7, v=1.5))
    # nött lack: kanter (där händer tar) och runt rattarna
    w = t.wear(v, 0.02, wear)
    for (c, r) in knobs:
        km = t.math("MULTIPLY", point_mask(t, c, r), t.ramp(t.noise(objco(t), 14, 5, 0.6), 0.35, 0.65))
        w = t.math("MAXIMUM", w, km)
    col = t.mix(w, col, t.mix(1.0, t.hsv(col, s=0.8, v=1.25), (1.1, 1.05, 0.95, 1), "MULTIPLY"))
    # stötmärken
    dn = dents(t, 2.4, 0.1, 0.05)
    col = t.mix(t.math("MULTIPLY", dn, 0.5), col, srgb("#2a1a10"))
    # kaffekoppsringar
    cr = None
    for (c, r) in rings:
        rm = t.math("MULTIPLY", ring_mask(t, c, r, 0.03), upm)
        cr = rm if cr is None else t.math("MAXIMUM", cr, rm)
    if cr is not None:
        col = t.mix(t.math("MULTIPLY", cr, 0.85), col, srgb("#24120a"))
    # cigarettbrännor: svart kärna, brun gloria, grop
    bm_all = None
    for (c, ang, ax, ay) in burns:
        bm, d = ellipse_mask(t, c, ang, ax, ay)
        bm = t.math("MULTIPLY", bm, upm)
        halo = t.math("MULTIPLY", t.math("SUBTRACT", 1.0, t.ramp(d, 0.8, 1.9)), upm)
        col = t.mix(t.math("MULTIPLY", halo, 0.6), col, srgb("#3a1f0c"))
        core = t.ramp(bm, 0.35, 0.8)
        col = t.mix(core, col, srgb("#0b0806"))
        bm_all = core if bm_all is None else t.math("MAXIMUM", bm_all, core)
    # roughness: lackglans, repor, nött, blekt
    rough = t.math("ADD", gloss, t.math("MULTIPLY", r_tex, 0.08))
    rough = t.math("ADD", rough, t.math("MULTIPLY", scr_all, 0.25))
    rough = t.mixf(bl, rough, 0.45)
    rough = t.mixf(w, rough, 0.6)
    if cr is not None:
        rough = t.mixf(cr, rough, 0.55)
    if bm_all is not None:
        rough = t.mixf(bm_all, rough, 0.9)
    col, rough, _ = dust(t, col, rough, 0.9)
    h = t.math("ADD", t.math("MULTIPLY", r_tex, 0.3), t.math("MULTIPLY", scr_all, -0.4))
    h = t.math("ADD", h, t.math("MULTIPLY", dn, -1.5))
    if bm_all is not None:
        h = t.math("ADD", h, t.math("MULTIPLY", bm_all, -1.0))
    nrm = t.bump(h, 0.12, 0.003)
    t.set(col, rough, 0.0, nrm)
    return m


def bakelite_worn(name, color="#1e130d", mottle="#3a2416", scale=0.3, gloss=0.12, prints=(), dust_amt=0.8, chips=1.0):
    """Bakelit: djup glans med marmorering, kantstötta flisor (ljusare, matta, gropiga), repor, fingeravtryck, damm."""
    m, t = fresh(name)
    v = t.coords(1.0 / scale)
    swirl = t.ramp(t.noise(v, 3.5, 8, 0.7, dist=1.2), 0.45, 0.75)
    col = t.mix(t.math("MULTIPLY", swirl, 0.55), srgb(color), srgb(mottle))
    w = t.wear(v, 0.012, 1.0)
    chip = t.math("MULTIPLY", t.math("MULTIPLY", t.edge(0.012), t.ramp(t.noise(t.coords(40.0), 4, 6, 0.7), 0.66, 0.72)),
                  chips)
    col = t.mix(t.math("MULTIPLY", w, 0.5), col, srgb("#5b3a22"))
    col = t.mix(chip, col, srgb("#6e4a2e"))
    scr = t.bw(t.image("lacquered_cherry_wood", "Rough", t.coords(1.0 / (scale * 1.4), (0, 30, 12)), color=False))
    rough = t.math("ADD", gloss, t.math("MULTIPLY", t.ramp(scr, 0.35, 0.85), 0.28))
    rough = t.mixf(w, rough, 0.45)
    rough = t.mixf(chip, rough, 0.8)
    if prints:
        fp = fingerprints(t, prints, 0.06)
        rough = t.mixf(t.math("MULTIPLY", fp, 0.8), rough, 0.4)
    col, rough, _ = dust(t, col, rough, dust_amt)
    h = t.math("ADD", t.math("MULTIPLY", scr, 0.05), t.math("MULTIPLY", chip, -1.0))
    t.set(col, rough, 0.0, t.bump(h, 0.2, 0.002))
    return m


def brass_worn(name, polish=0.6, patina=0.8, scale=0.3, prints=()):
    """Mässing med patina (mörk anlöpning, grönsvart i djupet), blanknött där händer tar, fingeravtryck, damm."""
    m, t = fresh(name)
    v = t.coords(1.0 / scale)
    n1 = t.noise(v, 2.2, 4, 0.5)
    tarn = t.math("MULTIPLY", t.ramp(n1, 0.25, 0.8), patina * 0.75)
    tarn = t.math("MAXIMUM", tarn, t.math("MULTIPLY", t.cavity(0.04), 0.95))
    w = t.wear(v, 0.012, 1.0 + polish)
    tarn = t.math("MULTIPLY", tarn, t.math("SUBTRACT", 1.0, w), clamp=True)
    col = t.mix(tarn, srgb("#d9ad5b"), srgb("#7a5a2a"))
    verd = t.math("MULTIPLY", t.cavity(0.04), t.ramp(t.noise(v, 9, 4, 0.6), 0.5, 0.7))
    col = t.mix(t.math("MULTIPLY", verd, 0.7), col, srgb("#3d4a32"))  # irgröna fläckar i skrevorna
    scr = t.bw(t.image("lacquered_cherry_wood", "Rough", t.coords(1.0 / (scale * 2.3), (20, 0, 61)), color=False))
    rough = t.math("ADD", 0.15, t.math("MULTIPLY", t.ramp(scr, 0.3, 0.85), 0.25))
    rough = t.mixf(tarn, rough, 0.5)
    rough = t.mixf(w, rough, 0.1)
    if prints:
        fp = fingerprints(t, prints, 0.05)
        rough = t.mixf(t.math("MULTIPLY", fp, 0.9), rough, 0.45)
        col = t.mix(t.math("MULTIPLY", fp, 0.25), col, srgb("#6b5326"))
    col, rough, _ = dust(t, col, rough, 0.7)
    t.set(col, rough, t.mixf(tarn, 1.0, 0.75), t.bump(scr, 0.03, 0.001))
    return m


def chrome_worn(name, scale=0.2):
    """Gammal krom: gropfrätt (små mörka prickar), anlöpt, repig, rost i skrevorna."""
    m, t = fresh(name)
    v = t.coords(1.0 / scale)
    vor = t.n("ShaderNodeTexVoronoi", feature="F1", inputs={"Scale": 120.0, "Randomness": 1.0})
    t.l(objco(t), vor.inputs["Vector"])
    sep = t.n("ShaderNodeSeparateColor")
    t.l(vor.outputs["Color"], sep.inputs["Color"])
    pit = t.math("MULTIPLY", t.math("SUBTRACT", 1.0, t.ramp(vor.outputs["Distance"], 0.0, 0.18)),
                 t.math("LESS_THAN", sep.outputs["Red"], 0.25))
    tarn = t.ramp(t.noise(v, 2.5, 4, 0.5), 0.35, 0.8)
    col = t.mix(t.math("MULTIPLY", tarn, 0.45), srgb("#dcdcd8"), srgb("#9a8f7a"))
    col = t.mix(pit, col, srgb("#3b2a1a"))
    col = t.mix(t.math("MULTIPLY", t.cavity(0.03), 0.8), col, srgb("#5a3a20"))
    scr = t.bw(t.image("lacquered_cherry_wood", "Rough", t.coords(1.0 / (scale * 2), (40, 10, 5)), color=False))
    rough = t.math("ADD", 0.08, t.math("MULTIPLY", t.ramp(scr, 0.35, 0.9), 0.2))
    rough = t.mixf(t.math("MAXIMUM", pit, t.math("MULTIPLY", tarn, 0.5)), rough, 0.55)
    col, rough, _ = dust(t, col, rough, 0.6)
    t.set(col, rough, t.mixf(pit, 1.0, 0.2), t.bump(t.math("SUBTRACT", scr, pit), 0.05, 0.001))
    return m


def ivory_worn(name, color="#e6d6b0"):
    """Elfenbensfärgad plast, gulnad med åren: gulare i fördjupningar och på ovansidor, smuts i kanterna,
    blanknött där fingrarna trycker."""
    m, t = fresh(name)
    v = t.coords(5.0)
    n = t.noise(v, 4, 4, 0.5)
    col = t.mix(t.math("MULTIPLY", t.ramp(n, 0.3, 0.8), 0.45), srgb(color), srgb("#cfb27a"))
    col = t.mix(t.math("MULTIPLY", t.cavity(0.04), 0.85), col, srgb("#6d5a3a"))
    w = t.wear(v, 0.012, 0.8)
    col = t.mix(w, col, srgb("#f3ead4"))
    rough = t.mixf(w, 0.32, 0.16)
    col, rough, _ = dust(t, col, rough, 0.9)
    t.set(col, rough, 0.0)
    return m


def print_worn(name, color, under, amount=0.55):
    """Tryckt/målad markering (tangenttext, visarstreck, siffror) som delvis nötts bort mot underlaget."""
    m, t = fresh(name)
    n = t.ramp(t.noise(t.coords(90.0), 5, 6, 0.65), 0.4, 0.6)
    gone = t.math("MULTIPLY", t.math("ADD", n, t.math("MULTIPLY", t.edge(0.004), 0.6)), amount, clamp=True)
    col = t.mix(gone, srgb(color), srgb(under))
    t.set(col, t.mixf(gone, 0.45, 0.3), 0.0)
    return m


def rubber(name, color="#242220"):
    m, t = fresh(name)
    n = t.noise(t.coords(30.0), 6, 6, 0.6)
    col = t.mix(t.math("MULTIPLY", t.ramp(n, 0.3, 0.8), 0.3), srgb(color), srgb("#3c3a36"))
    rough = 0.82
    col, rough, _ = dust(t, col, rough, 1.0)
    t.set(col, rough, 0.0, t.bump(n, 0.15, 0.002))
    return m


def cloth_cord(name, color="#2a221b"):
    """Textilomspunnen sladd: fina fibrer längs tråden, nött och dammig."""
    m, t = fresh(name)
    wave = t.n("ShaderNodeTexWave", wave_type="BANDS", bands_direction="DIAGONAL",
               inputs={"Scale": 1.0, "Distortion": 2.0, "Detail": 4.0})
    t.l(t.coords(60.0), wave.inputs["Vector"])
    n = t.noise(t.coords(80.0), 6, 6, 0.6)
    col = t.mix(t.math("MULTIPLY", t.ramp(wave.outputs["Fac"], 0.3, 0.9), 0.35), srgb(color), srgb("#57483a"))
    col = t.mix(t.math("MULTIPLY", t.ramp(n, 0.5, 0.8), 0.3), col, srgb("#7a6a55"))
    rough = 0.9
    col, rough, _ = dust(t, col, rough, 0.8)
    t.set(col, rough, 0.0, t.bump(t.math("ADD", wave.outputs["Fac"], t.math("MULTIPLY", n, 0.3)), 0.35, 0.002))
    return m


def weave_image(t, key, vec, color):
    path = os.path.join(lib.ROOT, "build", "tex", f"weave_{key}.png")
    im = bpy.data.images.get(os.path.basename(path)) or bpy.data.images.load(path)
    im.colorspace_settings.name = "sRGB" if color else "Non-Color"
    node = t.n("ShaderNodeTexImage", image=im, projection="BOX", projection_blend=0.0, interpolation="Cubic")
    t.l(vec, node.inputs["Vector"])
    return node.outputs["Color"]


def fabric_worn(name, tile, tint, z_range, stains=(), bleach=(), tears=()):
    """Högtalarduk i tuskaft (verklig vävstruktur från build/tex/weave_*), gulnad uppåt av röken, vattenfläckar
    med mörka kanter, ett blekt parti och en liten reva där den mörka bafflen syns. Bakas till egen textur.
    tile = vävtilens storlek i meter (32 trådpar per tile). stains/bleach: [(center, radius)],
    tears: [(center, angle, length, width)] i XZ-planet (duken vetter mot -Y)."""
    m, t = fresh(name)
    v = t.coords(1.0 / tile)
    h = t.bw(weave_image(t, "height", v, False))
    metal = t.bw(weave_image(t, "metal", v, False))
    col = t.mix(1.0, weave_image(t, "col", v, True), srgb(tint), "MULTIPLY")
    col = t.mix(0.25, col, srgb(tint))
    # gulnad/brunnad uppåt (rök stiger) + brus
    sep = t.n("ShaderNodeSeparateXYZ")
    t.l(objco(t), sep.inputs["Vector"])
    yel = t.math("MULTIPLY", t.ramp(sep.outputs["Z"], z_range[0], z_range[1]),
                 t.ramp(t.noise(t.coords(3.0), 3, 4, 0.5), 0.2, 0.8))
    col = t.mix(t.math("MULTIPLY", yel, 0.65), col, t.mix(1.0, col, srgb("#b98e4e"), "MULTIPLY"))
    # vattenfläckar: blek insida, mörk kant (tide mark)
    for (c, r) in stains:
        d = t.n("ShaderNodeVectorMath", operation="DISTANCE")
        t.l(objco(t), d.inputs[0])
        d.inputs[1].default_value = c
        nn = t.math("MULTIPLY", t.noise(objco(t), 12.0, 4, 0.6), r * 0.5)
        dd = t.math("ADD", d.outputs["Value"], nn)
        inside = t.math("SUBTRACT", 1.0, t.ramp(dd, r * 0.85, r))
        rim = t.math("MULTIPLY", inside, t.ramp(dd, r * 0.7, r * 0.95))
        col = t.mix(t.math("MULTIPLY", inside, 0.3), col, t.mix(1.0, col, srgb("#c09a62"), "MULTIPLY"))
        col = t.mix(t.math("MULTIPLY", rim, 0.7), col, srgb("#5e4022"))
    # blekt parti (sol eller rengöringsförsök)
    for (c, r) in bleach:
        b = t.math("MULTIPLY", point_mask(t, c, r, 0.2), t.ramp(t.noise(objco(t), 6, 3, 0.5), 0.2, 0.7))
        col = t.mix(t.math("MULTIPLY", b, 0.7), col, t.hsv(col, s=0.4, v=1.35))
    # reva: smal oval med fransig kant; inuti syns mörk baffel
    tear_m = None
    for (c, ang, L, W) in tears:
        mp = t.n("ShaderNodeMapping", vector_type="TEXTURE")
        mp.inputs["Location"].default_value = c
        mp.inputs["Rotation"].default_value = (0, math.radians(ang), 0)
        mp.inputs["Scale"].default_value = (L, 1.0, W)
        t.l(objco(t), mp.inputs["Vector"])
        s2 = t.n("ShaderNodeSeparateXYZ")
        t.l(mp.outputs["Vector"], s2.inputs["Vector"])
        cmb = t.n("ShaderNodeCombineXYZ")
        t.l(s2.outputs["X"], cmb.inputs["X"])
        t.l(s2.outputs["Z"], cmb.inputs["Z"])
        ln = t.n("ShaderNodeVectorMath", operation="LENGTH")
        t.l(cmb.outputs["Vector"], ln.inputs[0])
        fray = t.math("MULTIPLY", t.noise(objco(t), 160.0, 3, 0.6), 0.5)
        tm = t.math("SUBTRACT", 1.0, t.ramp(t.math("ADD", ln.outputs["Value"], fray), 0.7, 0.95))
        tear_m = tm if tear_m is None else t.math("MAXIMUM", tear_m, tm)
    if tear_m is not None:
        col = t.mix(tear_m, col, srgb("#120c08"))
    rough = t.mixf(metal, 0.88, 0.4)
    col, rough, dm = dust(t, col, rough, 0.6)
    hh = h if tear_m is None else t.math("MULTIPLY", h, t.math("SUBTRACT", 1.0, tear_m))
    t.set(col, rough, t.mixf(metal, 0.0, 0.7), t.bump(hh, 0.9, 0.0025))
    return m


def grime_overlay(name, path):
    """Genomskinlig smutsfilm (alfa ur bilden) – t.ex. framför radioskalan, som spelet ritar själv."""
    SPECIAL.add(name)
    m, t = fresh(name)
    im = bpy.data.images.load(path)
    node = t.n("ShaderNodeTexImage", image=im)
    uv = t.n("ShaderNodeUVMap", uv_map="UVMap")
    t.l(uv.outputs["UV"], node.inputs["Vector"])
    t.l(node.outputs["Color"], t.bsdf.inputs["Base Color"])
    t.l(node.outputs["Alpha"], t.bsdf.inputs["Alpha"])
    t.bsdf.inputs["Roughness"].default_value = 0.7
    try:
        m.surface_render_method = "BLENDED"
    except AttributeError:
        m.blend_method = "BLEND"
    return m


def ember_tex(name):
    """Glöd: mörk aska som bas, emissiv textur med glödande prickar (build/tex/ember.png). Bakas inte."""
    SPECIAL.add(name)
    m, t = fresh(name)
    im = bpy.data.images.load(os.path.join(lib.ROOT, "build", "tex", "ember.png"))
    node = t.n("ShaderNodeTexImage", image=im)
    uv = t.n("ShaderNodeUVMap", uv_map="UVMap")
    t.l(uv.outputs["UV"], node.inputs["Vector"])
    t.bsdf.inputs["Base Color"].default_value = srgb("#2e2a27")
    t.bsdf.inputs["Roughness"].default_value = 0.9
    t.l(node.outputs["Color"], t.bsdf.inputs["Emission Color"])
    t.bsdf.inputs["Emission Strength"].default_value = 5.0
    return m


def porcelain_worn(name, color="#efe5cf", drip=None, ring=None, z_saucer=0.13):
    """Elfenbensvitt porslin med krakelerad glasyr, kafferand som runnit ned på utsidan (drip = (vinkel, z_topp,
    z_botten)), kaffering på fatet (ring = (center, r)) och damm."""
    m, t = fresh(name)
    v = t.coords(8.0)
    n = t.noise(v, 3, 3, 0.5)
    col = t.mix(t.math("MULTIPLY", t.ramp(n, 0.4, 0.8), 0.2), srgb(color), srgb("#ddcfb2"))
    # krakelering: fint nät av mörkare linjer i glasyren
    vor = t.n("ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE", inputs={"Scale": 55.0, "Randomness": 1.0})
    t.l(objco(t), vor.inputs["Vector"])
    craze = t.math("MULTIPLY", t.math("SUBTRACT", 1.0, t.ramp(vor.outputs["Distance"], 0.0, 0.025)),
                   t.ramp(t.noise(objco(t), 4.0, 2, 0.5), 0.35, 0.65))
    col = t.mix(t.math("MULTIPLY", craze, 0.35), col, srgb("#8d7a5c"))
    col = t.mix(t.math("MULTIPLY", t.cavity(0.03), 0.5), col, srgb("#8c7c60"))
    rough = t.math("ADD", 0.06, t.math("MULTIPLY", craze, 0.15))
    h = t.math("MULTIPLY", craze, -0.4)
    if drip:
        ang, z_top, z_bot = drip
        lv = local(t, (0, 0, 0), ang, (1, 1, 1))
        sep = t.n("ShaderNodeSeparateXYZ")
        t.l(lv, sep.inputs["Vector"])
        # rännilen: smal i y, ute på koppens utsida (x > 0,3), ojämn nedre ände
        zz = sep.outputs["Z"]
        wob = t.math("MULTIPLY", t.noise(objco(t), 18.0, 3, 0.5), 0.06)
        width = t.math("ADD", 0.025, t.math("MULTIPLY", t.ramp(zz, z_bot, z_top), 0.02))
        ym = t.math("SUBTRACT", 1.0, t.ramp(t.math("ABSOLUTE", t.math("ADD", sep.outputs["Y"], t.math("MULTIPLY", wob, 0.3))),
                                              0.0, width))
        zm = t.ramp(zz, z_bot, z_bot + 0.04)
        outside = t.ramp(sep.outputs["X"], 0.3, 0.36)
        dm = t.math("MULTIPLY", t.math("MULTIPLY", ym, zm), outside)
        dm = t.math("MULTIPLY", dm, t.math("SUBTRACT", 1.0, t.ramp(zz, z_top, z_top + 0.005)))
        col = t.mix(t.math("MULTIPLY", dm, 0.85), col, srgb("#4a2a12"))
        rough = t.mixf(dm, rough, 0.12)
    if ring:
        c, r = ring
        sep2 = t.n("ShaderNodeSeparateXYZ")
        t.l(objco(t), sep2.inputs["Vector"])
        low = t.math("SUBTRACT", 1.0, t.ramp(sep2.outputs["Z"], z_saucer - 0.02, z_saucer))
        rm = t.math("MULTIPLY", ring_mask(t, c, r, 0.018), low)
        col = t.mix(t.math("MULTIPLY", rm, 0.8), col, srgb("#5a3418"))
        rough = t.mixf(rm, rough, 0.35)
    col, rough, _ = dust(t, col, rough, 0.4)
    t.set(col, rough, 0.0, t.bump(h, 0.15, 0.001))
    return m


def bisque(name):
    """Oglaserat porslin (kantstött hack): kritvitt, matt, kornigt."""
    m, t = fresh(name)
    n = t.noise(t.coords(200.0), 6, 4, 0.6)
    t.set(t.mix(t.math("MULTIPLY", n, 0.3), srgb("#f2ece0"), srgb("#c9bfae")), 0.85, 0.0, t.bump(n, 0.4, 0.001))
    return m


def blotter(name, blots=()):
    """Läskunderlägg: grönt läskpapper med bläckfläckar och avtorkade pennstreck, läderhörn."""
    m, t = fresh(name)
    v = t.coords(6.0)
    n = t.noise(v, 6, 6, 0.6)
    col = t.mix(t.math("MULTIPLY", t.ramp(n, 0.3, 0.8), 0.35), srgb("#3f5a3a"), srgb("#6b7d58"))
    ink = None
    for (c, r) in blots:
        d = t.n("ShaderNodeVectorMath", operation="DISTANCE")
        t.l(objco(t), d.inputs[0])
        d.inputs[1].default_value = c
        nn = t.math("MULTIPLY", t.noise(objco(t), 9.0, 4, 0.6), r * 0.8)
        b = t.math("SUBTRACT", 1.0, t.ramp(t.math("ADD", d.outputs["Value"], nn), r * 0.6, r))
        ink = b if ink is None else t.math("MAXIMUM", ink, b)
    # avtorkade streck (pennan torkad mot pappret)
    wave = t.n("ShaderNodeTexWave", wave_type="BANDS", bands_direction="X",
               inputs={"Scale": 3.0, "Distortion": 8.0, "Detail": 2.0})
    t.l(t.coords(1.0, (0, 0, 35)), wave.inputs["Vector"])
    strokes = t.math("MULTIPLY", t.ramp(wave.outputs["Fac"], 0.92, 1.0), t.ramp(n, 0.55, 0.75))
    ink = strokes if ink is None else t.math("MAXIMUM", ink, strokes)
    col = t.mix(t.math("MULTIPLY", ink, 0.9), col, srgb("#10142a"))
    t.set(col, t.mixf(ink, 0.95, 0.4), 0.0, t.bump(n, 0.2, 0.002))
    return m


def felt(name, color="#2f4a2c"):
    m, t = fresh(name)
    n = t.noise(t.coords(120.0), 6, 6, 0.6)
    col = t.mix(t.math("MULTIPLY", n, 0.25), srgb(color), srgb("#1c2a1a"))
    col, rough, _ = dust(t, col, 0.97, 0.6)
    t.set(col, rough, 0.0, t.bump(n, 0.3, 0.001))
    return m


def ink_crust(t, col, rough, z0, z1):
    """Intorkat bläck vid ett lock: svart, blankt skorpa i höjdbandet z0–z1, uppbruten av brus."""
    sep = t.n("ShaderNodeSeparateXYZ")
    t.l(objco(t), sep.inputs["Vector"])
    band = t.math("MULTIPLY", t.ramp(sep.outputs["Z"], z0, z0 + 0.01),
                  t.math("SUBTRACT", 1.0, t.ramp(sep.outputs["Z"], z1 - 0.01, z1)))
    m = t.math("MULTIPLY", band, t.ramp(t.noise(objco(t), 30.0, 4, 0.6), 0.45, 0.6))
    return t.mix(m, col, srgb("#07081a")), t.mixf(m, rough, 0.08), m


def variant(src, name, transmission=0.0, emission=None, strength=0.0):
    """Kopia av ett bakat glTF-material (samma texturer) med transmission/emission – t.ex. lampans gröna glas,
    som bakas med damm i atlasen men exporteras genomskinligt."""
    SPECIAL.add(name)
    old = bpy.data.materials.get(name)
    if old:
        old.name = name + "_old"
    m = src.copy()
    m.name = name
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Transmission Weight"].default_value = transmission
    b.inputs["IOR"].default_value = 1.5
    if emission:
        b.inputs["Emission Color"].default_value = srgb(emission)
        b.inputs["Emission Strength"].default_value = strength
    return m
