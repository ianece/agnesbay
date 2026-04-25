/* ══════════════════════════════════════
   TUNING — edit these to dial in the feel
   ══════════════════════════════════════ */
const CFG = {
  segments:  32,      // number of chain links (fewer = faster/stiffer)
  gravity:   0.35,    // downward pull per frame
  damping:   0.88,    // velocity decay (0=no movement, 1=no decay)
  stiffness: 1,       // constraint iterations (higher = tighter wire)
  segLen:    8,      // natural length of each segment in px
  slack:     1.4,     // multiplier on segLen (more = droopier wire)
  probeSnap: 0.22,    // how fast probe follows mouse (0.05=laggy, 0.5=snappy)
  anchorX:   36,      // x position of jack plug in sidebar (px from left)
  anchorY:   82,      // y position of jack plug (px from top of page)
};
/* ══════════════════════════════════════ */

function oscTogglePlay() {
  if (!currentAudio) return;
  if (currentAudio.paused) {
    currentAudio.play();
    vizWrap.classList.add('active');
    document.getElementById('track-' + currentIdx).classList.add('playing');
    waveTarget = 'audio'; waveMode = 'audio';
    document.getElementById('osc-play-icon').style.display  = 'none';
    document.getElementById('osc-pause-icon').style.display = 'block';
  } else {
    currentAudio.pause();
    vizWrap.classList.remove('active');
    document.getElementById('track-' + currentIdx).classList.remove('playing');
    waveTarget = 'sine'; waveMode = 'sine';
    window._audioTimeData = null;
    document.getElementById('osc-play-icon').style.display  = 'block';
    document.getElementById('osc-pause-icon').style.display = 'none';
  }
}

/* ── AUDIO PLAYER ── */
const TRACKS = [
  { file: 'assets/audio/haze-to-come.mp3', title: 'haze to come [DEMO]' },
  {file: 'assets/audio/thevoiceofbeauty-mp3.mp3', title: 'the voice of beauty [DEMO]' },
  {file: 'assets/audio/firepit-mp3.mp3', title: 'firepit' },
  // Add more: { file: 'assets/audio/your-track.mp3', title: 'track name' },
];

let audioCtx = null, analyser = null, source = null;
let currentAudio = null, currentIdx = -1;
const vizWrap = document.getElementById('viz-wrap');
const nowPlaying = document.getElementById('now-playing');
const npTitle = document.getElementById('np-title');

/* Build visualizer bars */
const BAR_COUNT = 40;
for (let i = 0; i < BAR_COUNT; i++) {
  const b = document.createElement('div');
  b.className = 'viz-bar';
  b.id = 'vb-' + i;
  vizWrap.appendChild(b);
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}

function setDuration(idx, dur) {
  const el = document.getElementById('dur-' + idx);
  if (el) el.textContent = formatTime(dur);
}

function setProgress(idx, current, duration) {
  const bar = document.getElementById('prog-' + idx);
  const time = document.getElementById('time-' + idx);
  if (bar) bar.style.width = ((current / duration) * 100).toFixed(2) + '%';
  if (time) time.textContent = formatTime(current);
}

function clearActive() {
  document.querySelectorAll('.track-row').forEach(r => r.classList.remove('playing'));
  vizWrap.classList.remove('active');
  nowPlaying.classList.remove('visible');
  waveTarget = 'sine'; waveMode = 'sine';
  window._audioTimeData = null;
  const ppBtn = document.getElementById('osc-playpause');
  if (ppBtn) ppBtn.style.display = 'none';
}

