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
  const terminalW = Math.min(70, W * 0.10);
  const gateW = Math.min(170, W * 0.24);
  const topReserve = 70;
  const bottomReserve = Math.max(120, H * 0.30);
  const available = H - topReserve - bottomReserve;
  const gap = 14;
  const gateH = Math.min(64, (available - gap * (n - 1)) / n);
  const totalH = gateH * n + gap * (n - 1);
  const startY = topReserve + Math.max(0, (available - totalH) / 2);
  state.gates.forEach((g, i) => {
    g.x = terminalW;
    g.y = startY + i * (gateH + gap);
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

// Fullscreen button
const fsBtn = $('fullscreenBtn');
if (fsBtn) {
  fsBtn.addEventListener('click', toggleFullscreen);
}
function toggleFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement) {
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  }
}

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
    state.phaseDuration = 1800;
  } else if (phase === 'hovering') {
    state.phaseDuration = Infinity;
    state.clickEnabled = true;
  } else if (phase === 'landing') {
    state.phaseDuration = 2400;
  } else if (phase === 'looping') {
    state.phaseDuration = 2200;
  } else if (phase === 'flyaway') {
    state.phaseDuration = 1800;
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
  const hoverX = W * 0.70;
  const hoverY = H * 0.30;

  if (state.phase === 'incoming') {
    const t = Math.min(elapsed / state.phaseDuration, 1);
    const e = easeOut(t);
    const startX = W + 80;
    const startY = H * 0.16;
    p.x = startX + (hoverX - startX) * e;
    p.y = startY + (hoverY - startY) * e;
    p.angle = -0.08 * (1 - e);
    p.scale = 0.9 + 0.1 * e;
    if (t >= 1) setPhase('hovering');
  } else if (state.phase === 'hovering') {
    const t = elapsed / 1000;
    p.x = hoverX;
    p.y = hoverY + Math.sin(t * 2) * 6;
    p.angle = Math.sin(t * 2) * 0.05;
    p.scale = 1;
    // 3-second time limit to answer
    if (state.clickEnabled && elapsed >= HOVER_TIMEOUT_MS) {
      onTimeout();
    }
  } else if (state.phase === 'landing') {
    const t = Math.min(elapsed / state.phaseDuration, 1);
    const e = easeInOutCubic(t);
    const target = state.landTarget;
    const sx = state.landFrom.x, sy = state.landFrom.y;
    const tx = target.x + target.w + 38; // park to the right of the gate, nose touching jetbridge
    const ty = target.y + target.h / 2;
    // Cubic bezier: descend, then approach horizontally from the right.
    // Both control points placed so the final tangent is purely horizontal
    // (c2 shares y with target) for a smooth "flare" onto the gate.
    const dx = sx - tx;
    const c1x = sx - dx * 0.10;
    const c1y = sy + (ty - sy) * 0.55;
    const c2x = tx + dx * 0.45;
    const c2y = ty;
    const mt = 1 - e;
    const x = mt*mt*mt*sx + 3*mt*mt*e*c1x + 3*mt*e*e*c2x + e*e*e*tx;
    const y = mt*mt*mt*sy + 3*mt*mt*e*c1y + 3*mt*e*e*c2y + e*e*e*ty;
    const tdx = 3*mt*mt*(c1x - sx) + 6*mt*e*(c2x - c1x) + 3*e*e*(tx - c2x);
    const tdy = 3*mt*mt*(c1y - sy) + 6*mt*e*(c2y - c1y) + 3*e*e*(ty - c2y);
    p.x = x;
    p.y = y;
    const targetAngle = Math.atan2(tdy, tdx) + Math.PI; // nose faces left by default
    // Smoothly settle to angle 0 (level) at the end so parking is calm.
    const settle = Math.max(0, (e - 0.75) / 0.25); // 0..1 in last 25%
    p.angle = lerpAngle(targetAngle, 0, easeOutCubic(settle));
    p.scale = 1 - 0.5 * easeInOutCubic(t);
    if (t >= 1) {
      state.parkedAt.push({ x: tx, y: ty, scale: 0.5, angle: 0 });
      setPhase('parked');
      setTimeout(nextQuestion, 800);
    }
  } else if (state.phase === 'looping') {
    const t = Math.min(elapsed / state.phaseDuration, 1);
    const e = easeInOut(t);
    // circular loop centered above hover
    const cx = hoverX;
    const cy = hoverY - 70;
    const r = 70;
    const ang = -Math.PI / 2 + e * Math.PI * 2; // start at bottom, full loop
    p.x = cx + Math.cos(ang) * r;
    p.y = cy + Math.sin(ang) * r;
    p.angle = ang + Math.PI / 2; // tangent
    p.scale = 1;
    if (t >= 1) {
      setPhase('hovering');
      setTimeout(nextQuestion, 300);
    }
  } else if (state.phase === 'flyaway') {
    const t = Math.min(elapsed / state.phaseDuration, 1);
    const e = easeInCubic(t); // accelerate away
    const sx = state.flyFrom.x, sy = state.flyFrom.y;
    // Climb and exit toward the upper-left, curved path
    const tx = -140;
    const ty = -80;
    // Quadratic bezier with control point pulling up first, then left
    const cx = sx - Math.abs(sx - tx) * 0.25;
    const cy = Math.min(sy, ty) - 80;
    const mt = 1 - e;
    p.x = mt*mt*sx + 2*mt*e*cx + e*e*tx;
    p.y = mt*mt*sy + 2*mt*e*cy + e*e*ty;
    // Tangent for natural rotation (nose up, then climbing left)
    const tdx = 2*mt*(cx - sx) + 2*e*(tx - cx);
    const tdy = 2*mt*(cy - sy) + 2*e*(ty - cy);
    p.angle = Math.atan2(tdy, tdx) + Math.PI;
    p.scale = 1 - 0.35 * easeInOutCubic(t);
    if (t >= 1) {
      p.visible = false;
      state.phase = 'idle'; // prevent re-scheduling on subsequent frames
      setTimeout(nextQuestion, 200);
    }
  } else if (state.phase === 'parked') {
    // stay where we ended
  }
}

