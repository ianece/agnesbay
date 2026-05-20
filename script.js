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
const ANTI_CLICK_FADE = 0.1; // seconds

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

/* The button no longer pauses — it stops playback entirely and the dock,
   marquee, and button itself all hide until music is started again. */
function oscTogglePlay() { stopPlayback(); }

function stopPlayback() {
  if (currentAudio) {
    fadeAudioOutThenPause(currentAudio);
    setTimeout(() => {
      if (currentAudio) {
        try { currentAudio.currentTime = 0; } catch (e) {}
        currentAudio.src = '';
      }
      currentAudio = null;
      currentIdx = -1;
    }, ANTI_CLICK_FADE * 1000 + 30);
  } else {
    currentIdx = -1;
  }
  document.querySelectorAll('.track-row').forEach(r => r.classList.remove('playing'));
  vizWrap.classList.remove('active');
  document.body.classList.remove('music-active');
  const ppBtn = document.getElementById('osc-playpause');
  if (ppBtn) ppBtn.style.display = 'none';
  document.getElementById('osc-play-icon').style.display  = 'block';
  document.getElementById('osc-pause-icon').style.display = 'none';
  waveTarget = (typeof sectionWaveMap !== 'undefined' ? sectionWaveMap[current] : null) || 'sine';
  waveMode = waveTarget;
  window._audioTimeData = null;
}

/* Marquee helpers — both copies of title/time are kept in sync. */
function setNowPlayingTitle(title) {
  document.querySelectorAll('[data-np-title]').forEach(el => el.textContent = title);
}
function setNowPlayingTime(cur, dur) {
  const txt = formatTime(cur || 0) + ' / ' + (isFinite(dur) ? formatTime(dur) : '—:——');
  document.querySelectorAll('[data-np-time]').forEach(el => el.textContent = txt);
}

/* ── AUDIO PLAYER ── */
const TRACKS = [
  { file: 'assets/audio/haze-to-come.mp3', title: 'haze to come [DEMO]' },
  {file: 'assets/audio/thevoiceofbeauty-mp3.mp3', title: 'the voice of beauty [DEMO]' },
  {file: 'assets/audio/firepit-mp3.mp3', title: 'firepit' },
  {file: 'assets/audio/suno/starlight.mp3', title: 'Starlight' },
  {file: 'assets/audio/suno/fkbeingpolite.mp3', title: 'F**k Being Polite' },
  {file: 'assets/audio/suno/its_alright.mp3', title: 'Its All Right' },
  {file: 'assets/audio/suno/ghosts.mp3', title: 'Ghosts' },
   {file: 'assets/audio/cinder_lens.mp3', title: 'Cinder Lens' },
  {file: 'assets/audio/suno/2_minutes_later.mp3', title: '2 Minutes Later' },
  {file: 'assets/audio/suno/exhaie_trance.mp3', title: 'Exhale Trance' },
  {file: 'assets/audio/suno/solder_rain.mp3', title: 'Solder Rain' },
  {file: 'assets/audio/suno/the_gulls_beneath.mp3', title: 'The Gulls Beneath' },


  // Add more: { file: 'assets/audio/your-track.mp3', title: 'track name' },
];

let audioCtx = null, analyser = null, source = null, gainNode = null;
/* Second analyser tap with a larger FFT for the music-page wireframe
   reactor — connected in parallel to the chain so the sidebar oscilloscope
   keeps its existing low-FFT behavior. */
let vizAnalyser = null;
let currentAudio = null, currentIdx = -1;
const vizWrap = document.getElementById('viz-wrap');

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

/* Reset playing-track UI between tracks. The dock + marquee stay up so the
   transition between tracks is seamless — only stopPlayback() takes them down. */
function clearActive() {
  document.querySelectorAll('.track-row').forEach(r => r.classList.remove('playing'));
  vizWrap.classList.remove('active');
  waveTarget = 'sine'; waveMode = 'sine';
  window._audioTimeData = null;
}