function playTrack(idx) {
  const track = TRACKS[idx];
  if (!track) return;

  /* If same track — toggle pause */
  if (currentIdx === idx && currentAudio) {
    if (currentAudio.paused) {
      currentAudio.play();
      vizWrap.classList.add('active');
      document.getElementById('track-' + idx).classList.add('playing');
    } else {
      currentAudio.pause();
      vizWrap.classList.remove('active');
      document.getElementById('track-' + idx).classList.remove('playing');
      waveTarget = 'sine';
      waveMode   = 'sine';
      window._audioTimeData = null;
    }
    return;
  }

  /* Stop current */
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
  }
  clearActive();

  /* Set up Web Audio API on first play (requires user gesture) */
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;
    analyser.connect(audioCtx.destination);
  }

  const audio = new Audio();
  audio.crossOrigin = 'anonymous';
  audio.src = track.file;
  audio.preload = 'metadata';

  audio.addEventListener('loadedmetadata', () => setDuration(idx, audio.duration));
  audio.addEventListener('timeupdate', () => setProgress(idx, audio.currentTime, audio.duration));
  audio.addEventListener('ended', () => {
    clearActive();
    waveTarget = 'sine';
    waveMode   = 'sine';
    window._audioTimeData = null;
    if (idx + 1 < TRACKS.length) playTrack(idx + 1);
  });

  /* Connect to analyser */
  if (source) source.disconnect();
  source = audioCtx.createMediaElementSource(audio);
  source.connect(analyser);

  audio.play().then(() => {
    currentAudio = audio;
    currentIdx = idx;
    document.getElementById('track-' + idx).classList.add('playing');
    vizWrap.classList.add('active');
    nowPlaying.classList.add('visible');
    const ppBtn = document.getElementById('osc-playpause');
    ppBtn.style.display = 'flex';
    document.getElementById('osc-play-icon').style.display  = 'none';
    document.getElementById('osc-pause-icon').style.display = 'block';
    npTitle.textContent = track.title;
    /* Also switch sidebar oscilloscope to chaotic/audio mode */
    waveTarget = 'audio';
  }).catch(e => console.warn('Playback error:', e));
}

/* Visualizer + sidebar osc animation loop */
const freqData = new Uint8Array(BAR_COUNT);
let timeData = null;

function drawViz() {
  requestAnimationFrame(drawViz);
  if (!analyser || !currentAudio || currentAudio.paused) return;

  /* Frequency data → visualizer bars */
  analyser.getByteFrequencyData(freqData);
  for (let i = 0; i < BAR_COUNT; i++) {
    const pct = freqData[i] / 255;
    const h = Math.max(3, pct * 48);
    const bar = document.getElementById('vb-' + i);
    if (bar) {
      bar.style.height = h + 'px';
      bar.style.opacity = 0.3 + pct * 0.7;
    }
  }
  window._audioFreqData = freqData;

  /* Time-domain data → oscilloscope waveform */
  if (!timeData) timeData = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(timeData);
  window._audioTimeData = timeData;

  /* Force oscilloscope to audio mode while playing */
  waveTarget = 'audio';
  waveMode   = 'audio';
}
drawViz();

/* ── CURSOR (hidden, replaced by probe) ── */
document.getElementById('cursor').style.display = 'none';

/* ── WIRE CANVAS ── */
const wireCanvas = document.getElementById('wire-canvas');
const wCtx = wireCanvas.getContext('2d');

function resizeWire() {
  wireCanvas.width  = window.innerWidth;
  wireCanvas.height = window.innerHeight;
}
resizeWire();
window.addEventListener('resize', resizeWire);

const anchor = { x: CFG.anchorX, y: CFG.anchorY };
let probe = { x: CFG.anchorX + 60, y: CFG.anchorY + 40 };
let mouse = { x: CFG.anchorX + 60, y: CFG.anchorY + 40 };

document.addEventListener('mousemove', e => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

let chain = [];
function initChain() {
  chain = [];
  for (let i = 0; i <= CFG.segments; i++) {
    const t = i / CFG.segments;
    chain.push({
      x:  anchor.x + (probe.x - anchor.x) * t,
      y:  anchor.y + (probe.y - anchor.y) * t,
      px: anchor.x + (probe.x - anchor.x) * t,
      py: anchor.y + (probe.y - anchor.y) * t,
    });
  }
}
initChain();

function updateChain() {
  probe.x += (mouse.x - probe.x) * CFG.probeSnap;
  probe.y += (mouse.y - probe.y) * CFG.probeSnap;

  for (let i = 1; i < chain.length; i++) {
    const p = chain[i];
    const vx = (p.x - p.px) * CFG.damping;
    const vy = (p.y - p.py) * CFG.damping;
    p.px = p.x; p.py = p.y;
    p.x += vx;
    p.y += vy + CFG.gravity;
  }

  const restLen = CFG.segLen * CFG.slack;
  for (let iter = 0; iter < CFG.stiffness; iter++) {
    chain[0].x = anchor.x; chain[0].y = anchor.y;
    chain[chain.length-1].x = probe.x; chain[chain.length-1].y = probe.y;
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i], b = chain[i+1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx*dx + dy*dy) || 0.001;
      const diff = (dist - restLen) / dist * 0.5;
      if (i > 0)              { a.x += dx*diff; a.y += dy*diff; }
      if (i < chain.length-2) { b.x -= dx*diff; b.y -= dy*diff; }
    }
    chain[0].x = anchor.x; chain[0].y = anchor.y;
    chain[chain.length-1].x = probe.x; chain[chain.length-1].y = probe.y;
  }
}

