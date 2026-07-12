#!/usr/bin/env node
'use strict';
// haecho.js — ASCII terminal aquarium
// run:  node haecho.js        (or ./run --live)
// keys: f=feed  a=add fish  x=remove fish  q=quit

const out = process.stdout;
const args = process.argv.slice(2);
const TEST_FRAMES = (() => {
  const i = args.indexOf('--frames');
  return i >= 0 ? parseInt(args[i + 1], 10) || 60 : 0;
})();

let W = 80, H = 24;
function updateSize() {
  W = Math.max(40, out.columns || 80);
  H = Math.max(14, out.rows || 24);
}

const rnd = (a, b) => a + Math.random() * (b - a);
const ri = (a, b) => Math.floor(rnd(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const C = (n) => `\x1b[38;5;${n}m`;
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

const GREEN_DIM = [22, 28, 29, 65];
const GREEN_LIT = [35, 41, 77, 84, 120];
const WAVE_BRIGHT = 45, WAVE_MID = 38, WAVE_DIM = 24;
const ROCK_COLS = [240, 242, 244, 246, 60, 66, 103];
const STAR_COLS = [162, 169, 205, 213, 141];
const FISH_COLS = [209, 215, 117, 81, 231, 152, 175];
const PLANKTON_COLS = [237, 238, 240, 24, 31];

const DT = 1 / 30;
let t = 0;

// ── world state ──────────────────────────────────────────────
let fish = [], jellies = [], turtles = [], bubbles = [], foods = [];
let grass = [], kelp = [], rockCells = [], stars = [], plankton = [];
let duck = null;

function waterTop() { return 3; }
function floorY() { return H - 2; }

function makeFish() {
  return {
    x: rnd(2, W - 5),
    y: rnd(waterTop() + 1, floorY() - 4),
    vx: pick([-1, 1]),
    sp: rnd(3, 8),
    ty: 0,
    retarget: 0,
    col: pick(FISH_COLS),
  };
}

const JELLY_COLS = [[213, 169], [183, 139], [141, 103], [159, 73], [225, 182]];
function makeJelly() {
  const [col, tcol] = pick(JELLY_COLS);
  return {
    x: rnd(3, W - 8),
    y: rnd(waterTop() + 1, floorY() - 6),
    vx: pick([-1, 1]) * rnd(0.2, 0.7),
    pulseSp: rnd(1.1, 2.0),
    phase: rnd(0, Math.PI * 2),
    col, tcol,
  };
}

function makeTurtle() {
  return {
    x: rnd(5, W - 16),
    y: rnd(waterTop() + 2, floorY() - 5),
    vx: pick([-1, 1]) * rnd(1.5, 3),
    ty: rnd(waterTop() + 2, floorY() - 5),
    retarget: rnd(4, 10),
    breath: rnd(15, 30),
    surfacing: false,
    col: pick([65, 71, 108]),
    shell: pick([94, 101, 137]),
  };
}

function makeScenery() {
  grass = []; kelp = []; rockCells = []; stars = []; plankton = [];

  // short grass across the seabed
  for (let x = 0; x < W; x++) {
    if (Math.random() < 0.88) {
      grass.push({
        x, h: ri(1, 4), phase: rnd(0, Math.PI * 2),
        sp: rnd(0.7, 1.5), col: pick(Math.random() < 0.35 ? GREEN_LIT : GREEN_DIM),
      });
    }
  }
  // tall swaying kelp
  const nKelp = Math.floor(W / 7);
  for (let i = 0; i < nKelp; i++) {
    kelp.push({
      x: ri(1, W - 2), h: ri(5, Math.min(9, H - 9)),
      phase: rnd(0, Math.PI * 2), sp: rnd(0.4, 0.9), col: pick(GREEN_LIT),
    });
  }
  // two rock mounds
  const mound = (cx, w, h) => {
    const baseY = floorY() - 1;
    for (let r = 0; r < h; r++) {
      const y = baseY - h + 1 + r;
      const frac = (r + 1) / h;
      const half = Math.max(1, Math.round((w / 2) * Math.sqrt(frac) + rnd(-1, 1)));
      for (let x = cx - half; x <= cx + half; x++) {
        if (x < 0 || x >= W || Math.random() < 0.12) continue;
        let ch = pick(['#', '#', '@', '@', '%', '&', '8']);
        let col = pick(ROCK_COLS);
        if (Math.random() < 0.05) { ch = '*'; col = 84; }        // barnacle
        else if (Math.random() < 0.03) { ch = '%'; col = 205; }  // coral fleck
        rockCells.push({ x, y, ch, col });
      }
    }
  };
  mound(Math.round(W * 0.26), Math.round(W * 0.20), ri(3, 5));
  mound(Math.round(W * 0.62), Math.round(W * 0.30), ri(4, 6));

  // starfish on the sand
  const nStars = ri(5, 9);
  for (let i = 0; i < nStars; i++) {
    stars.push({
      x: ri(1, W - 3), y: ri(floorY() - 2, floorY()),
      ch: Math.random() < 0.3 ? '**' : '*', col: pick(STAR_COLS),
    });
  }
  // drifting plankton specks
  const nP = Math.floor((W * H) / 55);
  for (let i = 0; i < nP; i++) {
    plankton.push({
      x: rnd(0, W), y: rnd(waterTop(), floorY() - 3),
      vx: rnd(-0.3, 0.3), phase: rnd(0, Math.PI * 2), sp: rnd(0.3, 1.2),
      ch: pick(['.', '.', '.', ':']), col: pick(PLANKTON_COLS),
    });
  }

  duck = { x: rnd(5, W - 10), vx: pick([-1, 1]) * rnd(0.8, 1.4) };
}

function feed() {
  const cx = rnd(4, W - 5);
  const n = ri(5, 9);
  for (let i = 0; i < n; i++) {
    foods.push({
      x: clamp(cx + rnd(-3, 3), 1, W - 2), y: rnd(2.5, 3.5),
      vy: rnd(1.2, 2.6), phase: rnd(0, Math.PI * 2),
    });
  }
}

// ── simulation ───────────────────────────────────────────────
function update() {
  t += DT;

  // duck paddles along the surface
  duck.x += duck.vx * DT;
  if (duck.x < 1) { duck.x = 1; duck.vx = Math.abs(duck.vx); }
  if (duck.x > W - 7) { duck.x = W - 7; duck.vx = -Math.abs(duck.vx); }
  if (Math.random() < 0.003) duck.vx = -duck.vx;

  // food sinks, wobbling
  for (const f of foods) {
    if (f.y < floorY() - 1) {
      f.y += f.vy * DT;
      f.x += Math.sin(t * 2 + f.phase) * 0.6 * DT;
    } else {
      f.y = floorY() - 1;
    }
  }

  // fish
  for (const p of fish) {
    let target = null, best = Infinity;
    for (const f of foods) {
      const d = Math.abs(f.x - p.x) + Math.abs(f.y - p.y);
      if (d < best) { best = d; target = f; }
    }
    if (target) {
      const dx = target.x - p.x, dy = target.y - p.y;
      if (Math.abs(dx) > 0.6) p.vx = Math.sign(dx);
      p.x += p.vx * p.sp * 1.6 * DT;
      p.y += clamp(dy, -1, 1) * p.sp * 0.6 * DT;
      if (Math.abs(dx) < 1.4 && Math.abs(dy) < 1) {
        foods.splice(foods.indexOf(target), 1);
        bubbles.push({ x: p.x + (p.vx > 0 ? 2 : 0), y: p.y - 0.5, vy: rnd(2, 3.5), phase: rnd(0, 6), age: 0 });
      }
    } else {
      p.retarget -= DT;
      if (p.retarget <= 0) {
        p.retarget = rnd(2, 7);
        p.ty = rnd(waterTop() + 1, floorY() - 4);
        if (Math.random() < 0.35) p.vx = -p.vx;
        p.sp = rnd(3, 8);
      }
      p.x += p.vx * p.sp * DT;
      p.y += clamp(p.ty - p.y, -1, 1) * 0.5 * DT;
    }
    if (p.x < 1) { p.x = 1; p.vx = 1; }
    if (p.x > W - 4) { p.x = W - 4; p.vx = -1; }
    p.y = clamp(p.y, waterTop() + 0.5, floorY() - 1.5);
    if (Math.random() < 0.008) {
      bubbles.push({ x: p.x + (p.vx > 0 ? 2.5 : -0.5), y: p.y, vy: rnd(2, 4), phase: rnd(0, 6), age: 0 });
    }
  }

  // turtles: cruise slowly, surface to breathe every so often
  for (const tu of turtles) {
    tu.breath -= DT;
    if (tu.breath <= 0 && !tu.surfacing) {
      tu.surfacing = true;
      tu.ty = waterTop() + 1;
    }
    if (!tu.surfacing) {
      tu.retarget -= DT;
      if (tu.retarget <= 0) {
        tu.retarget = rnd(4, 10);
        tu.ty = rnd(waterTop() + 2, floorY() - 5);
        if (Math.random() < 0.25) tu.vx = -tu.vx;
      }
    }
    tu.x += tu.vx * DT;
    tu.y += clamp(tu.ty - tu.y, -1.2, 1.2) * (tu.surfacing ? 1.1 : 0.4) * DT;
    if (tu.x < 1) { tu.x = 1; tu.vx = Math.abs(tu.vx); }
    if (tu.x > W - 12) { tu.x = W - 12; tu.vx = -Math.abs(tu.vx); }
    tu.y = clamp(tu.y, waterTop() + 1, floorY() - 4);
    if (tu.surfacing && tu.y <= waterTop() + 1.3) {
      // took a breath: exhale a burst of big bubbles, then dive again
      const hx = tu.vx > 0 ? tu.x + 10 : tu.x;
      for (let i = 0; i < 4; i++) {
        bubbles.push({ x: hx + rnd(-1, 1), y: tu.y - 0.5, vy: rnd(2, 4), phase: rnd(0, 6), age: rnd(1.2, 2.4) });
      }
      tu.surfacing = false;
      tu.breath = rnd(20, 40);
      tu.ty = rnd(waterTop() + 3, floorY() - 5);
    }
  }

  // jellyfish: thrust upward on each bell contraction, sink between pulses
  for (const j of jellies) {
    const pulse = Math.sin(t * j.pulseSp + j.phase);
    const vy = pulse > 0 ? -pulse * 2.4 : 0.6;
    j.y += vy * DT;
    j.x += (j.vx + Math.sin(t * 0.5 + j.phase) * 0.4) * DT;
    if (j.x < 1) { j.x = 1; j.vx = Math.abs(j.vx); }
    if (j.x > W - 6) { j.x = W - 6; j.vx = -Math.abs(j.vx); }
    j.y = clamp(j.y, waterTop() + 0.5, floorY() - 4);
    if (Math.random() < 0.02) j.vx = clamp(j.vx + rnd(-0.25, 0.25), -0.8, 0.8);
    if (Math.random() < 0.004) {
      bubbles.push({ x: j.x + 2, y: j.y - 0.5, vy: rnd(1.5, 3), phase: rnd(0, 6), age: 0 });
    }
  }

  // ambient bubbles from the seabed and kelp tips
  if (Math.random() < 0.10) {
    bubbles.push({ x: rnd(1, W - 2), y: floorY() - rnd(0, 3), vy: rnd(1.5, 3.5), phase: rnd(0, 6), age: 0 });
  }
  for (const b of bubbles) {
    b.age += DT;
    b.y -= b.vy * DT;
    b.x += Math.sin(t * 3 + b.phase) * 1.2 * DT;
  }
  bubbles = bubbles.filter((b) => b.y > waterTop() - 1);

  // plankton drift
  for (const p of plankton) {
    p.x += p.vx * DT;
    if (p.x < 0) p.x = W - 1;
    if (p.x >= W) p.x = 0;
  }
}

// ── rendering ────────────────────────────────────────────────
let grid;
function put(x, y, ch, col) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  grid[y][x] = [ch, col];
}
function putStr(x, y, str, col) {
  for (let i = 0; i < str.length; i++) put(x + i, y, str[i], col);
}

function render(fps) {
  grid = Array.from({ length: H }, () => Array.from({ length: W }, () => [' ', 0]));

  // plankton (twinkling)
  for (const p of plankton) {
    if (Math.sin(t * p.sp + p.phase) > -0.2) put(p.x, p.y, p.ch, p.col);
  }

  // rocks
  for (const c of rockCells) put(c.x, c.y, c.ch, c.col);

  // grass + kelp (swaying blades, drawn bottom-up)
  const drawBlade = (b, amp) => {
    let prev = 0;
    for (let i = 0; i < b.h; i++) {
      const lean = Math.sin(t * b.sp + b.phase + i * 0.4) * amp * ((i + 1) / b.h);
      const off = Math.round(lean);
      let ch = '|';
      if (off > prev) ch = '/';
      else if (off < prev) ch = '\\';
      if (ch === '|' && Math.abs(lean - off) > 0.3) ch = lean > off ? ')' : '(';
      const y = floorY() - i;
      const col = i >= b.h - 2 && b.h > 2 ? pickBright(b.col) : b.col;
      put(b.x + off, y, ch, col);
      prev = off;
    }
  };
  for (const g of grass) drawBlade(g, 1.2);
  for (const k of kelp) drawBlade(k, 2.6);

  // starfish
  for (const s of stars) putStr(s.x, s.y, s.ch, s.col);

  // food pellets
  for (const f of foods) put(f.x, f.y, ':', 214);

  // bubbles
  for (const b of bubbles) {
    const ch = b.age < 0.8 ? '.' : b.age < 2 ? 'o' : 'O';
    put(b.x, b.y, ch, b.age < 2 ? 31 : 45);
  }

  // turtles (patterned shell, head, paddling flippers)
  for (const tu of turtles) {
    const x = Math.round(tu.x), y = Math.round(tu.y);
    const right = tu.vx > 0;
    putStr(x + 2, y, '.==-==.', tu.shell);
    putStr(x + 1, y + 1, '(  # #  )', tu.col);
    put(x + 4, y + 1, '#', tu.shell);
    put(x + 6, y + 1, '#', tu.shell);
    put(right ? x : x + 10, y + 1, '~', tu.col);         // tail
    put(right ? x + 10 : x, y + 1, 'o', tu.col);         // head
    const paddle = Math.floor(t * 2.5) % 2 === 0;
    put(x + 3, y + 2, paddle ? '/' : '\\', tu.col);
    put(x + 7, y + 2, paddle ? '\\' : '/', tu.col);
  }

  // jellyfish (pulsing bell + trailing tentacles)
  for (const j of jellies) {
    const pulse = Math.sin(t * j.pulseSp + j.phase);
    const open = pulse > 0;
    const x = Math.round(j.x), y = Math.round(j.y);
    putStr(x + 1, y, '.-.', j.col);
    putStr(x + (open ? 0 : 1), y + 1, open ? '(   )' : '(_)', j.col);
    const tx = open ? [0, 2, 4] : [1, 2, 3];
    for (let k = 0; k < 3; k++) {
      for (let r = 0; r < 2; r++) {
        const s = Math.sin(t * 2.5 + j.phase + k * 1.3 + r * 0.7);
        const ch = s > 0.4 ? '/' : s < -0.4 ? '\\' : '|';
        put(x + tx[k] + Math.round(s * 0.6), y + 2 + r, ch, j.tcol);
      }
    }
  }

  // fish
  for (const p of fish) {
    putStr(p.x, p.y, p.vx > 0 ? '><>' : '<><', p.col);
  }

  // surface waves (drawn over everything near the top)
  for (let x = 0; x < W; x++) {
    const s = Math.sin(x * 0.31 - t * 1.4) + Math.sin(x * 0.13 + t * 0.8);
    if (s > -0.5) {
      const col = s > 1.1 ? WAVE_BRIGHT : s > 0.2 ? WAVE_MID : WAVE_DIM;
      put(x, 1, '~', col);
    }
    if (s > 0.9) put(x, 2, '~', WAVE_DIM);
  }

  // duck floating on the waves, orange feet below
  putStr(duck.x, 1, '(..~)', 230);
  putStr(duck.x + 1, 2, '::', 214);

  // status line (row 0)
  const stats = `fish:${fish.length}  jelly:${jellies.length}  turtle:${turtles.length}  food:${foods.length}  fps:${fps}`;
  const hint = '[f]eed [a/j/t]add [x]del [q]uit';
  compose_status(stats, hint);

  out.write(toAnsi());
}

function pickBright(col) {
  return GREEN_LIT.includes(col) ? col : 41;
}

function compose_status(stats, hint) {
  const prompt = 'haecho@tank:~$ ';
  const cmd = './run --live';
  putStr(0, 0, prompt, 252);
  putStr(prompt.length, 0, cmd, 81);
  putStr(prompt.length + cmd.length + 3, 0, stats, 74);
  const hx = W - hint.length - 1;
  if (hx > prompt.length + cmd.length + stats.length + 6) putStr(hx, 0, hint, 240);
}

function toAnsi() {
  let s = '\x1b[H';
  for (let y = 0; y < H; y++) {
    let last = -1;
    for (let x = 0; x < W; x++) {
      const [ch, col] = grid[y][x];
      if (ch === ' ') { s += ' '; continue; }
      if (col !== last) { s += C(col); last = col; }
      s += ch;
    }
    if (y < H - 1) s += '\n';
  }
  return s + RESET;
}

// ── main ─────────────────────────────────────────────────────
function cleanup() {
  out.write('\x1b[?25h\x1b[?1049l');
  process.exit(0);
}

updateSize();
makeScenery();
for (let i = 0; i < 6; i++) fish.push(makeFish());
for (let i = 0; i < 2; i++) jellies.push(makeJelly());
turtles.push(makeTurtle());

if (TEST_FRAMES > 0) {
  // headless test: simulate N frames, dump one rendered frame, exit
  const doFeed = args.includes('--feed');
  if (doFeed) feed();
  const fed = foods.length;
  for (let i = 0; i < TEST_FRAMES; i++) update();
  render(30);
  out.write('\n');
  if (doFeed) out.write(`[test] pellets dropped:${fed} remaining:${foods.length} bubbles:${bubbles.length}\n`);
  process.exit(0);
}

out.write('\x1b[?1049h\x1b[?25l\x1b[2J');

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (key) => {
    if (key === 'q' || key === '\x03' || key === '\x1b') cleanup();
    else if (key === 'f') feed();
    else if (key === 'a') fish.push(makeFish());
    else if (key === 'j') jellies.push(makeJelly());
    else if (key === 't') turtles.push(makeTurtle());
    else if (key === 'x') {
      if (fish.length > 0) fish.pop();
      else if (jellies.length > 0) jellies.pop();
      else if (turtles.length > 0) turtles.pop();
    }
  });
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

out.on('resize', () => {
  updateSize();
  makeScenery();
  for (const p of fish) { p.x = clamp(p.x, 1, W - 4); p.y = clamp(p.y, waterTop() + 1, floorY() - 2); }
  for (const j of jellies) { j.x = clamp(j.x, 1, W - 6); j.y = clamp(j.y, waterTop() + 0.5, floorY() - 4); }
  for (const tu of turtles) { tu.x = clamp(tu.x, 1, W - 12); tu.y = clamp(tu.y, waterTop() + 1, floorY() - 4); }
  foods = []; bubbles = [];
  out.write('\x1b[2J');
});

let frames = 0, fpsShown = 30, lastFpsAt = Date.now();
setInterval(() => {
  update();
  frames++;
  const now = Date.now();
  if (now - lastFpsAt >= 1000) {
    fpsShown = frames;
    frames = 0;
    lastFpsAt = now;
  }
  render(fpsShown);
}, 33);
