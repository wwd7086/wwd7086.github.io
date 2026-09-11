// traffic.js — Shanghai Skyscape · road network + signal-controlled traffic
// Roads are ribbons swept along centreline paths (per-vertex height, so the Garden Bridge ramps come for free); lanes are
// parallel offsets of the same path, cut into links at the junctions the paths cross; turns are Bézier connectors; every
// junction runs a split-phase signal plan; vehicles follow a Krauss car-following model and are drawn as six instanced meshes.

const LW = 3.4;                       // lane width (0.9x of 3.75 m)
const SB = 6.5;                       // stop line set back from the crossing kerb
const AMBER = 3, ALLRED = 1.5;

export function buildRoads(ctx) {
  const { THREE, city, scene, M, polarPos, psiAt, zArc, flat, tree, blocked, BUND_R } = ctx;
  let sd = 7; const rnd = () => { sd |= 0; sd = sd + 0x6D2B79F5 | 0; let t = Math.imul(sd ^ sd >>> 15, 1 | sd); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

  // ---------- path utilities ----------
  const makePath = (pts) => { const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z)); return { pts, cum, len: cum[cum.length - 1] }; };
  const segAt = (P, s) => { let lo = 0, hi = P.cum.length - 2; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (P.cum[mid] <= s) lo = mid; else hi = mid - 1; } return lo; };
  const posAt = (P, s, o = {}) => {
    s = s < 0 ? 0 : s > P.len ? P.len : s;
    const i = segAt(P, s), a = P.pts[i], b = P.pts[i + 1], L = (P.cum[i + 1] - P.cum[i]) || 1, u = (s - P.cum[i]) / L;
    o.x = a.x + (b.x - a.x) * u; o.y = a.y + (b.y - a.y) * u; o.z = a.z + (b.z - a.z) * u;
    o.dx = (b.x - a.x) / L; o.dz = (b.z - a.z) / L; o.dy = (b.y - a.y) / L; return o;
  };
  const tangentAt = (P, i) => { const a = P.pts[Math.max(0, i - 1)], b = P.pts[Math.min(P.pts.length - 1, i + 1)]; let dx = b.x - a.x, dz = b.z - a.z; const L = Math.hypot(dx, dz) || 1; return [dx / L, dz / L]; };
  const offsetPath = (P, off) => makePath(P.pts.map((p, i) => { const [dx, dz] = tangentAt(P, i); return { x: p.x - dz * off, y: p.y, z: p.z + dx * off }; }));
  const subPath = (P, s0, s1) => { const pts = [posAt(P, s0)]; for (let i = 0; i < P.pts.length; i++) if (P.cum[i] > s0 + 0.05 && P.cum[i] < s1 - 0.05) pts.push(P.pts[i]); pts.push(posAt(P, s1)); return makePath(pts.map((p) => ({ x: p.x, y: p.y, z: p.z }))); };
  const reversePath = (P) => makePath(P.pts.slice().reverse());
  const nearest = (P, q) => { let best = 1e9, bs = 0; for (let i = 0; i < P.pts.length - 1; i++) { const a = P.pts[i], b = P.pts[i + 1], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1; let t = ((q.x - a.x) * dx + (q.z - a.z) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t; const d = Math.hypot(q.x - a.x - dx * t, q.z - a.z - dz * t); if (d < best) { best = d; bs = P.cum[i] + t * (P.cum[i + 1] - P.cum[i]); } } return { d: best, s: bs }; };
  const projectS = (P, q) => nearest(P, q).s;
  const headingOf = (dx, dz) => Math.atan2(-dz, dx);       // box +x axis -> (dx, dz)

  // ---------- merged geometry helpers ----------
  const unitBox = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  function mergeBoxes2(list, m, name, parent = city) {
    const n = list.length; if (!n) return null;
    const pos = new Float32Array(n * 108), nor = new Float32Array(n * 108), uv = new Float32Array(n * 72);
    const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(), m4 = new THREE.Matrix4();
    let o3 = 0, o2 = 0;
    for (const it of list) {
      const g = unitBox.clone(); e.set(0, it.ry || 0, it.rz || 0, 'YZX'); q.setFromEuler(e); v.set(it.x, it.y, it.z); sc.set(it.w, it.h, it.d);
      m4.compose(v, q, sc); g.applyMatrix4(m4);
      pos.set(g.attributes.position.array, o3); nor.set(g.attributes.normal.array, o3); uv.set(g.attributes.uv.array, o2); o3 += 108; o2 += 72;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const mesh = new THREE.Mesh(geo, m); mesh.name = name; parent.add(mesh); return mesh;
  }
  function mergeQuads(list, m, name, parent) {   // flat quads {x,y,z,w,d,ry}, uv 0..1 for a radial gradient
    const n = list.length; if (!n) return null;
    const pos = new Float32Array(n * 18), uv = new Float32Array(n * 12);
    list.forEach((it, i) => {
      const c = Math.cos(it.ry || 0), s = Math.sin(it.ry || 0), hw = it.w / 2, hd = it.d / 2;
      const P = (lx, lz) => [it.x + lx * c + lz * s, it.y, it.z - lx * s + lz * c];
      const a = P(-hw, -hd), b = P(hw, -hd), cc = P(hw, hd), d = P(-hw, hd);
      pos.set([...a, ...b, ...cc, ...a, ...cc, ...d], i * 18); uv.set([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], i * 12);
    });
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const mesh = new THREE.Mesh(geo, m); mesh.name = name; mesh.frustumCulled = false; parent.add(mesh); return mesh;
  }
  // road surface: a top strip plus two skirts, world-unit UVs so the asphalt tile repeats every 14 m
  function ribbon(name, P, w, m, skirt = 0.8) {
    const Lp = offsetPath(P, -w / 2).pts, Rp = offsetPath(P, w / 2).pts, n = P.pts.length, U = 14;
    const pos = [], nor = [], uv = [], idx = [];
    for (let i = 0; i < n; i++) {
      const l = Lp[i], r = Rp[i], s = P.cum[i] / U, [dx, dz] = tangentAt(P, i), nx = -dz, nz = dx;
      pos.push(l.x, l.y, l.z, r.x, r.y, r.z, l.x, l.y, l.z, l.x, l.y - skirt, l.z, r.x, r.y, r.z, r.x, r.y - skirt, r.z);
      nor.push(0, 1, 0, 0, 1, 0, -nx, 0, -nz, -nx, 0, -nz, nx, 0, nz, nx, 0, nz);
      uv.push(s, 0, s, w / U, s, 0, s, skirt / U, s, 0, s, skirt / U);
      if (i < n - 1) { const b0 = i * 6, b1 = b0 + 6; idx.push(b0, b0 + 1, b1 + 1, b0, b1 + 1, b1, b0 + 2, b1 + 2, b0 + 3, b1 + 2, b1 + 3, b0 + 3, b0 + 4, b0 + 5, b1 + 4, b1 + 4, b0 + 5, b1 + 5); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, m); mesh.name = name; city.add(mesh); return mesh;
  }
  // pavement strip alongside a path between offsets o0<o1 and stations s0..s1 (extruded from y0 up to top)
  function stripPave(name, P, o0, o1, s0, s1, top, y0 = 0, m = M.paving) {
    const A = subPath(offsetPath(P, o0), s0, s1).pts, B = subPath(offsetPath(P, o1), s0, s1).pts;
    return flat(name, [...A.map((p) => [p.x, p.z]), ...B.slice().reverse().map((p) => [p.x, p.z])], m, top - y0, y0);
  }
  // band between two Bund radii; ends are radial cuts at the along-row x (measured at BUND_R) unless flagged vertical (map edge)
  function arcPiece(name, R0, R1, x0, x1, m, depth, y, v0 = false, v1 = false) {
    const ps = (R, x, vert) => vert ? psiAt(R, x) : psiAt(BUND_R, x);
    const n = Math.max(2, Math.ceil(Math.abs(ps(R1, x1, v1) - ps(R1, x0, v0)) * R1 / 6)), pts = [];
    for (let i = 0; i <= n; i++) { const a = ps(R0, x0, v0), b = ps(R0, x1, v1), p = polarPos(R0, a + (b - a) * i / n); pts.push([p.x, p.z]); }
    for (let i = n; i >= 0; i--) { const a = ps(R1, x0, v0), b = ps(R1, x1, v1), p = polarPos(R1, a + (b - a) * i / n); pts.push([p.x, p.z]); }
    return flat(name, pts, m, depth, y);
  }

  // ---------- asphalt + light-pool textures ----------
  { const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const c = cv.getContext('2d');
    c.fillStyle = '#cfcbc4'; c.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) { const g = 150 + Math.floor(rnd() * 100); c.fillStyle = `rgba(${g},${g - 4},${g - 8},${0.35 + rnd() * 0.5})`; c.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2); }
    for (let i = 0; i < 14; i++) { c.fillStyle = `rgba(90,86,82,${0.05 + rnd() * 0.07})`; c.fillRect(rnd() * S, rnd() * S, 30 + rnd() * 90, 8 + rnd() * 40); }
    const tx = new THREE.CanvasTexture(cv); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4;
    M.road.map = tx; M.road.color.set(0x3b3632); M.road.side = THREE.DoubleSide; M.road.needsUpdate = true; }
  const poolTex = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 128; const c = cv.getContext('2d'); const g = c.createRadialGradient(64, 64, 2, 64, 64, 62); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const headPoolMat = new THREE.MeshBasicMaterial({ map: poolTex, color: 0xfff1cf, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }); headPoolMat.name = 'headlight_pool';
  const lampPoolMat = new THREE.MeshBasicMaterial({ map: poolTex, color: 0xffd39a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }); lampPoolMat.name = 'streetlight_pool';

  // ---------- road definitions ----------
  const roads = [];
  const addRoad = (o) => { const r = { median: 0, speed: 1, ...o }; r.path = makePath(o.pts); r.hw = r.median / 2 + Math.max(r.nF, r.nB) * LW; r.nodes = []; roads.push(r); return r; };
  const arcPts = (R, xa, xb, y, step = 5) => { const pa = psiAt(R, xa), pb = psiAt(R, xb), n = Math.max(2, Math.ceil(Math.abs(pb - pa) * R / step)), pts = []; for (let i = 0; i <= n; i++) { const p = polarPos(R, pa + (pb - pa) * i / n); pts.push({ x: p.x, y: typeof y === 'function' ? y(p.x) : y, z: p.z }); } return pts; };
  const linePts = (x0, z0, x1, z1, y) => [{ x: x0, y, z: z0 }, { x: x1, y, z: z1 }];
  const radialPts = (xc, R0, R1, y) => { const ps = psiAt(BUND_R, xc), a = polarPos(R0, ps), b = polarPos(R1, ps); return [{ x: a.x, y, z: a.z }, { x: b.x, y, z: b.z }]; };
  const ZR = 682.8, SR = 733.8, RVR = 522.8;
  const bridgeY = (x) => { const ramp = (x0, x1, y0, y1) => y0 + (y1 - y0) * Math.min(1, Math.max(0, (x - x0) / (x1 - x0))); if (x > -262) return 0.40; if (x > -278) return ramp(-262, -278, 0.40, 2.83); if (x > -332) return 2.83; if (x > -358) return ramp(-332, -358, 2.83, 0.40); return 0.40; };
  const SX = [-215, -25, 266];
  const avenue = addRoad({ name: 'lujiazui_ring_rd', pts: linePts(-350, 105, 350, 105, 0.61), nF: 3, nB: 3, median: 2.2 });
  const riverside = addRoad({ name: 'binjiang_rd', pts: arcPts(RVR, -345, 345, 0.61), nF: 2, nB: 2, speed: 0.85 });
  const streets = SX.map((x, i) => addRoad({ name: 'lujiazui_street_' + i, pts: linePts(x, zArc(RVR, x) - 0.6, x, 182, 0.62), nF: 2, nB: 2, speed: 0.8 }));
  const CA = 22 * Math.PI / 180, cdx = Math.cos(CA), cdz = Math.sin(CA), cLen = 85 / cdz;
  const century = addRoad({ name: 'century_ave', pts: [{ x: -25 - cdx * 0.6, y: 0.60, z: 105 - cdz * 0.6 }, { x: -25 + cdx * cLen, y: 0.60, z: 190 }], nF: 3, nB: 3, median: 2.2, speed: 1.05 });
  const zhongshan = addRoad({ name: 'zhongshan_e1_rd', pts: arcPts(ZR, 366, -256, 0.40), nF: 2, nB: 2, speed: 0.9 });
  const bridgeRd = addRoad({ name: 'waibaidu_bridge_rd', pts: arcPts(ZR, -256, -370, bridgeY, 3), nF: 1, nB: 1, speed: 0.55 });
  const sichuan = addRoad({ name: 'sichuan_middle_rd', pts: arcPts(SR, 365, -295, 0.42), nF: 2, nB: 2, speed: 0.8 });
  addRoad({ name: 'sichuan_rd_north', pts: arcPts(SR, -343, -370, 0.42), nF: 2, nB: 2, noTraffic: true });
  // Bund cross streets, south -> north: [name, along-row x, lanes per direction, slot width, outer end radius]
  const CROSS = [['yanan_e_rd', 358, 2, 24, 724], ['guangdong_rd', 277.5, 1, 11, 825], ['fuzhou_rd', 211.5, 1, 11, 825], ['hankou_rd', 80.5, 1, 11, 825], ['jiujiang_rd', 41.5, 1, 11, 825], ['nanjing_e_rd', -93, 2, 16, 825], ['dianchi_rd', -193.5, 1, 11, 825]];
  const crossRoads = CROSS.map(([name, xc, n, slot, R1]) => addRoad({ name, pts: radialPts(xc, ZR - 0.6, R1, 0.38), nF: n, nB: n, speed: 0.7, xc, slot }));
  const joins = [[zhongshan, 'end', bridgeRd, 'start']];

  // ---------- junctions: where centrelines cross (plus explicit end-to-end joins) ----------
  const nodes = [];
  const segInt = (a, b, c, d) => { const rx = b.x - a.x, rz = b.z - a.z, sx = d.x - c.x, sz = d.z - c.z, den = rx * sz - rz * sx; if (Math.abs(den) < 1e-9) return null; const t = ((c.x - a.x) * sz - (c.z - a.z) * sx) / den, u = ((c.x - a.x) * rz - (c.z - a.z) * rx) / den; return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null; };
  const findNode = (x, z) => { for (const n of nodes) if (Math.hypot(n.x - x, n.z - z) < 8) return n; const n = { x, z, arms: [], signal: true, id: nodes.length }; nodes.push(n); return n; };
  const addArm = (n, road, s) => { if (n.arms.some((m) => m.road === road)) return; n.arms.push({ road, s, node: n }); road.nodes.push(n); };
  for (let i = 0; i < roads.length; i++) for (let j = i + 1; j < roads.length; j++) {
    const A = roads[i].path, B = roads[j].path;
    for (let a = 0; a < A.pts.length - 1; a++) for (let b = 0; b < B.pts.length - 1; b++) {
      const h = segInt(A.pts[a], A.pts[a + 1], B.pts[b], B.pts[b + 1]); if (!h) continue;
      const sA = A.cum[a] + h.t * (A.cum[a + 1] - A.cum[a]), sB = B.cum[b] + h.u * (B.cum[b + 1] - B.cum[b]), p = posAt(A, sA);
      const n = findNode(p.x, p.z); addArm(n, roads[i], sA); addArm(n, roads[j], sB);
    }
  }
  for (const [ra, ea, rb, eb] of joins) { const p = ea === 'end' ? ra.path.pts[ra.path.pts.length - 1] : ra.path.pts[0]; const n = findNode(p.x, p.z); n.signal = false; n.join = true; addArm(n, ra, ea === 'end' ? ra.path.len : 0); addArm(n, rb, eb === 'end' ? rb.path.len : 0); }
  // stop-line setbacks per arm side: walk back from the junction until the road leaves every crossing carriageway
  const inRibbon = (q, road) => nearest(road.path, q).d <= road.hw + 0.05;
  for (const n of nodes) for (const arm of n.arms) {
    const { road, s } = arm, others = n.arms.filter((m) => m !== arm);
    const probe = (dir) => {
      if (n.join) return 0;
      let far = 0; const tmp = {}, lane = road.median / 2 + road.nF * LW / 2, sgn = dir < 0 ? 1 : -1;
      for (let d = 0; d <= 70; d += 1) {
        const ss = s + dir * d; if (ss < 0 || ss > road.path.len) break; posAt(road.path, ss, tmp);
        const pts = [tmp, { x: tmp.x - tmp.dz * lane * sgn, z: tmp.z + tmp.dx * lane * sgn }];
        if (others.some((m) => pts.some((p) => inRibbon(p, m.road)))) far = d;
      }
      return far + SB;
    };
    arm.sbA = probe(-1); arm.sbB = probe(1);
    arm.hwX = Math.max(...others.map((m) => m.road.hw));
  }

  // ---------- links: one per lane per block between junctions ----------
  const links = [], paths = [], laneCache = new Map();
  const lanePath = (road, o) => { const k = road.name + '|' + o.toFixed(2); if (!laneCache.has(k)) laneCache.set(k, offsetPath(road.path, o)); return laneCache.get(k); };
  const laneOff = (road, dir, k) => dir * (road.median / 2 + LW * (k + 0.5));
  for (const road of roads) {
    if (road.noTraffic) { road.blocks = [{ sA: 0, sB: road.path.len }]; continue; }
    const arms = road.nodes.map((n) => n.arms.find((m) => m.road === road)).sort((a, b) => a.s - b.s);
    road.portalA = { portal: true, road }; road.portalB = { portal: true, road };
    const st = [{ s: 0, sbB: 0, node: road.portalA }, ...arms.map((a) => ({ s: a.s, sbA: a.sbA, sbB: a.sbB, node: a.node })), { s: road.path.len, sbA: 0, node: road.portalB }];
    road.blocks = [];
    for (let i = 0; i < st.length - 1; i++) {
      const sA = st[i].s + (st[i].sbB || 0), sB = st[i + 1].s - (st[i + 1].sbA || 0); if (sB - sA < 3) continue;
      const blk = { sA, sB, startNode: st[i].node, endNode: st[i + 1].node, fwd: [], bwd: [] }; road.blocks.push(blk);
      const pA = posAt(road.path, sA), pB = posAt(road.path, sB);
      for (const dir of [1, -1]) for (let k = 0; k < (dir > 0 ? road.nF : road.nB); k++) {
        const LP = lanePath(road, laneOff(road, dir, k)), s0 = projectS(LP, pA), s1 = projectS(LP, pB);
        let P = subPath(LP, s0, s1); if (dir < 0) P = reversePath(P);
        const link = { ...P, road, dir, lane: k, start: dir > 0 ? st[i].node : st[i + 1].node, end: dir > 0 ? st[i + 1].node : st[i].node, cars: [], conns: [], speed: road.speed, link: true, block: blk };
        (dir > 0 ? blk.fwd : blk.bwd).push(link); links.push(link); paths.push(link);
      }
    }
  }
  // ---------- connectors + approaches + signal plans ----------
  const bezier = (P0, d0, P3, d3, n) => { const dist = Math.hypot(P3.x - P0.x, P3.z - P0.z), k = 0.42 * dist, P1 = { x: P0.x + d0[0] * k, z: P0.z + d0[1] * k }, P2 = { x: P3.x - d3[0] * k, z: P3.z - d3[1] * k }, pts = [];
    for (let i = 0; i <= n; i++) { const t = i / n, a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, c = 3 * (1 - t) * t * t, d = t ** 3; pts.push({ x: a * P0.x + b * P1.x + c * P2.x + d * P3.x, y: P0.y + (P3.y - P0.y) * t, z: a * P0.z + b * P1.z + c * P2.z + d * P3.z }); } return makePath(pts); };
  for (const n of nodes) {
    const ins = links.filter((l) => l.end === n), outs = links.filter((l) => l.start === n);
    n.approaches = [];
    for (const li of ins) {
      const eI = posAt(li, li.len), nIn = li.dir > 0 ? li.road.nF : li.road.nB;
      let ap = n.approaches.find((a) => a.road === li.road && a.dir === li.dir);
      if (!ap) { ap = { road: li.road, dir: li.dir, links: [], moves: new Set(), node: n }; n.approaches.push(ap); }
      ap.links.push(li); li.approach = n.approaches.indexOf(ap);
      for (const lo of outs) {
        const eO = posAt(lo, 0), dot = eI.dx * eO.dx + eI.dz * eO.dz, cr = eI.dx * eO.dz - eI.dz * eO.dx; if (dot < -0.6) continue;
        let mv = (Math.abs(cr) < 0.35 && dot > 0.8) ? 'S' : cr > 0 ? 'R' : 'L';
        if (li.road === lo.road && li.dir === lo.dir) mv = 'S';
        const nOut = lo.dir > 0 ? lo.road.nF : lo.road.nB;
        const ok = mv === 'S' ? (lo.lane === Math.min(li.lane, nOut - 1) || (li.lane === nIn - 1 && lo.lane > li.lane)) : mv === 'R' ? (li.lane === nIn - 1 && lo.lane === nOut - 1) : (li.lane === 0 && lo.lane === 0);
        if (!ok) continue;
        const P = bezier(eI, [eI.dx, eI.dz], eO, [eO.dx, eO.dz], mv === 'S' ? 4 : 10);
        const conn = { ...P, mv, out: lo, in: li, node: n, conn: true, cars: [], speed: mv === 'S' ? 0.9 : mv === 'R' ? 0.4 : 0.5 };
        li.conns.push(conn); paths.push(conn); ap.moves.add(mv);
      }
    }
    if (n.signal && n.approaches.length) {
      const byRoad = new Map(); n.approaches.forEach((ap, ai) => { if (!byRoad.has(ap.road)) byRoad.set(ap.road, []); byRoad.get(ap.road).push(ai); });
      const plan = [];
      for (const [road, ais] of byRoad) {
        const major = road.nF >= 2;
        if (ais.length === 2) { plan.push({ dur: major ? 12 : 8, moves: new Set(ais.flatMap((ai) => [ai + 'S', ai + 'R'])) }); for (const ai of ais) if (n.approaches[ai].moves.has('L')) plan.push({ dur: major ? 5 : 3, moves: new Set([ai + 'S', ai + 'L', ai + 'R']) }); }
        else plan.push({ dur: major ? 8 : 6, moves: new Set([ais[0] + 'S', ais[0] + 'L', ais[0] + 'R']) });
      }
      n.plan = plan; n.cycle = plan.reduce((a, p) => a + p.dur + AMBER + ALLRED, 0); n.offset = rnd() * n.cycle;
      n.state = n.approaches.map(() => ({ S: 'R', L: 'R', R: 'G' })); n.lamp = n.approaches.map(() => '');
    } else n.signal = false;
  }
  const entries = links.filter((l) => l.start.portal);

  // ---------- surfaces ----------
  for (const r of roads) ribbon('road_' + r.name, r.path, 2 * r.hw, M.road, 0.8);
  // Waibaidu approach ramps: sloped embankments under the rising road
  { const rampBoxes = [];
    for (const [x0, x1] of [[-262, -278], [-358, -332]]) {
      const a = posAt(bridgeRd.path, projectS(bridgeRd.path, polarPos(ZR, psiAt(ZR, x0)))), b = posAt(bridgeRd.path, projectS(bridgeRd.path, polarPos(ZR, psiAt(ZR, x1))));
      const L = Math.hypot(b.x - a.x, b.z - a.z), rise = b.y - a.y, dx = (b.x - a.x) / L, dz = (b.z - a.z) / L;
      rampBoxes.push({ w: L + 1, h: 3.2, d: 9.2, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 1.62, z: (a.z + b.z) / 2, ry: headingOf(dx, dz), rz: Math.atan2(rise, L) });
    }
    mergeBoxes2(rampBoxes, M.base_stone, 'waibaidu_ramps'); }
  // Bund embankment: promenade + flood wall pieces split at the creek mouth, pavements split at the cross-street slots
  const slots = crossRoads.map((r) => [r.xc - r.slot / 2, r.xc + r.slot / 2]).sort((a, b) => a[0] - b[0]);
  const piecesBetween = (x0, x1, cuts) => { const out = []; let a = x0; for (const [c0, c1] of cuts) { if (c1 <= a || c0 >= x1) continue; if (c0 > a) out.push([a, c0]); a = Math.max(a, c1); } if (a < x1) out.push([a, x1]); return out; };
  for (const [sfx, x0, x1, v0, v1] of [['_n', -370, -340.5, true, false], ['', -299, 370, false, true]]) {
    arcPiece('bund_promenade' + sfx, 665, 676, x0, x1, M.paving, 2.2, -0.3, v0, v1);
    arcPiece('flood_wall' + sfx, 665, 666.4, x0, x1, M.base_stone, 3.4, -0.3, v0, v1);
  }
  piecesBetween(-295, 370, slots).forEach(([a, b], i) => arcPiece('bund_pavement_' + i, 689.6, 692.5, a, b, M.paving, 0.85, -0.3, false, b === 370));
  arcPiece('bund_pavement_n', 689.6, 692.5, -370, -337, M.paving, 0.85, -0.3, true, false);
  piecesBetween(-291, 370, slots).forEach(([a, b], i) => arcPiece('sichuan_pavement_' + i, 720.5, 727, a, b, M.paving, 0.85, -0.3, false, b === 370));
  arcPiece('sichuan_pavement_n', 720.5, 727, -370, -334, M.paving, 0.85, -0.3, true, false);
  for (const r of crossRoads) {   // slot pavements between the Bund blocks, then 2 m kerbs on into the hinterland
    const half = r.slot / 2, s0 = 689.6 - (ZR - 0.6), s1 = Math.min(727 - (ZR - 0.6), r.path.len), s2 = 740.6 - (ZR - 0.6), s3 = r.path.len;
    for (const sg of [1, -1]) {
      stripPave(`${r.name}_pave_${sg}_a`, r.path, Math.min(sg * r.hw, sg * half), Math.max(sg * r.hw, sg * half), s0, s1, 0.56, -0.3);
      if (s3 > s2 + 2) stripPave(`${r.name}_pave_${sg}_b`, r.path, Math.min(sg * r.hw, sg * (r.hw + 2)), Math.max(sg * r.hw, sg * (r.hw + 2)), s2, s3, 0.5, -0.3);
    }
  }
  // Lujiazui pavements: kerbs 15 cm above the carriageways, pieces arranged so nothing coplanar overlaps
  const AH = avenue.hw, SHW = 6.8, cutsX = SX.map((x) => [x - SHW, x + SHW]);
  for (const [z0, z1, tag] of [[105 - AH - 5.4, 105 - AH, 'n'], [105 + AH, 105 + AH + 5.4, 's']]) {
    const cuts = (tag === 's' ? [...cutsX, [-31.8, 44]] : cutsX.slice()).sort((a, b) => a[0] - b[0]);
    piecesBetween(-350, 350, cuts).forEach(([a, b]) => flat(`pave_ring_${tag}_${Math.round(a)}`, [[a, z0], [b, z0], [b, z1], [a, z1]], M.paving, 0.76, 0));
  }
  SX.forEach((x, i) => { const zN = zArc(516, x), zA = 105 - AH - 5.4, zB = 105 + AH + 5.4;
    for (const [xa, xb, sg] of [[x - SHW - 4, x - SHW, 'w'], [x + SHW, x + SHW + 4, 'e']]) {
      flat(`pave_street_${i}_${sg}_n`, [[xa, zN], [xb, zN], [xb, zA], [xa, zA]], M.paving, 0.73, 0);
      flat(`pave_street_${i}_${sg}_s`, [[xa, zB], [xb, zB], [xb, 182], [xa, 182]], M.paving, 0.73, 0);
    } });
  stripPave('pave_century_r', century.path, century.hw, century.hw + 5, 15, century.path.len, 0.70);
  stripPave('pave_century_l', century.path, -century.hw - 5, -century.hw, 72, century.path.len, 0.70);

  // ---------- lane paint, medians, stop lines, zebras, arrows ----------
  const paintW = [], paintY = [], kerbs = [], hedges = [];
  const boxesAlong = (road, sc0, sc1, o, w, y, list, dash, period) => {   // boxes of width w along the lane-boundary path at offset o (stations given on the centreline)
    const P = road.path, LP = lanePath(road, o), tmp = {}, s0 = projectS(LP, posAt(P, sc0)), s1 = projectS(LP, posAt(P, sc1));
    if (s1 - s0 < 0.3) return;
    if (!dash) { const sp = subPath(LP, s0, s1); for (let i = 0; i < sp.pts.length - 1; i++) { const a = sp.pts[i], b = sp.pts[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z); if (L < 0.05) continue; list.push({ w: L + 0.04, h: 0.04, d: w, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + y, z: (a.z + b.z) / 2, ry: headingOf((b.x - a.x) / L, (b.z - a.z) / L), rz: Math.atan2(b.y - a.y, L) }); } return; }
    for (let s = s0 + dash / 2; s + dash / 2 <= s1; s += period) { posAt(LP, s, tmp); list.push({ w: dash, h: 0.04, d: w, x: tmp.x, y: tmp.y + y, z: tmp.z, ry: headingOf(tmp.dx, tmp.dz), rz: Math.atan2(tmp.dy, 1) }); }
  };
  const acrossBox = (P, s, o0, o1, w, list, y = 0.03) => { const tmp = posAt(P, s), oc = (o0 + o1) / 2; list.push({ w, h: 0.04, d: Math.abs(o1 - o0), x: tmp.x - tmp.dz * oc, y: tmp.y + y, z: tmp.z + tmp.dx * oc, ry: headingOf(tmp.dx, tmp.dz), rz: Math.atan2(tmp.dy, 1) }); };
  for (const road of roads) {
    const P = road.path, m2 = road.median / 2;
    for (const blk of road.blocks) {
      const { sA, sB } = blk, endSig = blk.endNode && blk.endNode.signal, startSig = blk.startNode && blk.startNode.signal;
      for (const dir of [1, -1]) {   // dashed boundaries between same-direction lanes, solid over the last 18 m before a signal
        const nl = dir > 0 ? road.nF : road.nB, sig = dir > 0 ? endSig : startSig;
        for (let k = 1; k < nl; k++) {
          const o = dir * (m2 + LW * k), solidLen = sig ? Math.min(18, (sB - sA) * 0.4) : 0;
          const [d0, d1] = dir > 0 ? [sA + 0.5, sB - solidLen] : [sA + solidLen, sB - 0.5];
          boxesAlong(road, d0, d1, o, 0.15, 0.03, paintW, 1.8, 5.4);
          if (solidLen) boxesAlong(road, dir > 0 ? sB - solidLen : sA, dir > 0 ? sB : sA + solidLen, o, 0.15, 0.03, paintW);
        }
      }
      if (road.median) {   // raised planted median with kerb; a gap of a few metres before each stop line
        const sp = subPath(P, sA + 2.5, sB - 2.5), tmp = {};
        for (let i = 0; i < sp.pts.length - 1; i++) { const a = sp.pts[i], b = sp.pts[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z), ry = headingOf((b.x - a.x) / L, (b.z - a.z) / L);
          kerbs.push({ w: L + 0.02, h: 0.28, d: road.median, x: (a.x + b.x) / 2, y: a.y + 0.14, z: (a.z + b.z) / 2, ry });
          hedges.push({ w: L - 0.6, h: 0.75, d: road.median - 0.8, x: (a.x + b.x) / 2, y: a.y + 0.28 + 0.375, z: (a.z + b.z) / 2, ry }); }
        if (sB - sA > 40) for (let s = sA + 14; s < sB - 12; s += 24) { posAt(P, s, tmp); if (road === avenue && Math.abs(tmp.x + 25) < 52) continue; tree(city, `median_tree_${road.name}_${Math.round(s)}`, tmp.x, tmp.z, 0.42 + rnd() * 0.1); }
      } else { boxesAlong(road, sA + 0.3, sB - 0.3, -0.16, 0.13, 0.03, paintY); boxesAlong(road, sA + 0.3, sB - 0.3, 0.16, 0.13, 0.03, paintY); }
      for (const dir of [1, -1]) {   // stop line + lane arrows for each signalised approach of this block
        const sig = dir > 0 ? endSig : startSig; if (!sig) continue;
        const nl = dir > 0 ? road.nF : road.nB, sStop = dir > 0 ? sB : sA, o0 = dir * m2, o1 = dir * (m2 + nl * LW);
        acrossBox(P, sStop - dir * 0.25, o0, o1, 0.4, paintW);
        const lanes = dir > 0 ? blk.fwd : blk.bwd;
        for (const lk of lanes) {
          const mvs = new Set(lk.conns.map((c) => c.mv)), o = dir * (m2 + LW * (lk.lane + 0.5)), sa = sStop - dir * 7, tmp = posAt(P, sa), ax = tmp.x - tmp.dz * o, az = tmp.z + tmp.dx * o, ry = headingOf(dir * tmp.dx, dir * tmp.dz), fx = dir * tmp.dx, fz = dir * tmp.dz, rx = -fz, rz = fx;
          if (mvs.has('S') || !mvs.size) { paintW.push({ w: 2.6, h: 0.04, d: 0.28, x: ax, y: tmp.y + 0.03, z: az, ry }); paintW.push({ w: 0.8, h: 0.04, d: 0.8, x: ax + fx * 1.55, y: tmp.y + 0.03, z: az + fz * 1.55, ry: ry + Math.PI / 4 }); }
          if (mvs.has('L')) { paintW.push({ w: 0.28, h: 0.04, d: 1.3, x: ax + fx * 0.9 - rx * 0.55, y: tmp.y + 0.03, z: az + fz * 0.9 - rz * 0.55, ry }); paintW.push({ w: 0.7, h: 0.04, d: 0.7, x: ax + fx * 0.9 - rx * 1.25, y: tmp.y + 0.03, z: az + fz * 0.9 - rz * 1.25, ry: ry + Math.PI / 4 }); if (!mvs.has('S')) paintW.push({ w: 2.2, h: 0.04, d: 0.28, x: ax - fx * 0.3, y: tmp.y + 0.03, z: az - fz * 0.3, ry }); }
          if (mvs.has('R') && !mvs.has('S')) { paintW.push({ w: 0.28, h: 0.04, d: 1.3, x: ax + fx * 0.9 + rx * 0.55, y: tmp.y + 0.03, z: az + fz * 0.9 + rz * 0.55, ry }); paintW.push({ w: 0.7, h: 0.04, d: 0.7, x: ax + fx * 0.9 + rx * 1.25, y: tmp.y + 0.03, z: az + fz * 0.9 + rz * 1.25, ry: ry + Math.PI / 4 }); if (!mvs.has('L')) paintW.push({ w: 2.2, h: 0.04, d: 0.28, x: ax - fx * 0.3, y: tmp.y + 0.03, z: az - fz * 0.3, ry }); }
        }
      }
    }
    // zebra crossings on every signalised arm side
    for (const n of road.nodes) { if (!n.signal) continue; const arm = n.arms.find((m) => m.road === road);
      for (const [sgn, sb] of [[-1, arm.sbA], [1, arm.sbB]]) { const sLine = arm.s + sgn * sb; if (sgn < 0 ? sLine - 3 < 0 : sLine + 3 > P.len) continue;
        for (let k = 0; k < 4; k++) acrossBox(P, sLine - sgn * (1.3 + k * 1.0), -road.hw + 0.3, road.hw - 0.3, 0.45, paintW, 0.035); } }
  }
  // dotted guide lines carry the through lanes across the largest junction boxes
  { const tmp = {}; for (const P of paths) { if (!P.conn || !P.node.signal || P.mv !== 'S' || P.len < 30) continue; for (let s = 3; s < P.len - 3; s += 3.6) { posAt(P, s, tmp); paintW.push({ w: 0.7, h: 0.04, d: 0.15, x: tmp.x, y: tmp.y + 0.03, z: tmp.z, ry: headingOf(tmp.dx, tmp.dz) }); } } }
  mergeBoxes2(paintW, M.lane_paint, 'lane_paint'); mergeBoxes2(paintY, M.lane_yellow, 'lane_yellow');
  mergeBoxes2(kerbs, M.concrete, 'median_kerbs'); mergeBoxes2(hedges, M.tree_green, 'median_hedges');

  // ---------- signals: mast arms on the far corner of every approach, lamps as one instanced mesh recoloured per phase ----------
  const sigBoxes = [], lampList = [];
  for (const n of nodes) if (n.signal) n.approaches.forEach((ap, ai) => {
    const arm = n.arms.find((m) => m.road === ap.road), road = ap.road, sStop = arm.s - ap.dir * (ap.dir > 0 ? arm.sbA : arm.sbB), tmp = posAt(road.path, sStop);
    const fx = ap.dir * tmp.dx, fz = ap.dir * tmp.dz, rx = -fz, rz = fx, nl = ap.dir > 0 ? road.nF : road.nB, oc = road.median / 2 + nl * LW / 2, oPole = road.hw + 1.2;
    const px = n.x + fx * (arm.hwX + 1.5) + rx * oPole, pz = n.z + fz * (arm.hwX + 1.5) + rz * oPole, y0 = tmp.y, armL = oPole - oc, ry = headingOf(rx, rz);
    sigBoxes.push({ w: 0.3, h: 7.4, d: 0.3, x: px, y: y0 + 3.7, z: pz, ry }, { w: armL, h: 0.22, d: 0.22, x: px - rx * armL / 2, y: y0 + 7.25, z: pz - rz * armL / 2, ry }, { w: 1.7, h: 0.6, d: 0.42, x: px - rx * armL, y: y0 + 6.7, z: pz - rz * armL, ry });
    const hx = px - rx * armL, hz = pz - rz * armL;
    for (let k = 0; k < 3; k++) lampList.push({ x: hx + rx * (k - 1) * 0.55 - fx * 0.24, y: y0 + 6.7, z: hz + rz * (k - 1) * 0.55 - fz * 0.24, ry: Math.atan2(fz, -fx), node: n, ai, k });
  });
  mergeBoxes2(sigBoxes, M.band_dark, 'signal_masts');
  const lampGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.16, 12); lampGeo.rotateZ(Math.PI / 2);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff }); lampMat.name = 'signal_lamps';
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, Math.max(1, lampList.length)); lamps.name = 'signal_lamps'; lamps.frustumCulled = false; city.add(lamps);
  { const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    lampList.forEach((l, i) => { e.set(0, l.ry, 0); q.setFromEuler(e); v.set(l.x, l.y, l.z); m4.compose(v, q, one); lamps.setMatrixAt(i, m4); lamps.setColorAt(i, new THREE.Color(0x1a1412)); });
    lamps.instanceMatrix.needsUpdate = true; }
  const LIT = [new THREE.Color(0xff2a1a), new THREE.Color(0xffb020), new THREE.Color(0x36ff7a)], DIM = [new THREE.Color(0x2a1210), new THREE.Color(0x2a2210), new THREE.Color(0x0f2a18)];
  const lampBase = new Map(); lampList.forEach((l, i) => { if (l.k === 0) lampBase.set(l.node.id + ':' + l.ai, i); });

  // ---------- street lighting: twin-arm poles along the medians, single arms on the side streets; warm pools at night ----------
  const poleBoxes = [], headBoxes = [], pools = [];
  const lampAt = (x, z, y0, ry, arms, h = 11) => {   // arms: list of signed offsets (+ right)
    poleBoxes.push({ w: 0.32, h, d: 0.32, x, y: y0 + h / 2, z, ry });
    for (const a of arms) { const rX = Math.sin(ry), rZ = Math.cos(ry), ax = x + rX * a / 2, az = z + rZ * a / 2;   // right vector of heading ry
      poleBoxes.push({ w: 0.16, h: 0.16, d: Math.abs(a), x: ax, y: y0 + h - 0.3, z: az, ry });
      headBoxes.push({ w: 0.5, h: 0.22, d: 1.1, x: x + rX * a, y: y0 + h - 0.42, z: z + rZ * a, ry });
      pools.push({ x: x + rX * a * 2.7, y: y0 + 0.06, z: z + rZ * a * 2.7, w: 15, d: 11, ry }); }
  };
  for (let x = -338; x <= 338; x += 30) { if (SX.some((sx) => Math.abs(x - sx) < 19) || Math.abs(x + 25) < 52) continue; lampAt(x, 105, 0.61, 0, [-2.3, 2.3]); }
  { const tmp = {}; for (let s = 60; s < century.path.len - 10; s += 30) { posAt(century.path, s, tmp); lampAt(tmp.x, tmp.z, 0.60, headingOf(tmp.dx, tmp.dz), [-2.3, 2.3]); } }
  SX.forEach((x) => { for (let z = zArc(516, x) + 24; z < 176; z += 36) { if (Math.abs(z - 105) < 26) continue; lampAt(x + SHW + 1.6, z, 0.62, -Math.PI / 2, [1.9], 9.5); } });
  { const tmp = {}; for (let s = 22; s < sichuan.path.len - 10; s += 40) { posAt(sichuan.path, s, tmp); if (crossRoads.some((r) => nearest(r.path, tmp).d < r.hw + 4)) continue; lampAt(tmp.x - tmp.dz * (sichuan.hw + 1.4), tmp.z + tmp.dx * (sichuan.hw + 1.4), 0.42, headingOf(tmp.dx, tmp.dz), [-1.9], 9.5); } }
  mergeBoxes2(poleBoxes, M.band_dark, 'street_lamp_poles'); mergeBoxes2(headBoxes, M.lamp_globe, 'street_lamp_heads');
  mergeQuads(pools, lampPoolMat, 'street_lamp_pools', scene);

  // ---------- bus stops: shelter on the right-hand pavement, buses dwell at the marker ----------
  const stops = [[avenue, 220, 1], [avenue, 220, -1], [avenue, 500, 1], [avenue, 500, -1], [zhongshan, projectS(zhongshan.path, polarPos(ZR, psiAt(ZR, -66))), 1], [sichuan, projectS(sichuan.path, polarPos(SR, psiAt(SR, -40))), 1]];
  const shelterDark = [], shelterGlass = [], shelterSign = [];
  for (const [road, s, dir] of stops) {
    const tmp = posAt(road.path, s), fx = dir * tmp.dx, fz = dir * tmp.dz, rx = -fz, rz = fx, o = road.hw + 1.9, cx = tmp.x + rx * o, cz = tmp.z + rz * o, ry = headingOf(fx, fz), y0 = tmp.y + 0.15;
    for (const dx of [-2.1, 2.1]) shelterDark.push({ w: 0.16, h: 3.0, d: 0.16, x: cx + fx * dx + rx * 0.6, y: y0 + 1.5, z: cz + fz * dx + rz * 0.6, ry });
    shelterDark.push({ w: 4.8, h: 0.14, d: 1.9, x: cx, y: y0 + 3.05, z: cz, ry });
    shelterGlass.push({ w: 4.6, h: 1.5, d: 0.06, x: cx + rx * 0.9, y: y0 + 1.75, z: cz + rz * 0.9, ry });
    shelterSign.push({ w: 0.7, h: 2.3, d: 0.08, x: cx + fx * 3.0 - rx * 0.4, y: y0 + 1.9, z: cz + fz * 3.0 - rz * 0.4, ry: ry + Math.PI / 2 });
    const blk = road.blocks.find((b) => s >= b.sA && s <= b.sB); if (!blk) continue;
    const lk = (dir > 0 ? blk.fwd : blk.bwd).find((l) => l.lane === (dir > 0 ? road.nF : road.nB) - 1); if (lk) lk.stop = projectS(lk, tmp);
  }
  mergeBoxes2(shelterDark, M.band_dark, 'bus_shelters'); mergeBoxes2(shelterGlass, M.sky_glass || M.steel, 'bus_shelter_glass'); mergeBoxes2(shelterSign, M.lamp_globe, 'bus_stop_signs');

  // ---------- trees along Century Avenue pavements ----------
  { const tmp = {}; for (let s = 62; s < century.path.len - 8; s += 14) for (const o of [-(century.hw + 2.6), century.hw + 2.6]) { posAt(century.path, s, tmp); const x = tmp.x - tmp.dz * o, z = tmp.z + tmp.dx * o; if (blocked(x, z, 4)) continue; tree(city, `century_tree_${Math.round(s)}_${o > 0 ? 'r' : 'l'}`, x, z, 0.62 + rnd() * 0.16); } }

  // signed clearance of a ground point from the nearest carriageway edge (pad = pavement allowance); negative = inside a road corridor
  const roadClear = (x, z, pad = 0) => Math.min(...roads.map((r) => nearest(r.path, { x, z }).d - r.hw - pad));
  return { roads, nodes, links, paths, entries, posAt, lamps, lampBase, LIT, DIM, headPoolMat, lampPoolMat, LW, SX, roadClear };
}

