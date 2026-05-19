// Tafels Vliegveld - canvas versie met realistisch vliegveld
const TOTAL_QUESTIONS = 10;
const HOVER_TIMEOUT_MS = 3000;     // tijd om te antwoorden
const FAST_ANSWER_MS = 1000;       // grens voor "Wow FAST!"
const HIGHSCORE_PREFIX = 'cj-tafels-highscore-';

function highScoreKey(table) {
  return HIGHSCORE_PREFIX + (table === null ? 'mix' : table);
}
function getHighScore(table) {
  try { return parseInt(localStorage.getItem(highScoreKey(table)) || '0', 10) || 0; }
  catch (_) { return 0; }
}
function setHighScore(table, score) {
  try { localStorage.setItem(highScoreKey(table), String(score)); } catch (_) {}
}

const $ = (id) => document.getElementById(id);

const state = {
  table: null,
  questionNum: 0,
  score: 0,
  current: { a: 0, b: 0, correct: 0 },
  mistakes: [],
  gates: [],          // [{x, y, w, h, value, status}]
  plane: { x: 0, y: 0, angle: 0, scale: 1, visible: false },
  phase: 'idle',      // idle | incoming | hovering | landing | looping | parked
  phaseStart: 0,
  phaseDuration: 0,
  landTarget: null,
  parkedAt: [],       // gates already parked in this round
  clickEnabled: false,
};

const canvas = $('canvas');
const ctx = canvas.getContext('2d');
let W = 0, H = 0;

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  W = Math.max(300, Math.floor(rect.width));
  H = Math.max(220, Math.floor(rect.height));
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layoutGates();
}

function layoutGates() {
  if (!state.gates.length) return;
  const n = state.gates.length;
  // Gates are positioned horizontally below the runway (like parking bays)
  const gateW = Math.min(260, (W - 60) / n - 12);
  const gateH = Math.min(160, H * 0.30);
  const gap = 14;
  const totalW = gateW * n + gap * (n - 1);
  const startX = (W - totalW) / 2;
  const gateY = H * 0.72;
  state.gates.forEach((g, i) => {
    g.x = startX + i * (gateW + gap);
    g.y = gateY;
    g.w = gateW;
    g.h = gateH;
  });
}

window.addEventListener('resize', () => {
  if (!$('game').classList.contains('hidden')) resizeCanvas();
});

// === Menu ===
const tableButtons = $('tableButtons');
for (let i = 1; i <= 10; i++) {
  const btn = document.createElement('button');
  const hs = getHighScore(i);
  btn.innerHTML = `${i}` + (hs > 0 ? `<span class="hs">🏆 ${hs}</span>` : '');
  btn.addEventListener('click', () => startGame(i));
  tableButtons.appendChild(btn);
}
$('mixBtn').addEventListener('click', () => startGame(null));
$('backBtn').addEventListener('click', showMenu);
$('menuBtn').addEventListener('click', showMenu);
$('againBtn').addEventListener('click', () => startGame(state.table));

function showMenu() {
  $('menu').classList.remove('hidden');
  $('game').classList.add('hidden');
  $('result').classList.add('hidden');
  document.body.classList.remove('game-active');
  state.phase = 'idle';
  state.plane.visible = false;
}

function startGame(table) {
  state.table = table;
  state.questionNum = 0;
  state.score = 0;
  state.mistakes = [];
  state.parkedAt = [];
  state.fastCount = 0;
  $('menu').classList.add('hidden');
  $('result').classList.add('hidden');
  $('game').classList.remove('hidden');
  document.body.classList.add('game-active');
  $('currentTable').textContent = table === null ? 'mix 🎲' : table;
  $('totalQuestions').textContent = TOTAL_QUESTIONS;
  // Wait for layout
  requestAnimationFrame(() => {
    resizeCanvas();
    nextQuestion();
  });
}

function nextQuestion() {
  if (state.questionNum >= TOTAL_QUESTIONS) return showResult();
  state.questionNum++;
  const a = state.table === null ? randInt(1, 10) : state.table;
  const b = randInt(1, 10);
  state.current = { a, b, correct: a * b };

  $('questionNum').textContent = state.questionNum;
  $('score').textContent = state.score;
  $('feedback').textContent = '';
  $('feedback').className = 'feedback';

  buildGates(a * b);
  setPhase('incoming');
}

