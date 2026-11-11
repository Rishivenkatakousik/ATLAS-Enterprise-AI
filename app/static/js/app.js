// Atlas UI — single-workspace demo. No login or tokens.
// Untrusted text (answers, document names, excerpts) is always escaped before it reaches the DOM.
const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const ICON = {
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M7 10v10M14 5.9 13 10h5.8a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 17.5 21H7V10l4.6-7a1.6 1.6 0 0 1 2.4 2.9Z"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M17 14V4M10 18.1 11 14H5.2a2 2 0 0 1-2-2.3l1.4-7A2 2 0 0 1 6.5 3H17v11l-4.6 7a1.6 1.6 0 0 1-2.4-2.9Z"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3 4 6v6c0 4.4 3.4 8 8 9 4.6-1 8-4.6 8-9V6z"/><path d="M12 8v5M12 16.5v.01"/></svg>',
  hold: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M12 3 4 6v6c0 4.4 3.4 8 8 9 4.6-1 8-4.6 8-9V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',
  upload: '<svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
};

/* ---------- helpers ---------- */
let toastTimer;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3800);
}
async function api(path, options = {}) {
  const res = await fetch(path, {cache: 'no-store', ...options, headers: {'Content-Type': 'application/json', ...(options.headers || {})}});
  let data = {}; try { data = await res.json(); } catch {}
  if (!res.ok) { const e = new Error(data.detail || `Request failed (${res.status})`); e.status = res.status; throw e; }
  return data;
}
const fmtDate = d => { const x = new Date(d); return isNaN(x) ? '' : x.toLocaleString(undefined, {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}); };
const ext = name => (String(name).split('.').pop() || '').slice(0, 4).toUpperCase();

/* ---------- state ---------- */
// crypto.randomUUID only exists in secure contexts (HTTPS/localhost); fall back for plain-HTTP deployments.
const uuid = () => (globalThis.crypto && typeof crypto.randomUUID === 'function') ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
let conversationId = sessionStorage.getItem('atlas_conversation_id') || uuid();
sessionStorage.setItem('atlas_conversation_id', conversationId);
let conversations = [];
let transcript = [];           // {role, content, sources?}
let answerSeq = 0;
const answerSources = new Map(); // answer id -> sources[]
const answerTraces = new Map();  // answer id -> pipeline snapshot (answers asked in this session)
let activeAnswer = null;
let busy = false;

/* ---------- navigation ---------- */
const TITLES = {ask: 'Ask your documents', library: 'Library', approvals: 'Approvals', metrics: 'Metrics'};
function view(name) {
  for (const v of Object.keys(TITLES)) $('view-' + v).hidden = v !== name;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  $('viewTitle').textContent = TITLES[name];
  $('stage').dataset.view = name;
  syncChrome();
  closeRail();
  if (name === 'library') loadDocs();
  if (name === 'approvals') loadApprovals();
  if (name === 'metrics') loadMetrics();
  if (name === 'ask') setTimeout(() => $('question').focus(), 50);
}
document.querySelectorAll('.nav-item').forEach(b => b.onclick = () => view(b.dataset.view));

function syncChrome() {
  const onAsk = $('stage').dataset.view === 'ask';
  const empty = $('view-ask').classList.contains('is-empty');
  $('stage').classList.toggle('bare', onAsk && empty);
  $('exportChat').hidden = !onAsk;
  $('exportChat').disabled = !transcript.length;
}

// Mobile rail + evidence panel (side column on wide screens, drawer on narrow ones)
const narrow = () => matchMedia('(max-width:1180px)').matches;
const panelOpen = () => $('view-ask').classList.contains('panel-open');
const openRail = () => { $('rail').classList.add('open'); $('scrim').hidden = false; };
function closeRail() { $('rail').classList.remove('open'); if (!(panelOpen() && narrow())) $('scrim').hidden = true; }
function openPanel(id) {
  showSources(id);
  $('view-ask').classList.add('panel-open');
  if (narrow()) $('scrim').hidden = false;
}
function closePanel() {
  $('view-ask').classList.remove('panel-open');
  document.querySelectorAll('.src-btn.on,.cite.on').forEach(b => b.classList.remove('on'));
  activeAnswer = null;
  if (!$('rail').classList.contains('open')) $('scrim').hidden = true;
}
$('menuBtn').onclick = openRail; $('railClose').onclick = closeRail;
$('evidenceClose').onclick = closePanel;
$('scrim').onclick = () => { closeRail(); closePanel(); $('scrim').hidden = true; };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && panelOpen()) closePanel(); });

