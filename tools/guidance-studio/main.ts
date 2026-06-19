// ============================================================
// main.ts — the guidance studio's single linear screen (no framework, plain
// TS + DOM, matching the selection-harness precedent).
//
// ONE loop, top→bottom: pick a type → edit its TIPS → Run a prompt (+dataset) →
// see DGMO source + rendered image + a manual tips-checklist + the exact
// injected guidance → Save (validated). The type picker doubles as the coverage
// progress bar (has-tips/empty). Phase-2 extras (N=3 before/after compare,
// per-type dataset defaulting) layer on without disturbing the core loop.
// ============================================================
import registry from './registry.json';

interface TypeEntry {
  id: string;
  description: string;
  hasTips: boolean;
}
interface DatasetMeta {
  id: string;
  label: string;
  suitsTypes: string[];
}
interface RunResult {
  dgmo: string;
  svg: string | null;
  pngBase64: string | null;
  resolvedPrompt: string;
  injectedTips: string;
  diagnostics: { severity: string; message: string }[];
  error: string | null;
}

const types: TypeEntry[] = (registry as { types: TypeEntry[] }).types;

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;
// props is a loose bag assigned onto the element (value/type/style strings etc.
// are valid at runtime for the specific element kinds we create).
const el = (tag: string, props: Record<string, unknown> = {}, html?: string): HTMLElement => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  if (html != null) e.innerHTML = html;
  return e;
};

const state = {
  type: null as string | null,
  savedTips: '', // last on-disk block, to detect unsaved edits
  datasets: [] as DatasetMeta[],
};

// Last single-Run result per type, kept in memory so switching chart types
// doesn't throw away a `claude -p` run. `sig` captures the inputs that produced
// it (prompt + dataset + tips); if those later differ, the restored result is
// flagged stale rather than silently misleading. (Survives type-switching;
// re-runs on a full page reload — base64 images are too big for localStorage.)
const lastRuns = new Map<string, { result: RunResult; sig: string }>();

// Per-type prompt + dataset choice, remembered browser-locally (runs stay
// ephemeral — only TIPS persist to disk; this just stops a crafted prompt from
// resetting on reload/tab-switch). Keyed by chart type.
const PREFS_KEY = 'dgmo-studio-prompts';
type Pref = { prompt?: string; datasetId?: string };
function loadPrefs(): Record<string, Pref> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
  } catch {
    return {};
  }
}
function savePref(type: string, pref: Pref): void {
  try {
    const all = loadPrefs();
    all[type] = { ...all[type], ...pref };
    localStorage.setItem(PREFS_KEY, JSON.stringify(all));
  } catch {
    /* storage disabled — degrade to ephemeral */
  }
}

// ---- picker ----------------------------------------------------------------
const picker = $('#picker');
function renderPicker(): void {
  picker.innerHTML = '';
  const withTips = types.filter((t) => t.hasTips).length;
  picker.appendChild(
    el('div', { className: 'count' }, `${withTips} / ${types.length} types have tips`)
  );
  for (const t of types) {
    const btn = el('button', { title: t.description }) as HTMLButtonElement;
    if (t.id === state.type) btn.classList.add('active');
    btn.appendChild(el('span', { className: `dot ${t.hasTips ? 'has' : 'empty'}` }));
    btn.appendChild(el('span', {}, t.id));
    btn.onclick = () => selectType(t.id);
    picker.appendChild(btn);
  }
}

async function refreshCoverage(): Promise<void> {
  try {
    const r = await fetch('/studio/coverage').then((x) => x.json());
    const map = new Map<string, boolean>(
      (r.types as { type: string; hasTips: boolean }[]).map((t) => [t.type, t.hasTips])
    );
    for (const t of types) if (map.has(t.id)) t.hasTips = map.get(t.id)!;
    renderPicker();
  } catch {
    /* dev tool — ignore */
  }
}

// ---- work area -------------------------------------------------------------
const work = $('#work');

