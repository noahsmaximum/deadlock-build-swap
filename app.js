import { HEROES, OTHER_NAMES } from './heroes.js';
import { F, decodeBuild, encodeBuild, warmup } from './build.js';

const $ = id => document.getElementById(id);
const heroById = new Map(HEROES.map(h => [h.id, h]));
const heroName = id => heroById.get(id)?.name ?? OTHER_NAMES[id] ?? `Hero #${id}`;
const heroImg = id => heroById.get(id)?.img ?? '';

const state = {
  build: null,    // decoded source build
  ref: null,      // decoded reference build (advanced)
  target: null,   // chosen hero id
  output: '',
};

// ---------- Hero grid ----------
const grid = $('grid');
for (const h of HEROES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'hero';
  b.dataset.id = h.id;
  b.dataset.name = h.name.toLowerCase();
  b.setAttribute('role', 'option');
  b.setAttribute('aria-selected', 'false');
  b.title = `${h.name} (ID ${h.id})`;
  b.innerHTML = `<img src="${h.img}" alt="" loading="lazy" referrerpolicy="no-referrer"><span class="hero-name"></span>`;
  b.querySelector('.hero-name').textContent = h.name;
  b.addEventListener('click', () => chooseHero(h.id));
  grid.append(b);
}
const emptyMsg = Object.assign(document.createElement('p'), { className: 'grid-empty', textContent: 'No heroes match.', hidden: true });
grid.append(emptyMsg);

$('search').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  let shown = 0;
  for (const b of grid.querySelectorAll('.hero')) {
    const hit = !q || b.dataset.name.includes(q) || b.dataset.id === q;
    b.hidden = !hit;
    shown += hit;
  }
  emptyMsg.hidden = shown > 0;
});

function markGrid() {
  for (const b of grid.querySelectorAll('.hero')) {
    const id = +b.dataset.id;
    b.classList.toggle('is-current', id === state.build?.heroId);
    b.setAttribute('aria-selected', String(id === state.target));
  }
}

// ---------- Source build ----------
const input = $('input');
let decodeSeq = 0;

async function loadInput() {
  const seq = ++decodeSeq;
  const text = input.value;
  $('inputError').hidden = true;
  if (!text.trim()) return setBuild(null);
  try {
    const build = await decodeBuild(text);
    if (seq === decodeSeq) setBuild(build);
  } catch (e) {
    if (seq !== decodeSeq) return;
    setBuild(null);
    $('inputError').textContent = e.message;
    $('inputError').hidden = false;
  }
}

function setBuild(build) {
  state.build = build;
  state.target = null;
  $('result').hidden = true;
  $('buildCard').hidden = !build;
  if (build) {
    $('bcName').textContent = build.name || 'Untitled build';
    $('bcHero').textContent = `${heroName(build.heroId)} (${build.heroId})`;
    $('bcId').textContent = build.buildId ?? '—';
    $('bcUpdated').textContent = build.updated ? new Date(build.updated * 1000).toLocaleDateString() : '—';
    $('bcDesc').textContent = build.desc;
    $('bcDesc').hidden = !build.desc;
    const img = heroImg(build.heroId);
    $('bcPortrait').src = img;
    $('bcPortrait').hidden = !img;
  }
  markGrid();
}

input.addEventListener('input', loadInput);

$('pasteBtn').addEventListener('click', async () => {
  try {
    input.value = (await navigator.clipboard.readText()).trim();
    loadInput();
  } catch {
    input.focus();
    toast('Clipboard blocked. Press Ctrl+V instead', true);
  }
});

// Ctrl+V anywhere outside a text field loads the build.
document.addEventListener('paste', e => {
  if (e.target.closest?.('textarea, input')) return;
  const text = e.clipboardData?.getData('text');
  if (!text) return;
  e.preventDefault();
  input.value = text.trim();
  loadInput();
});

// ---------- Reference build (advanced) ----------
$('refInput').addEventListener('input', async e => {
  const text = e.target.value;
  const status = $('refStatus');
  if (!text.trim()) { state.ref = null; status.textContent = ''; return refresh(); }
  try {
    state.ref = await decodeBuild(text);
    status.textContent = `Using ${heroName(state.ref.heroId)} · author ${state.ref.author}.`;
    if (state.build) chooseHero(state.ref.heroId);
  } catch (err) {
    state.ref = null;
    status.textContent = err.message;
    refresh();
  }
});

$('heroIdBtn').addEventListener('click', () => {
  const v = $('heroIdInput').value.trim();
  if (!/^\d+$/.test(v)) return toast('Enter a numeric hero ID', true);
  chooseHero(+v);
});

// ---------- Retarget + copy ----------
async function chooseHero(id) {
  if (!state.build) {
    input.focus();
    return toast('Paste a build first', true);
  }
  state.target = id;
  markGrid();
  // Clipboard writes need the click's user activation, so encode and copy right away.
  await refresh();
  await copyOutput();
}

// Strip earlier wrappers so names don't stack: "Copy of [X]" (game) and "[Hero] copy of X" (ours).
function baseName(name) {
  let n = name.trim(), prev;
  do {
    prev = n;
    n = n.replace(/^\[[^\]]*\] copy of /i, '');
    const m = n.match(/^Copy of \[(.*)\]$/s);
    if (m) n = m[1].trim();
  } while (n !== prev);
  return n || 'Untitled build';
}

const outputName = () => `[${heroName(state.build.heroId)}] copy of ${baseName(state.build.name)}`;

async function refresh() {
  if (!state.build || state.target == null) return;
  const overrides = {
    [F.HERO_ID]: state.target,
    [F.BUILD_ID]: 1,
    [F.UPDATED]: Math.floor(Date.now() / 1000),
    [F.NAME]: outputName(),
  };
  // A reference build only lends its author, and only when it belongs to the chosen hero.
  if (state.ref && state.ref.heroId === state.target && state.ref.author != null) overrides[F.AUTHOR] = state.ref.author;
  state.output = await encodeBuild(state.build, overrides);
  $('output').value = state.output;
  $('outName').textContent = overrides[F.NAME];
  $('fromImg').src = heroImg(state.build.heroId);
  $('fromName').textContent = heroName(state.build.heroId);
  $('toImg').src = heroImg(state.target);
  $('toName').textContent = heroName(state.target);
  $('result').hidden = false;
}

async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Async Clipboard API can be permission-blocked; the legacy path often still works.
    const out = $('output');
    out.focus();
    out.select();
    try { return document.execCommand('copy'); } catch { return false; }
  }
}

async function copyOutput() {
  if (!state.output) return;
  if (await writeClipboard(state.output)) {
    toast(`Copied "${$('outName').textContent}"`);
  } else {
    $('output').select();
    toast('Clipboard blocked. Text selected, press Ctrl+C', true);
  }
}

$('copyBtn').addEventListener('click', copyOutput);
$('output').addEventListener('focus', e => e.target.select());

// ---------- Toast ----------
let toastTimer;
function toast(msg, warn = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('warn', warn);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

warmup();
