// Selection-tuning harness UI. Deterministic, no LLM, no rendering: it scores a
// corpus of (prompt → accept[]) cases with the REAL scorer, diagnoses each
// failure (false-match vs false-miss with score breakdowns + fired phrases),
// lets you edit per-type phrases with an instant whole-corpus re-score, guards
// against whack-a-mole via a net-delta vs the on-load baseline, and saves edits
// back to triggers.json + the corpus. See tech-spec-selection-tuning-harness.md.
import {
  createSuggester,
  PRIOR_MAX,
  type PriorMap,
} from '../../src/suggest/scoring.js';
import {
  diffRun,
  passingPrompts,
  type Corpus,
  type SuggesterState,
} from './diff-run';
import { chartTypes } from '@diagrammo/dgmo/internal';

type Phrases = string[];
interface TriggerEntry {
  phrases: Phrases;
  concepts: string[];
  /** Popularity prior 0–PRIOR_MAX (absent/0 = no bias). */
  prior?: number;
}
type TriggerData = Record<string, TriggerEntry>;
type RegistryType = { id: string; description: string; fallback?: boolean };

const byId = new Map<string, RegistryType>(chartTypes.map((t) => [t.id, t]));

// Mutable working state, loaded fresh from the dev server at startup (GET /data)
// — NOT imported as a Vite module, so a reload always reflects disk and never
// serves a stale snapshot. `triggers` is the full {phrases,concepts} map we edit
// and save; `corpus` grows via add-a-case; `baselinePhrases` is the net-delta
// reference (the phrases at load or last save).
type Case = {
  prompt: string;
  accept: string[];
  wontfix?: boolean;
  note?: string;
};
let triggers: TriggerData = {};
let corpus: Corpus & { cases: Case[] } = {
  baseline: 0,
  dgmoVersion: '',
  cases: [],
};
let baselineState: SuggesterState = { map: {}, priors: {} };
// Failing-only by default; the header toggle reveals the passing list.
let showPassing = false;
// When set, that case's types sort to the top of the editors pane and get
// red/green role colouring. Click a failing case to focus; click again to clear.
let focusedPrompt: string | null = null;
// When set, that case renders as an in-place editor (prompt + accept inputs).
let editingPrompt: string | null = null;
// Last per-edit result (what one phrase add/remove did to matching) — shown in
// the flash strip so an edit gives visible feedback instead of a silent rebuild.
let lastEditMsg = '';
// After a phrase add, re-focus that type's add-field so you can keep typing.
let refocusAddId: string | null = null;

function phrasesMap(): Record<string, string[]> {
  const m: Record<string, string[]> = {};
  for (const [id, entry] of Object.entries(triggers))
    m[id] = entry.phrases.slice();
  return m;
}

/** Popularity priors derived from the working triggers — only non-zero. */
function priorsMap(): PriorMap {
  const m: PriorMap = {};
  for (const [id, entry] of Object.entries(triggers))
    if (entry.prior && entry.prior > 0) m[id] = entry.prior;
  return m;
}

/** The full scorer state (phrases + priors). Builds fresh objects each call, so
 *  capturing it before a mutation yields an independent net-delta snapshot. */
function currentState(): SuggesterState {
  return { map: phrasesMap(), priors: priorsMap() };
}

// Undo stack: a snapshot of the full trigger map is pushed BEFORE every phrase
// mutation, so Undo reverts one edit at a time. Cleared on Save (the saved
// state becomes the new floor).
const undoStack: TriggerData[] = [];

function pushUndo(): void {
  undoStack.push(structuredClone(triggers));
}

function restoreTriggers(snapshot: TriggerData): void {
  for (const k of Object.keys(triggers)) delete triggers[k];
  Object.assign(triggers, structuredClone(snapshot));
}

const esc = (s: string): string =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!
  );
const fmt = (n: number): string => (n === 0 ? '0' : n.toFixed(n < 10 ? 2 : 0));
const isSingleToken = (p: string): boolean =>
  p.trim().split(/\s+/).length === 1;

