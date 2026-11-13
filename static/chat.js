// Chat page = a video-call style voice lesson.
// Loop:  you speak (Korean) -> grammar check + reply -> tutor speaks (Korean) -> listen again.
// Spoken language is ALWAYS Korean. Burmese only ever appears as written text in the script.
const $ = (s) => document.querySelector(s);
const root = $('.chat');
const convId = root.dataset.conv, tutorKey = root.dataset.tutor, tutorInitial = root.dataset.initial;
const TUTOR_NAME = tutorKey === 'yuri' ? '유리' : '주혁';
let mode = root.dataset.mode, role = root.dataset.role;

const log = $('#log'), stage = $('#stage'), face = $('#face'), input = $('#text'), form = $('#form');
const store = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch {} },
};
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
function showError(msg) { const e = $('#error'); e.textContent = msg || ''; e.hidden = !msg; }
function scrollLog() { log.scrollTop = log.scrollHeight; }

const toggleMy = $('#toggle-my');
toggleMy.checked = store.get('kt-my', true);
const applyMy = () => log.classList.toggle('hide-my', !toggleMy.checked);
toggleMy.addEventListener('change', () => { store.set('kt-my', toggleMy.checked); applyMy(); });
applyMy();

// ================================================================ call state
const LABELS = {
  idle: 'Tap Talk to start', listening: '🎧 Listening… 듣고 있어요', thinking: '💭 Thinking… 생각 중',
  speaking: '🔊 Speaking… 말하는 중', paused: '⏸ Paused',
};
let call = false, state = 'idle', emptyCount = 0, lastTutor = null;
function setState(s) { state = s; stage.dataset.state = s; $('#state').textContent = LABELS[s]; }

// ================================================================ mode switcher
const MODE_NAMES = { teacher: 'Polite teacher', friend: 'Friendly friend' };
function showMode() {
  $('#mode-label').textContent = mode === 'custom' ? `Role: ${role}` : MODE_NAMES[mode];
  document.querySelectorAll('#modes .pill').forEach((p) => p.classList.toggle('on', p.dataset.mode === mode));
}
showMode();
async function setMode(m, r) {
  const res = await fetch(`/api/conversations/${convId}/mode`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: m, custom_role: r }),
  });
  const data = await res.json();
  if (!res.ok) return showError(data.detail);
  mode = data.mode; role = data.custom_role || ''; showMode();
  log.append(el('div', 'sys', `Style → ${mode === 'custom' ? role : MODE_NAMES[mode]}`)); scrollLog();
}
document.querySelectorAll('#modes .pill').forEach((pill) => pill.addEventListener('click', async () => {
  if (pill.dataset.mode === 'custom') { $('#custom-box').hidden = false; $('#custom-role').focus(); return; }
  $('#custom-box').hidden = true; await setMode(pill.dataset.mode, null);
}));
$('#apply-role').addEventListener('click', async () => {
  const r = $('#custom-role').value.trim();
  if (r) { await setMode('custom', r); $('#custom-box').hidden = true; }
});

// ================================================================ grammar check: ❌ wrong -> ✅ right, 💡 reason
function scoreClass(n) { return n >= 90 ? 'good' : n >= 70 ? 'ok' : 'bad'; }

// Word-by-word difference between what you said (a) and the corrected sentence (b).
function diffWords(a, b) {
  const A = a.split(/\s+/).filter(Boolean), B = b.split(/\s+/).filter(Boolean);
  const dp = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--)
    dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const outA = [], outB = []; let i = 0, j = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) { outA.push([A[i], false]); outB.push([B[j], false]); i++; j++; }
    else if (j >= B.length || (i < A.length && dp[i + 1][j] >= dp[i][j + 1])) { outA.push([A[i], true]); i++; }
    else { outB.push([B[j], true]); j++; }
  }
  return [outA, outB];
}
function wordsToNode(words, tag) {
  const wrap = el('span');
  words.forEach(([w, changed], idx) => {
    const n = changed ? el(tag, '', w) : document.createTextNode(w);
    wrap.append(n); if (idx < words.length - 1) wrap.append(' ');
  });
  return wrap;
}
function renderCheck(c, original) {
  const box = el('div', 'check ' + scoreClass(c.score));
  box.append(el('span', 'score', String(c.score)));
  const body = el('div', 'check-body');
  if (c.score >= 100) body.append(el('div', 'line', '✅ 완벽해요! · ပြည့်စုံပါတယ်'));
  else {
    if (c.corrected) {
      const [wa, wb] = diffWords(original, c.corrected);
      const bad = el('div', 'line'); bad.append('❌ ', wordsToNode(wa, 'del'));
      const good = el('div', 'line'); good.append('✅ ', wordsToNode(wb, 'ins'));
      body.append(bad, good);
    }
    if (c.note) body.append(el('div', 'check-note', '💡 ' + c.note));
  }
  box.append(body);
  return box;
}