function drawProbe(x, y) {
  const prev = chain[chain.length - 2];
  const angle = Math.atan2(y - prev.y, x - prev.x);
  wCtx.save();
  wCtx.translate(x, y);
  wCtx.rotate(angle);

  wCtx.fillStyle = '#EDE5D4';
  wCtx.strokeStyle = '#A8893A';
  wCtx.lineWidth = 1.2;
  wCtx.beginPath();
  wCtx.roundRect(-22, -5, 20, 10, 3);
  wCtx.fill(); wCtx.stroke();

  wCtx.strokeStyle = 'rgba(168,137,58,0.4)';
  wCtx.lineWidth = 0.8;
  for (let i = -18; i < -6; i += 3) {
    wCtx.beginPath();
    wCtx.moveTo(i, -4); wCtx.lineTo(i, 4); wCtx.stroke();
  }

  wCtx.fillStyle = '#A8893A';
  wCtx.beginPath();
  wCtx.moveTo(-2, -3); wCtx.lineTo(8, 0); wCtx.lineTo(-2, 3);
  wCtx.closePath(); wCtx.fill();

  wCtx.fillStyle = '#C8A84B';
  wCtx.beginPath();
  wCtx.arc(8, 0, 2, 0, Math.PI*2);
  wCtx.fill();
  wCtx.restore();
}

function drawAnchorJack(x, y) {
  wCtx.save();
  wCtx.fillStyle = '#D0C4A8';
  wCtx.strokeStyle = '#A8893A';
  wCtx.lineWidth = 1.2;
  wCtx.beginPath();
  wCtx.roundRect(x-10, y-8, 20, 16, 3);
  wCtx.fill(); wCtx.stroke();
  wCtx.fillStyle = '#A8893A';
  wCtx.beginPath(); wCtx.arc(x, y, 4, 0, Math.PI*2); wCtx.fill();
  wCtx.fillStyle = '#EDE5D4';
  wCtx.beginPath(); wCtx.arc(x, y, 2, 0, Math.PI*2); wCtx.fill();
  wCtx.restore();
}

function drawWire() {
  wCtx.clearRect(0, 0, wireCanvas.width, wireCanvas.height);
  if (chain.length < 2) return;

  // Shadow
  wCtx.save();
  wCtx.strokeStyle = 'rgba(90,70,30,0.08)';
  wCtx.lineWidth = 4; wCtx.lineCap = 'round'; wCtx.lineJoin = 'round';
  wCtx.beginPath(); wCtx.moveTo(chain[0].x, chain[0].y + 2);
  for (let i = 1; i < chain.length; i++) wCtx.lineTo(chain[i].x, chain[i].y + 2);
  wCtx.stroke(); wCtx.restore();

  // Wire body
  wCtx.save();
  wCtx.strokeStyle = '#8A6E2A';
  wCtx.lineWidth = 2.2; wCtx.lineCap = 'round'; wCtx.lineJoin = 'round';
  wCtx.beginPath(); wCtx.moveTo(chain[0].x, chain[0].y);
  for (let i = 1; i < chain.length - 1; i++) {
    const mx = (chain[i].x + chain[i+1].x) / 2;
    const my = (chain[i].y + chain[i+1].y) / 2;
    wCtx.quadraticCurveTo(chain[i].x, chain[i].y, mx, my);
  }
  wCtx.lineTo(chain[chain.length-1].x, chain[chain.length-1].y);
  wCtx.stroke(); wCtx.restore();

  // Highlight
  wCtx.save();
  wCtx.strokeStyle = 'rgba(220,185,90,0.28)';
  wCtx.lineWidth = 0.8; wCtx.lineCap = 'round'; wCtx.lineJoin = 'round';
  wCtx.beginPath(); wCtx.moveTo(chain[0].x - 0.5, chain[0].y - 0.5);
  for (let i = 1; i < chain.length; i++) wCtx.lineTo(chain[i].x - 0.5, chain[i].y - 0.5);
  wCtx.stroke(); wCtx.restore();

  drawProbe(probe.x, probe.y);
  drawAnchorJack(anchor.x, anchor.y);
}

/* ── WAVEFORM ── */
let waveMode = 'sine', waveTarget = 'sine', waveLerp = 0;
let oscT = 0, jY = 0, jTarget = 0, jTimer = 0;

