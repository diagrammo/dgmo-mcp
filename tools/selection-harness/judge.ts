// LLM selection-JUDGE harness. Sibling to the deterministic phrase-tuning page
// (index.html): instead of editing trigger phrases, you edit the real chart-type
// DESCRIPTIONS — the guidance an LLM gets to pick a chart — and re-run `claude -p`
// over the corpus to see whether your edit moved selection accuracy. Each case
// shows the LLM's pick + reason beside the deterministic scorer's pick, so the
// disagreements (LLM vs triggers) surface both weak guidance and too-narrow
// corpus accept[] sets. Save writes descriptions to registry.json + dgmo source.
//
// Mirrors the triggers page: FILTER to interesting cases, SELECT a case to sort
// + role-colour its relevant descriptions to the top (so you tune exactly the
// guidance that case depends on), EDIT a case's prompt/accept inline, and RE-RUN
// a single case. State (verdicts, unsaved description edits, filter) persists to
// localStorage so navigating to the triggers page and back keeps the results.
//
// A verdict is CLEAN while its prompt + the description catalog are unchanged
// since it was judged, DIRTY once any description changes (the LLM sees the whole
// catalog, so any edit invalidates every verdict), UNJUDGED for a new/edited
// prompt. "Run stale" re-judges only dirty + unjudged cases.
import { createSuggester } from '../../src/suggest/scoring.js';
import type { Corpus } from './diff-run';
import { chartTypes } from '@diagrammo/dgmo/internal';

type Case = { prompt: string; accept: string[]; wontfix?: boolean };
type Verdict = { prompt: string; pick: string; reason: string; catalogHash: string };
type Filter = 'all' | 'fail' | 'disagree' | 'dirty' | 'unjudged';

const LS_EDITS = 'judge:v1:edits';
const LS_VERDICTS = 'judge:v2:verdicts'; // v2: parser fix (drop stale "water"-style parses)
const LS_FILTER = 'judge:v1:filter';

let descriptions: Record<string, string> = {}; // saved baseline (registry.json)
let edits: Record<string, string> = {}; // unsaved overrides (persisted)
let ids: string[] = [];
let triggers: Record<string, { phrases: string[]; concepts: string[] }> = {};
let corpus: Corpus & { cases: Case[] } = { baseline: 0, dgmoVersion: '', cases: [] };
const verdicts = new Map<string, Verdict>(); // by prompt (persisted)
let prevPicks = new Map<string, string>(); // previous run's picks (for Δ)
let filter: Filter = 'all';
let selectedPrompt: string | null = null; // focus → relevant descriptions to top
let editingPrompt: string | null = null; // inline prompt/accept editor
let running = false;

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// ---- descriptions / catalog -------------------------------------------------
function currentDescriptions(): Record<string, string> {
  return { ...descriptions, ...edits };
}
/** Catalog string the server builds (sorted "- id: desc"); hashed to detect
 *  guidance changes. Mirrors judge-engine.buildCatalog ordering. */