// ================================================================ script lines
function addMessage(m) {
  const row = el('div', 'row ' + m.role);
  const who = el('div', 'who');
  if (m.role === 'tutor') who.append(el('span', `avatar small ${tutorKey}`, tutorInitial), TUTOR_NAME);
  else who.append('나 · Me');
  row.append(who);
  const bubble = el('div', 'bubble');
  bubble.append(el('div', 'ko', m.korean));
  if (m.role === 'tutor') {
    if (m.burmese) bubble.append(el('div', 'my-line', m.burmese));
    if (m.tip) bubble.append(el('div', 'tip', m.tip));
    const b = el('button', 'speak', '🔊'); b.type = 'button'; b.title = 'Listen again';
    b.addEventListener('click', () => { stopSpeaking(); speakReply(m, () => {}); });
    bubble.append(b);
  }
  row.append(bubble); log.append(row); scrollLog();
  if (m.role === 'user') fillUser(row, m);
  return row;
}
// Adds the Burmese translation + grammar check under one of YOUR lines.
function fillUser(row, m) {
  if (!row) return;
  const bubble = row.querySelector('.bubble');
  if (m.burmese && !bubble.querySelector('.my-line')) bubble.append(el('div', 'my-line', m.burmese));
  if (m.check_score != null && !bubble.querySelector('.check')) {
    row.dataset.score = m.check_score;
    bubble.append(renderCheck({ score: m.check_score, corrected: m.check_corrected || '', note: m.check_note || '' }, m.korean));
  }
  scrollLog();
}
function showCaption(m) { $('#cap-ko').textContent = m ? m.korean : ''; }

// ================================================================ tutor voice: natural neural audio + lip-sync + waveform
let actx = null, analyser = null, timeBuf = null, freqBuf = null;
let curAudio = null, curUrl = null, speakToken = 0, level = 0, capText = '';

function ensureAudio() {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = actx.createAnalyser(); analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.6;
    analyser.connect(actx.destination);
    timeBuf = new Uint8Array(analyser.fftSize); freqBuf = new Uint8Array(analyser.frequencyBinCount);
  }
  if (actx.state === 'suspended') actx.resume();
}
async function fetchVoice(text) {
  const res = await fetch(`/api/tts?tutor=${tutorKey}&text=${encodeURIComponent(text)}`);
  if (!res.ok) throw new Error('tts ' + res.status);
  return URL.createObjectURL(await res.blob());
}