document.querySelectorAll('.cg, .card, .proj-card, .track, .clink, .shop-item').forEach(el => {
  el.addEventListener('mouseenter', () => {
    waveTarget = componentWaveMap[el.id] || sectionWaveMap[current] || 'sine';
  });
  el.addEventListener('mouseleave', () => {
    waveTarget = sectionWaveMap[current] || 'sine';
  });
});

function noiseF(x) {
  return Math.sin(x*1.7)*0.50 + Math.sin(x*3.13)*0.25
       + Math.sin(x*5.97)*0.13 + Math.sin(x*11.41)*0.07
       + Math.sin(x*23.7)*0.03;
}

function getWaveSample(mode, x, t, H) {
  const phase = t * 0.038;
  switch(mode) {
    case 'sine':
      return Math.sin(2*Math.PI*0.046*x + phase) + noiseF(x*0.038+t*0.008)*0.18;
    case 'damped': {
      const env = Math.exp(-((x % 140)/60));
      return Math.sin(2*Math.PI*0.06*x + phase)*env*1.2 + noiseF(x*0.05+t*0.006)*0.12;
    }
    case 'clip': {
      const raw = Math.sin(2*Math.PI*0.046*x + phase)*2.2;
      return Math.max(-1, Math.min(1, raw)) + noiseF(x*0.04+t*0.009)*0.1;
    }
    case 'chaotic':
      return noiseF(x*0.08+t*0.012)*0.9
           + Math.sin(2*Math.PI*0.12*x + phase*1.5)*0.5
           + Math.sin(2*Math.PI*0.033*x + phase*0.7)*0.4;

    case 'audio': {
      const td = window._audioTimeData;
      if (!td) return Math.sin(2*Math.PI*0.046*x + t*0.038) + noiseF(x*0.038+t*0.008)*0.18;
      const bin = Math.floor((x / 90) * td.length);
      const sample = ((td[bin] || 128) - 128) / 128;
      return sample * 1.4 + noiseF(x*0.04+t*0.006)*0.06;
    }
    case 'sawtooth': {
      const raw = ((x * 0.028 + t * 0.015) % 1) * 2 - 1;
      return raw * 0.85 + noiseF(x*0.03+t*0.007)*0.1;
    }
    case 'square': {
      const raw = Math.sign(Math.sin(2*Math.PI*0.046*x + phase));
      return raw * 0.7 + noiseF(x*0.03+t*0.007)*0.08;
    }
    case 'pulse': {
      const pos = ((x * 0.046 + phase * 0.0159) % 1 + 1) % 1;
      const raw = pos < 0.3 ? 1 : -0.25;
      return raw * 0.85 + noiseF(x*0.04+t*0.009)*0.1;
    }
  }
  return 0;
}

function drawOsc() {
  const cv = document.getElementById('osc');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);

  ctx.strokeStyle='#D0C4A8'; ctx.lineWidth=0.4;
  ctx.setLineDash([2,4]); ctx.globalAlpha=0.35;
  ctx.beginPath(); ctx.moveTo(0,H/2); ctx.lineTo(W,H/2); ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha=1;

  jTimer++;
  if (jTimer > 6+Math.random()*14) { jTarget=(Math.random()-0.5)*1.6; jTimer=0; }
  jY += (jTarget-jY)*0.18;

  if (waveMode !== waveTarget) waveLerp += 0.06;
  else waveLerp = 0;
  if (waveLerp >= 1) { waveMode = waveTarget; waveLerp = 0; }

  ctx.strokeStyle='#C8A84B'; ctx.lineWidth=1.5;
  ctx.beginPath();
  for (let x = 0; x < W; x++) {
    let s = getWaveSample(waveMode, x, oscT, H);
    if (waveLerp > 0) s = s*(1-waveLerp) + getWaveSample(waveTarget,x,oscT,H)*waveLerp;
    const y = H/2 + jY - H*0.30*s;
    x===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
  }
  ctx.stroke();

  ctx.strokeStyle='rgba(200,168,75,0.18)'; ctx.lineWidth=1;
  ctx.beginPath();
  for (let x = 0; x < W; x++) {
    const y = H/2+jY*0.5 - H*0.13*(Math.sin(2*Math.PI*0.091*x+oscT*0.025+1.1)+noiseF(x*0.07+oscT*0.005)*0.1);
    x===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
  }
  ctx.stroke();
  oscT++;
}