/* ---------- knowledge base status ---------- */
async function refreshKb() {
  try {
    const {documents} = await api('/api/documents');
    const ready = documents.filter(d => d.status === 'ready').length;
    $('kbLabel').textContent = ready ? `${ready} document${ready === 1 ? '' : 's'} indexed` : 'No documents indexed yet';
    $('kbChip').className = 'kb-chip ' + (ready ? 'ok' : 'empty');
    $('navDocCount').textContent = documents.length || '';
    return documents;
  } catch { $('kbLabel').textContent = 'Index unavailable'; $('kbChip').className = 'kb-chip'; return []; }
}

/* ---------- history sidebar ---------- */
async function loadConversations() {
  try { conversations = (await api('/api/conversations')).conversations || []; } catch { conversations = []; }
  renderHistory();
}
function renderHistory() {
  const root = $('history'); root.replaceChildren();
  const q = $('historySearch').value.trim().toLowerCase();
  const list = conversations.filter(c => !q || String(c.title).toLowerCase().includes(q));
  if (!list.length) { root.append(el('p', 'history-empty', q ? 'No questions match your search.' : 'Your questions will be listed here.')); return; }
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const groups = [['Today', []], ['Yesterday', []], ['Previous 7 days', []], ['Older', []]];
  for (const c of list) {
    const age = (start - new Date(c.last_at)) / 864e5;
    groups[age <= 0 ? 0 : age <= 1 ? 1 : age <= 7 ? 2 : 3][1].push(c);
  }
  for (const [label, items] of groups) {
    if (!items.length) continue;
    root.append(el('h3', '', label));
    for (const c of items) {
      const b = el('button', 'history-item' + (c.conversation_id === conversationId ? ' active' : ''), c.title);
      b.type = 'button'; b.title = c.title;
      b.onclick = () => openConversation(c.conversation_id);
      root.append(b);
    }
  }
}
$('historySearch').oninput = renderHistory;
document.addEventListener('keydown', e => {
  if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); $('historySearch').focus(); }
});

/* ---------- ask view ---------- */
const q = $('question');
function autosize() { q.style.height = 'auto'; q.style.height = Math.min(q.scrollHeight, 200) + 'px'; $('sendBtn').disabled = busy || q.value.trim().length < 3; }
q.addEventListener('input', autosize);
q.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit(); } });
document.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { q.value = b.dataset.q; autosize(); q.focus(); });

function threadInner() {
  let inner = $('thread').querySelector('.thread-inner');
  if (!inner) { inner = el('div', 'thread-inner'); $('thread').append(inner); }
  return inner;
}
function setEmpty(isEmpty) { $('view-ask').classList.toggle('is-empty', isEmpty); syncChrome(); }
const scrollDown = () => $('thread').scrollTo({top: $('thread').scrollHeight, behavior: 'smooth'});

function resetEvidence(sub = 'Retrieved passages appear here') {
  $('evidenceSub').textContent = sub;
  document.querySelectorAll('#trace li').forEach(li => { li.className = ''; li.querySelector('em')?.remove(); });
  $('sources').replaceChildren();
}
function newChat() {
  conversationId = uuid(); sessionStorage.setItem('atlas_conversation_id', conversationId);
  transcript = []; answerSources.clear(); answerTraces.clear(); closePanel();
  $('thread').replaceChildren(); resetEvidence(); setEmpty(true); renderHistory();
  view('ask');
}
$('newChat').onclick = newChat;

function addUser(text) {
  threadInner().append(el('div', 'msg-user', text));
  transcript.push({role: 'user', content: text});
}

