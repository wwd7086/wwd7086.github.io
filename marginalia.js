/* The marginalia — one drawing system, three homes.
   The ceiling gantry: a trolley on a rail across the top of the viewport that
   periodically slides in, trades the rotating term in the lede for the next
   one in a single unbroken motion, and slides out. Works at every width.
   Desktop margins (>1080px): a fixed full-viewport canvas; the scene lives in
   the right margin and follows the reading position — the cursor when there
   is one, the scroll line otherwise.
   Phones: each margin scene becomes a small in-flow vignette band under its
   section, autonomous, and reactive to touch.
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

  /* ============ the two rotating terms in the lede ============
     "working where A and B meet" — one side is the intelligence, the other
     is where it lands. The gantry swaps one side per visit, alternating,
     so every combination stays true. */
  const SLOTS = [
    { el: document.getElementById('swapA'),
      terms: ['AI', 'machine learning', 'LLMs', 'foundation models', 'world models'], idx: 0 },
    { el: document.getElementById('swapB'),
      terms: ['robotics', 'the physical world', 'vision', 'audio'], idx: 0 },
  ].filter((s) => s.el);
  let slotTurn = 0;
  const nextSlot = () => SLOTS[slotTurn % SLOTS.length];
  let meas = null;
  function domWidth(slot, text) {
    if (!meas) {
      meas = document.createElement('span');
      meas.className = 'swap';
      meas.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;width:auto;border:0;';
      slot.el.parentNode.appendChild(meas);
    }
    meas.textContent = text;
    return meas.getBoundingClientRect().width;
  }
  // Animate a slot's gap from the old width to the new one.
  function setTermAnimated(slot, next) {
    slot.el.style.width = slot.el.getBoundingClientRect().width + 'px';
    void slot.el.offsetWidth;
    slot.el.textContent = next;
    slot.el.style.width = domWidth(slot, next) + 'px';
  }
  function settleTermWidth(slot) { setTimeout(() => { slot.el.style.width = 'auto'; }, 500); }
  const nextTerm = (slot) => slot.terms[(slot.idx + 1) % slot.terms.length];
  const advanceTerm = (slot) => { slot.idx = (slot.idx + 1) % slot.terms.length; };
  // Fallback swap (when the arm cannot do the job): a quiet crossfade.
  let fading = false;
  let busyRef = () => false;   // becomes the gantry's busy() once it exists
  let onSwap = () => {};       // becomes the label/announcement refresh once wired
  function fadeSwap(slot) {
    if (!slot || fading || busyRef()) return;
    fading = true;
    slot.el.style.transition = 'opacity 260ms ease, width 450ms cubic-bezier(.4,0,.2,1)';
    slot.el.style.opacity = '0';
    setTimeout(() => {
      setTermAnimated(slot, nextTerm(slot)); advanceTerm(slot); onSwap();
      slot.el.style.opacity = '1';
      setTimeout(() => { settleTermWidth(slot); fading = false; }, 470);
    }, 280);
  }

  /* ============ the ceiling gantry — how a word gets replaced ============
     A trolley rides a hairline rail along the top of the viewport. It slides
     in from the right already holding the next term in one gripper of an
     L-shaped turret, eases down to a slow glide — the carriage never stops —
     while the arm reaches ahead and holds its hand dead-still over the page
     just long enough to close its fingers on the old word. It lifts the word
     clear, indexes the turret a quarter turn so the loaded gripper swings
     down, seats the new term in the waiting gap, and accelerates out with
     the old word trailing behind. The link lengths are chosen once per pass
     and never change: the rail provides the reach, not the arm. */
  const gantry = (() => {
    let cv = null, ctx = null, W = 0, H = 0;
    const RAILY = 12, HANG = 11;              // rail height; shoulder hangs this far below it
    const R_TUR = 15, FING = 9, HOFF = R_TUR + FING;  // hub sits HOFF above a gripped word
    const VMIN = 16, TG = 2.35;               // the glide: slow, but never zero
    // choreography, on the glide clock (seconds past glide start)
    const EV = {
      down:  [0.00, 0.30], grasp: [0.30, 0.64], lift: [0.64, 0.96],
      index: [0.96, 1.54], down2: [1.54, 1.84], place: [1.84, 2.16], up: [2.16, TG]
    };
    const T_ATTACH = 0.50, T_WIDEN = 0.72, T_EXCH = 2.02;

    let pass = null, lastStats = null;
    let ghostN = null, ghostO = null, spacer = null;
    let carrying = false, seatDx = 0, seatDy = 0;
    let L = [0, 0, 0], Ltot = 0;
    const lim = [[PI / 2 - 1.05, PI / 2 + 1.25], [-2.5, -0.06], [-1.25, 1.25]];
    const rest = [PI / 2 + 0.34, -0.62, 0.24];
    let q = rest.slice(), g = rest.slice(), v = [0, 0, 0];
    const OMEGA = [3.6, 4.4, 5.6], ZETA = [0.6, 0.55, 0.5], VMAX = [3.0, 4.0, 5.0];

    const mj = (t) => { t = clamp(t, 0, 1); return t * t * t * (10 + t * (-15 + 6 * t)); };
    const mix = (a, b, s) => ({ x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s });
    // cubic Hermite: position + velocity, so segment boundaries match speeds exactly
    function herm(t, t0, t1, p0, p1, v0, v1) {
      const T = t1 - t0, s = clamp((t - t0) / T, 0, 1), s2 = s * s, s3 = s2 * s;
      return {
        x: (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * T * v0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * T * v1,
        v: ((6 * s2 - 6 * s) * p0 + (3 * s2 - 4 * s + 1) * T * v0 + (-6 * s2 + 6 * s) * p1 + (3 * s2 - 2 * s) * T * v1) / T
      };
    }
    const spr = (x, vv, xt, w, z, h) => {
      const a = w * w * (xt - x) - 2 * z * w * vv;
      vv += a * h; x += vv * h; return [x, vv];
    };

    function sizeCanvas() {
      W = innerWidth; H = innerHeight;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function fk(a, bx, by) {
      const a1 = a[0], a2 = a1 + a[1], a3 = a2 + a[2];
      const x1 = bx + L[0] * Math.cos(a1), y1 = by + L[0] * Math.sin(a1);
      const x2 = x1 + L[1] * Math.cos(a2), y2 = y1 + L[1] * Math.sin(a2);
      const x3 = x2 + L[2] * Math.cos(a3), y3 = y2 + L[2] * Math.sin(a3);
      return { x: [bx, x1, x2, x3], y: [by, y1, y2, y3], a3 };
    }
    function solveIK(bx, by, tx, ty, iters) {
      const lam2 = 576;
      for (let it = 0; it < (iters || 3); it++) {
        const f = fk(g, bx, by);
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
        const want = Math.atan2(ty + 60 - f.y[2], tx - f.x[2]);
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

    /* ---- the words in flight: real span + ghosts, welded to fingertips */
    function makeGhost(txt) {
      const el = document.createElement('span');
      el.className = 'swap carried';
      el.setAttribute('aria-hidden', 'true');   // a duplicate in flight, not content
      el.textContent = txt;
      el.style.left = '-9999px'; el.style.top = '0px';
      el.style.transformOrigin = '50% 0';
      pass.slot.el.parentNode.appendChild(el);
      return el;
    }
    function weld(el, ax, ay, w2, th, dy) {
      el.style.left = (ax - w2) + 'px';
      el.style.top = (ay + (dy || 0)) + 'px';
      el.style.transform = 'rotate(' + th + 'rad)';
    }
    function wordGrip() { const r = pass.slot.el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top, r }; }
    function seatGrip() { const r = spacer.getBoundingClientRect(); return { x: r.left + seatDx + pass.wN / 2, y: r.top + seatDy }; }
    function seatPt() { return pass.seatLast || (spacer ? seatGrip() : pass.gp0); }
    function attachWord() {
      const r = pass.slot.el.getBoundingClientRect();
      spacer = document.createElement('span');
      spacer.className = 'swap-gap';
      spacer.style.width = r.width + 'px';
      pass.slot.el.parentNode.insertBefore(spacer, pass.slot.el);
      const sr = spacer.getBoundingClientRect();
      seatDx = r.left - sr.left; seatDy = r.top - sr.top;
      pass.wO = r.width;
      pass.slot.el.classList.add('carried');
      pass.slot.el.style.left = r.left + 'px'; pass.slot.el.style.top = r.top + 'px';
      pass.slot.el.style.transformOrigin = '50% 0';
      carrying = true;
    }
    function releaseSeat() {
      const el = pass.slot.el;
      el.classList.remove('carried');
      el.style.left = el.style.top = el.style.transform = el.style.transformOrigin = '';
      if (spacer) { spacer.remove(); spacer = null; }
      carrying = false;
    }
    function doExchange() {
      const p = pass;
      const nr = ghostN.getBoundingClientRect();
      // the old word's pixels continue on a ghost that leaves with the trolley
      ghostO = makeGhost(p.slot.el.textContent);
      ghostO.style.left = p.slot.el.style.left; ghostO.style.top = p.slot.el.style.top;
      ghostO.style.transform = p.slot.el.style.transform;
      // the real span becomes the new term and settles into the slot
      p.slot.el.textContent = p.newTxt;
      advanceTerm(p.slot);
      releaseSeat();
      onSwap();
      const rr = p.slot.el.getBoundingClientRect();
      p.stats.releaseJump = Math.hypot(rr.left - nr.left, rr.top - nr.top);
      ghostN.remove(); ghostN = null;
      p.seatLast = { x: rr.left + rr.width / 2, y: rr.top };
    }

    function startPass(slotArg) {
      if (pass || !SLOTS.length || !ctx || fading) return false;
      if (mqReduce.matches || document.visibilityState !== 'visible') return false;
      const sl = slotArg || nextSlot();
      sizeCanvas();
      const wr = sl.el.getBoundingClientRect();
      const carY = RAILY + HANG;
      const wordX = wr.left + wr.width / 2, wordTop = wr.top;
      const drop = wordTop - HOFF - carY;
      if (drop < 70 || drop > 560) return false;
      if (wr.left < 8 || wr.right > W - 8 || wr.bottom > H - 36) return false;
      Ltot = drop * 1.22 + 26;
      L = [0.47 * Ltot, 0.38 * Ltot, 0.15 * Ltot];
      const newTxt = nextTerm(sl);
      const wN = domWidth(sl, newTxt);
      const seatX = wr.left + wN / 2;              // the slot grows rightward; its left edge is pinned
      const cGl = (wordX + seatX) / 2, D = VMIN * TG;
      const xg0 = cGl + D / 2, xg1 = cGl - D / 2;
      const x0 = W + 70 + Ltot * 0.2;
      const xe = -(30 + HOFF + Math.max(wr.width, 40) + Ltot * 0.2);
      const d1 = x0 - xg0, d3 = xg1 - xe;
      const T1 = clamp(d1 / 750, 1.15, 2.1), T3 = clamp(d3 / 850, 1.05, 1.9);
      pass = {
        t: 0, T1, T3, Ttot: T1 + TG + T3,
        x0, xg0, xg1, xe, v1: -1.3 * d1 / T1, v3: -1.3 * d3 / T3,
        slot: sl, carY, wN, wO: wr.width, newTxt, gp0: null, seatLast: null, scroll0: scrollY,
        carX: x0, carV: -1.3 * d1 / T1, carA: 0,
        tau: PI / 2, tauV: 0,
        opA: 0.15, opAV: 0, opB: 0.16, opBV: 0,
        thA: 0, thAV: 0, thB: 0.08, thBV: 0,
        dipA: 0, dipAV: 0,
        pA: null, pB: null,
        attached: false, widened: false, exch: false,
        stats: { completed: false, L0: Ltot, LVar: 0, vAbsMin: 1e9, lockErrMax: 0, graspJump: -1, releaseJump: -1 }
      };
      q = rest.slice(); g = rest.slice(); v = [0, 0, 0];
      solveIK(x0, carY, x0, carY + 0.72 * Ltot, 14);   // enter already settled in the hang
      q = g.slice();
      ghostN = makeGhost(newTxt);
      pass.wN = ghostN.getBoundingClientRect().width;
      slotTurn = (SLOTS.indexOf(sl) + 1) % SLOTS.length;
      startLoop();
      return true;
    }

    function finishPass(completed) {
      if (!pass) return;
      pass.stats.completed = completed;
      lastStats = pass.stats;
      if (carrying) releaseSeat();          // an aborted carry: the old word snaps home
      if (ghostN) { ghostN.remove(); ghostN = null; }
      if (ghostO) { ghostO.remove(); ghostO = null; }
      pass = null;                          // the next frame clears the canvas and stops
    }
    const abortPass = () => finishPass(false);

    function carriage(t) {
      const p = pass;
      if (t < p.T1) return herm(t, 0, p.T1, p.x0, p.xg0, p.v1, -VMIN);
      if (t < p.T1 + TG) return { x: p.xg0 - VMIN * (t - p.T1), v: -VMIN };
      return herm(t, p.T1 + TG, p.Ttot, p.xg1, p.xe, -VMIN, p.v3);
    }
    const inEv = (tp, k) => tp >= EV[k][0] && tp < EV[k][1];
    const evU = (tp, k) => clamp((tp - EV[k][0]) / (EV[k][1] - EV[k][0]), 0, 1);

    function stepPend(p, tk, vk, pk, a2, h) {
      const pr = p[pk] || { x: a2.x, y: a2.y, vx: 0 };
      const vx = (a2.x - pr.x) / Math.max(h, 1e-3);
      const ax = clamp((vx - pr.vx) / Math.max(h, 1e-3), -4200, 4200);
      p[pk] = { x: a2.x, y: a2.y, vx };
      const Lp = 30, GR = 2600, DMP = 3.2;
      const acc = -(GR / Lp) * Math.sin(p[tk]) - DMP * p[vk] - (ax / Lp) * Math.cos(p[tk]);
      p[vk] += acc * h;
      p[tk] = clamp(p[tk] + p[vk] * h, -0.5, 0.5);
    }

    function step(h) {
      const p = pass;
      p.t += h;
      if (p.t >= p.Ttot) { finishPass(true); return; }
      if (document.visibilityState !== 'visible' || Math.abs(scrollY - p.scroll0) > 240) { abortPass(); return; }
      const c = carriage(p.t);
      p.carA += (((c.v - p.carV) / Math.max(h, 1e-3)) - p.carA) * (1 - Math.exp(-h / 0.09));
      p.carX = c.x; p.carV = c.v;
      const tp = p.t - p.T1, carY = p.carY;

      // --- events
      if (!p.attached && tp >= T_ATTACH) {
        p.attached = true;
        const gw = wordGrip();
        p.gp0 = { x: gw.x, y: gw.y - HOFF };
        const f0 = fk(q, p.carX, carY);
        p.stats.graspJump = Math.hypot(f0.x[3] + HOFF * Math.cos(p.tau) - gw.x, f0.y[3] + HOFF * Math.sin(p.tau) - gw.y);
        attachWord();
        p.dipAV += 28;                       // the hand takes the word's weight
      }
      if (!p.widened && tp >= T_WIDEN && spacer) { p.widened = true; spacer.style.width = p.wN + 'px'; }
      if (!p.exch && tp >= T_EXCH) { p.exch = true; doExchange(); }

      // --- where the hand should be
      const tilt = clamp(-p.carA * 0.01, -0.22 * Ltot, 0.22 * Ltot);
      const restT = { x: p.carX + tilt, y: Math.min(carY + 0.72 * Ltot, H - 26) };
      let tgt = restT, locked = false;
      const direct = tp > -0.55 && tp < TG + 0.001;
      if (tp >= -0.55 && tp < 0) {
        const gw = wordGrip();
        tgt = mix(restT, { x: gw.x, y: gw.y - HOFF - 24 }, mj((tp + 0.55) / 0.55));
      } else if (inEv(tp, 'down')) {
        const gw = wordGrip();
        tgt = mix({ x: gw.x, y: gw.y - HOFF - 24 }, { x: gw.x, y: gw.y - HOFF }, mj(evU(tp, 'down')));
      } else if (inEv(tp, 'grasp')) {
        if (!p.attached) { const gw = wordGrip(); tgt = { x: gw.x, y: gw.y - HOFF }; }
        else tgt = p.gp0;
        locked = true;
      } else if (inEv(tp, 'lift')) {
        tgt = mix(p.gp0, { x: p.gp0.x, y: p.gp0.y - 44 }, mj(evU(tp, 'lift')));
      } else if (inEv(tp, 'index')) {
        const s = seatPt();
        tgt = mix({ x: p.gp0.x, y: p.gp0.y - 44 }, { x: s.x, y: s.y - HOFF - 40 }, mj(evU(tp, 'index')));
      } else if (inEv(tp, 'down2')) {
        const s = seatPt();
        tgt = mix({ x: s.x, y: s.y - HOFF - 40 }, { x: s.x, y: s.y - HOFF }, mj(evU(tp, 'down2')));
      } else if (inEv(tp, 'place')) {
        const s = seatPt();
        tgt = { x: s.x, y: s.y - HOFF }; locked = true;
      } else if (inEv(tp, 'up')) {
        const s = seatPt();
        tgt = mix({ x: s.x, y: s.y - HOFF }, restT, mj(evU(tp, 'up')));
      }

      // --- gripper fingers, turret, dip: small springs, real micro-motion
      const opAT = (tp >= -0.8 && tp < T_ATTACH) ? 0.9 : (tp < -0.8 ? 0.15 : 0.13);
      const opBT = tp >= T_EXCH - 0.06 ? 0.85 : 0.16;
      [p.opA, p.opAV] = spr(p.opA, p.opAV, opAT, 18, 0.55, h);
      [p.opB, p.opBV] = spr(p.opB, p.opBV, opBT, 18, 0.55, h);
      const tauT = tp >= EV.index[0] ? 0 : PI / 2;
      [p.tau, p.tauV] = spr(p.tau, p.tauV, tauT, 11, 0.62, h);
      [p.dipA, p.dipAV] = spr(p.dipA, p.dipAV, 0, 22, 0.5, h);

      // --- drive the joints: exact IK through the work, springs on the open road
      if (direct) {
        solveIK(p.carX, carY, tgt.x, tgt.y, 6);
        const bl = Math.min(1, (tp + 0.55) / 0.2);
        for (let i = 0; i < 3; i++) q[i] += (g[i] - q[i]) * bl;
        v = [0, 0, 0];
      } else {
        solveIK(p.carX, carY, tgt.x, tgt.y, 3);
        for (let i = 0; i < 3; i++) {
          const w = OMEGA[i];
          const a = w * w * (g[i] - q[i]) - 2 * ZETA[i] * w * v[i];
          v[i] = clamp(v[i] + a * h, -VMAX[i], VMAX[i]);
          q[i] += v[i] * h;
        }
      }

      const f = fk(q, p.carX, carY);
      const hub = { x: f.x[3], y: f.y[3] };
      const dA = { x: Math.cos(p.tau), y: Math.sin(p.tau) };
      const dB = { x: Math.cos(p.tau + PI / 2), y: Math.sin(p.tau + PI / 2) };
      const aA = { x: hub.x + HOFF * dA.x, y: hub.y + HOFF * dA.y };
      const aB = { x: hub.x + HOFF * dB.x, y: hub.y + HOFF * dB.y };

      // --- the hanging words swing on the carriage's real acceleration
      stepPend(p, 'thA', 'thAV', 'pA', aA, h);
      stepPend(p, 'thB', 'thBV', 'pB', aB, h);
      if (tp >= EV.down2[0] && tp < EV.place[1]) { p.thB *= Math.exp(-h / 0.09); p.thBV = 0; }
      if (carrying) weld(p.slot.el, aA.x, aA.y, p.wO / 2, p.thA, p.dipA);
      if (ghostN && p.t > 0.02) weld(ghostN, aB.x, aB.y, p.wN / 2, p.thB, 0);
      if (ghostO) weld(ghostO, aA.x, aA.y, p.wO / 2, p.thA, p.dipA);

      // --- honesty checks, kept every frame
      const st = p.stats;
      const av = Math.abs(p.carV);
      if (av < st.vAbsMin) st.vAbsMin = av;
      const lv = Math.abs(L[0] + L[1] + L[2] - st.L0);
      if (lv > st.LVar) st.LVar = lv;
      if (locked) {
        const err = Math.hypot(hub.x - tgt.x, hub.y - tgt.y);
        if (err > st.lockErrMax) st.lockErrMax = err;
      }
      if (window.__armlog) window.__armlog.push({
        t: +p.t.toFixed(2), tp: +tp.toFixed(2), x: Math.round(p.carX), v: Math.round(p.carV),
        hx: Math.round(hub.x), hy: Math.round(hub.y), tau: +p.tau.toFixed(2),
        err: locked ? +Math.hypot(hub.x - tgt.x, hub.y - tgt.y).toFixed(1) : -1
      });
    }

    function drawGrip(hub, ang, open) {
      const ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
      const bx = hub.x + R_TUR * ux, by = hub.y + R_TUR * uy;
      ctx.strokeStyle = tok['ink-3'];
      ctx.beginPath(); ctx.moveTo(hub.x, hub.y); ctx.lineTo(bx, by); ctx.stroke();
      const spread = 2.1 + 2.8 * clamp(open, 0, 1), tin = 1.1 + 3.6 * clamp(open, 0, 1);
      ctx.strokeStyle = tok.accent;
      ctx.beginPath();
      ctx.moveTo(bx - spread * nx, by - spread * ny); ctx.lineTo(bx + spread * nx, by + spread * ny);
      ctx.moveTo(bx - spread * nx, by - spread * ny); ctx.lineTo(bx - tin * nx + FING * ux, by - tin * ny + FING * uy);
      ctx.moveTo(bx + spread * nx, by + spread * ny); ctx.lineTo(bx + tin * nx + FING * ux, by + tin * ny + FING * uy);
      ctx.stroke();
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      const p = pass;
      if (!p) return;
      const railA = clamp(Math.min(p.t / 0.4, (p.Ttot - p.t) / 0.4, 1), 0, 1);
      ctx.lineWidth = 1; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // the rail, and a little ceiling hatching that shows itself near the trolley
      ctx.strokeStyle = tok.rule; ctx.globalAlpha = 0.85 * railA;
      ctx.beginPath(); ctx.moveTo(0, RAILY + 0.5); ctx.lineTo(W, RAILY + 0.5); ctx.stroke();
      for (let x = 8; x < W; x += 56) {
        const a2 = Math.exp(-((x - p.carX) * (x - p.carX)) / 33800);
        if (a2 < 0.05) continue;
        ctx.globalAlpha = 0.6 * railA * a2;
        ctx.beginPath(); ctx.moveTo(x, RAILY - 5); ctx.lineTo(x + 5, RAILY); ctx.stroke();
      }
      // the trolley: two wheels on the rail, a body, a shoulder mount
      ctx.strokeStyle = tok['ink-3']; ctx.globalAlpha = 0.95;
      const wr2 = 3.2, cx0 = p.carX;
      for (const dxw of [-8, 8]) {
        const wx = cx0 + dxw, wy = RAILY - wr2 - 0.5;
        ctx.beginPath(); ctx.arc(wx, wy, wr2, 0, TAU); ctx.stroke();
        const ra = -(p.carX / wr2);
        ctx.beginPath();
        ctx.moveTo(wx - wr2 * Math.cos(ra), wy - wr2 * Math.sin(ra));
        ctx.lineTo(wx + wr2 * Math.cos(ra), wy + wr2 * Math.sin(ra));
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(cx0 - 11, RAILY - 1.5); ctx.lineTo(cx0 - 11, RAILY + 4.5);
      ctx.moveTo(cx0 + 11, RAILY - 1.5); ctx.lineTo(cx0 + 11, RAILY + 4.5);
      ctx.moveTo(cx0 - 12, RAILY + 4.5); ctx.lineTo(cx0 + 12, RAILY + 4.5);
      ctx.moveTo(cx0, RAILY + 4.5); ctx.lineTo(cx0, p.carY);
      ctx.stroke();
      // the arm
      const f = fk(q, p.carX, p.carY);
      ctx.beginPath(); ctx.moveTo(f.x[0], f.y[0]);
      for (let i = 1; i < 4; i++) ctx.lineTo(f.x[i], f.y[i]);
      ctx.stroke();
      ctx.fillStyle = tok.bg;
      for (const [i, r] of [[0, 3.4], [1, 2.8], [2, 2.6]]) {
        ctx.beginPath(); ctx.arc(f.x[i], f.y[i], r, 0, TAU); ctx.fill(); ctx.stroke();
      }
      // the turret: two grippers a quarter turn apart
      const hub = { x: f.x[3], y: f.y[3] };
      drawGrip(hub, p.tau, p.opA);
      drawGrip(hub, p.tau + PI / 2, p.opB);
      ctx.strokeStyle = tok['ink-3']; ctx.fillStyle = tok.bg;
      ctx.beginPath(); ctx.arc(hub.x, hub.y, 3.6, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = tok.ink;
      ctx.beginPath(); ctx.arc(hub.x, hub.y, 1.1, 0, TAU); ctx.fill();
    }

    let raf = 0, lastT = 0;
    function frame(now) {
      if (!pass) { if (ctx) ctx.clearRect(0, 0, W, H); raf = 0; return; }
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - lastT) / 1000, 0.05);
      lastT = now;
      step(dt);
      if (pass) draw(); else ctx.clearRect(0, 0, W, H);
    }
    function startLoop() {
      if (raf) return;
      lastT = performance.now();
      raf = requestAnimationFrame(frame);
    }

    // wire up
    cv = document.querySelector('.gantry canvas');
    if (cv) sizeCanvas();
    else ctx = null;
    addEventListener('resize', () => { if (pass) abortPass(); });
    document.addEventListener('visibilitychange', () => {
      if (pass && document.visibilityState !== 'visible') abortPass();
    });

    return { startPass, abortPass, busy: () => !!pass, stats: () => lastStats };
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
    return { layout, step, draw, geom: () => ({ mid: fy + fh / 2, half: fh / 2 + 22 }) };
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
    return { layout, step, draw, geom: () => ({ mid: box.band ? box.h / 2 : focusPx(box.h), half: S * (by1 - by0) / 2 + 22 }) };
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
    return { layout, step, draw, geom: () => ({ mid: (top + bot) / 2, half: (bot - top) / 2 + 10 }) };
  })();

  const SCENES = { attn, leg, drive };

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
    const ORDER = ['attn', 'leg', 'drive'];
    const alphas = [0, 0, 0];
    let regions = [], anchors = [], hidden = false;
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
      regions = [yOf('#now') - 90, yOf('#noble') - 90, yOf('#apple') - 90, yOf('#writing') - 60];
      anchors = ['#elorian', '#noble', '#apple'].map((s) => document.querySelector(s));
    }
    // The reading line: the cursor's height when there is a cursor — so very
    // tall windows that never need to scroll still move through the scenes —
    // and the scroll-position line otherwise. Smoothed against flicker.
    let focusSm = -1;
    function focusNow() {
      if (mqFine.matches && !away && PY > -9000) return scrollY + clamp(PY, 0, innerHeight);
      return scrollY + focusPx(innerHeight);
    }
    function activeScene(fy) {
      if (fy < regions[0] || fy >= regions[3]) return -1;
      for (let i = 2; i >= 0; i--) if (fy >= regions[i]) return i;
      return -1;
    }
    function regionProgress(i, fy) {
      if (i < 0) return 0.5;
      const a = regions[i], b = regions[i + 1];
      return clamp((fy - a) / Math.max(b - a, 1), 0, 1);
    }
    // Each scene sits beside the text block it belongs to: offset its drawn
    // centre to the entry's live rect, clamped so it never leaves the screen.
    function anchorOff(i) {
      const el = anchors[i];
      if (!el) return 0;
      const gm = SCENES[ORDER[i]].geom();
      const r = el.getBoundingClientRect();
      let a = r.top + r.height / 2;
      const lo = gm.half + 20, hi = G.H - gm.half - 20;
      a = lo <= hi ? clamp(a, lo, hi) : G.H / 2;
      return a - gm.mid;
    }

    let running = false, raf = 0, last = 0, quietFrames = 0;
    function frame(now) {
      raf = running ? requestAnimationFrame(frame) : 0;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const fT = focusNow();
      focusSm = focusSm < 0 ? fT : focusSm + (fT - focusSm) * (1 - Math.exp(-dt / 0.4));
      const act = activeScene(focusSm);
      const idle = isIdle(now);
      const env = {
        now, idle,
        px: PX, py: PY, cx: PX, cy: PY,
        nx: PX / innerWidth, ny: PY / innerHeight,
        moved: now - lastMove < 90
      };
      const k = 1 - Math.exp(-dt / 0.22);
      let visSum = 0;
      for (let i = 0; i < 3; i++) {
        alphas[i] += ((i === act ? 1 : 0) - alphas[i]) * k;
        if (alphas[i] < 0.012 && i !== act) alphas[i] = 0;
        visSum += alphas[i];
      }
      use();
      G.ctx.clearRect(0, 0, G.W, G.H);
      if (visSum > 0.01) {
        for (let i = 0; i < 3; i++) {
          if (alphas[i] <= 0) continue;
          const sc = SCENES[ORDER[i]];
          sc.step(dt, env);
          const yOff = anchorOff(i) + (0.5 - regionProgress(i, focusSm)) * 10 * (i === act ? 1 : alphas[i]);
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
      const act = activeScene(focusNow());
      if (act >= 0) SCENES[ORDER[act]].draw(1, anchorOff(act));
    }

    layoutCanvas(); layoutRegions();
    if (mqReduce.matches) {
      staticFrame();
      addEventListener('scroll', staticFrame, { passive: true });
      let pmQ = false;
      addEventListener('pointermove', () => {
        if (pmQ) return; pmQ = true;
        requestAnimationFrame(() => { pmQ = false; staticFrame(); });
      }, { passive: true });
      let rt0 = 0;
      const re0 = () => { clearTimeout(rt0); rt0 = setTimeout(() => { layoutCanvas(); layoutRegions(); staticFrame(); }, 150); };
      addEventListener('resize', re0);
      if (document.fonts) document.fonts.ready.then(re0);
      mqDark.addEventListener('change', staticFrame);
      return;
    }
    document.addEventListener('visibilitychange', sync);
    addEventListener('scroll', () => { if (!running) sync(); }, { passive: true });
    addEventListener('pointermove', () => { if (!running) sync(); }, { passive: true });
    let rt = 0;
    const relayout = () => { clearTimeout(rt); rt = setTimeout(() => { layoutCanvas(); layoutRegions(); sync(); }, 150); };
    addEventListener('resize', relayout);
    addEventListener('orientationchange', relayout);
    if (document.fonts) document.fonts.ready.then(relayout);
    setInterval(sync, 2000);   // watchdog: a tab that woke without firing our events self-heals
    sync();
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
  }

  // Watch for crossings of the 1080px boundary: both worlds are wired once,
  // and each checks mqWide before running.
  startRig();
  startBands();
  busyRef = () => gantry.busy();
  // the swap cadence — every width, phones included; the gantry gates itself
  // on geometry and visibility, so a skipped beat is silent and safe
  const AUTO = !/[?&]noauto\b/.test(location.search);   // tests pin their own timing
  if (SLOTS.length && AUTO) {
    setTimeout(() => gantry.startPass(), 3000);
    let beat = setInterval(() => gantry.startPass(), 21000);

    // Coming back up after real reading is a small occasion, so the arm
    // comes out to meet you. Armed by a deep excursion — a third of the
    // scrollable depth, at least 320px, on a page with at least 480px of
    // travel (very tall windows never arm) — fired after settling at the
    // top for half a second, and spent either way: one greeting per trip.
    let lastY = scrollY, wentDeep = false, settle = 0;
    addEventListener('scroll', () => {
      const y = scrollY;
      const range = document.documentElement.scrollHeight - innerHeight;
      if (range >= 480 && Math.max(y, lastY) > Math.max(320, range * 0.35)) wentDeep = true;
      lastY = y;
      if (wentDeep && y <= 24) {
        if (!settle) settle = setTimeout(() => {
          settle = 0;
          if (scrollY > 24) return;        // wandered off mid-wait; stay armed
          wentDeep = false;
          if (gantry.startPass()) {
            clearInterval(beat);           // don't let the idle beat pile on
            beat = setInterval(() => gantry.startPass(), 21000);
            if (window.goatcounter && goatcounter.count) goatcounter.count({ path: 'arm-return', event: true });
          }
        }, 500);
      } else if (settle && y > 24) { clearTimeout(settle); settle = 0; }
    }, { passive: true });
  }
  for (const s of SLOTS) s.el.addEventListener('click', () => {
    if (window.goatcounter && goatcounter.count) goatcounter.count({ path: 'arm-summon', event: true });
    if (mqReduce.matches) { setTermAnimated(s, nextTerm(s)); advanceTerm(s); settleTermWidth(s); onSwap(); return; }
    if (!gantry.busy() && !gantry.startPass(s)) fadeSwap(s);
  });

  // ---- the slots are real controls: focusable, pressable, announced.
  // Applied by script so a no-JS page keeps honest plain text.
  if (SLOTS.length) {
    const note = document.createElement('p');
    note.className = 'visually-hidden';
    note.setAttribute('aria-live', 'polite');
    document.body.appendChild(note);
    const label = (s) =>
      s.el.setAttribute('aria-label', s.el.textContent.trim() + ' — press and the arm will swap this word');
    for (const s of SLOTS) {
      s.el.setAttribute('role', 'button');
      s.el.setAttribute('tabindex', '0');
      label(s);
      s.el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); s.el.click(); }
      });
    }
    onSwap = () => {
      for (const s of SLOTS) label(s);
      if (SLOTS.length === 2) {
        note.textContent = 'The introduction now reads: working where '
          + SLOTS[0].el.textContent.trim() + ' and ' + SLOTS[1].el.textContent.trim() + ' meet.';
      }
      // count completed swaps, if the (cookieless) counter is present
      if (window.goatcounter && goatcounter.count) goatcounter.count({ path: 'arm-swap', event: true });
    };
  }

  // ---- the floating masthead: detaches on scroll, with a little buoyancy
  const topBar = document.querySelector('.top');
  if (topBar && !mqReduce.matches) {
    let bob = 0, bobV = 0, lastSc = scrollY, bobRaf = 0;
    function bobTick() {
      bobRaf = 0;
      bobV += (0 - bob) * 0.16 - bobV * 0.22;
      bob += bobV;
      if (Math.abs(bob) > 0.05 || Math.abs(bobV) > 0.05) {
        topBar.style.setProperty('--bob', bob.toFixed(2) + 'px');
        bobRaf = requestAnimationFrame(bobTick);
      } else {
        bob = 0; bobV = 0;
        topBar.style.setProperty('--bob', '0px');
      }
    }
    addEventListener('scroll', () => {
      const y = scrollY;
      topBar.classList.toggle('afloat', y > (topBar.classList.contains('afloat') ? 6 : 36));
      bobV += clamp(y - lastSc, -60, 60) * 0.045;
      lastSc = y;
      if (!bobRaf) bobRaf = requestAnimationFrame(bobTick);
    }, { passive: true });
    topBar.classList.toggle('afloat', scrollY > 36);
  } else if (topBar) {
    addEventListener('scroll', () => topBar.classList.toggle('afloat', scrollY > 20), { passive: true });
    topBar.classList.toggle('afloat', scrollY > 20);
  }

  // ---- the cursor: a small query ring that floats after a precise dot.
  // The dot rides the true pointer (precision); the ring trails on a spring
  // (the float), widening over anything you can press.
  if (mqFine.matches && !mqReduce.matches && !matchMedia('(pointer: coarse)').matches) {
    const dot = document.createElement('div');
    const ring = document.createElement('div');
    dot.className = 'cur-dot'; ring.className = 'cur-ring';
    dot.setAttribute('aria-hidden', 'true'); ring.setAttribute('aria-hidden', 'true');
    document.body.append(ring, dot);
    document.documentElement.classList.add('cur');
    const HOT = 'a, button, .swap, input, textarea, select, label, [role="button"]';
    let tx = -200, ty = -200, rx = -200, ry = -200, cvx = 0, cvy = 0;
    let sc = 1, press = false, hot = false, raf2 = 0, seen = false;
    function tick2() {
      raf2 = 0;
      cvx = (cvx + (tx - rx) * 0.17) * 0.70;
      cvy = (cvy + (ty - ry) * 0.17) * 0.70;
      rx += cvx; ry += cvy;
      const scT = press ? 0.75 : hot ? 1.45 : 1;
      sc += (scT - sc) * 0.22;
      ring.style.transform = 'translate3d(' + (rx - 11) + 'px,' + (ry - 11) + 'px,0) scale(' + sc.toFixed(3) + ')';
      if (Math.abs(tx - rx) + Math.abs(ty - ry) > 0.4 || Math.abs(cvx) + Math.abs(cvy) > 0.1 || Math.abs((press ? 0.75 : hot ? 1.45 : 1) - sc) > 0.01)
        raf2 = requestAnimationFrame(tick2);
    }
    const wake = () => { if (!raf2) raf2 = requestAnimationFrame(tick2); };
    addEventListener('pointermove', (e) => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      tx = e.clientX; ty = e.clientY;
      if (!seen) { seen = true; rx = tx; ry = ty; dot.style.opacity = '1'; ring.style.opacity = '0.7'; }
      hot = !!(e.target && e.target.closest && e.target.closest(HOT));
      ring.classList.toggle('hot', hot);
      dot.style.transform = 'translate3d(' + (tx - 2) + 'px,' + (ty - 2) + 'px,0)';
      wake();
    }, { passive: true });
    addEventListener('pointerdown', (e) => { if (!e.pointerType || e.pointerType === 'mouse') { press = true; wake(); } }, { passive: true });
    addEventListener('pointerup', () => { press = false; wake(); }, { passive: true });
    document.addEventListener('mouseleave', () => { dot.style.opacity = '0'; ring.style.opacity = '0'; });
    document.addEventListener('mouseenter', () => { if (seen) { dot.style.opacity = '1'; ring.style.opacity = '0.7'; } });
    // a touch means no mouse: put the native experience back
    addEventListener('touchstart', () => {
      document.documentElement.classList.remove('cur');
      dot.remove(); ring.remove();
    }, { once: true, passive: true });
  }
  // small dev/test hook (harmless in production)
  window.__marginalia = { swap: (i) => gantry.startPass(i == null ? undefined : SLOTS[i]), busy: () => gantry.busy(), stats: () => gantry.stats(), slot: () => slotTurn % SLOTS.length };
  mqWide.addEventListener('change', () => {
    // re-run layouts on the side that just became active
    dispatchEvent(new Event('resize'));
  });
})();
