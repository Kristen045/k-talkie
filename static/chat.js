// Chat page: sends messages, shows replies, voice in (mic) and voice out (speaker).
const $ = (s) => document.querySelector(s);
const root = $('.chat');
const convId = root.dataset.conv;
const tutorKey = root.dataset.tutor;
const tutorInitial = root.dataset.initial;
let mode = root.dataset.mode;
let role = root.dataset.role;
let busy = false;

const log = $('#log'), form = $('#form'), input = $('#text');
const store = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch {} },
};

// ---------- settings toggles
const toggleMy = $('#toggle-my'), toggleAuto = $('#toggle-auto');
toggleMy.checked = store.get('kt-my', true);
toggleAuto.checked = store.get('kt-auto', true);
const applyMy = () => log.classList.toggle('hide-my', !toggleMy.checked);
toggleMy.addEventListener('change', () => { store.set('kt-my', toggleMy.checked); applyMy(); });
toggleAuto.addEventListener('change', () => store.set('kt-auto', toggleAuto.checked));
applyMy();

// ---------- mode switcher
const MODE_NAMES = { teacher: 'Polite teacher · ယဉ်ကျေးသော ဆရာ', friend: 'Friendly friend · ခင်မင်သော သူငယ်ချင်း' };
function showMode() {
  $('#mode-label').textContent = mode === 'custom' ? `Role: ${role}` : MODE_NAMES[mode];
  document.querySelectorAll('#modes .pill').forEach((p) => p.classList.toggle('on', p.dataset.mode === mode));
}
showMode();

document.querySelectorAll('#modes .pill').forEach((pill) => {
  pill.addEventListener('click', async () => {
    if (pill.dataset.mode === 'custom') { $('#custom-box').hidden = false; $('#custom-role').focus(); return; }
    $('#custom-box').hidden = true;
    await setMode(pill.dataset.mode, null);
  });
});
$('#apply-role').addEventListener('click', async () => {
  const r = $('#custom-role').value.trim();
  if (r) { await setMode('custom', r); $('#custom-box').hidden = true; }
});
async function setMode(m, r) {
  const res = await fetch(`/api/conversations/${convId}/mode`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: m, custom_role: r }),
  });
  const data = await res.json();
  if (!res.ok) return showError(data.detail);
  mode = data.mode; role = data.custom_role || ''; showMode();
  addSystem(`Style changed → ${mode === 'custom' ? role : MODE_NAMES[mode]}`);
}

// ---------- rendering
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
function addSystem(text) { log.append(el('div', 'sys', text)); scroll(); }
function scroll() { log.scrollTop = log.scrollHeight; }
function showError(msg) { const e = $('#error'); e.textContent = msg; e.hidden = !msg; }

function addMessage(m) {
  const row = el('div', 'row ' + m.role);
  if (m.role === 'tutor') row.append(el('span', `avatar small ${tutorKey}`, tutorInitial));
  const bubble = el('div', 'bubble');
  bubble.append(el('div', 'ko', m.korean));
  if (m.role === 'tutor') {
    if (m.burmese) bubble.append(el('div', 'my-line', m.burmese));
    if (m.tip) bubble.append(el('div', 'tip', m.tip));
    const speak = el('button', 'speak', '🔊');
    speak.type = 'button'; speak.title = 'Listen'; speak.setAttribute('aria-label', 'Listen');
    speak.addEventListener('click', () => say(m.korean));
    bubble.append(speak);
  }
  row.append(bubble);
  log.append(row); scroll();
}

let typingRow = null;
function typing(on) {
  if (on) {
    typingRow = el('div', 'row tutor');
    typingRow.append(el('span', `avatar small ${tutorKey}`, tutorInitial));
    typingRow.append(el('div', 'bubble dots', '● ● ●'));
    log.append(typingRow); scroll();
  } else if (typingRow) { typingRow.remove(); typingRow = null; }
}

// ---------- speaking out loud (browser text-to-speech)
let voices = [];
function loadVoices() { voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('ko')); }
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
function say(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  // Use the first Korean voice the browser has; pitch below makes Yuri/Joohyuk sound different.
  if (voices.length) u.voice = voices[0];
  u.pitch = tutorKey === 'yuri' ? 1.15 : 0.85;
  u.rate = 0.9;  // a bit slower for learners
  speechSynthesis.speak(u);
}

// ---------- sending
async function send(text) {
  if (busy || !text.trim()) return;
  busy = true; showError('');
  input.value = ''; $('#send').disabled = true;
  addMessage({ role: 'user', korean: text });
  typing(true);
  try {
    const res = await fetch(`/api/conversations/${convId}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    });
    const data = await res.json();
    typing(false);
    if (!res.ok) throw new Error(data.detail || 'Something went wrong');
    if (data.mode_changed) { mode = data.mode; role = data.custom_role; showMode(); }
    addMessage(data.tutor);
    if (toggleAuto.checked) say(data.tutor.korean);
  } catch (e) { typing(false); showError(e.message); }
  busy = false; $('#send').disabled = false; input.focus();
}
form.addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });

// ---------- speaking in (browser speech recognition)
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const mic = $('#mic'), hint = $('#mic-hint');
if (!SR) {
  mic.disabled = true; mic.title = 'Voice input needs Chrome or Edge';
  hint.textContent = 'Voice input works in Chrome / Edge. You can still type.'; hint.hidden = false;
} else {
  const rec = new SR();
  rec.lang = 'ko-KR'; rec.interimResults = true; rec.maxAlternatives = 1;
  let listening = false, finalText = '';
  rec.onresult = (e) => {
    let t = '';
    for (const r of e.results) t += r[0].transcript;
    finalText = t; input.value = t;
  };
  rec.onend = () => {
    listening = false; mic.classList.remove('rec');
    if (finalText.trim()) send(finalText.trim());
    finalText = '';
  };
  rec.onerror = (e) => {
    listening = false; mic.classList.remove('rec'); finalText = '';
    if (e.error === 'not-allowed') showError('Please allow the microphone for this site.');
  };
  mic.addEventListener('click', () => {
    if (listening) { rec.stop(); return; }
    speechSynthesis.cancel(); showError(''); finalText = '';
    try { rec.start(); listening = true; mic.classList.add('rec'); } catch {}
  });
}

// ---------- load the conversation
(async function init() {
  const res = await fetch(`/api/conversations/${convId}/messages`);
  const msgs = await res.json();
  msgs.forEach(addMessage);
  const last = msgs[msgs.length - 1];
  if (msgs.length === 1 && last.role === 'tutor' && toggleAuto.checked) {
    // browsers block sound until the user clicks something; this is a best-effort greeting
    say(last.korean);
  }
})();