// ---------- traffic ----------
export function buildTraffic(ctx, NET) {
  const { THREE, city, scene, M } = ctx; const { posAt, nodes, paths, entries, links, lamps, lampBase, LIT, DIM } = NET;
  const NMAX = 230, TAU = 0.8, B = 4.2;
  // part = [sx, sy, sz, ox, oy, oz]
  const TYPES = {
    sedan:   { len: 4.3, half: 2.15, vmax: 13, acc: 2.6, parts: { body: [4.3, 0.95, 1.8, 0, 0.55, 0], cabin: [2.3, 0.72, 1.66, -0.25, 1.38, 0], head: [0.2, 0.3, 1.55, 2.1, 0.62, 0], tail: [0.15, 0.3, 1.55, -2.12, 0.7, 0], axF: [0.7, 0.62, 1.86, 1.35, 0.31, 0], axR: [0.7, 0.62, 1.86, -1.3, 0.31, 0], pool: [8, 1, 5, 6.2, 0.04, 0] } },
    taxi:    { len: 4.3, half: 2.15, vmax: 13.5, acc: 2.8, parts: { body: [4.3, 0.95, 1.8, 0, 0.55, 0], cabin: [2.3, 0.72, 1.66, -0.25, 1.38, 0], head: [0.2, 0.3, 1.55, 2.1, 0.62, 0], tail: [0.15, 0.3, 1.55, -2.12, 0.7, 0], roof: [0.75, 0.26, 0.46, -0.3, 1.87, 0], axF: [0.7, 0.62, 1.86, 1.35, 0.31, 0], axR: [0.7, 0.62, 1.86, -1.3, 0.31, 0], pool: [8, 1, 5, 6.2, 0.04, 0] } },
    suv:     { len: 4.7, half: 2.35, vmax: 12.5, acc: 2.4, parts: { body: [4.7, 1.2, 1.92, 0, 0.68, 0], cabin: [3.1, 0.85, 1.8, 0.05, 1.7, 0], head: [0.2, 0.32, 1.6, 2.3, 0.78, 0], tail: [0.15, 0.32, 1.6, -2.32, 0.9, 0], axF: [0.76, 0.7, 1.98, 1.5, 0.35, 0], axR: [0.76, 0.7, 1.98, -1.45, 0.35, 0], pool: [8, 1, 5, 6.4, 0.04, 0] } },
    van:     { len: 5.2, half: 2.6, vmax: 11.5, acc: 2.0, parts: { body: [5.2, 1.9, 2.0, 0, 1.0, 0], cabin: [4.4, 0.6, 2.04, -0.2, 1.55, 0], head: [0.2, 0.34, 1.7, 2.55, 0.8, 0], tail: [0.15, 0.34, 1.7, -2.57, 1.1, 0], axF: [0.76, 0.7, 2.06, 1.7, 0.35, 0], axR: [0.76, 0.7, 2.06, -1.6, 0.35, 0], pool: [8.5, 1, 5.5, 6.6, 0.04, 0] } },
    bus:     { len: 10.8, half: 5.4, vmax: 9.5, acc: 1.5, bus: true, parts: { body: [10.8, 2.7, 2.5, 0, 1.4, 0], cabin: [10.4, 1.1, 2.54, 0, 2.15, 0], head: [0.2, 0.45, 2.2, 5.35, 0.85, 0], tail: [0.15, 0.4, 2.2, -5.38, 1.7, 0], roof: [1.7, 0.4, 2.1, 4.55, 2.95, 0], axF: [1.0, 1.0, 2.56, 3.4, 0.5, 0], axR: [1.0, 1.0, 2.56, -3.4, 0.5, 0], pool: [10, 1, 7, 9.6, 0.04, 0] } },
    scooter: { len: 1.7, half: 0.85, vmax: 8, acc: 2.2, lat: 0.95, parts: { body: [1.7, 0.45, 0.6, 0, 0.45, 0], cabin: [0.55, 1.05, 0.55, -0.25, 1.2, 0], head: [0.1, 0.18, 0.28, 0.85, 0.85, 0], tail: [0.08, 0.15, 0.3, -0.85, 0.7, 0], axF: [0.5, 0.5, 0.16, 0.62, 0.25, 0], axR: [0.5, 0.5, 0.16, -0.62, 0.25, 0], pool: [4, 1, 2.6, 3.1, 0.04, 0] } },
  };
  const C = (h) => new THREE.Color(h);
  const PAL = {
    sedan: [[C(0xe9e9e4), 0.32], [C(0x1b1d21), 0.22], [C(0xb9bdc1), 0.16], [C(0x676b70), 0.1], [C(0x7a1f1c), 0.07], [C(0x1d3557), 0.07], [C(0xb9a37a), 0.06]],
    taxi: [[C(0x1f8c86), 0.55], [C(0xd9a531), 0.25], [C(0xf0efe8), 0.1], [C(0x2a5fa8), 0.1]],
    suv: [[C(0xf0f0ec), 0.4], [C(0x1b1d21), 0.3], [C(0x8a8f94), 0.2], [C(0x3a2a20), 0.1]],
    van: [[C(0xeeeeea), 0.8], [C(0xd6d1c4), 0.2]],
    bus: [[C(0xf3f3ef), 0.45], [C(0x9fd3a8), 0.3], [C(0x8ec3e6), 0.25]],
    scooter: [[C(0x22252a), 0.45], [C(0xd8d8d4), 0.25], [C(0xb32a22), 0.15], [C(0x2f5fb0), 0.15]],
  };
  const RIDER = [[C(0x1f2a44), 0.45], [C(0xffd21f), 0.2], [C(0x2b7fd9), 0.2], [C(0xe6e6e6), 0.15]];
  const pick = (list) => { let r = Math.random(), acc = 0; for (const [v, w] of list) { acc += w; if (r <= acc) return v; } return list[list.length - 1][0]; };
  const TYPE_W = [['sedan', 0.4], ['taxi', 0.17], ['suv', 0.12], ['van', 0.06], ['bus', 0.07], ['scooter', 0.18]];
  const glass = C(0x1a2230);

  const unitBox = new THREE.BoxGeometry(1, 1, 1), poolGeo = new THREE.PlaneGeometry(1, 1); poolGeo.rotateX(-Math.PI / 2);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.45 }); bodyMat.name = 'vehicle_body';
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.22, metalness: 0.55 }); cabinMat.name = 'vehicle_glass';
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.92, metalness: 0.05 }); tyreMat.name = 'vehicle_tyres';
  const mk = (geo, mat, name, parent) => { const im = new THREE.InstancedMesh(geo, mat, NMAX); im.name = name; im.frustumCulled = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); parent.add(im); return im; };
  const meshes = { body: mk(unitBox, bodyMat, 'vehicle_bodies', city), cabin: mk(unitBox, cabinMat, 'vehicle_cabins', city), head: mk(unitBox, M.head_glow, 'vehicle_headlights', city), tail: mk(unitBox, M.tail_glow, 'vehicle_taillights', city), roof: mk(unitBox, M.lamp_globe, 'vehicle_roof_signs', city), axF: mk(unitBox, tyreMat, 'vehicle_axles_front', city), axR: mk(unitBox, tyreMat, 'vehicle_axles_rear', city), pool: mk(poolGeo, NET.headPoolMat, 'vehicle_light_pools', scene) };
  meshes.pool.castShadow = meshes.pool.receiveShadow = false;
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const cars = Array.from({ length: NMAX }, (_, i) => ({ i, active: false, path: null, s: 0, v: 0, type: TYPES.sedan, conn: null, tick: -1, dwell: 0, dwelt: false, half: 2 }));
  for (const k in meshes) { for (let i = 0; i < NMAX; i++) { meshes[k].setMatrixAt(i, ZERO); if (k === 'body' || k === 'cabin') meshes[k].setColorAt(i, glass); } meshes[k].instanceMatrix.needsUpdate = true; if (meshes[k].instanceColor) meshes[k].instanceColor.needsUpdate = true; }
  let active = 0, frame = 0, speedK = 1, lastT = null;
  const pool = [];
  for (let i = NMAX - 1; i >= 0; i--) pool.push(cars[i]);

  const chooseConn = (L) => { const cs = L.conns; if (!cs.length) return null; let tot = 0; const w = cs.map((c) => { const k = c.mv === 'S' ? 1 : c.mv === 'R' ? 0.42 : 0.26; tot += k; return k; }); let r = Math.random() * tot; for (let i = 0; i < cs.length; i++) { r -= w[i]; if (r <= 0) return cs[i]; } return cs[cs.length - 1]; };
  function spawn(L, s = 0, warm = false) {
    if (!pool.length) return null;
    const outer = L.lane === (L.dir > 0 ? L.road.nF : L.road.nB) - 1;
    let tn = pick(TYPE_W); if (!outer && (tn === 'bus' || tn === 'scooter')) tn = 'sedan';
    if (tn === 'bus' && L.road.nF === 1) tn = 'van';
    const c = pool.pop(), T = TYPES[tn]; c.type = T; c.half = T.half; c.active = true; c.path = L; c.s = s; c.v = warm ? T.vmax * 0.6 : T.vmax * 0.5; c.conn = chooseConn(L); c.dwell = 0; c.dwelt = false; c.speedK = 0.9 + Math.random() * 0.2; c.tick = frame;
    c.color = pick(PAL[tn]); c.cabin = tn === 'scooter' ? pick(RIDER) : glass;
    meshes.body.setColorAt(c.i, c.color); meshes.cabin.setColorAt(c.i, c.cabin); meshes.body.instanceColor.needsUpdate = meshes.cabin.instanceColor.needsUpdate = true;
    L.cars.push(c); active++; return c;
  }
  function despawn(c) { c.active = false; c.path = null; pool.push(c); active--; for (const k in meshes) meshes[k].setMatrixAt(c.i, ZERO); }
  // pre-warm: seed the network proportionally to link length so the streets are busy from the first frame
  { const total = links.reduce((a, l) => a + l.len, 0), target = Math.round(NMAX * 0.64);
    for (const L of links) { let n = Math.floor(target * L.len / total + Math.random()); const ss = []; for (let k = 0; k < n; k++) ss.push(4 + Math.random() * Math.max(0, L.len - 8)); ss.sort((a, b) => b - a);
      let lastS = 1e9; for (const s of ss) { if (lastS - s < 10) continue; if (!spawn(L, s, true)) break; lastS = s; } } }

  function leaderGap(c, P) {
    let dist = P.len - c.s, next = P.link ? c.conn : P.out;
    for (let hop = 0; hop < 2 && next; hop++) {
      const arr = next.cars; if (arr.length) { const L = arr[arr.length - 1]; return [dist + L.s - L.half - c.half, L.v]; }
      dist += next.len; next = next.link ? null : next.out;
    }
    return [1e9, 0];
  }
  function updateSignals(t) {
    let dirty = false;
    for (const n of nodes) { if (!n.signal) continue;
      let tt = ((t + n.offset) % n.cycle + n.cycle) % n.cycle, ph = n.plan[n.plan.length - 1], stG = 'R';
      for (const p of n.plan) { if (tt < p.dur + AMBER + ALLRED) { ph = p; stG = tt < p.dur ? 'G' : tt < p.dur + AMBER ? 'A' : 'R'; break; } tt -= p.dur + AMBER + ALLRED; }
      n.approaches.forEach((ap, ai) => { const st = n.state[ai]; st.S = ph.moves.has(ai + 'S') ? stG : 'R'; st.L = ph.moves.has(ai + 'L') ? stG : 'R';
        const show = ap.moves.has('S') ? st.S : st.L;
        if (n.lamp[ai] !== show) { n.lamp[ai] = show; const b = lampBase.get(n.id + ':' + ai); if (b != null) { for (let k = 0; k < 3; k++) lamps.setColorAt(b + k, (show === 'R' && k === 0) || (show === 'A' && k === 1) || (show === 'G' && k === 2) ? LIT[k] : DIM[k]); dirty = true; } } });
    }
    if (dirty && lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
  }
  function step(dt) {
    frame++;
    for (const P of paths) {
      const arr = P.cars;
      for (let i = 0; i < arr.length; i++) {
        const c = arr[i]; if (c.tick === frame) continue; c.tick = frame;
        let gap, vL;
        if (i > 0) { const L = arr[i - 1]; gap = L.s - c.s - L.half - c.half; vL = L.v; } else [gap, vL] = leaderGap(c, P);
        if (P.link && P.end.signal && c.conn) {
          const st = P.end.state[P.approach][c.conn.mv], dStop = P.len - c.s - 0.3;
          if (dStop > -1 && (st === 'R' || (st === 'A' && dStop > c.v * c.v / (2 * B) + 1.2))) { if (dStop < gap) { gap = dStop; vL = 0; } }
        }
        if (c.type.bus && P.stop != null && !c.dwelt) {
          const d = P.stop - c.s; if (d < gap) { gap = d; vL = 0; }
          if (d < 2.2 && c.v < 0.3) { c.dwell += dt; if (c.dwell > 4.5) c.dwelt = true; }
        }
        const vSafe = vL + (gap - 1.4 - vL * TAU) / ((c.v + vL) / (2 * B) + TAU);
        let v = Math.min(c.type.vmax * P.speed * speedK * c.speedK, c.v + c.type.acc * dt, vSafe); if (v < 0) v = 0;
        c.v = v; c.s += v * dt;
        if (i > 0) { const L = arr[i - 1]; if (c.s > L.s - L.half - c.half - 0.2) c.s = L.s - L.half - c.half - 0.2; }
      }
      while (arr.length && arr[0].s >= P.len) {
        const c = arr.shift();
        if (P.link) { if (!c.conn) { despawn(c); continue; } c.s -= P.len; c.path = c.conn; c.conn.cars.push(c); }
        else { const L = P.out; c.s -= P.len; c.path = L; L.cars.push(c); c.conn = chooseConn(L); c.dwelt = false; c.dwell = 0; }
      }
    }
  }
  const tmp = {}, pos = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), off = new THREE.Vector3(), m4 = new THREE.Matrix4();
  function render() {
    for (const c of cars) {
      if (!c.active) continue;
      posAt(c.path, c.s, tmp);
      e.set(0, Math.atan2(-tmp.dz, tmp.dx), Math.atan2(tmp.dy, 1), 'YZX'); q.setFromEuler(e);
      const lat = c.type.lat || 0, bx = tmp.x - tmp.dz * lat, bz = tmp.z + tmp.dx * lat, by = tmp.y;
      for (const k in meshes) {
        const p = c.type.parts[k]; if (!p) { meshes[k].setMatrixAt(c.i, ZERO); continue; }
        off.set(p[3], p[4], p[5]).applyQuaternion(q); pos.set(bx + off.x, by + off.y, bz + off.z); sc.set(p[0], p[1], p[2]); m4.compose(pos, q, sc); meshes[k].setMatrixAt(c.i, m4);
      }
    }
    for (const k in meshes) meshes[k].instanceMatrix.needsUpdate = true;
  }
  function drive(t, level) {
    if (lastT === null) lastT = t;
    let dt = Math.min(0.12, Math.max(0, t - lastT)); lastT = t;
    speedK = 1.3 - 0.45 * level;
    updateSignals(t);
    const sub = dt > 0.05 ? 2 : 1; for (let k = 0; k < sub; k++) step(dt / sub);
    const target = Math.round(NMAX * (0.35 + 0.65 * level));
    if (active < target) for (let tries = 0; tries < 3 && active < target; tries++) { const L = entries[(Math.random() * entries.length) | 0], rear = L.cars[L.cars.length - 1]; if (!rear || rear.s > 14) spawn(L); }
    render();
  }
  function setGlow(g, lampG = g) { NET.headPoolMat.opacity = 0.34 * g; NET.lampPoolMat.opacity = 0.3 * lampG; }   // headlights ramp through dusk; the lamps snap on together
  render();
  return { drive, setGlow, meshes, cars, stats: () => ({ active, links: links.length, paths: paths.length, nodes: nodes.length }) };
}
