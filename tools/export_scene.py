"""Export the ForeSite testbed scene and one logged run for the website's 3D replay (docs/data/site.json + site.bin)."""
import sys, json, warnings, collections
warnings.filterwarnings("ignore")
import numpy as np, mujoco, trimesh, fast_simplification
from scipy.spatial import cKDTree
from foresite.avoidance import make_sim
from testbed.scene import SurfaceParams
from testbed import realsite

SEED = int(sys.argv[1]); RUN = sys.argv[2]; OUT = sys.argv[3]
sim = make_sim(mode="foresite", surfaces=["realsite"], payload_kg=4.1, hazards="all",
               moving_kinds=["crane", "worker", "arm", "falling"], seed=SEED, params=SurfaceParams(), randomize=True,
               continue_after_fall=True, contact=False, grip_limit=None)
m = sim.model
d = mujoco.MjData(m); mujoco.mj_forward(m, d)
G = mujoco.mjtGeom
gname = lambda i: mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_GEOM, i) or ""
bname = lambda i: mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_BODY, i) or ""

def quat2mat(q):
    R = np.zeros(9); mujoco.mju_quat2Mat(R, np.asarray(q, float)); return R.reshape(3, 3)

def tex_image(tid):
    h, w, nc = m.tex_height[tid], m.tex_width[tid], m.tex_nchannel[tid]
    a = m.tex_adr[tid]
    return np.asarray(m.tex_data[a:a + h * w * nc]).reshape(h, w, nc)[..., :3].astype(np.float32) / 255.0

def geom_color(i):
    mid = m.geom_matid[i]
    rgba = m.mat_rgba[mid] if mid >= 0 else m.geom_rgba[i]
    return np.array(rgba[:3], np.float32), float(rgba[3]), mid

def geom_mesh(i):
    """Triangles of geom i in its body frame, with a colour per vertex."""
    t = int(m.geom_type[i]); s = m.geom_size[i]
    rgb, alpha, mid = geom_color(i)
    cols = None
    if t == G.mjGEOM_BOX:
        tm = trimesh.creation.box(extents=2 * s); V, F = tm.vertices, tm.faces
    elif t == G.mjGEOM_SPHERE:
        tm = trimesh.creation.icosphere(subdivisions=2, radius=s[0]); V, F = tm.vertices, tm.faces
    elif t == G.mjGEOM_ELLIPSOID:
        tm = trimesh.creation.icosphere(subdivisions=2, radius=1.0); V, F = tm.vertices * s, tm.faces
    elif t == G.mjGEOM_CAPSULE:
        tm = trimesh.creation.capsule(radius=s[0], height=2 * s[1], count=[10, 6]); V, F = tm.vertices, tm.faces
    elif t == G.mjGEOM_CYLINDER:
        tm = trimesh.creation.cylinder(radius=s[0], height=2 * s[1], sections=14); V, F = tm.vertices, tm.faces
    elif t == G.mjGEOM_MESH:
        k = m.geom_dataid[i]
        va, vn, fa, fn = m.mesh_vertadr[k], m.mesh_vertnum[k], m.mesh_faceadr[k], m.mesh_facenum[k]
        V = np.array(m.mesh_vert[va:va + vn], float); F = np.array(m.mesh_face[fa:fa + fn])
        texid = -1
        if mid >= 0:
            tx = np.atleast_1d(m.mat_texid[mid]); tx = tx[tx >= 0]
            texid = int(tx[0]) if len(tx) else -1
        if texid >= 0 and m.mesh_texcoordadr[k] >= 0:
            ta = m.mesh_texcoordadr[k]; tn = m.mesh_texcoordnum[k]
            uv = np.array(m.mesh_texcoord[ta:ta + tn]); ft = np.array(m.mesh_facetexcoord[fa:fa + fn])
            img = tex_image(texid); H, W = img.shape[:2]
            uvv = np.zeros((vn, 2)); uvv[F.reshape(-1)] = uv[ft.reshape(-1)]
            px = np.clip((uvv[:, 0] % 1.0) * (W - 1), 0, W - 1).astype(int)
            py = np.clip(((1 - uvv[:, 1]) % 1.0) * (H - 1), 0, H - 1).astype(int)
            # average a small patch so one dark texel does not colour a whole face
            pad = 3; acc = np.zeros((vn, 3), np.float32)
            for dx in (-pad, 0, pad):
                for dy in (-pad, 0, pad):
                    acc += img[np.clip(py + dy, 0, H - 1), np.clip(px + dx, 0, W - 1)]
            cols = acc / 9.0 * rgb
    else:
        return None
    V = np.asarray(V, float); F = np.asarray(F, np.int64)
    if cols is None:
        cols = np.tile(rgb, (len(V), 1))
    R = quat2mat(m.geom_quat[i])
    V = V @ R.T + m.geom_pos[i]
    return V, F, cols.astype(np.float32), alpha