/* ── MAIN LOOP ── */
function loop() {
  updateChain();
  drawWire();
  drawOsc();
  requestAnimationFrame(loop);
}
loop();

/* ── NAV STATE ── */
const wireMap = {
  home:     [],
  about:    ['w0'],
  music:    ['w0','w1'],
  projects: ['w0','w1','w2','w-fb-up'],
  shop:     ['w0','w1','w2','w-fb-up','w3','w3b','w4'],
  contact:  ['w0','w1','w2','w-fb-up','w3','w3b','w4','w5'],
};

const componentWireMap = {
  'cg-home':     [],
  'cg-about':    ['w0'],
  'cg-music':    ['w0','w1'],
  'cg-projects': ['w0','w1','w2','w-fb-up'],
  'cg-shop':     ['w0','w1','w2','w-fb-up','w3','w3b','w4'],
  'cg-contact':  ['w0','w1','w2','w-fb-up','w3','w3b','w4','w5'],
};

const componentWaveMap = {
  'cg-home':     'sine',
  'cg-about':    'square',
  'cg-music':    'chaotic',
  'cg-projects': 'damped',
  'cg-shop':     'sawtooth',
  'cg-contact':  'pulse',
};

const sectionWaveMap = {
  home:     'sine',
  about:    'square',
  music:    'chaotic',
  projects: 'damped',
  shop:     'sawtooth',
  contact:  'pulse',
};

let current = 'home';

function nav(section, componentId) {
  if (section === current) return;
  const ov = document.getElementById('overlay');
  ov.classList.add('flash');
  setTimeout(() => ov.classList.remove('flash'), 260);
  document.getElementById('pg-'+current).classList.remove('active');
  setTimeout(() => {
    document.getElementById('pg-'+section).classList.add('active');
    window.scrollTo(0,0);
  }, 110);
  document.querySelectorAll('.cg').forEach(g => g.classList.remove('active'));
  if (componentId) {
    document.getElementById(componentId).classList.add('active');
  } else {
    document.getElementById('cg-'+section).classList.add('active');
  }
  document.querySelectorAll('.wire').forEach(w => w.classList.remove('lit'));
  document.querySelectorAll('.jct').forEach(j => j.classList.remove('lit'));
  // Use component wires for highlighting instead of section wires
  const wiresToLight = componentId ? (componentWireMap[componentId] || []) : (wireMap[section] || []);
  wiresToLight.forEach(id => {
    const el = document.getElementById(id); if(el) el.classList.add('lit');
  });
  animateDot(componentId || section);
  // Set the oscilloscope waveform for this section
  waveTarget = sectionWaveMap[section] || 'sine';
  current = section;
  if (window.innerWidth <= 780) document.getElementById('sidebar').classList.remove('open');
}

function animateDot(sectionOrComponentId) {
  // If it's a component ID (starts with 'cg-'), use componentWireMap
  const isComponentId = sectionOrComponentId.startsWith('cg-');
  const wires = isComponentId ? componentWireMap[sectionOrComponentId] : wireMap[sectionOrComponentId];
  if (!wires||!wires.length) return;
  const lastWire = document.getElementById(wires[wires.length-1]);
  if (!lastWire||!lastWire.getTotalLength) return;
  const dot = document.getElementById('fdot');
  const len = lastWire.getTotalLength();
  let t = 0; dot.style.opacity = '1';
  const anim = setInterval(() => {
    t += 2.2;
    if (t > len) { dot.style.opacity='0'; clearInterval(anim); return; }
    const pt = lastWire.getPointAtLength(t);
    dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.y);
  }, 13);
}

document.getElementById('cg-home').classList.add('active');
// Set initial waveform for home section
waveTarget = sectionWaveMap['home'] || 'sine';

/* ── PROJECT EXPAND (in-page) ── */
const projPage = document.getElementById('pg-projects');
const projSlot = document.getElementById('proj-selected-slot');
const projDetailWrap = document.getElementById('proj-detail-wrap');
const projDetail = document.getElementById('proj-detail');
const schemSvg = document.getElementById('proj-schematic');

function getPowerSwitch() {
  return projDetail.querySelector('.power-switch');
}

document.querySelectorAll('.proj-card').forEach(card => {
  card.addEventListener('click', () => openProject(card));
});

/* Delegate clicks on the toggle switch (lives inside the detail content) */
projDetail.addEventListener('click', (e) => {
  if (e.target.closest('.power-switch')) {
    if (projPage.classList.contains('project-expanded')) closeProject();
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && projPage.classList.contains('project-expanded')) closeProject();
});