// Minimal, safe markdown: input is escaped first, then a few patterns are re-introduced.
function renderMarkdown(text) {
  const blocks = esc(text).trim().split(/\n{2,}/);
  return blocks.map(b => {
    const lines = b.split('\n');
    const bullet = lines.every(l => /^\s*[-*•]\s+/.test(l));
    const numbered = lines.every(l => /^\s*\d+[.)]\s+/.test(l));
    const inline = s => s
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[(\d{1,2})\]/g, '<button type="button" class="cite" data-n="$1" aria-label="Show source $1">$1</button>');
    if (bullet) return '<ul>' + lines.map(l => '<li>' + inline(l.replace(/^\s*[-*•]\s+/, '')) + '</li>').join('') + '</ul>';
    if (numbered) return '<ol>' + lines.map(l => '<li>' + inline(l.replace(/^\s*\d+[.)]\s+/, '')) + '</li>').join('') + '</ol>';
    return '<p>' + inline(b).replace(/\n/g, '<br>') + '</p>';
  }).join('');
}

function aiShell() {
  const wrap = el('div', 'msg-ai'); wrap.append(el('span', 'mini-orb'));
  const body = el('div', 'msg-body'); wrap.append(body);
  threadInner().append(wrap); return {wrap, body};
}

function addAnswer(r, trace) {
  const id = ++answerSeq;
  const {wrap, body} = aiShell();
  wrap.dataset.answer = id;
  body.innerHTML = renderMarkdown(r.answer);
  const sources = r.sources || [];
  answerSources.set(id, sources);
  if (trace) answerTraces.set(id, trace);
  transcript.push({role: 'assistant', content: r.answer, sources});

  const tools = el('div', 'msg-tools');
  if (sources.length) {
    const sb = el('button', 'src-btn'); sb.type = 'button';
    sb.innerHTML = ICON.doc + `<span>${sources.length} source${sources.length === 1 ? '' : 's'}</span>`;
    sb.setAttribute('aria-label', `Show ${sources.length} sources for this answer`);
    sb.onclick = () => (panelOpen() && activeAnswer === id) ? closePanel() : openPanel(id);
    tools.append(sb);
  }
  const copy = el('button', 'icon-btn'); copy.type = 'button'; copy.innerHTML = ICON.copy; copy.title = 'Copy answer'; copy.setAttribute('aria-label', 'Copy answer');
  copy.onclick = async () => { try { await navigator.clipboard.writeText(r.answer); toast('Answer copied'); } catch { toast('Copy is not available in this browser'); } };
  tools.append(copy);
  for (const [rating, icon, label] of [[1, ICON.up, 'Helpful'], [-1, ICON.down, 'Not helpful']]) {
    const b = el('button', 'icon-btn'); b.type = 'button'; b.innerHTML = icon; b.title = label; b.setAttribute('aria-label', label);
    b.onclick = async () => {
      try {
        await api('/api/feedback', {method: 'POST', body: JSON.stringify({rating})});
        tools.querySelectorAll('.icon-btn').forEach(x => x.classList.remove('voted')); b.classList.add('voted');
        toast('Thanks, feedback saved');
      } catch (e) { toast(e.message); }
    };
    tools.append(b);
  }
  body.append(tools);

  body.querySelectorAll('.cite').forEach(c => {
    if (!sources.some(s => s.index === +c.dataset.n)) { c.disabled = true; return; }
    c.onclick = () => { openPanel(id); setTimeout(() => highlightSource(+c.dataset.n), 120); };
  });
  return wrap;
}

function addNotice(kind, icon, title, text, action) {
  const {body} = aiShell();
  const n = el('div', 'notice ' + kind); n.innerHTML = icon;
  const t = el('div'); t.append(el('strong', '', title), el('p', '', text));
  if (action) t.append(action);
  n.append(t); body.append(n);
}

