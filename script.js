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

/* Anti-click fade: 40ms ramp on every play/pause to avoid the discontinuity click */
const ANTI_CLICK_FADE = 0.04; // seconds

function fadeAudioIn() {
  if (!gainNode || !audioCtx) return;
  const t = audioCtx.currentTime;
  gainNode.gain.cancelScheduledValues(t);
  gainNode.gain.setValueAtTime(0, t);
  gainNode.gain.linearRampToValueAtTime(1, t + ANTI_CLICK_FADE);
}

function fadeAudioOutThenPause(audio) {
  if (!gainNode || !audioCtx || !audio) {
    if (audio) audio.pause();
    return;
  }
  const t = audioCtx.currentTime;
  const cur = gainNode.gain.value;
  gainNode.gain.cancelScheduledValues(t);
  gainNode.gain.setValueAtTime(cur, t);
  gainNode.gain.linearRampToValueAtTime(0, t + ANTI_CLICK_FADE);
  setTimeout(() => audio.pause(), ANTI_CLICK_FADE * 1000 + 10);
}

function oscTogglePlay() {
  if (!currentAudio) return;
  if (currentAudio.paused) {
    fadeAudioIn();
    currentAudio.play();
    vizWrap.classList.add('active');
    document.getElementById('track-' + currentIdx).classList.add('playing');
    waveTarget = 'audio'; waveMode = 'audio';
    document.getElementById('osc-play-icon').style.display  = 'none';
    document.getElementById('osc-pause-icon').style.display = 'block';
  } else {
    fadeAudioOutThenPause(currentAudio);
    vizWrap.classList.remove('active');
    document.getElementById('track-' + currentIdx).classList.remove('playing');
    waveTarget = (typeof sectionWaveMap !== 'undefined' ? sectionWaveMap[current] : null) || 'sine';
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

let audioCtx = null, analyser = null, source = null, gainNode = null;
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
      fadeAudioIn();
      currentAudio.play();
      vizWrap.classList.add('active');
      document.getElementById('track-' + idx).classList.add('playing');
    } else {
      fadeAudioOutThenPause(currentAudio);
      vizWrap.classList.remove('active');
      document.getElementById('track-' + idx).classList.remove('playing');
      waveTarget = (typeof sectionWaveMap !== 'undefined' ? sectionWaveMap[current] : null) || 'sine';
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

  /* Set up Web Audio API on first play (requires user gesture).
     Graph: source → analyser → gainNode → destination. The gainNode lets us
     ramp volume over a few ms on play/pause to suppress the discontinuity click. */
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;
    gainNode = audioCtx.createGain();
    gainNode.gain.value = 1;
    analyser.connect(gainNode);
    gainNode.connect(audioCtx.destination);
  }

  const audio = new Audio();
  audio.crossOrigin = 'anonymous';
  audio.src = track.file;
  audio.preload = 'metadata';

  audio.addEventListener('loadedmetadata', () => setDuration(idx, audio.duration));
  audio.addEventListener('timeupdate', () => setProgress(idx, audio.currentTime, audio.duration));
  audio.addEventListener('ended', () => {
    clearActive();
    waveTarget = (typeof sectionWaveMap !== 'undefined' ? sectionWaveMap[current] : null) || 'sine';
    window._audioTimeData = null;
    if (idx + 1 < TRACKS.length) playTrack(idx + 1);
  });

  /* Connect to analyser */
  if (source) source.disconnect();
  source = audioCtx.createMediaElementSource(audio);
  source.connect(analyser);

  fadeAudioIn();
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
    case 'adder': {
      /* Mirror the SUM trace from the home-page waveform adder */
      const wf = window.wf;
      if (!wf) return Math.sin(2*Math.PI*0.046*x + phase) + noiseF(x*0.038+t*0.008)*0.18;
      const W = 90; // sidebar osc canvas width
      return wf.sumSample(x, W);
    }
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

/* Per-component waves only fire while the probe is on a nav component (hover). */
const componentWaveMap = {
  'cg-home':     'sine',
  'cg-about':    'square',
  'cg-music':    'chaotic',
  'cg-projects': 'damped',
  'cg-shop':     'sawtooth',
  'cg-contact':  'pulse',
};

/* Default waveform for every section is the adder's SUM trace. */
const sectionWaveMap = {
  home:     'adder',
  about:    'adder',
  music:    'adder',
  projects: 'adder',
  shop:     'adder',
  contact:  'adder',
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
  /* Don't touch waveTarget here — the probe is still over the component the
     user just clicked, so its mouseenter-set waveform should stay visible
     until the probe actually moves off. The mouseleave handler will then
     restore sectionWaveMap[current] (= 'adder'). */
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

/* ══════════════════════════════════════
   WAVEFORM ADDER (home-page interactive scope)
   Renders into #scopeWrap. Exposes window.wf so the sidebar oscilloscope can
   read the same channel state and draw the SUM trace as its default waveform.
   ══════════════════════════════════════ */
(() => {
  const wrap = document.getElementById('scopeWrap');
  if (!wrap) return;

  /* Tokens */
  const GOLD       = '#C8A84B';
  const GOLD_BRIGHT= '#E5C76B';
  const GOLD_DIM   = '#A8893A';
  const GOLD_GLOW  = 'rgba(200,168,75,0.28)';
  const CREAM_2    = '#EDE5D4';
  const CREAM_3    = '#E3D8C3';
  const CREAM_4    = '#D0C4A8';
  const INK        = '#221A0C';
  const INK_3      = '#7A6A4A';
  const INK_4      = '#A89878';
  const CH2_COLOR  = '#7A9E8A';
  const CH2_GLOW   = 'rgba(122,158,138,0.25)';

  const WAVE_TYPES = ['sine','square','saw','triangle','damped','noise'];

  /* Channel state — exposed on window.wf */
  const ch = [
    { freq: 1.2, amp: 0.65, wave: 'sine'   },
    { freq: 2.0, amp: 0.40, wave: 'square' },
  ];
  let t = 0;

  /* Per-mode sample function. Reuses the existing global noiseF from script.js. */
  function sampleWave(wave, x, freq, px) {
    const phase = x * freq * Math.PI * 2;
    switch (wave) {
      case 'sine':     return Math.sin(phase) + noiseF(x*0.038)*0.08;
      case 'square':   return Math.sign(Math.sin(phase)) + noiseF(x*0.03)*0.06;
      case 'saw':      return 2*((x*freq)%1) - 1 + noiseF(x*0.03)*0.06;
      case 'triangle': { const p=(x*freq)%1; return (p<0.5?4*p-1:3-4*p) + noiseF(x*0.03)*0.06; }
      case 'damped': {
        const env = Math.exp(-((px % 140) / 60));
        return Math.sin(2*Math.PI*0.06*px*freq + t*2.4)*env*1.2 + noiseF(px*0.05+t*0.6)*0.12;
      }
      case 'noise': return ((Math.sin(px*127.1+x*311)*43758.5453) % 1) * 2 - 1;
    }
    return 0;
  }

  /* Layout constants (match waveform_adder.htm) */
  const SCOPE_W = 960, BODY_H = 530, SVG_H = 560;
  const TITLE_H = 52, SEP_Y = TITLE_H;
  const SCREEN_X = 62, SCREEN_Y = SEP_Y + 10, SCREEN_W = SCOPE_W - 124, SCREEN_H = 248;
  const CTRL_TOP = SCREEN_Y + SCREEN_H + 14;
  const MINI_W = 112, MINI_H = 62;
  const CH1_CX = 240, CH2_CX = SCOPE_W - 240;
  const MINI1_X = CH1_CX - MINI_W/2, MINI2_X = CH2_CX - MINI_W/2;
  const MINI_Y = CTRL_TOP + 4;
  const KNOB_R = 22;
  const KNOB_ROW = MINI_Y + MINI_H + 42;
  const BTN_ROW = KNOB_ROW + KNOB_R + 36;
  const FOOT_Y = BODY_H, FOOT_RX = 22, FOOT_RY = 12;

  /* SVG builders */
  function knobSVG(id, cx, cy, val, min, max, topLbl, botLbl) {
    const norm = (val-min)/(max-min);
    const angle = -135 + norm*270;
    const rad = (angle-90)*Math.PI/180;
    const nx = cx + Math.cos(rad)*(KNOB_R-5);
    const ny = cy + Math.sin(rad)*(KNOB_R-5);
    const r = KNOB_R+5;
    const sA = (-135-90)*Math.PI/180;
    const sx = cx+Math.cos(sA)*r, sy = cy+Math.sin(sA)*r;
    const ex = cx+Math.cos(rad)*r, ey = cy+Math.sin(rad)*r;
    const large = (angle+135)>180?1:0;
    return `<g class="knob-group" id="${id}">
      <path d="M ${cx+Math.cos(sA)*r} ${cy+Math.sin(sA)*r} A ${r} ${r} 0 1 1 ${cx+Math.cos((135-90)*Math.PI/180)*r} ${cy+Math.sin((135-90)*Math.PI/180)*r}"
        fill="none" stroke="${CREAM_4}" stroke-width="1.1" stroke-linecap="round" opacity="0.38"/>
      <path d="M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}"
        fill="none" stroke="${GOLD_DIM}" stroke-width="1.3" stroke-linecap="round" class="knob-arc"/>
      <circle cx="${cx}" cy="${cy}" r="${KNOB_R}" fill="${CREAM_2}" stroke="${CREAM_4}" stroke-width="1"/>
      <circle cx="${cx}" cy="${cy}" r="${KNOB_R-7}" fill="none" stroke="${CREAM_4}" stroke-width="0.5" opacity="0.4"/>
      <circle cx="${nx}" cy="${ny}" r="1.8" fill="${GOLD_DIM}" class="knob-notch"/>
      <text x="${cx}" y="${cy-KNOB_R-7}" text-anchor="middle" font-family="'JetBrains Mono',monospace" font-size="6" fill="${GOLD}" letter-spacing="0.16em" opacity="0.7">${topLbl}</text>
      <text x="${cx}" y="${cy+KNOB_R+14}" text-anchor="middle" font-family="'JetBrains Mono',monospace" font-size="6" fill="${INK_4}" letter-spacing="0.16em">${botLbl}</text>
    </g>`;
  }

  function waveBtnsSVG(chIdx, cx, y) {
    const sp = 34, count = WAVE_TYPES.length;
    const startX = cx - (count*sp)/2 + sp/2;
    return WAVE_TYPES.map((w,i)=>{
      const bx = startX + i*sp;
      const active = ch[chIdx].wave===w;
      const col = chIdx===0 ? GOLD : CH2_COLOR;
      return `<g class="wave-btn" data-ch="${chIdx}" data-wave="${w}">
        <rect x="${bx-14}" y="${y-9}" width="28" height="18" rx="2"
          fill="${active?CREAM_3:CREAM_2}" stroke="${active?GOLD_DIM:CREAM_4}" stroke-width="${active?1.1:0.7}"/>
        <text x="${bx}" y="${y+4}" text-anchor="middle" font-family="'JetBrains Mono',monospace"
          font-size="5.8" fill="${active?col:INK_4}" letter-spacing="0.05em">${w}</text>
      </g>`;
    }).join('');
  }

  function miniScreenSVG(x, y, w, h, chIdx) {
    const col = chIdx===0 ? GOLD_DIM : CH2_COLOR;
    const lbl = chIdx===0 ? 'CH1' : 'CH2';
    return `
      <rect x="${x-2}" y="${y-2}" width="${w+4}" height="${h+4}" rx="3" fill="none" stroke="${CREAM_4}" stroke-width="0.8"/>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${INK}" fill-opacity="0.04" stroke="${col}" stroke-width="0.9"/>
      <text x="${x+5}" y="${y+10}" font-family="'JetBrains Mono',monospace" font-size="5.5" fill="${col}" letter-spacing="0.18em" opacity="0.7">${lbl}</text>
    `;
  }

  function buildSVG() {
    const body = `<rect x="1" y="1" width="${SCOPE_W-2}" height="${BODY_H-2}" rx="7" fill="${CREAM_2}" stroke="${CREAM_4}" stroke-width="1.4"/>`;
    const feet = `
      <ellipse cx="80" cy="${FOOT_Y}" rx="${FOOT_RX}" ry="${FOOT_RY}" fill="${CREAM_3}" stroke="${CREAM_4}" stroke-width="1"/>
      <ellipse cx="${SCOPE_W-80}" cy="${FOOT_Y}" rx="${FOOT_RX}" ry="${FOOT_RY}" fill="${CREAM_3}" stroke="${CREAM_4}" stroke-width="1"/>`;
    const titleDecor = `
      <circle cx="${SCOPE_W-30}" cy="${TITLE_H/2}" r="3.5" fill="${CREAM_3}" stroke="${CREAM_4}" stroke-width="0.8"/>
      <circle cx="${SCOPE_W-48}" cy="${TITLE_H/2}" r="3.5" fill="${CREAM_3}" stroke="${CREAM_4}" stroke-width="0.8"/>
      <circle cx="${SCOPE_W-66}" cy="${TITLE_H/2}" r="3.5" fill="${GOLD}" fill-opacity="0.5" stroke="${GOLD_DIM}" stroke-width="0.8"/>
      <circle cx="28" cy="${TITLE_H/2}" r="7" fill="none" stroke="${CREAM_4}" stroke-width="0.9"/>
      <line x1="28" y1="${TITLE_H/2-10}" x2="28" y2="${TITLE_H/2-4}" stroke="${CREAM_4}" stroke-width="0.9"/>`;
    const title = `
      <text x="${SCOPE_W/2}" y="${TITLE_H/2+2}" text-anchor="middle" font-family="'JetBrains Mono',monospace" font-size="11" font-weight="500" fill="${INK_3}" letter-spacing="0.38em">WAVEFORM ADDER</text>
      <text x="${SCOPE_W/2}" y="${TITLE_H/2+15}" text-anchor="middle" font-family="'JetBrains Mono',monospace" font-size="7" font-weight="300" fill="${INK_4}" letter-spacing="0.28em" opacity="0.65">REV 3.113</text>`;
    const sep = `<line x1="20" y1="${SEP_Y}" x2="${SCOPE_W-20}" y2="${SEP_Y}" stroke="${CREAM_4}" stroke-width="0.8" opacity="0.7"/>`;

    const bx = SCREEN_X-10, by = SCREEN_Y-10;
    const bezel = `<rect x="${bx}" y="${by}" width="${SCREEN_W+20}" height="${SCREEN_H+20}" rx="4" fill="none" stroke="${CREAM_4}" stroke-width="0.8"/>`;
    const screen = `<rect x="${SCREEN_X}" y="${SCREEN_Y}" width="${SCREEN_W}" height="${SCREEN_H}" rx="2" fill="${INK}" fill-opacity="0.03" stroke="${GOLD_DIM}" stroke-width="1.2"/>`;

    const gC=10, gR=8;
    let grid='', ticks='';
    for (let i=1;i<gC;i++){
      const x=SCREEN_X+(SCREEN_W/gC)*i, mid=i===gC/2;
      grid+=`<line x1="${x}" y1="${SCREEN_Y}" x2="${x}" y2="${SCREEN_Y+SCREEN_H}" stroke="${GOLD_DIM}" stroke-width="0.5" stroke-dasharray="${mid?'4,3':'2,5'}" opacity="${mid?.20:.08}"/>`;
    }
    for (let j=1;j<gR;j++){
      const y=SCREEN_Y+(SCREEN_H/gR)*j, mid=j===gR/2;
      grid+=`<line x1="${SCREEN_X}" y1="${y}" x2="${SCREEN_X+SCREEN_W}" y2="${y}" stroke="${GOLD_DIM}" stroke-width="0.5" stroke-dasharray="${mid?'4,3':'2,5'}" opacity="${mid?.20:.08}"/>`;
    }
    const cx0=SCREEN_X+SCREEN_W/2, cy0=SCREEN_Y+SCREEN_H/2;
    for (let k=0;k<=40;k++){
      const tx=SCREEN_X+(SCREEN_W/40)*k;
      ticks+=`<line x1="${tx}" y1="${cy0-2}" x2="${tx}" y2="${cy0+2}" stroke="${GOLD_DIM}" stroke-width="0.5" opacity="0.22"/>`;
    }
    for (let k=0;k<=32;k++){
      const ty=SCREEN_Y+(SCREEN_H/32)*k;
      ticks+=`<line x1="${cx0-2}" y1="${ty}" x2="${cx0+2}" y2="${ty}" stroke="${GOLD_DIM}" stroke-width="0.5" opacity="0.22"/>`;
    }

    const screenLabels = `
      <text x="${SCREEN_X+10}" y="${SCREEN_Y+14}" font-family="'JetBrains Mono',monospace" font-size="7" fill="${GOLD_BRIGHT}" letter-spacing="0.2em" opacity="0.75">CH3</text>
      <text x="${SCREEN_X+SCREEN_W-10}" y="${SCREEN_Y+14}" text-anchor="end" font-family="'JetBrains Mono',monospace" font-size="7" fill="${GOLD}" letter-spacing="0.18em" opacity="0.45">SUM</text>
      <text x="${SCREEN_X-5}" y="${SCREEN_Y+7}" text-anchor="end" font-family="'JetBrains Mono',monospace" font-size="5.5" fill="${INK_4}" opacity="0.35">+V</text>
      <text x="${SCREEN_X-5}" y="${SCREEN_Y+SCREEN_H/2+3}" text-anchor="end" font-family="'JetBrains Mono',monospace" font-size="5.5" fill="${INK_4}" opacity="0.35">0</text>
      <text x="${SCREEN_X-5}" y="${SCREEN_Y+SCREEN_H-2}" text-anchor="end" font-family="'JetBrains Mono',monospace" font-size="5.5" fill="${INK_4}" opacity="0.35">−V</text>`;

    const mini0 = miniScreenSVG(MINI1_X, MINI_Y, MINI_W, MINI_H, 0);
    const mini1 = miniScreenSVG(MINI2_X, MINI_Y, MINI_W, MINI_H, 1);

    const chLabels = `
      <text x="${CH1_CX}" y="${MINI_Y+MINI_H+18}" text-anchor="middle" font-family="'JetBrains Mono',monospace" font-size="7.5" fill="${GOLD}" letter-spacing="0.28em" opacity="0.85">CH1</text>
      <text x="${CH2_CX}" y="${MINI_Y+MINI_H+18}" text-anchor="middle" font-family="'JetBrains Mono',monospace" font-size="7.5" fill="${CH2_COLOR}" letter-spacing="0.28em" opacity="0.85">CH2</text>
      <line x1="${CH1_CX-22}" y1="${MINI_Y+MINI_H+22}" x2="${CH1_CX+22}" y2="${MINI_Y+MINI_H+22}" stroke="${GOLD_DIM}" stroke-width="0.6" opacity="0.3"/>
      <line x1="${CH2_CX-22}" y1="${MINI_Y+MINI_H+22}" x2="${CH2_CX+22}" y2="${MINI_Y+MINI_H+22}" stroke="${CH2_COLOR}" stroke-width="0.6" opacity="0.3"/>`;

    const k1f = knobSVG('k1freq', CH1_CX-36, KNOB_ROW, ch[0].freq, 0.5, 4, '','FREQ');
    const k1a = knobSVG('k1amp',  CH1_CX+36, KNOB_ROW, ch[0].amp,  0.1, 1, '','AMPL');
    const k2f = knobSVG('k2freq', CH2_CX-36, KNOB_ROW, ch[1].freq, 0.5, 4, '','FREQ');
    const k2a = knobSVG('k2amp',  CH2_CX+36, KNOB_ROW, ch[1].amp,  0.1, 1, '','AMPL');

    const btns0 = waveBtnsSVG(0, CH1_CX, BTN_ROW);
    const btns1 = waveBtnsSVG(1, CH2_CX, BTN_ROW);

    const divX = SCOPE_W/2;
    const divider = `
      <line x1="${divX}" y1="${CTRL_TOP+2}" x2="${divX}" y2="${BODY_H-18}" stroke="${CREAM_4}" stroke-width="0.8" opacity="0.45"/>
      <text x="${divX}" y="${KNOB_ROW+8}" text-anchor="middle" font-family="'Cormorant Garamond',serif" font-size="20" font-weight="300" fill="${INK_3}" opacity="0.22">+</text>`;

    /* Output jack on the right side — anchor for the draggable cable */
    const outJack = `
      <g>
        <rect x="${SCOPE_W-18}" y="${BODY_H/2-12}" width="18" height="24" rx="3" fill="${CREAM_3}" stroke="${CREAM_4}" stroke-width="1"/>
        <circle cx="${SCOPE_W-9}" cy="${BODY_H/2}" r="6.5" fill="${CREAM_2}" stroke="${CREAM_4}" stroke-width="0.9"/>
        <circle cx="${SCOPE_W-9}" cy="${BODY_H/2}" r="2.5" fill="${CREAM_4}"/>
        <text x="${SCOPE_W-22}" y="${BODY_H/2-16}" text-anchor="end" font-family="'JetBrains Mono',monospace" font-size="5.5" fill="${INK_4}" letter-spacing="0.12em" opacity="0.7">OUTPUT</text>
      </g>
      <rect id="scopeJackRef" x="${SCOPE_W-9}" y="${BODY_H/2}" width="1" height="1" fill="none"/>`;

    return `<svg viewBox="0 0 ${SCOPE_W} ${SVG_H}" xmlns="http://www.w3.org/2000/svg">
      ${body}${feet}${titleDecor}${title}${sep}
      ${bezel}${screen}${grid}${ticks}${screenLabels}
      ${mini0}${mini1}
      ${chLabels}${k1f}${k1a}${k2f}${k2a}
      ${btns0}${btns1}
      ${divider}${outJack}
    </svg>`;
  }

  wrap.insertAdjacentHTML('afterbegin', buildSVG());

  /* Canvas placement */
  const mainCanvas  = document.getElementById('waveCanvas');
  const miniCanvas0 = document.getElementById('miniCanvas0');
  const miniCanvas1 = document.getElementById('miniCanvas1');

  function placeCanvas(el, svgX, svgY, svgW, svgH, s) {
    el.style.left   = `${svgX*s}px`;
    el.style.top    = `${svgY*s}px`;
    el.style.width  = `${svgW*s}px`;
    el.style.height = `${svgH*s}px`;
    el.width  = Math.max(1, Math.round(svgW*s*devicePixelRatio));
    el.height = Math.max(1, Math.round(svgH*s*devicePixelRatio));
  }

  function layoutAll() {
    const rect = wrap.getBoundingClientRect();
    if (rect.width === 0) return; // home is hidden — skip
    const s = rect.width / SCOPE_W;
    placeCanvas(mainCanvas,  SCREEN_X, SCREEN_Y, SCREEN_W, SCREEN_H, s);
    placeCanvas(miniCanvas0, MINI1_X,  MINI_Y,   MINI_W,   MINI_H,   s);
    placeCanvas(miniCanvas1, MINI2_X,  MINI_Y,   MINI_W,   MINI_H,   s);
  }
  layoutAll();
  window.addEventListener('resize', layoutAll);
  /* Re-layout when home becomes visible (display: none → block) */
  if (window.ResizeObserver) new ResizeObserver(layoutAll).observe(wrap);

  /* Trace drawing */
  function drawTrace(ctx, W, H, sampleFn, color, glowColor, lineW, alpha, glowAlpha) {
    const mid = H/2;
    ctx.save();
    ctx.shadowColor = glowColor; ctx.shadowBlur = 10*devicePixelRatio;
    ctx.strokeStyle = color; ctx.lineWidth = lineW*devicePixelRatio;
    ctx.globalAlpha = glowAlpha; ctx.beginPath();
    for (let px=0; px<W; px++) {
      const y = mid - sampleFn(px/W, px)*(mid-5*devicePixelRatio);
      px===0 ? ctx.moveTo(px,y) : ctx.lineTo(px,y);
    }
    ctx.stroke(); ctx.restore();
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = lineW*devicePixelRatio;
    ctx.lineJoin = 'round'; ctx.globalAlpha = alpha; ctx.beginPath();
    for (let px=0; px<W; px++) {
      const y = mid - sampleFn(px/W, px)*(mid-5*devicePixelRatio);
      px===0 ? ctx.moveTo(px,y) : ctx.lineTo(px,y);
    }
    ctx.stroke(); ctx.restore();
  }

  function drawMini(canvas, chIdx) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    if (W === 0 || H === 0) return;
    ctx.clearRect(0,0,W,H);
    const scroll = t*0.1;
    const c = ch[chIdx];
    const color = chIdx===0 ? GOLD : CH2_COLOR;
    const glow  = chIdx===0 ? GOLD_GLOW : CH2_GLOW;
    const fn = (x, px) => sampleWave(c.wave, x+scroll, c.freq, px) * c.amp;
    drawTrace(ctx, W, H, fn, color, glow, 1.2, 0.82, 0.22);
  }

  function drawMain(canvas) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    if (W === 0 || H === 0) return;
    ctx.clearRect(0,0,W,H);
    drawTrace(ctx, W, H, sumSampler(W), GOLD_BRIGHT, GOLD_GLOW, 1.6, 0.88, 0.28);
  }

  /* Build a sampler that produces the same SUM trace shown on the main scope.
     Used by both the main canvas and (via window.wf) the sidebar oscilloscope. */
  function sumSampler(W) {
    const scroll = t*0.1;
    const maxAmp = ch[0].amp + ch[1].amp;
    const norm = maxAmp > 1 ? 1/maxAmp : 1;
    return (x, px) =>
      (sampleWave(ch[0].wave, x+scroll, ch[0].freq, px) * ch[0].amp +
       sampleWave(ch[1].wave, x+scroll, ch[1].freq, px) * ch[1].amp) * norm;
  }

  /* Animation — runs continuously so state is fresh even when home is hidden.
     Cable physics + drawing are folded in once the cable system is set up. */
  let cableTickFn = null; // assigned later when cable system is initialized
  function animate(ts) {
    t = ts*0.0005416; // +18% scroll speed
    drawMain(mainCanvas);
    drawMini(miniCanvas0, 0);
    drawMini(miniCanvas1, 1);
    if (cableTickFn) cableTickFn();
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  /* Knob interaction */
  const KNOB_MAP = {
    k1freq:[0,'freq',0.5,4], k1amp:[0,'amp',0.1,1],
    k2freq:[1,'freq',0.5,4], k2amp:[1,'amp',0.1,1],
  };
  const KNOB_CX = {
    k1freq:CH1_CX-36, k1amp:CH1_CX+36,
    k2freq:CH2_CX-36, k2amp:CH2_CX+36,
  };

  function updateKnobVisual(id, val, min, max) {
    const el = document.getElementById(id);
    if (!el) return;
    const norm = (val-min)/(max-min);
    const angle = -135+norm*270;
    const rad = (angle-90)*Math.PI/180;
    const cx = KNOB_CX[id], cy = KNOB_ROW;
    const nx = cx+Math.cos(rad)*(KNOB_R-5);
    const ny = cy+Math.sin(rad)*(KNOB_R-5);
    const notch = el.querySelector('.knob-notch');
    if (notch) { notch.setAttribute('cx',nx); notch.setAttribute('cy',ny); }
    const r=KNOB_R+5;
    const sA=(-135-90)*Math.PI/180;
    const sx=cx+Math.cos(sA)*r, sy=cy+Math.sin(sA)*r;
    const ex=cx+Math.cos(rad)*r, ey=cy+Math.sin(rad)*r;
    const large=(angle+135)>180?1:0;
    const arc=el.querySelector('.knob-arc');
    if (arc) arc.setAttribute('d',`M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`);
  }

  Object.entries(KNOB_MAP).forEach(([id,[chIdx,prop,min,max]]) => {
    const el = document.getElementById(id);
    if (!el) return;
    let dragging=false, startY=0, startVal=0;
    const begin = y => { dragging=true; startY=y; startVal=ch[chIdx][prop]; };
    const move = y => {
      if (!dragging) return;
      const dy = startY - y;
      ch[chIdx][prop] = Math.max(min, Math.min(max, startVal + dy*((max-min)/160)));
      updateKnobVisual(id, ch[chIdx][prop], min, max);
    };
    el.addEventListener('mousedown', e => { begin(e.clientY); e.preventDefault(); });
    window.addEventListener('mousemove', e => move(e.clientY));
    window.addEventListener('mouseup',  () => { dragging=false; });
    el.addEventListener('touchstart', e => { begin(e.touches[0].clientY); e.preventDefault(); }, { passive:false });
    window.addEventListener('touchmove', e => { if (dragging) move(e.touches[0].clientY); });
    window.addEventListener('touchend', () => { dragging=false; });
  });

  /* Wave-type buttons */
  function updateWaveBtns() {
    document.querySelectorAll('.scope-wrap .wave-btn').forEach(g => {
      const ci = parseInt(g.dataset.ch), w = g.dataset.wave;
      const active = ch[ci].wave === w;
      const col = ci===0 ? GOLD : CH2_COLOR;
      g.querySelector('rect').setAttribute('stroke', active?GOLD_DIM:CREAM_4);
      g.querySelector('rect').setAttribute('fill',   active?CREAM_3:CREAM_2);
      g.querySelector('text').setAttribute('fill',   active?col:INK_4);
    });
  }
  document.querySelectorAll('.scope-wrap .wave-btn').forEach(g => {
    g.addEventListener('click', () => {
      ch[parseInt(g.dataset.ch)].wave = g.dataset.wave;
      updateWaveBtns();
    });
  });
  updateWaveBtns();

  /* ──────────────────────────────────────────────────────────
     SPEAKER (gramophone horn) — sits to the right of the scope.
     User drags a cable from the scope's OUTPUT jack to the speaker's
     INPUT jack to make the SUM trace audible.
     ────────────────────────────────────────────────────────── */
  const speakerWrap = document.getElementById('speakerWrap');
  const cableCanvas = document.getElementById('speaker-cable');
  const plugHint    = document.getElementById('plugHint');
  const cableCtx    = cableCanvas ? cableCanvas.getContext('2d') : null;
  const WIRE_COL    = '#7A6030';

  /* Speaker SVG layout */
  const SP_W = 260, SP_H = 500;
  const BOX_X = 12, BOX_Y = 250, BOX_W = 236, BOX_H = 178;
  const BOX_CX = BOX_X + BOX_W/2;
  const HORN_BELL_Y = 22;
  const HORN_BELL_HW = 118;
  const HORN_THROAT_HW = 12;
  const SP_JACK_X = BOX_X, SP_JACK_Y = BOX_Y + 90;

  function buildSpeakerSVG() {
    const lx0 = BOX_CX - HORN_THROAT_HW, rx0 = BOX_CX + HORN_THROAT_HW;
    const lBell = BOX_CX - HORN_BELL_HW, rBell = BOX_CX + HORN_BELL_HW;
    const hornPath = `M ${lx0} ${BOX_Y}
      C ${lx0-22} ${BOX_Y-50} ${lBell+12} ${HORN_BELL_Y+55} ${lBell} ${HORN_BELL_Y}
      Q ${BOX_CX} ${HORN_BELL_Y-20} ${rBell} ${HORN_BELL_Y}
      C ${rBell-12} ${HORN_BELL_Y+55} ${rx0+22} ${BOX_Y-50} ${rx0} ${BOX_Y} Z`;

    const ribData = [
      {y:BOX_Y-30, hw:22},{y:BOX_Y-62,hw:42},{y:BOX_Y-96,hw:66},
      {y:BOX_Y-130,hw:88},{y:BOX_Y-162,hw:106},{y:BOX_Y-192,hw:118},
    ];
    const ribs = ribData.map(({y,hw}) =>
      `<line x1="${BOX_CX-hw}" y1="${y}" x2="${BOX_CX+hw}" y2="${y}" stroke="${GOLD_DIM}" stroke-width="0.9" opacity="0.22"/>`
    ).join('');

    const throat = `<rect x="${BOX_CX-10}" y="${BOX_Y-6}" width="20" height="10" rx="4" fill="${CREAM_3}" stroke="${CREAM_4}" stroke-width="0.9"/>`;
    const box = `<rect x="${BOX_X}" y="${BOX_Y}" width="${BOX_W}" height="${BOX_H}" rx="5" fill="${CREAM_2}" stroke="${CREAM_4}" stroke-width="1.3"/>`;
    const inlay = `<rect x="${BOX_X+8}" y="${BOX_Y+8}" width="${BOX_W-16}" height="${BOX_H-16}" rx="3" fill="none" stroke="${GOLD_DIM}" stroke-width="0.7" opacity="0.30"/>`;
    const panels = [BOX_Y+48,BOX_Y+96,BOX_Y+140].map(y =>
      `<line x1="${BOX_X+22}" y1="${y}" x2="${BOX_X+BOX_W-22}" y2="${y}" stroke="${CREAM_4}" stroke-width="0.6" opacity="0.5"/>`
    ).join('');
    const cornerDiamonds = [[BOX_X+20,BOX_Y+20],[BOX_X+BOX_W-20,BOX_Y+20],
      [BOX_X+20,BOX_Y+BOX_H-20],[BOX_X+BOX_W-20,BOX_Y+BOX_H-20]].map(([cx,cy]) =>
      `<polygon points="${cx},${cy-6} ${cx+6},${cy} ${cx},${cy+6} ${cx-6},${cy}" fill="none" stroke="${GOLD_DIM}" stroke-width="0.8" opacity="0.4"/>`
    ).join('');
    const gCX = BOX_CX, gCY = BOX_Y + 72;
    const grill = [0,1,2,3].map(i =>
      `<circle cx="${gCX}" cy="${gCY}" r="${7+i*11}" fill="none" stroke="${CREAM_4}" stroke-width="0.7" opacity="${0.6-i*0.1}"/>`
    ).join('') + `<circle cx="${gCX}" cy="${gCY}" r="3" fill="${CREAM_4}" opacity="0.35"/>`;
    const sFeet = [BOX_X+28, BOX_CX, BOX_X+BOX_W-28].map(fx =>
      `<ellipse cx="${fx}" cy="${BOX_Y+BOX_H}" rx="14" ry="7" fill="${CREAM_3}" stroke="${CREAM_4}" stroke-width="0.9"/>`
    ).join('');
    const jackSock = `
      <g class="speaker-jack-group" id="speakerJackGroup">
        <rect x="${SP_JACK_X-12}" y="${SP_JACK_Y-12}" width="24" height="24" rx="4" fill="${CREAM_3}" stroke="${CREAM_4}" stroke-width="1"/>
        <circle cx="${SP_JACK_X}" cy="${SP_JACK_Y}" r="7" fill="${CREAM_2}" stroke="${CREAM_4}" stroke-width="0.9"/>
        <circle id="jackHole" cx="${SP_JACK_X}" cy="${SP_JACK_Y}" r="2.8" fill="${CREAM_4}"/>
        <text x="${SP_JACK_X+16}" y="${SP_JACK_Y-14}" font-family="'JetBrains Mono',monospace" font-size="5.5" fill="${INK_4}" letter-spacing="0.14em" opacity="0.7">INPUT</text>
      </g>
      <rect id="speakerJackRef" x="${SP_JACK_X}" y="${SP_JACK_Y}" width="1" height="1" fill="none"/>`;
    const indicator = `
      <circle id="connIndicator" cx="${BOX_CX+82}" cy="${BOX_Y+18}" r="4.5" fill="${CREAM_4}" stroke="${CREAM_4}" stroke-width="0.8"/>
      <text x="${BOX_CX+91}" y="${BOX_Y+21}" font-family="'JetBrains Mono',monospace" font-size="5" fill="${INK_4}" letter-spacing="0.1em" opacity="0.5">PWR</text>`;
    const unplugBtn = `
      <text id="unplugBtn" class="unplug-btn" x="${BOX_CX}" y="${BOX_Y+BOX_H-8}" text-anchor="middle"
        font-family="'JetBrains Mono',monospace" font-size="6" fill="${GOLD}" letter-spacing="0.22em" opacity="0">UNPLUG ×</text>`;
    const lbl = `
      <text x="${BOX_CX}" y="${BOX_Y+BOX_H+24}" text-anchor="middle" font-family="'JetBrains Mono',monospace" font-size="7" fill="${INK_4}" letter-spacing="0.28em">LS₁ · 8Ω</text>`;
    const bellRef = `<rect id="hornBellRef" x="${BOX_CX}" y="${HORN_BELL_Y}" width="1" height="1" fill="none"/>`;

    return `<svg viewBox="0 0 ${SP_W} ${SP_H}" xmlns="http://www.w3.org/2000/svg">
      <path d="${hornPath}" fill="${CREAM_2}" stroke="${GOLD_DIM}" stroke-width="1.3"/>
      ${ribs}${throat}
      ${box}${inlay}${panels}${cornerDiamonds}${grill}${sFeet}
      ${jackSock}${indicator}${unplugBtn}${lbl}${bellRef}
    </svg>`;
  }

  if (speakerWrap) speakerWrap.innerHTML = buildSpeakerSVG();

  /* ── Cable physics (Verlet chain dangling from scope output jack) ── */
  function refPos(id) {
    const el = document.getElementById(id);
    if (!el) return { x:0, y:0 };
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width/2, y: r.top + r.height/2 };
  }
  function homeVisible() {
    return wrap.getBoundingClientRect().width > 0;
  }

  const WIRE_SEGS = 20, WIRE_GRAVITY = 0.30, WIRE_DAMPING = 0.88, SEG_LEN = 12, SLACK = 1.35;
  let cableChain = [];
  let cableDragging = false, cableConnected = false;
  let cableMouseX = 0, cableMouseY = 0;

  function initCable() {
    const anchor = refPos('scopeJackRef');
    const endX = anchor.x, endY = anchor.y + 80;
    cableChain = [];
    for (let i = 0; i <= WIRE_SEGS; i++) {
      const k = i / WIRE_SEGS;
      const x = anchor.x + (endX-anchor.x)*k;
      const y = anchor.y + (endY-anchor.y)*k;
      cableChain.push({ x, y, px:x, py:y });
    }
  }
  function setConnectedCable() {
    const a = refPos('scopeJackRef'), b = refPos('speakerJackRef');
    const dist = Math.hypot(b.x-a.x, b.y-a.y);
    const sag = Math.min(60, dist * 0.18);
    for (let i = 0; i <= WIRE_SEGS; i++) {
      const k = i / WIRE_SEGS;
      const x = a.x + (b.x-a.x)*k;
      const y = a.y + (b.y-a.y)*k + Math.sin(k*Math.PI)*sag;
      cableChain[i] = { x, y, px:x, py:y };
    }
  }
  function updateCable() {
    if (!cableChain.length) return;
    if (cableConnected) { setConnectedCable(); return; }
    const anchor = refPos('scopeJackRef');
    for (let i = 1; i < cableChain.length-1; i++) {
      const p = cableChain[i];
      const vx = (p.x - p.px) * WIRE_DAMPING;
      const vy = (p.y - p.py) * WIRE_DAMPING;
      p.px = p.x; p.py = p.y;
      p.x += vx; p.y += vy + WIRE_GRAVITY;
    }
    if (cableDragging) {
      const last = cableChain[cableChain.length-1];
      last.x = cableMouseX; last.y = cableMouseY;
      last.px = cableMouseX; last.py = cableMouseY;
    }
    const rest = SEG_LEN * SLACK;
    for (let iter = 0; iter < 4; iter++) {
      cableChain[0].x = anchor.x; cableChain[0].y = anchor.y;
      if (cableDragging) {
        cableChain[cableChain.length-1].x = cableMouseX;
        cableChain[cableChain.length-1].y = cableMouseY;
      }
      for (let i = 0; i < cableChain.length-1; i++) {
        const a = cableChain[i], b = cableChain[i+1];
        const dx = b.x-a.x, dy = b.y-a.y;
        const d = Math.sqrt(dx*dx+dy*dy) || 0.001;
        const diff = (d-rest)/d * 0.5;
        if (i > 0) { a.x += dx*diff; a.y += dy*diff; }
        const lastFix = cableDragging && i === cableChain.length-2;
        if (!lastFix) { b.x -= dx*diff; b.y -= dy*diff; }
      }
      cableChain[0].x = anchor.x; cableChain[0].y = anchor.y;
      if (cableDragging) {
        cableChain[cableChain.length-1].x = cableMouseX;
        cableChain[cableChain.length-1].y = cableMouseY;
      }
    }
  }

  function resizeCableCanvas() {
    if (!cableCanvas) return;
    cableCanvas.width  = window.innerWidth  * devicePixelRatio;
    cableCanvas.height = window.innerHeight * devicePixelRatio;
    cableCanvas.style.width  = window.innerWidth + 'px';
    cableCanvas.style.height = window.innerHeight + 'px';
  }
  resizeCableCanvas();
  window.addEventListener('resize', () => { resizeCableCanvas(); if (!cableConnected) initCable(); });

  function drawPlug(x, y, prev) {
    const angle = Math.atan2(y - prev.y, x - prev.x);
    cableCtx.save();
    cableCtx.translate(x, y); cableCtx.rotate(angle);
    cableCtx.fillStyle = CREAM_2; cableCtx.strokeStyle = GOLD_DIM; cableCtx.lineWidth = 1;
    cableCtx.beginPath(); cableCtx.roundRect(-20, -4.5, 18, 9, 2); cableCtx.fill(); cableCtx.stroke();
    cableCtx.strokeStyle = CREAM_4; cableCtx.lineWidth = 0.8;
    cableCtx.beginPath(); cableCtx.moveTo(-12, -4.5); cableCtx.lineTo(-12, 4.5); cableCtx.stroke();
    cableCtx.fillStyle = GOLD_DIM;
    cableCtx.beginPath();
    cableCtx.moveTo(-2,-3); cableCtx.lineTo(8,0); cableCtx.lineTo(-2,3); cableCtx.closePath(); cableCtx.fill();
    cableCtx.fillStyle = GOLD;
    cableCtx.beginPath(); cableCtx.arc(8, 0, 2.2, 0, Math.PI*2); cableCtx.fill();
    cableCtx.restore();
  }

  let ringPhase = 0, audioAmplitude = 0;
  function drawHornRings() {
    if (!cableConnected || audioAmplitude < 0.02) return;
    const bell = refPos('hornBellRef');
    const speakerSVG = speakerWrap && speakerWrap.querySelector('svg');
    if (!speakerSVG) return;
    const sRect = speakerSVG.getBoundingClientRect();
    const s = sRect.width / SP_W;
    const bellR = HORN_BELL_HW * s;
    ringPhase += 0.035;
    for (let i = 0; i < 3; i++) {
      const p = ((ringPhase + i/3) % 1);
      const r = bellR * (0.7 + p * 0.7);
      const alpha = (1 - p) * audioAmplitude * 0.7;
      if (alpha <= 0.01) continue;
      cableCtx.save();
      cableCtx.strokeStyle = GOLD; cableCtx.lineWidth = 1.5; cableCtx.globalAlpha = alpha;
      cableCtx.beginPath(); cableCtx.arc(bell.x, bell.y, r, 0, Math.PI*2);
      cableCtx.stroke(); cableCtx.restore();
    }
  }

  function drawCable() {
    if (!cableCtx) return;
    const W = cableCanvas.width, H = cableCanvas.height;
    cableCtx.clearRect(0, 0, W, H);
    if (!homeVisible() || cableChain.length < 2) return;
    const dpr = devicePixelRatio;
    cableCtx.save(); cableCtx.scale(dpr, dpr);

    /* shadow */
    cableCtx.save(); cableCtx.strokeStyle = 'rgba(90,70,30,0.10)'; cableCtx.lineWidth = 4;
    cableCtx.lineCap = 'round'; cableCtx.lineJoin = 'round'; cableCtx.beginPath();
    cableCtx.moveTo(cableChain[0].x, cableChain[0].y + 2);
    for (let i = 1; i < cableChain.length; i++) cableCtx.lineTo(cableChain[i].x, cableChain[i].y + 2);
    cableCtx.stroke(); cableCtx.restore();

    /* body */
    cableCtx.save(); cableCtx.strokeStyle = WIRE_COL; cableCtx.lineWidth = 2.4;
    cableCtx.lineCap = 'round'; cableCtx.lineJoin = 'round'; cableCtx.beginPath();
    cableCtx.moveTo(cableChain[0].x, cableChain[0].y);
    for (let i = 1; i < cableChain.length-1; i++) {
      const mx = (cableChain[i].x + cableChain[i+1].x) / 2;
      const my = (cableChain[i].y + cableChain[i+1].y) / 2;
      cableCtx.quadraticCurveTo(cableChain[i].x, cableChain[i].y, mx, my);
    }
    cableCtx.lineTo(cableChain[cableChain.length-1].x, cableChain[cableChain.length-1].y);
    cableCtx.stroke(); cableCtx.restore();

    /* highlight */
    cableCtx.save(); cableCtx.strokeStyle = 'rgba(220,185,90,0.22)'; cableCtx.lineWidth = 0.9;
    cableCtx.lineCap = 'round'; cableCtx.beginPath();
    cableCtx.moveTo(cableChain[0].x - 0.5, cableChain[0].y - 0.5);
    for (let i = 1; i < cableChain.length; i++) cableCtx.lineTo(cableChain[i].x - 0.5, cableChain[i].y - 0.5);
    cableCtx.stroke(); cableCtx.restore();

    if (!cableConnected) {
      const end = cableChain[cableChain.length-1];
      const prev = cableChain[cableChain.length-2];
      drawPlug(end.x, end.y, prev);
    }
    drawHornRings();
    cableCtx.restore();
  }

  /* Initialize cable chain after layout settles */
  initCable();
  if (window.ResizeObserver) new ResizeObserver(() => { if (!cableConnected) initCable(); }).observe(wrap);

  /* ── Cable drag/connect interaction ── */
  document.addEventListener('mousemove', e => {
    cableMouseX = e.clientX; cableMouseY = e.clientY;
    if (!cableCanvas) return;
    if (cableDragging) {
      cableCanvas.style.pointerEvents = 'all';
      return;
    }
    if (cableConnected || !homeVisible() || !cableChain.length) {
      cableCanvas.style.pointerEvents = 'none';
      if (plugHint) plugHint.style.opacity = '0';
      return;
    }
    const end = cableChain[cableChain.length-1];
    const dist = Math.hypot(cableMouseX-end.x, cableMouseY-end.y);
    const near = dist < 24;
    cableCanvas.style.pointerEvents = near ? 'all' : 'none';
    if (plugHint) {
      plugHint.style.opacity = near ? '1' : '0';
      plugHint.style.left = (end.x + 14) + 'px';
      plugHint.style.top  = (end.y - 18) + 'px';
    }
  });

  if (cableCanvas) cableCanvas.addEventListener('mousedown', e => {
    if (cableConnected || cableDragging || !cableChain.length) return;
    const end = cableChain[cableChain.length-1];
    if (Math.hypot(e.clientX-end.x, e.clientY-end.y) < 24) {
      cableDragging = true;
      cableMouseX = e.clientX; cableMouseY = e.clientY;
      if (plugHint) plugHint.style.opacity = '0';
    }
  });

  window.addEventListener('mouseup', e => {
    if (!cableDragging) return;
    cableDragging = false;
    const sp = refPos('speakerJackRef');
    if (Math.hypot(e.clientX-sp.x, e.clientY-sp.y) < 40) {
      connectCable();
    }
  });

  function connectCable() {
    cableConnected = true;
    setConnectedCable();
    startSpeakerAudio();
    const ind = document.getElementById('connIndicator');
    if (ind) { ind.setAttribute('fill', GOLD); ind.setAttribute('stroke', GOLD_DIM); }
    const hole = document.getElementById('jackHole');
    if (hole) hole.setAttribute('fill', GOLD_DIM);
    const ub = document.getElementById('unplugBtn');
    if (ub) ub.style.opacity = '0.75';
    if (cableCanvas) cableCanvas.style.pointerEvents = 'none';
  }
  function disconnectCable() {
    cableConnected = false;
    stopSpeakerAudio();
    initCable();
    const ind = document.getElementById('connIndicator');
    if (ind) { ind.setAttribute('fill', CREAM_4); ind.setAttribute('stroke', CREAM_4); }
    const hole = document.getElementById('jackHole');
    if (hole) hole.setAttribute('fill', CREAM_4);
    const ub = document.getElementById('unplugBtn');
    if (ub) ub.style.opacity = '0';
    audioAmplitude = 0;
  }
  document.addEventListener('click', e => {
    const target = e.target;
    if (!target) return;
    if (target.id === 'unplugBtn' && cableConnected) disconnectCable();
    else if (target.closest && target.closest('#speakerJackGroup') && cableConnected) disconnectCable();
  });

  /* ── Audio engine for the SUM trace (shares the page-wide audioCtx) ── */
  let spkScriptNode = null, spkGainNode = null;
  const audioPhase = [0, 0];
  function sampleAudio(wave, phase) {
    switch (wave) {
      case 'sine':     return Math.sin(phase);
      case 'square':   return Math.sign(Math.sin(phase));
      case 'saw':      { const p = ((phase/Math.PI) % 2 + 2) % 2; return p - 1; }
      case 'triangle': { const p = ((phase/Math.PI) % 2 + 2) % 2; return p < 1 ? 2*p-1 : 3-2*p; }
      case 'damped':   { const env = Math.exp(-(phase % (Math.PI*4))/(Math.PI*2)); return Math.sin(phase*2)*env; }
      case 'noise':    return Math.random()*2 - 1;
    }
    return 0;
  }
  function startSpeakerAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const sr = audioCtx.sampleRate;
    spkScriptNode = audioCtx.createScriptProcessor(2048, 0, 1);
    spkGainNode = audioCtx.createGain();
    spkGainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    spkGainNode.gain.linearRampToValueAtTime(0.30, audioCtx.currentTime + 0.08);
    spkScriptNode.onaudioprocess = e => {
      const out = e.outputBuffer.getChannelData(0);
      let rms = 0;
      for (let i = 0; i < out.length; i++) {
        const f0 = ch[0].freq * 150, f1 = ch[1].freq * 150;
        audioPhase[0] += (2*Math.PI*f0)/sr;
        audioPhase[1] += (2*Math.PI*f1)/sr;
        if (audioPhase[0] > Math.PI*4000) audioPhase[0] -= Math.PI*4000;
        if (audioPhase[1] > Math.PI*4000) audioPhase[1] -= Math.PI*4000;
        const s0 = sampleAudio(ch[0].wave, audioPhase[0]) * ch[0].amp;
        const s1 = sampleAudio(ch[1].wave, audioPhase[1]) * ch[1].amp;
        const sum = (s0 + s1) * 0.42;
        out[i] = Math.max(-1, Math.min(1, sum));
        rms += sum*sum;
      }
      audioAmplitude = Math.sqrt(rms / out.length);
    };
    spkScriptNode.connect(spkGainNode);
    spkGainNode.connect(audioCtx.destination);
  }
  function stopSpeakerAudio() {
    if (!spkGainNode || !audioCtx) return;
    spkGainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.06);
    setTimeout(() => {
      if (spkScriptNode) { spkScriptNode.disconnect(); spkScriptNode = null; }
      if (spkGainNode)   { spkGainNode.disconnect();   spkGainNode = null; }
    }, 80);
  }

  /* Hook the cable physics + drawing into the existing animate loop */
  cableTickFn = () => { updateCable(); drawCable(); };

  /* Public hooks for the sidebar oscilloscope */
  window.wf = {
    ch,
    sampleWave,
    sumSample(x, W) {
      const scroll = t*0.1;
      const maxAmp = ch[0].amp + ch[1].amp;
      const norm = maxAmp > 1 ? 1/maxAmp : 1;
      const xn = x / W;
      return (sampleWave(ch[0].wave, xn+scroll, ch[0].freq, x) * ch[0].amp +
              sampleWave(ch[1].wave, xn+scroll, ch[1].freq, x) * ch[1].amp) * norm;
    },
    getT: () => t,
  };
})();
