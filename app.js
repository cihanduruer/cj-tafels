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
    state.phaseDuration = 4000; // 4s realistic approach circuit
    // Random spawn point (different directions each time)
    const runwayY = H * 0.45 + Math.max(28, H * 0.06) / 2;
    const runwayRight = W * 0.8; // threshold (right end of runway)
    const spawns = [
      { x: W + 80, y: H * 0.1 },   // top-right
      { x: W + 80, y: H * 0.5 },   // mid-right
      { x: W * 0.5, y: -80 },      // top-center
      { x: W + 80, y: H * 0.8 },   // bottom-right
      { x: W * 0.8, y: H + 80 },   // bottom
    ];
    const spawn = spawns[Math.floor(Math.random() * spawns.length)];
    // Store approach path waypoints: spawn → base turn → final approach → threshold
    const baseX = runwayRight + W * 0.15;
    const baseY = runwayY + (spawn.y > runwayY ? -H * 0.18 : H * 0.18);
    state.approachPath = [
      { x: spawn.x, y: spawn.y },
      { x: baseX, y: spawn.y > runwayY ? runwayY - H * 0.12 : runwayY + H * 0.12 },
      { x: runwayRight + 30, y: runwayY },
      { x: runwayRight, y: runwayY },
    ];
    state.plane.scale = 0.5;
  } else if (phase === 'onstrip') {
    state.phaseDuration = 3000; // 3s flying along runway, user must answer
    state.clickEnabled = true;
  } else if (phase === 'landing') {
    state.phaseDuration = 2200;
  } else if (phase === 'passthru') {
    state.phaseDuration = 1200;
  } else if (phase === 'flyaway') {
    state.phaseDuration = 1600;
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
  const runwayY = H * 0.45 + Math.max(28, H * 0.06) / 2;

  if (state.phase === 'incoming') {
    // Follow the approach path (Catmull-Rom-like through waypoints)
    const t = Math.min(elapsed / state.phaseDuration, 1);
    const path = state.approachPath;
    const n = path.length - 1;
    const segment = Math.min(Math.floor(t * n), n - 1);
    const lt = (t * n) - segment;
    const e = easeInOut(lt);
    const from = path[segment];
    const to = path[segment + 1];
    p.x = from.x + (to.x - from.x) * e;
    p.y = from.y + (to.y - from.y) * e;
    // Point nose in direction of travel
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const targetAngle = Math.atan2(dy, dx);
    // On last segment, smoothly align to PI (pointing left for landing)
    if (segment === n - 1) {
      p.angle = lerpAngle(targetAngle, Math.PI, easeOutCubic(lt));
    } else {
      p.angle = targetAngle;
    }
    p.scale = 0.5 + 0.5 * easeOutCubic(t);
    if (t >= 1) setPhase('onstrip');
  } else if (state.phase === 'onstrip') {
    // Fly along runway from right to left over 3 seconds (aligned horizontal)
    const t = Math.min(elapsed / state.phaseDuration, 1);
    const e = easeInOutCubic(t);
    const startX = W * 0.8;
    const endX = W * 0.2;
    p.x = startX + (endX - startX) * e;
    p.y = runwayY;
    p.angle = Math.PI; // nose pointing left
    p.scale = 1;
    if (t >= 1) {
      onTimeout();
    }
  } else if (state.phase === 'landing') {
    // Taxi from current position down to the correct gate
    const t = Math.min(elapsed / state.phaseDuration, 1);
    const e = easeInOutCubic(t);
    const target = state.landTarget;
    const sx = state.landFrom.x, sy = state.landFrom.y;
    const tx = target.x + target.w / 2;
    const ty = target.y - 12;
    // Two-phase movement: first move horizontal to align with gate, then move down
    const phase1End = 0.4; // first 40% = horizontal align
    if (t < phase1End) {
      const lt = t / phase1End;
      const le = easeInOutCubic(lt);
      p.x = sx + (tx - sx) * le;
      p.y = sy;
      p.angle = Math.PI; // still pointing left while taxiing horizontally
    } else {
      const lt = (t - phase1End) / (1 - phase1End);
      const le = easeInOutCubic(lt);
      p.x = tx;
      p.y = sy + (ty - sy) * le;
      // Rotate from pointing left (PI) to pointing down (PI/2)
      p.angle = lerpAngle(Math.PI, Math.PI / 2, easeOutCubic(lt));
    }
    p.scale = 1 - 0.35 * easeInOutCubic(t);
    if (t >= 1) {
      state.parkedAt.push({ x: tx, y: ty, scale: 0.6, angle: Math.PI / 2 });
      state.phase = 'idle';
      p.visible = false;
      setTimeout(nextQuestion, 800);
    }
  } else if (state.phase === 'passthru') {
    // Continue flying left off-screen
    const t = Math.min(elapsed / state.phaseDuration, 1);
    const e = easeInCubic(t);
    const sx = state.flyFrom.x, sy = state.flyFrom.y;
    const tx = -100;
    p.x = sx + (tx - sx) * e;
    p.y = sy;
    p.angle = Math.PI; // keep pointing left
    p.scale = 1 - 0.2 * t;
    if (t >= 1) {
      p.visible = false;
      state.phase = 'idle';
      setTimeout(nextQuestion, 200);
    }
  } else if (state.phase === 'flyaway') {
    // Climb away upward-left
    const t = Math.min(elapsed / state.phaseDuration, 1);
    const e = easeInCubic(t);
    const sx = state.flyFrom.x, sy = state.flyFrom.y;
    const tx = -80;
    const ty = -80;
    p.x = sx + (tx - sx) * e;
    p.y = sy + (ty - sy) * e;
    p.angle = lerpAngle(Math.PI, Math.PI + 0.6, easeOutCubic(t)); // nose up-left
    p.scale = 1 - 0.4 * t;
    if (t >= 1) {
      p.visible = false;
      state.phase = 'idle';
      setTimeout(nextQuestion, 200);
    }
  } else if (state.phase === 'parked') {
    // stay
  }
}