function brk(b?: { contig: number; idf: number; desc: number }): string {
  if (!b) return '';
  return `<span class="brk">[c${fmt(b.contig)} i${fmt(b.idf)} d${fmt(b.desc)}]</span>`;
}

interface Scored {
  prompt: string;
  accept: string[];
  top1?: string;
  pass: boolean;
  wontfix?: boolean;
  note?: string;
  ranked: {
    id: string;
    score: number;
    matched: string[];
    breakdown?: { contig: number; idf: number; desc: number; prior?: number };
  }[];
}

function scoreAll(): Scored[] {
  const s = currentState();
  const suggester = createSuggester(s.map, s.priors);
  return corpus.cases.map((c) => {
    const result = suggester.suggestChartTypes(c.prompt);
    const ranked = result.ranked.map((r) => ({
      id: r.type.id,
      score: r.score,
      matched: r.matched,
      breakdown: r.breakdown,
    }));
    const top1 = ranked[0]?.id;
    return {
      prompt: c.prompt,
      accept: c.accept,
      top1,
      pass: !!top1 && c.accept.includes(top1),
      wontfix: c.wontfix,
      note: c.note,
      ranked,
    };
  });
}

function scoreLine(
  prompt: string,
  id: string
): {
  score: number;
  matched: string[];
  breakdown?: { contig: number; idf: number; desc: number; prior?: number };
} {
  const type = byId.get(id);
  if (!type) return { score: 0, matched: [] };
  const s = currentState();
  return createSuggester(s.map, s.priors).scoreChartType(prompt, type);
}

function phraseChips(id: string): string {
  // All phrases for the type's editor. Clicking a chip removes the phrase.
  const list = triggers[id]?.phrases ?? [];
  return list
    .map((p) => {
      const cls = 'phrase' + (isSingleToken(p) ? ' single' : '');
      return `<span class="${cls}" data-rm-id="${esc(id)}" data-rm-phrase="${esc(p)}" title="remove">${esc(p)}</span>`;
    })
    .join('');
}

function firedPhrases(matched: string[]): string {
  if (!matched.length)
    return '<span class="hint">— no phrase fired (idf/desc only)</span>';
  return matched
    .map(
      (p) =>
        `<span class="phrase${isSingleToken(p) ? ' single' : ''}">${esc(p)}</span>`
    )
    .join('');
}

/** Set the flash strip to describe what one phrase edit did to matching:
 *  re-score the whole corpus before→after this single change. */
function describeEdit(label: string, before: SuggesterState): void {
  const after = currentState();
  const d = diffRun(before, after, corpus);
  const passNow = passingPrompts(after, corpus).size;
  const activeTotal = corpus.cases.filter((c) => !c.wontfix).length;
  let outcome: string;
  if (d.fixed.length || d.regressed.length) {
    const parts: string[] = [];
    if (d.fixed.length)
      parts.push(`<span class="fixed">fixed ${d.fixed.length}</span>`);
    if (d.regressed.length)
      parts.push(
        `<span class="regressed">regressed ${d.regressed.length}</span>`
      );
    outcome =
      parts.join(' / ') +
      (d.regressed.length
        ? ` <span class="regressed">(${d.regressed.map((p) => `“${esc(p)}”`).join(', ')})</span>`
        : '');
  } else {
    outcome = '<span class="hint">no change to matching</span>';
  }
  lastEditMsg = `${esc(label)} — ${outcome} <span class="hint">· now ${passNow}/${activeTotal} active · applied live (unsaved — click Save to persist)</span>`;
}

/** In-place editor for a case: prompt + accept inputs with save/cancel. Not a
 *  `.case.fail`, so it doesn't trigger the focus-on-click behavior. */
