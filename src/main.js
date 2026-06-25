// physics_viewer/src/main.js
// Renders trajectories from simulation_server with three.js.
// The engine uses z-up; we configure three.js to match so the numbers line up.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const SERVER = "http://localhost:8000"; // simulation_server origin

// ---------------------------------------------------------------------------
// Scene, camera, renderer
// ---------------------------------------------------------------------------
const app = document.getElementById("app");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14161a);

const camera = new THREE.PerspectiveCamera(
  50, window.innerWidth / window.innerHeight, 0.01, 5000
);
camera.up.set(0, 0, 1);              // z is up (matches reference_engine)
camera.position.set(6, -6, 4);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0);

// Lights
scene.add(new THREE.HemisphereLight(0xffffff, 0x202028, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(5, -8, 10);
scene.add(key);

// Ground grid in the x-y plane (z = 0), plus axes (red=x, green=y, blue=z up)
const grid = new THREE.GridHelper(40, 40, 0x2a2e36, 0x22252b);
grid.rotation.x = Math.PI / 2;
scene.add(grid);
scene.add(new THREE.AxesHelper(2));

// ---------------------------------------------------------------------------
// Playback state
// ---------------------------------------------------------------------------
let trajectory = null;            // last fetched payload
let meshes = new Map();           // body id -> THREE.Mesh
let links = [];                   // { line, from, to }
let frameCount = 0;
let dt = 0.01;
let playhead = 0;                 // continuous frame index (float, for interpolation)
let playing = true;
let speed = 1.0;

const ui = {
  sceneSel: document.getElementById("scene"),
  frames: document.getElementById("frames"),
  dt: document.getElementById("dt"),
  run: document.getElementById("run"),
  scrub: document.getElementById("scrub"),
  play: document.getElementById("play"),
  reset: document.getElementById("reset"),
  tLabel: document.getElementById("t-label"),
  fLabel: document.getElementById("f-label"),
  status: document.getElementById("status"),
};

function setStatus(msg, isError = false) {
  ui.status.textContent = msg;
  ui.status.classList.toggle("error", isError);
}

// ---------------------------------------------------------------------------
// Build meshes/lines from the manifest (once per simulation)
// ---------------------------------------------------------------------------
function clearScene() {
  for (const m of meshes.values()) {
    scene.remove(m);
    m.geometry.dispose();
    m.material.dispose();
  }
  meshes.clear();
  for (const l of links) {
    scene.remove(l.line);
    l.line.geometry.dispose();
    l.line.material.dispose();
  }
  links = [];
}

function buildScene(payload) {
  clearScene();

  for (const b of payload.bodies) {
    const geo = new THREE.SphereGeometry(b.radius, 24, 16);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(b.color),
      roughness: 0.45,
      metalness: 0.1,
      emissive: new THREE.Color(b.color).multiplyScalar(b.static ? 0.0 : 0.12),
    });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    meshes.set(b.id, mesh);
  }

  const linkMat = new THREE.LineBasicMaterial({ color: 0x6b7280 });
  for (const lk of payload.links) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, linkMat.clone());
    scene.add(line);
    links.push({ line, from: lk.from, to: lk.to });
  }
}

// ---------------------------------------------------------------------------
// Apply a (possibly fractional) frame to the meshes, interpolating between
// the two nearest recorded frames for smooth playback.
// ---------------------------------------------------------------------------
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

function applyFrame(index) {
  if (!trajectory) return;
  const i0 = Math.floor(index);
  const i1 = Math.min(i0 + 1, frameCount - 1);
  const f = index - i0;

  const p0 = trajectory.frames[i0].p;
  const p1 = trajectory.frames[i1].p;

  for (const [id, mesh] of meshes) {
    const a = p0[id], b = p1[id];
    if (!a) continue;
    _a.set(a[0], a[1], a[2]);
    _b.set(b[0], b[1], b[2]);
    mesh.position.lerpVectors(_a, _b, f);
  }

  for (const lk of links) {
    const A = meshes.get(lk.from), B = meshes.get(lk.to);
    if (!A || !B) continue;
    const pos = lk.line.geometry.attributes.position;
    pos.setXYZ(0, A.position.x, A.position.y, A.position.z);
    pos.setXYZ(1, B.position.x, B.position.y, B.position.z);
    pos.needsUpdate = true;
  }

  ui.scrub.value = String(i0);
  ui.tLabel.textContent = `t = ${(i0 * dt).toFixed(3)} s`;
  ui.fLabel.textContent = `${i0} / ${frameCount - 1}`;
}

// ---------------------------------------------------------------------------
// Server calls
// ---------------------------------------------------------------------------
async function loadScenes() {
  try {
    const res = await fetch(`${SERVER}/api/scenes`);
    const { scenes } = await res.json();
    ui.sceneSel.innerHTML = scenes
      .map((s) => `<option value="${s}">${s}</option>`).join("");
    setStatus(`${scenes.length} scenes available`);
  } catch (e) {
    setStatus(`Cannot reach server at ${SERVER}`, true);
  }
}

async function runSimulation() {
  const body = {
    scene: ui.sceneSel.value,
    dt: parseFloat(ui.dt.value),
    n_frames: parseInt(ui.frames.value, 10),
    params: {},
  };
  setStatus("Simulating…");
  ui.run.disabled = true;
  try {
    const res = await fetch(`${SERVER}/api/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
    trajectory = await res.json();

    frameCount = trajectory.frames.length;
    dt = trajectory.meta.dt;
    playhead = 0;
    ui.scrub.max = String(frameCount - 1);

    buildScene(trajectory);
    frameCamera();
    applyFrame(0);
    playing = true;
    ui.play.textContent = "Pause";
    setStatus(`${frameCount} frames · dt ${dt}s · scene "${trajectory.meta.scene}"`);
  } catch (e) {
    setStatus(`Simulation failed: ${e.message}`, true);
  } finally {
    ui.run.disabled = false;
  }
}

// Fit the camera/grid to the first frame's bounding sphere.
function frameCamera() {
  const box = new THREE.Box3();
  const f0 = trajectory.frames[0].p;
  for (const id of Object.keys(f0)) {
    box.expandByPoint(new THREE.Vector3(f0[id][0], f0[id][1], f0[id][2]));
  }
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() * 0.6, 1);
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(radius, -radius, radius * 0.8));
  camera.near = radius / 100;
  camera.far = radius * 100;
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------------------
// Animation loop — advances the playhead in real time using dt.
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  if (trajectory && playing && frameCount > 1) {
    playhead += (delta / dt) * speed;
    if (playhead >= frameCount - 1) playhead = 0; // loop
    applyFrame(playhead);
  }

  controls.update();
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
ui.run.addEventListener("click", runSimulation);

ui.play.addEventListener("click", () => {
  playing = !playing;
  ui.play.textContent = playing ? "Pause" : "Play";
});

ui.reset.addEventListener("click", () => {
  playhead = 0;
  applyFrame(0);
});

ui.scrub.addEventListener("input", () => {
  playing = false;
  ui.play.textContent = "Play";
  playhead = parseInt(ui.scrub.value, 10);
  applyFrame(playhead);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
await loadScenes();
await runSimulation();   // run the default scene on load
animate();
