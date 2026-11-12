// Page behaviour: top bar, clips that play while visible, bars, the hazard table, copy buttons, and the 3D view.
import { HAZARDS } from "./hazards.js";

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---- top bar turns solid after the hero
const topbar = $("#topbar");
const onScroll = () => topbar.classList.toggle("is-solid", scrollY > innerHeight * 0.55);
addEventListener("scroll", onScroll, { passive: true }); onScroll();

// ---- hero video: the size that fits this screen. A still image stays if the visitor asked for less motion or data.
const hero = $(".hero-video");
if (hero && !reduceMotion && !navigator.connection?.saveData) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const need = Math.max(innerWidth * dpr, innerHeight * dpr * 16 / 9);      // width in pixels of a 16:9 frame that covers the hero
  const phone = matchMedia("(max-width: 820px)").matches, slow = /2g|3g/.test(navigator.connection?.effectiveType || "");
  const size = slow ? 720 : phone ? 1080 : need >= 1900 ? 1440 : need >= 1150 ? 1080 : 720;
  hero.src = hero.canPlayType('video/webm; codecs="vp9"') ? `media/video/hero_site_${size}.webm` : "media/video/hero_site_720.mp4";
  hero.play().catch(() => {});
}

// ---- clips load and play only while they are on screen
const clipObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const v = e.target;
    if (e.isIntersecting && !reduceMotion) { v.preload = "auto"; v.play().catch(() => {}); }
    else v.pause();
  }
}, { threshold: 0.35 });
for (const v of $$("video[data-auto]")) {
  clipObserver.observe(v);
  v.addEventListener("click", () => (v.paused ? v.play() : v.pause()));
  if (reduceMotion) v.controls = true;
}

// ---- bars grow once, when first seen
const barObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const max = +e.target.dataset.max;
    for (const f of $$(".fill", e.target)) f.style.width = (100 * +f.dataset.v / max) + "%";
    barObserver.unobserve(e.target);
  }
}, { threshold: 0.3 });
$$(".bars").forEach((b) => barObserver.observe(b));

// ---- hazard table
const tbody = $("#hztable tbody");
for (const h of HAZARDS) {
  const tr = document.createElement("tr");
  if (h.moving) tr.className = "mv";
  tr.dataset.id = h.id; tr.tabIndex = 0;
  tr.innerHTML = `<td>${h.id}</td><td>${h.name}<small>${h.type}</small></td><td>${h.x.toFixed(1)} m</td><td>${h.type}</td><td>${h.height}</td>`;
  tbody.append(tr);
}

// ---- copy the BibTeX entry
$("#copybib")?.addEventListener("click", async (e) => {
  try { await navigator.clipboard.writeText($("#bibtex").textContent); e.target.textContent = "Copied"; }
  catch { e.target.textContent = "Select and copy"; }
  setTimeout(() => (e.target.textContent = "Copy"), 1800);
});

// ---- the 3D view loads on demand (about 4 MB)
let explorer = null, loading = null;
const veil = $("#veil"), msg = $("#veilmsg"), bar = $("#loadbar");
async function loadExplorer(autoplay) {
  if (explorer) return explorer;
  if (loading) return loading;
  $("#start3d").hidden = true; bar.hidden = false; msg.textContent = "Loading the site…";
  loading = import("./explorer.js").then((m) => m.createExplorer({
    onProgress: (p) => (bar.firstElementChild.style.width = Math.round(p * 100) + "%"),
  })).then((ex) => {
    explorer = ex; veil.classList.add("is-gone");
    if (autoplay) ex.play();
    return ex;
  }).catch((err) => {
    console.error(err); loading = null;
    bar.hidden = true; $("#start3d").hidden = false;
    msg.textContent = "The 3D view could not start in this browser. The videos above show the same site.";
  });
  return loading;
}
$("#start3d").addEventListener("click", () => loadExplorer(true));
const selectHazard = async (id) => {
  const ex = await loadExplorer(false);
  if (!ex) return;
  ex.selectHazard(id);
  $("#explorer").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
};
tbody.addEventListener("click", (e) => { const tr = e.target.closest("tr"); if (tr) selectHazard(tr.dataset.id); });
tbody.addEventListener("keydown", (e) => { if (e.key === "Enter") { const tr = e.target.closest("tr"); if (tr) selectHazard(tr.dataset.id); } });

// On a wide screen with a normal connection, fetch the site as soon as the 3D view comes near.
const roomy = matchMedia("(min-width: 900px)").matches && !(navigator.connection && navigator.connection.saveData);
if (roomy) {
  const near = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { near.disconnect(); loadExplorer(false); }
  }, { rootMargin: "300px" });
  near.observe($("#explorer"));
}