/* Close when navigating to a different section */
document.querySelectorAll('.cg').forEach(cg => {
  cg.addEventListener('click', () => {
    if (projPage.classList.contains('project-expanded')) closeProject();
  });
});

/* Build the SVG markup for the industrial toggle switch shown in assets/user_switch.png.
   Gear ring is generated once (16 teeth alternating between inner/outer radius). */
const SWITCH_GEAR_PATH = (() => {
  const teeth = 16, cx = 50, cy = 55, rOut = 11, rIn = 9;
  const pts = [];
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? rOut : rIn;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M ${pts[0]} L ${pts.slice(1).join(' L ')} Z`;
})();

function buildPowerSwitch() {
  const btn = document.createElement('button');
  btn.className = 'power-switch';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Cut power · return to projects');
  btn.setAttribute('aria-pressed', 'false');
  btn.innerHTML = `
    <svg class="ps-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <!-- Left mounting lugs -->
      <rect class="ps-lug" x="6"  y="42" width="12" height="8" rx="1"/>
      <circle class="ps-lug-hole" cx="12" cy="46" r="1.4"/>
      <rect class="ps-lug" x="6"  y="60" width="12" height="8" rx="1"/>
      <circle class="ps-lug-hole" cx="12" cy="64" r="1.4"/>

      <!-- Right mounting lugs -->
      <rect class="ps-lug" x="82" y="42" width="12" height="8" rx="1"/>
      <circle class="ps-lug-hole" cx="88" cy="46" r="1.4"/>
      <rect class="ps-lug" x="82" y="60" width="12" height="8" rx="1"/>
      <circle class="ps-lug-hole" cx="88" cy="64" r="1.4"/>

      <!-- Main body rectangle (fills when on) -->
      <rect class="ps-body" x="18" y="40" width="64" height="30" rx="1.2"/>

      <!-- Central hub: serrated outer gear, middle ring, center dot -->
      <path class="ps-gear" d="${SWITCH_GEAR_PATH}"/>
      <circle class="ps-hub-ring"   cx="50" cy="55" r="7.5"/>
      <circle class="ps-hub-center" cx="50" cy="55" r="2.2"/>

      <!-- Pointer flag below hub -->
      <path class="ps-pointer" d="M46.8,65 L53.2,65 L52,71 L48,71 Z"/>

      <!-- Lever group — JS rotates this around (50,55) for on/off -->
      <g class="ps-lever-group" transform="rotate(180 50 55)">
        <rect class="ps-lever" x="46.5" y="14" width="7" height="42" rx="3.5"/>
      </g>
    </svg>
  `;
  return btn;
}

function openProject(card) {
  /* Clone card face (minus the template) into the slot — same size, same styling */
  const faceHTML = [...card.children]
    .filter(el => el.tagName !== 'TEMPLATE')
    .map(el => el.outerHTML)
    .join('');
  projSlot.innerHTML = '<article class="proj-card slot-card" aria-hidden="false">' + faceHTML + '</article>';
  projSlot.setAttribute('aria-hidden', 'false');

  /* Load full detail from the template */
  const tpl = card.querySelector('template.proj-detail-source');
  projDetail.innerHTML = tpl ? tpl.innerHTML : '';
  projDetailWrap.setAttribute('aria-hidden', 'false');

  /* Inject the power switch to the RIGHT of the detail's h2 title */
  const h2 = projDetail.querySelector('h2');
  if (h2) {
    const row = document.createElement('div');
    row.className = 'proj-title-row';
    h2.parentNode.insertBefore(row, h2);
    row.appendChild(h2);
    row.appendChild(buildPowerSwitch());
  }

  projPage.classList.add('project-expanded');

  window.scrollTo({ top: 0, behavior: 'smooth' });

  /* Redraw once any image in the detail finishes loading (page height may grow) */
  projDetail.querySelectorAll('img').forEach(img => {
    if (!img.complete) {
      img.addEventListener('load',  redrawIfOpen, { once: true });
      img.addEventListener('error', redrawIfOpen, { once: true });
    }
  });

  /* Draw schematic once layout has settled; initial render shows lever open,
     then we close the switch (power on) for the drop-in animation. */
  requestAnimationFrame(() => requestAnimationFrame(() => {
    drawSchematic({ state: 'off' });
    setTimeout(() => flipSwitch(true), 300);
  }));
}

function closeProject() {
  /* Animate switch → off first; let the schematic lever lift, then tear down. */
  flipSwitch(false);
  setTimeout(() => {
    projPage.classList.remove('project-expanded', 'power-on');
    projSlot.setAttribute('aria-hidden', 'true');
    projDetailWrap.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      if (!projPage.classList.contains('project-expanded')) {
        projSlot.innerHTML = '';
        projDetail.innerHTML = '';
        schemSvg.innerHTML = '';
      }
    }, 450);
  }, 440);
}

/* Flip both the physical toggle and the schematic switch together. */
function flipSwitch(on) {
  const sw = getPowerSwitch();
  if (on) {
    if (sw) { sw.classList.add('on'); sw.setAttribute('aria-pressed', 'true'); }
    projPage.classList.add('power-on');
  } else {
    if (sw) { sw.classList.remove('on'); sw.setAttribute('aria-pressed', 'false'); }
    projPage.classList.remove('power-on');
  }
  animatePhysicalLever(on ? 0 : 180);
  animateSchematicLever(on ? 0 : 58);
}

/* Rotate the physical switch's lever group around the hub center (50, 55) */
let physLeverRaf = null;
function animatePhysicalLever(targetDeg) {
  const sw = getPowerSwitch();
  if (!sw) return;
  const leverG = sw.querySelector('.ps-lever-group');
  if (!leverG) return;
  if (physLeverRaf) cancelAnimationFrame(physLeverRaf);
  const m = /rotate\(\s*(-?[\d.]+)/.exec(leverG.getAttribute('transform') || '');
  const startDeg = m ? parseFloat(m[1]) : 0;
  const delta = targetDeg - startDeg;
  const dur = 450;
  const t0 = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - t0) / dur);
    /* ease-out-back */
    const c1 = 1.70158, c3 = c1 + 1;
    const eased = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    const deg = startDeg + delta * (t < 1 ? eased : 1);
    leverG.setAttribute('transform', `rotate(${deg} 50 55)`);
    if (t < 1) physLeverRaf = requestAnimationFrame(tick);
    else {
      leverG.setAttribute('transform', `rotate(${targetDeg} 50 55)`);
      physLeverRaf = null;
    }
  }
  physLeverRaf = requestAnimationFrame(tick);
}

/* ── Schematic SVG: wires from the slotted card down past page content to the
   two accent borders of the selected project's meta-grid. A schematic switch
   is placed in-line with the left wire, aligned with (and controlled by) the
   physical toggle next to the detail h2. ── */
let leverRaf = null;
let leverCoords = null; // { hingeX, hingeY, length }

function drawSchematic({ state = 'off' } = {}) {
  if (!projPage.classList.contains('project-expanded')) return;
  const slotCard = projSlot.querySelector('.proj-card');
  if (!slotCard) return;
  const sw = getPowerSwitch();
  if (!sw) return;
  const metaGrid = projDetail.querySelector('.proj-meta-grid');
  if (!metaGrid) { schemSvg.innerHTML = ''; return; }

  const pageRect  = projPage.getBoundingClientRect();
  const cardRect  = slotCard.getBoundingClientRect();
  const psRect    = sw.getBoundingClientRect();
  const metaRect  = metaGrid.getBoundingClientRect();

  const W = pageRect.width;
  const H = pageRect.height;

  /* Card terminals: two points on the card's bottom edge.
     Left terminal is indented to leave room for the in-line schematic switch.
     Right terminal hugs close to the card's right edge. */
  const termInsetA = Math.min(80, cardRect.width * 0.22); // left wire — through switch
  const termInsetB = 28;                                   // right wire — direct, near edge
  const termAX = cardRect.left  - pageRect.left + termInsetA;
  const termBX = cardRect.right - pageRect.left - termInsetB;
  const termY  = cardRect.bottom - pageRect.top + 4;

  /* The two accent lines (meta-grid's top/bottom borders), in page coords */
  const accentTopY    = metaRect.top    - pageRect.top;
  const accentBottomY = metaRect.bottom - pageRect.top;

  /* Physical switch — left edge as the "tap" point (switch sits to the right of
     the h2, schematic switch is on the left, so the wire exits leftward). */
  const physLeftX = psRect.left - pageRect.left;
  const physMidY  = (psRect.top + psRect.bottom) / 2 - pageRect.top;

  /* Schematic switch sits in the left wire, aligned vertically near the physical
     switch so the control wire is short. Place it just above the top accent line. */
  const swColumnX = termAX;
  const swY1 = Math.max(termY + 60, accentTopY - 64);  // hinge
  const swL  = 28;
  const swY2 = swY1 + swL;                              // fixed contact
  leverCoords = { hingeX: swColumnX, hingeY: swY1, length: swL };

  /* Control wire: from the physical switch's left edge, jog left to the switch
     column, then vertically to the hinge. A short dashed connector. */
  const controlPath =
    `M ${physLeftX} ${physMidY} ` +
    `H ${swColumnX - 18} ` +
    `V ${swY1 + swL/2} ` +
    `H ${swColumnX - 6}`;

  schemSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  schemSvg.setAttribute('preserveAspectRatio', 'none');
  schemSvg.style.width  = W + 'px';
  schemSvg.style.height = H + 'px';

  schemSvg.innerHTML = `
    <!-- Left power wire: card terminal → schematic switch hinge -->
    <line class="c-wire" x1="${termAX}" y1="${termY}" x2="${swColumnX}" y2="${swY1}" />
    <!-- Left power wire: switch contact → top accent line -->
    <line class="c-wire" x1="${swColumnX}" y1="${swY2}" x2="${termAX}" y2="${accentTopY}" />
    <!-- Right power wire: card terminal → bottom accent line (continuous, passes over meta grid) -->
    <line class="c-wire" x1="${termBX}" y1="${termY}" x2="${termBX}" y2="${accentBottomY}" />

    <!-- Tap nodes on the accent lines -->
    <circle class="c-node c-tap" cx="${termAX}" cy="${accentTopY}" r="3" />
    <circle class="c-node c-tap" cx="${termBX}" cy="${accentBottomY}" r="3" />

    <!-- Control wire from physical switch to schematic hinge -->
    <path class="c-wire c-wire-control" d="${controlPath}" />

    <!-- Schematic switch: hinge + fixed contact, lever rotates around hinge -->
    <circle class="c-node" cx="${swColumnX}" cy="${swY1}" r="3.2" />
    <circle class="c-node" cx="${swColumnX}" cy="${swY2}" r="3.2" />
    <g id="sch-lever-g" transform="rotate(0 ${swColumnX} ${swY1})">
      <line class="c-lever" x1="${swColumnX}" y1="${swY1}" x2="${swColumnX}" y2="${swY2}" />
      <circle class="c-lever-tip" cx="${swColumnX}" cy="${swY2}" r="2.4" />
    </g>

    <text class="c-label" x="${swColumnX + 10}" y="${swY1 + swL/2 + 3}">SW₁</text>
  `;

  /* Apply initial lever angle without animation */
  const leverG = document.getElementById('sch-lever-g');
  if (leverG) {
    const deg = state === 'on' ? 0 : 58;
    leverG.setAttribute('transform', `rotate(${deg} ${swColumnX} ${swY1})`);
    leverG.dataset.deg = String(deg);
  }
}

function animateSchematicLever(targetDeg) {
  const leverG = document.getElementById('sch-lever-g');
  if (!leverG || !leverCoords) return;
  if (leverRaf) cancelAnimationFrame(leverRaf);
  const { hingeX, hingeY } = leverCoords;
  const startDeg = parseFloat(leverG.dataset.deg || '0');
  const delta = targetDeg - startDeg;
  const dur = 450;
  const t0 = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - t0) / dur);
    /* ease-out-back for a slight overshoot on close, smooth on open */
    const c = 1.4;
    const eased = 1 + c * Math.pow(t - 1, 3) + (c - 0.5) * Math.pow(t - 1, 2);
    const deg = startDeg + delta * (t < 1 ? eased : 1);
    leverG.setAttribute('transform', `rotate(${deg} ${hingeX} ${hingeY})`);
    if (t < 1) leverRaf = requestAnimationFrame(tick);
    else {
      leverG.setAttribute('transform', `rotate(${targetDeg} ${hingeX} ${hingeY})`);
      leverG.dataset.deg = String(targetDeg);
      leverRaf = null;
    }
  }
  leverRaf = requestAnimationFrame(tick);
}

/* Redraw schematic on layout changes */
function redrawIfOpen() {
  if (!projPage.classList.contains('project-expanded')) return;
  const sw = getPowerSwitch();
  const isOn = sw && sw.classList.contains('on');
  drawSchematic({ state: isOn ? 'on' : 'off' });
}

window.addEventListener('resize', redrawIfOpen);
projSlot.addEventListener('transitionend', (e) => {
  if (e.propertyName === 'width') redrawIfOpen();
});