function emptyState(): void {
  work.innerHTML = '';
  work.appendChild(
    el(
      'div',
      { className: 'empty-state' },
      `<h2>Pick a type to start</h2>
       <p>Choose a chart type on the left. You'll see how the AI is currently told
       to style it (its <b>tips</b>), tweak that guidance, then hit <b>Run</b> with a
       prompt to see the diagram the model produces. Green dots = a type already has tips.</p>`
    )
  );
}

function tipsBodyOf(block: string): string {
  return block
    .replace(/<!--\s*TIPS start\s*-->/, '')
    .replace(/<!--\s*TIPS end\s*-->/, '')
    .trim();
}

// The editor only ever holds the PROSE — both the <!-- TIPS --> anchors AND the
// boilerplate "**Styling tips:**" lead-in are managed here (the lead-in is the
// box's title), so a stray keystroke can't break a marker or mangle the framing
// the model sees.
const TIPS_PREFIX = '**Styling tips:**';
/** Strip the managed lead-in for display in the editor. */
function stripTipsPrefix(body: string): string {
  return body.replace(/^\*\*Styling tips:\*\*\s*/, '').trim();
}
/** Re-attach the managed lead-in (what's saved + what the model is told). */
function composeTips(body: string): string {
  return `${TIPS_PREFIX} ${body.trim()}`;
}
function wrapTips(body: string): string {
  return `<!-- TIPS start -->\n${body.trim()}\n<!-- TIPS end -->`;
}