function catalogHash(d: Record<string, string>): string {
  const catalog = Object.keys(d)
    .sort()
    .map((id) => `- ${id}: ${d[id]}`)
    .join('\n');
  let h = 0x811c9dc5;
  for (let i = 0; i < catalog.length; i++) {
    h ^= catalog.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
const isEdited = (id: string): boolean =>
  edits[id] !== undefined && edits[id] !== descriptions[id];

// ---- persistence ------------------------------------------------------------
function persist(): void {
  try {
    localStorage.setItem(LS_EDITS, JSON.stringify(edits));
    localStorage.setItem(LS_VERDICTS, JSON.stringify([...verdicts.values()]));
    localStorage.setItem(LS_FILTER, filter);
  } catch {
    /* quota / privacy mode — non-fatal */
  }
}
function restore(): void {
  try {
    const e = localStorage.getItem(LS_EDITS);
    if (e) edits = JSON.parse(e);
    const v = localStorage.getItem(LS_VERDICTS);
    if (v) for (const x of JSON.parse(v) as Verdict[]) verdicts.set(x.prompt, x);
    const f = localStorage.getItem(LS_FILTER) as Filter | null;
    if (f) filter = f;
  } catch {
    /* ignore corrupt state */
  }
}

function phrasesMap(): Record<string, string[]> {
  const m: Record<string, string[]> = {};
  for (const [id, e] of Object.entries(triggers)) m[id] = e.phrases.slice();
  return m;
}
const detPick = (prompt: string): string =>
  createSuggester(phrasesMap()).suggestChartTypes(prompt).ranked[0]?.type.id ?? '∅';

type State = 'clean' | 'dirty' | 'unjudged';
function caseState(prompt: string, curHash: string): State {
  const v = verdicts.get(prompt);
  if (!v) return 'unjudged';
  return v.catalogHash === curHash ? 'clean' : 'dirty';
}
const activePrompts = (): string[] =>
  corpus.cases.filter((c) => !c.wontfix).map((c) => c.prompt);
function stalePrompts(): string[] {
  const cur = catalogHash(currentDescriptions());
  return activePrompts().filter((p) => caseState(p, cur) !== 'clean');
}

/** Does a case match the active filter? (curHash threads the dirty check.) */
function matchesFilter(c: Case, f: Filter, curHash: string): boolean {
  if (f === 'all') return true;
  const st = caseState(c.prompt, curHash);
  if (f === 'dirty') return st === 'dirty';
  if (f === 'unjudged') return st === 'unjudged';
  const v = verdicts.get(c.prompt);
  if (!v) return false;
  if (f === 'fail') return !c.accept.includes(v.pick);
  if (f === 'disagree') return v.pick !== detPick(c.prompt);
  return true;
}

async function run(prompts: string[]): Promise<void> {
  if (running || !prompts.length) return;
  running = true;
  prevPicks = new Map([...verdicts].map(([p, v]) => [p, v.pick]));
  setStatus(`running ${prompts.length} via claude -p… (~${Math.ceil(prompts.length / 6) * 3}s)`);
  renderControls();
  const hash = catalogHash(currentDescriptions());
  try {
    const res = await fetch('/judge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ descriptions: currentDescriptions(), prompts }),
    });
    const json = (await res.json()) as { ok: boolean; verdicts?: Verdict[]; error?: string };
    if (!json.ok) throw new Error(json.error ?? 'judge failed');
    for (const v of json.verdicts!) verdicts.set(v.prompt, { ...v, catalogHash: hash });
    persist();
    setStatus('');
  } catch (err) {
    setStatus('✗ ' + String(err), true);
  } finally {
    running = false;
    render();
  }
}

function setStatus(msg: string, bad = false): void {
  const el = document.getElementById('status')!;
  el.textContent = msg;
  el.className = bad ? 'regressed' : 'hint';
}

function renderControls(): void {
  const stale = stalePrompts().length;
  (document.getElementById('run-all') as HTMLButtonElement).disabled = running;
  (document.getElementById('run-sample') as HTMLButtonElement).disabled = running;
  const sb = document.getElementById('run-stale') as HTMLButtonElement;
  sb.disabled = running || stale === 0;
  sb.textContent = `Run stale (${stale})`;
}

/** Inline prompt/accept editor for a case (mirrors the triggers page). */
function editForm(c: Case): string {
  return (
    `<div class="case editing" data-prompt="${esc(c.prompt)}">` +
    `<input class="edit-input edit-prompt" value="${esc(c.prompt)}" placeholder="prompt text" />` +
    `<input class="edit-input edit-accept" value="${esc(c.accept.join(', '))}" placeholder="accept ids, comma-separated" />` +
    `<div class="case-btns" style="margin-top:6px"><button class="case-action" data-save-edit="1">save</button>` +
    `<button class="case-action" data-cancel-edit="1">cancel</button></div></div>`
  );
}

function render(): void {
  const resultsScroll = document.getElementById('results')?.scrollTop ?? 0;
  const editorsScroll = document.getElementById('editors')?.scrollTop ?? 0;
  renderControls();
  const cases = corpus.cases.filter((c) => !c.wontfix);
  const curHash = catalogHash(currentDescriptions());
  const judged = cases.filter((c) => verdicts.has(c.prompt));

  // Accuracy over judged cases (+ Δ vs last run); dirty/unjudged surfaced too.
  let llmOk = 0,
    detOk = 0,
    agree = 0,
    improved = 0,
    worsened = 0,
    dirty = 0,
    unjudged = 0,
    fail = 0,
    disagree = 0;
  for (const c of cases) {
    const st = caseState(c.prompt, curHash);
    if (st === 'dirty') dirty++;
    if (st === 'unjudged') unjudged++;
    const v = verdicts.get(c.prompt);
    if (!v) continue;
    const lo = c.accept.includes(v.pick);
    const dp = detPick(c.prompt);
    if (lo) llmOk++;
    else fail++;
    if (c.accept.includes(dp)) detOk++;
    if (v.pick === dp) agree++;
    else disagree++;
    const prev = prevPicks.get(c.prompt);
    if (prev !== undefined && prev !== v.pick) {
      if (!c.accept.includes(prev) && lo) improved++;
      else if (c.accept.includes(prev) && !lo) worsened++;
    }
  }
  const n = judged.length;
  document.getElementById('summary')!.innerHTML = n
    ? `LLM <b>${llmOk}/${n}</b> (${((100 * llmOk) / n).toFixed(0)}%) · deterministic <b>${detOk}/${n}</b> · agree ${agree}` +
      (dirty ? ` · <span class="warn">${dirty} dirty</span>` : '') +
      (unjudged ? ` · <span class="hint">${unjudged} unjudged</span>` : '') +
      (prevPicks.size
        ? ` · <span class="fixed">Δ +${improved}</span>/<span class="regressed">-${worsened}</span> vs last run`
        : '')
    : `${cases.length} active cases · not yet judged — hit Run`;

  // Filter bar.
  const counts: Record<Filter, number> = {
    all: cases.length,
    fail,
    disagree,
    dirty,
    unjudged,
  };
  const labels: Record<Filter, string> = {
    all: 'all',
    fail: 'failures',
    disagree: 'disagree',
    dirty: 'dirty',
    unjudged: 'unjudged',
  };
  document.getElementById('filters')!.innerHTML = (
    ['all', 'fail', 'disagree', 'dirty', 'unjudged'] as Filter[]
  )
    .map(
      (f) =>
        `<span class="chip${filter === f ? ' active' : ''}" data-filter="${f}">${labels[f]} ${counts[f]}</span>`
    )
    .join('');

  // Results: filtered, stale-first then failures/disagreements, then rest.
  const rank = (c: Case): number => {
    const st = caseState(c.prompt, curHash);
    if (st === 'unjudged') return 0;
    if (st === 'dirty') return 1;
    const v = verdicts.get(c.prompt)!;
    if (!c.accept.includes(v.pick)) return 2;
    if (v.pick !== detPick(c.prompt)) return 3;
    return 4;
  };
  const shown = cases
    .filter((c) => matchesFilter(c, filter, curHash))
    .sort((a, b) => rank(a) - rank(b));
  document.getElementById('results')!.innerHTML =
    `<h2>Cases (${shown.length}${shown.length !== cases.length ? ` of ${cases.length}` : ''} shown)</h2>` +
    (shown.length === 0
      ? '<p class="hint">No cases match this filter.</p>'
      : shown
          .map((c) => {
            if (editingPrompt === c.prompt) return editForm(c);
            const st = caseState(c.prompt, curHash);
            const v = verdicts.get(c.prompt);
            const selCls =
              selectedPrompt === c.prompt
                ? ' selected'
                : selectedPrompt
                  ? ' dimmed'
                  : '';
            const btns =
              `<div class="case-btns"><button class="case-action" data-edit="${esc(c.prompt)}" title="edit prompt / accepted ids">edit</button>` +
              `<button class="case-action" data-rerun="${esc(c.prompt)}" title="re-judge just this case">re-run</button></div>`;
            if (!v)
              return (
                `<div class="case pending${selCls}" data-prompt="${esc(c.prompt)}">` +
                `<div class="case-head"><div class="prompt">${esc(c.prompt)}</div><span class="badge new">unjudged</span>${btns}</div>` +
                `<div class="accept">accept: ${c.accept.map(esc).join(' / ')}</div></div>`
              );
            const lo = c.accept.includes(v.pick);
            const dp = detPick(c.prompt);
            const dis = v.pick !== dp;
            const cls = st === 'dirty' ? 'dirty' : lo ? (dis ? 'disagree' : 'pass') : 'fail';
            const badge = st === 'dirty' ? '<span class="badge dirty">dirty</span>' : '';
            // When the LLM picked a type not in accept[], offer to bless it as a
            // valid answer (widens accept[] — the "LLM is right, corpus too narrow"
            // case). Shown only on LLM-misses.
            const acceptBtn =
              v.pick && !lo
                ? `<button class="case-action accept-pick" data-accept-pick="${esc(c.prompt)}" title="add the LLM's pick to accept[]">+accept ${esc(v.pick)}</button>`
                : '';
            return (
              `<div class="case ${cls}${selCls}" data-prompt="${esc(c.prompt)}">` +
              `<div class="case-head"><div class="prompt">${esc(c.prompt)}</div>${badge}<div class="case-btns">${acceptBtn}<button class="case-action" data-edit="${esc(c.prompt)}" title="edit prompt / accepted ids">edit</button><button class="case-action" data-rerun="${esc(c.prompt)}" title="re-judge just this case">re-run</button></div></div>` +
              `<div class="accept">accept: ${c.accept.map(esc).join(' / ')}</div>` +
              `<div class="row"><span class="label" title="what claude -p picked from the editable descriptions (the guidance pass this page tunes)">llm</span><span class="id ${lo ? 'good' : 'bad'}">${esc(v.pick || '∅')}</span> <span class="hint">${esc(v.reason)}</span></div>` +
              `<div class="row"><span class="label" title="what the shipped phrase scorer (triggers.json, no LLM) picks — the suggest_chart_type baseline">deterministic</span><span class="id ${c.accept.includes(dp) ? 'good' : 'bad'}">${esc(dp)}</span> ${dis ? '<span class="warn">⇄ disagree</span>' : '<span class="hint">= agree</span>'}</div>` +
              `</div>`
            );
          })
          .join(''));

  // Descriptions pane: when a case is selected, its relevant types (accept ∪
  // {llm pick, deterministic pick}) sort to the top, role-coloured (accept =
  // green, the LLM's wrong pick = red) — so you tune exactly the guidance that
  // case turns on, then re-run it.
  const roleById: Record<string, 'match' | 'miss'> = {};
  const selCase = selectedPrompt
    ? cases.find((c) => c.prompt === selectedPrompt)
    : null;
  if (selCase) {
    selCase.accept.forEach((a) => (roleById[a] = 'miss'));
    const v = verdicts.get(selCase.prompt);
    if (v && v.pick && !selCase.accept.includes(v.pick)) roleById[v.pick] = 'match';
    const dp = detPick(selCase.prompt);
    if (dp && !roleById[dp]) roleById[dp] = 'match';
  }
  const relevant = Object.keys(roleById).sort();
  const relevantSet = new Set(relevant);
  const ordered = selCase
    ? [...relevant, ...ids.filter((id) => !relevantSet.has(id))]
    : ids;
  document.getElementById('editors')!.innerHTML =
    `<h2>Descriptions (${ids.length})</h2>` +
    `<div class="hint" style="margin-bottom:8px">edit the guidance the LLM sees → editing dirties results (LLM sees the whole catalog). Run stale / per-case re-run. Save writes registry.json + dgmo/src/chart-types.ts.</div>` +
    (selCase
      ? `<div class="editor focus-banner"><div class="head"><b>selected</b> <span class="hint">${esc(selCase.prompt)}</span> <button id="clear-select">show all</button></div></div>`
      : '') +
    ordered
      .map((id) => {
        const val = edits[id] ?? descriptions[id] ?? '';
        const ed = isEdited(id) ? ' edited' : '';
        const role = roleById[id] ?? '';
        const rel = relevantSet.has(id) ? ' relevant' : '';
        return (
          `<div class="editor${ed}${rel}"><div class="head"><b class="${role}">${esc(id)}</b>${ed ? ' <span class="warn">●</span>' : ''}</div>` +
          `<textarea data-desc-id="${esc(id)}" rows="2">${esc(val)}</textarea></div>`
        );
      })
      .join('');

  const rEl = document.getElementById('results');
  if (rEl) rEl.scrollTop = resultsScroll;
  const eEl = document.getElementById('editors');
  if (eEl) eEl.scrollTop = editorsScroll;
  if (editingPrompt) {
    const pi = document.querySelector<HTMLInputElement>('.edit-prompt');
    pi?.focus();
    pi?.select();
  }
}

// ---- events -----------------------------------------------------------------
document.getElementById('run-all')!.addEventListener('click', () => run(activePrompts()));
document.getElementById('run-stale')!.addEventListener('click', () => run(stalePrompts()));
document.getElementById('run-sample')!.addEventListener('click', () => {
  const all = activePrompts();
  const step = Math.max(1, Math.ceil(all.length / 25));
  run(all.filter((_, i) => i % step === 0).slice(0, 25));
});

document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const f = t.getAttribute('data-filter');
  if (f) {
    filter = f as Filter;
    persist();
    render();
    return;
  }
  if (t.id === 'clear-select') {
    selectedPrompt = null;
    render();
    return;
  }
  const acceptPick = t.getAttribute('data-accept-pick');
  if (acceptPick) {
    const c = corpus.cases.find((k) => k.prompt === acceptPick);
    const pick = verdicts.get(acceptPick)?.pick;
    if (c && pick && ids.includes(pick) && !c.accept.includes(pick)) {
      c.accept = [...c.accept, pick];
      void saveCorpus();
      render();
    }
    return;
  }
  const rerun = t.getAttribute('data-rerun');
  if (rerun) {
    run([rerun]);
    return;
  }
  const edit = t.getAttribute('data-edit');
  if (edit) {
    editingPrompt = edit;
    render();
    return;
  }
  if (t.hasAttribute('data-save-edit')) {
    saveCaseEdit();
    return;
  }
  if (t.hasAttribute('data-cancel-edit')) {
    editingPrompt = null;
    render();
    return;
  }
  // Click a case body → select/deselect (focus its relevant descriptions).
  const caseEl = t.closest('.case[data-prompt]') as HTMLElement | null;
  if (caseEl && !caseEl.classList.contains('editing')) {
    const p = caseEl.getAttribute('data-prompt')!;
    selectedPrompt = selectedPrompt === p ? null : p;
    render();
  }
});