function editForm(s: Scored): string {
  return (
    `<div class="case editing" data-prompt="${esc(s.prompt)}">` +
    `<input class="edit-input edit-prompt" value="${esc(s.prompt)}" placeholder="prompt text" />` +
    `<input class="edit-input edit-accept" value="${esc(s.accept.join(', '))}" placeholder="accept ids, comma-separated" />` +
    `<div class="case-btns" style="margin-top: 6px">` +
    `<button class="case-action" data-save-edit="1">save</button>` +
    `<button class="case-action" data-cancel-edit="1">cancel</button></div></div>`
  );
}

function render(): void {
  // Preserve scroll across the innerHTML rebuild so edits don't jump the page.
  const casesScroll = document.getElementById('cases')?.scrollTop ?? 0;
  const editorsScroll = document.getElementById('editors')?.scrollTop ?? 0;

  const scored = scoreAll();
  // Active = cases we're trying to land; parked (won't-fix) are excluded from
  // the accuracy math and listed separately as known-limitations.
  const active = scored.filter((s) => !s.wontfix);
  const parked = scored.filter((s) => s.wontfix);
  const pass = active.filter((s) => s.pass).length;
  const total = active.length;
  const failing = active.filter((s) => !s.pass);

  // Summary.
  document.getElementById('summary')!.innerHTML =
    `top-1 <b>${pass}/${total}</b> active (${total ? ((100 * pass) / total).toFixed(0) : '0'}%) · baseline ${corpus.baseline} · ${failing.length} failing` +
    (parked.length ? ` · ${parked.length} parked` : '');

  // Undo button reflects the pending-edit stack depth.
  const undoBtn = document.getElementById('undo') as HTMLButtonElement;
  undoBtn.disabled = undoStack.length === 0;
  undoBtn.textContent = undoStack.length
    ? `Undo (${undoStack.length})`
    : 'Undo';

  // Net delta vs on-load/last-saved baseline.
  const delta = diffRun(baselineState, currentState(), corpus);
  const deltaEl = document.getElementById('delta')!;
  if (!delta.fixed.length && !delta.regressed.length) {
    deltaEl.className = 'none';
    deltaEl.textContent = 'no edits';
  } else {
    deltaEl.className = '';
    deltaEl.innerHTML =
      `<span class="fixed">fixed ${delta.fixed.length}</span> / ` +
      `<span class="regressed">regressed ${delta.regressed.length}</span>` +
      (delta.regressed.length
        ? `<div class="regressed-list">⚠ regressed: ${delta.regressed.map((p) => `“${esc(p)}”`).join(', ')}</div>`
        : '');
  }

  // Failing-case list.
  const casesEl = document.getElementById('cases')!;
  casesEl.innerHTML =
    `<h2>Failing cases (${failing.length})</h2>` +
    (failing.length === 0
      ? '<p class="hint">All cases pass. 🎉</p>'
      : failing
          .map((s) => {
            const matchType = s.top1;
            if (editingPrompt === s.prompt) return editForm(s);
            const focusCls =
              focusedPrompt === s.prompt
                ? ' focused'
                : focusedPrompt
                  ? ' dimmed'
                  : '';
            const matchRow = matchType
              ? `<div class="row match"><span class="label">false-match</span><span class="id">${esc(matchType)}</span> ${brk(
                  s.ranked[0]?.breakdown
                )} ${firedPhrases(s.ranked[0]?.matched ?? [])}</div>`
              : `<div class="row"><span class="label">false-match</span><span class="hint">— nothing scored (fell back)</span></div>`;
            const missRows = s.accept
              .map((aid) => {
                const sc = scoreLine(s.prompt, aid);
                return `<div class="row miss"><span class="label">false-miss</span><span class="id">${esc(
                  aid
                )}</span> score ${fmt(sc.score)} ${brk(sc.breakdown)} ${firedPhrases(sc.matched)}</div>`;
              })
              .join('');
            return (
              `<div class="case fail${focusCls}" data-prompt="${esc(s.prompt)}">` +
              `<div class="case-head"><div class="prompt">${esc(s.prompt)}</div>` +
              `<div class="case-btns"><button class="case-action" data-edit="${esc(s.prompt)}" title="edit the prompt wording / accepted ids">edit</button>` +
              `<button class="case-action" data-wontfix="${esc(s.prompt)}" title="park this prompt as not-worth-solving">won't-fix</button></div></div>` +
              `<div class="accept">accept: ${s.accept.map(esc).join(' / ')}</div>` +
              matchRow +
              missRows +
              `</div>`
            );
          })
          .join('')) +
    (parked.length
      ? `<h2 style="margin-top:18px">Parked — won't-fix (${parked.length})</h2>` +
        parked
          .map((s) =>
            editingPrompt === s.prompt
              ? editForm(s)
              : `<div class="case parked"><div class="case-head"><span class="prompt">${esc(s.prompt)}</span>` +
                `<div class="case-btns"><button class="case-action" data-edit="${esc(s.prompt)}">edit</button>` +
                `<button class="case-action" data-reactivate="${esc(s.prompt)}">reactivate</button></div></div>` +
                `<div class="accept">want ${s.accept.map(esc).join(' / ')} · got ${esc(s.top1 ?? '∅')}${
                  s.note ? ` — ${esc(s.note)}` : ''
                }</div></div>`
          )
          .join('')
      : '') +
    (showPassing
      ? `<h2 style="margin-top:18px">Passing (${pass})</h2>` +
        active
          .filter((s) => s.pass)
          .map(
            (s) =>
              `<div class="case pass"><span class="prompt">${esc(s.prompt)}</span> → ${esc(s.top1!)}</div>`
          )
          .join('')
      : '');

  // Keep focus on the case across edits — even after an edit FIXES it (so the
  // editors pane stays stable instead of collapsing to the union view). Only
  // drop focus if the case no longer exists (deleted) or was parked.
  const focusedCase = focusedPrompt
    ? scored.find((s) => s.prompt === focusedPrompt && !s.wontfix)
    : null;
  if (focusedPrompt && !focusedCase) focusedPrompt = null;

  // Role colouring: the false-match type (the wrong top-1, if still wrong) is
  // red; each accepted type is green. When the case now passes there's no
  // false-match, so only the greens show.
  const roleById: Record<string, 'match' | 'miss'> = {};
  if (focusedCase) {
    if (focusedCase.top1 && !focusedCase.accept.includes(focusedCase.top1))
      roleById[focusedCase.top1] = 'match';
    focusedCase.accept.forEach((a) => (roleById[a] = 'miss'));
  }

  // Phrase editors: ALWAYS list every chart type (alphabetical, stable). When a
  // case is focused, its types sort to the top and get role colouring so you can
  // act on them without scrolling — nothing is ever hidden.
  const allIds = chartTypes.map((t) => t.id).sort();
  const relevant = Object.keys(roleById).sort();
  const relevantSet = new Set(relevant);
  const orderedIds = focusedCase
    ? [...relevant, ...allIds.filter((id) => !relevantSet.has(id))]
    : allIds;
  renderEditors(orderedIds, focusedPrompt, roleById);

  // Flash strip: the result of the last phrase edit.
  document.getElementById('edit-flash')!.innerHTML = lastEditMsg;

  // Restore scroll, then focus — so an edit feels in-place, not a refresh.
  const cEl = document.getElementById('cases');
  if (cEl) cEl.scrollTop = casesScroll;
  const eEl = document.getElementById('editors');
  if (eEl) eEl.scrollTop = editorsScroll;

  if (editingPrompt) {
    // Cursor in the prompt field when an inline editor is open.
    const pi = document.querySelector<HTMLInputElement>('.edit-prompt');
    pi?.focus();
    pi?.select();
  } else if (refocusAddId) {
    // Keep typing phrases into the same type after an add.
    const ai = document.querySelector<HTMLInputElement>(
      `input[data-add-id="${CSS.escape(refocusAddId)}"]`
    );
    ai?.focus();
    refocusAddId = null;
  }
}

