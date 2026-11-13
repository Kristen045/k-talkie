// Chat page = a voice "call". The loop is:  listen -> send -> think -> tutor speaks -> listen ...
const $ = (s) => document.querySelector(s);
const root = $('.chat');
const convId = root.dataset.conv, tutorKey = root.dataset.tutor, tutorInitial = root.dataset.initial;
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
const applyMy = () => { log.classList.toggle('hide-my', !toggleMy.checked); $('#cap-my').hidden = !toggleMy.checked; };
toggleMy.addEventListener('change', () => { store.set('kt-my', toggleMy.checked); applyMy(); });
applyMy();

// ================================================================ call state
const LABELS = {
  idle: 'Tap the mic to start', listening: 'Listening… 듣고 있어요', thinking: 'Thinking… 생각 중',
  speaking: 'Speaking… 말하는 중', paused: 'Paused · tap the mic to continue',
};
let call = false, state = 'idle', emptyCount = 0, lastTutor = null;
function setState(s) {
  state = s; stage.dataset.state = s; $('#state').textContent = LABELS[s];
  $('#end-btn').hidden = !call;
}

// ================================================================ mode switcher
const MODE_NAMES = { teacher: 'Polite teacher · ယဉ်ကျေးသော ဆရာ', friend: 'Friendly friend · ခင်မင်သော သူငယ်ချင်း' };
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
  log.append(el('div', 'sys', `Style changed → ${mode === 'custom' ? role : MODE_NAMES[mode]}`)); scrollLog();
}
document.querySelectorAll('#modes .pill').forEach((pill) => pill.addEventListener('click', async () => {
  if (pill.dataset.mode === 'custom') { $('#custom-box').hidden = false; $('#custom-role').focus(); return; }
  $('#custom-box').hidden = true; await setMode(pill.dataset.mode, null);
}));
$('#apply-role').addEventListener('click', async () => {
  const r = $('#custom-role').value.trim();
  if (r) { await setMode('custom', r); $('#custom-box').hidden = true; }
});

// ================================================================ grammar check display
function scoreClass(n) { return n >= 90 ? 'good' : n >= 70 ? 'ok' : 'bad'; }
function renderCheck(c, compact) {
  const box = el('div', 'check ' + scoreClass(c.score) + (compact ? ' compact' : ''));
  box.append(el('span', 'score', String(c.score)));
  const body = el('div', 'check-body');
  if (c.score >= 100) body.append(el('div', 'check-ok', '✅ ပြည့်စုံပါတယ် · 완벽해요!'));
  else {
    if (c.corrected) body.append(el('div', 'check-fix', '✏️ ' + c.corrected));
    if (c.note) body.append(el('div', 'check-note', c.note));
  }
  box.append(body);
  return box;
}
function attachCheck(row, c) {
  if (!row || !c || c.check_score == null) return;
  const data = { score: c.check_score, corrected: c.check_corrected || '', note: c.check_note || '' };
  if (row) row.querySelector('.bubble').append(renderCheck(data));
  const chip = $('#mycheck'); chip.replaceChildren(el('div', 'mycheck-title', 'Your sentence · သင့်စာကြောင်း'), renderCheck(data, true));
  chip.hidden = false; scrollLog();
}

// ================================================================ messages
function addMessage(m) {
  const row = el('div', 'row ' + m.role);
  if (m.role === 'tutor') row.append(el('span', `avatar small ${tutorKey}`, tutorInitial));
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
  if (m.role === 'user') attachCheck(row, m);
  return row;
}
function showCaption(m) {
  $('#cap-ko').textContent = m.korean; $('#cap-my').textContent = m.burmese || '';
  const tip = $('#cap-tip'); tip.textContent = m.tip || ''; tip.hidden = !m.tip;
}
function replayCaptionAnim() { const c = $('.captions'); c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); }

// ================================================================ audio: natural voice + lip-sync + waveform
let actx = null, analyser = null, timeBuf = null, freqBuf = null;
let curAudio = null, curUrl = null, speakToken = 0, level = 0, capText = '', capStart = 0;

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

// Says the tutor's Korean out loud and reveals the caption in sync. Calls `done` once.
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
    a.onerror = () => { speakBrowser(m, finish); };
    $('#cap-ko').textContent = ''; $('#cap-my').textContent = m.burmese || ''; capText = m.korean;
    const tip = $('#cap-tip'); tip.textContent = m.tip || ''; tip.hidden = !m.tip; replayCaptionAnim();
    stage.classList.add('talking'); stage.classList.remove('fake');
    await a.play();
  } catch (e) {
    stage.classList.remove('loading-voice');
    speakBrowser(m, finish);                       // voice server unreachable -> robotic browser voice
  }
}