async function selectType(id: string): Promise<void> {
  state.type = id;
  renderPicker();
  work.innerHTML = '<p class="spinner">Loading…</p>';

  const [guidance, ds] = await Promise.all([
    fetch(`/studio/guidance?type=${encodeURIComponent(id)}`).then((r) => r.json()),
    fetch(`/studio/datasets?type=${encodeURIComponent(id)}`).then((r) => r.json()),
  ]);
  // Edit only the prose — the <!-- TIPS --> markers AND the "Styling tips:"
  // lead-in are managed for you (the lead-in is the box title below).
  const savedBody = stripTipsPrefix(tipsBodyOf(guidance.block));
  state.savedTips = savedBody;
  state.datasets = ds.all;
  const fitting: DatasetMeta[] = ds.fitting;

  work.innerHTML = '';

  // --- tips editor ---
  const tipsSec = el('section');
  tipsSec.appendChild(
    el('label', { className: 'fld' }, `Styling tips — how the AI should style a "${id}"`)
  );
  const tips = el('textarea', { id: 'tips', value: savedBody }) as HTMLTextAreaElement;
  tips.placeholder =
    'e.g. sort bars by value; highlight one series with color; label axes with units';
  tipsSec.appendChild(tips);
  tipsSec.appendChild(
    el(
      'div',
      { className: 'count', style: 'padding:4px 2px 0' },
      'Just the guidance text — the “Styling tips:” lead-in and the <!-- TIPS --> markers are added automatically on save.'
    )
  );
  const saveRow = el('div', { className: 'row', style: 'justify-content:flex-start;margin-top:8px' });
  saveRow.style.flex = 'none';
  const saveBtn = el('button', { className: 'btn', textContent: 'Save tips' }) as HTMLButtonElement;
  saveBtn.style.flex = 'none';
  const unsaved = el('span', { className: 'unsaved', id: 'unsaved' });
  const saveStatus = el('span', { id: 'save-status' });
  saveRow.append(saveBtn, unsaved, saveStatus);
  tipsSec.appendChild(saveRow);
  work.appendChild(tipsSec);

  const markUnsaved = (): void => {
    unsaved.textContent = tips.value !== state.savedTips ? '● unsaved' : '';
    saveStatus.textContent = '';
  };
  tips.oninput = markUnsaved;
  saveBtn.onclick = async () => {
    saveStatus.className = '';
    if (!tips.value.trim()) {
      saveStatus.className = 'saved-bad';
      saveStatus.textContent = 'nothing to save — add some guidance first';
      return;
    }
    saveStatus.textContent = 'Saving…';
    const r = await fetch('/studio/guidance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: id, block: wrapTips(composeTips(tips.value)) }),
    }).then((x) => x.json());
    if (r.ok) {
      state.savedTips = tips.value;
      unsaved.textContent = '';
      saveStatus.className = 'saved-ok';
      saveStatus.textContent = '✓ saved';
      refreshCoverage();
    } else {
      saveStatus.className = 'saved-bad';
      saveStatus.textContent = `✗ rejected: ${r.reason}`;
    }
  };

  // Remembered prompt/dataset for this type (browser-local), if any.
  const pref = loadPrefs()[id] ?? {};

  // --- prompt + dataset ---
  const runSec = el('section');
  runSec.appendChild(el('label', { className: 'fld' }, 'Prompt'));
  const prompt = el('input', {
    id: 'prompt',
    value: pref.prompt ?? `Make a ${id} diagram of the sample data.`,
  }) as HTMLInputElement;
  prompt.oninput = () => savePref(id, { prompt: prompt.value });
  runSec.appendChild(prompt);

  const ctl = el('div', { className: 'row', style: 'margin-top:10px' });
  const dsSelect = el('select', { id: 'dataset' }) as HTMLSelectElement;
  dsSelect.appendChild(el('option', { value: '', textContent: 'No dataset' }));
  const dsIds = new Set(state.datasets.map((d) => d.id));
  for (const d of state.datasets) {
    const o = el('option', { value: d.id, textContent: d.label }) as HTMLOptionElement;
    dsSelect.appendChild(o);
  }
  // Remembered choice wins (incl. an explicit "No dataset"); otherwise default
  // to a fitting dataset when one exists (Phase-2 O4); "none" is allowed.
  if (pref.datasetId !== undefined && (pref.datasetId === '' || dsIds.has(pref.datasetId)))
    dsSelect.value = pref.datasetId;
  else if (fitting.length) dsSelect.value = fitting[0].id;
  ctl.appendChild(dsSelect);
  const runBtn = el('button', { className: 'btn narrow', textContent: 'Run' }) as HTMLButtonElement;
  const cmpBtn = el('button', {
    className: 'btn ghost narrow',
    textContent: 'Compare 3× (no-tips vs tips)',
  }) as HTMLButtonElement;
  ctl.append(runBtn, cmpBtn);
  runSec.appendChild(ctl);

  // Live preview of the selected dataset's literal values (what gets injected).
  const dataPreview = el('details', {
    id: 'data-preview',
    style: 'margin-top:10px',
  }) as HTMLDetailsElement;
  runSec.appendChild(dataPreview);
  const showDataset = async (dsId: string): Promise<void> => {
    if (!dsId) {
      dataPreview.innerHTML = '';
      return;
    }
    dataPreview.innerHTML = '';
    dataPreview.appendChild(
      el('summary', {}, `Dataset values injected into the prompt — ${dsId}`)
    );
    const pre = el('pre', {}, 'loading…');
    dataPreview.appendChild(pre);
    dataPreview.open = true;
    try {
      const ds = await fetch(
        `/studio/dataset?id=${encodeURIComponent(dsId)}`
      ).then((r) => r.json());
      pre.textContent = JSON.stringify(ds.data ?? ds, null, 2);
    } catch (err) {
      pre.textContent = `(failed to load dataset: ${String(err)})`;
    }
  };
  dsSelect.onchange = () => {
    savePref(id, { datasetId: dsSelect.value });
    void showDataset(dsSelect.value);
  };
  void showDataset(dsSelect.value); // reflect the initial/remembered choice

  // Stale banner sits above the result so renderSingle (which rebuilds the
  // result body) never clobbers it.
  const staleNote = el(
    'div',
    {
      className: 'count',
      style: 'color:var(--warn);display:none;margin-bottom:6px',
    },
    '⟳ Prompt, dataset, or tips changed since this result — Run again to refresh.'
  );
  runSec.appendChild(staleNote);
  work.appendChild(runSec);

  const resultSec = el('section', { id: 'result' });
  work.appendChild(resultSec);

  // Signature of the inputs that determine a run's output.
  const sigNow = (): string =>
    JSON.stringify({ p: prompt.value, d: dsSelect.value, t: tips.value.trim() });
  const updateStale = (): void => {
    const cached = lastRuns.get(id);
    staleNote.style.display =
      cached && resultSec.childElementCount > 0 && cached.sig !== sigNow()
        ? ''
        : 'none';
  };
  prompt.addEventListener('input', updateStale);
  dsSelect.addEventListener('change', updateStale);
  tips.addEventListener('input', updateStale);

  const runOnce = (overrideTips?: string): Promise<RunResult> =>
    fetch('/studio/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: id,
        prompt: prompt.value,
        datasetId: dsSelect.value || undefined,
        tips:
          overrideTips != null
            ? overrideTips
            : tips.value.trim()
              ? composeTips(tips.value)
              : '',
      }),
    }).then((x) => x.json());

  runBtn.onclick = async () => {
    resultSec.innerHTML = '<p class="spinner">Running claude…</p>';
    try {
      const res = await runOnce();
      renderSingle(resultSec, res, tips.value);
      lastRuns.set(id, { result: res, sig: sigNow() });
    } catch (err) {
      resultSec.innerHTML = `<p class="diag">Run failed: ${String(err)}</p>`;
    }
    updateStale();
  };

  cmpBtn.onclick = () => runCompare(resultSec, prompt, dsSelect, tips, id);

  // Restore a prior run for this type (the whole point — don't waste the work).
  const cached = lastRuns.get(id);
  if (cached) renderSingle(resultSec, cached.result, tips.value);
  updateStale();

  markUnsaved();
}

