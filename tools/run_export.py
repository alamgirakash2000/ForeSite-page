"""Run ForeSite on the full route and record, at 25 Hz, what the website's 3D replay needs:
body poses, body spheres, moving-hazard capsules, the command and the status text."""
import sys, json, time, warnings
warnings.filterwarnings("ignore")
import numpy as np, mujoco
from foresite.avoidance import make_sim
from testbed.scene import SurfaceParams
from testbed.cli import print_summary
from testbed.robot import BodySpheres

seed = int(sys.argv[1]); out = sys.argv[2]; mode = sys.argv[3] if len(sys.argv) > 3 else "foresite"
sim = make_sim(mode=mode, surfaces=["realsite"], payload_kg=4.1, hazards="all",
               moving_kinds=["crane", "worker", "arm", "falling"], seed=seed, params=SurfaceParams(), randomize=True,
               continue_after_fall=True, contact=False, grip_limit=None)
spheres = BodySpheres(sim.model)
rec = dict(t=[], xpos=[], xquat=[], sph=[], caps=[], cmd=[], x=[], status=[], gaps=[])
orig = sim._record_frame

def record(t=None):
    orig(t)
    d = sim.data
    rec["t"].append(sim.t if t is None else t)
    rec["xpos"].append(d.xpos.copy()); rec["xquat"].append(d.xquat.copy())
    rec["sph"].append(spheres.centers(d))
    caps = []
    for h in sim.hazards.moving:
        for c in h.capsules:
            caps.append([*c.a, *c.b, c.radius])
    rec["caps"].append(caps)
    c = sim.cmd
    rec["cmd"].append([c.vx, c.height, c.waist_yaw, c.waist_pitch])
    rec["x"].append(sim.x)
    rec["status"].append(json.dumps(sim.status_lines()))
    g = sim.meter.last_gaps if sim.meter is not None else None
    rec["gaps"].append(np.full(15, np.nan) if g is None else np.asarray(g, float))

sim._record_frame = record
sim.start_recording(hz=25)
t0 = time.time(); sim.run_headless(); print("ran in", round(time.time() - t0, 1), "s", flush=True)
print_summary(sim, f"{mode} seed {seed}")
ncap = max(len(c) for c in rec["caps"])
caps = np.full((len(rec["caps"]), ncap, 7), np.nan)
for i, c in enumerate(rec["caps"]):
    if c: caps[i, :len(c)] = c
capinfo = [(h.kind, h.label, len(h.capsules)) for h in sim.hazards.moving]
fixed = [dict(kind=h.kind, label=h.label, x=float(h.x), hit=bool(h.hit), min_gap=float(h.min_gap) if np.isfinite(h.min_gap) else None,
              peak=[float(v) for v in h.peak], moving=bool(getattr(h, "moving", False)),
              capsules=[[*map(float, c.a), *map(float, c.b), float(c.radius)] for c in h.capsules]) for h in sim.hazards.hazards]
r = sim.result
np.savez_compressed(out, t=np.array(rec["t"]), xpos=np.array(rec["xpos"], np.float32), xquat=np.array(rec["xquat"], np.float32),
                    sph=np.array(rec["sph"], np.float32), caps=caps.astype(np.float32), cmd=np.array(rec["cmd"], np.float32),
                    x=np.array(rec["x"]), status=np.array(rec["status"]), gaps=np.array(rec["gaps"], np.float32),
                    meta=np.array(json.dumps(dict(seed=seed, mode=mode, capinfo=capinfo, hazards=fixed, radii=spheres.radii.tolist(),
                                                  result=dict(success=bool(r.success), falls=int(r.falls), time=float(r.time),
                                                              stopped=float(r.stopped_time), dropped=bool(r.payload_dropped))))))
print("saved", out)