// Track description edits (persist + edited dot); refresh dirty badges on blur.
document.addEventListener('input', (e) => {
  const t = e.target as HTMLTextAreaElement;
  if (!t.matches?.('textarea[data-desc-id]')) return;
  const id = t.getAttribute('data-desc-id')!;
  const val = t.value.trim();
  if (val === (descriptions[id] ?? '')) delete edits[id];
  else edits[id] = val;
  persist();
  t.closest('.editor')?.classList.toggle('edited', isEdited(id));
});
document.addEventListener(
  'blur',
  (e) => {
    const t = e.target as HTMLElement;
    if (t.matches?.('textarea[data-desc-id]')) render();
  },
  true
);
// Inline case editor: Enter saves, Esc cancels.
document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (!t.classList?.contains('edit-input')) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    saveCaseEdit();
  } else if (e.key === 'Escape') {
    editingPrompt = null;
    render();
  }
});

/** Commit an inline case edit → update corpus + persist to disk (via /save). A
 *  prompt rename invalidates the old verdict (becomes unjudged → re-runnable). */
async function saveCaseEdit(): Promise<void> {
  const oldPrompt = editingPrompt;
  if (!oldPrompt) return;
  const c = corpus.cases.find((k) => k.prompt === oldPrompt);
  if (!c) {
    editingPrompt = null;
    render();
    return;
  }
  const newPrompt = document.querySelector<HTMLInputElement>('.edit-prompt')?.value.trim();
  const acceptRaw = document.querySelector<HTMLInputElement>('.edit-accept')?.value ?? '';
  if (!newPrompt) return;
  const accept = acceptRaw.split(',').map((s) => s.trim()).filter(Boolean);
  const idSet = new Set(ids);
  const unknown = accept.filter((a) => !idSet.has(a));
  if (!accept.length || unknown.length) {
    window.alert(unknown.length ? `Unknown id(s): ${unknown.join(', ')}` : 'accept cannot be empty');
    return;
  }
  if (newPrompt !== oldPrompt) {
    verdicts.delete(oldPrompt); // stale — re-judge under the new wording
    if (selectedPrompt === oldPrompt) selectedPrompt = newPrompt;
  }
  c.prompt = newPrompt;
  c.accept = accept;
  editingPrompt = null;
  persist();
  await saveCorpus();
  render();
}

