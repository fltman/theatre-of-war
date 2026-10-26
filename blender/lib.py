"""Modelleringshjälp för Världsläget (Blender 5.2, körs headless). Nedskalad från battlechess/blender/lib.py.

Konventioner: Blender-meter = three-enheter (1 enhet = 1 dm på bordet), Z upp, föremålen tittar mot -Y
(Blenders framvy). glTF-exporten gör om till Y upp och +Z framåt i three. Vänster sida = +X.
Origo mitt under föremålet: allt står på z = 0.
"""
import bpy
import bmesh
import math
import os
import sys
from mathutils import Vector, Matrix, Euler

TAU = math.tau
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
RAW = os.path.join(ROOT, "build", "models")
PREVIEWS = os.path.join(ROOT, "build", "previews")


def argv():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    a = argv()
    return a[a.index(name) + 1] if name in a else default


# ---------------------------------------------------------------- scen

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for c in (bpy.data.meshes, bpy.data.materials, bpy.data.objects, bpy.data.images, bpy.data.lights,
              bpy.data.cameras, bpy.data.worlds):
        for item in list(c):
            c.remove(item)


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def empty(name, loc=(0, 0, 0), parent=None):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_size = 0.05
    link(ob)
    ob.location = loc
    if parent:
        set_parent(ob, parent)
    return ob


# ---------------------------------------------------------------- material

def srgb(h):
    """'#rrggbb' -> linjär färg (Blenders färger är linjära)."""
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*lin, 1.0)


# Förhandsfärger för Blender-renderingarna; spelet byter ut materialen efter namn (namnen är kontrakt).
# (färg, metall, råhet, emission)
MAT_COLORS = {
    "Paint": (srgb("#c99a2e"), 0.0, 0.42, 0),       # fraktionsfärg (förhandsvisas som Gul)
    "Metal": (srgb("#5d6066"), 1.0, 0.38, 0),       # gunmetal/tenn
    "Brass": (srgb("#c89a52"), 1.0, 0.3, 0),
    "Skin": (srgb("#e0a888"), 0.0, 0.5, 0),
    "Leather": (srgb("#4a2a16"), 0.0, 0.55, 0),
    "Dark": (srgb("#1c1b1a"), 0.0, 0.5, 0),
    "Base": (srgb("#3f4a28"), 0.0, 0.75, 0),        # figurfotens jordfärg
    "Wood": (srgb("#7a4424"), 0.0, 0.42, 0),        # teak
    "Bakelite": (srgb("#2a1a12"), 0.0, 0.22, 0),
    "Glass": (srgb("#dfe8e4"), 0.0, 0.04, 0),
    "Tread": (srgb("#2a2a2a"), 0.6, 0.6, 0),
    "Grille": (srgb("#8c7656"), 0.0, 0.95, 0),      # högtalartyg
    "DialGlass": (srgb("#e9d9a8"), 0.0, 0.15, 0.6),  # radioskalan (glöder)
    "Screen": (srgb("#3a403c"), 0.0, 0.12, 0.25),
    "FlagPaper": (srgb("#ece2c6"), 0.0, 0.9, 0),
    "Hull": (srgb("#7d8285"), 0.0, 0.6, 0),         # fartygsgrått
    "Ivory": (srgb("#e8dcc0"), 0.0, 0.28, 0),
    "GreenGlass": (srgb("#1f6a3a"), 0.0, 0.08, 0),
    "Porcelain": (srgb("#f1efe8"), 0.0, 0.12, 0),
    "Coffee": (srgb("#24120a"), 0.0, 0.05, 0),
    "Cigar": (srgb("#6b4024"), 0.0, 0.8, 0),
    "Ember": (srgb("#ff6a1a"), 0.0, 0.9, 6.0),
    "Ink": (srgb("#0b0d1c"), 0.0, 0.05, 0),
    "Ash": (srgb("#9a968e"), 0.0, 0.95, 0),
    "Eye": (srgb("#3dff8a"), 0.0, 0.1, 2.0),        # radions magiska öga
}


