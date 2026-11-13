/* Exact-count 3D piles: one headset per participant, one cube per engagement. */
(function (global) {
  "use strict";
  const CAP = 20000;
  let renderer, scene, camera, canvas;
  let meshHeadset, meshCubeB, meshCubeW;
  let dummy = null;
  let vTmp = null;
  let raf = 0;
  let started = false;
  let lights = {};
  let heapMeta = [];
  let lastSig = "";

  function seedRng(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 15), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    };
  }

  function mergeBufferGeometries(THREE, geoms) {
    const pos = [], nor = [], idx = [];
    let base = 0;
    for (const g of geoms) {
      const p = g.getAttribute("position");
      const n = g.getAttribute("normal");
      const index = g.getIndex();
      for (let i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i));
        nor.push(n.getX(i), n.getY(i), n.getZ(i));
      }
      if (index) for (let i = 0; i < index.count; i++) idx.push(index.getX(i) + base);
      else for (let i = 0; i < p.count; i++) idx.push(i + base);
      base += p.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    out.setIndex(idx);
    out.computeBoundingBox();
    out.computeBoundingSphere();
    return out;
  }

  function boxAt(THREE, w, h, d, x, y, z, rx, ry, rz) {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Matrix4();
    const e = new THREE.Euler(rx || 0, ry || 0, rz || 0);
    m.makeRotationFromEuler(e);
    m.setPosition(x, y, z);
    g.applyMatrix4(m);
    return g;
  }

  function headsetGeom(THREE) {
    const parts = [
      boxAt(THREE, 1.70, 0.72, 0.58, 0, 0.48, 0),
      boxAt(THREE, 1.78, 0.16, 0.36, 0, 0.84, -0.08),
      boxAt(THREE, 1.36, 0.42, 0.22, 0, 0.44, 0.30),
      boxAt(THREE, 0.18, 0.24, 0.90, -0.88, 0.44, 0.28, 0, 0.12, 0),
      boxAt(THREE, 0.18, 0.24, 0.90, 0.88, 0.44, 0.28, 0, -0.12, 0),
      boxAt(THREE, 0.22, 0.16, 0.22, -0.78, 0.18, 0.05),
      boxAt(THREE, 0.22, 0.16, 0.22, 0.78, 0.18, 0.05)
    ];
    const g = mergeBufferGeometries(THREE, parts);
    parts.forEach(p => p.dispose());
    g.computeBoundingBox();
    const s = 0.20 / Math.max(1e-6, g.boundingBox.max.x - g.boundingBox.min.x);
    g.scale(s, s, s);
    g.translate(0, -g.boundingBox.min.y * s, 0);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }

  function cubeGeom(THREE) {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const s = 0.11;
    g.scale(s, s, s);
    g.translate(0, s / 2, 0);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }

  function settle(n, r, seed, spreadX, spreadZ) {
    const rng = seedRng(seed);
    const pos = [];
    const minD = r * 1.76;
    const cell = minD;
    const hash = new Map();
    function key(ix, iz) { return ix + ":" + iz; }
    function neighbors(x, z) {
      const ix = Math.floor(x / cell), iz = Math.floor(z / cell);
      const out = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const arr = hash.get(key(ix + dx, iz + dz));
          if (arr) for (let i = 0; i < arr.length; i++) out.push(arr[i]);
        }
      }
      return out;
    }
    function addHash(p) {
      const k = key(Math.floor(p.x / cell), Math.floor(p.z / cell));
      let arr = hash.get(k);
      if (!arr) { arr = []; hash.set(k, arr); }
      arr.push(p);
    }
    for (let i = 0; i < n; i++) {
      const ang = rng() * Math.PI * 2;
      const u = Math.sqrt(rng());
      let x = Math.cos(ang) * u * spreadX;
      let z = Math.sin(ang) * u * spreadZ;
      let y = r;
      const near = neighbors(x, z);
      const lim = minD * minD;
      for (let j = 0; j < near.length; j++) {
        const p = near[j];
        const dx = x - p.x, dz = z - p.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < lim) {
          const lift = p.y + Math.sqrt(Math.max(0, lim - d2));
          if (lift > y) y = lift;
        }
      }
      const rec = {
        x: x, y: y, z: z,
        rx: (rng() - 0.5) * 0.55,
        ry: rng() * Math.PI * 2,
        rz: (rng() - 0.5) * 0.4
      };
      pos.push(rec);
      addHash(rec);
    }
    return pos;
  }

  function init(el) {
    if (renderer) return true;
    const THREE = global.THREE;
    if (!THREE || !el) return false;
    try {
      canvas = el;
      dummy = new THREE.Object3D();
      vTmp = new THREE.Vector3();
      renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance"
      });
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(2, global.devicePixelRatio || 1));
      renderer.outputColorSpace = THREE.SRGBColorSpace || renderer.outputColorSpace;
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);

      const hemi = new THREE.HemisphereLight(0x8a78d0, 0x2a1820, 0.85);
      scene.add(hemi);
      const moon = new THREE.DirectionalLight(0xfff2d0, 0.9);
      moon.position.set(8, 10, 6);
      scene.add(moon);
      const fill = new THREE.DirectionalLight(0x6a80c8, 0.28);
      fill.position.set(-6, 4, 4);
      scene.add(fill);
      const fire = new THREE.PointLight(0xff7a2a, 1.2, 24, 1.4);
      fire.position.set(0, 0.9, 5.2);
      scene.add(fire);
      lights.fire = fire;

      const matH = new THREE.MeshStandardMaterial({ color: 0xe8e0f8, roughness: 0.42, metalness: 0.14 });
      const matB = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.35, metalness: 0.22 });
      const matW = new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.4, metalness: 0.08 });
      meshHeadset = new THREE.InstancedMesh(headsetGeom(THREE), matH, CAP);
      meshCubeB = new THREE.InstancedMesh(cubeGeom(THREE), matB, CAP);
      meshCubeW = new THREE.InstancedMesh(cubeGeom(THREE), matW, CAP);
      [meshHeadset, meshCubeB, meshCubeW].forEach(m => {
        m.frustumCulled = false;
        m.count = 0;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(m);
      });

      resize();
      return true;
    } catch (e) {
      renderer = null;
      return false;
    }
  }

  const ORIGIN_Z = 3.2;
  let SPAN = 7.4;

  function resize() {
    if (!renderer || !canvas) return;
    const W = canvas.clientWidth || global.innerWidth || 1920;
    const H = canvas.clientHeight || global.innerHeight || 1080;
    renderer.setSize(W, H, false);
    camera.aspect = W / Math.max(1, H);
    camera.fov = 26;
    // Fixed downward view: day-row sits in the midground, just behind the seating circle.
    camera.position.set(0, 6.4, 12.0);
    camera.lookAt(0, 0, ORIGIN_Z);
    camera.updateProjectionMatrix();
    const dx = Math.abs(project(1, 0, ORIGIN_Z).x - project(0, 0, ORIGIN_Z).x) || 1;
    SPAN = (0.90 * W) / dx;
  }

  function project(x, y, z) {
    const W = canvas.clientWidth || global.innerWidth || 1920;
    const H = canvas.clientHeight || global.innerHeight || 1080;
    vTmp.set(x, y, z).project(camera);
    return { x: (vTmp.x * 0.5 + 0.5) * W, y: (-vTmp.y * 0.5 + 0.5) * H };
  }

  function writeInstances(mesh, items, wx, wz) {
    let n = mesh.count;
    for (let i = 0; i < items.length; i++) {
      if (n >= CAP) break;
      const p = items[i];
      dummy.position.set(wx + p.x, p.y, wz + p.z);
      dummy.rotation.set(p.rx, p.ry, p.rz);
      dummy.updateMatrix();
      mesh.setMatrixAt(n, dummy.matrix);
      n++;
    }
    mesh.count = n;
  }

  function update(slots) {
    if (!renderer) return [];
    resize();
    const sig = JSON.stringify(slots.map(s => [s.ymd, s.participants || 0, s.engagement || 0, s.index, slots.length]));
    const size = (canvas.clientWidth || 0) + "x" + (canvas.clientHeight || 0);
    const full = sig + "|" + size;
    if (full === lastSig && heapMeta.length) return heapMeta;
    lastSig = full;

    meshHeadset.count = 0;
    meshCubeB.count = 0;
    meshCubeW.count = 0;
    heapMeta = [];

    const n = Math.max(slots.length, 1);
    const span = SPAN;
    const originZ = ORIGIN_Z;

    slots.forEach((s, i) => {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const recede = Math.abs(t - 0.5) * 2;
      const wx = -span / 2 + span * t;
      const wz = originZ - recede * recede * 0.55;
      const pN = Math.max(0, Math.floor(s.participants || 0));
      const eN = Math.max(0, Math.floor(s.engagement || 0));
      const filled = pN > 0 || eN > 0;
      let maxY = 0.05;
      if (filled) {
        const pOff = eN > 0 ? -0.13 : 0;
        const eOff = pN > 0 ? 0.13 : 0;
        if (pN > 0) {
          const items = settle(pN, 0.042, "p:" + s.ymd, 0.11, 0.18);
          writeInstances(meshHeadset, items, wx + pOff, wz);
          for (let k = 0; k < items.length; k++) if (items[k].y > maxY) maxY = items[k].y;
        }
        if (eN > 0) {
          const items = settle(eN, 0.052, "e:" + s.ymd, 0.09, 0.15);
          const black = [], white = [];
          for (let k = 0; k < items.length; k++) (k % 2 === 0 ? black : white).push(items[k]);
          writeInstances(meshCubeB, black, wx + eOff, wz);
          writeInstances(meshCubeW, white, wx + eOff, wz);
          for (let k = 0; k < items.length; k++) if (items[k].y > maxY) maxY = items[k].y;
        }
      }
      const ground = project(wx, 0, wz);
      const top = project(wx, maxY + 0.16, wz);
      heapMeta.push({
        ymd: s.ymd,
        filled: filled,
        groundX: ground.x,
        groundY: ground.y,
        topX: top.x,
        topY: top.y,
        participants: pN,
        engagement: eN
      });
    });

    meshHeadset.instanceMatrix.needsUpdate = true;
    meshCubeB.instanceMatrix.needsUpdate = true;
    meshCubeW.instanceMatrix.needsUpdate = true;
    return heapMeta;
  }

  function start() {
    if (started || !renderer) return;
    started = true;
    function loop(t) {
      raf = global.requestAnimationFrame(loop);
      if (lights.fire) {
        lights.fire.intensity = 1.1 + Math.sin(t * 0.007) * 0.16 + Math.sin(t * 0.019) * 0.08;
      }
      renderer.render(scene, camera);
    }
    loop(0);
  }

  function ready() { return !!renderer; }

  global.XRPiles3D = { init: init, update: update, start: start, resize: resize, ready: ready, project: project };
})(window);