// ---- single-run result -----------------------------------------------------
function imgEl(pngBase64: string | null): HTMLElement {
  const box = el('div', { className: 'img' });
  if (pngBase64) {
    const img = el('img') as HTMLImageElement;
    img.src = `data:image/png;base64,${pngBase64}`;
    box.appendChild(img);
  } else {
    box.appendChild(el('span', { className: 'spinner', textContent: 'no image' }));
  }
  return box;
}

/** Split tips prose into checklist items (bullets, or sentence-ish clauses). */
function checklistItems(tipsBlockOrBody: string): string[] {
  const body = tipsBodyOf(tipsBlockOrBody).replace(/^\*\*Styling tips:\*\*/, '');
  const bullets = body
    .split('\n')
    .map((l) => l.replace(/^[-*]\s*/, '').trim())
    .filter((l) => l.length > 2);
  if (bullets.length > 1) return bullets;
  // single dense line → split on ; into criteria
  return body
    .split(/;|\.(?:\s|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 4);
}

function renderSingle(host: HTMLElement, res: RunResult, tipsBlock: string): void {
  host.innerHTML = '';
  const grid = el('div', { className: 'result' });
  // left: source (with a copy button on the label row)
  const left = el('div');
  const srcHead = el('div', {
    className: 'row',
    style: 'align-items:center;gap:8px',
  });
  srcHead.appendChild(el('label', { className: 'fld', style: 'margin:0' }, 'Generated DGMO'));
  const copyBtn = el('button', {
    className: 'btn ghost narrow',
    textContent: '⧉ Copy',
    title: 'Copy the DGMO source',
    style: 'flex:none;padding:3px 10px',
  }) as HTMLButtonElement;
  copyBtn.disabled = !res.dgmo;
  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(res.dgmo);
      copyBtn.textContent = '✓ Copied';
      setTimeout(() => (copyBtn.textContent = '⧉ Copy'), 1200);
    } catch {
      copyBtn.textContent = '✗ Copy failed';
      setTimeout(() => (copyBtn.textContent = '⧉ Copy'), 1500);
    }
  };
  srcHead.appendChild(copyBtn);
  left.appendChild(srcHead);
  left.appendChild(el('pre', { style: 'margin-top:4px' }, escapeHtml(res.dgmo || '(no source)')));
  if (res.error) left.appendChild(el('p', { className: 'diag' }, escapeHtml(res.error)));
  grid.appendChild(left);
  // right: image + checklist
  const right = el('div');
  right.appendChild(el('label', { className: 'fld' }, 'Rendered'));
  right.appendChild(imgEl(res.pngBase64));
  right.appendChild(el('label', { className: 'fld', style: 'margin-top:10px' }, 'Tips checklist (tick by eye)'));
  const ul = el('ul', { className: 'checklist' });
  const items = checklistItems(tipsBlock);
  if (!items.length) ul.appendChild(el('li', { className: 'spinner' }, 'no tips yet — add some above'));
  for (const it of items) {
    const li = el('li');
    const cb = el('input', { type: 'checkbox' }) as HTMLInputElement;
    li.append(cb, document.createTextNode(it));
    li.onclick = (e) => {
      if (e.target !== cb) cb.checked = !cb.checked;
    };
    ul.appendChild(li);
  }
  right.appendChild(ul);
  grid.appendChild(right);
  host.appendChild(grid);

  // proof the edit reached the model (F2/F6)
  const det = el('details');
  det.appendChild(el('summary', {}, 'Injected guidance + resolved prompt (what was sent)'));
  det.appendChild(el('label', { className: 'fld' }, 'Injected tips'));
  det.appendChild(el('pre', {}, escapeHtml(res.injectedTips || '(none)')));
  det.appendChild(el('label', { className: 'fld' }, 'Resolved prompt'));
  det.appendChild(el('pre', {}, escapeHtml(res.resolvedPrompt)));
  host.appendChild(det);
}