// === Drawing ===
function draw() {
  // Sky
  const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
  skyGrad.addColorStop(0, '#87ceeb');
  skyGrad.addColorStop(0.6, '#cfeeff');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H);

  // Distant clouds
  drawCloud(W * 0.15, H * 0.15, 0.8);
  drawCloud(W * 0.7, H * 0.1, 1.1);
  drawCloud(W * 0.45, H * 0.22, 0.6);

  // Ground (grass)
  const groundY = H * 0.62;
  const groundGrad = ctx.createLinearGradient(0, groundY, 0, H);
  groundGrad.addColorStop(0, '#a8d572');
  groundGrad.addColorStop(1, '#7bb348');
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, groundY, W, H - groundY);

  // Distant terminal building (back)
  drawTerminal(groundY);

  // Runway
  drawRunway(groundY);

  // Taxiways from runway to gates
  drawTaxiways(groundY);

  // Gates (parking spots)
  state.gates.forEach(drawGate);

  // Parked planes (small)
  state.parkedAt.forEach((pp) => {
    drawPlane(pp.x, pp.y, pp.angle || 0, pp.scale || 0.5);
  });

  // Question banner at top
  drawBanner();

  // Countdown bar while waiting for an answer
  if (state.phase === 'hovering') drawCountdown();

  // "Tafel van X" placard top-left
  drawTablePlacard();

  // Active plane
  if (state.plane.visible) {
    const p = state.plane;
    drawPlane(p.x, p.y, p.angle, p.scale);
  }
}

function drawCloud(x, y, s) {
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(x, y, 18 * s, 0, Math.PI * 2);
  ctx.arc(x + 18 * s, y + 4 * s, 14 * s, 0, Math.PI * 2);
  ctx.arc(x - 18 * s, y + 4 * s, 14 * s, 0, Math.PI * 2);
  ctx.arc(x + 6 * s, y - 8 * s, 12 * s, 0, Math.PI * 2);
  ctx.fill();
}