/* ---------- evidence pane ---------- */
function showSources(id) {
  activeAnswer = id;
  document.querySelectorAll('.src-btn').forEach(b => b.classList.toggle('on', b.closest('.msg-ai')?.dataset.answer == id));
  const list = answerSources.get(id) || [];
  const trace = answerTraces.get(id);
  $('trace').hidden = !trace;
  if (trace) STEPS.forEach(s => { const li = stepEl(s); li.className = trace.cls[s] || ''; li.querySelector('em')?.remove(); if (s === trace.timeOn) li.append(el('em', '', trace.time)); });
  const root = $('sources'); root.replaceChildren();
  $('evidenceSub').textContent = list.length ? `${list.length} passage${list.length === 1 ? '' : 's'} used for this answer` : 'No passages for this answer';
  if (!list.length) { root.append(el('p', 'evidence-empty', 'No passage scored above the relevance threshold, so the answer was not grounded in a document.')); return; }
  for (const s of list) {
    const card = el('article', 'src'); card.id = `src-${id}-${s.index}`;
    const top = el('div', 'src-top');
    top.append(el('span', 'src-n', s.index), el('span', 'src-title', s.title || 'Untitled document'), el('span', 'src-page', `p. ${s.page ?? 1}`));
    top.querySelector('.src-title').title = s.title || '';
    const text = el('p', 'src-text', s.excerpt || '');
    const foot = el('div', 'src-foot');
    if (typeof s.score === 'number') {
      const m = el('div', 'meter'); const i = el('i'); i.style.width = Math.max(4, Math.min(100, s.score * 100)) + '%'; m.append(i);
      foot.append(m, el('span', 'src-score', `${s.score.toFixed(2)} match`));
    }
    if ((s.excerpt || '').length > 220) {
      const more = el('button', 'src-more', 'Show more'); more.type = 'button';
      more.onclick = () => { const open = card.classList.toggle('open'); more.textContent = open ? 'Show less' : 'Show more'; };
      foot.append(more);
    }
    card.append(top, text, foot); root.append(card);
  }
}
function highlightSource(n) {
  const card = document.getElementById(`src-${activeAnswer}-${n}`); if (!card) return;
  document.querySelectorAll('.cite').forEach(c => c.classList.toggle('on', c.closest('.msg-ai')?.dataset.answer == activeAnswer && +c.dataset.n === n));
  card.scrollIntoView({behavior: 'smooth', block: 'nearest'});
  card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
  setTimeout(() => card.classList.remove('flash'), 1600);
}

// Pipeline trace. Steps advance on a timer while the request runs (shown in the loading line),
// then settle to the real outcome. The snapshot is shown in the evidence panel for that answer.
const STEPS = ['guard', 'embed', 'search', 'generate', 'validate'];
const STEP_LABEL = {guard: 'Checking input guardrail', embed: 'Embedding your question', search: 'Searching Pinecone', generate: 'Generating with Nova Lite', validate: 'Checking output guardrail'};
const stepEl = s => document.querySelector(`#trace [data-step="${s}"]`);
function traceRun(label) {
  let i = 0; label.textContent = STEP_LABEL[STEPS[0]];
  const timer = setInterval(() => { if (i < STEPS.length - 2) label.textContent = STEP_LABEL[STEPS[++i]]; }, 900);
  const started = performance.now();
  return outcome => {
    clearInterval(timer);
    const cls = {}; const set = (s, c) => cls[s] = c;
    if (outcome === 'blocked_input') { set('guard', 'fail'); STEPS.slice(1).forEach(s => set(s, 'skip')); }
    else if (outcome === 'pending_approval') { set('guard', 'held'); STEPS.slice(1).forEach(s => set(s, 'skip')); }
    else if (outcome === 'no_evidence') { ['guard', 'embed', 'search'].forEach(s => set(s, 'done')); set('generate', 'skip'); set('validate', 'skip'); }
    else if (outcome === 'guardrail_blocked') { STEPS.slice(0, 4).forEach(s => set(s, 'done')); set('validate', 'fail'); }
    else STEPS.forEach(s => set(s, 'done'));
    const timeOn = outcome === 'blocked_input' || outcome === 'pending_approval' ? 'guard' : 'validate';
    return {cls, timeOn, time: ((performance.now() - started) / 1000).toFixed(1) + 's'};
  };
}