// ---- Phase-2 N=3 before/after compare --------------------------------------
async function runCompare(
  host: HTMLElement,
  prompt: HTMLInputElement,
  dsSelect: HTMLSelectElement,
  tips: HTMLTextAreaElement,
  type: string
): Promise<void> {
  const N = 3; // fixed (Occam O3)
  host.innerHTML = '';
  const note = el(
    'p',
    { className: 'spinner' },
    `Same prompt + dataset, ${N}× each: with NO tips vs WITH your tips. Thumbnails appear as runs return.`
  );
  host.appendChild(note);

  const makeArm = (title: string): { grid: HTMLElement; slots: HTMLElement[] } => {
    host.appendChild(el('div', { className: 'arm-title' }, title));
    const grid = el('div', { className: 'grid3' });
    const slots: HTMLElement[] = [];
    for (let i = 0; i < N; i++) {
      const s = el('div', { className: 'img' });
      s.appendChild(el('span', { className: 'spinner', textContent: '…' }));
      slots.push(s);
      grid.appendChild(s);
    }
    host.appendChild(grid);
    return { grid, slots };
  };

  const before = makeArm('No guidance');
  const after = makeArm('With your tips');

  const fire = (arm: { slots: HTMLElement[] }, overrideTips: string): Promise<void>[] =>
    arm.slots.map(async (slot, i) => {
      void i;
      try {
        const res: RunResult = await fetch('/studio/run', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type,
            prompt: prompt.value,
            datasetId: dsSelect.value || undefined,
            tips: overrideTips,
          }),
        }).then((x) => x.json());
        slot.replaceWith(decorateThumb(res));
      } catch {
        slot.innerHTML = '<span class="spinner">failed</span>';
      }
    });

  const afterTips = tips.value.trim() ? composeTips(tips.value) : '';
  await Promise.all([...fire(before, ''), ...fire(after, afterTips)]);
  note.textContent = 'Done. Eyeball the two columns: did your tips make the diagrams better?';
}

function decorateThumb(res: RunResult): HTMLElement {
  const box = el('div', { className: 'img' });
  if (res.pngBase64) {
    const img = el('img') as HTMLImageElement;
    img.src = `data:image/png;base64,${res.pngBase64}`;
    img.title = res.dgmo;
    box.appendChild(img);
  } else {
    box.appendChild(el('span', { className: 'spinner', textContent: res.error ? 'parse error' : 'no image' }));
  }
  return box;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---- boot ------------------------------------------------------------------
renderPicker();
emptyState();