function buildGates(correct) {
  const choices = new Set([correct]);
  while (choices.size < 4) {
    const d = randInt(-5, 5);
    const v = correct + d;
    if (v > 0 && v !== correct) choices.add(v);
  }
  const arr = shuffle([...choices]);
  state.gates = arr.map((v, i) => ({
    x: 0, y: 0, w: 0, h: 0,
    value: v,
    label: 'GATE ' + String.fromCharCode(65 + i),
    status: 'idle', // idle | correct | wrong
  }));
  layoutGates();
  state.parkedAt = [];
}

// === Phases / animation ===
function setPhase(phase) {
  state.phase = phase;
  state.phaseStart = performance.now();
  state.clickEnabled = false;
  state.plane.visible = true;

  if (phase === 'incoming') {
    state.phaseDuration = 8000; // total 8s: ~3s approach + 5s on strip
    // Random spawn point (different directions each time)
    const runwayY = H * 0.40 + Math.max(32, H * 0.07) / 2;
    const runwayRight = W * 0.9;
    const runwayLeft = W * 0.1;
    const spawns = [
      { x: W + 100, y: H * 0.08 },   // top-right
      { x: W + 100, y: H * 0.5 },    // mid-right
      { x: W * 0.5, y: -100 },       // top-center
      { x: W + 100, y: H * 0.75 },   // bottom-right
      { x: W * 0.85, y: H + 100 },   // bottom
    ];
    const spawn = spawns[Math.floor(Math.random() * spawns.length)];
    // Continuous path: spawn → turn → final → threshold → along strip → exit left
    // The plane never stops - constant smooth motion through all waypoints
    const turnY = spawn.y > runwayY ? runwayY - H * 0.1 : runwayY + H * 0.1;
    state.approachPath = [
      { x: spawn.x, y: spawn.y },                          // 0: spawn
      { x: runwayRight + W * 0.12, y: turnY },             // 1: base turn
      { x: runwayRight + 20, y: runwayY },                 // 2: final approach
      { x: runwayRight, y: runwayY },                      // 3: touchdown (click enabled here)
      { x: W * 0.5, y: runwayY },                          // 4: mid-runway
      { x: runwayLeft, y: runwayY },                       // 5: end of runway
    ];
    // Click becomes enabled at ~60% progress (when reaching threshold)
    state.clickEnableAt = 3 / 5; // segment 3 out of 5
    state.plane.scale = 1;
  } else if (phase === 'landing') {
    state.phaseDuration = 4000; // longer to follow full taxi path
  } else if (phase === 'flyaway') {
    state.phaseDuration = 2000;
  }
}