function renderEditors(
  ids: string[],
  focused: string | null,
  roleById: Record<string, 'match' | 'miss'>
): void {
  const el = document.getElementById('editors')!;
  const focusBanner = focused
    ? `<div class="editor focus-banner"><div class="head"><b>focused</b> <span class="hint">${esc(
        focused
      )}</span> <button id="clear-focus">show all</button></div></div>`
    : '';
  el.innerHTML =
    `<h2>Phrase editors (${ids.length})</h2>` +
    `<div class="hint" style="margin-bottom: 8px">single-token phrases (⚠) over-fire via the shared IDF table — prune them first.</div>` +
    focusBanner +
    ids
      .map((id) => {
        const desc = byId.get(id)?.description ?? '';
        // false-match → red, false-miss → green (matches the case rows).
        const roleCls = roleById[id] ?? '';
        const prior = triggers[id]?.prior ?? 0;
        const priorCtl =
          `<span class="prior${prior > 0 ? ' on' : ''}" title="popularity prior (0–${PRIOR_MAX}): when a prompt is ambiguous, how typically a user means this type. Breaks ambiguous cases; never overrides a real phrase match.">` +
          `prior <button data-prior-id="${esc(id)}" data-prior-delta="-1" ${prior <= 0 ? 'disabled' : ''}>−</button>` +
          `<b>${prior}</b>` +
          `<button data-prior-id="${esc(id)}" data-prior-delta="1" ${prior >= PRIOR_MAX ? 'disabled' : ''}>+</button></span>`;
        return (
          `<div class="editor"><div class="head"><b class="${roleCls}">${esc(id)}</b> <span class="hint">${esc(desc)}</span>${priorCtl}</div>` +
          `<div>${phraseChips(id)}</div>` +
          `<div class="add"><input type="text" data-add-id="${esc(id)}" placeholder="add phrase…" />` +
          `<button data-add-btn="${esc(id)}">add</button></div></div>`
        );
      })
      .join('');
}