function drawTerminal(groundY) {
  const w = Math.min(70, W * 0.10);
  const topY = 70;
  const h = H - topY - 10;
  const x = 0;
  const y = topY;
  // building
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  // roof strip
  ctx.fillStyle = '#143b5e';
  ctx.fillRect(x, y - 6, w + 4, 10);
  // control tower on top-right of terminal
  const tw = 22, th = 70;
  const tx = x + w - tw - 6;
  const ty = y - th + 6;
  ctx.fillStyle = '#ccd';
  ctx.fillRect(tx, ty, tw, th);
  ctx.fillStyle = '#143b5e';
  ctx.fillRect(tx - 4, ty - 12, tw + 8, 16);
  ctx.fillStyle = '#5fb4d9';
  ctx.fillRect(tx - 2, ty - 8, tw + 4, 8);
  // windows column
  ctx.fillStyle = '#5fb4d9';
  const winW = Math.max(18, w - 16), winH = 18, winGap = 10;
  let yy = y + 14;
  while (yy + winH < y + h - 14) {
    ctx.fillRect(x + (w - winW) / 2, yy, winW, winH);
    yy += winH + winGap;
  }
  // vertical AIRPORT sign
  ctx.save();
  ctx.translate(x + w / 2, y + h - 50);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#143b5e';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('✈ AIRPORT', 0, 0);
  ctx.restore();
}