function easeOut(t) { return 1 - Math.pow(1 - t, 2); }
function easeInOut(t) { return t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2; }
function easeInOutCubic(t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2; }
function easeInCubic(t) { return t * t * t; }
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function updatePlane(now) {
  const p = state.plane;
  const elapsed = now - state.phaseStart;

  // Runway Y center (must match drawRunway)
  const runwayY = H * 0.40 + Math.max(32, H * 0.07) / 2;

  if (state.phase === 'incoming') {
    // Continuous smooth flight along entire path (approach + on strip)
    const t = Math.min(elapsed / state.phaseDuration, 1);
    const path = state.approachPath;
    const n = path.length - 1; // number of segments

    // Enable clicking once past the threshold point
    if (t >= state.clickEnableAt && !state.clickEnabled) {
      state.clickEnabled = true;
    }

    // Smooth cubic Bezier-like interpolation along path
    const rawPos = t * n;
    const segment = Math.min(Math.floor(rawPos), n - 1);
    const lt = rawPos - segment;
    // Use linear interpolation per segment for constant speed feel
    const from = path[segment];
    const to = path[segment + 1];
    p.x = from.x + (to.x - from.x) * lt;
    p.y = from.y + (to.y - from.y) * lt;

    // Smooth angle: look ahead in direction of travel
    const lookAhead = Math.min(t + 0.05, 1) * n;
    const laSeg = Math.min(Math.floor(lookAhead), n - 1);
    const laLt = lookAhead - laSeg;
    const laFrom = path[laSeg];
    const laTo = path[laSeg + 1];
    const laX = laFrom.x + (laTo.x - laFrom.x) * laLt;
    const laY = laFrom.y + (laTo.y - laFrom.y) * laLt;
    const targetAngle = Math.atan2(laY - p.y, laX - p.x);
    // Smoothly interpolate angle
    if (!state.prevAngle) state.prevAngle = targetAngle;
    p.angle = lerpAngle(state.prevAngle, targetAngle, 0.12);
    state.prevAngle = p.angle;

    // Keep constant size throughout
    p.scale = 1;

    if (t >= 1) {
      onTimeout();
    }
  } else if (state.phase === 'landing') {
    // Follow taxi path: runway → connector → taxiway → spur → gate
    const t = Math.min(elapsed / state.phaseDuration, 1);
    const target = state.landTarget;
    const path = state.landPath;
    const n = path.length - 1;
    const rawPos = t * n;
    const segment = Math.min(Math.floor(rawPos), n - 1);
    const lt = rawPos - segment;
    const e = easeInOut(lt);
    const from = path[segment];
    const to = path[segment + 1];
    p.x = from.x + (to.x - from.x) * e;
    p.y = from.y + (to.y - from.y) * e;
    // Point nose in direction of travel
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    p.angle = Math.atan2(dy, dx);
    p.scale = 1 - 0.3 * easeInOutCubic(t);
    if (t >= 1) {
      const tx = target.x + target.w / 2;
      const ty = target.y - 12;
      state.parkedAt.push({ x: tx, y: ty, scale: 0.65, angle: Math.PI / 2 });
      state.phase = 'idle';
      p.visible = false;
      state.prevAngle = null;
      setTimeout(nextQuestion, 800);
    }
  } else if (state.phase === 'flyaway') {
    // Smooth climb out - no stopping, gain altitude and fly off screen
    const t = Math.min(elapsed / state.phaseDuration, 1);
    const e = easeInOutCubic(t);
    const sx = state.flyFrom.x, sy = state.flyFrom.y;
    // Fly upward-left with a smooth arc
    const tx = sx - W * 0.6;
    const ty = -120;
    p.x = sx + (tx - sx) * e;
    // Arc upward with a curve
    const midY = sy - H * 0.1;
    p.y = sy + (midY - sy) * easeOutCubic(t) + (ty - midY) * easeInCubic(t);
    // Smoothly pitch up
    p.angle = lerpAngle(Math.PI, Math.PI + 0.7, easeOutCubic(t));
    p.scale = 1 - 0.5 * easeInOutCubic(t);
    if (t >= 1) {
      p.visible = false;
      state.phase = 'idle';
      state.prevAngle = null;
      setTimeout(nextQuestion, 300);
    }
  } else if (state.phase === 'parked') {
    // stay
  }
}

// === Drawing (top-down bird's eye view) ===
function draw() {
  const now = performance.now() / 1000;

  // Green grass background
  ctx.fillStyle = '#5da84a';
  ctx.fillRect(0, 0, W, H);

  // Road at the very top
  drawRoad();

  // Terminal building (bottom)
  drawTerminal();

  // Taxiway connecting runway to gates
  drawTaxiways();

  // Runway (horizontal, middle)
  drawRunway();

  // Gates (parking spots below runway)
  state.gates.forEach(drawGate);

  // Parked planes at gates
  state.parkedAt.forEach((pp) => {
    drawPlaneTopDown(pp.x, pp.y, pp.angle, pp.scale);
  });

  // Active plane
  if (state.plane.visible) {
    const p = state.plane;
    drawPlaneTopDown(p.x, p.y, p.angle, p.scale);
  }

  // UI overlays
  if (state.clickEnabled) drawBanner();
  if (state.phase === 'incoming' && state.clickEnabled) drawCountdown();
  drawTablePlacard();
}