def decimate(V, F, C, target):
    if len(F) <= target:
        return V, F, C
    V2, F2 = fast_simplification.simplify(V.astype(np.float32), F.astype(np.int32), target_count=int(target), agg=7)
    if len(F2) < 4:
        return V, F, C
    idx = cKDTree(V).query(V2)[1]
    return V2.astype(float), F2.astype(np.int64), C[idx]

def merge(parts):
    Vs, Fs, Cs, n = [], [], [], 0
    for V, F, C in parts:
        Vs.append(V); Fs.append(F + n); Cs.append(C); n += len(V)
    return np.concatenate(Vs), np.concatenate(Fs), np.concatenate(Cs)

# ---------------------------------------------------------------- classify the geoms
hz = sim.hazards.hazards
fixed = [h for h in hz if not getattr(h, "moving", False)]
fixed_x = np.array([h.x for h in fixed])
is_dynamic_body = lambda b: m.body_mocapid[b] >= 0 or m.body_dofnum[m.body_rootid[b]] > 0 or m.body_weldid[b] != 0 \
    if False else (m.body_weldid[b] != 0)
buckets = collections.defaultdict(list)          # name -> [(V, F, C)] in world or body frame
alpha_of = {}
budget = dict(robot=1100, prop_big=2200, prop_small=1500, fence=900)
for i in range(m.ngeom):
    grp = int(m.geom_group[i]); b = int(m.geom_bodyid[i]); bn = bname(b); gn = gname(i)
    t = int(m.geom_type[i])
    if t == G.mjGEOM_PLANE:
        continue
    robot_body = (b != 0) and not bn.startswith(("mv", "prop_", "payload"))
    if robot_body and grp != 1:
        continue                                   # collision shapes of the robot
    gm = geom_mesh(i)
    if gm is None:
        continue
    V, F, C, alpha = gm
    static = m.body_weldid[b] == 0                 # welded to the world: fixed in place
    if static:
        V = V @ d.xmat[b].reshape(3, 3).T + d.xpos[b]
    if robot_body:
        V, F, C = decimate(V, F, C, budget["robot"]); key = "body:" + bn
    elif bn == "payload":
        key = "body:payload"
    elif bn.startswith("mv"):
        key = "body:" + bn
    elif bn.startswith("prop_"):
        big = len(F) > 6000
        tgt = budget["fence"] if "fence" in bn else (budget["prop_big"] if big else budget["prop_small"])
        if "fence" in bn and len(F) < 60:
            pass
        V, F, C = decimate(V, F, C, tgt); key = "props"
    elif grp == 2:
        key = "terrain"
    elif grp == 4 and gn.startswith("hz_"):
        cx = V[:, 0].mean(); j = int(np.argmin(np.abs(fixed_x - cx)))
        key = f"hazard:{hz.index(fixed[j])}"
    elif grp == 3:
        key = "decor"
    else:
        key = "misc"
    if alpha < 0.99:
        alpha_of[key] = alpha
    buckets[key].append((V, F, C))

# split the decoration: what is above the walkway ceiling can be hidden (cutaway view)
CUT_Z = float(realsite.DECK_Z) + 2.55
Vd, Fd, Cd = merge(buckets.pop("decor"))
cz = Vd[Fd][:, :, 2].mean(1)
def sub(V, F, C, mask):
    Fm = F[mask]; used = np.unique(Fm); remap = -np.ones(len(V), np.int64); remap[used] = np.arange(len(used))
    return V[used], remap[Fm], C[used]
buckets["decor_low"] = [sub(Vd, Fd, Cd, cz <= CUT_Z)]
buckets["decor_high"] = [sub(Vd, Fd, Cd, cz > CUT_Z)]

# ---------------------------------------------------------------- write the meshes
blob = bytearray(); meshes = []
def put(arr):
    off = len(blob); blob.extend(arr.tobytes())
    while len(blob) % 4: blob.append(0)
    return off
for key in sorted(buckets):
    V, F, C = merge(buckets[key])
    lo, hi = V.min(0), V.max(0); ext = np.maximum(hi - lo, 1e-6)
    q = np.round((V - lo) / ext * 65535).astype(np.uint16)
    c8 = np.clip(np.round(np.clip(C, 0, 1) ** (1 / 1.0) * 255), 0, 255).astype(np.uint8)
    idx = F.astype(np.uint32 if len(V) > 65535 else np.uint16).reshape(-1)
    meshes.append(dict(name=key, nv=int(len(V)), nf=int(len(F)), lo=lo.round(5).tolist(), ext=ext.round(5).tolist(),
                       pos=put(q), col=put(c8), idx=put(idx), idx32=bool(len(V) > 65535), alpha=alpha_of.get(key, 1.0)))
    print(f"{key:28s} verts {len(V):7d} faces {len(F):7d}")