// Says the tutor's KOREAN out loud (never the Burmese) and reveals the subtitle in sync. Calls `done` once.
async function speakReply(m, done) {
  const token = ++speakToken;
  let finished = false;
  const finish = () => { if (finished || token !== speakToken) return; finished = true; endTalking(); done && done(); };
  try {
    ensureAudio();
    stage.classList.add('loading-voice');
    const url = await fetchVoice(m.korean);
    stage.classList.remove('loading-voice');
    if (token !== speakToken) { URL.revokeObjectURL(url); return; }
    const a = new Audio(url);
    curAudio = a; curUrl = url;
    actx.createMediaElementSource(a).connect(analyser);
    a.onended = finish;
    a.onerror = () => speakBrowser(m, finish);
    $('#cap-ko').textContent = ''; capText = m.korean;
    stage.classList.add('talking'); stage.classList.remove('fake');
    await a.play();
  } catch (e) {
    stage.classList.remove('loading-voice');
    speakBrowser(m, finish);                       // voice server unreachable -> robotic browser voice
  }
}
function speakBrowser(m, done) {
  showCaption(m); capText = '';
  if (!('speechSynthesis' in window)) { setTimeout(done, 800); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(m.korean);
  u.lang = 'ko-KR'; u.rate = 0.9; u.pitch = tutorKey === 'yuri' ? 1.15 : 0.85;
  const v = speechSynthesis.getVoices().find((x) => x.lang.toLowerCase().startsWith('ko')); if (v) u.voice = v;
  window.__u = u; u.onend = u.onerror = done;
  stage.classList.add('talking', 'fake');
  speechSynthesis.speak(u);
  setTimeout(done, 4000 + m.korean.length * 350);
}
function endTalking() {
  stage.classList.remove('talking', 'fake'); level = 0; capText = '';
  face.style.setProperty('--lvl', 0);
  if (curAudio) curAudio.onended = curAudio.onerror = null;
  if (curUrl) { const u = curUrl; setTimeout(() => URL.revokeObjectURL(u), 500); curUrl = null; }
  curAudio = null;
  showCaption(lastTutor);
}
function stopSpeaking() {
  speakToken++;
  if (curAudio) { try { curAudio.pause(); } catch {} }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  endTalking();
}

// ---- one animation loop: lip-sync, subtitle reveal, waveform
const wave = $('#wave'), wctx = wave.getContext('2d');
function frame(t) {
  requestAnimationFrame(frame);
  const talking = curAudio && !curAudio.paused;
  if (talking && analyser) {
    analyser.getByteTimeDomainData(timeBuf);
    let sum = 0; for (const v of timeBuf) { const x = (v - 128) / 128; sum += x * x; }
    level += (Math.min(1, Math.sqrt(sum / timeBuf.length) * 5) - level) * 0.45;
    if (capText && curAudio.duration) {
      const n = Math.ceil(capText.length * Math.min(1, (curAudio.currentTime + 0.15) / curAudio.duration));
      $('#cap-ko').textContent = capText.slice(0, n);
    }
  } else level *= 0.8;
  face.style.setProperty('--lvl', level.toFixed(3));
  stage.style.setProperty('--lvl', level.toFixed(3));

  const W = wave.width, H = wave.height, bars = 36, bw = W / bars;
  wctx.clearRect(0, 0, W, H);
  wctx.fillStyle = '#fff';
  if (talking && analyser) analyser.getByteFrequencyData(freqBuf);
  for (let i = 0; i < bars; i++) {
    let h;
    if (talking && analyser) h = 3 + (freqBuf[Math.floor(i * 0.9) + 2] / 255) * (H - 5);
    else if (state === 'listening') h = 3 + (Math.sin(t / 180 + i * 0.7) * 0.5 + 0.5) * 12;
    else if (state === 'thinking') h = 3 + (Math.sin(t / 150 - i * 0.5) * 0.5 + 0.5) * 6;
    else h = 3;
    wctx.globalAlpha = talking || state === 'listening' || state === 'thinking' ? 0.9 : 0.35;
    wctx.beginPath(); wctx.roundRect(i * bw + 1.5, (H - h) / 2, bw - 3, h, 2); wctx.fill();
  }
}
requestAnimationFrame(frame);

// ================================================================ your camera (stays on your computer, never uploaded)
let camStream = null;
const camTile = $('#cam-tile'), camBtn = $('#cam-btn'), camVideo = $('#cam');
async function setCamera(on) {
  if (on) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { showError('This browser cannot use a camera here (needs https or localhost).'); return; }
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
      camVideo.srcObject = camStream; camTile.classList.add('on'); camBtn.setAttribute('aria-pressed', 'true'); store.set('kt-cam', true);
    } catch { showError('Camera blocked. Allow it in the browser address bar if you want to see yourself.'); }
  } else {
    if (camStream) camStream.getTracks().forEach((t) => t.stop());
    camStream = null; camVideo.srcObject = null; camTile.classList.remove('on'); camBtn.setAttribute('aria-pressed', 'false'); store.set('kt-cam', false);
  }
}
camBtn.addEventListener('click', () => setCamera(!camStream));

