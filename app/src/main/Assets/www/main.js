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
  controls.enablePan = true
  controls.enableRotate = true;
  controls.screenSpacePanning = true;
//  controls.minDistance = 0.5;
//  controls.maxDistance = 10;

  // Picking
  raycaster = new THREE.Raycaster();

  // UI wiring
  wireUI();

  // Resize
  window.addEventListener("resize", onResize, false);
  renderer.domElement.addEventListener("pointerdown", onPointerDown, { passive: false });
  renderer.domElement.addEventListener("pointermove", onPointerMove, { passive: false });
}

function qp(key) {
  return new URLSearchParams(window.location.search).get(key);
}


async function loadScene() {
  // Load model
  const loader = new GLTFLoader();
//  const gltf = await loader.loadAsync("./models/engine.glb");
 const modelFile  = qp('model')  || './models/2CylinderEngine.gltf';
  const pointsFile = qp('points') || './points.json';

  const gltf = await loader.loadAsync(modelFile);

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
//  const size = new THREE.Vector3();
//  box.getSize(size);
const size = box.getSize(new THREE.Vector3());
//  const center = new THREE.Vector3();
//  box.getCenter(center);
const center = box.getCenter(new THREE.Vector3());

// Re-center the model (optional)
 model.position.sub(center);  // uncomment to center model at origin

 window.modelCenter = center.clone();    // save for points

//  controls.target.copy(center);
//  const fitDist = Math.max(size.x, size.y, size.z) * 1.5;
//  camera.position.copy(center).add(new THREE.Vector3(fitDist, fitDist * 0.8, fitDist));
//  camera.lookAt(center);

// Move the camera back so the whole model fits in view
const maxDim = Math.max(size.x, size.y, size.z);
const fov = THREE.MathUtils.degToRad(camera.fov); // convert vertical FOV to radians
let distance = maxDim / (2 * Math.tan(fov / 2));
distance *= 1.5; // add some extra space around the model
window.pointRadius = maxDim * 0.05

camera.position.copy(center).add(new THREE.Vector3(distance, distance, distance));
camera.near = 0.1;
camera.far = distance * 10;
camera.updateProjectionMatrix();
camera.lookAt(center);

// Update OrbitControls target and zoom limits
controls.target.copy(center);
controls.maxDistance = distance * 2;   // allow zooming out farther if needed
controls.minDistance = distance * 0.1; // prevent zooming inside the model

  // Load points
  const points = await (await fetch(pointsFile)).json();
  addPoints(points);
   window.pointKeys = Array.from(pointMap.keys());
    window.currentPointIndex = -1;
}

function addPoints(points) {
 window.points = points; // keep a mutable copy for editing


  for (const p of points) {
  const radius = p.radius ?? window.pointRadius;   // <= pick per‑point radius
  const sphereGeom = new THREE.SphereGeometry(radius, 16, 16); // ~1.5cm at unit scale
    const color = STATE_COLORS[p.state] ?? STATE_COLORS.pending;
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: 0x000000,
      metalness: 0.0,
      roughness: 0.2,
      transparent : true,
      opacity:0.6,
      depthTest: false,  // draw on top of the model
      depthWrite: false
    });
    const m = new THREE.Mesh(sphereGeom, mat);
     const offset = window.modelCenter ?? new THREE.Vector3();
     m.position.set(
          p.pos[0] - offset.x,
          p.pos[1] - offset.y,
          p.pos[2] - offset.z
        );
    m.userData = { ...p };
    m.name = `pt_${p.id}`;
    m.renderOrder = 999; // keep visible
    // Optional halo/billboard could be added here


    pointMap.set(p.id, { mesh: m, data: p });
    scene.add(m);
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
//  if (currentMode !== "select") return;
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
  showEditor(mesh);
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
//  document.querySelectorAll('[data-mode]').forEach(btn => {
//    btn.addEventListener('click', () => {
//      document.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'));
//      btn.classList.add('active');
//      currentMode = btn.dataset.mode;
////      if (currentMode === "rotate") {
////        controls.enableRotate = true; controls.enablePan = false;
////        renderer.domElement.style.cursor = "grab";
////      } else if (currentMode === "pan") {
////        controls.enableRotate = false; controls.enablePan = true;
////        renderer.domElement.style.cursor = "grab";
////      } else {
////        controls.enableRotate = false; controls.enablePan = false;
////        renderer.domElement.style.cursor = "default";
////      }
//    });
//  });

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