$('composer').onsubmit = async e => {
  e.preventDefault();
  const text = q.value.trim(); if (text.length < 3 || busy) return;
  busy = true; q.value = ''; autosize();
  setEmpty(false); addUser(text);
  const {wrap, body} = aiShell(); wrap.classList.add('loading');
  body.innerHTML = '<span class="typing"><i></i><i></i><i></i></span><span class="typing-label"></span>';
  scrollDown();
  const finish = traceRun(body.querySelector('.typing-label'));
  try {
    const r = await api('/api/chat', {method: 'POST', body: JSON.stringify({question: text, conversation_id: conversationId})});
    wrap.remove();
    if (r.status === 'pending_approval') {
      finish('pending_approval');
      const go = el('button', 'btn btn-ghost btn-sm', 'Open approvals'); go.type = 'button'; go.onclick = () => view('approvals');
      addNotice('warn', ICON.hold, 'Held for human approval', 'This looks like an action, so it was queued for an administrator instead of being answered. Nothing has been changed.', go);
      transcript.push({role: 'assistant', content: r.answer});
      refreshApprovalCount();
    } else if (r.status === 'guardrail_blocked') {
      finish('guardrail_blocked');
      addNotice('bad', ICON.shield, 'Answer withheld by the output guardrail', 'The generated answer contained something that looks like a secret or credential, so it was not shown.');
      transcript.push({role: 'assistant', content: r.answer});
    } else if (r.status === 'no_evidence') {
      finish('no_evidence');
      addNotice('plain', ICON.search, 'No supporting passage found', 'Nothing in the indexed documents was relevant enough to answer from. Try rephrasing, or add the document to the Library.');
      transcript.push({role: 'assistant', content: r.answer});
    } else {
      addAnswer(r, finish('ok'));
    }
    if (r.status !== 'pending_approval') loadConversations();
  } catch (err) {
    wrap.remove();
    if (err.status === 400 && /guardrail/i.test(err.message)) {
      finish('blocked_input');
      addNotice('bad', ICON.shield, 'Blocked by the input guardrail', 'This request looks like prompt injection or an attempt to get secrets, so it never reached the model. The attempt was logged.');
    } else {
      finish('error');
      addNotice('bad', ICON.shield, 'Something went wrong', err.message + '. Check the server log, then try again.');
    }
  } finally { busy = false; autosize(); scrollDown(); syncChrome(); }
};

const NOTICE_TEXT = {
  'This request requires administrator approval before any action. Open the Approvals tab to review it.': ['warn', 'hold', 'Held for human approval', 'This was queued for an administrator instead of being answered. Nothing was changed.'],
  'The response was blocked by the sensitive-data output guardrail.': ['bad', 'shield', 'Answer withheld by the output guardrail', 'The generated answer looked like it contained a secret, so it was not shown.'],
  'I could not find supporting evidence in documents you are authorized to access.': ['plain', 'search', 'No supporting passage found', 'Nothing in the indexed documents was relevant enough to answer from.'],
};

async function openConversation(id) {
  view('ask');
  try {
    const {messages} = await api(`/api/conversations/${encodeURIComponent(id)}/messages`);
    conversationId = id; sessionStorage.setItem('atlas_conversation_id', id);
    transcript = []; answerSources.clear(); answerTraces.clear(); closePanel();
    $('thread').replaceChildren(); resetEvidence();
    setEmpty(!messages.length);
    for (const m of messages) {
      if (m.role === 'user') { addUser(m.content); continue; }
      const n = NOTICE_TEXT[m.content];
      if (n) { addNotice(n[0], ICON[n[1]], n[2], n[3]); transcript.push({role: 'assistant', content: m.content}); }
      else addAnswer({answer: m.content, sources: Array.isArray(m.sources) ? m.sources : []});
    }
    renderHistory(); syncChrome();
    requestAnimationFrame(() => $('thread').scrollTop = $('thread').scrollHeight);
  } catch (e) { toast(e.message); }
}