/** Persist the corpus (and unchanged triggers) to disk via the shared /save. */
async function saveCorpus(): Promise<void> {
  try {
    await fetch('/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ triggers, corpus }),
    });
  } catch {
    setStatus('✗ corpus save failed', true);
  }
}

document.getElementById('save')!.addEventListener('click', async () => {
  const status = document.getElementById('save-status')!;
  status.textContent = 'saving…';
  status.className = 'hint';
  try {
    const res = await fetch('/save-descriptions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ descriptions: currentDescriptions() }),
    });
    const json = (await res.json()) as {
      ok: boolean;
      error?: string;
      dgmo?: { patched: string[]; skipped: string[] };
    };
    if (!json.ok) throw new Error(json.error ?? 'save failed');
    descriptions = currentDescriptions();
    edits = {};
    persist();
    const dg = json.dgmo;
    status.innerHTML = `<span class="saved">✓ saved — registry.json + dgmo (${dg?.patched.length ?? 0} patched${dg?.skipped.length ? `, ${dg.skipped.length} skipped` : ''}). Release dgmo to apply to the scorer.</span>`;
    render();
  } catch (err) {
    status.textContent = '✗ ' + String(err);
    status.className = 'regressed';
  }
});

async function init(): Promise<void> {
  restore();
  const [d, data] = await Promise.all([
    fetch('/descriptions').then((r) => r.json()),
    fetch('/data').then((r) => r.json()),
  ]);
  descriptions = (d as { descriptions: Record<string, string> }).descriptions;
  ids = (d as { ids: string[] }).ids.slice().sort();
  triggers = (data as { triggers: typeof triggers }).triggers;
  corpus = (data as { corpus: typeof corpus }).corpus;
  if (!ids.length) ids = chartTypes.map((t) => t.id).sort();
  render();
}
void init();
