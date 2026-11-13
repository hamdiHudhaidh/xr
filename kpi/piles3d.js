/* Exact-count 3D heaps: one headset per participant, one cube per engagement. */
(function (global) {
  "use strict";
  const CAP = 20000;
  const ASPECT_H = 0.7; /* wide, low mound; a little extra height so the heap reads in 3D */
  const SAFE = { top: 0.22, bottom: 0.64, left: 0.05, right: 0.95 };
  let renderer, scene, camera, canvas;
  let meshBody, meshVisor, meshCubeB, meshCubeW;
  let dummy = null;
  let vTmp = null;
  let raf = 0;
  let started = false;
  let lights = {};
  let heapMeta = [];
  let lastSig = "";
  const ORIGIN_Z = 6.15;
  let SPAN = 8.4;

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

  function scaleToWidth(g, width) {
    g.computeBoundingBox();
    const s = width / Math.max(1e-6, g.boundingBox.max.x - g.boundingBox.min.x);
    g.scale(s, s, s);
    g.computeBoundingBox();
    g.translate(0, -g.boundingBox.min.y, 0);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return s;
  }

  /* Iconic Quest-3 silhouette: one rounded white shell + a large dark front visor.
     Unit width = 1, sitting on y = 0, visor on the -Z face. */
  function headsetParts(THREE) {
    const shell = roundedBoxGeom(THREE, 1.0, 0.50, 0.64, 0.15);
    const brow = roundedBoxGeom(THREE, 0.92, 0.12, 0.36, 0.05);
    brow.translate(0, 0.44, -0.08);
    const body = mergeBufferGeometries(THREE, [shell, brow]);
    shell.dispose();
    brow.dispose();
    const visor = roundedBoxGeom(THREE, 0.88, 0.36, 0.14, 0.06);
    /* Front face of a 0.64-deep shell is at z ≈ -0.32; plant the visor there. */
    visor.translate(0, 0.07, -0.44);
    body.computeBoundingBox();
    visor.computeBoundingBox();
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

  /* Wide, low, rounded mound. Height ≈ ASPECT_H × radius.
     Build a full ellipsoid lattice, then keep the n points closest to the
     centre so the pile is a solid 3D heap (not a flat filled disk). */
  function settleMound(n, itemR, seed) {
    const empty = { pos: [], R: itemR, H: itemR };
    if (n <= 0) return empty;
    const rng = seedRng(seed);
    const spacing = itemR * 1.72;
    const yStep = spacing * 0.58;
    function lattice(R) {
      const H = Math.max(itemR * 1.2, ASPECT_H * R);
      const pts = [];
      for (let y = itemR; y <= H + itemR * 0.02; y += yStep) {
        const t = Math.min(1, Math.max(0, (y - itemR) / Math.max(H - itemR, itemR)));
        const layerR = R * Math.sqrt(Math.max(0, 1 - t * t));
        const rings = layerR < spacing * 0.4 ? 0 : Math.max(1, Math.round(layerR / spacing));
        for (let k = 0; k <= rings; k++) {
          const rad = rings === 0 ? 0 : (k / rings) * layerR;
          const count = rad < spacing * 0.4 ? 1 : Math.max(1, Math.round((2 * Math.PI * rad) / spacing));
          const rot = rng() * Math.PI * 2;
          for (let i = 0; i < count; i++) {
            const a = rot + (i + (rng() - 0.5) * 0.08) * (2 * Math.PI / Math.max(count, 1));
            const rr = count === 1 ? rad + (rng() - 0.5) * itemR * 0.08 : rad + (rng() - 0.5) * spacing * 0.08;
            const x = Math.cos(a) * rr;
            const z = Math.sin(a) * rr;
            const yy = y + (rng() - 0.5) * itemR * 0.08;
            const d = (x * x + z * z) / (R * R) + ((yy - itemR) * (yy - itemR)) / (H * H);
            pts.push({
              x: x,
              y: yy,
              z: z,
              d: d,
              rx: (rng() - 0.5) * 0.7,
              ry: rng() * Math.PI * 2,
              rz: (rng() - 0.5) * 0.45,
              s: 0.9 + rng() * 0.2,
              faceCam: rng() < 0.7
            });
          }
        }
      }
      pts.sort(function (a, b) { return a.d - b.d; });
      return { pts: pts, R: R, H: H };
    }
    let R = itemR * (0.85 * Math.cbrt(Math.max(n, 1)) + 0.7);
    let pack = lattice(R);
    let guard = 0;
    while (pack.pts.length < n && guard++ < 16) {
      R *= 1.12;
      pack = lattice(R);
    }
    const pos = pack.pts.slice(0, n);
    let maxRad = 0, maxY = itemR;
    for (let i = 0; i < pos.length; i++) {
      maxRad = Math.max(maxRad, Math.hypot(pos[i].x, pos[i].z));
      maxY = Math.max(maxY, pos[i].y);
    }
    return { pos: pos, R: Math.max(itemR, maxRad), H: Math.max(itemR, maxY) };
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
      if ("toneMappingExposure" in renderer) renderer.toneMappingExposure = 1.28;
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(28, 1, 0.1, 80);

      scene.add(new THREE.AmbientLight(0xfff6ea, 0.48));
      const hemi = new THREE.HemisphereLight(0xf4f0ff, 0x4a3420, 1.45);
      scene.add(hemi);
      const moon = new THREE.DirectionalLight(0xfff6e0, 1.85);
      moon.position.set(7, 14, 5);
      scene.add(moon);
      const fill = new THREE.DirectionalLight(0xc5d2f0, 0.62);
      fill.position.set(-8, 6, 4);
      scene.add(fill);
      const key = new THREE.DirectionalLight(0xfff8f0, 0.9);
      key.position.set(0, 5.2, 12);
      scene.add(key);
      const fire = new THREE.PointLight(0xff8a33, 2.35, 28, 1.15);
      fire.position.set(0, 1.2, 8.9);
      scene.add(fire);
      lights.fire = fire;

      const hs = headsetParts(THREE);
      const matBody = new THREE.MeshStandardMaterial({
        color: 0xf6f5f8, roughness: 0.32, metalness: 0.08,
        emissive: 0xe8e4de, emissiveIntensity: 0.42
      });
      const matVisor = new THREE.MeshStandardMaterial({
        color: 0x05060a, roughness: 0.1, metalness: 0.82,
        emissive: 0x0a0c14, emissiveIntensity: 0.18
      });
      const matB = new THREE.MeshStandardMaterial({
        color: 0x0b0b0d, roughness: 0.32, metalness: 0.22,
        emissive: 0x161616, emissiveIntensity: 0.16
      });
      const matW = new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.28, metalness: 0.06,
        emissive: 0xf2efe8, emissiveIntensity: 0.38
      });
      const cubeG = roundedBoxGeom(THREE, 1, 1, 1, 0.16);
      meshBody = new THREE.InstancedMesh(hs.body, matBody, CAP);
      meshVisor = new THREE.InstancedMesh(hs.visor, matVisor, CAP);
      meshCubeB = new THREE.InstancedMesh(cubeG, matB, CAP);
      meshCubeW = new THREE.InstancedMesh(cubeG, matW, CAP);
      [meshBody, meshVisor, meshCubeB, meshCubeW].forEach(m => {
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
    renderer.setSize(W, H, false);
    camera.aspect = W / Math.max(1, H);
    camera.fov = 28;
    /* Closer, slightly downward view of the clearing between the trees and the fire. */
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

  function writeInstances(mesh, items, wx, wz, scale, faceCam) {
    if (!mesh) return;
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
        const yaw = Math.atan2(dx, -dz);
        const pitch = -Math.atan2(dy, Math.hypot(dx, dz) || 1);
        dummy.rotation.set(pitch + (p.rx || 0) * 0.4, yaw + (p.ry || 0) * 0.32, (p.rz || 0) * 0.4);
      } else {
        dummy.rotation.set(p.rx || 0, p.ry || 0, p.rz || 0);
      }
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(n, dummy.matrix);
      n++;
    }
    mesh.count = n;
  }

  function dayAnchor(i, n, span) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const recede = Math.abs(t - 0.5) * 2;
    /* Gentle arc: centre closer to the camera (larger z). */
    const wx = -span / 2 + span * t;
    const wz = ORIGIN_Z + (1 - recede * recede) * 0.28;
    return { t: t, recede: recede, wx: wx, wz: wz };
  }

  function update(slots) {
    if (!renderer) return [];
    resize();
    const sig = JSON.stringify(slots.map(s => [s.ymd, s.participants || 0, s.engagement || 0, s.index, slots.length])) + "|v3";
    const size = (canvas.clientWidth || 0) + "x" + (canvas.clientHeight || 0);
    const full = sig + "|" + size;
    if (full === lastSig && heapMeta.length) return heapMeta;
    lastSig = full;

    [meshBody, meshVisor, meshCubeB, meshCubeW].forEach(m => { m.count = 0; });
    heapMeta = [];

    const n = Math.max(slots.length, 1);
    const span = SPAN;
    const W = canvas.clientWidth || global.innerWidth || 1920;
    const H = canvas.clientHeight || global.innerHeight || 1080;
    const slotW = span / n;
    const maxP = Math.max(0, ...slots.map(s => s.participants || 0));
    const maxE = Math.max(0, ...slots.map(s => s.engagement || 0));

    /* Pick a unit item radius that keeps the busiest day's two heaps in their slot
       and the tallest mound under the sky totals. Geometries are unit-sized. */
    function moundR(count, itemR) { return settleMound(Math.max(1, count), itemR, "fit").R; }
    let itemR = slotW * 0.2;
    const unitP = maxP > 0 ? moundR(maxP, 1) : 1;
    const unitE = maxE > 0 ? moundR(maxE, 1) : 1;
    const widthUnits = (maxP > 0 ? unitP * 2 : 0) + (maxE > 0 ? unitE * 2 : 0) + (maxP > 0 && maxE > 0 ? 0.22 : 0);
    if (widthUnits > 0) itemR = Math.min(itemR, (slotW * 1.34) / widthUnits);

    const heightUnits = ASPECT_H * Math.max(maxP > 0 ? unitP : 0, maxE > 0 ? unitE : 0, 1);
    const mid = dayAnchor(Math.floor((n - 1) / 2), n, span);
    const groundPt = project(mid.wx, 0, mid.wz);
    const upPt = project(mid.wx, 1, mid.wz);
    const pxPerWorldY = Math.abs(groundPt.y - upPt.y) || 1;
    const pxPerWorldX = Math.abs(project(mid.wx + 1, 0, mid.wz).x - groundPt.x) || 1;
    const maxHpx = Math.max(40, groundPt.y - SAFE.top * H - 58);
    if (heightUnits * pxPerWorldY * itemR > maxHpx) {
      itemR = maxHpx / (heightUnits * pxPerWorldY);
    }
    /* Keep individual headsets/cubes readable (~12px wide), even if neighbouring heaps kiss. */
    const minItemR = 18 / (2.35 * pxPerWorldX);
    itemR = Math.max(itemR, minItemR, 0.018);
    if (heightUnits * pxPerWorldY * itemR > maxHpx * 1.15) {
      itemR = Math.max(minItemR * 0.85, maxHpx / (heightUnits * pxPerWorldY));
    }
    const instScale = itemR * 2.35; /* slightly chunkier than the packing radius */

    slots.forEach((s, i) => {
      const a = dayAnchor(i, n, span);
      const pN = Math.max(0, Math.floor(s.participants || 0));
      const eN = Math.max(0, Math.floor(s.engagement || 0));
      const filled = pN > 0 || eN > 0;
      const rec = {
        ymd: s.ymd,
        filled: filled,
        groundX: project(a.wx, 0, a.wz).x,
        groundY: project(a.wx, 0, a.wz).y,
        p: null,
        e: null
      };
      if (filled) {
        const pM = pN > 0 ? settleMound(pN, itemR, "p:" + s.ymd) : null;
        const eM = eN > 0 ? settleMound(eN, itemR, "e:" + s.ymd) : null;
        const gap = itemR * 0.45;
        const pWid = pM ? pM.R * 2 : 0;
        const eWid = eM ? eM.R * 2 : 0;
        let pOff = 0, eOff = 0;
        if (pM && eM) {
          pOff = -(eWid / 2 + gap / 2);
          eOff = (pWid / 2 + gap / 2);
        }
        if (pM) {
          writeInstances(meshBody, pM.pos, a.wx + pOff, a.wz, instScale, true);
          writeInstances(meshVisor, pM.pos, a.wx + pOff, a.wz, instScale, true);
          const top = project(a.wx + pOff, pM.H + itemR * 0.6, a.wz);
          const g = project(a.wx + pOff, 0, a.wz);
          rec.p = { n: pN, topX: top.x, topY: top.y, groundX: g.x, groundY: g.y, H: pM.H };
        }
        if (eM) {
          const black = [], white = [];
          for (let k = 0; k < eM.pos.length; k++) (k % 2 === 0 ? black : white).push(eM.pos[k]);
          writeInstances(meshCubeB, black, a.wx + eOff, a.wz, instScale, false);
          writeInstances(meshCubeW, white, a.wx + eOff, a.wz, instScale, false);
          const top = project(a.wx + eOff, eM.H + itemR * 0.6, a.wz);
          const g = project(a.wx + eOff, 0, a.wz);
          rec.e = { n: eN, topX: top.x, topY: top.y, groundX: g.x, groundY: g.y, H: eM.H };
        }
      }
      heapMeta.push(rec);
    });

    [meshBody, meshVisor, meshCubeB, meshCubeW].forEach(m => { m.instanceMatrix.needsUpdate = true; });
    return heapMeta;
  }

  function start() {
    if (started || !renderer) return;
    started = true;
    function loop(t) {
      raf = global.requestAnimationFrame(loop);
      if (lights.fire) {
        lights.fire.intensity = 1.85 + Math.sin(t * 0.007) * 0.2 + Math.sin(t * 0.019) * 0.1;
      }
      renderer.render(scene, camera);
    }
    loop(0);
  }

  function ready() { return !!renderer; }

  global.XRPiles3D = { init: init, update: update, start: start, resize: resize, ready: ready, project: project };
})(window);