$('exportChat').onclick = () => {
  if (!transcript.length) return;
  const lines = [`# Atlas conversation`, ``, `Exported ${new Date().toLocaleString()}`, ``];
  for (const m of transcript) {
    lines.push(m.role === 'user' ? `## Question\n\n${m.content}\n` : `## Answer\n\n${m.content}\n`);
    if (m.sources?.length) lines.push('**Sources**\n', ...m.sources.map(s => `- [${s.index}] ${s.title}, page ${s.page}${typeof s.score === 'number' ? ` (match ${s.score.toFixed(2)})` : ''}`), '');
  }
  const a = el('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], {type: 'text/markdown'}));
  a.download = `atlas-conversation-${conversationId.slice(0, 8)}.md`; a.click(); URL.revokeObjectURL(a.href);
};

/* ---------- library ---------- */
const pill = status => el('span', 'pill ' + status, status);
function docRow(d) {
  const tr = el('tr');
  const name = el('td'); const wrap = el('div', 'doc-name'); wrap.append(el('span', 'file-ic', ext(d.title)), el('span', '', d.title)); name.append(wrap);
  const st = el('td'); st.append(pill(d.status));
  tr.append(name, st, el('td', 'num', d.current_version ? 'v' + d.current_version : '—'), el('td', 'muted', d.created_at ? fmtDate(d.created_at) : 'Just now'), docActions(d));
  return tr;
}
// Delete: inline confirm (no browser dialog). State lives outside the row so a
// table re-render (polling, uploads) keeps the confirm/deleting state intact.
let confirmDeleteId = null;
const deletingIds = new Set();
function docActions(d) {
  const td = el('td', 'doc-actions');
  const id = d.id && String(d.id);
  if (!id || IN_PROGRESS.has(d.status) && d.status !== 'pending') return td; // local rows / still indexing
  if (deletingIds.has(id)) { td.append(el('span', 'muted', 'Deleting…')); return td; }
  if (confirmDeleteId === id) {
    const cancel = el('button', 'btn btn-ghost btn-sm', 'Cancel'); cancel.type = 'button';
    cancel.onclick = () => { confirmDeleteId = null; renderDocs(); };
    const ok = el('button', 'btn btn-sm btn-reject', 'Delete'); ok.type = 'button';
    ok.setAttribute('aria-label', `Confirm delete ${d.title}`);
    ok.onclick = () => deleteDoc(d);
    td.append(cancel, ok); setTimeout(() => ok.focus(), 0);
    return td;
  }
  const b = el('button', 'icon-btn'); b.type = 'button'; b.innerHTML = ICON.trash;
  b.title = 'Delete document'; b.setAttribute('aria-label', `Delete ${d.title}`);
  b.onclick = () => { confirmDeleteId = id; renderDocs(); };
  td.append(b);
  return td;
}
async function deleteDoc(d) {
  const id = String(d.id);
  confirmDeleteId = null; deletingIds.add(id); renderDocs();
  try {
    await api(`/api/documents/${encodeURIComponent(id)}`, {method: 'DELETE'});
    serverDocs = serverDocs.filter(x => String(x.id) !== id);
    toast(`${d.title} deleted`);
  } catch (e) { toast(e.message); }
  finally { deletingIds.delete(id); await loadDocs(); }
}
// Uploads in flight, keyed by a local id. They are merged into every render so a
// concurrent table refresh can never wipe out (or freeze) an upload's row.
const localUploads = new Map(); // localId -> {title, status, document_id?, created_at}
let serverDocs = [];
let docsSeq = 0;
let docsPoll = null;
const IN_PROGRESS = new Set(['pending', 'processing', 'uploading', 'indexing']);

function renderDocs() {
  const body = $('docRows');
  const tracked = new Set([...localUploads.values()].map(u => u.document_id).filter(Boolean));
  // A local upload wins over its server row until the upload flow finishes.
  const rows = [...localUploads.values()].reverse().concat(serverDocs.filter(d => !tracked.has(String(d.id))));
  body.replaceChildren();
  if (!rows.length) { const r = el('tr'); const c = el('td', 'table-empty', 'No documents yet. Upload one above, then ask about it.'); c.colSpan = 5; r.append(c); body.append(r); return; }
  rows.forEach(d => body.append(docRow(d)));
}
function scheduleDocsPoll() {
  clearTimeout(docsPoll); docsPoll = null;
  // Keep polling while the server still reports work in progress (e.g. ingestion
  // finishing after a dropped request, or an upload started in another tab).
  if (serverDocs.some(d => IN_PROGRESS.has(d.status))) docsPoll = setTimeout(loadDocs, 3000);
}
async function loadDocs() {
  const seq = ++docsSeq;
  const body = $('docRows');
  if (!body.children.length && !localUploads.size) { const r = el('tr'); const c = el('td', 'table-empty', 'Loading documents…'); c.colSpan = 5; r.append(c); body.replaceChildren(r); }
  const docs = await refreshKb();
  if (seq !== docsSeq) return; // a newer load started; drop this stale response
  serverDocs = docs;
  renderDocs();
  scheduleDocsPoll();
}

async function uploadFile(f) {
  if (!f) return;
  if (!/\.(pdf|docx|txt|md)$/i.test(f.name)) { toast('Use a PDF, DOCX, TXT or MD file'); return; }
  if (f.size > 10485760) { toast('That file is over 10 MB'); return; }
  const localId = uuid();
  const entry = {title: f.name, status: 'uploading', created_at: null};
  localUploads.set(localId, entry);
  const setStatus = s => { entry.status = s; renderDocs(); };
  view('library');
  renderDocs();
  const zone = $('dropzone'); zone.classList.add('busy');
  $('file').value = '';
  try {
    const r = await api('/api/documents/uploads', {method: 'POST', body: JSON.stringify({filename: f.name})});
    entry.document_id = r.document_id;
    const up = await fetch(r.upload_url, {method: 'PUT', headers: r.headers, body: f});
    if (!up.ok) throw new Error('Upload to S3 failed. Check the bucket CORS settings');
    setStatus('indexing');
    await api('/api/documents/complete', {method: 'POST', body: JSON.stringify({document_id: r.document_id})});
    setStatus('ready');
    toast(`${f.name} is indexed and ready to ask about`);
  } catch (err) { setStatus('failed'); toast(err.message); }
  finally {
    zone.classList.remove('busy');
    // Hand the row back to the server list (which now holds the true status).
    await loadDocs();
    localUploads.delete(localId);
    renderDocs();
  }
}
$('file').onchange = () => uploadFile($('file').files[0]);
$('topUpload').onclick = $('attachBtn').onclick = () => $('file').click();
const dz = $('dropzone');
['dragenter', 'dragover'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.remove('over'); }));
dz.addEventListener('drop', e => uploadFile(e.dataTransfer.files[0]));