// === Drawing (top-down bird's eye view) ===
function draw() {
  const now = performance.now() / 1000;

  // Grass background
  ctx.fillStyle = '#5da84a';
  ctx.fillRect(0, 0, W, H);
  // Subtle grass texture lines
  ctx.strokeStyle = 'rgba(80,140,60,0.3)';
  ctx.lineWidth = 1;
  for (let i = 0; i < W; i += 28) {
    ctx.beginPath();
    ctx.moveTo(i, 0); ctx.lineTo(i, H);
    ctx.stroke();
  }

  // Terminal building (bottom)
  drawTerminal();

  // Taxiway connecting runway to gates
  drawTaxiways();

  // Runway (horizontal, upper-middle)
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

  // Transparent drifting clouds (on top of everything)
  drawClouds(now);

  // UI overlays
  drawBanner();
  if (state.phase === 'onstrip') drawCountdown();
  drawTablePlacard();
}

function drawRunway() {
  const ry = H * 0.45;
  const rh = Math.max(28, H * 0.06);
  const rx = W * 0.2;
  const rw = W * 0.6;
  // Asphalt
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(rx, ry, rw, rh);
  // White edge lines
  ctx.fillStyle = '#fff';
  ctx.fillRect(rx, ry, rw, 3);
  ctx.fillRect(rx, ry + rh - 3, rw, 3);
  // Dashed center line
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.setLineDash([20, 15]);
  ctx.beginPath();
  ctx.moveTo(rx, ry + rh / 2);
  ctx.lineTo(rx + rw, ry + rh / 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // Threshold markings (left)
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(rx + 12, ry + 6 + i * (rh - 12) / 4, 30, 3);
  }
  // Threshold markings (right)
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(rx + rw - 42, ry + 6 + i * (rh - 12) / 4, 30, 3);
  }
  // Runway numbers
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('09', rx + 60, ry + rh / 2);
  ctx.fillText('27', rx + rw - 60, ry + rh / 2);
}