function playTrack(idx) {
  const track = TRACKS[idx];
  if (!track) return;

  /* Clicking the currently-playing track is a stop — pause is gone. */
  if (currentIdx === idx && currentAudio) {
    stopPlayback();
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

  audio.addEventListener('loadedmetadata', () => {
    setDuration(idx, audio.duration);
    setNowPlayingTime(audio.currentTime, audio.duration);
  });
  audio.addEventListener('timeupdate', () => {
    setProgress(idx, audio.currentTime, audio.duration);
    if (currentIdx === idx) setNowPlayingTime(audio.currentTime, audio.duration);
  });
  audio.addEventListener('ended', () => {
    if (idx + 1 < TRACKS.length) {
      clearActive();
      playTrack(idx + 1);
    } else {
      stopPlayback();
    }
  });

  /* Connect to analyser */
  if (source) source.disconnect();
  source = audioCtx.createMediaElementSource(audio);
  source.connect(analyser);
  /* Spin up the visualizer's analyser on first play and tap into it. */
  if (!vizAnalyser) {
    vizAnalyser = audioCtx.createAnalyser();
    vizAnalyser.fftSize = 1024;
    vizAnalyser.smoothingTimeConstant = 0.74;
  }
  source.connect(vizAnalyser);

  fadeAudioIn();
  audio.play().then(() => {
    currentAudio = audio;
    currentIdx = idx;
    document.getElementById('track-' + idx).classList.add('playing');
    vizWrap.classList.add('active');
    document.body.classList.add('music-active');
    const ppBtn = document.getElementById('osc-playpause');
    ppBtn.style.display = 'flex';
    document.getElementById('osc-play-icon').style.display  = 'none';
    document.getElementById('osc-pause-icon').style.display = 'block';
    setNowPlayingTitle(track.title);
    setNowPlayingTime(audio.currentTime, audio.duration);
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

  /* Smooth the playing track's progress dot at 60 fps. The HTMLAudioElement
     `timeupdate` event only fires ~4×/sec, which made the dot visibly stutter;
     reading currentTime each animation frame makes the motion continuous.
     Skipped while the user is dragging the dot (the seek handler owns it). */
  if (currentIdx >= 0 && !seekState.active && currentAudio.duration) {
    const bar = document.getElementById('prog-' + currentIdx);
    if (bar) bar.style.width = ((currentAudio.currentTime / currentAudio.duration) * 100) + '%';
  }

  /* Force oscilloscope to audio mode while playing */
  waveTarget = 'audio';
  waveMode   = 'audio';
}
drawViz();

/* ── Click + drag along the playing track's progress bar to seek ──
   Delegated at document level since there are two .player-wrap containers
   (Original works / Suno Creations) — and one shares a non-unique id. We
   intercept on capture so the parent .track-row's onclick (which would
   otherwise stop playback) never fires for clicks inside the bar. */
const seekState = { active: false, wrap: null, idx: -1, pointerId: -1 };

function _seekFromEvent(e, wrap, idx) {
  if (currentIdx !== idx || !currentAudio || !currentAudio.duration) return;
  const r = wrap.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  currentAudio.currentTime = frac * currentAudio.duration;
  const bar = document.getElementById('prog-' + idx);
  if (bar) bar.style.width = (frac * 100) + '%';
  setNowPlayingTime(currentAudio.currentTime, currentAudio.duration);
}

document.addEventListener('pointerdown', e => {
  const wrap = e.target.closest && e.target.closest('.progress-wrap');
  if (!wrap) return;
  const row = wrap.closest('.track-row');
  if (!row || !row.classList.contains('playing')) return;
  const idx = Number(row.id.split('-')[1]);
  if (!Number.isFinite(idx)) return;
  e.stopPropagation();
  e.preventDefault();
  seekState.active = true;
  seekState.wrap = wrap;
  seekState.idx = idx;
  seekState.pointerId = e.pointerId;
  wrap.classList.add('seeking');
  try { wrap.setPointerCapture(e.pointerId); } catch (_) {}
  _seekFromEvent(e, wrap, idx);
  /* Pointer capture + preventDefault suppress the synthesized mousemove
     events that drive the probe cursor — feed the cursor's mouse target
     directly so the probe keeps tracking the drag. */
  mouse.x = e.clientX; mouse.y = e.clientY;
}, true);

document.addEventListener('pointermove', e => {
  if (!seekState.active) return;
  _seekFromEvent(e, seekState.wrap, seekState.idx);
  mouse.x = e.clientX; mouse.y = e.clientY;
});

function _endSeek(e) {
  if (!seekState.active) return;
  if (seekState.wrap) {
    seekState.wrap.classList.remove('seeking');
    try { seekState.wrap.releasePointerCapture(seekState.pointerId); } catch (_) {}
  }
  seekState.active = false;
  seekState.wrap = null;
  seekState.idx = -1;
  seekState.pointerId = -1;
}
document.addEventListener('pointerup', _endSeek);
document.addEventListener('pointercancel', _endSeek);

/* Swallow the synthesized click that follows pointerdown on the bar so the
   row's onclick (which toggles playback off) never fires. */
document.addEventListener('click', e => {
  if (e.target.closest && e.target.closest('.progress-wrap')) {
    e.stopPropagation();
    e.preventDefault();
  }
}, true);

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

/* ── Touch: tap-to-stick ──
   On touch devices `mousemove` never fires, so the probe would freeze in
   its initial position. Instead, treat each tap as a new probe target —
   the verlet chain springs to it (via the existing physics in
   updateChain) and stays clipped on like a real scope probe. On first
   load, set a deliberate "rest" pose draped from the anchor jack so the
   probe doesn't point at the origin. */
let touchModeActive = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
function setProbeRestPose() {
  mouse.x = anchor.x + 90;
  mouse.y = anchor.y + 140;
}
if (touchModeActive) setProbeRestPose();
document.addEventListener('touchstart', e => {
  touchModeActive = true;
  if (e.touches && e.touches.length > 0) {
    mouse.x = e.touches[0].clientX;
    mouse.y = e.touches[0].clientY;
  }
}, { passive: true });

/* Dock the cable's anchor (jack) just below the oscilloscope's bottom-right
   corner so the probe wire visually plugs into the scope. The probe itself
   still follows the mouse — only the anchor is fixed here. */
function recomputeAnchorDock() {
  const osc = document.getElementById('osc');
  if (!osc) return;
  const r = osc.getBoundingClientRect();
  anchor.x = r.right - 4;
  anchor.y = r.bottom + 6;
}
recomputeAnchorDock();
window.addEventListener('load', () => {
  recomputeAnchorDock();
  if (touchModeActive) setProbeRestPose();
});
window.addEventListener('resize', recomputeAnchorDock);
/* Re-dock when the music dock pushes the sidebar up/down. */
document.addEventListener('transitionend', e => {
  if (e.target && e.target.id === 'sidebar' && e.propertyName === 'top') {
    recomputeAnchorDock();
  }
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

/* Immediate input/output wires for each component — these get the constant
   "current toward ground" dashed flow when the component is selected. */
const componentLeadMap = {
  'cg-home':     ['w-vcc', 'w0'],
  'cg-about':    ['w0', 'w1'],
  'cg-music':    ['w1', 'w2', 'w-fb-up'],
  'cg-projects': ['w-fb-up', 'w3', 'w3b', 'w4'],
  'cg-shop':     ['w4', 'w5'],
  'cg-contact':  ['w5'],
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
  document.querySelectorAll('.wire').forEach(w => w.classList.remove('lit', 'flow'));
  document.querySelectorAll('.jct').forEach(j => j.classList.remove('lit'));
  // Use component wires for highlighting instead of section wires
  const wiresToLight = componentId ? (componentWireMap[componentId] || []) : (wireMap[section] || []);
  wiresToLight.forEach(id => {
    const el = document.getElementById(id); if(el) el.classList.add('lit');
  });
  const leadKey = componentId || ('cg-' + section);
  (componentLeadMap[leadKey] || []).forEach(id => {
    const el = document.getElementById(id); if(el) el.classList.add('flow');
  });
  /* Don't touch waveTarget here — the probe is still over the component the
     user just clicked, so its mouseenter-set waveform should stay visible
     until the probe actually moves off. The mouseleave handler will then
     restore sectionWaveMap[current] (= 'adder'). */
  current = section;
  if (window.innerWidth <= 780) document.getElementById('sidebar').classList.remove('open');

  /* Contact-page circuit interaction — show the SW₂ connector and excite
     the link panel when on contact, tear it down on exit. The 200ms delay
     lets the page transition (110ms) finish so the link panel's bounding
     rect is correct when we sample it. */
  if (section === 'contact') {
    setTimeout(() => {
      if (current !== 'contact') return;
      drawContactConnector();
      document.body.classList.add('contact-active');
      flipContactSwitch(true);
    }, 200);
  } else {
    clearContactConnector();
  }
}

document.getElementById('cg-home').classList.add('active');
componentLeadMap['cg-home'].forEach(id => {
  const el = document.getElementById(id); if (el) el.classList.add('flow');
});
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
  /* Tag the wrap with the project key so per-project styling can scope to it. */
  projDetailWrap.dataset.proj = card.dataset.proj || '';
  /* External links inside the freshly-injected detail open in a new tab. */
  applyExternalLinkTargets(projDetail);

  projPage.classList.add('project-expanded');

  window.scrollTo({ top: 0, behavior: 'smooth' });

  /* Redraw once any image in the detail finishes loading (page height may grow) */
  projDetail.querySelectorAll('img').forEach(img => {
    if (!img.complete) {
      img.addEventListener('load',  redrawIfOpen, { once: true });
      img.addEventListener('error', redrawIfOpen, { once: true });
    }
  });

  document.body.classList.add('proj-open');

  /* Wait until the slot card has finished its width transition before drawing
     the op-amp connector — otherwise the card is still 0-wide and the wire
     terminates at the sidebar's edge. Once drawn (lever open), close the
     switch so the load wire animates on and the card excites. */
  setTimeout(() => {
    drawOpampConnector();
    flipSwitch(true);
  }, 460);
}

function closeProject() {
  /* Animate switch → off first; let the schematic lever lift, then tear down. */
  flipSwitch(false);
  setTimeout(() => {
    projPage.classList.remove('project-expanded', 'power-on');
    document.body.classList.remove('proj-open', 'proj-power-on');
    projSlot.setAttribute('aria-hidden', 'true');
    projDetailWrap.setAttribute('aria-hidden', 'true');
    const oc = document.getElementById('opamp-connector');
    if (oc) oc.innerHTML = '';
    setTimeout(() => {
      if (!projPage.classList.contains('project-expanded')) {
        projSlot.innerHTML = '';
        projDetail.innerHTML = '';
        schemSvg.innerHTML = '';
        delete projDetailWrap.dataset.proj;
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
    document.body.classList.add('proj-power-on');
  } else {
    if (sw) { sw.classList.remove('on'); sw.setAttribute('aria-pressed', 'false'); }
    projPage.classList.remove('power-on');
    document.body.classList.remove('proj-power-on');
  }
  animatePhysicalLever(on ? 0 : 180);
  animateSchematicLever(on ? 0 : 180);
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

/* The old proj-schematic SVG (SW₁ + meta-grid c-wires) is no longer drawn.
   The op-amp connector now provides the entire visual: op-amp → switch → card. */
let leverRaf = null;
let leverCoords = null; // { hingeX, hingeY } — the inline switch hinge in viewport coords

function drawSchematic({ state = 'off' } = {}) {
  if (schemSvg) schemSvg.innerHTML = '';
}

/* Animate SW₁'s lever on the inline industrial switch. The lever group
   (#oc-lever-g) lives inside the embedded ps-svg whose viewBox is 100×100,
   so the rotation pivot (50, 55) is in inner-viewBox coords, not viewport
   coords. On = 0° (lever up / closed), Off = 180° (lever down / open). */
function animateSchematicLever(targetDeg) {
  const leverG = document.getElementById('oc-lever-g');
  if (!leverG) return;
  if (leverRaf) cancelAnimationFrame(leverRaf);
  const startDeg = parseFloat(leverG.dataset.deg || '180');
  const delta = targetDeg - startDeg;
  const dur = 450;
  const t0 = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - t0) / dur);
    const c = 1.4;
    const eased = 1 + c * Math.pow(t - 1, 3) + (c - 0.5) * Math.pow(t - 1, 2);
    const deg = startDeg + delta * (t < 1 ? eased : 1);
    leverG.setAttribute('transform', `rotate(${deg.toFixed(2)} 50 55)`);
    if (t < 1) leverRaf = requestAnimationFrame(tick);
    else {
      leverG.setAttribute('transform', `rotate(${targetDeg} 50 55)`);
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
  drawOpampConnector();
}

window.addEventListener('resize', redrawIfOpen);
window.addEventListener('scroll', () => {
  /* Op-amp & switch positions are viewport-relative — keep the connector aligned. */
  if (projPage.classList.contains('project-expanded')) drawOpampConnector();
}, { passive: true });
/* Sidebar slides down when the music dock opens/closes — re-anchor the wire. */
const sidebarEl = document.getElementById('sidebar');
if (sidebarEl) {
  sidebarEl.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'top' && projPage.classList.contains('project-expanded')) {
      drawOpampConnector();
    }
  });
}
projSlot.addEventListener('transitionend', (e) => {
  if (e.propertyName === 'width') redrawIfOpen();
});

/* Draws the cross-page wire from the op-amp output (sidebar) into the
   relocated project card, with the inline SW₁ industrial switch in line.
   Source side (op-amp → SW₁ left lug) is always live; load side
   (SW₁ right lug → card) only flows when SW₁ is closed. */
function drawOpampConnector() {
  const oc = document.getElementById('opamp-connector');
  if (!oc) return;
  if (!projPage.classList.contains('project-expanded')) {
    oc.innerHTML = '';
    leverCoords = null;
    return;
  }
  const opampLine = document.querySelector('#cg-music line[x1="130"]');
  const sidebarEl = document.getElementById('sidebar');
  const cardEl    = projSlot.querySelector('.proj-card');
  if (!opampLine || !sidebarEl || !cardEl) return;

  const ooBox = opampLine.getBoundingClientRect();
  const startX = ooBox.right;
  const startY = (ooBox.top + ooBox.bottom) / 2;

  const sidebarRect = sidebarEl.getBoundingClientRect();
  const exitX = sidebarRect.right + 16;

  /* Card terminal: middle of card's left edge. */
  const cardRect = cardEl.getBoundingClientRect();
  const cardX = cardRect.left;
  const cardY = cardRect.top + cardRect.height / 2;

  /* SW₁ — embedded industrial switch. Inner SVG viewBox is 100×100; the
     left lug center sits at (12, 46) and the right lug at (88, 46) in
     inner coords, so we translate that into viewport positions for the
     wire termination points and align the switch on the wire's y. */
  const SW_SIZE  = 64;
  const SW_SCALE = SW_SIZE / 100;
  const wireY     = cardY;
  const swCenterX = (exitX + cardX) / 2;
  const swTopX    = swCenterX - SW_SIZE / 2;
  /* Place vertically so the lugs (inner y=46) sit exactly on wireY. */
  const swTopY    = wireY - 46 * SW_SCALE;
  const lugY      = wireY;
  const leftLugX  = swTopX + 12 * SW_SCALE;
  const rightLugX = swTopX + 88 * SW_SCALE;
  leverCoords = { hingeX: swCenterX, hingeY: wireY };

  const W = window.innerWidth;
  const H = window.innerHeight;
  oc.setAttribute('viewBox', `0 0 ${W} ${H}`);
  oc.setAttribute('width', W);
  oc.setAttribute('height', H);

  const f = (n) => n.toFixed(1);
  /* Source-side (always live): op-amp out → exit → jog to wireY → SW₁ left lug */
  const dSrc = `M ${f(startX)} ${f(startY)} `
             + `L ${f(exitX)}  ${f(startY)} `
             + `L ${f(exitX)}  ${f(lugY)} `
             + `L ${f(leftLugX)} ${f(lugY)}`;
  /* Load-side (flows when on): SW₁ right lug → card terminal */
  const dLoad = `M ${f(rightLugX)} ${f(lugY)} L ${f(cardX)} ${f(lugY)}`;

  /* Build the structure once; subsequent draws only update attributes so
     the dashed flow animation doesn't restart on scroll/resize ticks. */
  let pathSrc = oc.querySelector('.oc-wire-src');
  if (!pathSrc) {
    oc.innerHTML = `
      <path class="oc-wire oc-wire-src" d="" />
      <path class="oc-wire oc-wire-load" d="" />
      <circle class="oc-tap oc-tap-start" r="3" />
      <circle class="oc-tap oc-tap-end"   r="3" />
      <text class="oc-label oc-label-src">U₁ OUT</text>
      <g class="oc-switch" role="button" aria-label="Toggle SW₁">
        <svg class="ps-embed" viewBox="0 0 100 100">
          <rect class="ps-lug" x="6"  y="42" width="12" height="8" rx="1"/>
          <circle class="ps-lug-hole" cx="12" cy="46" r="1.4"/>
          <rect class="ps-lug" x="6"  y="60" width="12" height="8" rx="1"/>
          <circle class="ps-lug-hole" cx="12" cy="64" r="1.4"/>
          <rect class="ps-lug" x="82" y="42" width="12" height="8" rx="1"/>
          <circle class="ps-lug-hole" cx="88" cy="46" r="1.4"/>
          <rect class="ps-lug" x="82" y="60" width="12" height="8" rx="1"/>
          <circle class="ps-lug-hole" cx="88" cy="64" r="1.4"/>
          <rect class="ps-body" x="18" y="40" width="64" height="30" rx="1.2"/>
          <path class="ps-gear" d="${SWITCH_GEAR_PATH}"/>
          <circle class="ps-hub-ring"   cx="50" cy="55" r="7.5"/>
          <circle class="ps-hub-center" cx="50" cy="55" r="2.2"/>
          <path class="ps-pointer" d="M46.8,65 L53.2,65 L52,71 L48,71 Z"/>
          <g id="oc-lever-g" class="ps-lever-group" transform="rotate(180 50 55)">
            <rect class="ps-lever" x="46.5" y="14" width="7" height="42" rx="3.5"/>
          </g>
        </svg>
        <rect class="oc-switch-hit" />
      </g>
      <text class="oc-label oc-label-sw">SW₁</text>
    `;
    pathSrc = oc.querySelector('.oc-wire-src');
    /* Initial lever angle reflects current power state (set once). */
    const leverG = oc.querySelector('#oc-lever-g');
    if (leverG) {
      const isOn = projPage.classList.contains('power-on');
      const deg = isOn ? 0 : 180;
      leverG.setAttribute('transform', `rotate(${deg} 50 55)`);
      leverG.dataset.deg = String(deg);
    }
  }

  pathSrc.setAttribute('d', dSrc);
  oc.querySelector('.oc-wire-load').setAttribute('d', dLoad);

  const tStart = oc.querySelector('.oc-tap-start');
  const tEnd   = oc.querySelector('.oc-tap-end');
  const labS   = oc.querySelector('.oc-label-src');
  const labW   = oc.querySelector('.oc-label-sw');
  if (tStart) { tStart.setAttribute('cx', f(startX)); tStart.setAttribute('cy', f(startY)); }
  if (tEnd)   { tEnd.setAttribute('cx', f(cardX));   tEnd.setAttribute('cy', f(lugY)); }
  if (labS)   { labS.setAttribute('x', f(exitX + 6)); labS.setAttribute('y', f(startY - 6)); }
  if (labW)   {
    labW.setAttribute('x', f(swCenterX));
    labW.setAttribute('y', f(swTopY + SW_SIZE + 12));
    labW.setAttribute('text-anchor', 'middle');
  }

  const psSvg = oc.querySelector('.ps-embed');
  if (psSvg) {
    psSvg.setAttribute('x', f(swTopX));
    psSvg.setAttribute('y', f(swTopY));
    psSvg.setAttribute('width',  SW_SIZE);
    psSvg.setAttribute('height', SW_SIZE);
  }
  const hit = oc.querySelector('.oc-switch-hit');
  if (hit) {
    hit.setAttribute('x', f(swTopX - 4));
    hit.setAttribute('y', f(swTopY - 4));
    hit.setAttribute('width',  f(SW_SIZE + 8));
    hit.setAttribute('height', f(SW_SIZE + 8));
  }
}

/* Click on SW₁ — opens the switch and returns to the projects grid.
   closeProject() flips the lever first (which removes body.proj-power-on, so
   the load-side wire's flow and the card's pulse both stop the instant the
   click registers), then tears down once the lever animation has played. */
(() => {
  const oc = document.getElementById('opamp-connector');
  if (!oc) return;
  oc.addEventListener('click', e => {
    if (!projPage || !projPage.classList.contains('project-expanded')) return;
    if (!e.target.closest('.oc-switch')) return;
    closeProject();
  });
})();

/* ── External-link new-tab policy ──
   Any anchor pointing to an external URL or a PDF asset opens in a new tab,
   so the visitor doesn't lose their place in the schematic. */
function applyExternalLinkTargets(scope) {
  const root = scope || document;
  root.querySelectorAll('a[href^="http"], a[href^="//"], a[href$=".pdf"]')
    .forEach(a => {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    });
}
applyExternalLinkTargets();

/* ══════════════════════════════════════
   CONTACT CONNECTOR — circuit interaction on the contact page
   Draws a wire from R_f's output (the "Contact" component in the nav)
   into the contact-links panel, with an inline industrial switch (SW₂).
   Clicking SW₂ toggles power; the load wire's flow + link excitation track
   the body.contact-power-on class, mirroring the SW₁ pattern. */

let contactLeverRaf = null;

function drawContactConnector() {
  const cc = document.getElementById('contact-connector');
  if (!cc) return;
  if (current !== 'contact') {
    cc.innerHTML = '';
    return;
  }
  const navSvg    = document.getElementById('nav-svg');
  const sidebarEl = document.getElementById('sidebar');
  const linksEl   = document.querySelector('#pg-contact .contact-links');
  if (!navSvg || !sidebarEl || !linksEl) return;

  /* Source = R_f output at viewBox (168, 305) — convert via the SVG's CTM. */
  const m = navSvg.getScreenCTM();
  if (!m) return;
  const pt = navSvg.createSVGPoint();
  pt.x = 168; pt.y = 305;
  const src = pt.matrixTransform(m);
  const startX = src.x;
  const startY = src.y;

  const sidebarRect = sidebarEl.getBoundingClientRect();
  const exitX = sidebarRect.right + 16;

  const linksRect = linksEl.getBoundingClientRect();
  /* Land on the left edge of the contact panel near the top */
  const destX = linksRect.left;
  const destY = linksRect.top + 24;

  /* Industrial switch placed midway between sidebar exit and panel edge.
     Same 64px size + lug positions as SW₁ — wire enters left lug, exits
     right lug at the same y. */
  const SW_SIZE  = 64;
  const SW_SCALE = SW_SIZE / 100;
  const wireY     = destY;
  const swCenterX = (exitX + destX) / 2;
  const swTopX    = swCenterX - SW_SIZE / 2;
  const swTopY    = wireY - 46 * SW_SCALE;
  const lugY      = wireY;
  const leftLugX  = swTopX + 12 * SW_SCALE;
  const rightLugX = swTopX + 88 * SW_SCALE;

  const W = window.innerWidth;
  const H = window.innerHeight;
  cc.setAttribute('viewBox', `0 0 ${W} ${H}`);
  cc.setAttribute('width', W);
  cc.setAttribute('height', H);

  const f = (n) => n.toFixed(1);
  const dSrc = `M ${f(startX)} ${f(startY)} `
             + `L ${f(exitX)}  ${f(startY)} `
             + `L ${f(exitX)}  ${f(lugY)} `
             + `L ${f(leftLugX)} ${f(lugY)}`;
  const dLoad = `M ${f(rightLugX)} ${f(lugY)} L ${f(destX)} ${f(lugY)}`;

  /* Build the structure once; subsequent draws update attributes only. */
  let pathSrc = cc.querySelector('.oc-wire-src');
  if (!pathSrc) {
    cc.innerHTML = `
      <path class="oc-wire oc-wire-src" d="" />
      <path class="oc-wire oc-wire-load" d="" />
      <circle class="oc-tap oc-tap-start" r="3" />
      <circle class="oc-tap oc-tap-end"   r="3" />
      <text class="oc-label oc-label-src">R_f OUT</text>
      <g class="oc-switch" role="button" aria-label="Toggle SW₂">
        <svg class="ps-embed" viewBox="0 0 100 100">
          <rect class="ps-lug" x="6"  y="42" width="12" height="8" rx="1"/>
          <circle class="ps-lug-hole" cx="12" cy="46" r="1.4"/>
          <rect class="ps-lug" x="6"  y="60" width="12" height="8" rx="1"/>
          <circle class="ps-lug-hole" cx="12" cy="64" r="1.4"/>
          <rect class="ps-lug" x="82" y="42" width="12" height="8" rx="1"/>
          <circle class="ps-lug-hole" cx="88" cy="46" r="1.4"/>
          <rect class="ps-lug" x="82" y="60" width="12" height="8" rx="1"/>
          <circle class="ps-lug-hole" cx="88" cy="64" r="1.4"/>
          <rect class="ps-body" x="18" y="40" width="64" height="30" rx="1.2"/>
          <path class="ps-gear" d="${SWITCH_GEAR_PATH}"/>
          <circle class="ps-hub-ring"   cx="50" cy="55" r="7.5"/>
          <circle class="ps-hub-center" cx="50" cy="55" r="2.2"/>
          <path class="ps-pointer" d="M46.8,65 L53.2,65 L52,71 L48,71 Z"/>
          <g id="cc-lever-g" class="ps-lever-group" transform="rotate(180 50 55)">
            <rect class="ps-lever" x="46.5" y="14" width="7" height="42" rx="3.5"/>
          </g>
        </svg>
        <rect class="oc-switch-hit" />
      </g>
      <text class="oc-label oc-label-sw">SW₂</text>
    `;
    pathSrc = cc.querySelector('.oc-wire-src');
    const lever = cc.querySelector('#cc-lever-g');
    if (lever) {
      const isOn = document.body.classList.contains('contact-power-on');
      const deg = isOn ? 0 : 180;
      lever.setAttribute('transform', `rotate(${deg} 50 55)`);
      lever.dataset.deg = String(deg);
    }
  }

  pathSrc.setAttribute('d', dSrc);
  cc.querySelector('.oc-wire-load').setAttribute('d', dLoad);

  const tStart = cc.querySelector('.oc-tap-start');
  const tEnd   = cc.querySelector('.oc-tap-end');
  const labS   = cc.querySelector('.oc-label-src');
  const labW   = cc.querySelector('.oc-label-sw');
  if (tStart) { tStart.setAttribute('cx', f(startX)); tStart.setAttribute('cy', f(startY)); }
  if (tEnd)   { tEnd.setAttribute('cx', f(destX));   tEnd.setAttribute('cy', f(lugY)); }
  if (labS)   { labS.setAttribute('x', f(exitX + 6)); labS.setAttribute('y', f(startY - 6)); }
  if (labW)   {
    labW.setAttribute('x', f(swCenterX));
    labW.setAttribute('y', f(swTopY + SW_SIZE + 12));
    labW.setAttribute('text-anchor', 'middle');
  }

  const psSvg = cc.querySelector('.ps-embed');
  if (psSvg) {
    psSvg.setAttribute('x', f(swTopX));
    psSvg.setAttribute('y', f(swTopY));
    psSvg.setAttribute('width',  SW_SIZE);
    psSvg.setAttribute('height', SW_SIZE);
  }
  const hit = cc.querySelector('.oc-switch-hit');
  if (hit) {
    hit.setAttribute('x', f(swTopX - 4));
    hit.setAttribute('y', f(swTopY - 4));
    hit.setAttribute('width',  f(SW_SIZE + 8));
    hit.setAttribute('height', f(SW_SIZE + 8));
  }
}

function clearContactConnector() {
  const cc = document.getElementById('contact-connector');
  if (cc) cc.innerHTML = '';
  document.body.classList.remove('contact-active', 'contact-power-on');
}

function flipContactSwitch(on) {
  document.body.classList.toggle('contact-power-on', on);
  const lever = document.getElementById('cc-lever-g');
  if (!lever) return;
  if (contactLeverRaf) cancelAnimationFrame(contactLeverRaf);
  const startDeg = parseFloat(lever.dataset.deg || '180');
  const targetDeg = on ? 0 : 180;
  const delta = targetDeg - startDeg;
  const dur = 450;
  const t0 = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - t0) / dur);
    const c = 1.4;
    const eased = 1 + c * Math.pow(t - 1, 3) + (c - 0.5) * Math.pow(t - 1, 2);
    const deg = startDeg + delta * (t < 1 ? eased : 1);
    lever.setAttribute('transform', `rotate(${deg.toFixed(2)} 50 55)`);
    if (t < 1) contactLeverRaf = requestAnimationFrame(tick);
    else {
      lever.setAttribute('transform', `rotate(${targetDeg} 50 55)`);
      lever.dataset.deg = String(targetDeg);
      contactLeverRaf = null;
    }
  }
  contactLeverRaf = requestAnimationFrame(tick);
}

/* Click on SW₂ — toggle the contact panel's power. */
(() => {
  const cc = document.getElementById('contact-connector');
  if (!cc) return;
  cc.addEventListener('click', e => {
    if (current !== 'contact') return;
    if (!e.target.closest('.oc-switch')) return;
    flipContactSwitch(!document.body.classList.contains('contact-power-on'));
  });
})();

/* Redraw the contact connector on viewport / sidebar shifts. */
window.addEventListener('resize', () => { if (current === 'contact') drawContactConnector(); });
window.addEventListener('scroll', () => { if (current === 'contact') drawContactConnector(); }, { passive: true });
const _sidebarForContact = document.getElementById('sidebar');
if (_sidebarForContact) {
  _sidebarForContact.addEventListener('transitionend', e => {
    if (e.propertyName === 'top' && current === 'contact') drawContactConnector();
  });
}

/* ══════════════════════════════════════
   WIREFRAME REACTOR (v2) — music-page Three.js visualizer
   Cream-themed analog chassis with side control panel: SVG-built radial
   shape selector, continuous knobs (flow, morph, zoom, speed), and
   toggle switches (auto-spin, rings). The
   Three.js scene mirrors the stand-alone v2 design from
   assets/claude_design_projects/music_wireframe_reactor_v2.htm — adapted
   to draw audio from the existing vizAnalyser tap so it tracks whatever
   the track-list player is playing. Mic/file/demo source controls and
   the gyroid (ParametricGeometry, removed in three r150+) shape are
   omitted; everything else is wired up. */
(() => {
  if (typeof THREE === 'undefined') return;
  const container = document.getElementById('music-viz');
  const canvasHost = document.getElementById('rr-canvas-host');
  const canvasWrap = document.getElementById('rr-canvas-wrap');
  if (!container || !canvasHost || !canvasWrap) return;

  const W = () => canvasWrap.clientWidth || 1;
  const H = () => canvasWrap.clientHeight || 1;

  /* ── SVG widget builders ─────────────────────────────────────────── */
  const NS = 'http://www.w3.org/2000/svg';
  const _svg = (tag, attrs) => {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  };
  const _circle = (cx, cy, r, a) => _svg('circle', Object.assign({ cx, cy, r }, a));
  const _line   = (x1, y1, x2, y2, a) => _svg('line', Object.assign({ x1, y1, x2, y2 }, a));
  const _path   = (d, a) => _svg('path', Object.assign({ d }, a));
  const _text   = (x, y, txt, a) => { const el = _svg('text', Object.assign({ x, y }, a)); el.textContent = txt; return el; };

  const COL_GOLD  = '#C8A84B';
  const COL_GOLDD = '#A8893A';
  const COL_GOLDB = '#E5C76B';
  const COL_CRM4  = '#D0C4A8';
  const COL_INK4  = '#A89878';

  /* Radial selector — items arranged in an arc with a rotating needle. */
  function buildRadialSelector({ svg, items, initialIdx, arcDeg, radius, onChange }) {
    const N = items.length;
    const A0 = -(arcDeg / 2);
    const A1 =  (arcDeg / 2);

    svg.appendChild(_circle(0, 0, 30, { fill:'none', stroke:COL_GOLDD, 'stroke-width':1, opacity:0.45 }));
    svg.appendChild(_circle(0, 0, 5,  { fill:'none', stroke:COL_GOLDD, 'stroke-width':1.2, opacity:0.7 }));
    svg.appendChild(_circle(0, 0, 2,  { fill:COL_GOLDD, opacity:0.8 }));

    for (let i = 0; i < N; i++) {
      const t = N === 1 ? 0.5 : i / (N - 1);
      const a = (A0 + t * (A1 - A0) - 90) * Math.PI / 180;
      svg.appendChild(_line(26 * Math.cos(a), 26 * Math.sin(a),
                            32 * Math.cos(a), 32 * Math.sin(a),
                            { stroke:COL_GOLDD, 'stroke-width':1, opacity:0.4 }));
    }

    const labelEls = [];
    for (let i = 0; i < N; i++) {
      const t = N === 1 ? 0.5 : i / (N - 1);
      const a = (A0 + t * (A1 - A0) - 90) * Math.PI / 180;
      const lx = radius * Math.cos(a);
      const ly = radius * Math.sin(a);
      const txt = _text(lx, ly + 3, items[i].label, {
        'font-family':"'JetBrains Mono', monospace",
        'font-size':'8',
        'font-weight':'500',
        'letter-spacing':'.04em',
        'text-anchor':'middle',
        'dominant-baseline':'middle',
        fill: '#4A3F28', opacity:1,
        style:'text-transform:uppercase;'
      });
      svg.appendChild(txt);
      labelEls.push(txt);
    }

    const needle = _svg('g', {});
    needle.appendChild(_line(0, -8, 0, -25, { stroke:COL_GOLD, 'stroke-width':1.5, 'stroke-linecap':'round' }));
    needle.appendChild(_path('M0,-27 L-2.5,-22 L2.5,-22 Z', { fill:COL_GOLD, opacity:0.9 }));
    svg.appendChild(needle);

    let idx = initialIdx;
    function setIdx(i) {
      i = Math.max(0, Math.min(N - 1, i));
      idx = i;
      const t = N === 1 ? 0.5 : i / (N - 1);
      const angle = A0 + t * (A1 - A0);
      needle.setAttribute('transform', `rotate(${angle})`);
      labelEls.forEach((el, j) => {
        if (j === i) { el.setAttribute('fill', COL_GOLD);  el.setAttribute('opacity', 1); el.setAttribute('font-weight', 600); }
        else         { el.setAttribute('fill', '#4A3F28'); el.setAttribute('opacity', 1); el.setAttribute('font-weight', 500); }
      });
      onChange(items[i], i);
    }
    setIdx(initialIdx);

    svg.addEventListener('click', e => {
      const r = svg.getBoundingClientRect();
      const vb = svg.viewBox.baseVal;
      const sx = vb.width / r.width, sy = vb.height / r.height;
      const mx = (e.clientX - r.left) * sx + vb.x;
      const my = (e.clientY - r.top)  * sy + vb.y;
      let best = idx, bd = Infinity;
      for (let i = 0; i < N; i++) {
        const t = N === 1 ? 0.5 : i / (N - 1);
        const a = (A0 + t * (A1 - A0) - 90) * Math.PI / 180;
        const lx = radius * Math.cos(a), ly = radius * Math.sin(a);
        const d = Math.hypot(mx - lx, my - ly);
        if (d < bd) { bd = d; best = i; }
      }
      if (bd < 30) setIdx(best);
    });
    svg.addEventListener('wheel', e => { e.preventDefault(); setIdx(idx + (e.deltaY > 0 ? 1 : -1)); }, { passive: false });
    let drag = null;
    svg.addEventListener('pointerdown', e => { drag = { y: e.clientY, idx }; svg.setPointerCapture(e.pointerId); });
    svg.addEventListener('pointermove', e => { if (!drag) return; setIdx(drag.idx + Math.round((drag.y - e.clientY) / 18)); });
    svg.addEventListener('pointerup',   () => { drag = null; });

    return { setIdx, get idx() { return idx; } };
  }

  /* Continuous knob — serrated rim, fill arc, draggable / scrollable. */
  function buildContKnob({ svg, initialVal, onVal }) {
    const TEETH = 28, R_O = 28, R_I = 25;
    const teeth = [];
    for (let i = 0; i < TEETH * 2; i++) {
      const a = (i / (TEETH * 2)) * Math.PI * 2;
      const r = i % 2 === 0 ? R_O : R_I;
      teeth.push(`${i === 0 ? 'M' : 'L'}${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`);
    }
    teeth.push('Z');
    svg.appendChild(_path(teeth.join(' '), { fill:'none', stroke:COL_GOLDD, 'stroke-width':1, opacity:0.5 }));
    svg.appendChild(_circle(0, 0, 20, { fill:'none', stroke:COL_GOLDD, 'stroke-width':1, opacity:0.6 }));
    svg.appendChild(_circle(0, 0, 4,  { fill:'none', stroke:COL_GOLDD, 'stroke-width':1, opacity:0.7 }));
    svg.appendChild(_circle(0, 0, 1.5,{ fill:COL_GOLDD, opacity:0.8 }));

    const A0 = -135, A1 = 135, R_ARC = 14;
    function arcPath(start, end) {
      const s = (start - 90) * Math.PI / 180;
      const e = (end   - 90) * Math.PI / 180;
      const x1 = R_ARC * Math.cos(s), y1 = R_ARC * Math.sin(s);
      const x2 = R_ARC * Math.cos(e), y2 = R_ARC * Math.sin(e);
      const big = end - start > 180 ? 1 : 0;
      return `M${x1.toFixed(2)},${y1.toFixed(2)} A${R_ARC},${R_ARC},0,${big},1,${x2.toFixed(2)},${y2.toFixed(2)}`;
    }
    svg.appendChild(_path(arcPath(A0, A1), { fill:'none', stroke:COL_CRM4, 'stroke-width':2.5, 'stroke-linecap':'round', opacity:0.6 }));
    const fillArc = _path('', { fill:'none', stroke:COL_GOLD, 'stroke-width':2.5, 'stroke-linecap':'round', opacity:0.8 });
    svg.appendChild(fillArc);

    const needle = _svg('g', {});
    needle.appendChild(_line(0, -6, 0, -16, { stroke:COL_GOLD, 'stroke-width':1.5, 'stroke-linecap':'round' }));
    svg.appendChild(needle);

    let val = initialVal;
    function setVal(v) {
      val = Math.max(0, Math.min(1, v));
      const a = A0 + val * (A1 - A0);
      needle.setAttribute('transform', `rotate(${a})`);
      fillArc.setAttribute('d', val > 0.01 ? arcPath(A0, a) : '');
      onVal(val);
    }
    setVal(initialVal);

    let drag = null;
    svg.addEventListener('pointerdown', e => { drag = { y: e.clientY, val }; svg.setPointerCapture(e.pointerId); });
    svg.addEventListener('pointermove', e => { if (!drag) return; setVal(drag.val + (drag.y - e.clientY) / 130); });
    svg.addEventListener('pointerup',   () => { drag = null; });
    svg.addEventListener('wheel', e => { e.preventDefault(); setVal(val - (e.deltaY > 0 ? 0.05 : -0.05)); }, { passive: false });
    return { setVal, get val() { return val; } };
  }

  /* Toggle switch — flat housing + lever that rotates between 1/0. */
  function buildToggleSwitch({ svg, initialOn, onChange }) {
    [-26, 16].forEach(x => {
      [-10, 2].forEach(y => svg.appendChild(_svg('rect', { x, y, width:10, height:8, rx:1, fill:'none', stroke:COL_GOLDD, 'stroke-width':1, opacity:0.55 })));
    });
    [[-21,-6],[-21,6],[21,-6],[21,6]].forEach(([cx, cy]) => svg.appendChild(_circle(cx, cy, 1.5, { fill:'none', stroke:COL_GOLDD, 'stroke-width':1, opacity:0.45 })));
    svg.appendChild(_svg('rect', { x:-16, y:-14, width:32, height:28, rx:2, fill:'none', stroke:COL_GOLDD, 'stroke-width':1.2, opacity:0.7 }));
    svg.appendChild(_line(-16, 0, 16, 0, { stroke:COL_GOLDD, 'stroke-width':0.7, opacity:0.3 }));

    const GTEETH = 22, GR_O = 10, GR_I = 8;
    const gp = [];
    for (let i = 0; i < GTEETH * 2; i++) {
      const a = (i / (GTEETH * 2)) * Math.PI * 2;
      const r = i % 2 === 0 ? GR_O : GR_I;
      gp.push(`${i === 0 ? 'M' : 'L'}${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`);
    }
    gp.push('Z');
    svg.appendChild(_path(gp.join(' '), { fill:'none', stroke:COL_GOLDD, 'stroke-width':1, opacity:0.55 }));
    svg.appendChild(_circle(0, 0, 5.5, { fill:'none', stroke:COL_GOLDD, 'stroke-width':1, opacity:0.7 }));
    svg.appendChild(_circle(0, 0, 2,   { fill:'none', stroke:COL_GOLDD, 'stroke-width':1.2, opacity:0.8 }));

    const handle = _svg('g', {});
    handle.appendChild(_path('M-3,0 L-2.5,-22 Q0,-27 2.5,-22 L3,0 Z',
      { fill:'none', stroke:COL_GOLD, 'stroke-width':1.2, 'stroke-linejoin':'round', opacity:0.85 }));
    handle.appendChild(_svg('ellipse', { cx:0, cy:-24, rx:4, ry:5, fill:'none', stroke:COL_GOLD, 'stroke-width':1.2, opacity:0.85 }));
    handle.appendChild(_line(-2, -12, 2, -12, { stroke:COL_GOLD, 'stroke-width':0.8, opacity:0.6 }));
    handle.appendChild(_line(-2, -16, 2, -16, { stroke:COL_GOLD, 'stroke-width':0.8, opacity:0.6 }));
    svg.appendChild(handle);

    svg.appendChild(_text(-9, -22, '1', { 'font-family':"'JetBrains Mono', monospace", 'font-size':'8', 'font-weight':'600', fill:COL_GOLDD, opacity:0.75, 'text-anchor':'middle' }));
    svg.appendChild(_text( 9, -22, '0', { 'font-family':"'JetBrains Mono', monospace", 'font-size':'8', 'font-weight':'600', fill:COL_GOLDD, opacity:0.75, 'text-anchor':'middle' }));

    let on = initialOn;
    function setOn(v) {
      on = v;
      handle.setAttribute('transform', `rotate(${on ? -28 : 28})`);
      const stroke = on ? COL_GOLDB : COL_GOLD;
      handle.querySelectorAll('*').forEach(el => { if (el.getAttribute('stroke') !== null) el.setAttribute('stroke', stroke); });
      onChange(on);
    }
    setOn(initialOn);
    svg.addEventListener('click', () => setOn(!on));
    return { setOn, get on() { return on; } };
  }

  /* ── Three.js scene ──────────────────────────────────────────────── */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0xF4EFE4, 0);
  renderer.setSize(W(), H(), false);
  canvasHost.appendChild(renderer.domElement);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, W() / H(), 0.1, 100);
  camera.position.set(0, 0, 3.4);

  const TC = {
    gold:  new THREE.Color(0xC8A84B),
    goldB: new THREE.Color(0xE5C76B),
    goldD: new THREE.Color(0xA8893A),
  };

  /* Shapes — gyroid omitted (ParametricGeometry not in three core r150+). */
  const SHAPES = [
    { id:'icosphere',  label:'icosphere',  short:'ICO', make:() => new THREE.IcosahedronGeometry(1, 5) },
    { id:'torus-knot', label:'torus knot', short:'TKN', make:() => new THREE.TorusKnotGeometry(0.7, 0.26, 180, 20, 2, 3) },
    { id:'torus',      label:'torus',      short:'TOR', make:() => new THREE.TorusGeometry(0.82, 0.38, 28, 80) },
    { id:'octahedron', label:'octahedron', short:'OCT', make:() => new THREE.OctahedronGeometry(1.1, 3) },
    { id:'cube',       label:'cube',       short:'BOX', make:() => new THREE.BoxGeometry(1.4, 1.4, 1.4, 14, 14, 14) },
    { id:'cylinder',   label:'cylinder',   short:'CYL', make:() => new THREE.CylinderGeometry(0.7, 0.7, 1.6, 48, 14, true) },
    { id:'cone',       label:'cone',       short:'CON', make:() => new THREE.ConeGeometry(0.9, 1.8, 48, 14, true) },
  ];
  const ROT_SPEEDS = [
    { id:'still',  label:'still',  speed:0    },
    { id:'slow',   label:'slow',   speed:0.3  },
    { id:'medium', label:'medium', speed:1.0  },
    { id:'fast',   label:'fast',   speed:2.2  },
    { id:'frenzy', label:'frenzy', speed:5.0  },
  ];

  const meshGroup = new THREE.Group();
  scene.add(meshGroup);
  let basePositions = null;
  let wireMat = null, edgeMat = null, solidMat = null;
  let wireMesh = null, edgeMesh = null, solidMesh = null;

  function buildMesh(shapeId) {
    while (meshGroup.children.length) meshGroup.remove(meshGroup.children[0]);
    const def = SHAPES.find(s => s.id === shapeId) || SHAPES[0];
    const geo = def.make();
    basePositions = Float32Array.from(geo.attributes.position.array);

    solidMat = new THREE.MeshBasicMaterial({ color: 0xEDE5D4, transparent: true, opacity: 0.28, side: THREE.FrontSide });
    solidMesh = new THREE.Mesh(geo, solidMat);

    wireMat = new THREE.MeshBasicMaterial({ color: TC.goldD, wireframe: true, transparent: true, opacity: 0.50 });
    wireMesh = new THREE.Mesh(geo, wireMat);

    const eg = new THREE.EdgesGeometry(geo, 18);
    edgeMat = new THREE.LineBasicMaterial({ color: TC.gold, transparent: true, opacity: 0.18 });
    edgeMesh = new THREE.LineSegments(eg, edgeMat);

    meshGroup.add(solidMesh, wireMesh, edgeMesh);
    const ro = document.getElementById('rr-readout-shape');
    if (ro) ro.textContent = def.short;
  }
  buildMesh('icosphere');

  /* Particle field */
  const PC = 280;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(PC * 3);
  const pSeeds = new Float32Array(PC * 3);
  for (let i = 0; i < PC; i++) {
    const r = 1.9 + Math.random() * 1.4;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pPos[i*3]   = r * Math.sin(ph) * Math.cos(th);
    pPos[i*3+1] = r * Math.sin(ph) * Math.sin(th);
    pPos[i*3+2] = r * Math.cos(ph);
    pSeeds[i*3]   = Math.random() * Math.PI * 2;
    pSeeds[i*3+1] = Math.random() * Math.PI * 2;
    pSeeds[i*3+2] = 0.25 + Math.random() * 0.75;
  }
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const pMat = new THREE.PointsMaterial({ color: TC.goldD, size: 0.013, transparent: true, opacity: 0.28, sizeAttenuation: true });
  scene.add(new THREE.Points(pGeo, pMat));

  /* Rings */
  const ringsGroup = new THREE.Group();
  scene.add(ringsGroup);
  const _ring = (r, tube, op) => new THREE.Mesh(
    new THREE.TorusGeometry(r, tube, 4, 90),
    new THREE.MeshBasicMaterial({ color: TC.goldD, transparent: true, opacity: op })
  );
  const ring1 = _ring(1.72, 0.003, 0.18);
  const ring2 = _ring(2.00, 0.002, 0.12);
  const ring3 = _ring(2.30, 0.002, 0.07);
  ring1.rotation.x = Math.PI / 3.2;
  ring2.rotation.y = Math.PI / 4.1;
  ring3.rotation.z = Math.PI / 5.3;
  ringsGroup.add(ring1, ring2, ring3);

  /* Subtle axes */
  [[-3,0,0,3,0,0], [0,-3,0,0,3,0]].forEach(([ax,ay,az,bx,by,bz]) => {
    scene.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(ax,ay,az), new THREE.Vector3(bx,by,bz)]),
      new THREE.LineBasicMaterial({ color: TC.goldD, transparent: true, opacity: 0.06 })
    ));
  });

  /* ── Audio data: pull from the vizAnalyser tap on the playing track. ── */
  function getFreqData() {
    if (vizAnalyser && currentAudio && !currentAudio.paused) {
      const buf = new Uint8Array(vizAnalyser.frequencyBinCount);
      vizAnalyser.getByteFrequencyData(buf);
      return buf;
    }
    return new Uint8Array(512);
  }
  function avg(a, x, y) { let s = 0; for (let i = x; i < y; i++) s += a[i]; return s / Math.max(1, y - x); }
  function getMetrics(d) {
    const L = d.length;
    return {
      bass:    Math.pow(avg(d, 0,                Math.floor(L * 0.06)) / 255, 0.55),
      sub:     Math.pow(avg(d, 0,                Math.floor(L * 0.02)) / 255, 0.50),
      mid:     Math.pow(avg(d, Math.floor(L*0.06), Math.floor(L * 0.40)) / 255, 0.65),
      hi:      Math.pow(avg(d, Math.floor(L*0.40), L) / 255, 0.75),
      overall: Math.pow(avg(d, 0,                L) / 255, 0.60),
    };
  }
  /* ── Morph: smooth large-scale bend + audio-driven flow + twist ── */
  let breathT = 0;
  function morphGeometry(m, t) {
    if (!wireMesh || !basePositions) return;
    const pos = wireMesh.geometry.attributes.position;
    const base = basePositions;
    const n = pos.count;

    const ma = morphAmt;
    const fl = flow;
    const breath = Math.sin(breathT * 0.55) * 0.04 * ma + 1.0;
    const bassScale = 1.0 + m.bass * 0.10;
    const subKick   = 1.0 + m.sub  * 0.07;
    const wAmp = ma * 0.055;

    /* Long-wavelength flow lobes — bend the whole body smoothly instead
       of pushing per-vertex spikes. Amplitude rises with the flow knob
       and overall audio energy. */
    const flAmp = fl * 0.32 * (0.30 + m.overall * 0.95);
    const flT  = t * 0.45;
    /* Twist: rotate xy-slices around z based on z-coord, slow swaying. */
    const twistAng = fl * (0.55 + m.bass * 1.4) * Math.sin(t * 0.6);
    const doTwist = twistAng !== 0;

    for (let i = 0; i < n; i++) {
      const bx = base[i*3], by = base[i*3+1], bz = base[i*3+2];
      const len = Math.sqrt(bx*bx + by*by + bz*bz) || 1;
      const nx = bx/len, ny = by/len, nz = bz/len;

      const wave =
        Math.sin(nx * 4.2 + t * 1.0 + m.bass * 2.4) * wAmp +
        Math.sin(ny * 3.8 - t * 0.8 + m.mid  * 2.0) * wAmp * 0.85 +
        Math.sin(nz * 5.5 + t * 1.3)                * wAmp * 0.65 +
        Math.sin((nx + ny) * 5.8 + t * 0.6)         * m.mid * 0.08 * ma +
        Math.sin((ny + nz) * 7.4 - t * 1.8)         * m.hi  * 0.05 * ma;

      const flowBend =
        Math.sin(nx * 1.3 + flT        + m.bass    * 1.8) * 0.20 +
        Math.sin(ny * 1.0 - flT * 0.75 + m.mid     * 1.3) * 0.16 +
        Math.sin(nz * 0.85 + flT * 0.55 + m.overall * 1.0) * 0.13 +
        Math.sin((nx + nz) * 0.7 + flT * 0.9)              * 0.10;
      const flowDisp = flowBend * flAmp;

      const scale = breath * bassScale * subKick + wave + flowDisp;
      let x = bx * scale, y = by * scale, z = bz * scale;

      if (doTwist) {
        const a = twistAng * bz;
        const c = Math.cos(a), s = Math.sin(a);
        const xn = x * c - y * s;
        const yn = x * s + y * c;
        x = xn; y = yn;
      }

      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
    if (solidMesh && solidMesh.geometry.attributes.position) {
      const sp = solidMesh.geometry.attributes.position;
      for (let i = 0; i < Math.min(sp.count, n); i++) sp.setXYZ(i, pos.getX(i), pos.getY(i), pos.getZ(i));
      sp.needsUpdate = true;
    }
  }

  /* ── Resize keyed off the canvas wrap ── */
  let lastW = 0, lastH = 0;
  function checkResize() {
    const w = W(), h = H();
    if (w === lastW && h === lastH) return;
    if (w === 0 || h === 0) return;
    lastW = w; lastH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  if (window.ResizeObserver) new ResizeObserver(checkResize).observe(canvasWrap);
  window.addEventListener('resize', checkResize);

  /* ── Control wiring ── */
  let flow = 0.5, morphAmt = 0.75, zoomVal = 0.5;
  let rotSpeed   = 1.0, autoSpin = true,  showRings = true;

  buildRadialSelector({
    svg: document.getElementById('rp-shape-sel'),
    items: SHAPES, initialIdx: 0, arcDeg: 300, radius: 62,
    onChange: (s) => buildMesh(s.id),
  });
  buildContKnob({ svg: document.getElementById('rp-ck-flow'),  initialVal: 0.5,  onVal: v => { flow = v; } });
  buildContKnob({ svg: document.getElementById('rp-ck-morph'), initialVal: 0.75, onVal: v => { morphAmt = v; } });
  buildContKnob({ svg: document.getElementById('rp-ck-zoom'),  initialVal: 0.5,  onVal: v => {
    zoomVal = v;
    camera.position.z = 2.0 + (1 - v) * 3.5;
  }});
  /* "Speed" knob replaces the rotation radial — knob value 0..1 mapped to
     the 5-step speed table so still / slow / med / fast / frenzy still
     map to the original rotSpeed values. */
  buildContKnob({ svg: document.getElementById('rp-ck-spd'), initialVal: 0.5, onVal: v => {
    const idx = Math.min(ROT_SPEEDS.length - 1, Math.floor(v * ROT_SPEEDS.length));
    rotSpeed = ROT_SPEEDS[idx].speed;
  }});
  buildToggleSwitch({ svg: document.getElementById('rp-tg-spin'),  initialOn: true, onChange: v => { autoSpin = v; } });
  buildToggleSwitch({ svg: document.getElementById('rp-tg-rings'), initialOn: true, onChange: v => { showRings = v; ringsGroup.visible = v; } });

  /* ── Status / readout helpers ── */
  const statusDot   = document.getElementById('rr-status-dot');
  const statusText  = document.getElementById('rr-status-text');
  const trackDisp   = document.getElementById('rr-track-display');
  const fpsRead     = document.getElementById('rr-fps');
  const timeRead    = document.getElementById('rr-time');
  function syncReadouts() {
    const live = !!(currentAudio && !currentAudio.paused);
    if (statusDot)  statusDot.classList.toggle('live', live);
    if (statusText) statusText.textContent = live ? 'live' : 'idle';
    if (trackDisp) {
      if (live && currentIdx >= 0 && TRACKS[currentIdx]) {
        const t = TRACKS[currentIdx].title;
        trackDisp.textContent = t.length > 22 ? t.slice(0, 20) + '…' : t;
      } else {
        trackDisp.textContent = 'no source';
      }
    }
    if (timeRead) {
      if (live && !isNaN(currentAudio.currentTime)) {
        const s = Math.floor(currentAudio.currentTime);
        timeRead.textContent =
          String(Math.floor(s / 60)).padStart(2, '0') + ':' +
          String(s % 60).padStart(2, '0');
      } else {
        timeRead.textContent = '00:00';
      }
    }
  }

  /* ── Mouse parallax ── */
  const mouseR = { x: 0, y: 0 };
  document.addEventListener('mousemove', e => {
    mouseR.x = (e.clientX / window.innerWidth - 0.5) * 2;
    mouseR.y = -(e.clientY / window.innerHeight - 0.5) * 2;
  });

  /* ── Main loop ── */
  const clock = new THREE.Clock();
  let frameT = 0;
  let sBass = 0, sMid = 0, sHi = 0, sAll = 0, sSub = 0;
  const fpsSamples = []; let lastFps = 0;

  function tick() {
    requestAnimationFrame(tick);
    /* Pause the heavy work while not on the music page. */
    if (current !== 'music') return;

    const dt = Math.min(clock.getDelta(), 0.05);
    frameT  += dt;
    breathT += dt;
    fpsSamples.push(1 / dt);
    if (fpsSamples.length > 30) fpsSamples.shift();
    if (frameT - lastFps > 0.5) {
      if (fpsRead) fpsRead.textContent =
        Math.round(fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length) + ' fps';
      lastFps = frameT;
    }

    const data = getFreqData();
    const m = getMetrics(data);
    const sp = 0.18;
    sBass += (m.bass    - sBass) * sp;
    sMid  += (m.mid     - sMid)  * sp;
    sHi   += (m.hi      - sHi)   * sp;
    sAll  += (m.overall - sAll)  * sp;
    sSub  += (m.sub     - sSub)  * (sp * 1.4);
    const sm = { bass: sBass, mid: sMid, hi: sHi, overall: sAll, sub: sSub };

    morphGeometry(sm, frameT);

    if (autoSpin) {
      meshGroup.rotation.y += (0.003 + sm.bass * 0.018) * rotSpeed;
      meshGroup.rotation.x += (0.001 + sm.mid  * 0.007) * rotSpeed;
      meshGroup.rotation.z += 0.0005 * rotSpeed;
    }
    meshGroup.rotation.y += mouseR.x * 0.07 * 0.018;
    meshGroup.rotation.x += mouseR.y * 0.04 * 0.013;

    if (wireMat) {
      wireMat.opacity = Math.min(0.92, 0.32 + sm.bass * 0.58 + sm.overall * 0.10);
      wireMat.color.lerpColors(TC.goldD, TC.goldB, sm.bass * 0.8 + sm.hi * 0.2);
    }
    if (edgeMat) {
      edgeMat.opacity = 0.10 + sm.overall * 0.55;
      edgeMat.color.lerpColors(TC.gold, TC.goldB, sm.hi);
    }
    if (solidMat) solidMat.opacity = 0.16 + sm.bass * 0.14;

    const pa = pGeo.attributes.position;
    for (let i = 0; i < PC; i++) {
      pa.setX(i, pa.getX(i) + Math.sin(frameT * pSeeds[i*3+2] + pSeeds[i*3])     * 0.007);
      pa.setY(i, pa.getY(i) + Math.cos(frameT * pSeeds[i*3+2] * 0.7 + pSeeds[i*3+1]) * 0.007);
    }
    pa.needsUpdate = true;
    pMat.opacity = 0.16 + sm.overall * 0.46;
    pMat.size    = 0.010 + sm.bass * 0.020 * (1 + flow * 0.4);

    ring1.rotation.z += (0.004 + sm.bass * 0.030) * Math.max(0.2, rotSpeed);
    ring2.rotation.x += (0.003 + sm.mid  * 0.020) * Math.max(0.2, rotSpeed);
    ring3.rotation.y += 0.002 * Math.max(0.2, rotSpeed);
    ring1.scale.setScalar(1 + sm.bass * 0.10);
    ring2.scale.setScalar(1 + sm.mid  * 0.07);

    syncReadouts();

    checkResize();
    renderer.render(scene, camera);
  }
  tick();
})();

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