/* ---------- approvals ---------- */
let approvalFilter = 'pending', approvals = [];
document.querySelectorAll('.segmented button').forEach(b => b.onclick = () => {
  approvalFilter = b.dataset.filter;
  document.querySelectorAll('.segmented button').forEach(x => x.setAttribute('aria-selected', x === b));
  renderApprovals();
});
$('refreshApprovals').onclick = () => loadApprovals();
async function refreshApprovalCount() {
  try { approvals = (await api('/api/approvals')).approvals || []; } catch { return; }
  const pending = approvals.filter(a => a.status === 'pending').length;
  $('navApprovalCount').textContent = pending || '';
  $('cntPending').textContent = pending; $('cntAll').textContent = approvals.length;
}
async function loadApprovals() {
  const root = $('approvalList'); root.replaceChildren(el('div', 'ap muted', 'Loading approvals…'));
  try { await refreshApprovalCount(); renderApprovals(); }
  catch (e) { root.replaceChildren(el('div', 'ap muted', `Could not load approvals: ${e.message}`)); }
}
function renderApprovals() {
  const root = $('approvalList'); root.replaceChildren();
  const list = approvalFilter === 'pending' ? approvals.filter(a => a.status === 'pending') : approvals;
  const host = root.parentElement.querySelector('.empty-state'); host?.remove();
  if (!list.length) {
    const empty = el('div', 'empty-state'); empty.innerHTML = ICON.check;
    empty.append(el('strong', '', approvalFilter === 'pending' ? 'Nothing waiting for review' : 'No approval requests yet'),
      el('span', '', 'Ask something like “Delete the uploaded handbook” to see a request held here.'));
    root.after(empty); return;
  }
  for (const a of list) {
    const row = el('div', 'ap');
    row.append(el('div', 'ap-q', a.question));
    const meta = a.status === 'pending'
      ? `Requested by ${a.requester} · ${fmtDate(a.created_at)}`
      : `${a.status === 'approved' ? 'Approved' : 'Rejected'} by ${a.reviewer || 'unknown'} · ${fmtDate(a.reviewed_at)} · no action executed`;
    row.append(el('div', 'ap-meta', meta));
    const side = el('div', 'ap-side');
    if (a.status === 'pending') {
      const mk = (label, approve) => {
        const b = el('button', 'btn btn-sm ' + (approve ? 'btn-approve' : 'btn-reject'), label); b.type = 'button';
        b.onclick = () => confirmDecision(side, a, approve); return b;
      };
      side.append(mk('Reject', false), mk('Approve', true));
    } else side.append(pill(a.status));
    row.append(side); root.append(row);
  }
}
function confirmDecision(side, a, approve) {
  const word = approve ? 'Approve' : 'Reject';
  side.replaceChildren(el('span', 'ap-confirm', `${word}? Records a decision only.`));
  const cancel = el('button', 'btn btn-ghost btn-sm', 'Cancel'); cancel.type = 'button'; cancel.onclick = renderApprovals;
  const ok = el('button', 'btn btn-sm ' + (approve ? 'btn-approve' : 'btn-reject'), word); ok.type = 'button';
  ok.onclick = async () => {
    ok.disabled = cancel.disabled = true;
    try {
      const r = await api(`/api/approvals/${encodeURIComponent(a.id)}/decision`, {method: 'POST', body: JSON.stringify({approve})});
      toast(`Request ${r.status}. No action was executed.`); await loadApprovals();
    } catch (e) { toast(e.message); renderApprovals(); }
  };
  side.append(cancel, ok); ok.focus();
}