function cyclePoints() {
  const keys = window.pointKeys || [];
  if (keys.length === 0) return;

  // advance the index and wrap around
  window.currentPointIndex = (window.currentPointIndex + 1) % keys.length;
  const key = keys[window.currentPointIndex];
  const entry = pointMap.get(key);
  if (!entry) return;
  const mesh = entry.mesh;

  // highlight this point
  selectPoint(mesh);

  // move the controls’ target to the point’s position
  const pos = mesh.position.clone();
  controls.target.copy(pos);

  // maintain current distance but pivot the camera around to the new target
  const direction = camera.position.clone().sub(controls.target).normalize();
  const distance = camera.position.distanceTo(controls.target);
  camera.position.copy(pos).add(direction.multiplyScalar(distance));
  camera.lookAt(pos);
  controls.update();
}


function showEditor(mesh) {
  const editor = document.getElementById('point-editor');
  const offset = window.modelCenter ?? new THREE.Vector3();

  document.getElementById('edit-id').value = mesh.userData.id;
  document.getElementById('edit-name').value = mesh.userData.name;
  document.getElementById('edit-x').value = (mesh.position.x + offset.x).toFixed(3);
  document.getElementById('edit-y').value = (mesh.position.y + offset.y).toFixed(3);
  document.getElementById('edit-z').value = (mesh.position.z + offset.z).toFixed(3);
  document.getElementById('edit-radius').value = (mesh.userData.radius ?? window.pointRadius).toFixed(3);
  document.getElementById('edit-state').value = mesh.userData.state;

  editor.style.display = 'block';
}

function hideEditor() {
  document.getElementById('point-editor').style.display = 'none';
}

document.getElementById('cycle-points').addEventListener('click', cyclePoints);

document.getElementById('save-point').addEventListener('click', () => {
  if (!selectedPoint) return;

  const oldId = selectedPoint.userData.id;
  const newId = document.getElementById('edit-id').value.trim();
  const newName = document.getElementById('edit-name').value.trim();
  const x = parseFloat(document.getElementById('edit-x').value);
  const y = parseFloat(document.getElementById('edit-y').value);
  const z = parseFloat(document.getElementById('edit-z').value);
  let radius = parseFloat(document.getElementById('edit-radius').value);
  if (!isFinite(radius)) radius = window.pointRadius;
  const state = document.getElementById('edit-state').value;

  // update mesh position relative to model center
  const offset = window.modelCenter ?? new THREE.Vector3();
  selectedPoint.position.set(x - offset.x, y - offset.y, z - offset.z);

  // update geometry if radius changed
  if ((selectedPoint.userData.radius ?? window.pointRadius) !== radius) {
    selectedPoint.geometry.dispose();
    selectedPoint.geometry = new THREE.SphereGeometry(radius, 16, 16);
  }

  // update color if state changed
  if (selectedPoint.userData.state !== state) {
    selectedPoint.material.color = new THREE.Color(STATE_COLORS[state] ?? STATE_COLORS.pending);
  }

  // update userData
  selectedPoint.userData = {
    id: newId,
    name: newName,
    pos: [x, y, z],
    radius: radius,
    state: state
  };

  // update pointMap keys if id changed
  if (oldId !== newId) {
    const entry = pointMap.get(oldId);
    pointMap.delete(oldId);
    pointMap.set(newId, entry);
    // update cycling array
    const idx = window.pointKeys.indexOf(oldId);
    if (idx !== -1) window.pointKeys[idx] = newId;
    // update in the window.points array (for persistence)
  }

  // update window.points (the array loaded from points.json)
  const idx = window.points.findIndex(pt => pt.id === oldId);
  if (idx !== -1) {
    window.points[idx] = { id: newId, name: newName, pos: [x, y, z], radius, state };
  }

  hideEditor();
});

window.updateScene = async function(modelFile, pointsFile) {
  // remove existing meshes
  pointMap.forEach(({ mesh }) => scene.remove(mesh));
  pointMap.clear();
  scene.remove(scene.getObjectByName('loadedModel')); // if you gave your model a name

  // Load the new model
  const gltf = await new GLTFLoader().loadAsync(modelFile);
  const model = gltf.scene;
  model.name = 'loadedModel';
  scene.add(model);

  // recompute camera framing and pointRadius as in loadScene()

  // Load new points
  const points = await (await fetch(pointsFile)).json();
  addPoints(points);
  window.points = points;
};


document.getElementById('cancel-point').addEventListener('click', hideEditor);