// ================================================================ your voice (speech recognition, Korean)
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, heard = '';
if (!SR) {
  $('#call-btn').disabled = true;
  $('#state').textContent = 'Voice needs Chrome or Edge';
  $('#mic-hint').textContent = 'Your browser has no speech recognition. You can still type on the right →'; $('#mic-hint').hidden = false;
} else {
  rec = new SR();
  rec.lang = 'ko-KR'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
  rec.onresult = (e) => { heard = Array.from(e.results).map((r) => r[0].transcript).join(''); $('#live').textContent = heard; };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      call = false; setState('paused'); showError('Please allow the microphone for this site, then tap Talk.');
    }
  };
  rec.onend = () => {
    if (state !== 'listening') return;
    const text = heard.trim(); heard = '';
    if (text) { emptyCount = 0; $('#live').textContent = ''; handleUser(text); return; }
    emptyCount++;
    if (emptyCount >= 3) { pauseCall(); showError("I didn't hear anything. Tap Talk when you're ready."); }
    else if (call) setTimeout(listen, 250);
  };
}
function listen() {
  if (!call || !rec) return;
  heard = ''; $('#live').textContent = ''; setState('listening');
  try { rec.start(); } catch { /* already started */ }
}

// ================================================================ the loop
async function handleUser(text) {
  setState('thinking');
  const reply = await sendText(text);
  if (!call) return;
  if (!reply) { pauseCall(); return; }
  setState('speaking');
  speakReply(reply, () => listen());
}
async function sendText(text) {
  showError('');
  const userRow = addMessage({ role: 'user', korean: text });
  const typing = el('div', 'row tutor'); typing.append(el('div', 'bubble dots', '● ● ●'));
  log.append(typing); scrollLog();
  try {
    const res = await fetch(`/api/conversations/${convId}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    });
    const data = await res.json();
    typing.remove();
    if (!res.ok) throw new Error(data.detail || 'Something went wrong');
    if (data.mode_changed) { mode = data.mode; role = data.custom_role; showMode(); }
    fillUser(userRow, data.user);                   // Burmese translation + ❌→✅ appear under your line
    addMessage(data.tutor); lastTutor = data.tutor;
    return data.tutor;
  } catch (e) { typing.remove(); showError(e.message); return null; }
}

function startCall() {
  $('#summary').hidden = true;
  showError(''); ensureAudio(); call = true; emptyCount = 0; setState('thinking');
  if (store.get('kt-cam', true) && !camStream) setCamera(true);
  if (lastTutor && !stage.dataset.greeted) {
    stage.dataset.greeted = '1'; setState('speaking'); speakReply(lastTutor, () => listen());
  } else listen();
}
function pauseCall() {
  call = false; stopSpeaking();
  if (rec) { try { rec.abort(); } catch {} }
  setState('paused'); $('#live').textContent = '';
}
function endCall() {
  pauseCall(); setState('idle');
  if (camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; camVideo.srcObject = null; camTile.classList.remove('on'); camBtn.setAttribute('aria-pressed', 'false'); }
  const scores = [...log.querySelectorAll('.row.user[data-score]')].map((r) => +r.dataset.score);
  const body = $('#summary-body'); body.replaceChildren();
  const stat = (v, label) => { const d = el('div'); d.append(el('b', '', v), el('span', '', label)); body.append(d); };
  stat(String(log.querySelectorAll('.row.user').length), 'sentences · စာကြောင်း');
  stat(scores.length ? String(Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)) : '–', 'avg score · ပျမ်းမျှ');
  stat(String(scores.filter((s) => s < 100).length), 'to review · ပြန်ကြည့်ရန်');
  $('#summary').hidden = false;
}

$('#call-btn').addEventListener('click', () => {
  if (!call) return startCall();
  if (state === 'speaking') { stopSpeaking(); listen(); }
  else if (state === 'listening' && rec) { try { rec.stop(); } catch {} }
});
$('#end-btn').addEventListener('click', endCall);
$('#again').addEventListener('click', startCall);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim(); if (!text) return;
  input.value = ''; ensureAudio();
  if (call) { stopSpeaking(); if (rec) { try { rec.abort(); } catch {} } await handleUser(text); return; }
  stopSpeaking(); setState('thinking');
  const reply = await sendText(text);
  if (reply) { setState('speaking'); speakReply(reply, () => setState('idle')); } else setState('idle');
});

// ================================================================ load the conversation
(async function init() {
  const msgs = await (await fetch(`/api/conversations/${convId}/messages`)).json();
  msgs.forEach(addMessage);
  const tutors = msgs.filter((m) => m.role === 'tutor');
  if (tutors.length) { lastTutor = tutors[tutors.length - 1]; showCaption(lastTutor); }
  if (msgs.length > 1) stage.dataset.greeted = '1';
  setState('idle');
})();