# ---------------------------------------------------------------- the logged run
run = np.load(RUN, allow_pickle=True)
meta = json.loads(str(run["meta"]))
STEP = 2                                           # 25 Hz -> 12.5 Hz
T = run["t"][::STEP]; n = len(T)
dyn = [k[5:] for k in sorted(buckets) if k.startswith("body:")]
bid = [mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, b) for b in dyn]
P = run["xpos"][::STEP][:, bid]; Q = run["xquat"][::STEP][:, bid]         # wxyz
# keep the quaternion sign continuous for interpolation
for k in range(1, n):
    flip = (Q[k] * Q[k - 1]).sum(-1) < 0; Q[k][flip] *= -1
POS_SCALE = 500.0
pose = np.concatenate([np.round(P * POS_SCALE), np.round(Q * 32767)], -1).astype(np.int16)   # n, nb, 7
sph = np.round(run["sph"][::STEP] * POS_SCALE).astype(np.int16)
caps = run["caps"][::STEP].copy()
caps_q = np.where(np.isnan(caps), -32768, np.round(caps * POS_SCALE)).astype(np.int16)
cmd = run["cmd"][::STEP]
gaps = run["gaps"][::STEP]; mingap = np.nanmin(np.where(np.isnan(gaps), np.inf, gaps), 1); mingap[~np.isfinite(mingap)] = 9.99
S = [dict(json.loads(s)) for s in run["status"][::STEP]]
dodge_vocab = sorted(set(s.get("Dodge move", "-") for s in S)); ahead_vocab = sorted(set(s.get("Ahead") or "" for s in S))
surf_vocab = sorted(set(s.get("Surface", "") for s in S))
tele = np.stack([run["x"][::STEP], cmd[:, 0], cmd[:, 1], cmd[:, 2], cmd[:, 3], np.clip(mingap, -1, 9.99)], 1).astype(np.float32)
codes = np.stack([[dodge_vocab.index(s.get("Dodge move", "-")) for s in S],
                  [ahead_vocab.index(s.get("Ahead") or "") for s in S],
                  [surf_vocab.index(s.get("Surface", "")) for s in S],
                  ["BALANCE" in s.get("Posture layer", "") for s in S]], 1).astype(np.uint8)

LETTERS = {6.2: "A", 11.0: "B", 17.7: "C", 19.5: "D", 21.3: "E", 23.1: "F", 24.9: "G", 26.7: "H", 28.5: "I", 30.3: "J",
           32.0: "K", 34.8: "L", 38.6: "M", 40.2: "N", 42.6: "O"}
hazards = []
for k, h in enumerate(meta["hazards"]):
    key = f"hazard:{k}"
    bb = None
    for mm in meshes:
        if mm["name"] == key:
            bb = [(np.array(mm["lo"]) + np.array(mm["ext"]) / 2).round(3).tolist(), mm["ext"]]
    hazards.append(dict(id=LETTERS[round(h["x"], 1)], index=k, kind=h["kind"], label=h["label"], x=h["x"], moving=h["moving"],
                        hit=h["hit"], min_gap=h["min_gap"], peak=[round(v, 1) for v in h["peak"]],
                        capsules=[[round(v, 4) for v in c] for c in h["capsules"]] if not h["moving"] else [],
                        center=bb[0] if bb else None))
vx_of = {s.name: float(s.vx) for s in sim.course.segments}
route = [dict(name=s.name, kind=s.kind, x0=float(s.x0), x1=float(s.x1), z=float(s.z), surface=s.surface, what=s.what,
              vx=vx_of.get(s.name, 0.5)) for s in realsite.ROUTE]
manifest = dict(seed=SEED, mode="foresite", result=meta["result"], fps=25.0 / STEP, frames=int(n), pos_scale=POS_SCALE,
                bodies=dyn, meshes=meshes, radii=meta["radii"], capinfo=meta["capinfo"], ncaps=int(caps.shape[1]),
                pose=put(pose), sph=put(sph), caps=put(caps_q), tele=put(tele), codes=put(codes),
                time=put(T.astype(np.float32)), vocab=dict(dodge=dodge_vocab, ahead=ahead_vocab, surface=surf_vocab),
                hazards=hazards, route=route, deck_z=float(realsite.DECK_Z), cut_z=CUT_Z, goal_x=float(realsite.GOAL_X),
                start_x=float(realsite.START_X))
open(OUT + "/site.bin", "wb").write(bytes(blob))
json.dump(manifest, open(OUT + "/site.json", "w"), separators=(",", ":"))
print("bodies", len(dyn), "frames", n, "bin MB", round(len(blob) / 1e6, 2), "tris", sum(mm["nf"] for mm in meshes))