def mat(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    col, metal, rough, emit = MAT_COLORS.get(name, ((0.8, 0.8, 0.8, 1), 0.0, 0.5, 0))
    m.diffuse_color = col
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = col
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = col
        b.inputs["Emission Strength"].default_value = emit
    if name in ("Glass", "GreenGlass"):
        b.inputs["Transmission Weight"].default_value = 0.85 if name == "Glass" else 0.55
        b.inputs["IOR"].default_value = 1.5
    return m


def keep_uvs():
    """Blenders glTF-export skriver bara UV:er som en textur använder: koppla en dummybild till varje
    material (tools/optimize.mjs tar bort bilderna igen men behåller TEXCOORD_0)."""
    dummy = bpy.data.images.get("uvkeep")
    if dummy is None:
        dummy = bpy.data.images.new("uvkeep", 4, 4)
        dummy.pixels = [1.0] * 64  # vit: vit × färg = färg
    for m in bpy.data.materials:
        if not m.use_nodes or m.name.startswith("Preview"):
            continue
        nt = m.node_tree
        if any(n.type == "TEX_IMAGE" for n in nt.nodes):
            continue
        bsdf = nt.nodes.get("Principled BSDF")
        tx = nt.nodes.new("ShaderNodeTexImage")
        tx.image = dummy
        # bild × färg via Mix (Multiply): exporten skriver då både texturen (UV:erna överlever) och baseColorFactor
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        mix.inputs["B"].default_value = bsdf.inputs["Base Color"].default_value
        nt.links.new(tx.outputs["Color"], mix.inputs["A"])
        nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])


# ---------------------------------------------------------------- mesh-primitiver

