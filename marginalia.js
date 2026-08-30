/* The marginalia — one drawing system, two homes.
   Desktop (>1080px): a fixed full-viewport canvas; the scene lives in the right
   margin and follows the section being read. The arm periodically reaches into
   the lede, picks up a term, and swaps it for another.
   Phones: each scene becomes a small in-flow vignette band under its section,
   autonomous, and reactive to touch.
   Shared voice: 1px hairlines, --ink-3 structure, --rule construction lines,
   --accent for the one live detail. */
(() => {
  'use strict';
  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  const mqFine = matchMedia('(hover: hover) and (pointer: fine)');
  const mqDark = matchMedia('(prefers-color-scheme: dark)');
  const mqWide = matchMedia('(min-width: 1081px)');
  const PI = Math.PI, TAU = 2 * PI;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const FOCUS = 0.42;
  // The "reading line": a fraction of the viewport, but clamped so very tall
  // windows keep it near the top of the view rather than deep into the page.
  const focusPx = (h) => Math.min(h * FOCUS, 520);

  const tok = {};
  function readTokens() {
    const cs = getComputedStyle(document.documentElement);
    for (const k of ['bg', 'ink', 'ink-2', 'ink-3', 'rule', 'accent', 'accent-2'])
      tok[k] = cs.getPropertyValue('--' + k).trim();
  }

  // The active drawing surface. Runners point G at their canvas before calling scenes.
  const G = { ctx: null, W: 0, H: 0 };

  /* ================= the rotating term in the lede ================= */
  const TERMS = ['robotics', 'perception', 'world models', 'embodied AI', 'sim-to-real RL'];
  const swapEl = document.getElementById('swapterm');
  let termIdx = 0;
  let meas = null;
  function domWidth(text) {
    if (!swapEl) return 0;
    if (!meas) {
      meas = document.createElement('span');
      meas.className = 'swap';
      meas.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;width:auto;border:0;';
      swapEl.parentNode.appendChild(meas);
    }
    meas.textContent = text;
    return meas.getBoundingClientRect().width;
  }
  // Animate the sentence gap from the old width to the new one.
  function setTermAnimated(next) {
    if (!swapEl) return;
    swapEl.style.width = swapEl.getBoundingClientRect().width + 'px';
    void swapEl.offsetWidth;
    swapEl.textContent = next;
    swapEl.style.width = domWidth(next) + 'px';
  }
  function settleTermWidth() { if (swapEl) setTimeout(() => { swapEl.style.width = 'auto'; }, 500); }
  const nextTerm = () => TERMS[(termIdx + 1) % TERMS.length];
  const advanceTerm = () => { termIdx = (termIdx + 1) % TERMS.length; };
  // Fallback swap (phones, or when the arm cannot do the job): a quiet crossfade.
  let fading = false;
  function fadeSwap() {
    if (!swapEl || fading) return;
    fading = true;
    swapEl.style.transition = 'opacity 260ms ease, width 450ms cubic-bezier(.4,0,.2,1)';
    swapEl.style.opacity = '0';
    setTimeout(() => {
      setTermAnimated(nextTerm()); advanceTerm();
      swapEl.style.opacity = '1';
      setTimeout(() => { settleTermWidth(); fading = false; }, 470);
    }, 280);
  }

  /* ================= scene 1 — the reaching arm ================= */
  const arm = (() => {
    let box = { x0: 0, w: 0, h: 0, band: false };
    let L = [150, 120, 80], L0 = [150, 120, 80], reach = 0, baseX = 0, baseY = 0;
    let stretch = 1, stretchTo = 1;
    const lim = [[PI / 2 + 0.35, 1.5 * PI - 0.3], [-2.6, -0.2], [-1.0, 1.0]];
    const rest = [PI + 0.55, -1.9, 0.65];
    let q = rest.slice(), v = [0, 0, 0], g = rest.slice();
    const OMEGA = [4.2, 5.2, 6.8], ZETA = [0.72, 0.68, 0.62], VMAX = [2.5, 3.5, 4.5];
    let stiff = 0.45, arcA = 0, simT = 0;
    const HOVER = 16;
    const reachOf = (l) => {
      const c = Math.cos(lim[1][1]), l23 = l[1] + l[2];
      return Math.sqrt(l[0] * l[0] + l23 * l23 + 2 * l[0] * l23 * c);
    };

    /* ---- the pick-and-place task (desktop only).
       The word is a DOM element for the whole ride: at the grab it is promoted to
       position:fixed and then follows the fk tip every frame, so the gripper and
       the word can never separate; a spacer keeps (and later re-sizes) its gap in
       the sentence. The tip itself runs a time-based min-jerk waypoint path, and
       the joints are driven directly by IK during the task — the smoothness comes
       from the path, the physicality from the swing. */
    let task = null;          // { phase, t, T, from:{x,y}, to:{x,y} }
    let carrying = false, carryW = 0, closeAmt = 0;
    let spacer = null, seatDx = 0, seatDy = 0;
    let phi = 0, phiV = 0, tipPX = 0;
    const mj = (t) => { t = clamp(t, 0, 1); return t * t * t * (10 + t * (-15 + 6 * t)); };

    function wordGrip() {         // live grip point: top-centre of the word in the flow
      const r = swapEl.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top, r };
    }
    function seatGrip() {         // where the word must be set down, from the spacer
      const r = spacer.getBoundingClientRect();
      return { x: r.left + seatDx + carryW / 2, y: r.top + seatDy };
    }
    function tipNow() { const f = fk(q); return { x: f.x[3], y: f.y[3] }; }
    function goto(phase, T, from, to) { task = { phase, t: 0, T, from, to }; }
    function target() {
      const s = mj(task.t / task.T);
      return { x: task.from.x + (task.to.x - task.from.x) * s,
               y: task.from.y + (task.to.y - task.from.y) * s };
    }

    const travelT = (a, b) => clamp(0.4 + Math.hypot(b.x - a.x, b.y - a.y) / 1500, 0.55, 1.15);
    function startTask() {
      if (task || !swapEl || box.band || mqReduce.matches) return false;
      const gp = wordGrip();
      const from = tipNow(), to = { x: gp.x, y: gp.y - 16 };
      goto('approach', travelT(from, to), from, to);
      closeAmt = 0; phi = 0; phiV = 0;
      return true;
    }
    function abortTask() {
      if (!task) return;
      if (carrying) {
        swapEl.classList.remove('carried');
        swapEl.style.left = swapEl.style.top = swapEl.style.transform = swapEl.style.transformOrigin = '';
        swapEl.style.opacity = ''; swapEl.style.transition = '';
      }
      if (spacer) { spacer.remove(); spacer = null; }
      carrying = false; closeAmt = 0; task = null; stretchTo = 1; v = [0, 0, 0];
    }
    const busy = () => !!task;

    function attachWord() {
      const r = swapEl.getBoundingClientRect();
      spacer = document.createElement('span');
      spacer.className = 'swap-gap';
      spacer.style.width = r.width + 'px';
      swapEl.parentNode.insertBefore(spacer, swapEl);
      const sr = spacer.getBoundingClientRect();
      seatDx = r.left - sr.left; seatDy = r.top - sr.top;   // baseline vs box offsets, measured not assumed
      carryW = r.width;
      swapEl.classList.add('carried');
      swapEl.style.left = r.left + 'px';
      swapEl.style.top = r.top + 'px';
      swapEl.style.transformOrigin = '50% 0';
      carrying = true;
    }
    function moveWord(tip) {
      swapEl.style.left = (tip.x - carryW / 2) + 'px';
      swapEl.style.top = tip.y + 'px';
      swapEl.style.transform = 'rotate(' + phi + 'rad)';
    }
    function releaseWord() {
      swapEl.classList.remove('carried');
      swapEl.style.left = swapEl.style.top = swapEl.style.transform = swapEl.style.transformOrigin = '';
      swapEl.style.opacity = ''; swapEl.style.transition = '';
      if (spacer) { spacer.remove(); spacer = null; }
      carrying = false;
    }

    function layout(b) {
      box = b;
      baseX = b.x0 + b.w - 9;
      baseY = b.band ? b.h * 0.52 : focusPx(b.h);
      const s = b.band
        ? clamp(Math.min((b.w * 0.62) / reachOf([150, 120, 80]), b.h / 300), 0.42, 0.85)
        : clamp(Math.min((b.w - 14) / reachOf([150, 120, 80]), b.h / 720), 0.45, 1);
      L0 = [150 * s, 120 * s, 80 * s];
      L = L0.map((x) => x * stretch);
      reach = reachOf(L);
    }
    function fk(a) {
      const a1 = a[0], a2 = a1 + a[1], a3 = a2 + a[2];
      const x1 = baseX + L[0] * Math.cos(a1), y1 = baseY + L[0] * Math.sin(a1);
      const x2 = x1 + L[1] * Math.cos(a2), y2 = y1 + L[1] * Math.sin(a2);
      const x3 = x2 + L[2] * Math.cos(a3), y3 = y2 + L[2] * Math.sin(a3);
      return { x: [baseX, x1, x2, x3], y: [baseY, y1, y2, y3], a3 };
    }
    function solveIK(tx, ty, px, py, iters) {
      const lam2 = 576;
      for (let it = 0; it < (iters || 3); it++) {
        const f = fk(g);
        let ex = tx - f.x[3], ey = ty - f.y[3];
        const d = Math.hypot(ex, ey);
        if (d < 0.02) break;
        if (d > 40) { ex *= 40 / d; ey *= 40 / d; }
        const jx = [], jy = [];
        for (let i = 0; i < 3; i++) { jx[i] = -(f.y[3] - f.y[i]); jy[i] = f.x[3] - f.x[i]; }
        let a00 = lam2, a01 = 0, a11 = lam2;
        for (let i = 0; i < 3; i++) { a00 += jx[i] * jx[i]; a01 += jx[i] * jy[i]; a11 += jy[i] * jy[i]; }
        const det = a00 * a11 - a01 * a01;
        const i00 = a11 / det, i01 = -a01 / det, i11 = a00 / det;
        const ux = i00 * ex + i01 * ey, uy = i01 * ex + i11 * ey;
        const want = Math.atan2(py - f.y[2], px - f.x[2]);
        let dw = want - f.a3; dw = Math.atan2(Math.sin(dw), Math.cos(dw));
        const b = [0.06 * (rest[0] - g[0]), 0.06 * (rest[1] - g[1]), 0.2 * dw];
        for (let i = 0; i < 3; i++) {
          const p0 = jx[i] * i00 + jy[i] * i01, p1 = jx[i] * i01 + jy[i] * i11;
          let dq = jx[i] * ux + jy[i] * uy + b[i];
          for (let j = 0; j < 3; j++) dq -= (p0 * jx[j] + p1 * jy[j]) * b[j];
          g[i] = clamp(g[i] + dq, lim[i][0], lim[i][1]);
        }
      }
    }
    function sway(t) {
      const s1 = TAU * t / 6, s2 = TAU * t / 14.3;
      g[0] = rest[0] + 0.030 * Math.sin(s1) + 0.020 * Math.sin(s2 + 0.4);
      g[1] = rest[1] + 0.055 * Math.sin(s1 + 0.9) + 0.035 * Math.sin(s2 + 1.7);
      g[2] = rest[2] + 0.080 * Math.sin(s1 + 1.8) + 0.050 * Math.sin(s2 + 2.9);
    }

    function stepTask(h) {
      task.t += h;
      const gp = carrying ? null : (spacer ? null : wordGrip());
      // keep the reach targets live: word (before grab) and seat (after) can move with scroll
      if (task.phase === 'approach') { const g2 = wordGrip(); task.to = { x: g2.x, y: g2.y - 16 }; }
      if (task.phase === 'descend') { const g2 = wordGrip(); task.to = { x: g2.x, y: g2.y }; }
      if (task.phase === 'in') { const s2 = seatGrip(); task.to = { x: s2.x, y: s2.y - 36 }; }
      if (task.phase === 'place') { const s2 = seatGrip(); task.to = { x: s2.x, y: s2.y }; }
      const tg = target();
      if (window.__armlog) { const f0 = fk(q); window.__armlog.push({ph: task.phase, t: +task.t.toFixed(2), tx: Math.round(tg.x), ty: Math.round(tg.y), ax: Math.round(f0.x[3]), ay: Math.round(f0.y[3]), st: +stretch.toFixed(2), stT: +stretchTo.toFixed(2)}); }
      // stretch so the whole SEGMENT is inside the workspace: size for the endpoint
      // and for the live target, so the arm is never caught short mid-traverse
      const needOf = (p) => Math.hypot(p.x - baseX, p.y - baseY) + 30;
      const need = Math.max(needOf(tg), needOf(task.to));
      const maxStretch = (Math.hypot(innerWidth, innerHeight) * 1.1 + 60) / reachOf(L0);
      stretchTo = clamp(need / reachOf(L0), 1, maxStretch);
      // fingers
      if (task.phase === 'descend') closeAmt = clamp(task.t / (task.T * 0.85), 0, 1);
      if (task.phase === 'release') closeAmt = 1 - clamp(task.t / task.T, 0, 1);
      // drive the joints directly at the moving target, hand pointing down at it
      solveIK(tg.x, tg.y, tg.x, tg.y + 60, 6);
      q = g.slice(); v = [0, 0, 0];
      const tip = tipNow();
      // phase transitions: time must have elapsed AND the tip must actually be there
      const errNow = Math.hypot(tip.x - task.to.x, tip.y - task.to.y);
      const settled = errNow < 4;
      const overdue = task.t > task.T + 0.6;
      if (task.t >= task.T && (settled || overdue)) {
        if (overdue && !settled && (task.phase === 'descend' || task.phase === 'place')) { abortTask(); return; }
        switch (task.phase) {
          case 'approach': { const g2 = wordGrip(); goto('descend', 0.3, tip, { x: g2.x, y: g2.y }); break; }
          case 'descend': { const g2 = wordGrip(); attachWord(); goto('lift', 0.34, tip, { x: g2.x, y: g2.y - 36 }); break; }
          case 'lift': goto('hold', 0.15, tip, tip); break;
          case 'hold': {
            // carry home: a gentle slope to a depot by the margin, near the arm's
            // resting height — always a reachable, easy fold-home pose
            const exit = { x: baseX - 58, y: baseY - 44 };
            goto('out', travelT(tip, exit), tip, exit); break;
          }
          case 'out': {
            // at the depot: the word dissolves into the next term in plain sight
            swapEl.style.transition = 'opacity 170ms ease';
            swapEl.style.opacity = '0';
            setTimeout(() => {
              if (!carrying) return;
              swapEl.textContent = nextTerm(); advanceTerm();
              carryW = swapEl.offsetWidth;
              if (spacer) spacer.style.width = domWidth(swapEl.textContent) + 'px';
              swapEl.style.opacity = '1';
            }, 220);
            goto('swapWait', 0.62, tip, tip); break;
          }
          case 'swapWait': { const s2 = seatGrip(); const to2 = { x: s2.x, y: s2.y - 36 }; goto('in', travelT(tip, to2), tip, to2); break; }
          case 'in': { const s2 = seatGrip(); goto('place', 0.36, tip, { x: s2.x, y: s2.y }); break; }
          case 'place': { releaseWord(); goto('release', 0.22, tip, { x: tip.x, y: tip.y - 12 }); break; }
          case 'release': task = null; stretchTo = 1; break;
        }
      }
      // the word swings a little against the tip's horizontal motion; it is damped
      // to vertical while being placed so it seats exactly
      const vx = (tip.x - tipPX) / Math.max(h, 1e-3); tipPX = tip.x;
      if (task && (task.phase === 'place' || task.phase === 'descend')) {
        phi *= Math.exp(-h / 0.07); phiV = 0;
      } else {
        const phiT = clamp(-vx * 0.00045, -0.28, 0.28);
        const aphi = 30 * (phiT - phi) - 10 * phiV;
        phiV += aphi * h; phi += phiV * h;
      }
      if (carrying) moveWord(tip);
    }

    function step(h, env) {
      simT += h;
      let outside = false;
      if (task && swapEl) {
        stepTask(h);
      } else if (env.idle) {
        sway(simT);
      } else {
        const cx = env.px, cy = env.py;
        const dx = cx - baseX, dy = cy - baseY, d = Math.hypot(dx, dy) || 1;
        outside = d > reach + HOVER;
        const r = outside ? reach : Math.max(d - HOVER, 30);
        solveIK(baseX + dx / d * r, baseY + dy / d * r, cx, cy);
      }
      const active = task ? 1 : (env.idle ? 0.45 : 1);
      stiff += (active - stiff) * (1 - Math.exp(-h / (env.idle && !task ? 1.0 : 0.35)));
      stretch += (stretchTo - stretch) * (1 - Math.exp(-h / (task ? 0.11 : 0.24)));
      L = L0.map((x) => x * stretch);
      reach = reachOf(L);
      arcA += (((outside && !task) ? 1 : 0) - arcA) * (1 - Math.exp(-h / 0.13));
      if (!task) {
        for (let i = 0; i < 3; i++) {
          const w = OMEGA[i] * stiff;
          const a = w * w * (g[i] - q[i]) - 2 * ZETA[i] * w * v[i];
          v[i] = clamp(v[i] + a * h, -VMAX[i], VMAX[i]);
          q[i] += v[i] * h;
        }
        if (q[1] > -0.02) q[1] = -0.02;
        if (carrying) moveWord(tipNow());   // belt and braces: never leave the word behind
      }
    }
    function draw(A, yOff) {
      const ctx = G.ctx;
      ctx.save(); ctx.translate(0, yOff);
      ctx.lineWidth = 1; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (arcA > 0.002) {
        const hi = Math.min(lim[0][1], 1.5 * PI - Math.acos(clamp((baseY - 24) / reach, -1, 1)));
        const lo = Math.max(lim[0][0], PI - Math.asin(clamp((G.H - 24 - baseY) / reach, -1, 1)));
        ctx.strokeStyle = tok.rule; ctx.globalAlpha = 0.75 * arcA * A; ctx.setLineDash([3, 5]);
        if (hi > lo) { ctx.beginPath(); ctx.arc(baseX, baseY, reach, lo, hi); ctx.stroke(); }
        ctx.setLineDash([]);
      }
      const gx = Math.round(baseX + 4) + 0.5, gy = Math.round(baseY) + 0.5;
      ctx.strokeStyle = tok['ink-3']; ctx.globalAlpha = 0.9 * A;
      ctx.beginPath(); ctx.moveTo(gx, gy - 14); ctx.lineTo(gx, gy + 14);
      for (let k = -1; k <= 1; k++) { ctx.moveTo(gx, gy + 8 * k - 3); ctx.lineTo(gx + 5, gy + 8 * k + 2); }
      ctx.stroke();
      const f = fk(q);
      ctx.beginPath(); ctx.moveTo(f.x[0], f.y[0]);
      for (let i = 1; i < 4; i++) ctx.lineTo(f.x[i], f.y[i]);
      ctx.stroke();
      ctx.fillStyle = tok.bg;
      for (const [i, r] of [[0, 3.5], [1, 2.8], [2, 2.8]]) {
        ctx.beginPath(); ctx.arc(f.x[i], f.y[i], r, 0, TAU); ctx.fill(); ctx.stroke();
      }
      // gripper: fingers ease closed over the word's top edge while it is held
      const ux = Math.cos(f.a3), uy = Math.sin(f.a3), nx = -uy, ny = ux;
      const tx = f.x[3], ty = f.y[3];
      const spread = 4 - 1.7 * closeAmt, tipIn = 5.2 - 2.7 * closeAmt;
      ctx.strokeStyle = tok.accent; ctx.globalAlpha = A;
      ctx.beginPath();
      ctx.moveTo(tx - spread * nx, ty - spread * ny); ctx.lineTo(tx + spread * nx, ty + spread * ny);
      ctx.moveTo(tx - spread * nx, ty - spread * ny); ctx.lineTo(tx - tipIn * nx + 9 * ux, ty - tipIn * ny + 9 * uy);
      ctx.moveTo(tx + spread * nx, ty + spread * ny); ctx.lineTo(tx + tipIn * nx + 9 * ux, ty + tipIn * ny + 9 * uy);
      ctx.stroke();
      ctx.restore();
    }
    return { layout, step, draw, startTask, abortTask, busy };
  })();

  /* ============ scene 2 — attention over patches ============ */
  const attn = (() => {
    const CO = 5, RO = 7;
    let box = { x0: 0, w: 0, h: 0, band: false };
    let fx = 0, fy = 0, fw = 0, fh = 0, cell = 0;
    let sal = [];
    let gx = 0.5, gy = 0.4, tx = 0.5, ty = 0.4, sacT = 0;
    (function seed() {
      let s = 41;
      for (let i = 0; i < CO * RO; i++) { s = (s * 16807) % 2147483647; sal.push(0.35 + 0.65 * (s / 2147483647)); }
    })();
    function layout(b) {
      box = b;
      if (b.band) { fh = Math.min(b.h - 26, 200); fw = fh / 1.32; }
      else { fw = Math.min(b.w - 44, 200); fh = fw * 1.32; }
      fx = b.x0 + (b.w - fw) / 2;
      fy = (b.band ? b.h / 2 : focusPx(b.h)) - fh / 2;
      cell = fw / (CO + 1);
    }
    const px = (c) => fx + cell * (c + 1);
    const py = (r) => fy + (fh / (RO + 1)) * (r + 1);
    function step(h, env) {
      if (env.idle) {
        sacT -= h;
        if (sacT <= 0) { sacT = 2.2 + 2.5 * Math.random(); tx = 0.15 + 0.7 * Math.random(); ty = 0.15 + 0.7 * Math.random(); }
      } else { tx = clamp(env.nx, 0, 1); ty = clamp(env.ny, 0, 1); }
      const k = 1 - Math.exp(-h / 0.22);
      gx += (tx - gx) * k; gy += (ty - gy) * k;
    }
    function draw(A, yOff) {
      const ctx = G.ctx;
      ctx.save(); ctx.translate(0, yOff);
      ctx.lineWidth = 1;
      ctx.strokeStyle = tok.rule; ctx.globalAlpha = 0.9 * A;
      ctx.strokeRect(fx + 0.5, fy + 0.5, fw, fh);
      const qx = fx + gx * fw, qy = fy + gy * fh;
      const links = [];
      for (let r = 0; r < RO; r++) for (let c = 0; c < CO; c++) {
        const x = px(c), y = py(r);
        const d2 = ((x - qx) ** 2 + (y - qy) ** 2) / (cell * cell);
        links.push({ x, y, w: Math.exp(-d2 / 7) * sal[r * CO + c] });
      }
      links.sort((a, b) => b.w - a.w);
      const wmax = links[0].w || 1;
      for (const Lk of links) {
        const lit = Lk.w / wmax;
        ctx.globalAlpha = (0.22 + 0.5 * lit) * A;
        ctx.fillStyle = tok['ink-3'];
        ctx.beginPath(); ctx.arc(Lk.x, Lk.y, 1.4 + 1.1 * lit, 0, TAU); ctx.fill();
      }
      ctx.strokeStyle = tok['ink-3'];
      for (let i = 0; i < 6; i++) {
        const Lk = links[i];
        ctx.globalAlpha = 0.38 * (Lk.w / wmax) * A;
        ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(Lk.x, Lk.y); ctx.stroke();
      }
      ctx.globalAlpha = A; ctx.strokeStyle = tok.accent;
      ctx.beginPath(); ctx.arc(qx, qy, 4.5, 0, TAU); ctx.stroke();
      ctx.fillStyle = tok.accent;
      ctx.beginPath(); ctx.arc(qx, qy, 1.2, 0, TAU); ctx.fill();
      ctx.restore();
    }
    return { layout, step, draw };
  })();

  /* ============ scene 3 — the Jansen leg ============ */
  const leg = (() => {
    const a = 38, b = 41.5, c = 39.3, d = 40.1, e = 55.8, f = 39.4, g = 36.7,
          h = 65.7, i = 49, j = 50, k = 61.9, l = 7.8, m = 15;
    function cc(p, r1, q, r2, side) {
      const dx = q[0] - p[0], dy = q[1] - p[1], dd = Math.hypot(dx, dy);
      const x = (dd * dd + r1 * r1 - r2 * r2) / (2 * dd);
      const y = side * Math.sqrt(Math.max(r1 * r1 - x * x, 0));
      const ux = dx / dd, uy = dy / dd;
      return [p[0] + x * ux - y * uy, p[1] + x * uy + y * ux];
    }
    const F = [0, 0], O = [a, l];
    function solve(th) {
      const C = [O[0] + m * Math.cos(th), O[1] + m * Math.sin(th)];
      const A = cc(F, b, C, j, 1), B = cc(F, d, A, e, 1);
      const D = cc(F, c, C, k, -1), E = cc(D, g, B, f, 1), Gp = cc(D, i, E, h, 1);
      return { F, O, C, A, B, D, E, G: Gp };
    }
    const BARS = [['C','A'], ['F','A'], ['F','B'], ['A','B'], ['F','D'], ['C','D'],
                  ['B','E'], ['D','E'], ['D','G'], ['E','G']];
    const JOINTS = ['A', 'B', 'C', 'D', 'E'];
    const N = 240, PATH = [];
    let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
    for (let n = 0; n < N; n++) {
      const P = solve(n / N * TAU);
      PATH.push(P.G);
      for (const key in P) {
        bx0 = Math.min(bx0, P[key][0]); bx1 = Math.max(bx1, P[key][0]);
        by0 = Math.min(by0, P[key][1]); by1 = Math.max(by1, P[key][1]);
      }
    }
    let box = { x0: 0, w: 0, h: 0, band: false };
    let S = 1, ox = 0, oy = 0;
    const X = (x) => ox + S * x, Y = (y) => oy - S * y;
    let theta = 0, target = 0;
    let scrubbing = false, anchorX = 0, anchorTh = 0, lastScrub = 0;
    function layout(b) {
      box = b;
      const availW = Math.min(b.w - 36, b.band ? 260 : 230);
      const availH = b.band ? b.h - 30 : Math.min(b.h * 0.42, 330);
      S = Math.min(availW / (bx1 - bx0), availH / (by1 - by0));
      ox = b.x0 + b.w / 2 - S * (bx0 + bx1) / 2;
      oy = (b.band ? b.h / 2 : focusPx(b.h)) + S * (by0 + by1) / 2;
    }
    function step(h, env) {
      const now = env.now;
      if (!env.idle && env.moved) {
        if (!scrubbing) { scrubbing = true; anchorX = env.cx; anchorTh = target; }
        lastScrub = now;
        target = anchorTh - (env.cx - anchorX) / (0.6 * Math.max(box.w, 320)) * TAU;
      }
      if (scrubbing && (env.idle || now - lastScrub > 3000)) scrubbing = false;
      if (!scrubbing) target += (-TAU / 9) * h;
      const dth = (target - theta) * (1 - Math.exp(-h / 0.28));
      const lm = (TAU / 1.8) * h;
      theta += clamp(dth, -lm, lm);
    }
    function circle(x, y, r, fill) {
      const ctx = G.ctx;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      ctx.stroke();
    }
    function draw(A, yOff) {
      const ctx = G.ctx;
      const P = solve(theta);
      ctx.save(); ctx.translate(0, yOff);
      ctx.lineWidth = 1; ctx.lineJoin = 'round';
      ctx.strokeStyle = tok.rule; ctx.globalAlpha = 0.9 * A;
      ctx.beginPath();
      PATH.forEach((p, n) => n ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])));
      ctx.closePath(); ctx.stroke();
      circle(X(O[0]), Y(O[1]), S * m);
      ctx.strokeStyle = tok['ink-3']; ctx.globalAlpha = A;
      ctx.beginPath();
      for (const [p, q] of BARS) { ctx.moveTo(X(P[p][0]), Y(P[p][1])); ctx.lineTo(X(P[q][0]), Y(P[q][1])); }
      ctx.stroke();
      ctx.strokeStyle = tok.accent;
      ctx.beginPath(); ctx.moveTo(X(O[0]), Y(O[1])); ctx.lineTo(X(P.C[0]), Y(P.C[1])); ctx.stroke();
      for (const key of JOINTS) {
        ctx.strokeStyle = key === 'C' ? tok.accent : tok['ink-3'];
        circle(X(P[key][0]), Y(P[key][1]), 2.25, tok.bg);
      }
      ctx.strokeStyle = tok['ink-3'];
      for (const p of [F, O]) {
        circle(X(p[0]), Y(p[1]), 3.25, tok.bg);
        ctx.fillStyle = tok.ink;
        ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), 1.1, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = tok.ink;
      ctx.beginPath(); ctx.arc(X(P.G[0]), Y(P.G[1]), 1.9, 0, TAU); ctx.fill();
      ctx.restore();
    }
    return { layout, step, draw };
  })();

  /* ====== scene 4 — perception & tracking ====== */
  const drive = (() => {
    let box = { x0: 0, w: 0, h: 0, band: false };
    let rx = 0, rw = 0, top = 0, bot = 0, egoY = 0, tgtY = 0;
    let truX = 0.5, estX = 0.5, estV = 0, P = 0.02;
    let measX = 0.5, measAge = 9, tickT = 0, dashOff = 0, simT = 0;
    const Q = 0.010, R = 0.006, TICK = 0.7;
    let n1 = Math.random() * TAU, n2 = Math.random() * TAU;
    function layout(b) {
      box = b;
      rw = Math.min(b.w - 64, b.band ? 170 : 132);
      rx = b.x0 + (b.w - rw) / 2;
      if (b.band) { top = 16; bot = b.h - 16; }
      else {
        top = Math.max(24, focusPx(b.h) - Math.min(b.h * 0.30, 270));
        bot = Math.min(b.h - 24, focusPx(b.h) + Math.min(b.h * 0.30, 270));
      }
      egoY = bot - 34; tgtY = top + (bot - top) * 0.30;
    }
    const laneX = (u) => rx + rw * (0.18 + 0.64 * u);
    function step(h, env) {
      simT += h; dashOff += 46 * h;
      const want = env.idle
        ? 0.5 + 0.32 * Math.sin(simT / 4.1 + n1) + 0.16 * Math.sin(simT / 1.7 + n2)
        : clamp(env.nx, 0, 1);
      truX += (want - truX) * (1 - Math.exp(-h / 0.45));
      estX += estV * h; P += Q * h; measAge += h;
      tickT -= h;
      if (tickT <= 0) {
        tickT = TICK;
        measX = clamp(truX + (Math.random() * 2 - 1) * 0.045, 0, 1);
        const K = P / (P + R);
        const innov = measX - estX;
        estX += K * innov;
        estV = 0.82 * estV + 0.5 * (K * innov) / TICK;
        P *= (1 - K);
        measAge = 0;
      }
    }
    function car(x, y, w, l, style) {
      const ctx = G.ctx;
      ctx.strokeStyle = style;
      ctx.beginPath();
      ctx.moveTo(x - w / 2 + 2, y - l / 2); ctx.lineTo(x + w / 2 - 2, y - l / 2);
      ctx.quadraticCurveTo(x + w / 2, y - l / 2, x + w / 2, y - l / 2 + 2);
      ctx.lineTo(x + w / 2, y + l / 2 - 2);
      ctx.quadraticCurveTo(x + w / 2, y + l / 2, x + w / 2 - 2, y + l / 2);
      ctx.lineTo(x - w / 2 + 2, y + l / 2);
      ctx.quadraticCurveTo(x - w / 2, y + l / 2, x - w / 2, y + l / 2 - 2);
      ctx.lineTo(x - w / 2, y - l / 2 + 2);
      ctx.quadraticCurveTo(x - w / 2, y - l / 2, x - w / 2 + 2, y - l / 2);
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - w / 2 + 3, y - l / 6); ctx.lineTo(x + w / 2 - 3, y - l / 6); ctx.stroke();
    }
    function draw(A, yOff) {
      const ctx = G.ctx;
      ctx.save(); ctx.translate(0, yOff);
      ctx.lineWidth = 1;
      ctx.strokeStyle = tok.rule; ctx.globalAlpha = 0.9 * A;
      ctx.beginPath(); ctx.moveTo(rx + 0.5, top); ctx.lineTo(rx + 0.5, bot); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(rx + rw - 0.5, top); ctx.lineTo(rx + rw - 0.5, bot); ctx.stroke();
      ctx.setLineDash([7, 9]); ctx.lineDashOffset = -dashOff;
      ctx.globalAlpha = 0.6 * A;
      ctx.beginPath(); ctx.moveTo(rx + rw / 2 + 0.5, top); ctx.lineTo(rx + rw / 2 + 0.5, bot); ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
      ctx.globalAlpha = A;
      car(rx + rw / 2, egoY, 15, 26, tok['ink-2']);
      const cx = laneX(truX);
      car(cx, tgtY, 15, 26, tok['ink-3']);
      const exx = laneX(estX);
      const sig = Math.sqrt(Math.max(P, 1e-5)) * rw * 0.64;
      ctx.strokeStyle = tok.accent; ctx.globalAlpha = 0.95 * A;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(exx - 12.5, tgtY - 18.5, 25, 37);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(exx - 2 * sig, tgtY + 26.5); ctx.lineTo(exx + 2 * sig, tgtY + 26.5);
      ctx.moveTo(exx - 2 * sig, tgtY + 23.5); ctx.lineTo(exx - 2 * sig, tgtY + 29.5);
      ctx.moveTo(exx + 2 * sig, tgtY + 23.5); ctx.lineTo(exx + 2 * sig, tgtY + 29.5);
      ctx.stroke();
      if (measAge < 0.25) {
        const mA = (1 - measAge / 0.25) * A;
        const mx = laneX(measX);
        ctx.strokeStyle = tok['accent-2']; ctx.globalAlpha = mA;
        ctx.beginPath();
        ctx.moveTo(mx - 3.5, tgtY); ctx.lineTo(mx + 3.5, tgtY);
        ctx.moveTo(mx, tgtY - 3.5); ctx.lineTo(mx, tgtY + 3.5);
        ctx.stroke();
      }
      ctx.restore();
    }
    return { layout, step, draw };
  })();

  const SCENES = { arm, attn, leg, drive };

  /* ================= shared pointer state ================= */
  let PX = -1e4, PY = -1e4, lastMove = -1e9, away = true;
  addEventListener('pointermove', (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    PX = e.clientX; PY = e.clientY; lastMove = performance.now(); away = false;
  }, { passive: true });
  document.addEventListener('pointerleave', () => { away = true; });
  document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) away = true; });
  const isIdle = (now) => away || !mqFine.matches || now - lastMove > 6000;

  readTokens();
  mqDark.addEventListener('change', readTokens);

  /* ================= desktop: the margin rig ================= */
  function startRig() {
    const rig = document.querySelector('.rig');
    if (!rig) return;
    const cv = rig.querySelector('canvas');
    const col = document.querySelector('main.wrap');
    const ORDER = ['arm', 'attn', 'leg', 'drive'];
    const alphas = [0, 0, 0, 0];
    let regions = [], hidden = false;
    let rigCtx = null, rigW = 0, rigH = 0;
    // several canvases share the scene singletons; point G at ours before any scene call
    function use() { G.ctx = rigCtx; G.W = rigW; G.H = rigH; }

    function layoutCanvas() {
      hidden = !mqWide.matches;
      if (hidden) return;
      const edge = col.getBoundingClientRect().right;
      rigW = innerWidth; rigH = innerHeight;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      cv.width = Math.round(rigW * dpr); cv.height = Math.round(rigH * dpr);
      rigCtx = cv.getContext('2d');
      rigCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const box = { x0: Math.floor(edge), w: rigW - Math.floor(edge), h: rigH, band: false };
      if (box.w < 170) { hidden = true; return; }
      use();
      for (const k of ORDER) SCENES[k].layout(box);
    }
    function layoutRegions() {
      const yOf = (sel) => document.querySelector(sel).getBoundingClientRect().top + scrollY;
      regions = [0, yOf('#now') - 90, yOf('#noble') - 90, yOf('#apple') - 90, yOf('#writing') - 60];
    }
    function activeScene() {
      const fy = scrollY + focusPx(innerHeight);
      if (fy >= regions[4]) return -1;
      for (let i = 3; i >= 0; i--) if (fy >= regions[i]) return i;
      return 0;
    }
    function regionProgress(i) {
      if (i < 0) return 0.5;
      const a = regions[i], b = regions[i + 1] ?? a + innerHeight;
      return clamp((scrollY + focusPx(innerHeight) - a) / Math.max(b - a, 1), 0, 1);
    }

    let running = false, raf = 0, last = 0, quietFrames = 0;
    function frame(now) {
      raf = running ? requestAnimationFrame(frame) : 0;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const act = activeScene();
      const idle = isIdle(now);
      const env = {
        now, idle,
        px: PX, py: PY, cx: PX, cy: PY,
        nx: PX / innerWidth, ny: PY / innerHeight,
        moved: now - lastMove < 90
      };
      if (arm.busy() && (act !== 0 || document.visibilityState !== 'visible')) arm.abortTask();
      const k = 1 - Math.exp(-dt / 0.22);
      let visSum = 0;
      for (let i = 0; i < 4; i++) {
        alphas[i] += ((i === act ? 1 : 0) - alphas[i]) * k;
        if (alphas[i] < 0.012 && i !== act) alphas[i] = 0;
        visSum += alphas[i];
      }
      use();
      G.ctx.clearRect(0, 0, G.W, G.H);
      if (visSum > 0.01) {
        for (let i = 0; i < 4; i++) {
          if (alphas[i] <= 0) continue;
          const sc = SCENES[ORDER[i]];
          sc.step(dt, env);
          // the arm is drawn without parallax: its grip coordinates are real viewport
          // coordinates, and the word swap depends on them being exact
          const yOff = i === 0 ? 0 : (0.5 - regionProgress(i)) * 26 * (i === act ? 1 : alphas[i]);
          sc.draw(alphas[i], yOff);
        }
        quietFrames = 0;
      } else if (act < 0 && ++quietFrames > 30 && running) {
        running = false; cancelAnimationFrame(raf); raf = 0;
      }
    }
    function sync() {
      const should = !hidden && document.visibilityState === 'visible' && !mqReduce.matches;
      if (should && !running) { running = true; quietFrames = 0; last = performance.now(); raf = requestAnimationFrame(frame); }
      else if (!should && running) { running = false; cancelAnimationFrame(raf); raf = 0; }
    }
    function staticFrame() {
      if (hidden) return;
      use();
      G.ctx.clearRect(0, 0, G.W, G.H);
      const act = activeScene();
      if (act >= 0) SCENES[ORDER[act]].draw(1, 0);
    }

    layoutCanvas(); layoutRegions();
    if (mqReduce.matches) {
      staticFrame();
      addEventListener('scroll', staticFrame, { passive: true });
      let rt0 = 0;
      const re0 = () => { clearTimeout(rt0); rt0 = setTimeout(() => { layoutCanvas(); layoutRegions(); staticFrame(); }, 150); };
      addEventListener('resize', re0);
      if (document.fonts) document.fonts.ready.then(re0);
      mqDark.addEventListener('change', staticFrame);
      return;
    }
    document.addEventListener('visibilitychange', sync);
    addEventListener('scroll', () => { if (!running) sync(); }, { passive: true });
    let rt = 0;
    const relayout = () => { clearTimeout(rt); rt = setTimeout(() => { arm.abortTask(); layoutCanvas(); layoutRegions(); sync(); }, 150); };
    addEventListener('resize', relayout);
    addEventListener('orientationchange', relayout);
    if (document.fonts) document.fonts.ready.then(relayout);
    setInterval(sync, 2000);   // watchdog: a tab that woke without firing our events self-heals
    sync();

    // ---- the periodic pick-and-place, plus swap-on-click
    function maybeSwap() {
      if (mqReduce.matches || document.visibilityState !== 'visible') return;
      if (hidden || activeScene() !== 0 || arm.busy() || !running || !swapEl) return;
      const r = swapEl.getBoundingClientRect();
      if (r.top < 70 || r.bottom > innerHeight - 90) return;   // only when the word is comfortably on screen
      arm.startTask();
    }
    setTimeout(maybeSwap, 7000);
    setInterval(maybeSwap, 19000);
    if (swapEl) swapEl.addEventListener('click', () => {
      if (!hidden && activeScene() === 0 && running && !mqReduce.matches) { if (!arm.busy()) arm.startTask(); }
      else fadeSwap();
    });
  }

  /* ================= phones: in-flow vignette bands ================= */
  function startBands() {
    const bands = [...document.querySelectorAll('.vignette')];
    if (!bands.length) return;
    for (const el of bands) {
      const scene = SCENES[el.dataset.scene];
      const cv = el.querySelector('canvas');
      if (!scene || !cv) continue;
      const ctx2 = cv.getContext('2d');
      let w = 0, h = 0, running = false, raf = 0, last = 0, onScreen = false, dead = true;
      let tpx = -1e4, tpy = -1e4, lastTouch = -1e9;
      function layout() {
        const r = el.getBoundingClientRect();
        w = Math.round(r.width); h = cv.clientHeight || 170;
        // display:none on desktop: never touch the shared scenes from a dead band
        dead = mqWide.matches || w < 60;
        if (dead) return;
        const dpr = Math.min(devicePixelRatio || 1, 2);
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
        ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
        scene.layout({ x0: 0, w, h, band: true });
      }
      function use() { G.ctx = ctx2; G.W = w; G.H = h; }
      function frame(now) {
        raf = running ? requestAnimationFrame(frame) : 0;
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        const touched = now - lastTouch < 2800;
        const env = {
          now, idle: !touched,
          px: tpx, py: tpy, cx: tpx, cy: tpy,
          nx: w ? tpx / w : 0.5, ny: h ? tpy / h : 0.5,
          moved: now - lastTouch < 120
        };
        use();
        scene.step(dt, env);
        ctx2.clearRect(0, 0, w, h);
        scene.draw(1, 0);
      }
      function sync() {
        const should = !dead && onScreen && document.visibilityState === 'visible' && !mqReduce.matches;
        if (should && !running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
        else if (!should && running) { running = false; cancelAnimationFrame(raf); raf = 0; }
      }
      layout();
      if (!dead) { use(); scene.draw(1, 0); }   // a resting first frame (also the reduced-motion state)
      new IntersectionObserver((es) => { onScreen = es[0].isIntersecting; sync(); }, { rootMargin: '120px 0px' }).observe(el);
      document.addEventListener('visibilitychange', sync);
      setInterval(sync, 2500);
      let rt = 0;
      addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { layout(); if (!dead) { use(); if (!running) scene.draw(1, 0); } sync(); }, 160); });
      const setTouch = (e) => {
        const r = cv.getBoundingClientRect();
        tpx = e.clientX - r.left; tpy = e.clientY - r.top; lastTouch = performance.now();
      };
      cv.addEventListener('pointerdown', setTouch, { passive: true });
      cv.addEventListener('pointermove', (e) => { if (e.pressure > 0 || e.pointerType === 'touch') setTouch(e); }, { passive: true });
    }
    // the lede term still rotates on phones — as a quiet crossfade
    if (swapEl && !mqReduce.matches) {
      setInterval(() => {
        if (!mqWide.matches && document.visibilityState === 'visible') fadeSwap();
      }, 12000);
      swapEl.addEventListener('click', () => { if (!mqWide.matches) fadeSwap(); });
    }
  }

  // Watch for crossings of the 1080px boundary: both worlds are wired once,
  // and each checks mqWide before running.
  startRig();
  startBands();
  // small dev/test hook (harmless in production)
  window.__marginalia = { swap: () => arm.startTask(), busy: () => arm.busy() };
  mqWide.addEventListener('change', () => {
    // re-run layouts on the side that just became active
    dispatchEvent(new Event('resize'));
  });
})();
