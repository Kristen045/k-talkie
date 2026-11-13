// Chat page = a voice "call". The loop is:  listen -> send -> think -> tutor speaks -> listen ...
const $ = (s) => document.querySelector(s);
const root = $('.chat');
const convId = root.dataset.conv, tutorKey = root.dataset.tutor, tutorInitial = root.dataset.initial;
let mode = root.dataset.mode, role = root.dataset.role;

const log = $('#log'), stage = $('#stage'), input = $('#text'), form = $('#form');
const store = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch {} },
};

// ================================================================ small helpers
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
function showError(msg) { const e = $('#error'); e.textContent = msg || ''; e.hidden = !msg; }
function scrollLog() { log.scrollTop = log.scrollHeight; }

const toggleMy = $('#toggle-my');
toggleMy.checked = store.get('kt-my', true);
const applyMy = () => { log.classList.toggle('hide-my', !toggleMy.checked); $('#cap-my').hidden = !toggleMy.checked; };
toggleMy.addEventListener('change', () => { store.set('kt-my', toggleMy.checked); applyMy(); });
applyMy();

// ================================================================ state of the call
const LABELS = {
  idle: 'Tap the mic to start', listening: 'Listening… 듣고 있어요', thinking: 'Thinking… 생각 중',
  speaking: 'Speaking… 말하는 중', paused: 'Paused · tap the mic to continue',
};
let call = false, state = 'idle', emptyCount = 0, lastTutor = null, speakToken = 0;
function setState(s) {
  state = s; stage.dataset.state = s; $('#state').textContent = LABELS[s];
  $('#call-btn').setAttribute('aria-label', s === 'idle' || s === 'paused' ? 'Start talking' : 'Microphone');
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

// ================================================================ showing messages
function addMessage(m) {
  const row = el('div', 'row ' + m.role);
  if (m.role === 'tutor') row.append(el('span', `avatar small ${tutorKey}`, tutorInitial));
  const bubble = el('div', 'bubble');
  bubble.append(el('div', 'ko', m.korean));
  if (m.role === 'tutor') {
    if (m.burmese) bubble.append(el('div', 'my-line', m.burmese));
    if (m.tip) bubble.append(el('div', 'tip', m.tip));
    const b = el('button', 'speak', '🔊'); b.type = 'button'; b.title = 'Listen again';
    b.addEventListener('click', () => speak(m.korean));
    bubble.append(b);
  }
  row.append(bubble); log.append(row); scrollLog();
}
function showCaption(m) {
  $('#cap-ko').textContent = m.korean; $('#cap-my').textContent = m.burmese || '';
  const tip = $('#cap-tip'); tip.textContent = m.tip || ''; tip.hidden = !m.tip;
}

// ================================================================ tutor voice (text-to-speech)
let voices = [], currentUtterance = null;
function loadVoices() { voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('ko')); }
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }

// Speaks `text`, then calls `done` exactly once (even if the browser forgets to tell us it finished).
function speak(text, done) {
  const token = ++speakToken;
  let finished = false;
  const finish = () => { if (finished || token !== speakToken) return; finished = true; stage.classList.remove('talking'); done && done(); };
  if (!('speechSynthesis' in window)) { setTimeout(finish, 600); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  currentUtterance = u;                                    // keep a reference or Chrome may drop it
  u.lang = 'ko-KR'; u.rate = 0.9; u.pitch = tutorKey === 'yuri' ? 1.15 : 0.85;
  if (voices.length) u.voice = voices[0];
  u.onstart = () => stage.classList.add('talking');
  u.onend = u.onerror = finish;
  stage.classList.add('talking');
  speechSynthesis.speak(u);
  setTimeout(finish, 4000 + text.length * 350);            // safety net
}
function stopSpeaking() { speakToken++; stage.classList.remove('talking'); if ('speechSynthesis' in window) speechSynthesis.cancel(); }

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
  rec.onresult = (e) => {
    heard = Array.from(e.results).map((r) => r[0].transcript).join('');
    $('#live').textContent = heard;
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      call = false; setState('paused'); showError('Please allow the microphone for this site, then tap the mic.');
    }
  };
  rec.onend = () => {
    if (state !== 'listening') return;                     // we stopped it on purpose
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
  speak(reply.korean, () => listen());
}

async function sendText(text) {
  showError('');
  addMessage({ role: 'user', korean: text });
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
    addMessage(data.tutor); showCaption(data.tutor); lastTutor = data.tutor;
    return data.tutor;
  } catch (e) { typing.remove(); showError(e.message); return null; }
}

function startCall() {
  showError(''); call = true; emptyCount = 0; setState('thinking');
  if (lastTutor && !stage.dataset.greeted) {               // first time: the tutor says hello out loud
    stage.dataset.greeted = '1'; setState('speaking'); speak(lastTutor.korean, () => listen());
  } else listen();
}
function pauseCall() {
  call = false; stopSpeaking();
  if (rec) { try { rec.abort(); } catch {} }
  setState('paused'); $('#live').textContent = '';
}

$('#call-btn').addEventListener('click', () => {
  if (!call) return startCall();
  if (state === 'speaking') { stopSpeaking(); listen(); }   // interrupt the tutor and talk
  else if (state === 'listening' && rec) { try { rec.stop(); } catch {} } // "I'm done" -> send now
});
$('#end-btn').addEventListener('click', pauseCall);

// typing still works any time
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim(); if (!text) return;
  input.value = '';
  if (call) { stopSpeaking(); if (rec) { try { rec.abort(); } catch {} } await handleUser(text); return; }
  setState('thinking'); const reply = await sendText(text); setState('idle');
  if (reply) { setState('speaking'); speak(reply.korean, () => setState('idle')); }
});

// ================================================================ load the conversation
(async function init() {
  const msgs = await (await fetch(`/api/conversations/${convId}/messages`)).json();
  msgs.forEach(addMessage);
  const tutors = msgs.filter((m) => m.role === 'tutor');
  if (tutors.length) { lastTutor = tutors[tutors.length - 1]; showCaption(lastTutor); }
  if (msgs.length > 1) stage.dataset.greeted = '1';          // resuming an old chat: don't re-greet
  setState('idle');
})();