// ---- events (delegated) -----------------------------------------------------

document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const rmId = t.getAttribute('data-rm-id');
  if (rmId && t.hasAttribute('data-rm-phrase')) {
    const phrase = t.getAttribute('data-rm-phrase')!;
    const before = currentState();
    pushUndo();
    triggers[rmId].phrases = triggers[rmId].phrases.filter((p) => p !== phrase);
    describeEdit(`− ${rmId} “${phrase}”`, before);
    refocusAddId = rmId; // stay anchored in this editor after the rebuild
    render();
    return;
  }
  const priorId = t.getAttribute('data-prior-id');
  if (priorId && t.hasAttribute('data-prior-delta')) {
    const delta = Number(t.getAttribute('data-prior-delta'));
    const cur = triggers[priorId]?.prior ?? 0;
    const next = Math.max(0, Math.min(cur + delta, PRIOR_MAX));
    if (next === cur) return;
    const before = currentState();
    pushUndo();
    if (!triggers[priorId])
      triggers[priorId] = { phrases: [], concepts: [] };
    triggers[priorId].prior = next;
    describeEdit(`prior ${priorId} ${cur}→${next}`, before);
    render();
    return;
  }
  const addBtn = t.getAttribute('data-add-btn');
  if (addBtn) {
    addPhraseFromInput(addBtn);
    return;
  }
  if (t.id === 'clear-focus') {
    focusedPrompt = null;
    render();
    return;
  }
  if (t.id === 'undo') {
    const snap = undoStack.pop();
    if (snap) {
      restoreTriggers(snap);
      render();
    }
    return;
  }
  const parkPrompt = t.getAttribute('data-wontfix');
  if (parkPrompt) {
    const c = corpus.cases.find((k) => k.prompt === parkPrompt);
    if (c) {
      const note = window.prompt(
        "Why won't we solve this? (optional — kept as a note)",
        c.note ?? ''
      );
      if (note === null) return; // cancelled
      // Parking a currently-PASSING case removes it from the active set, so the
      // baseline (a floor on active passes) must drop by 1 to stay achievable —
      // otherwise baseline can exceed the active-case count and redden the gate
      // unfixably.
      const s = currentState();
      const top1 = createSuggester(s.map, s.priors).suggestChartTypes(c.prompt)
        .ranked[0]?.type.id;
      const wasPassing = !!top1 && c.accept.includes(top1);
      c.wontfix = true;
      if (note.trim()) c.note = note.trim();
      else delete c.note;
      if (wasPassing && corpus.baseline > 0) corpus.baseline -= 1;
      if (focusedPrompt === parkPrompt) focusedPrompt = null;
      render();
    }
    return;
  }
  const reactivatePrompt = t.getAttribute('data-reactivate');
  if (reactivatePrompt) {
    const c = corpus.cases.find((k) => k.prompt === reactivatePrompt);
    if (c) {
      delete c.wontfix;
      delete c.note;
      render();
    }
    return;
  }
  const editPrompt = t.getAttribute('data-edit');
  if (editPrompt) {
    editingPrompt = editPrompt;
    render();
    return;
  }
  if (t.hasAttribute('data-save-edit')) {
    saveEdit();
    return;
  }
  if (t.hasAttribute('data-cancel-edit')) {
    editingPrompt = null;
    render();
    return;
  }
  // Click a failing case → focus the editors on its types (toggle off if same).
  const caseEl = t.closest('.case.fail') as HTMLElement | null;
  if (caseEl) {
    const p = caseEl.getAttribute('data-prompt');
    if (p) {
      focusedPrompt = focusedPrompt === p ? null : p;
      render();
    }
    return;
  }
});

