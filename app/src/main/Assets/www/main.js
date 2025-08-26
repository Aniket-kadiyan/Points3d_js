import * as THREE from "three";
import { OrbitControls } from "three/OrbitControls.js";
import { GLTFLoader } from "three/GLTFLoader.js";

const STATE_COLORS = {
  pending:   0x9ca3af, // gray
  in_progress: 0xf59e0b, // amber
  done:      0x10b981, // green
  error:     0xef4444  // red
};

// Globals
let renderer, scene, camera, controls;
let raycaster, cursor = new THREE.Vector2();
let dom = document.body;
let currentMode = "rotate";
let selectedPoint = null; // THREE.Mesh reference
const pointMap = new Map(); // id -> { mesh, data }

//init();
async function start() {
  try {
    init();
    await loadScene();
    animate();
  } catch (err) {
    console.error(err);
    document.getElementById('info').textContent = 'Error: ' + err.message;
  }
}


start();  // kick everything off
//animate();

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f1a);

  const w = window.innerWidth, h = window.innerHeight;
  camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 100);
  camera.position.set(2.4, 1.6, 2.4);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.getElementById("app").appendChild(renderer.domElement);

  // Lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0x202020, 0.8);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(3, 4, 2);
  scene.add(dir);

  // Grid/floor (optional)
  const grid = new THREE.GridHelper(10, 10, 0x334155, 0x1f2937);
  grid.position.y = -0.001;
  scene.add(grid);

  // Controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false; // toggled by mode
  controls.enableRotate = true;
  controls.screenSpacePanning = true;
  controls.minDistance = 0.5;
  controls.maxDistance = 10;

  // Picking
  raycaster = new THREE.Raycaster();

  // UI wiring
  wireUI();

  // Resize
  window.addEventListener("resize", onResize, false);
  renderer.domElement.addEventListener("pointerdown", onPointerDown, { passive: false });
  renderer.domElement.addEventListener("pointermove", onPointerMove, { passive: false });
}

async function loadScene() {
  // Load model
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync("./models/engine.glb");
  const model = gltf.scene;
  model.traverse(o => {
    if (o.isMesh) {
      o.castShadow = o.receiveShadow = true;
      o.material.side = THREE.FrontSide;
    }
  });
  scene.add(model);

  // Fit view roughly
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  controls.target.copy(center);
  const fitDist = Math.max(size.x, size.y, size.z) * 1.5;
  camera.position.copy(center).add(new THREE.Vector3(fitDist, fitDist * 0.8, fitDist));
  camera.lookAt(center);

  // Load points
  const points = await (await fetch("./points.json")).json();
  addPoints(points);
}

function addPoints(points) {
  const sphereGeom = new THREE.SphereGeometry(0.015, 16, 16); // ~1.5cm at unit scale
  for (const p of points) {
    const color = STATE_COLORS[p.state] ?? STATE_COLORS.pending;
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: 0x000000,
      metalness: 0.0,
      roughness: 0.2
    });
    const m = new THREE.Mesh(sphereGeom, mat);
    m.position.set(p.pos[0], p.pos[1], p.pos[2]);
    m.userData = { ...p };
    m.name = `pt_${p.id}`;
    m.renderOrder = 999; // keep visible
    // Optional halo/billboard could be added here

    scene.add(m);
    pointMap.set(p.id, { mesh: m, data: p });
  }
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

function screenToRay(x, y) {
  const rect = renderer.domElement.getBoundingClientRect();
  cursor.x = ((x - rect.left) / rect.width) * 2 - 1;
  cursor.y = -((y - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(cursor, camera);
}

function intersectPoints() {
  const meshes = Array.from(pointMap.values()).map(v => v.mesh);
  return raycaster.intersectObjects(meshes, false);
}

function onPointerMove(e) {
  if (currentMode !== "select") return;
  screenToRay(e.clientX, e.clientY);
  const hits = intersectPoints();
  renderer.domElement.style.cursor = hits.length ? "pointer" : "default";
}

function onPointerDown(e) {
  if (currentMode !== "select") return;
  e.preventDefault();
  screenToRay(e.clientX, e.clientY);
  const hits = intersectPoints();
  if (hits.length) {
    const mesh = hits[0].object;
    selectPoint(mesh);
  }
}

function selectPoint(mesh) {
  if (selectedPoint && selectedPoint !== mesh) {
    setEmphasis(selectedPoint, false);
  }
  selectedPoint = mesh;
  setEmphasis(mesh, true);
  setInfo(`Selected: ${mesh.userData.name} (${mesh.userData.id}) — state: ${mesh.userData.state}`);
}

function setEmphasis(mesh, on) {
  if (!mesh) return;
  mesh.material.emissive = new THREE.Color(on ? 0x38bdf8 : 0x000000);
  mesh.material.emissiveIntensity = on ? 0.5 : 0.0;
  mesh.scale.setScalar(on ? 1.35 : 1.0);
}

function setInfo(text) {
  document.getElementById("info").textContent = text;
}

function wireUI() {
  // Mode buttons
  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentMode = btn.dataset.mode;
      if (currentMode === "rotate") {
        controls.enableRotate = true; controls.enablePan = false;
        renderer.domElement.style.cursor = "grab";
      } else if (currentMode === "pan") {
        controls.enableRotate = false; controls.enablePan = true;
        renderer.domElement.style.cursor = "grab";
      } else {
        controls.enableRotate = false; controls.enablePan = false;
        renderer.domElement.style.cursor = "default";
      }
    });
  });

  // State buttons
  document.querySelectorAll('[data-state]').forEach(btn => {
    btn.addEventListener('click', () => {
      const state = btn.dataset.state;
      if (!selectedPoint) {
        setInfo("Select a point first, then set its state.");
        return;
      }
      updatePointState(selectedPoint, state);
      setInfo(`Updated ${selectedPoint.userData.name} → ${state}`);
      // TODO: persist with fetch('/api/points/state', {method:'POST', body:...})
    });
  });
}

function updatePointState(mesh, state) {
  mesh.userData.state = state;
  const color = STATE_COLORS[state] ?? STATE_COLORS.pending;
  mesh.material.color = new THREE.Color(color);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