function drawRoad() {
  // Horizontal road at the top with lane markings
  const ry = H * 0.02;
  const rh = H * 0.05;
  ctx.fillStyle = '#3d3d3d';
  ctx.fillRect(0, ry, W, rh);
  // White dashed center line
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.setLineDash([16, 12]);
  ctx.beginPath();
  ctx.moveTo(0, ry + rh / 2);
  ctx.lineTo(W, ry + rh / 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // Edge lines
  ctx.fillStyle = '#eee';
  ctx.fillRect(0, ry, W, 2);
  ctx.fillRect(0, ry + rh - 2, W, 2);
}

function drawRunway() {
  const ry = H * 0.40;
  const rh = Math.max(32, H * 0.07);
  const rx = W * 0.1;
  const rw = W * 0.8;
  // Green grass shoulders
  ctx.fillStyle = '#6abf45';
  ctx.fillRect(rx - 8, ry - 10, rw + 16, rh + 20);
  // Asphalt
  ctx.fillStyle = '#2d2d2d';
  ctx.fillRect(rx, ry, rw, rh);
  // White edge lines
  ctx.fillStyle = '#fff';
  ctx.fillRect(rx, ry, rw, 3);
  ctx.fillRect(rx, ry + rh - 3, rw, 3);
  // Dashed center line
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.setLineDash([22, 16]);
  ctx.beginPath();
  ctx.moveTo(rx, ry + rh / 2);
  ctx.lineTo(rx + rw, ry + rh / 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // Threshold markings (left)
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 6; i++) {
    ctx.fillRect(rx + 10, ry + 5 + i * (rh - 10) / 6, 35, 3);
  }
  // Threshold markings (right)
  for (let i = 0; i < 6; i++) {
    ctx.fillRect(rx + rw - 45, ry + 5 + i * (rh - 10) / 6, 35, 3);
  }
  // Runway numbers
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('09', rx + 65, ry + rh / 2);
  ctx.fillText('27', rx + rw - 65, ry + rh / 2);
}

function drawTaxiways() {
  if (!state.gates.length) return;
  const ry = H * 0.40;
  const rh = Math.max(32, H * 0.07);
  const taxiW = 60;
  // Horizontal taxiway below runway
  const taxiY = ry + rh + 40;
  const taxiH = 60;

  // Connector from runway to taxiway (at center)
  const connX = W * 0.5;
  ctx.fillStyle = '#3d3d3d';
  ctx.fillRect(connX - taxiW / 2, ry + rh, taxiW, taxiY - (ry + rh));
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(connX, ry + rh);
  ctx.lineTo(connX, taxiY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Main horizontal taxiway
  ctx.fillStyle = '#3d3d3d';
  ctx.fillRect(W * 0.06, taxiY, W * 0.88, taxiH);
  // White edge lines
  ctx.fillStyle = '#777';
  ctx.fillRect(W * 0.06, taxiY, W * 0.88, 2);
  ctx.fillRect(W * 0.06, taxiY + taxiH - 2, W * 0.88, 2);
  // Yellow centerline
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 4;
  ctx.setLineDash([18, 12]);
  ctx.beginPath();
  ctx.moveTo(W * 0.06, taxiY + taxiH / 2);
  ctx.lineTo(W * 0.94, taxiY + taxiH / 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // Vertical spurs from taxiway down to each gate
  state.gates.forEach((g) => {
    const cx = g.x + g.w / 2;
    const spurTop = taxiY + taxiH;
    const spurBot = g.y;
    ctx.fillStyle = '#4a4a4a';
    ctx.fillRect(cx - taxiW / 2, spurTop, taxiW, spurBot - spurTop);
    // Edge markings
    ctx.fillStyle = '#888';
    ctx.fillRect(cx - taxiW / 2, spurTop, 2, spurBot - spurTop);
    ctx.fillRect(cx + taxiW / 2 - 2, spurTop, 2, spurBot - spurTop);
    // yellow centerline on spur
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(cx, spurTop);
    ctx.lineTo(cx, spurBot);
    ctx.stroke();
    ctx.setLineDash([]);
  });
}

function drawTerminal() {
  // Terminal building - styled like reference: beige with blue glass roof
  const gateBottom = H * 0.72 + Math.min(160, H * 0.30);
  const th = H - gateBottom + 15;
  const tw = W * 0.85;
  const tx = (W - tw) / 2;
  const ty = H - th;

  // Main building body (beige/tan)
  ctx.fillStyle = '#d4c9a8';
  ctx.fillRect(tx, ty, tw, th);
  ctx.strokeStyle = '#a89872';
  ctx.lineWidth = 2;
  ctx.strokeRect(tx, ty, tw, th);

  // Blue glass roof sections (circular pattern like reference)
  const centerX = tx + tw / 2;
  const centerY = ty + th * 0.4;
  ctx.fillStyle = '#5bb8d4';
  ctx.beginPath();
  ctx.arc(centerX, centerY, Math.min(th * 0.35, 30), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#3a98b4';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Inner ring
  ctx.fillStyle = '#7dcce4';
  ctx.beginPath();
  ctx.arc(centerX, centerY, Math.min(th * 0.2, 18), 0, Math.PI * 2);
  ctx.fill();
  // Center dot (yellow beacon)
  ctx.fillStyle = '#f0c040';
  ctx.beginPath();
  ctx.arc(centerX, centerY, 5, 0, Math.PI * 2);
  ctx.fill();

  // Blue glass wings (left and right)
  const wingW = tw * 0.28;
  const wingH = th * 0.5;
  // Left wing
  ctx.fillStyle = '#4da8c4';
  ctx.fillRect(tx + 8, ty + 6, wingW, wingH);
  ctx.strokeStyle = '#3a98b4';
  ctx.lineWidth = 1;
  // Glass panel lines
  for (let i = 0; i < 5; i++) {
    const px = tx + 8 + (wingW / 5) * i;
    ctx.beginPath(); ctx.moveTo(px, ty + 6); ctx.lineTo(px, ty + 6 + wingH); ctx.stroke();
  }
  // Right wing
  ctx.fillStyle = '#4da8c4';
  ctx.fillRect(tx + tw - wingW - 8, ty + 6, wingW, wingH);
  for (let i = 0; i < 5; i++) {
    const px = tx + tw - wingW - 8 + (wingW / 5) * i;
    ctx.beginPath(); ctx.moveTo(px, ty + 6); ctx.lineTo(px, ty + 6 + wingH); ctx.stroke();
  }

  // TERMINAL label
  ctx.fillStyle = '#4a3f2f';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TERMINAL', centerX, ty + th * 0.8);

  // Jet bridges from terminal to each gate
  state.gates.forEach((g) => {
    const bx = g.x + g.w / 2;
    const bridgeTop = g.y + g.h;
    const bridgeBot = ty;
    // Bridge corridor (wider, with articulation)
    ctx.fillStyle = '#b8b0a0';
    ctx.fillRect(bx - 7, bridgeTop, 14, bridgeBot - bridgeTop);
    ctx.strokeStyle = '#8a8070';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bx - 7, bridgeTop, 14, bridgeBot - bridgeTop);
    // Connector nozzle at gate end
    ctx.fillStyle = '#ef476f';
    ctx.fillRect(bx - 10, bridgeTop - 4, 20, 8);
    // Connector at terminal end
    ctx.fillStyle = '#8a8070';
    ctx.fillRect(bx - 10, bridgeBot - 4, 20, 8);
  });
}

function drawGate(g) {
  const r = 8;
  // Press feedback - strong button click feel
  let pressScale = 1;
  let pressOffsetY = 0;
  let glowAlpha = 0;
  if (g.pressTime) {
    const elapsed = performance.now() - g.pressTime;
    if (elapsed < 150) {
      // Quick squish down
      const t = elapsed / 150;
      pressScale = 1 - 0.12 * Math.sin(Math.PI * t);
      pressOffsetY = 4 * Math.sin(Math.PI * t);
      glowAlpha = 0.7;
    } else if (elapsed < 400) {
      // Bounce back
      const t = (elapsed - 150) / 250;
      pressScale = 1 + 0.03 * Math.sin(Math.PI * t);
      glowAlpha = 0.5 * (1 - t);
    }
  }

  ctx.save();
  // Scale + offset from center for press effect
  const cx = g.x + g.w / 2;
  const cy = g.y + g.h / 2;
  ctx.translate(cx, cy + pressOffsetY);
  ctx.scale(pressScale, pressScale);
  ctx.translate(-cx, -cy);

  // Gate apron pad
  let bgColor = '#b8bcc0';
  let borderColor = '#555';
  let borderWidth = 3;
  if (g.status === 'correct') { bgColor = '#5be0b3'; borderColor = '#04835f'; borderWidth = 5; }
  else if (g.status === 'wrong') { bgColor = '#ff7a92'; borderColor = '#a52a47'; borderWidth = 5; }

  // Glow effect on press
  if (glowAlpha > 0) {
    ctx.shadowColor = g.status === 'correct' ? '#06d6a0' : g.status === 'wrong' ? '#ef476f' : '#4dabf7';
    ctx.shadowBlur = 20;
  }

  ctx.fillStyle = bgColor;
  roundRect(g.x, g.y, g.w, g.h, r);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = borderWidth;
  ctx.stroke();

  // Parking position T-mark
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(g.x + g.w / 2, g.y);
  ctx.lineTo(g.x + g.w / 2, g.y + g.h * 0.5);
  ctx.moveTo(g.x + g.w * 0.3, g.y + g.h * 0.5);
  ctx.lineTo(g.x + g.w * 0.7, g.y + g.h * 0.5);
  ctx.stroke();

  // Gate label
  ctx.fillStyle = '#143b5e';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(g.label, g.x + g.w / 2, g.y + g.h * 0.55);

  // Big answer number
  ctx.fillStyle = g.status === 'idle' ? '#143b5e' : '#fff';
  const numFont = Math.min(56, Math.floor(g.h * 0.55));
  ctx.font = 'bold ' + numFont + 'px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(g.value, g.x + g.w / 2, g.y + g.h * 0.80);

  ctx.restore();
}

function drawClouds(now) {
  const cloudDefs = [
    { baseX: 0.1, y: 0.12, s: 1.8, speed: 12 },
    { baseX: 0.5, y: 0.28, s: 2.2, speed: 7 },
    { baseX: 0.8, y: 0.08, s: 1.5, speed: 15 },
    { baseX: 0.3, y: 0.60, s: 1.4, speed: 9 },
    { baseX: 0.7, y: 0.75, s: 1.7, speed: 6 },
  ];
  cloudDefs.forEach((c) => {
    const span = W + 250;
    let x = ((c.baseX * W + now * c.speed * 10) % span);
    if (x > W + 120) x -= span;
    drawCloud(x, H * c.y, c.s);
  });
}

function drawCloud(x, y, s) {
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.arc(x, y, 22 * s, 0, Math.PI * 2);
  ctx.arc(x + 22 * s, y + 5 * s, 16 * s, 0, Math.PI * 2);
  ctx.arc(x - 20 * s, y + 5 * s, 16 * s, 0, Math.PI * 2);
  ctx.arc(x + 8 * s, y - 10 * s, 14 * s, 0, Math.PI * 2);
  ctx.arc(x - 8 * s, y - 8 * s, 12 * s, 0, Math.PI * 2);
  ctx.fill();
}

// Top-down Boeing 737
function drawPlaneTopDown(x, y, angle, scale) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath();
  ctx.ellipse(3, 3, 30, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Wings (swept back)
  ctx.fillStyle = '#c4ccd4';
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-4, 0);
  ctx.lineTo(-14, -38);
  ctx.lineTo(-10, -40);
  ctx.lineTo(6, -6);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-4, 0);
  ctx.lineTo(-14, 38);
  ctx.lineTo(-10, 40);
  ctx.lineTo(6, 6);
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  // Engines (under wings)
  ctx.fillStyle = '#888';
  ctx.beginPath();
  ctx.ellipse(-6, -22, 6, 3, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-6, 22, 6, 3, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();

  // Horizontal stabilizers (tail)
  ctx.fillStyle = '#ddd';
  ctx.beginPath();
  ctx.moveTo(-26, 0);
  ctx.lineTo(-32, -14);
  ctx.lineTo(-28, -14);
  ctx.lineTo(-22, -2);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-26, 0);
  ctx.lineTo(-32, 14);
  ctx.lineTo(-28, 14);
  ctx.lineTo(-22, 2);
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  // Fuselage
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(32, 0);  // nose tip
  ctx.bezierCurveTo(28, -5, 10, -6, -20, -5);
  ctx.lineTo(-30, -3);
  ctx.lineTo(-30, 3);
  ctx.lineTo(-20, 5);
  ctx.bezierCurveTo(10, 6, 28, 5, 32, 0);
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  // Blue stripe along fuselage
  ctx.strokeStyle = '#0a7abf';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(28, 0);
  ctx.lineTo(-26, 0);
  ctx.stroke();

  // Cockpit windows
  ctx.fillStyle = '#2c4d66';
  ctx.beginPath();
  ctx.ellipse(26, -1.5, 3, 1.5, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(26, 1.5, 3, 1.5, -0.2, 0, Math.PI * 2);
  ctx.fill();

  // Tail fin (vertical stabilizer - appears as small triangle on top-down)
  ctx.fillStyle = '#ef476f';
  ctx.beginPath();
  ctx.moveTo(-26, 0);
  ctx.lineTo(-34, -2);
  ctx.lineTo(-34, 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBanner() {
  const { a, b } = state.current;
  if (!a) return;
  const text = `${a} × ${b} = ?`;
  const fontSize = Math.min(84, Math.max(40, W * 0.10));
  ctx.font = `bold ${fontSize}px sans-serif`;
  const tw = ctx.measureText(text).width;
  const padX = fontSize * 0.6, padY = fontSize * 0.35;
  const bw = tw + padX * 2;
  const bh = fontSize + padY * 2;
  const bx = (W - bw) / 2;
  const by = 12;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  roundRect(bx + 4, by + 5, bw, bh, 16); ctx.fill();
  // banner
  ctx.fillStyle = '#fff3b0';
  roundRect(bx, by, bw, bh, 16); ctx.fill();
  ctx.strokeStyle = '#143b5e';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = '#143b5e';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, by + bh / 2);
}

function drawCountdown() {
  const elapsed = performance.now() - state.phaseStart;
  const t = elapsed / state.phaseDuration;
  // Answer time starts at clickEnableAt and ends at 1.0
  const answerStart = state.clickEnableAt || 0;
  const answerProgress = Math.max(0, Math.min(1, (t - answerStart) / (1 - answerStart)));
  const remain = 1 - answerProgress;
  const totalAnswerMs = state.phaseDuration * (1 - answerStart);
  const secs = Math.max(0, totalAnswerMs * remain) / 1000;
  const barMaxW = 140;
  const barH = 10;
  const p = state.plane;
  const planeTop = p.y - 40;
  const by = Math.round(planeTop - barH - 14);
  const bx = Math.round(p.x - barMaxW / 2);
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(secs.toFixed(1) + 's', p.x + 1, by - 1);
  ctx.fillStyle = '#143b5e';
  ctx.fillText(secs.toFixed(1) + 's', p.x, by - 2);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  roundRect(bx, by, barMaxW, barH, 5); ctx.fill();
  let color = '#06d6a0';
  if (remain < 0.5) color = '#ffd166';
  if (remain < 0.25) color = '#ef476f';
  ctx.fillStyle = color;
  roundRect(bx, by, barMaxW * remain, barH, 5); ctx.fill();
  ctx.strokeStyle = '#143b5e';
  ctx.lineWidth = 1.5;
  roundRect(bx, by, barMaxW, barH, 5); ctx.stroke();
}

function drawTablePlacard() {
  const label = state.table === null ? 'Tafel: mix 🎲' : `Tafel van ${state.table}`;
  ctx.font = 'bold 18px sans-serif';
  const tw = ctx.measureText(label).width;
  const padX = 14, padY = 8;
  const bw = tw + padX * 2;
  const bh = 18 + padY * 2;
  const bx = 12;
  const by = 12;
  // post (sign on a pole)
  ctx.fillStyle = '#7a5a3a';
  ctx.fillRect(bx + 6, by + bh, 4, 14);
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  roundRect(bx + 2, by + 3, bw, bh, 8); ctx.fill();
  // sign
  ctx.fillStyle = '#06d6a0';
  roundRect(bx, by, bw, bh, 8); ctx.fill();
  ctx.strokeStyle = '#143b5e';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  // text
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, bx + bw / 2, by + bh / 2);
}

// === Main loop ===
function loop(now) {
  if (!$('game').classList.contains('hidden')) {
    updatePlane(now);
    draw();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// === Input ===
function handleCanvasClick(evt) {
  evt.preventDefault();
  if (!state.clickEnabled) return;
  const rect = canvas.getBoundingClientRect();
  const cx = (evt.clientX ?? evt.touches?.[0]?.clientX) - rect.left;
  const cy = (evt.clientY ?? evt.touches?.[0]?.clientY) - rect.top;
  for (const g of state.gates) {
    if (cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h) {
      g.pressTime = performance.now(); // trigger press flash
      onGateChosen(g);
      break;
    }
  }
}
canvas.addEventListener('click', handleCanvasClick);
canvas.addEventListener('touchstart', handleCanvasClick, { passive: false });

function onGateChosen(gate) {
  state.clickEnabled = false;
  const { correct, a, b } = state.current;
  const fb = $('feedback');
  const answerMs = performance.now() - state.phaseStart;
  if (gate.value === correct) {
    state.score++;
    gate.status = 'correct';
    const fast = answerMs <= FAST_ANSWER_MS;
    if (fast) {
      state.fastCount = (state.fastCount || 0) + 1;
      fb.textContent = `🚀 Wow FAST! Goed zo! Het vliegtuig landt bij ${gate.label}`;
    } else {
      fb.textContent = '✅ Goed zo! Het vliegtuig landt bij ' + gate.label;
    }
    fb.className = 'feedback good' + (fast ? ' fast' : '');
    $('score').textContent = state.score;
    startLanding(gate);
  } else {
    gate.status = 'wrong';
    // mark correct one
    const correctGate = state.gates.find((g) => g.value === correct);
    if (correctGate) correctGate.status = 'correct';
    fb.textContent = `❌ Oeps! ${a} × ${b} = ${correct}. Het vliegtuig vliegt weg!`;
    fb.className = 'feedback bad';
    state.mistakes.push({ a, b, correct, answer: gate.value });
    state.flyFrom = { x: state.plane.x, y: state.plane.y };
    setPhase('flyaway');
  }
}

function onTimeout() {
  state.clickEnabled = false;
  const { correct, a, b } = state.current;
  const fb = $('feedback');
  // Mark all gates red (missed)
  state.gates.forEach((g) => { g.status = 'wrong'; });
  // Highlight the correct one
  const correctGate = state.gates.find((g) => g.value === correct);
  if (correctGate) correctGate.status = 'correct';
  fb.textContent = `⏰ Te laat! ${a} × ${b} = ${correct}`;
  fb.className = 'feedback bad';
  state.mistakes.push({ a, b, correct, answer: null });
  state.flyFrom = { x: state.plane.x, y: state.plane.y };
  setPhase('flyaway');
}

function startLanding(gate) {
  state.landTarget = gate;
  state.landFrom = { x: state.plane.x, y: state.plane.y };

  // Build taxi path: current pos → connector point → taxiway level → gate spur → gate
  const ry = H * 0.40;
  const rh = Math.max(32, H * 0.07);
  const taxiY = ry + rh + 40;
  const taxiH = 60;
  const connX = W * 0.5; // connector center
  const taxiCenterY = taxiY + taxiH / 2;
  const gateX = gate.x + gate.w / 2;
  const gateY = gate.y - 12;
  const sx = state.plane.x;
  const sy = state.plane.y;

  state.landPath = [
    { x: sx, y: sy },                    // current position on runway
    { x: connX, y: sy },                 // taxi along runway to connector
    { x: connX, y: taxiCenterY },        // down connector to taxiway
    { x: gateX, y: taxiCenterY },        // along taxiway to gate spur
    { x: gateX, y: gateY },             // down spur to gate
  ];

  setPhase('landing');
}

// === Result ===
function showResult() {
  $('game').classList.add('hidden');
  $('result').classList.remove('hidden');
  document.body.classList.remove('game-active');
  const score = state.score;
  const total = TOTAL_QUESTIONS;
  const title = $('resultTitle');
  const text = $('resultText');
  const stars = $('stars');

  let starCount = 1;
  if (score === total) starCount = 5;
  else if (score >= 8) starCount = 4;
  else if (score >= 6) starCount = 3;
  else if (score >= 4) starCount = 2;
  stars.textContent = '⭐'.repeat(starCount) + '☆'.repeat(5 - starCount);

  if (score === total) title.textContent = '🏆 Perfect! Alle vliegtuigen veilig geland!';
  else if (score >= 7) title.textContent = '✈️ Goed gevlogen, piloot!';
  else title.textContent = '👨‍✈️ Nog even oefenen, piloot!';

  // High score handling
  const prevHigh = getHighScore(state.table);
  const isNewHigh = score > prevHigh;
  if (isNewHigh) setHighScore(state.table, score);
  const newHigh = isNewHigh ? score : prevHigh;

  const tableLabel = state.table === null ? 'mix' : `tafel van ${state.table}`;
  let msg = `Je had ${score} van de ${total} goed (${tableLabel}).`;
  if (state.fastCount) msg += ` 🚀 ${state.fastCount}× supersnel!`;
  if (isNewHigh) msg += ` 🎉 Nieuw record: ${score}!`;
  else msg += ` Hoogste score: ${newHigh}.`;
  if (state.mistakes.length > 0) {
    msg += ' Foutjes: ' + state.mistakes.map((m) => `${m.a}×${m.b}=${m.correct}`).join(', ');
  }
  text.textContent = msg;
}

// === Utils ===
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

showMenu();