/* ---------- metrics ---------- */
$('refreshMetrics').onclick = () => loadMetrics();
function metricCard(title, sub, rows, tone = () => '', foot) {
  const c = el('section', 'mcard'); c.append(el('h3', '', title), el('p', 'sub', sub));
  const max = Math.max(1, ...rows.map(r => r[1]));
  if (!rows.length) c.append(el('p', 'mnone', 'No data yet'));
  for (const [label, n] of rows) {
    const r = el('div', 'mrow'); const bar = el('div', 'mbar ' + tone(label)); const i = el('i'); i.style.width = '0%'; bar.append(i);
    r.append(el('span', '', label), bar, el('b', '', n)); c.append(r);
    requestAnimationFrame(() => requestAnimationFrame(() => i.style.width = (n / max * 100) + '%'));
  }
  if (foot) c.append(el('p', 'mfoot', foot));
  return c;
}
async function loadMetrics() {
  const grid = $('metricGrid'); grid.replaceChildren(el('p', 'muted', 'Loading metrics…'));
  try {
    const [m, g] = await Promise.all([api('/api/admin/metrics'), api('/api/admin/guardrails')]);
    await refreshApprovalCount();
    const docTone = s => s === 'failed' ? 'bad' : s === 'ready' ? '' : 'warn';
    const fbLabel = r => +r === 1 ? 'helpful' : +r === -1 ? 'not helpful' : 'neutral';
    const grLabel = a => a === 'guardrail_input_blocked' ? 'input blocked' : a === 'guardrail_output_blocked' ? 'output blocked' : a;
    const apCounts = ['pending', 'approved', 'rejected'].map(s => [s, approvals.filter(a => a.status === s).length]).filter(r => r[1]);
    grid.replaceChildren(
      metricCard('Documents', 'By ingestion status', m.documents.map(d => [d.status, +d.total]), docTone),
      metricCard('Guardrail events', 'Requests stopped by the safety layer', g.events.map(e => [grLabel(e.action), +e.total]), () => 'bad', 'Deterministic rules · Bedrock managed guardrails off'),
      metricCard('Approvals', 'Human-in-the-loop decisions', apCounts, s => s === 'pending' ? 'warn' : s === 'rejected' ? 'bad' : ''),
      metricCard('Answer feedback', 'From the thumbs on each answer', m.feedback.map(f => [fbLabel(f.rating), +f.total]), l => l === 'not helpful' ? 'bad' : ''),
    );
  } catch (e) { grid.replaceChildren(el('p', 'muted', `Could not load metrics: ${e.message}`)); }
}

/* ---------- boot ---------- */
view('ask');
setEmpty(true);
autosize();
refreshKb();
loadConversations();
refreshApprovalCount();