document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLInputElement;
  if (e.key === 'Enter' && t.hasAttribute?.('data-add-id'))
    addPhraseFromInput(t.getAttribute('data-add-id')!);
  // Inline case editor: Enter saves, Esc cancels.
  if (t.classList?.contains('edit-input')) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      editingPrompt = null;
      render();
    }
  }
});

document.addEventListener('change', (e) => {
  const t = e.target as HTMLSelectElement;
  if (t.id === 'show-passing') {
    showPassing = (t as unknown as HTMLInputElement).checked;
    render();
  }
});

function addPhraseFromInput(id: string): void {
  const input = document.querySelector<HTMLInputElement>(
    `input[data-add-id="${CSS.escape(id)}"]`
  );
  const phrase = input?.value.trim().toLowerCase();
  if (!phrase) return;
  if (triggers[id]?.phrases.includes(phrase)) {
    lastEditMsg = `<span class="hint">${esc(id)} already has “${esc(phrase)}”</span>`;
    refocusAddId = id;
    render();
    return;
  }
  const before = currentState();
  pushUndo();
  if (!triggers[id]) triggers[id] = { phrases: [], concepts: [] };
  triggers[id].phrases.push(phrase);
  describeEdit(`+ ${id} “${phrase}”`, before);
  refocusAddId = id;
  render();
}

/** Parse a comma-separated id list, returning null on empty/unknown ids. */
function parseAccept(raw: string | null): string[] | null {
  if (raw === null) return null;
  const accept = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!accept.length) return null;
  const unknown = accept.filter((id) => !byId.has(id));
  if (unknown.length) {
    window.alert(`Unknown chart-type id(s): ${unknown.join(', ')}`);
    return null;
  }
  return accept;
}

document.getElementById('add-case')!.addEventListener('click', () => {
  const prompt = window.prompt('Prompt text:')?.trim();
  if (!prompt) return;
  const accept = parseAccept(
    window.prompt('Acceptable chart-type id(s), comma-separated:') ?? null
  );
  if (!accept) return;
  corpus.cases.push({ prompt, accept });
  render();
});