def _obj_from_bm(name, bm, material=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    link(ob)
    if material:
        me.materials.append(mat(material))
    return ob


def lathe(name, profile, seg=32, material="Paint", sx=1.0, sy=1.0, cap_bottom=True, cap_top=True,
          center=(0, 0, 0), phase=0.0, arc=None):
    """Rotationskropp. profile = [(radie, z), ...] nerifrån och upp. sx/sy ger ellips.
    arc = (a0, a1) i radianer: öppen yta i stället för hel rotation."""
    bm = bmesh.new()
    rings = []
    closed = arc is None
    n_a = seg if closed else seg + 1
    for (r, z) in profile:
        ring = []
        for i in range(n_a):
            a = TAU * i / seg + phase if closed else arc[0] + (arc[1] - arc[0]) * i / seg
            ring.append(bm.verts.new((center[0] + math.cos(a) * r * sx, center[1] + math.sin(a) * r * sy, center[2] + z)))
        rings.append(ring)
    for k in range(len(rings) - 1):
        a, b = rings[k], rings[k + 1]
        for i in range(seg if closed else n_a - 1):
            j = (i + 1) % n_a
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if closed and cap_bottom and profile[0][0] > 1e-5:
        bm.faces.new(list(reversed(rings[0])))
    if closed and cap_top and profile[-1][0] > 1e-5:
        bm.faces.new(rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj_from_bm(name, bm, material)


def cyl(name, a, b, r, seg=16, material="Metal", r2=None, bevel=0.0):
    """Cylinder (eller kon med r2) från punkt a till b."""
    L = (Vector(b) - Vector(a)).length
    r2 = r if r2 is None else r2
    ob = lathe(name, [(r, 0), (r2, L)], seg=seg, material=material)
    orient(ob, a, b)
    if bevel:
        add_bevel(ob, bevel, 1, angle=0.8)
    return ob


def ellipsoid(name, center, radii, material="Paint", seg=16, rings=10):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    bmesh.ops.scale(bm, vec=radii, verts=bm.verts)
    bmesh.ops.translate(bm, vec=center, verts=bm.verts)
    return _obj_from_bm(name, bm, material)


def box(name, center, size, material="Paint", bevel=0.0, segments=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    bmesh.ops.translate(bm, vec=center, verts=bm.verts)
    ob = _obj_from_bm(name, bm, material)
    if bevel > 0:
        add_bevel(ob, bevel, segments)
    return ob


def torus(name, center, R, r, material="Brass", seg=32, rseg=8, sx=1.0, sy=1.0):
    bm = bmesh.new()
    rings = []
    for i in range(seg):
        a = TAU * i / seg
        ring = []
        for k in range(rseg):
            b = TAU * k / rseg
            rr = R + math.cos(b) * r
            ring.append(bm.verts.new((center[0] + math.cos(a) * rr * sx, center[1] + math.sin(a) * rr * sy,
                                      center[2] + math.sin(b) * r)))
        rings.append(ring)
    for i in range(seg):
        a, b2 = rings[i], rings[(i + 1) % seg]
        for k in range(rseg):
            l = (k + 1) % rseg
            bm.faces.new((a[k], b2[k], b2[l], a[l]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj_from_bm(name, bm, material)


def tube(name, points, radii, material="Metal", seg=8, cap=True):
    """Rör längs en polylinje med radie per punkt (paralleltransporterade ramar)."""
    pts = [Vector(p) for p in points]
    if isinstance(radii, (int, float)):
        radii = [radii] * len(pts)
    bm = bmesh.new()
    rings = []
    t0 = (pts[1] - pts[0]).normalized()
    ref = Vector((0, 0, 1)) if abs(t0.z) < 0.9 else Vector((1, 0, 0))
    n = t0.cross(ref).normalized()
    for i, p in enumerate(pts):
        if i == 0:
            t = (pts[1] - pts[0]).normalized()
        elif i == len(pts) - 1:
            t = (pts[-1] - pts[-2]).normalized()
        else:
            t = (pts[i + 1] - pts[i - 1]).normalized()
        n = (n - t * n.dot(t)).normalized()
        b = t.cross(n)
        ring = [bm.verts.new(p + (n * math.cos(TAU * k / seg) + b * math.sin(TAU * k / seg)) * radii[i])
                for k in range(seg)]
        rings.append(ring)
    for i in range(len(rings) - 1):
        a, c = rings[i], rings[i + 1]
        for k in range(seg):
            l = (k + 1) % seg
            bm.faces.new((a[k], a[l], c[l], c[k]))
    if cap:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj_from_bm(name, bm, material)


def limb(name, a, b, ra, rb, material="Paint", seg=10, n=3):
    """Avsmalnande kapsel mellan punkterna a och b."""
    a, b = Vector(a), Vector(b)
    L = (b - a).length
    prof = []
    for i in range(n + 1):  # nedre halvklot
        t = -math.pi / 2 + (math.pi / 2) * i / n
        prof.append((ra * math.cos(t), ra * math.sin(t)))
    for i in range(1, n + 1):  # övre halvklot
        t = (math.pi / 2) * i / n
        prof.append((rb * math.cos(t), L + rb * math.sin(t)))
    prof[0] = (0.0, prof[0][1])
    prof[-1] = (0.0, prof[-1][1])
    ob = lathe(name, prof, seg=seg, material=material, cap_bottom=False, cap_top=False)
    orient(ob, a, b)
    return ob


def orient(ob, a, b):
    """Rikta ett objekt byggt längs +Z från origo så att det går från a till b."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    q = Vector((0, 0, 1)).rotation_difference(d)
    ob.data.transform(Matrix.Translation(a) @ q.to_matrix().to_4x4())


def prism(name, outline, thickness, material="Paint", axis="Y", center=(0, 0, 0), bevel=0.0, segments=2,
          taper=None, angle=0.6):
    """Extruderad 2D-kontur. outline = [(u, v), ...] i planet vinkelrätt mot axis.

    axis='Y': u->X, v->Z, extruderas längs Y (platta som vetter framåt, t.ex. sköld).
    axis='X': u->Y, v->Z, extruderas längs X (sidoprofil, t.ex. skrov eller kolv).
    axis='Z': u->X, v->Y, extruderas längs Z (liggande platta).
    """
    bm = bmesh.new()
    h = thickness / 2

    def P(u, v, w):
        if axis == "Y":
            return (center[0] + u, center[1] + w, center[2] + v)
        if axis == "X":
            return (center[0] + w, center[1] + u, center[2] + v)
        return (center[0] + u, center[1] + v, center[2] + w)

    front, back = [], []
    for (u, v) in outline:
        s = taper(u, v) if taper else 1.0
        front.append(bm.verts.new(P(u, v, -h * s)))
        back.append(bm.verts.new(P(u, v, h * s)))
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[j], front[i], back[i], back[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _obj_from_bm(name, bm, material)
    if bevel > 0:
        add_bevel(ob, bevel, segments, angle)
    return ob


def loft(name, sections, material="Paint", cap_start=True, cap_end=True, closed=True):
    """Yta genom tvärsnitt (lika många punkter i varje). sections = [[(x, y, z), ...], ...]."""
    bm = bmesh.new()
    rings = [[bm.verts.new(p) for p in s] for s in sections]
    n = len(sections[0])
    for i in range(len(rings) - 1):
        a, c = rings[i], rings[i + 1]
        for k in range(n if closed else n - 1):
            l = (k + 1) % n
            bm.faces.new((a[k], a[l], c[l], c[k]))
    if closed and cap_start:
        bm.faces.new(list(reversed(rings[0])))
    if closed and cap_end:
        bm.faces.new(rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj_from_bm(name, bm, material)


def rounded_rect(w, h, r, n=4, cx=0.0, cy=0.0):
    """Rundad rektangel som 2D-kontur moturs (n punkter per hörnbåge)."""
    pts = []
    r = min(r, w / 2 - 1e-4, h / 2 - 1e-4)
    for (ox, oy, a0) in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180),
                         (w / 2 - r, -h / 2 + r, 270)):
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cx + ox + r * math.cos(a), cy + oy + r * math.sin(a)))
    return pts


def plate(name, outline, z, material, uv_rect=None, bulge=0.0, grid=0, axis="Y", flip=False):
    """Tunn platta (en sida) av en 2D-kontur, med plana UV:er 0…1 över uv_rect = (u0, v0, u1, v1).
    axis='Y': konturen i XZ-planet på y = z (vetter mot -Y = framåt). bulge välver mitten mot betraktaren.
    grid > 0 ger ett inre rutnät (behövs för välvningen)."""
    bm = bmesh.new()
    u0, v0, u1, v1 = uv_rect or (min(p[0] for p in outline), min(p[1] for p in outline),
                                 max(p[0] for p in outline), max(p[1] for p in outline))

    def P(u, v):
        nu = (u - (u0 + u1) / 2) / ((u1 - u0) / 2)
        nv = (v - (v0 + v1) / 2) / ((v1 - v0) / 2)
        w = bulge * max(0.0, 1 - 0.5 * (nu * nu + nv * nv))
        if axis == "Y":
            return Vector((u, z - w, v))
        return Vector((u, v, z + w))

    if grid:
        # konturen som yttre ring + koncentriska krympta ringar mot mitten
        cx = sum(p[0] for p in outline) / len(outline)
        cy = sum(p[1] for p in outline) / len(outline)
        rings = []
        for k in range(grid + 1):
            s = 1 - k / (grid + 1)
            rings.append([bm.verts.new(P(cx + (p[0] - cx) * s, cy + (p[1] - cy) * s)) for p in outline])
        n = len(outline)
        for k in range(grid):
            a, c = rings[k], rings[k + 1]
            for i in range(n):
                j = (i + 1) % n
                bm.faces.new((a[i], a[j], c[j], c[i]))
        center = bm.verts.new(P(cx, cy))
        last = rings[-1]
        for i in range(n):
            bm.faces.new((last[i], last[(i + 1) % n], center))
    else:
        bm.faces.new([bm.verts.new(P(*p)) for p in outline])
    # normalen ska peka mot betraktaren (-Y) resp. uppåt (+Z)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    want = Vector((0, -1, 0)) if axis == "Y" else Vector((0, 0, 1))
    bm.normal_update()
    if sum((f.normal.dot(want) for f in bm.faces)) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    if flip:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    uvl = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for lp in f.loops:
            co = lp.vert.co
            u, v = (co.x, co.z) if axis == "Y" else (co.x, co.y)
            lp[uvl].uv = ((u - u0) / (u1 - u0), (v - v0) / (v1 - v0))
    return _obj_from_bm(name, bm, material)


# ---------------------------------------------------------------- modifierare och mesh-verktyg

def add_bevel(ob, width, segments=2, angle=0.6):
    m = ob.modifiers.new("Bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.angle_limit = angle
    m.harden_normals = False
    return m


def add_subsurf(ob, levels=1):
    m = ob.modifiers.new("Sub", "SUBSURF")
    m.levels = levels
    m.render_levels = levels
    return m


def add_solidify(ob, thickness, offset=0.0):
    m = ob.modifiers.new("Solid", "SOLIDIFY")
    m.thickness = thickness
    m.offset = offset
    m.use_even_offset = True
    return m


def apply_mods(ob):
    if ob.type != "MESH" or not ob.modifiers:
        return
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)


def smooth(ob, angle_deg=40):
    me = ob.data
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(angle_deg))


def mirror_x(ob, name=None):
    """Kopia speglad i X (vänster <-> höger)."""
    me = ob.data.copy()
    me.transform(Matrix.Scale(-1, 4, (1, 0, 0)))
    me.flip_normals()
    o2 = bpy.data.objects.new(name or ob.name + "_m", me)
    link(o2)
    for m in ob.modifiers:
        if m.type == "BEVEL":
            add_bevel(o2, m.width, m.segments, m.angle_limit)
    return o2


def transform(ob, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), pivot=(0, 0, 0)):
    """Baka in en transform i meshen (rot i grader, kring pivot)."""
    P = Matrix.Translation(Vector(pivot))
    R = Euler([math.radians(a) for a in rot], "XYZ").to_matrix().to_4x4()
    S = Matrix.Diagonal((*scale, 1))
    ob.data.transform(Matrix.Translation(Vector(loc)) @ P @ R @ S @ P.inverted())
    return ob


def join(objs, name):
    """Slå ihop objekt (modifierare appliceras först) till ett objekt med namnet name."""
    objs = [o for o in objs if o]
    for o in objs:
        apply_mods(o)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def set_origin(ob, point):
    """Flytta objektets origo (pivot) till point (världskoordinater) utan att meshen flyttar sig."""
    p = Vector(point)
    ob.data.transform(Matrix.Translation(-p))
    ob.location = p
    bpy.context.view_layer.update()
    return ob


def set_parent(child, parent):
    """Föräldra utan att barnet flyttar sig (världsmatrisen behålls)."""
    bpy.context.view_layer.update()  # annars är matrix_world inaktuell efter en ändrad location
    mw = child.matrix_world.copy()
    child.parent = parent
    child.matrix_world = mw
    return child


def tris(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = ob.evaluated_get(dg).to_mesh()
    me.calc_loop_triangles()
    n = len(me.loop_triangles)
    ob.evaluated_get(dg).to_mesh_clear()
    return n


def uv_tile(ob, tile):
    """Skala om en plattas UV (0…1 över ytan) till upprepningar: 1 UV-enhet = tile meter."""
    me = ob.data
    xs = [v.co.x for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    w, h = max(xs) - min(xs), max(zs) - min(zs)
    for d in me.uv_layers.active.data:
        d.uv = (d.uv[0] * w / tile, d.uv[1] * h / tile)


def uv_box(ob, scale=1.0):
    """Lådprojektion i meter (1 UV-enhet = 1/scale m)."""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            u, v = (co.x, co.y) if ax == 2 else (co.x, co.z) if ax == 1 else (co.y, co.z)
            uv[li].uv = (u * scale, v * scale)


def bake_ao(objs, distance):
    """Ambient occlusion (Cycles) i vertexfärgen COLOR_0 som gråskala (1 = öppet). Spelet kan multiplicera in den.
    Bakas per objekt men med alla objekt i scenen som skuggare."""
    import numpy as np
    sc = bpy.context.scene
    prev = sc.render.engine
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 32
    sc.cycles.device = "CPU"
    if sc.world is None:
        sc.world = bpy.data.worlds.new("bakeworld")
    sc.world.light_settings.distance = distance
    for ob in objs:
        if ob.type != "MESH":
            continue
        apply_mods(ob)
        me = ob.data
        for a in list(me.color_attributes):
            me.color_attributes.remove(a)
        col = me.color_attributes.new("Col", "BYTE_COLOR", "POINT")
        me.color_attributes.active_color = col
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")
        n = len(me.vertices)
        rgba = np.zeros(n * 4, dtype=np.float32)
        col.data.foreach_get("color", rgba)
        ao = rgba.reshape(-1, 4)[:, 0].copy()
        ao = np.clip(0.25 + 0.75 * ao, 0, 1)  # mjukare: inget blir helt svart
        out = np.stack([ao, ao, ao, np.ones(n)], 1).astype(np.float32).ravel()
        col.data.foreach_set("color", out)
    sc.render.engine = prev


# ---------------------------------------------------------------- export

def export_glb(path, roots, tangents=False, colors=True):
    """Exportera roots med alla barn. Modifierare appliceras, UV:er behålls (keep_uvs), vertexfärg följer med.
    Texturer bäddas in som JPEG (kvalitet 90); tangents=True för normalkartor bakade i Blender."""
    keep_uvs()
    sel = set()

    def walk(o):
        sel.add(o)
        for c in o.children:
            walk(c)

    for r in roots:
        walk(r)
    bpy.ops.object.select_all(action="DESELECT")
    for o in sel:
        o.select_set(True)
    bpy.context.view_layer.objects.active = roots[0]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path, use_selection=True, export_format="GLB", export_yup=True, export_apply=True,
        export_animations=False, export_materials="EXPORT", export_normals=True, export_texcoords=True,
        export_extras=True, export_vertex_color="ACTIVE" if colors else "NONE", export_image_format="JPEG",
        export_jpeg_quality=90, export_tangents=tangents,
    )


# ---------------------------------------------------------------- rendering för kontroll

def preview_setup(target=(0, 0, 0.1), dist=1.0, elev=22, azim=-35, lens=60, res=(800, 800), ground=0.0,
                  cycles=False, samples=96):
    """Varmt lampljus snett ovanifrån på ett papperslikt bord, svag kall fyllnad. cycles=True: Cycles på GPU
    med brusreducering (materialen syns som i exporten)."""
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    if cycles:
        import mats
        mats.cycles_gpu(samples)
        sc.cycles.use_denoising = True
        sc.cycles.denoiser = "OPENIMAGEDENOISE"
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"
    world = bpy.data.worlds.new("W")
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.06, 0.07, 0.09, 1)
    bg.inputs["Strength"].default_value = 0.25
    s = dist  # ljusen skalas med motivet
    key = bpy.data.objects.new("Key", bpy.data.lights.new("Key", "AREA"))
    key.data.energy = 140 * s * s
    key.data.size = 0.6 * s
    key.data.color = (1.0, 0.78, 0.52)
    key.location = (Vector(target) + Vector((-0.9, -1.0, 1.6)) * s)
    key.rotation_euler = (Vector(target) - key.location).to_track_quat("-Z", "Y").to_euler()
    link(key)
    fill = bpy.data.objects.new("Fill", bpy.data.lights.new("Fill", "AREA"))
    fill.data.energy = 30 * s * s
    fill.data.size = 1.5 * s
    fill.data.color = (0.6, 0.72, 1.0)
    fill.location = (Vector(target) + Vector((1.4, -0.4, 0.7)) * s)
    fill.rotation_euler = (Vector(target) - fill.location).to_track_quat("-Z", "Y").to_euler()
    link(fill)
    rim = bpy.data.objects.new("Rim", bpy.data.lights.new("Rim", "AREA"))
    rim.data.energy = 70 * s * s
    rim.data.size = 0.8 * s
    rim.data.color = (1.0, 0.9, 0.75)
    rim.location = (Vector(target) + Vector((0.6, 1.4, 1.0)) * s)
    rim.rotation_euler = (Vector(target) - rim.location).to_track_quat("-Z", "Y").to_euler()
    link(rim)
    gm = bpy.data.materials.new("PreviewGround")
    gm.use_nodes = True
    gb = gm.node_tree.nodes["Principled BSDF"]
    gb.inputs["Base Color"].default_value = srgb("#c8b78f")
    gb.inputs["Roughness"].default_value = 0.85
    bpy.ops.mesh.primitive_plane_add(size=40 * s, location=(target[0], target[1], ground - 0.0005))
    g = bpy.context.active_object
    g.name = "PreviewGround"
    g.data.materials.append(gm)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.lens = lens
    cam.data.clip_start = 0.002 * s
    cam.data.clip_end = 200 * s
    link(cam)
    sc.camera = cam
    set_cam(target, dist, elev, azim)
    return cam


def set_cam(target, dist, elev, azim):
    cam = bpy.context.scene.camera
    t = Vector(target)
    e, a = math.radians(elev), math.radians(azim)
    cam.location = t + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * dist
    cam.rotation_euler = (t - cam.location).to_track_quat("-Z", "Y").to_euler()


def render(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
