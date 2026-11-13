// Home page: pick a tutor + mode, then create a conversation and open the chat.
const $ = (s) => document.querySelector(s);
let tutor = null, mode = 'teacher';

document.querySelectorAll('.tutor-card').forEach((card) => {
  card.addEventListener('click', () => {
    tutor = card.dataset.tutor;
    document.querySelectorAll('.tutor-card').forEach((c) => {
      const on = c === card;
      c.classList.toggle('on', on);
      c.setAttribute('aria-pressed', on);
    });
    refresh();
  });
});

document.querySelectorAll('#modes .pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    mode = pill.dataset.mode;
    document.querySelectorAll('#modes .pill').forEach((p) => p.classList.toggle('on', p === pill));
    $('#custom-box').hidden = mode !== 'custom';
    if (mode === 'custom') $('#custom-role').focus();
    refresh();
  });
});

$('#custom-role').addEventListener('input', refresh);

function refresh() {
  const needsRole = mode === 'custom' && !$('#custom-role').value.trim();
  $('#start').disabled = !tutor || needsRole;
}

$('#start').addEventListener('click', async () => {
  const btn = $('#start');
  btn.disabled = true; btn.textContent = 'Connecting…';
  $('#error').hidden = true;
  try {
    const res = await fetch('/api/conversations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tutor, mode, custom_role: $('#custom-role').value.trim() || null }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Something went wrong');
    location.href = '/chat/' + data.id;
  } catch (e) {
    $('#error').textContent = e.message; $('#error').hidden = false;
    btn.textContent = 'Start talking · 시작하기'; refresh();
  }
});
