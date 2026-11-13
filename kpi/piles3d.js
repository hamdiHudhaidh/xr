/* Heaps: one Quest 3 headset per 5 combined daily units (ceil). */
(function (global) {
  "use strict";
  const CAP = 20000;
  const SAFE = { top: 0.22, bottom: 0.66, left: 0.03, right: 0.97 };
  let renderer, scene, camera, canvas;
  let meshBody, meshVisor, meshShadow;
  let dummy = null;
  let vTmp = null;
  let raf = 0;
  let started = false;
  let lights = {};
  let heapMeta = [];
  let lastSig = "";
  const ORIGIN_Z = 6.22;
  let SPAN = 8.4;
  const UNITS_PER_HEADSET = 5;

  function heapCount(total) {
    const n = Math.max(0, Math.floor(Number(total) || 0));
    return n > 0 ? Math.ceil(n / UNITS_PER_HEADSET) : 0;
  }


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

  function roundedBoxGeom(THREE, sx, sy, sz, radius) {
    const r = Math.min(radius, sx * 0.28, sy * 0.28, sz * 0.28);
    const hx = sx / 2 - r, hy = sy / 2 - r, hz = sz / 2 - r;
    const parts = [];
    const segs = 6;
    const corner = new THREE.SphereGeometry(r, segs, segs);
    for (const x of [-hx, hx]) for (const y of [-hy, hy]) for (const z of [-hz, hz]) {
      const g = corner.clone();
      g.translate(x, y, z);
      parts.push(g);
    }
    function cyl(len, rx, ry, rz, x, y, z) {
      const g = new THREE.CylinderGeometry(r, r, len, segs, 1, true);
      if (rx) g.rotateX(rx);
      if (ry) g.rotateY(ry);
      if (rz) g.rotateZ(rz);
      g.translate(x, y, z);
      parts.push(g);
    }
    const lx = sx - 2 * r, ly = sy - 2 * r, lz = sz - 2 * r;
    for (const y of [-hy, hy]) for (const z of [-hz, hz]) cyl(lx, 0, 0, Math.PI / 2, 0, y, z);
    for (const x of [-hx, hx]) for (const z of [-hz, hz]) cyl(ly, 0, 0, 0, x, 0, z);
    for (const x of [-hx, hx]) for (const y of [-hy, hy]) cyl(lz, Math.PI / 2, 0, 0, x, y, 0);
    parts.push(new THREE.BoxGeometry(lx, ly, sz));
    parts.push(new THREE.BoxGeometry(sx, ly, lz));
    parts.push(new THREE.BoxGeometry(lx, sy, lz));
    const g = mergeBufferGeometries(THREE, parts);
    parts.forEach(p => p.dispose());
    corner.dispose();
    g.translate(0, sy / 2, 0);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }

  /* Iconic Quest-3 silhouette: rounded white shell + a large dark front visor.
     Unit width = 1, sitting on y = 0, visor on the -Z face. */
  function headsetParts(THREE) {
    const shell = roundedBoxGeom(THREE, 1.0, 0.56, 0.68, 0.16);
    const brow = roundedBoxGeom(THREE, 0.94, 0.13, 0.34, 0.05);
    brow.translate(0, 0.50, -0.10);
    const cushion = roundedBoxGeom(THREE, 0.80, 0.34, 0.20, 0.08);
    cushion.translate(0, 0.22, 0.30);
    const armL = roundedBoxGeom(THREE, 0.20, 0.18, 0.86, 0.08);
    armL.translate(-0.50, 0.28, 0.22);
    const armR = roundedBoxGeom(THREE, 0.20, 0.18, 0.86, 0.08);
    armR.translate(0.50, 0.28, 0.22);
    const rear = roundedBoxGeom(THREE, 0.78, 0.14, 0.16, 0.06);
    rear.translate(0, 0.28, 0.50);
    const body = mergeBufferGeometries(THREE, [shell, brow, cushion, armL, armR, rear]);
    [shell, brow, cushion, armL, armR, rear].forEach(g => g.dispose());
    const visor = roundedBoxGeom(THREE, 0.72, 0.28, 0.14, 0.05);
    visor.translate(0, 0.10, -0.40);
    body.computeBoundingBox();
    const s = 1 / Math.max(1e-6, body.boundingBox.max.x - body.boundingBox.min.x);
    body.scale(s, s, s);
    visor.scale(s, s, s);
    body.computeBoundingBox();
    const dy = -body.boundingBox.min.y;
    body.translate(0, dy, 0);
    visor.translate(0, dy, 0);
    body.computeBoundingBox();
    body.computeBoundingSphere();
    visor.computeBoundingBox();
    visor.computeBoundingSphere();
    return { body: body, visor: visor };
  }

  /* Loose layered mound: wide-ish base, rounded crown, slot-clamped radius. */
  function settleDome(n, itemR, maxR, maxH, seed) {
    const empty = { pos: [], R: 0, H: 0 };
    if (n <= 0) return empty;
    const capR = Math.max(itemR * 0.18, maxR);
    const rng = seedRng(seed);
    const perLayer = capR >= itemR * 0.85 ? 3 : capR >= itemR * 0.45 ? 2 : 1;
    const layers = Math.max(1, Math.ceil(n / perLayer));
    let yStep = itemR * 0.7;
    if (maxH > 0) {
      const need = (layers - 1) * yStep + itemR * 1.15;
      if (need > maxH) yStep = Math.max(itemR * 0.4, (maxH - itemR * 1.15) / Math.max(1, layers - 1));
    }

    const pts = [];
    let placed = 0;
    for (let layer = 0; placed < n && layer < 80; layer++) {
      const tNorm = layers <= 1 ? 0 : Math.min(1, layer / (layers - 1));
      /* Keep a full base for most of the height; round off only the crown. */
      const taper = Math.max(0, (tNorm - 0.5) / 0.5);
      const layerR = capR * Math.sqrt(Math.max(0, 1 - taper * taper));
      let count;
      if (layerR < itemR * 0.42) count = 1;
      else if (layerR < itemR * 0.9) count = Math.min(2, n - placed);
      else count = Math.min(n - placed, Math.max(2, Math.round((2 * Math.PI * layerR) / (itemR * 1.12))));
      count = Math.max(1, Math.min(count, n - placed));
      const rot = rng() * Math.PI * 2;
      const y = itemR * 0.08 + layer * yStep;
      for (let i = 0; i < count && placed < n; i++) {
        const a = rot + (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.18;
        const rad = count === 1 ? rng() * layerR * 0.22 : layerR * (0.7 + rng() * 0.24);
        pts.push({
          x: Math.cos(a) * rad,
          y: y + (rng() - 0.5) * yStep * 0.1,
          z: Math.sin(a) * rad,
          rx: (rng() - 0.5) * 0.22,
          ry: (rng() - 0.5) * (rng() < 0.28 ? 1.15 : 0.75),
          rz: (rng() - 0.5) * 0.16,
          s: 0.94 + rng() * 0.12,
          faceCam: true
        });
        placed++;
      }
    }

    const pos = pts.slice(0, n);
    let maxY = itemR, maxRad = 0;
    for (let i = 0; i < pos.length; i++) {
      maxY = Math.max(maxY, pos[i].y);
      maxRad = Math.max(maxRad, Math.hypot(pos[i].x, pos[i].z));
    }
    if (maxH > 0 && maxY > maxH && maxY > 0) {
      const s = maxH / maxY;
      for (let i = 0; i < pos.length; i++) pos[i].y *= s;
      maxY = maxH;
    }
    return { pos: pos, R: Math.min(capR, Math.max(itemR, maxRad)), H: Math.max(itemR, maxY) };
  }

  function radiusForCount(n, itemR, maxR) {
    const per = n >= 8 ? 3 : n >= 3 ? 2 : 1;
    const layers = Math.max(1, Math.ceil(Math.max(1, n) / per));
    const H = layers * itemR * 0.7;
    const R = Math.max(itemR * 1.05, H * 0.55);
    return Math.min(maxR, R);
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
      renderer.setPixelRatio(2);
      renderer.outputColorSpace = THREE.SRGBColorSpace || renderer.outputColorSpace;
      if (THREE.ACESFilmicToneMapping) renderer.toneMapping = THREE.ACESFilmicToneMapping;
      if ("toneMappingExposure" in renderer) renderer.toneMappingExposure = 1.12;
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(28, 1, 0.1, 80);

      /* Soft, directional lighting for pile depth: cool moon rim, warm fire key. */
      scene.add(new THREE.AmbientLight(0xffe8d0, 0.22));
      const hemi = new THREE.HemisphereLight(0xc8d4f0, 0x3a2414, 0.75);
      scene.add(hemi);
      const moon = new THREE.DirectionalLight(0xc5d8ff, 1.25);
      moon.position.set(8, 13, 3);
      scene.add(moon);
      lights.moon = moon;
      const fill = new THREE.DirectionalLight(0xffe6c8, 0.32);
      fill.position.set(-4, 3.2, 11);
      scene.add(fill);
      const fire = new THREE.PointLight(0xff8a33, 3.4, 18, 1.35);
      fire.position.set(0, 1.0, 8.7);
      scene.add(fire);
      lights.fire = fire;

      const hs = headsetParts(THREE);
      const matBody = new THREE.MeshStandardMaterial({
        color: 0xf6f4f8, roughness: 0.36, metalness: 0.07,
        emissive: 0xddd8d2, emissiveIntensity: 0.18
      });
      const matVisor = new THREE.MeshStandardMaterial({
        color: 0x05060a, roughness: 0.12, metalness: 0.84,
        emissive: 0x07080c, emissiveIntensity: 0.1
      });
      meshBody = new THREE.InstancedMesh(hs.body, matBody, CAP);
      meshVisor = new THREE.InstancedMesh(hs.visor, matVisor, CAP);
      const shadowG = new THREE.CircleGeometry(1, 28);
      const shadowM = new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false
      });
      meshShadow = new THREE.InstancedMesh(shadowG, shadowM, 64);
      meshShadow.renderOrder = -1;
      [meshBody, meshVisor, meshShadow].forEach(m => {
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

  function resize() {
    if (!renderer || !canvas) return;
    const W = canvas.clientWidth || global.innerWidth || 1920;
    const H = canvas.clientHeight || global.innerHeight || 1080;
    renderer.setPixelRatio(2);
    renderer.setSize(W, H, false);
    camera.aspect = W / Math.max(1, H);
    camera.fov = 28;
    camera.position.set(0, 3.55, 11.05);
    camera.lookAt(0, 0.2, ORIGIN_Z);
    camera.updateProjectionMatrix();
    const dx = Math.abs(project(1, 0, ORIGIN_Z).x - project(0, 0, ORIGIN_Z).x) || 1;
    SPAN = ((SAFE.right - SAFE.left) * W) / dx;
  }

  function project(x, y, z) {
    const W = canvas.clientWidth || global.innerWidth || 1920;
    const H = canvas.clientHeight || global.innerHeight || 1080;
    vTmp.set(x, y, z).project(camera);
    return { x: (vTmp.x * 0.5 + 0.5) * W, y: (-vTmp.y * 0.5 + 0.5) * H };
  }

  function writeInstances(mesh, items, wx, wz, scale, faceCam, sx, sy, sz) {
    if (!mesh) return;
    const mx = sx == null ? 1 : sx, my = sy == null ? 1 : sy, mz = sz == null ? 1 : sz;
    let n = mesh.count;
    for (let i = 0; i < items.length; i++) {
      if (n >= CAP) break;
      const p = items[i];
      const s = scale * (p.s || 1);
      dummy.position.set(wx + p.x, p.y, wz + p.z);
      if (faceCam && (p.faceCam !== false) && camera) {
        const dx = camera.position.x - (wx + p.x);
        const dy = camera.position.y - p.y;
        const dz = camera.position.z - (wz + p.z);
        const yaw = Math.atan2(dx, -dz) + (p.ry || 0);
        const pitch = -Math.atan2(dy, Math.hypot(dx, dz) || 1) * 0.32;
        dummy.rotation.set(pitch + (p.rx || 0) * 0.22, yaw, (p.rz || 0) * 0.2);
      } else {
        dummy.rotation.set(p.rx || 0, p.ry || 0, p.rz || 0);
      }
      dummy.scale.set(s * mx, s * my, s * mz);
      dummy.updateMatrix();
      mesh.setMatrixAt(n, dummy.matrix);
      n++;
    }
    mesh.count = n;
  }

  function writeShadow(wx, wz, radius) {
    if (!meshShadow) return;
    const n = meshShadow.count;
    if (n >= 64) return;
    dummy.position.set(wx, 0.012, wz);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.scale.set(radius * 1.22, radius * 0.78, 1);
    dummy.updateMatrix();
    meshShadow.setMatrixAt(n, dummy.matrix);
    meshShadow.count = n + 1;
  }

  function dayAnchor(i, n, span) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const recede = Math.abs(t - 0.5) * 2;
    const wx = -span / 2 + span * t;
    const wz = ORIGIN_Z + (1 - recede * recede) * 0.14;
    return { t: t, recede: recede, wx: wx, wz: wz };
  }

  function update(slots) {
    if (!renderer) return [];
    resize();
    const sig = JSON.stringify(slots.map(s => [s.ymd, s.participants || 0, s.engagement || 0, s.index, slots.length])) + "|v22";
    const size = (canvas.clientWidth || 0) + "x" + (canvas.clientHeight || 0);
    const full = sig + "|" + size;
    if (full === lastSig && heapMeta.length) return heapMeta;
    lastSig = full;

    [meshBody, meshVisor, meshShadow].forEach(m => { if (m) m.count = 0; });
    heapMeta = [];

    const n = Math.max(slots.length, 1);
    const span = SPAN;
    const W = canvas.clientWidth || global.innerWidth || 1920;
    const H = canvas.clientHeight || global.innerHeight || 1080;
    const slotW = span / n;
    const mid = dayAnchor(Math.floor((n - 1) / 2), n, span);
    const groundPt = project(mid.wx, 0, mid.wz);
    const pxPerWorldY = Math.abs(groundPt.y - project(mid.wx, 1, mid.wz).y) || 1;
    const pxPerWorldX = Math.abs(project(mid.wx + 1, 0, mid.wz).x - groundPt.x) || 1;
    const labelPad = 132;
    const maxHpx = Math.max(48, groundPt.y - SAFE.top * H - labelPad);
    const maxHworld = maxHpx / pxPerWorldY;

    /* About 2.5–3× the previous 24–34px pieces, so the Quest 3 silhouette reads. */
    const targetPx = Math.max(56, Math.min(80, W * 0.038));
    let instScale = Math.max(0.05, targetPx / pxPerWorldX);
    const itemR = instScale / 2.05;
    /* Tight centre disk so large, slightly-turned headsets still leave a gap. */
    const maxR = Math.min(slotW * 0.33, itemR * 0.95);

    const busiest = Math.max(0, ...slots.map(s => heapCount((s.participants || 0) + (s.engagement || 0))));
    let fitScale = instScale;
    if (busiest > 0) {
      const trial = settleDome(busiest, itemR, maxR, 0, "fit");
      if (trial.H > maxHworld && trial.H > 0) {
        const capped = settleDome(busiest, itemR, maxR, maxHworld, "fit");
        if (capped.pos.length < busiest) {
          const shrink = Math.max(0.9, maxHworld / trial.H);
          fitScale = instScale * shrink;
        }
      }
    }
    instScale = fitScale;
    const packR = instScale / 2.05;

    slots.forEach((s, i) => {
      const a = dayAnchor(i, n, span);
      const pN = Math.max(0, Math.floor(s.participants || 0));
      const eN = Math.max(0, Math.floor(s.engagement || 0));
      const filled = pN > 0 || eN > 0;
      const g = project(a.wx, 0, a.wz);
      const rec = {
        ymd: s.ymd,
        filled: filled,
        groundX: g.x,
        groundY: g.y,
        p: null,
        e: null,
        heap: null
      };
      if (filled) {
        const total = pN + eN;
        const heads = heapCount(total);
        const pileR = radiusForCount(heads, packR, maxR);
        const mound = settleDome(heads, packR, pileR, maxHworld, "h:" + s.ymd);
        writeInstances(meshBody, mound.pos, a.wx, a.wz, instScale, true, 1.08, 1.0, 1.0);
        writeInstances(meshVisor, mound.pos, a.wx, a.wz, instScale, true, 1.08, 1.0, 1.0);
        writeShadow(a.wx, a.wz, Math.max(mound.R, packR * 1.05));
        const top = project(a.wx, mound.H + packR * 0.85, a.wz);
        rec.heap = { n: heads, total: total, topX: top.x, topY: top.y, groundX: g.x, groundY: g.y, H: mound.H, R: mound.R };
        rec.p = { n: pN, topX: top.x, topY: top.y, groundX: g.x, groundY: g.y, H: mound.H };
        rec.e = { n: eN, topX: top.x, topY: top.y, groundX: g.x, groundY: g.y, H: mound.H };
      }
      heapMeta.push(rec);
    });

    [meshBody, meshVisor, meshShadow].forEach(m => {
      if (m) m.instanceMatrix.needsUpdate = true;
    });
    return heapMeta;
  }

  function start() {
    if (started || !renderer) return;
    started = true;
    function loop(t) {
      raf = global.requestAnimationFrame(loop);
      if (lights.fire) {
        lights.fire.intensity = 3.15 + Math.sin(t * 0.007) * 0.25 + Math.sin(t * 0.019) * 0.12;
      }
      renderer.render(scene, camera);
    }
    loop(0);
  }

  function ready() { return !!renderer; }

  global.XRPiles3D = { init: init, update: update, start: start, resize: resize, ready: ready, project: project };
})(window);