/** Commit the in-place edit form (prompt + accept inputs) for `editingPrompt`. */
function saveEdit(): void {
  const oldPrompt = editingPrompt;
  if (!oldPrompt) return;
  const c = corpus.cases.find((k) => k.prompt === oldPrompt);
  if (!c) {
    editingPrompt = null;
    render();
    return;
  }
  const pi = document.querySelector<HTMLInputElement>('.edit-prompt');
  const ai = document.querySelector<HTMLInputElement>('.edit-accept');
  const newPrompt = pi?.value.trim();
  if (!newPrompt) return; // empty prompt — stay in edit mode
  const accept = parseAccept(ai?.value ?? null);
  if (!accept) return; // empty/unknown ids — alert shown, stay in edit mode
  c.prompt = newPrompt;
  c.accept = accept;
  // Prompt is the case identity used by focus/diff — follow the rename.
  if (focusedPrompt === oldPrompt) focusedPrompt = newPrompt;
  editingPrompt = null;
  render();
}

document.getElementById('save')!.addEventListener('click', async () => {
  const status = document.getElementById('save-status')!;
  status.textContent = 'saving…';
  status.className = 'hint';
  try {
    // Ratchet the committed baseline UP to the current ACTIVE pass-count so
    // saving a win locks it into the CI gate. Never lower it (a temporary
    // regression must not weaken the gate); parked cases are excluded.
    const passCount = passingPrompts(currentState(), corpus).size;
    corpus.baseline = Math.max(corpus.baseline, passCount);
    const res = await fetch('/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ triggers, corpus }),
    });
    const json = (await res.json()) as { ok: boolean; error?: string };
    if (!json.ok) throw new Error(json.error ?? 'save failed');
    // F5: post-save baseline = the values we just persisted. The dev server has
    // the source JSON import-cached, so rather than reload we adopt current
    // state as the new baseline — net-delta resets to "no edits".
    baselineState = currentState();
    undoStack.length = 0; // saved state is the new floor — nothing to undo back past
    lastEditMsg = `<span class="saved">✓ saved to disk — baseline ${corpus.baseline}. Run \`pnpm test\` to verify the gate, \`pnpm build\` to apply to the live tool.</span>`;
    status.textContent = '✓ saved';
    status.className = 'saved';
    render();
  } catch (err) {
    status.textContent = '✗ ' + String(err);
    status.className = 'regressed';
  }
});

// "Run test" / "Build" — fire the post-save terminal steps from the page via
// the dev-server /run endpoint. Test = verify the CI gate (read-only); Build =
// recompile dist so saved edits reach the live MCP tool. Both stream their tail
// of output into the status line so you see pass/fail without the terminal.
function wireRun(btnId: string, cmd: 'test' | 'build', label: string): void {
  const btn = document.getElementById(btnId) as HTMLButtonElement;
  btn.addEventListener('click', async () => {
    const status = document.getElementById('save-status')!;
    const both = ['run-test', 'run-build'].map(
      (id) => document.getElementById(id) as HTMLButtonElement
    );
    both.forEach((b) => (b.disabled = true));
    status.textContent = `${label}…`;
    status.className = 'hint';
    try {
      const res = await fetch('/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cmd }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        code?: number;
        output?: string;
        error?: string;
      };
      if (json.error) throw new Error(json.error);
      const done =
        cmd === 'test'
          ? '✓ test passed — gate green'
          : '✓ build done — live MCP tool updated';
      status.textContent = json.ok
        ? done
        : `✗ ${label} failed (exit ${json.code}) — see console`;
      status.className = json.ok ? 'saved' : 'regressed';
      if (!json.ok) console.error(`[${cmd}]\n${json.output}`);
    } catch (err) {
      status.textContent = '✗ ' + String(err);
      status.className = 'regressed';
    } finally {
      both.forEach((b) => (b.disabled = false));
    }
  });
}
wireRun('run-test', 'test', 'test');
wireRun('run-build', 'build', 'build');

/** Load vocab + corpus fresh from the dev server, then render. */
async function init(): Promise<void> {
  const res = await fetch('/data');
  const data = (await res.json()) as {
    triggers: TriggerData;
    corpus: Corpus & { cases: Case[] };
  };
  triggers = data.triggers;
  corpus = data.corpus;
  baselineState = currentState();
  render();
}

void init();
