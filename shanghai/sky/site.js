// The site's own layer over the Claude Design scene (sky/bundle.js).
// Loaded as a deferred classic script, so it runs just before the bundle: it
// picks the device tier first, then finishes its work on the bundle's
// 'sky:ready' event, when window.__sky exposes the app (hooks added by
// tools/shanghai_import.py). Desktop with a mouse or trackpad is left exactly
// as designed; everything here is for phones and touch screens.
//
//   ?tier=phone|full   force a tier (test the phone tier on a desktop)
//   ?fps               frame-rate readout
(() => {
  'use strict';
  const qs = new URLSearchParams(location.search);
  const coarse = matchMedia('(pointer: coarse)').matches;
  const phoneSized = Math.min(screen.width, screen.height) < 600;
  const tier = qs.get('tier') === 'phone' || qs.get('tier') === 'full' ? qs.get('tier') : (coarse && phoneSized ? 'phone' : 'full');
  window.__skyTier = tier;           // read by the bundle hooks: car/pedestrian counts, starting quality
  window.__skyTouchTour = true;      // touch: only a real drag or pinch leaves the tour (mouse is unchanged)
  document.documentElement.dataset.tier = tier;
  if (coarse) document.documentElement.classList.add('touch');

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const safely = (name, fn) => { try { fn(); } catch (err) { console.warn('[skyscape site] ' + name + ' skipped:', err); } };

  addEventListener('sky:ready', () => {
    const S = window.__sky; if (!S) return;
    const THREE = window.__THREE, scene = S.mirror.scene, cam = S.camera, canvas = S.renderer.domElement;
    // per-frame work runs inside the app's own frame, just before the main pass is drawn
    // (so it also runs for frames stepped by tools, and never for frames that aren't drawn)
    const perFrame = [], before = scene.onBeforeRender;
    scene.onBeforeRender = function (renderer, sc, camera) { if (before) before.apply(this, arguments); if (camera === cam) for (const f of perFrame) f(); };

    if (tier === 'phone') safely('phone tier', () => phoneTier(S, THREE, scene, cam, perFrame));
    safely('portrait framing', () => framing(S, cam, perFrame));
    if (coarse) {
      safely('touch tour', () => touchTour(S, canvas));
      safely('tilt', () => tilt(S));
    }
    if (qs.has('fps')) safely('fps', () => fps(S));
  }, { once: true });

  // ---------------------------------------------------------------- 1 · phone tier
  // Lighter trees in culled blocks with a far LOD, a lean reflection redrawn
  // every other frame. (Car and pedestrian counts and the starting quality
  // come from the bundle hooks.)
  function phoneTier(S, THREE, scene, cam, perFrame) {
    const originals = scene.children.filter(o => o.isInstancedMesh && o.userData.tree);
    if (originals.length) {
      const ref = originals[0].geometry;
      const smooth = (g, x, y, z) => { const p = g.attributes.position, n = g.attributes.normal, v = new THREE.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).normalize(); n.setXYZ(i, v.x, v.y, v.z); } return g.translate(x, y, z); };
      const merge = parts => { // non-indexed merge carrying whatever attributes the design's tree geometry has
        const names = Object.keys(ref.attributes), out = new THREE.BufferGeometry();
        const flat = parts.map(g => g.index ? g.toNonIndexed() : g);
        for (const name of names) {
          const size = ref.attributes[name].itemSize, arrs = flat.map(g => g.attributes[name] ? g.attributes[name].array : new Float32Array(g.attributes.position.count * size));
          const all = new Float32Array(arrs.reduce((a, b) => a + b.length, 0)); let o = 0; for (const a of arrs) { all.set(a, o); o += a.length; }
          out.setAttribute(name, new THREE.BufferAttribute(all, size));
        }
        return out;
      };
      // same silhouette as the design's tree (trunk + three crowns), 70 triangles instead of 260
      const near = merge([new THREE.CylinderGeometry(0.3, 0.45, 4, 5, 1, true).translate(0, 2, 0), smooth(new THREE.IcosahedronGeometry(3.0, 0), 0, 5.6, 0), smooth(new THREE.IcosahedronGeometry(2.2, 0), 1.6, 6.8, 0.6), smooth(new THREE.IcosahedronGeometry(1.9, 0), -1.3, 7.0, -0.9)]);
      // a single crown for trees a few pixels tall
      const far = merge([smooth(new THREE.OctahedronGeometry(3.4, 0), 0.1, 6.0, -0.1)]);
      const CELL = 640, NEAR = 1300, m = new THREE.Matrix4(), c = new THREE.Color(), chunks = [];
      for (const tm of originals) {
        const cells = new Map();
        for (let i = 0; i < tm.count; i++) { tm.getMatrixAt(i, m); const k = Math.floor(m.elements[12] / CELL) + ',' + Math.floor(m.elements[14] / CELL); (cells.get(k) || cells.set(k, []).get(k)).push(i); }
        for (const idx of cells.values()) {
          const ch = new THREE.InstancedMesh(near, tm.material, idx.length);
          idx.forEach((i, j) => { tm.getMatrixAt(i, m); ch.setMatrixAt(j, m); if (tm.instanceColor) { tm.getColorAt(i, c); ch.setColorAt(j, c); } });
          ch.castShadow = tm.castShadow; ch.receiveShadow = tm.receiveShadow; ch.frustumCulled = true; ch.userData.tree = true;
          ch.computeBoundingSphere(); chunks.push(ch); scene.add(ch);
        }
        scene.remove(tm);
      }
      const eye = new THREE.Vector3();
      perFrame.push(() => { eye.setFromMatrixPosition(cam.matrixWorld); for (const ch of chunks) { const g = ch.boundingSphere.center.distanceTo(eye) - ch.boundingSphere.radius < NEAR ? near : far; if (ch.geometry !== g) ch.geometry = g; } });
      S.mirror.hide.push(...chunks);
    }
    // the reflection leaves out what is too small to read in it
    const hide = new Set(S.mirror.hide);
    for (const o of [S.traffic && S.traffic.im, S.crowd && S.crowd.im]) if (o && !hide.has(o)) { S.mirror.hide.push(o); hide.add(o); }
    for (const o of scene.children) {
      if (!o.isInstancedMesh || hide.has(o) || o.userData.tree) continue;
      const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox();
      if (g.boundingBox.max.y - g.boundingBox.min.y < 12) { S.mirror.hide.push(o); hide.add(o); }
    }
    // …and is redrawn every other frame
    const render = S.mirror.render.bind(S.mirror); let n = 0;
    S.mirror.render = (camera, onBefore) => { if (n++ & 1) return; render(camera, onBefore); };
  }

  // ---------------------------------------------------------------- 4 · portrait framing
  // The tour's cameras were composed for a wide screen. On a tall screen the
  // establishing shots widen (keeping a laptop-like horizontal view) and lift
  // their subject above the caption; close-ups keep their tight portrait crop.
  // a0: widen until the view is as wide as a frame of this aspect; lift: share of the height the subject moves up.
  const FRAMING = [
    { a0: 1.2, lift: 0.08 },  // 01 序 Approach — the river bend and all three supertalls
    null,                     // 02 陆家嘴 Lujiazui — close-up: Shanghai Tower fills the tall frame as it is
    { a0: 1.0, lift: 0.04 },  // 03 东方明珠 The Pearl — the whole tower, antenna to base
    { a0: 1.0, lift: 0.04 },  // 04 外滩 The Bund — more of the promenade
    { a0: 1.0, lift: 0.04 },  // 05 苏州河 Suzhou Creek — the bridge as well as Broadway Mansions
    { a0: 1.2, lift: 0.08 },  // 06 渡轮 River traffic — skyline and its reflection above the caption
    { a0: 1.2, lift: 0.08 },  // 07 浦西 Puxi at night — the Bund skyline above the caption
    { a0: 1.2, lift: 0.06 },  // 08 终 Finale — the skyline low, sky above it for the fireworks
  ];
  function framing(S, cam, perFrame) {
    const baseT = Math.tan(cam.fov * Math.PI / 360);
    let cur = null, lift = 0, lastAspect = 0;
    const upm = cam.updateProjectionMatrix.bind(cam);
    // an off-axis lift that survives the app's own updateProjectionMatrix calls (resize, quality)
    cam.updateProjectionMatrix = function () { upm(); if (lift) { this.projectionMatrix.elements[9] -= 2 * lift; this.projectionMatrixInverse.copy(this.projectionMatrix).invert(); } };
    const apply = () => {
      const a = innerWidth / Math.max(1, innerHeight); lastAspect = a;
      let t = baseT, l = 0;
      if (cur && a < cur.a0) { t = baseT * cur.a0 / a; l = cur.lift; }
      cam.fov = 2 * Math.atan(t) * 180 / Math.PI; lift = l; cam.updateProjectionMatrix();
    };
    window.__skyOnChapter = i => { cur = FRAMING[i] === undefined ? null : FRAMING[i]; apply(); };
    // free camera keeps the framing it left the tour with; re-fit when the screen turns
    perFrame.push(() => { const a = innerWidth / Math.max(1, innerHeight); if (Math.abs(a - lastAspect) > 1e-3) apply(); });
  }

  // ---------------------------------------------------------------- 7 · tap vs drag (touch)
  // A tap no longer ends the tour: on a tower it pauses the tour and opens the
  // card, and closing the card carries on. A drag or pinch leaves the tour and
  // turns straight into orbiting.
  function touchTour(S, canvas) {
    let g = null;
    const hand = src => { const ev = new PointerEvent('pointerdown', { pointerId: src.pointerId, pointerType: 'touch', isPrimary: src.isPrimary, clientX: src.clientX, clientY: src.clientY, screenX: src.screenX, screenY: src.screenY, button: 0, buttons: 1, width: src.width, height: src.height, pressure: src.pressure || 0.5, bubbles: true, cancelable: true, composed: true }); ev.__skyReplay = true; canvas.dispatchEvent(ev); };
    const leave = () => { const first = g.down; g = null; S.exitTour(); hand(first); };
    // window capture: runs before any listener on the canvas, in every browser
    addEventListener('pointerdown', e => {
      if (e.target !== canvas || e.pointerType !== 'touch' || e.__skyReplay || S.state.mode !== 'tour') return;
      if (!g) g = { id: e.pointerId, x: e.clientX, y: e.clientY, down: e };
      else leave();            // a second finger: pinch — this real event then reaches the orbit controls, now enabled
    }, true);
    addEventListener('pointermove', e => { if (g && e.pointerId === g.id && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 10) leave(); }, true);
    const end = e => { if (g && e.pointerId === g.id) g = null; };
    addEventListener('pointerup', end, true); addEventListener('pointercancel', end, true);

    // the card in tour mode: pause under it, carry on when it closes
    const card = S.hud.card; let paused = false;
    new MutationObserver(() => {
      const on = card.classList.contains('on');
      if (on && S.state.mode === 'tour' && !document.body.classList.contains('sky-card')) {
        document.body.classList.add('sky-card');
        if (S.state.playing) { S.state.playing = false; paused = true; }
      } else if (!on && document.body.classList.contains('sky-card')) {
        document.body.classList.remove('sky-card');
        if (paused && S.state.mode === 'tour') S.state.playing = true;
        paused = false;
      }
    }).observe(card, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(() => { if (document.body.dataset.mode !== 'tour') { document.body.classList.remove('sky-card'); paused = false; } })
      .observe(document.body, { attributes: true, attributeFilter: ['data-mode'] });
  }

  // ---------------------------------------------------------------- 11 · tilt to look
  // The tour's mouse parallax, driven by the phone's tilt. Off until asked for:
  // iOS needs a tap to grant motion access.
  function tilt(S) {
    if (!('DeviceOrientationEvent' in window)) return;
    const row = document.getElementById('timeline'); if (!row) return;
    const btn = document.createElement('button');
    btn.id = 'tiltBtn'; btn.type = 'button'; btn.setAttribute('aria-pressed', 'false'); btn.setAttribute('aria-label', 'Tilt to look'); btn.title = 'Tilt to look';
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="8" y="4" width="8" height="16" rx="2" transform="rotate(-18 12 12)"/><path d="M3.5 9.5a9 9 0 0 0 0 5M20.5 9.5a9 9 0 0 1 0 5"/></svg>';
    row.appendChild(btn);
    let on = false, base = null;
    const onOri = e => {
      if (e.beta == null || e.gamma == null) return;
      const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
      let x = e.gamma, y = e.beta;
      if (ang === 90) { x = e.beta; y = -e.gamma; } else if (ang === -90 || ang === 270) { x = -e.beta; y = e.gamma; }
      if (!base) base = { x, y };
      base.x += (x - base.x) * 0.004; base.y += (y - base.y) * 0.004;   // drift back to however the phone is being held
      S.par.x = clamp((x - base.x) / 16, -1, 1); S.par.y = clamp((base.y - y) / 16, -1, 1);
    };
    const set = v => {
      on = v; base = null; btn.setAttribute('aria-pressed', String(v));
      if (v) addEventListener('deviceorientation', onOri); else { removeEventListener('deviceorientation', onOri); S.par.x = S.par.y = 0; }
    };
    btn.addEventListener('click', () => {
      if (on) return set(false);
      const ask = window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission;
      if (typeof ask === 'function') ask.call(DeviceOrientationEvent).then(p => { if (p === 'granted') set(true); }).catch(() => {});
      else set(true);
    });
  }

  // ---------------------------------------------------------------- ?fps
  function fps(S) {
    const el = document.createElement('div'); el.id = 'skyFps'; document.body.appendChild(el);
    let n = 0, t0 = performance.now();
    const loop = () => {
      requestAnimationFrame(loop); n++; const t = performance.now();
      if (t - t0 >= 1000) { el.textContent = `${Math.round(n * 1000 / (t - t0))} fps · ${tier} · ${S.quality} · ${S.renderer.getPixelRatio()}x`; n = 0; t0 = t; }
    };
    requestAnimationFrame(loop);
  }
})();
