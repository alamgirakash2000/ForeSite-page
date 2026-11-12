// The 3D view: the testbed site and one logged ForeSite run (data/site.json + data/site.bin, written by
// tools/export_scene.py from the simulation). MuJoCo coordinates (x forward, y left, z up) are kept inside `root`,
// which is rotated so that z points up on screen.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { HAZARDS } from "./hazards.js";

const $ = (s, r = document) => r.querySelector(s);
const SEG_COLOR = { flat: "#5F6B77", ramp: "#B98D55", stairs: "#7FA7C9", site: "#76838F", slippery: "#3D8FC9", debris: "#A8663A" };
const SEG_NAME = { ramp: "ramp", stairs: "stair", corridor: "corridor", wet: "wet slab", debris: "debris", entrance: "gate", staging: "drop-off" };
const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4.5v14H6zM13.5 5H18v14h-4.5z"/></svg>';

async function fetchBuffer(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const total = +res.headers.get("content-length") || 0;
  if (!res.body || !total) { const b = await res.arrayBuffer(); onProgress?.(1); return b; }
  const reader = res.body.getReader(); const chunks = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length; onProgress?.(Math.min(1, got / total));
  }
  const out = new Uint8Array(got); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const LUT = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));

function buildGeometry(buf, mm) {
  const q = new Uint16Array(buf, mm.pos, mm.nv * 3), c8 = new Uint8Array(buf, mm.col, mm.nv * 3);
  const pos = new Float32Array(mm.nv * 3), col = new Float32Array(mm.nv * 3);
  for (let i = 0; i < mm.nv * 3; i++) {
    const k = i % 3;
    pos[i] = mm.lo[k] + (q[i] / 65535) * mm.ext[k];
    col[i] = LUT[c8[i]];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const idx = mm.idx32 ? new Uint32Array(buf, mm.idx, mm.nf * 3) : new Uint16Array(buf, mm.idx, mm.nf * 3);
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();   // shading stays flat, but the shadow lookup needs a normal on every vertex
  g.computeBoundingSphere();
  return g;
}

function makeCapsule(material) {
  const g = new THREE.Group();
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 14, 1, true), material);
  const s0 = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), material), s1 = s0.clone();
  g.add(cyl, s0, s1); g.userData = { cyl, s0, s1 };
  return g;
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function setCapsule(g, ax, ay, az, bx, by, bz, r) {
  _a.set(ax, ay, az); _b.set(bx, by, bz); _d.subVectors(_b, _a);
  const len = Math.max(_d.length(), 1e-4);
  g.position.addVectors(_a, _b).multiplyScalar(0.5);
  g.quaternion.setFromUnitVectors(_up, _d.divideScalar(len));
  const { cyl, s0, s1 } = g.userData;
  cyl.scale.set(r, len, r); s0.scale.setScalar(r); s1.scale.setScalar(r);
  s0.position.set(0, -len / 2, 0); s1.position.set(0, len / 2, 0);
}