function drawTaxiways() {
  if (!state.gates.length) return;
  const ry = H * 0.45;
  const rh = Math.max(28, H * 0.06);
  const taxiW = 20;
  // Horizontal taxiway below runway
  const taxiY = ry + rh + 10;
  const taxiH = 20;
  ctx.fillStyle = '#555';
  ctx.fillRect(W * 0.15, taxiY, W * 0.7, taxiH);
  // Yellow centerline
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 2;
  ctx.setLineDash([12, 8]);
  ctx.beginPath();
  ctx.moveTo(W * 0.15, taxiY + taxiH / 2);
  ctx.lineTo(W * 0.85, taxiY + taxiH / 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // Vertical spurs from taxiway down to each gate
  state.gates.forEach((g) => {
    const cx = g.x + g.w / 2;
    const spurTop = taxiY + taxiH;
    const spurBot = g.y;
    ctx.fillStyle = '#555';
    ctx.fillRect(cx - taxiW / 2, spurTop, taxiW, spurBot - spurTop);
    // yellow centerline on spur
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(cx, spurTop);
    ctx.lineTo(cx, spurBot);
    ctx.stroke();
    ctx.setLineDash([]);
  });
}

function drawTerminal() {
  // Terminal building - fills from below gates to bottom of screen
  const gateBottom = H * 0.72 + Math.min(160, H * 0.30); // bottom edge of gates
  const th = H - gateBottom + 10; // extend past gate bottoms
  const tw = W * 0.9;
  const tx = (W - tw) / 2;
  const ty = H - th;
  // Main building
  ctx.fillStyle = '#d0d4d8';
  ctx.fillRect(tx, ty, tw, th);
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 2;
  ctx.strokeRect(tx, ty, tw, th);
  // Roof edge
  ctx.fillStyle = '#143b5e';
  ctx.fillRect(tx, ty, tw, 5);
  // Label
  ctx.fillStyle = '#143b5e';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('\u2708 TERMINAL', tx + tw / 2, ty + th / 2 + 10);
  // Control tower (circle, right side)
  const ctX = tx + tw - 50;
  const ctY = ty + 25;
  ctx.fillStyle = '#8ac4e0';
  ctx.beginPath();
  ctx.arc(ctX, ctY, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#143b5e';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#ef476f'; // beacon
  ctx.beginPath();
  ctx.arc(ctX, ctY, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#143b5e';
  ctx.font = 'bold 9px sans-serif';
  ctx.fillText('TWR', ctX, ctY + 24);

  // Jet bridges from terminal roof to each gate
  state.gates.forEach((g) => {
    const bx = g.x + g.w / 2;
    const bridgeTop = g.y + g.h; // bottom of gate
    const bridgeBot = ty; // top of terminal
    // Bridge corridor
    ctx.fillStyle = '#9ca3ab';
    ctx.fillRect(bx - 5, bridgeTop, 10, bridgeBot - bridgeTop);
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx - 5, bridgeTop, 10, bridgeBot - bridgeTop);
    // Connector circles at ends
    ctx.fillStyle = '#777';
    ctx.beginPath();
    ctx.arc(bx, bridgeTop, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(bx, bridgeBot, 6, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawGate(g) {
  const r = 8;
  // Press flash feedback
  let pressScale = 1;
  let glowAlpha = 0;
  if (g.pressTime) {
    const elapsed = performance.now() - g.pressTime;
    if (elapsed < 300) {
      pressScale = 1 - 0.05 * Math.sin(Math.PI * elapsed / 300);
      glowAlpha = 0.4 * (1 - elapsed / 300);
    }
  }

  ctx.save();
  // Scale from center for press effect
  const cx = g.x + g.w / 2;
  const cy = g.y + g.h / 2;
  ctx.translate(cx, cy);
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
  const remain = Math.max(0, 1 - elapsed / state.phaseDuration);
  const barMaxW = 140;
  const barH = 10;
  const p = state.plane;
  const planeTop = p.y - 40;
  const by = Math.round(planeTop - barH - 14);
  const bx = Math.round(p.x - barMaxW / 2);
  const secs = Math.max(0, state.phaseDuration - elapsed) / 1000;
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
  setPhase('passthru');
}

function startLanding(gate) {
  state.landTarget = gate;
  state.landFrom = { x: state.plane.x, y: state.plane.y };
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