function drawTaxiways(groundY) {
  if (!state.gates.length) return;
  let maxRight = 0, minY = Infinity, maxY = -Infinity;
  state.gates.forEach((g) => {
    maxRight = Math.max(maxRight, g.x + g.w);
    minY = Math.min(minY, g.y);
    maxY = Math.max(maxY, g.y + g.h);
  });
  const taxiW = 30;
  const mainX = maxRight + 28;
  const topY = minY - 12;
  const botY = groundY + 14; // top edge of runway

  // asphalt apron under everything (subtle)
  ctx.fillStyle = '#6b6f73';
  ctx.fillRect(70, minY - 18, mainX + taxiW - 70 + 10, maxY - minY + 36);

  // main vertical taxiway
  ctx.fillStyle = '#555';
  ctx.fillRect(mainX, topY, taxiW, botY - topY);
  // spurs to each gate
  state.gates.forEach((g) => {
    const sy = g.y + g.h / 2 - taxiW / 2;
    ctx.fillRect(g.x + g.w, sy, mainX - (g.x + g.w), taxiW);
  });

  // yellow dashed taxi centerlines
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 7]);
  // main centerline
  ctx.beginPath();
  ctx.moveTo(mainX + taxiW / 2, topY);
  ctx.lineTo(mainX + taxiW / 2, botY);
  ctx.stroke();
  // spur centerlines
  state.gates.forEach((g) => {
    const cy = g.y + g.h / 2;
    ctx.beginPath();
    ctx.moveTo(g.x + g.w, cy);
    ctx.lineTo(mainX + taxiW / 2, cy);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  // edge stripes on apron border
  ctx.strokeStyle = '#cfd2d6';
  ctx.lineWidth = 1;
  ctx.strokeRect(70.5, minY - 17.5, mainX + taxiW - 70 + 9, maxY - minY + 35);
}

function drawRunway(groundY) {
  const ry = groundY + 14;
  const rh = 22;
  // runway
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(0, ry, W, rh);
  // edge lines
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, ry + 2); ctx.lineTo(W, ry + 2);
  ctx.moveTo(0, ry + rh - 2); ctx.lineTo(W, ry + rh - 2);
  ctx.stroke();
  // dashed center
  ctx.setLineDash([18, 14]);
  ctx.beginPath();
  ctx.moveTo(0, ry + rh / 2); ctx.lineTo(W, ry + rh / 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawGate(g) {
  const r = 8;

  // gate base
  let topColor = '#dcdcdc', botColor = '#b0b0b0', border = '#143b5e';
  if (g.status === 'correct') { topColor = '#5be0b3'; botColor = '#06d6a0'; border = '#04835f'; }
  else if (g.status === 'wrong') { topColor = '#ff7a92'; botColor = '#ef476f'; border = '#a52a47'; }

  const grad = ctx.createLinearGradient(g.x, g.y, g.x + g.w, g.y);
  grad.addColorStop(0, topColor);
  grad.addColorStop(1, botColor);
  ctx.fillStyle = grad;
  roundRect(g.x, g.y, g.w, g.h, r);
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = 3;
  ctx.stroke();

  // gate label panel (left side)
  const labelW = Math.min(46, g.w * 0.30);
  ctx.fillStyle = '#143b5e';
  roundRect(g.x + 5, g.y + 5, labelW, g.h - 10, 5);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('GATE', g.x + 5 + labelW / 2, g.y + g.h / 2 - 10);
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText(g.label.replace('GATE ', ''), g.x + 5 + labelW / 2, g.y + g.h / 2 + 6);

  // big number (the answer choice)
  ctx.fillStyle = g.status === 'idle' ? '#143b5e' : '#fff';
  const numFont = Math.floor(g.h * 0.55);
  ctx.font = 'bold ' + numFont + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(g.value, g.x + 5 + labelW + (g.w - labelW - 10) / 2, g.y + g.h / 2);

  // jetbridge sticking out to the right (where plane parks)
  const jbW = 18, jbH = 12;
  const jbX = g.x + g.w;
  const jbY = g.y + g.h / 2 - jbH / 2;
  ctx.fillStyle = '#9aa0a6';
  ctx.fillRect(jbX, jbY, jbW, jbH);
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1;
  ctx.strokeRect(jbX, jbY, jbW, jbH);
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
  const remain = Math.max(0, 1 - elapsed / HOVER_TIMEOUT_MS);
  const barMaxW = 140;
  const barH = 10;
  const p = state.plane;
  // Place the bar just above the plane's top edge (plane ~38px tall at scale 1)
  const planeTop = p.y - 40;
  const by = Math.round(planeTop - barH - 14); // leaves room for the seconds label
  const bx = Math.round(p.x - barMaxW / 2);
  // seconds label just above the bar
  const secs = Math.max(0, HOVER_TIMEOUT_MS - elapsed) / 1000;
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  // text shadow for readability
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(secs.toFixed(1) + 's', p.x + 1, by - 1);
  ctx.fillStyle = '#143b5e';
  ctx.fillText(secs.toFixed(1) + 's', p.x, by - 2);
  // track
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  roundRect(bx, by, barMaxW, barH, 5); ctx.fill();
  // fill (green -> orange -> red)
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

// Plane drawing (Boeing 737, side view, nose to the LEFT by default)
function drawPlane(x, y, angle, scale) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);

  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1a2a3a';
  ctx.lineWidth = 1.5;

  // --- swept main wing (behind fuselage) ---
  ctx.fillStyle = '#c4ccd4';
  ctx.beginPath();
  ctx.moveTo(-4, 4);
  ctx.lineTo(28, 22);
  ctx.lineTo(46, 22);
  ctx.lineTo(18, 3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // --- fuselage (long, slim 737 tube) ---
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  // pointed nose on the left, rounded tail on the right that sweeps up
  ctx.moveTo(-68, 0);              // tip of radome
  ctx.quadraticCurveTo(-58, -11, -40, -12); // upper nose curve
  ctx.lineTo(40, -12);             // upper fuselage straight
  ctx.quadraticCurveTo(58, -12, 64, -22);   // tail upsweep top
  ctx.lineTo(70, -22);             // back of tail cone top
  ctx.quadraticCurveTo(64, -8, 56, 8);      // tail cone underside
  ctx.lineTo(-40, 12);             // lower fuselage straight
  ctx.quadraticCurveTo(-58, 11, -68, 0);    // lower nose curve back to tip
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // --- blue cheatline along the fuselage ---
  ctx.strokeStyle = '#0a7abf';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-58, -2);
  ctx.lineTo(56, -2);
  ctx.stroke();
  // thinner secondary stripe
  ctx.strokeStyle = '#143b5e';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-58, 1.5);
  ctx.lineTo(56, 1.5);
  ctx.stroke();
  ctx.strokeStyle = '#1a2a3a';
  ctx.lineWidth = 1.5;

  // --- cockpit windows (angular, 737 style) ---
  ctx.fillStyle = '#2c4d66';
  ctx.beginPath();
  ctx.moveTo(-58, -4);
  ctx.lineTo(-50, -9);
  ctx.lineTo(-42, -9);
  ctx.lineTo(-40, -5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // window frame separator
  ctx.beginPath();
  ctx.moveTo(-50, -9);
  ctx.lineTo(-49, -5);
  ctx.stroke();

  // --- passenger windows (row of small squares) ---
  ctx.fillStyle = '#2c4d66';
  for (let i = -34; i < 42; i += 6) {
    ctx.fillRect(i, -6, 3, 3);
  }

  // --- door outline ---
  ctx.strokeStyle = '#1a2a3a';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(-36, -10, 4, 9);
  ctx.lineWidth = 1.5;

  // --- vertical stabilizer (tall swept tail fin) ---
  ctx.fillStyle = '#ef476f';
  ctx.beginPath();
  ctx.moveTo(34, -12);
  ctx.lineTo(54, -38);
  ctx.lineTo(64, -38);
  ctx.lineTo(58, -12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // fin marking line
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(48, -30);
  ctx.lineTo(60, -22);
  ctx.stroke();
  ctx.strokeStyle = '#1a2a3a';

  // --- horizontal stabilizer (small swept wing on tail) ---
  ctx.fillStyle = '#dde2e7';
  ctx.beginPath();
  ctx.moveTo(54, -14);
  ctx.lineTo(72, -18);
  ctx.lineTo(74, -12);
  ctx.lineTo(58, -10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // --- underwing engine (CFM56, slung low - 737 signature) ---
  // pylon
  ctx.fillStyle = '#bfc6cd';
  ctx.fillRect(10, 8, 10, 8);
  ctx.strokeRect(10, 8, 10, 8);
  // nacelle (flat-bottom oval)
  ctx.fillStyle = '#e8ecef';
  ctx.beginPath();
  ctx.moveTo(2, 16);
  ctx.quadraticCurveTo(2, 26, 14, 27);
  ctx.lineTo(24, 27);
  ctx.quadraticCurveTo(34, 26, 32, 16);
  ctx.lineTo(28, 14);
  ctx.lineTo(6, 14);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // engine intake (dark front)
  ctx.fillStyle = '#1a2a3a';
  ctx.beginPath();
  ctx.ellipse(4, 20, 2, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  // engine fan hint
  ctx.fillStyle = '#5a6066';
  ctx.beginPath();
  ctx.ellipse(4.5, 20, 1, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  // exhaust at back of nacelle
  ctx.fillStyle = '#444';
  ctx.fillRect(30, 18, 3, 6);

  // --- winglet (upswept tip) on far wing ---
  ctx.fillStyle = '#c4ccd4';
  ctx.beginPath();
  ctx.moveTo(44, 22);
  ctx.lineTo(48, 14);
  ctx.lineTo(52, 15);
  ctx.lineTo(48, 22);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // --- subtle "B737" tail-number text ---
  ctx.fillStyle = '#143b5e';
  ctx.font = 'bold 5px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('B737', 48, -6);

  ctx.restore();
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
  if (!state.clickEnabled) return;
  const rect = canvas.getBoundingClientRect();
  const cx = (evt.clientX ?? evt.touches?.[0]?.clientX) - rect.left;
  const cy = (evt.clientY ?? evt.touches?.[0]?.clientY) - rect.top;
  for (const g of state.gates) {
    if (cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h) {
      onGateChosen(g);
      break;
    }
  }
}
canvas.addEventListener('click', handleCanvasClick);

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
  const correctGate = state.gates.find((g) => g.value === correct);
  if (correctGate) correctGate.status = 'correct';
  fb.textContent = `⏰ Te laat! ${a} × ${b} = ${correct}. Het vliegtuig vliegt weg!`;
  fb.className = 'feedback bad';
  state.mistakes.push({ a, b, correct, answer: null });
  state.flyFrom = { x: state.plane.x, y: state.plane.y };
  setPhase('flyaway');
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