export async function createExplorer({ onProgress } = {}) {
  const stage = $("#stage");
  const test = document.createElement("canvas");
  if (!(test.getContext("webgl2") || test.getContext("webgl"))) throw new Error("WebGL is not available");

  const [man, buf] = await Promise.all([
    fetch("data/site.json").then((r) => r.json()),
    fetchBuffer("data/site.bin", onProgress),
  ]);
  const N = man.frames, FPS = man.fps, NB = man.bodies.length, NC = man.ncaps, PS = man.pos_scale;
  const pose = new Int16Array(buf, man.pose, N * NB * 7);
  const sph = new Int16Array(buf, man.sph, N * 15 * 3);
  const caps = new Int16Array(buf, man.caps, N * NC * 7);
  const tele = new Float32Array(buf, man.tele, N * 6);
  const codes = new Uint8Array(buf, man.codes, N * 4);
  const DURATION = (N - 1) / FPS;
  const X0 = man.start_x, X1 = man.goal_x;

  // ------------------------------------------------------------------ renderer, scene, lights
  const small = matchMedia("(max-width: 700px), (pointer: coarse)").matches;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const renderer = new THREE.WebGLRenderer({ antialias: !small, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, small ? 1.5 : 2));
  renderer.shadowMap.enabled = !small; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  stage.prepend(renderer.domElement);
  renderer.domElement.setAttribute("aria-label", "3D view of the simulated construction site");

  const scene = new THREE.Scene();
  const SKY = new THREE.Color("#C6D8E6");
  scene.background = SKY; scene.fog = new THREE.Fog(SKY, 70, 260);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 600);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x9a958c, 1.25); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  sun.castShadow = !small; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.035;
  const sc = sun.shadow.camera; sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.near = 1; sc.far = 170; sc.updateProjectionMatrix(); let shadowHalf = 16;
  scene.add(sun, sun.target);

  const root = new THREE.Group(); root.rotation.x = -Math.PI / 2; scene.add(root);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshStandardMaterial({ color: "#A7A196", roughness: 1 }));
  ground.position.set(20, 0, -0.012); ground.receiveShadow = true; root.add(ground);

  const matOpts = { vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0.02 };
  const sharedMat = new THREE.MeshStandardMaterial(matOpts);
  const robotMat = new THREE.MeshStandardMaterial({ ...matOpts, roughness: 0.55 });
  const statics = {}, bodyMesh = [], hazardMesh = {};
  for (const mm of man.meshes) {
    const geo = buildGeometry(buf, mm);
    let mat = sharedMat;
    if (mm.name.startsWith("hazard:")) mat = new THREE.MeshStandardMaterial({ ...matOpts, emissive: new THREE.Color("#F26B21"), emissiveIntensity: 0 });
    else if (mm.name.startsWith("body:") && !mm.name.startsWith("body:mv")) mat = robotMat;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = mm.name !== "terrain"; mesh.receiveShadow = true;
    if (mm.name.startsWith("body:")) { bodyMesh[man.bodies.indexOf(mm.name.slice(5))] = mesh; mesh.frustumCulled = false; }
    else if (mm.name.startsWith("hazard:")) hazardMesh[+mm.name.slice(7)] = mesh;
    else statics[mm.name] = mesh;
    root.add(mesh);
  }
  const iPelvis = man.bodies.indexOf("pelvis");

  // ------------------------------------------------------------------ what the planner sees: spheres and capsules
  const planner = new THREE.Group(); planner.visible = false; root.add(planner);
  const sphMat = new THREE.MeshBasicMaterial({ color: "#2A7DC4", transparent: true, opacity: 0.42, depthWrite: false });
  const spheres = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 18, 12), sphMat, 15);
  spheres.frustumCulled = false; planner.add(spheres);
  const capFixed = new THREE.MeshBasicMaterial({ color: "#F26B21", transparent: true, opacity: 0.4, depthWrite: false });
  const capMove = new THREE.MeshBasicMaterial({ color: "#FFC61A", transparent: true, opacity: 0.5, depthWrite: false });
  for (const h of man.hazards) for (const c of h.capsules) { const g = makeCapsule(capFixed); setCapsule(g, ...c); planner.add(g); }
  const movingCaps = Array.from({ length: NC }, () => { const g = makeCapsule(capMove); planner.add(g); return g; });
  // first capsule of each moving hazard, to anchor its pin
  const capStart = {}; { let o = 0; for (const [kind, , n] of man.capinfo) { capStart[kind] = o; o += n; } }

  // ------------------------------------------------------------------ hazards: data, pins, ticks
  const hz = HAZARDS.map((h) => {
    const run = man.hazards.find((r) => r.id === h.id);
    return { ...h, run, moving: !!h.moving };
  });
  const pinsBox = $("#pins"), routebar = $("#routebar"), lane = $("#lane"), names = $("#names"), strip = $("#hzstrip");
  const fracOf = (x) => Math.min(1, Math.max(0, (x - X0) / (X1 - X0)));
  for (const s of man.route) {
    const a = Math.max(s.x0, X0), b = Math.min(s.x1, X1);
    if (b <= a) continue;
    const i = document.createElement("i");
    i.style.width = (100 * (b - a) / (X1 - X0)) + "%"; i.style.background = SEG_COLOR[s.kind] || SEG_COLOR.flat; i.title = s.what;
    lane.append(i);
    if (SEG_NAME[s.name]) { const n = document.createElement("span"); n.textContent = SEG_NAME[s.name]; n.style.left = (100 * fracOf((a + b) / 2)) + "%"; names.append(n); }
  }
  for (const h of hz) {
    const pin = document.createElement("button");
    pin.type = "button"; pin.className = "pin" + (h.moving ? " is-moving" : ""); pin.innerHTML = `<span>${h.id}</span>`;
    pin.setAttribute("aria-label", `Hazard ${h.id}: ${h.name}`);
    pin.addEventListener("click", () => api.selectHazard(h.id));
    pinsBox.append(pin); h.pin = pin;
    const tick = document.createElement("button");
    tick.type = "button"; tick.className = "tick" + (h.moving ? " is-moving" : ""); tick.textContent = h.id;
    tick.style.left = (100 * fracOf(h.x)) + "%"; tick.setAttribute("aria-label", `Jump to hazard ${h.id}: ${h.name}`);
    tick.addEventListener("click", (e) => { e.stopPropagation(); api.selectHazard(h.id); });
    tick.addEventListener("pointerdown", (e) => e.stopPropagation());
    routebar.append(tick); h.tick = tick;
    // on small screens the ticks are too close to tap, so the same letters also sit in a row that scrolls
    const chip = document.createElement("button");
    chip.type = "button"; chip.className = "chip" + (h.moving ? " is-moving" : ""); chip.textContent = h.id;
    chip.setAttribute("aria-label", `Jump to hazard ${h.id}: ${h.name}`);
    chip.addEventListener("click", () => api.selectHazard(h.id));
    strip.append(chip); h.chip = chip;
    h.anchor = new THREE.Vector3();
    if (!h.moving && h.run?.capsules?.length) {
      const c = h.run.capsules[0];
      h.anchor.set((c[0] + c[3]) / 2, (c[1] + c[4]) / 2, Math.max(c[2], c[5]) + c[6] + 0.3);
    }
  }

  // ------------------------------------------------------------------ camera
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.09; controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 1.3; controls.maxDistance = 95; controls.zoomSpeed = 0.9;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  const mj = (x, y, z) => new THREE.Vector3(x, z, -y);
  const PRESET = {
    site: { track: false, target: mj(21, 0, 1.2), offset: mj(-21, -25, 15), cut: false },
    chase: { track: true, offset: mj(-3.1, 1.25, 1.15) },
    side: { track: true, offset: mj(0.7, -5.4, 0.8) },
    top: { track: true, offset: mj(-0.6, 0, 11.5), cut: true },
  };
  let cam = "site", tracking = false, fly = null;
  const camButtons = [...document.querySelectorAll("[data-cam]")];
  const robotTarget = new THREE.Vector3();
  function setCamera(name, instant = false) {
    const p = PRESET[name]; cam = name; tracking = p.track;
    for (const b of camButtons) b.setAttribute("aria-pressed", String(b.dataset.cam === name));
    if (p.cut !== undefined) { cutBox.checked = p.cut; applyToggles(); }
    const target = p.track ? robotTarget.clone() : p.target.clone();
    fly = { target, offset: p.offset.clone(), t: instant ? 1 : 0 };
    controls.autoRotate = false;
  }
  camButtons.forEach((b) => b.addEventListener("click", () => setCamera(b.dataset.cam)));
  controls.addEventListener("start", () => { fly = null; controls.autoRotate = false; });

  // ------------------------------------------------------------------ toggles
  const plannerBox = $("#t-planner"), cutBox = $("#t-cut"), pinsToggle = $("#t-pins"), decorBox = $("#t-decor");
  function applyToggles() {
    planner.visible = plannerBox.checked;
    if (statics.decor_high) statics.decor_high.visible = decorBox.checked && !cutBox.checked;
    if (statics.decor_low) statics.decor_low.visible = decorBox.checked;
    if (statics.props) statics.props.visible = decorBox.checked;
    pinsBox.style.display = pinsToggle.checked ? "" : "none";
    robotMat.transparent = plannerBox.checked; robotMat.opacity = plannerBox.checked ? 0.55 : 1; robotMat.needsUpdate = true;
  }
  [plannerBox, cutBox, pinsToggle, decorBox].forEach((b) => b.addEventListener("change", applyToggles));

  // ------------------------------------------------------------------ playback
  let t = 0, playing = false, rate = 2, selected = null;
  const playBtn = $("#play"), rateBtn = $("#rate"), knob = $("#knob"), done = $("#done"), chips = $("#chips");
  const rDist = $("#r-dist"), rTime = $("#r-time"), rSpeed = $("#r-speed"), rGap = $("#r-gap"), card = $("#hzcard");
  const setPlaying = (p) => {
    playing = p; playBtn.innerHTML = p ? ICON_PAUSE : ICON_PLAY; playBtn.setAttribute("aria-label", p ? "Pause" : "Play");
  };
  playBtn.addEventListener("click", () => { if (!playing && t >= DURATION - 0.05) t = 0; if (!playing && cam === "site") setCamera("chase"); setPlaying(!playing); });
  rateBtn.addEventListener("click", () => { rate = rate === 1 ? 2 : rate === 2 ? 4 : 1; rateBtn.textContent = rate + "×"; });
  const xAt = (i) => tele[i * 6];
  function timeForX(x) {                       // first frame where the robot has reached x
    let lo = 0, hi = N - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (xAt(mid) < x) lo = mid + 1; else hi = mid; }
    return lo / FPS;
  }
  function scrub(e) {
    const r = routebar.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    t = timeForX(X0 + f * (X1 - X0)); if (cam === "site") setCamera("chase");
  }
  routebar.addEventListener("pointerdown", (e) => { routebar.setPointerCapture(e.pointerId); scrub(e); routebar.onpointermove = scrub; });
  const endScrub = () => (routebar.onpointermove = null);
  routebar.addEventListener("pointerup", endScrub); routebar.addEventListener("pointercancel", endScrub);
  routebar.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") t = Math.min(DURATION, t + 2); else if (e.key === "ArrowLeft") t = Math.max(0, t - 2);
    else if (e.key === " " || e.key === "Enter") playBtn.click(); else return;
    e.preventDefault();
  });

  function showCard(h) {
    const r = h.run || {};
    const gap = r.min_gap != null ? `${Math.round(r.min_gap * 100)} cm` : "not reached";
    const move = h.moving ? "" : ` The body moved by up to ${Math.round(r.peak[0])}° of twist, ${Math.round(r.peak[1])}° of bend and ${Math.round(r.peak[2])} cm of squat.`;
    card.className = "hz-card" + (h.moving ? " is-moving" : "");
    card.innerHTML = `<h4><em>${h.id}</em>${h.name}</h4>
      <p>${h.type}, ${h.height} m above the walkway, at ${h.x.toFixed(1)} m.</p>
      <p><b>What it calls for.</b> ${h.response}</p>
      <p><b>In this run.</b> ${r.hit ? "Hit." : "Cleared."} Closest gap ${gap}.${move}</p>`;
  }

  // ------------------------------------------------------------------ one frame of the run
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), m4 = new THREE.Matrix4(), v3 = new THREE.Vector3();
  const pelvisNow = new THREE.Vector3();
  let lastChip = "";
  function applyFrame() {
    const f = Math.min(N - 1, Math.max(0, t * FPS)), i0 = Math.floor(f), i1 = Math.min(N - 1, i0 + 1), a = f - i0;
    for (let b = 0; b < NB; b++) {
      const m = bodyMesh[b]; if (!m) continue;
      const o0 = (i0 * NB + b) * 7, o1 = (i1 * NB + b) * 7;
      m.position.set((pose[o0] + (pose[o1] - pose[o0]) * a) / PS, (pose[o0 + 1] + (pose[o1 + 1] - pose[o0 + 1]) * a) / PS,
        (pose[o0 + 2] + (pose[o1 + 2] - pose[o0 + 2]) * a) / PS);
      qa.set(pose[o0 + 4], pose[o0 + 5], pose[o0 + 6], pose[o0 + 3]); qb.set(pose[o1 + 4], pose[o1 + 5], pose[o1 + 6], pose[o1 + 3]);
      m.quaternion.copy(qa).slerp(qb.normalize(), a).normalize();
    }
    pelvisNow.copy(bodyMesh[iPelvis].position);
    robotTarget.set(pelvisNow.x, pelvisNow.z + 0.12, -pelvisNow.y);
    if (planner.visible) {
      for (let s = 0; s < 15; s++) {
        const o0 = (i0 * 15 + s) * 3, o1 = (i1 * 15 + s) * 3, r = man.radii[s];
        v3.set((sph[o0] + (sph[o1] - sph[o0]) * a) / PS, (sph[o0 + 1] + (sph[o1 + 1] - sph[o0 + 1]) * a) / PS, (sph[o0 + 2] + (sph[o1 + 2] - sph[o0 + 2]) * a) / PS);
        m4.makeScale(r, r, r).setPosition(v3); spheres.setMatrixAt(s, m4);
      }
      spheres.instanceMatrix.needsUpdate = true;
      for (let c = 0; c < NC; c++) {
        const o = (i0 * NC + c) * 7, g = movingCaps[c];
        if (caps[o] === -32768) { g.visible = false; continue; }
        g.visible = true;
        setCapsule(g, caps[o] / PS, caps[o + 1] / PS, caps[o + 2] / PS, caps[o + 3] / PS, caps[o + 4] / PS, caps[o + 5] / PS, caps[o + 6] / PS);
      }
    }
    // pins of the moving hazards follow their first capsule
    for (const h of hz) if (h.moving) {
      const kind = h.run?.kind, o = (i0 * NC + (capStart[kind] ?? 0)) * 7;
      if (caps[o] !== -32768) h.anchor.set((caps[o] + caps[o + 3]) / 2 / PS, (caps[o + 1] + caps[o + 4]) / 2 / PS, Math.max(caps[o + 2], caps[o + 5]) / PS + 0.45);
    }
    // read-outs
    const x = tele[i0 * 6], vx = tele[i0 * 6 + 1], gap = tele[i0 * 6 + 5];
    rDist.firstChild.nodeValue = Math.max(0, x - X0).toFixed(1); rTime.firstChild.nodeValue = t.toFixed(1); rSpeed.firstChild.nodeValue = vx.toFixed(2);
    rGap.textContent = gap < 3 ? Math.round(gap * 100) + " cm" : "–";
    const fr = fracOf(x); knob.style.left = (fr * 100) + "%"; done.style.width = (fr * 100) + "%";
    routebar.setAttribute("aria-valuenow", (x - X0).toFixed(1));
    const seg = man.route.find((s) => x >= s.x0 && x < s.x1) || man.route[man.route.length - 1];
    const dodge = man.vocab.dodge[codes[i0 * 4]];
    let speed = "go"; if (vx < 0.05) speed = "wait"; else if (vx < 0.8 * seg.vx) speed = "slow";
    if (t < 1.6 || t > DURATION - 0.4) speed = "";
    const duck = dodge && dodge !== "-" && dodge !== "stay upright";
    const key = speed + "|" + (duck ? dodge : "") + "|" + seg.name;
    if (key !== lastChip) {
      lastChip = key;
      chips.innerHTML = (speed ? `<span class="chip ${speed}">${speed.toUpperCase()}</span>` : "")
        + (duck ? `<span class="chip duck">DUCK</span><span class="chip plain">${dodge}</span>` : "")
        + `<span class="chip plain">${SEG_NAME[seg.name] || seg.surface}</span>`;
    }
  }

  // ------------------------------------------------------------------ pins on screen
  function placePins(w, h) {
    if (!pinsToggle.checked) return;
    for (const hzd of hz) {
      v3.set(hzd.anchor.x, hzd.anchor.z, -hzd.anchor.y);
      const dist = v3.distanceTo(camera.position);
      v3.project(camera);
      const show = v3.z < 1 && v3.z > -1 && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05 && (dist < 34 || cam === "site" || hzd === selected);
      hzd.pin.style.display = show ? "" : "none";
      if (show) hzd.pin.style.translate = `${((v3.x + 1) / 2 * w).toFixed(1)}px ${((1 - v3.y) / 2 * h).toFixed(1)}px`;
    }
  }

  // ------------------------------------------------------------------ loop
  let visible = true, last = performance.now(), W = 0, H = 0;
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { threshold: 0.02 }).observe(stage);
  function resize() {
    const r = stage.getBoundingClientRect(); W = Math.max(2, r.width); H = Math.max(2, r.height);
    renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage); resize();
  const tmp = new THREE.Vector3();
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!visible) return;
    if (playing) { t += dt * rate; if (t >= DURATION) { t = DURATION; setPlaying(false); } }
    applyFrame();
    if (fly) {
      fly.t = Math.min(1, fly.t + dt / 0.9);
      const k = 1 - Math.pow(1 - fly.t, 3);
      if (tracking) fly.target.copy(robotTarget);
      controls.target.lerp(fly.target, k); camera.position.lerp(tmp.copy(fly.target).add(fly.offset), k);
      if (fly.t >= 1) fly = null;
    } else if (tracking) {
      tmp.subVectors(robotTarget, controls.target).multiplyScalar(Math.min(1, dt * 6));
      controls.target.add(tmp); camera.position.add(tmp);
    }
    controls.update();
    sun.target.position.copy(controls.target); sun.position.copy(controls.target).add(tmp.set(-28, 52, 24)); sun.target.updateMatrixWorld();
    // the shadow area grows when the camera pulls back, so the whole-site view is shaded too
    const half = Math.max(11, Math.min(48, camera.position.distanceTo(controls.target) * 0.8));
    if (Math.abs(half - shadowHalf) > 0.08 * shadowHalf) { shadowHalf = half; sc.left = sc.bottom = -half; sc.right = sc.top = half; sc.updateProjectionMatrix(); }
    const pulse = 0.35 + 0.3 * Math.sin(now / 260);
    for (const k in hazardMesh) hazardMesh[k].material.emissiveIntensity = selected && selected.run && selected.run.index === +k ? pulse : 0;
    renderer.render(scene, camera);
    placePins(W, H);
  }

  const api = {
    play() { if (cam === "site") setCamera("chase"); setPlaying(true); },
    pause() { setPlaying(false); },
    selectHazard(id) {
      const h = hz.find((q) => q.id === id); if (!h) return;
      selected = h;
      for (const q of hz) { q.pin.classList.toggle("is-on", q === h); q.tick.classList.toggle("is-on", q === h); q.chip.classList.toggle("is-on", q === h); }
      if (strip.clientWidth) strip.scrollTo({ left: h.chip.offsetLeft - strip.offsetLeft - strip.clientWidth / 2 + 20, behavior: "smooth" });
      showCard(h);
      t = Math.max(0, timeForX(h.x - (h.moving ? 3.2 : 2.4)));
      if (cam === "site") setCamera("chase"); else if (tracking) fly = { target: robotTarget.clone(), offset: PRESET[cam].offset.clone(), t: 0.4 };
    },
  };

  applyToggles(); applyFrame(); setCamera("site", true);
  controls.target.copy(PRESET.site.target); camera.position.copy(PRESET.site.target).add(PRESET.site.offset); fly = null;
  controls.autoRotate = !reduceMotion; controls.autoRotateSpeed = 0.55;
  $("#stage .poster")?.remove();
  requestAnimationFrame(tick);
  return api;
}
