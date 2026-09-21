/**
 * The results pages: what the boats sent in, read back.
 *
 * <h2>Two kinds of result, ranked on two different things</h2>
 * A <b>race</b> is a fleet sailing together on one afternoon, so its results are that
 * afternoon's and are read as a finishing order. A <b>record attempt</b> stands against every
 * other attempt at the same geometry, whenever it was made — so those are grouped by variant
 * and then by revision, because a course edited between two attempts is two courses and the
 * store refuses to rank across the edit.
 *
 * <h2>This page scores nothing</h2>
 * It orders by elapsed time and prints corrected time beside it where a boat declared a TCF,
 * which is a multiplication anybody can check. Places, penalties, drops and protests belong to
 * the club's own software, which has rules for them; owning none of that is what lets this
 * system be right about the one thing it is uniquely able to be right about, which is what a
 * boat's own clock recorded at each crossing.
 *
 * Plain fetches and plain DOM, like every other page here: no framework, and nothing cached,
 * because a results table is read once and is worth a round trip.
 */

const el = (id) => document.getElementById(id);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (value) => String(value ?? '').replace(/[&<>"]/g, (c) => ESC[c]);

/** Seconds as a sailor writes them: m:ss under the hour, h:mm:ss over it. */
export function clock(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return '—';
  const whole = Math.max(0, Math.round(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/** An instant as a time of day, in whoever is reading's own zone. */
const hhmm = (iso) => {
  if (!iso) return '—';
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '—'
    : `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
};

/**
 * One results table.
 *
 * <b>The place column is left blank for a boat that did not finish</b> rather than given a
 * number: a boat still out, or one that stopped, has no place in a finishing order and printing
 * one would be this page scoring. They are kept in the table because a result that quietly
 * dropped the boats it could not rank would be a result nobody could reconcile against who
 * started.
 *
 * <b>Corrected time appears only where there is a TCF to correct by</b>, and the column is
 * absent entirely when nobody in the table declared one — a column of dashes is a column that
 * says the page is missing something, where the truth is that this fleet races scratch.
 */
export function table(rows, options = {}) {
  if (!rows.length) return '<p class="muted">Nothing sent in yet.</p>';
  const corrected = rows.some((r) => r.correctedSeconds != null);
  const divisions = options.divisions && rows.some((r) => r.division);
  let place = 0;
  return `<table><thead><tr>
      <th style="width:2.5em">#</th>
      <th>Boat</th>
      ${divisions ? '<th>Division</th>' : ''}
      <th class="num">Started</th>
      <th class="num">Elapsed</th>
      ${corrected ? '<th class="num">Corrected</th>' : ''}
      <th class="num">Marks</th>
    </tr></thead><tbody>
    ${rows.map((row) => {
    const finished = row.elapsedSeconds != null;
    if (finished) place += 1;
    return `<tr class="${finished ? '' : 'dnf'}">
        <td class="place">${finished ? place : '—'}</td>
        <td>${esc(row.sailNumber || row.boatId || '—')}
          ${row.boatName ? `<span class="muted"> &middot; ${esc(row.boatName)}</span>` : ''}
          ${row.auditable ? '<span class="muted mono" style="font-size:10px" title="the full track came with it, so a contested crossing can be examined"> track</span>' : ''}</td>
        ${divisions ? `<td class="muted">${esc(row.division ?? '—')}</td>` : ''}
        <td class="num">${esc(hhmm(row.startTime))}</td>
        <td class="num">${finished ? esc(clock(row.elapsedSeconds)) : 'did not finish'}</td>
        ${corrected ? `<td class="num">${row.correctedSeconds == null ? '—' : esc(clock(row.correctedSeconds))}</td>` : ''}
        <td class="num">${row.crossings ?? 0}</td>
      </tr>`;
  }).join('')}
    </tbody></table>`;
}

/* ============================================================== the page */

const state = { club: null, series: null, open: new Set() };

const get = async (path) => {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
};

/** Say what went wrong in the place the answer would have gone. */
const fail = (id, error) => {
  el(id).innerHTML = `<p class="muted">Could not read that: ${esc(error.message)}</p>`;
};

async function loadProgrammes() {
  const programmes = await get('/api/programmes');
  const clubs = [...new Set(programmes.map((p) => p.club))];
  // A LEVEL WITH ONE ANSWER ANSWERS ITSELF, the same rule the join screen follows: a club with
  // one series is not a question, and a selector with one option in it is furniture.
  state.club = clubs.includes(state.club) ? state.club : clubs[0] ?? null;
  const series = programmes.filter((p) => p.club === state.club).map((p) => p.series);
  state.series = series.includes(state.series) ? state.series : series[0] ?? null;

  const option = (v, chosen) => `<option value="${esc(v)}"${v === chosen ? ' selected' : ''}>${esc(v)}</option>`;
  el('club').innerHTML = clubs.map((c) => option(c, state.club)).join('');
  el('series').innerHTML = series.map((s) => option(s, state.series)).join('');
  return programmes;
}

async function loadResults() {
  if (!state.club || !state.series) {
    el('races').innerHTML = '<p class="muted">No series to read.</p>';
    el('variants').innerHTML = '';
    return;
  }
  const key = `${encodeURIComponent(state.club)}/${encodeURIComponent(state.series)}`;
  let index;
  try {
    index = await get(`/api/results/${key}`);
  } catch (error) {
    fail('races', error);
    fail('variants', error);
    return;
  }
  renderRaces(index.races ?? []);
  renderVariants(index.variants ?? []);
}

/**
 * The races, newest first, each openable.
 *
 * <b>A race with nothing sent in is still listed, and says so.</b> It is a race that was
 * defined and either has not been sailed yet or produced nothing — and both are facts somebody
 * looking for last Saturday's results needs, where an absent row would read as a page that had
 * lost them.
 */
function renderRaces(races) {
  if (!races.length) {
    el('races').innerHTML = '<p class="muted">No races defined in this series.</p>';
    return;
  }
  el('races').innerHTML = races.map((race) => {
    const id = `race:${race.race}`;
    const open = state.open.has(id);
    return `<div>
      <button class="row" data-open="${esc(id)}">
        <span>${esc(race.name || race.race)}</span>
        <span class="when">${esc(race.date ?? '')}</span>
        <span class="sp"></span>
        <span class="count">${race.finished} finished of ${race.records}</span>
        <span class="mono muted">${open ? '▾' : '▸'}</span>
      </button>
      ${open ? `<div class="open" id="open-${esc(id)}"><span class="muted">Loading&hellip;</span></div>` : ''}
    </div>`;
  }).join('');
  wireRows();
  for (const race of races) {
    const id = `race:${race.race}`;
    if (state.open.has(id)) fillRace(race.race, id);
  }
}

async function fillRace(raceId, id) {
  const key = `${encodeURIComponent(state.club)}/${encodeURIComponent(state.series)}`;
  const host = el(`open-${id}`);
  if (!host) return;
  try {
    const race = await get(`/api/results/${key}/race/${encodeURIComponent(raceId)}`);
    host.innerHTML = table(race.results ?? [], { divisions: true });
  } catch (error) {
    host.innerHTML = `<p class="muted">Could not read that race: ${esc(error.message)}</p>`;
  }
}

/** The variants anybody has attempted, each opening into one table per revision. */
function renderVariants(variants) {
  if (!variants.length) {
    el('variants').innerHTML = '<p class="muted">No record attempts in this series yet.</p>';
    return;
  }
  el('variants').innerHTML = variants.map((row) => {
    const id = `variant:${row.course}/${row.variant}`;
    const open = state.open.has(id);
    const attempts = row.revisions.reduce((sum, r) => sum + r.attempts, 0);
    return `<div>
      <button class="row" data-open="${esc(id)}">
        <span>${esc(row.courseName || row.course)}
          <span class="muted">&middot; ${esc(row.variantName || row.variant)}</span></span>
        <span class="sp"></span>
        <span class="count">${attempts} attempt${attempts === 1 ? '' : 's'}
          &middot; ${row.revisions.length} revision${row.revisions.length === 1 ? '' : 's'}</span>
        <span class="mono muted">${open ? '▾' : '▸'}</span>
      </button>
      ${open ? `<div class="open" id="open-${esc(id)}"><span class="muted">Loading&hellip;</span></div>` : ''}
    </div>`;
  }).join('');
  wireRows();
  for (const row of variants) {
    const id = `variant:${row.course}/${row.variant}`;
    if (state.open.has(id)) fillVariant(row, id);
  }
}

async function fillVariant(row, id) {
  const key = `${encodeURIComponent(state.club)}/${encodeURIComponent(state.series)}`;
  const host = el(`open-${id}`);
  if (!host) return;
  try {
    const found = await get(`/api/results/${key}/variant/`
      + `${encodeURIComponent(row.course)}/${encodeURIComponent(row.variant)}`);
    // THE REVISION IS WHAT A TIME STANDS AGAINST, so it heads its own table rather than sitting
    // in a column: two attempts under different revisions are not two rows of one result.
    host.innerHTML = (found.revisions ?? []).map((rev) => `<div class="rev">
      <h3>${esc(rev.label ?? '')} &middot; ${esc(rev.revision)}</h3>
      ${table(rev.results ?? [])}
    </div>`).join('') || '<p class="muted">Nothing sent in yet.</p>';
  } catch (error) {
    host.innerHTML = `<p class="muted">Could not read that variant: ${esc(error.message)}</p>`;
  }
}

/** Opening a row is a toggle, and what is open survives the re-render that follows. */
function wireRows() {
  for (const button of document.querySelectorAll('[data-open]')) {
    button.addEventListener('click', () => {
      const id = button.dataset.open;
      if (state.open.has(id)) state.open.delete(id);
      else state.open.add(id);
      loadResults();
    });
  }
}

el('club').addEventListener('change', async (ev) => {
  state.club = ev.target.value;
  state.series = null;
  state.open.clear();
  await loadProgrammes();
  await loadResults();
});
el('series').addEventListener('change', async (ev) => {
  state.series = ev.target.value;
  state.open.clear();
  await loadResults();
});

/*
 * The first fetch is wrapped, because a server that is still starting would otherwise leave a
 * page with its furniture drawn and nothing else, for ever, with nothing on screen saying why.
 * A club's connection being briefly bad is not an unusual condition.
 */
try {
  await loadProgrammes();
  await loadResults();
} catch (error) {
  fail('races', error);
  fail('variants', error);
}

/** Exposed for the headless driver only; nothing in the page reads it. */
export const __results = { state, loadResults };