// Fallback: the browser's built-in voice (less natural).
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
  if (curAudio) { curAudio.onended = curAudio.onerror = null; }
  if (curUrl) { const u = curUrl; setTimeout(() => URL.revokeObjectURL(u), 500); curUrl = null; }
  curAudio = null;
  if (lastTutor) showCaption(lastTutor);          // make sure the full caption is visible
}
function stopSpeaking() {
  speakToken++;
  if (curAudio) { try { curAudio.pause(); } catch {} }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  endTalking();
}

// ---- one animation loop: lip-sync (mouth + glow), caption reveal, waveform
const wave = $('#wave'), wctx = wave.getContext('2d');
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#e8574c';
function frame(t) {
  requestAnimationFrame(frame);
  const talking = curAudio && !curAudio.paused;
  if (talking && analyser) {
    analyser.getByteTimeDomainData(timeBuf);
    let sum = 0; for (const v of timeBuf) { const x = (v - 128) / 128; sum += x * x; }
    const rms = Math.sqrt(sum / timeBuf.length);
    level += (Math.min(1, rms * 5) - level) * 0.45;
    if (capText && curAudio.duration) {           // caption appears as the tutor speaks
      const n = Math.ceil(capText.length * Math.min(1, (curAudio.currentTime + 0.15) / curAudio.duration));
      $('#cap-ko').textContent = capText.slice(0, n);
    }
  } else level *= 0.8;
  face.style.setProperty('--lvl', level.toFixed(3));

  // waveform bars
  const W = wave.width, H = wave.height, bars = 32, bw = W / bars;
  wctx.clearRect(0, 0, W, H);
  const color = state === 'listening' ? css('--ok') : state === 'thinking' ? css('--warn') : css('--accent');
  wctx.fillStyle = color;
  if (talking && analyser) analyser.getByteFrequencyData(freqBuf);
  for (let i = 0; i < bars; i++) {
    let h;
    if (talking && analyser) h = 4 + (freqBuf[Math.floor(i * 0.9) + 2] / 255) * (H - 6);
    else if (state === 'listening') h = 5 + (Math.sin(t / 180 + i * 0.7) * 0.5 + 0.5) * 20 * (0.5 + 0.5 * Math.sin(t / 700 + i));
    else h = 3 + (state === 'thinking' ? (Math.sin(t / 150 - i * 0.5) * 0.5 + 0.5) * 8 : 0);
    wctx.globalAlpha = talking || state === 'listening' || state === 'thinking' ? 0.9 : 0.35;
    wctx.beginPath(); wctx.roundRect(i * bw + 2, (H - h) / 2, bw - 4, h, 3); wctx.fill();
  }
}
requestAnimationFrame(frame);

// ================================================================ your voice (speech recognition)
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
      call = false; setState('paused'); showError('Please allow the microphone for this site, then tap the mic.');
    }
  };
  rec.onend = () => {
    if (state !== 'listening') return;
    const text = heard.trim(); heard = '';
    if (text) { emptyCount = 0; $('#live').textContent = ''; handleUser(text); return; }
    emptyCount++;
    if (emptyCount >= 3) { pauseCall(); showError("I didn't hear anything. Tap the mic when you're ready."); }
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
  const typing = el('div', 'row tutor'); typing.append(el('span', `avatar small ${tutorKey}`, tutorInitial), el('div', 'bubble dots', '● ● ●'));
  log.append(typing); scrollLog();
  try {
    const res = await fetch(`/api/conversations/${convId}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    });
    const data = await res.json();
    typing.remove();
    if (!res.ok) throw new Error(data.detail || 'Something went wrong');
    if (data.mode_changed) { mode = data.mode; role = data.custom_role; showMode(); }
    attachCheck(userRow, data.user);                // grammar badge appears under what you said
    addMessage(data.tutor); lastTutor = data.tutor;
    return data.tutor;
  } catch (e) { typing.remove(); showError(e.message); return null; }
}

function startCall() {
  showError(''); ensureAudio(); call = true; emptyCount = 0; setState('thinking');
  if (lastTutor && !stage.dataset.greeted) {
    stage.dataset.greeted = '1'; setState('speaking'); speakReply(lastTutor, () => listen());
  } else listen();
}
function pauseCall() {
  call = false; stopSpeaking();
  if (rec) { try { rec.abort(); } catch {} }
  setState('paused'); $('#live').textContent = '';
}

$('#call-btn').addEventListener('click', () => {
  if (!call) return startCall();
  if (state === 'speaking') { stopSpeaking(); listen(); }
  else if (state === 'listening' && rec) { try { rec.stop(); } catch {} }
});
$('#end-btn').addEventListener('click', pauseCall);

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
  const lastUser = [...msgs].reverse().find((m) => m.role === 'user' && m.check_score != null);
  if (lastUser) attachCheck(null, lastUser);   // only fills the "your sentence" chip
  if (msgs.length > 1) stage.dataset.greeted = '1';
  setState('idle');
})();
