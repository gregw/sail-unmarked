/**
 * RUNNING A RACE — the committee's screen, dialog document §12.
 *
 * <h2>What this page is for, and what it deliberately is not</h2>
 * It publishes state and it reads back what the fleet said. It does not score, it does not
 * measure, and it has <b>no GO button</b> — which is not an omission but §1.2: the server keeps
 * no clock, so a start cannot be triggered. It is SCHEDULED as an absolute instant, and the
 * arithmetic that turns "in five minutes" into that instant happens here, in this browser,
 * against this operator's clock. Which suits sailing anyway: a start sequence is planned, not
 * pressed.
 *
 * <h2>The two rules that are enforced HERE and nowhere else</h2>
 * Both are arithmetic against *now*, and the only *now* that matters is the one belonging to the
 * person deciding (§8.5):
 * <ul>
 * <li><b>No AP once a start has passed.</b> After that the honest instrument is abandonment, and
 *     the screen offers the one that applies rather than both.
 * <li><b>After an AP, the next start is at least six minutes ahead</b> — a minute before the
 *     warning signal, then the usual five. A postponement followed by a start a boat cannot see
 *     coming is worse than no postponement.
 * </ul>
 * Neither is annotated anywhere: an illegal sequence is prevented, not recorded as illegal.
 *
 * <h2>Colour is DIVISION here</h2>
 * In the editor colour means leg role — green leaves a lap, red arrives at one. On this screen it
 * means division, and the two never share a chart. Progress is carried by TEXTURE within a
 * division's own colour, because the question a committee is actually asking is *which legs have
 * been sailed*: the band of "some" legs is the fleet's spread, its front edge is the leader and
 * its back edge is the last boat, so *can I shorten* is the width of that band read without a
 * number (§12.2).
 *
 * <h2>What is left as TODO, and why each is honest to leave</h2>
 * <ul>
 * <li><b>The legs are drawn straight.</b> The editor's `coursedraw.track` arcs out of an apex on
 *     the crossing heading and back onto the next one, which is what a boat does; here the
 *     question is which legs have been sailed, and a straight line answers it.
 * <li><b>`window` (a start range) is not offered.</b> The protocol carries it and the client
 *     holds it as state; nothing here publishes one.
 * <li><b>Muting a sail number</b> (§8.4) — the instrument against a person jamming the channel.
 * <li><b>Any authentication at all.</b> Abandoning a race is the most consequential act in this
 *     system and the one that most wants a name attached to it: §7.1, open question 8.
 * </ul>
 */

import { BASEMAPS, MapView, wheelZoomStep } from './geo.js';
import { boatArt, esc, hhmmss } from './markscreen.js';
import { duration } from './screens.js';
import { showWhoami } from './whoami.js';

const el = (id) => document.getElementById(id);

/**
 * A division's colour.
 *
 * Deliberately not the editor's `ROLE_COLOUR`: the two mean different things and must never be
 * confused, which is easiest to guarantee by their not sharing a value. What there must not be
 * anywhere is a third meaning for colour.
 */
const DIVISION_COLOURS = ['#35b5e8', '#e0b23a', '#8ad46b', '#d96a8f', '#c98ae0', '#e08a3a'];

/** How a leg is drawn, by how much of the fleet has sailed it (§12.2). */
const PROGRESS = {
  // This is where the fleet IS, so this is where the ink goes.
  some: { width: 4.5, dash: null, opacity: 1 },
  none: { width: 2.5, dash: '10,7', opacity: 0.85 },
  all: { width: 1.2, dash: null, opacity: 0.4 },
};

/** How long before a boat's last fix is old enough to draw faded and say so. */
const STALE_MS = 30000;

const state = {
  view: new MapView(),
  basemap: 'sea',
  programmes: [],
  races: [],            // {club, series, id, race}
  chosen: null,
  conduct: null,
  courses: new Map(),   // revision → snapshot
  /*
   * WHAT IS TYPED INTO EACH DIVISION'S START, kept per division and not shared.
   *
   * With "start in five minutes" one number could serve every division; with absolute times it
   * cannot, because that is the whole point — div-1 starts at 14:05 and div-2 at 14:10, and a
   * shared field would make the second edit overwrite the first. Seeded once per division from
   * the race's PLANNED start where it has one, else five minutes from now, and never re-seeded:
   * this page re-renders every couple of seconds and a seed that ran again would type over
   * whatever the operator was in the middle of entering.
   */
  starts: {},           // division -> { at (local 'YYYY-MM-DDTHH:mm'), warning, prep }
  arming: null,         // which irreversible act is asking a second time
  message: null,
  fitted: false,
};

/* ================================================================= what is out there */

const json = async (path, options) => {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 180)}`);
  return response.json();
};

async function loadRaces() {
  /*
   * A FAILED FETCH HERE MUST NOT TAKE THE PAGE DOWN WITH IT.
   *
   * This runs at module top level, so an exception escaping it rejects the module and leaves a
   * page that has loaded its furniture and will never do anything again — with nothing on
   * screen saying why. Which is the worst of the three possible outcomes, and it is what
   * happened: `drive-racepage.mjs` died on an unhandled rejection the one time the server was
   * still starting. A club's connection being briefly bad is not an unusual condition.
   */
  try {
    state.programmes = await json('/api/programmes');
  } catch (error) {
    state.message = `Could not read the programmes: ${error.message}`;
    render();
    return;
  }
  const races = [];
  for (const programme of state.programmes) {
    const held = await json(`/api/races/${encodeURIComponent(programme.club)}`
      + `/${encodeURIComponent(programme.series)}`).catch(() => ({}));
    for (const [id, race] of Object.entries(held ?? {}))
      races.push({ club: programme.club, series: programme.series, id, race });
  }
  // By date, newest first: on a race morning the race you want is today's, and on any other
  // day it is the last one that happened.
  races.sort((a, b) => String(b.race.date ?? '').localeCompare(String(a.race.date ?? '')));
  state.races = races;
  if (!state.chosen && races.length) state.chosen = key(races[0]);
  renderPicker();
}

const key = (row) => `${row.club}/${row.series}/${row.id}`;
const chosen = () => state.races.find((row) => key(row) === state.chosen) ?? null;

async function poll() {
  const row = chosen();
  if (!row) return;
  try {
    state.conduct = await json(`/api/conduct/${encodeURIComponent(row.club)}`
      + `/${encodeURIComponent(row.series)}/${encodeURIComponent(row.id)}`);
    state.message = null;
  } catch (error) {
    state.message = `Could not read the race: ${error.message}`;
  }
  // Likewise: a snapshot that cannot be fetched costs that division's geometry on the chart,
  // and nothing else.
  await loadCourses(row).catch((error) => {
    state.message = `Could not read a course: ${error.message}`;
  });
  render();
}

/**
 * The geometry each division is sailing, fetched once per revision.
 *
 * A revision names one geometry, so a fetched snapshot can never go stale — which is what makes
 * caching it correct rather than merely cheap.
 */
async function loadCourses(row) {
  const published = await json('/api/public').catch(() => []);
  for (const [name, division] of Object.entries(row.race.divisions ?? {})) {
    const course = published.find((c) => c.club === row.club && c.series === row.series
      && c.course === division.course);
    const entry = (course?.published ?? []).find((p) => !division.variant
      || p.variant === division.variant);
    if (!entry) continue;
    division.revision = entry.revision;
    if (!state.courses.has(entry.revision)) {
      const snapshot = await json(`/api/courses/${encodeURIComponent(entry.revision)}`)
        .catch(() => null);
      if (snapshot) state.courses.set(entry.revision, snapshot);
    }
    void name;
  }
}

/* ======================================================================= the chart */

/** Every position in every division's course, so the chart can be fitted to the racing. */
function extent(row) {
  const out = [];
  for (const division of Object.values(row.race.divisions ?? {})) {
    const snapshot = state.courses.get(division.revision);
    for (const step of snapshot?.steps ?? []) {
      for (const crossing of step.crossings ?? []) {
        for (const end of [crossing.port, crossing.starboard]) {
          if (end?.latitude != null) out.push(end);
        }
      }
    }
  }
  return out;
}

/** The midpoint of a step, which is what a leg is measured between. */
function midOf(step) {
  const mids = (step.crossings ?? []).map((crossing) => ({
    latitude: ((crossing.port?.latitude ?? 0) + (crossing.starboard?.latitude ?? 0)) / 2,
    longitude: ((crossing.port?.longitude ?? 0) + (crossing.starboard?.longitude ?? 0)) / 2,
  }));
  if (!mids.length) return null;
  return {
    latitude: mids.reduce((sum, m) => sum + m.latitude, 0) / mids.length,
    longitude: mids.reduce((sum, m) => sum + m.longitude, 0) / mids.length,
  };
}

/**
 * How much of a division has sailed the leg into step `index`.
 *
 * <b>Read off what the boats said about themselves</b> — the step each has last crossed —
 * because that is the only thing anybody here knows (§1.1). A boat that has said nothing counts
 * as having sailed nothing, which is the honest reading and is why a division with no boats
 * reporting draws entirely as "still to come".
 */
function progressOf(boats, index, steps) {
  if (!boats.length) return 'none';
  const done = boats.filter((boat) => sailed(boat, index, steps)).length;
  if (done === 0) return 'none';
  return done === boats.length ? 'all' : 'some';
}

function sailed(boat, index, steps) {
  if ((boat.lap ?? 1) > 1) return true;          // a second lap has been round everything once
  if (boat.step == null) return false;
  void steps;
  return boat.step >= index;
}

function renderChart() {
  const row = chosen();
  const svg = el('chart');
  const box = svg.getBoundingClientRect();
  if (box.width > 20 && box.height > 20) {
    state.view.width = Math.round(box.width);
    state.view.height = Math.round(box.height);
    svg.setAttribute('viewBox', `0 0 ${state.view.width} ${state.view.height}`);
  }
  if (!row) {
    svg.innerHTML = '';
    return;
  }
  if (!state.fitted) {
    const positions = extent(row);
    if (positions.length) {
      state.view.fit(positions, 0.75);
      state.fitted = true;
    }
  }

  let out = state.view.tileLayer(state.basemap);
  const boats = state.conduct?.boats ?? [];
  const names = Object.keys(row.race.divisions ?? {});

  names.forEach((name, i) => {
    const division = row.race.divisions[name];
    const snapshot = state.courses.get(division.revision);
    if (!snapshot) return;
    const colour = DIVISION_COLOURS[i % DIVISION_COLOURS.length];
    const mine = boats.filter((boat) => (boat.tags ?? []).includes(`division:${name}`));
    const steps = snapshot.steps ?? [];

    // THE LEGS, textured by how much of the division has sailed them. Straight rather than
    // cornered — see the TODO at the head of this file.
    const pairs = [];
    for (let s = 0; s + 1 < steps.length; s++) pairs.push([s, s + 1]);
    if (snapshot.closed && steps.length > 1) pairs.push([steps.length - 1, 0]);
    for (const [from, to] of pairs) {
      const a = midOf(steps[from]);
      const b = midOf(steps[to]);
      if (!a || !b) continue;
      const [ax, ay] = state.view.toPx(a);
      const [bx, by] = state.view.toPx(b);
      const how = PROGRESS[progressOf(mine, to, steps)];
      out += `<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}"`
        + ` y2="${by.toFixed(1)}" stroke="${colour}" stroke-width="${how.width}"`
        + ` opacity="${how.opacity}"${how.dash ? ` stroke-dasharray="${how.dash}"` : ''}/>`;
    }

    // The lines themselves, and the letter of each step on them.
    steps.forEach((step, index) => {
      for (const crossing of step.crossings ?? []) {
        if (crossing.port?.latitude == null) continue;
        const [px, py] = state.view.toPx(crossing.port);
        const [sx, sy] = state.view.toPx(crossing.starboard);
        out += `<line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${sx.toFixed(1)}"`
          + ` y2="${sy.toFixed(1)}" stroke="${colour}" stroke-width="3.5" stroke-linecap="butt"/>`;
        const mx = (px + sx) / 2;
        const my = (py + sy) / 2;
        out += `<text x="${mx.toFixed(1)}" y="${(my - 7).toFixed(1)}" text-anchor="middle"`
          + ` font-family="var(--disp)" font-size="15" font-weight="700" fill="${colour}"`
          + ` style="paint-order:stroke;stroke:var(--sea);stroke-width:3px">`
          + `${esc(step.letter ?? index)}</text>`;
      }
    });
  });

  // EVERY BOAT THAT HAS JOINED, in its division's colour and with the hull glyph its own
  // screens use. Faded when its last fix is old, and saying how old — the same rule the boat's
  // own staleness follows, because a screen that quietly shows an old position is the one
  // failure a committee cannot see.
  for (const boat of boats) {
    if (!boat.position?.latitude) continue;
    const i = names.indexOf((boat.tags ?? []).map((t) => t.replace('division:', ''))[0]);
    const colour = DIVISION_COLOURS[(i < 0 ? 0 : i) % DIVISION_COLOURS.length];
    const [bx, by] = state.view.toPx(boat.position);
    const old = boat.fixAgeMs != null && boat.fixAgeMs > STALE_MS;
    out += `<g opacity="${old ? 0.4 : 1}" fill="${colour}">`
      + boatArt(bx, by, boat.cogDeg ?? 0, 22) + '</g>';
    out += `<text x="${(bx + 15).toFixed(1)}" y="${(by - 10).toFixed(1)}" font-family="var(--mono)"`
      + ` font-size="11" fill="${colour}"`
      + ` style="paint-order:stroke;stroke:var(--sea);stroke-width:3px">`
      + `${esc(boat.sailNo ?? boat.boatId ?? '?')}`
      + `${old ? ` ${Math.round(boat.fixAgeMs / 1000)}s` : ''}</text>`;
  }

  out += state.view.scaleBar();
  svg.innerHTML = out;

  el('legend').innerHTML = names.map((name, i) => {
    const colour = DIVISION_COLOURS[i % DIVISION_COLOURS.length];
    return `<span><i style="background:${colour}"></i>${esc(name)}</span>`;
  }).join('') + `
    <span><i style="background:var(--muted)"></i>solid: some boats have sailed it</span>
    <span>dashed: nobody yet</span>
    <span>faint: everybody</span>`;
}

/* ======================================================================== the pane */

function renderPicker() {
  el('pick').innerHTML = state.races.length === 0
    ? '<option value="">no races defined — use the editor\'s Races tab</option>'
    : state.races.map((row) => `<option value="${esc(key(row))}"${key(row) === state.chosen
      ? ' selected' : ''}>${esc(row.race.date ?? '')} ${esc(row.race.name ?? row.id)}`
      + ` — ${esc(row.club)}/${esc(row.series)}</option>`).join('');
}

function render() {
  renderChart();
  const row = chosen();
  el('clock').textContent = hhmmss(Date.now());
  if (!row) {
    el('pane').innerHTML = '<p class="hint">No race chosen. A race is DEFINED in the '
      + '<a href="editor.html">editor</a>, on its Races tab; this page runs one.</p>';
    return;
  }
  const states = state.conduct?.states ?? {};
  const boats = state.conduct?.boats ?? [];
  const now = Date.now();

  el('pane').innerHTML = `
    <h2>${esc(row.race.name ?? row.id)}</h2>
    <p class="hint">${esc(row.race.date ?? '')} &middot; ${esc(row.race.format ?? 'race')}
      &middot; ${esc(row.club)}/${esc(row.series)}
      ${row.race.next ? `&middot; next: ${esc(row.race.next)}` : ''}</p>
    ${state.message ? `<p class="warn" style="font-size:12px">${esc(state.message)}</p>` : ''}

    <h2>Starts</h2>
    <p class="hint">There is no GO button, and there cannot be: the server keeps no clock, so a
      start is scheduled as an absolute instant. "In five minutes" is arithmetic done here,
      against this computer's clock.</p>
    ${Object.keys(row.race.divisions ?? {}).map((name) =>
      startCard(name, row.race.divisions[name], states[`division:${name}`], now)).join('')}

    <h2>Fleet</h2>
    <p class="hint">One row per boat that has joined. The last two columns are the whole reason
      acknowledgements are in the protocol: <em>have all boats seen the new course?</em></p>
    ${boats.length === 0 ? '<p class="hint">Nobody has joined yet.</p>' : `
      <table class="fleet">
        <tr><th>Sail</th><th>Div</th><th>Fix</th><th>Mark</th><th>Elapsed</th>
          <th>Course</th><th>Flag</th><th></th></tr>
        ${boats.map((boat) => `
          <tr class="${boat.fixAgeMs != null && boat.fixAgeMs > STALE_MS ? 'stale' : ''}">
            <td>${esc(boat.sailNo ?? boat.boatId ?? '?')}</td>
            <td class="mono">${esc((boat.tags ?? []).map((t) =>
              t.replace('division:', '')).join(' '))}</td>
            <td class="mono">${boat.fixAgeMs == null ? '—'
              : `${Math.round(boat.fixAgeMs / 1000)}s`}</td>
            <td class="mono">${boat.step == null ? '—' : boat.step}${(boat.lap ?? 1) > 1
              ? `&middot;${boat.lap}` : ''}</td>
            <td class="mono">${esc(duration(boat.elapsedMs))}</td>
            <td class="seen ${boat.seen?.course === true ? 'yes' : 'no'}">${boat.seen
              && 'course' in boat.seen ? (boat.seen.course ? 'seen' : 'no') : '—'}</td>
            <td class="seen ${boat.seen?.flag === true ? 'yes' : 'no'}">${boat.seen
              && 'flag' in boat.seen ? (boat.seen.flag ? 'seen' : 'no') : '—'}</td>
            <td>${boat.outcome && boat.outcome !== 'racing'
              ? `<span class="mono">${esc(boat.outcome)}</span>`
              : `<button class="act danger" data-dnf="${esc(boat.boatId)}">DNF</button>`}</td>
          </tr>`).join('')}
      </table>`}

    <h2>Channel</h2>
    <p class="hint">The same open channel the boats are on. The committee is a participant, not
      a separate facility — "no private conversations" applies here too.</p>
    <div class="channel" id="channel">
      ${(state.conduct?.channel ?? []).slice(-60).map((entry) => `
        <div class="said ${entry.type === 'say' ? '' : 'state'}">
          <div class="who"><span class="mono">${esc(hhmmss(Date.parse(entry.at)))}</span>
            ${esc(entry.body?.from ?? entry.type)}</div>
          <div>${esc(entry.body?.text ?? '')}</div>
        </div>`).join('') || '<p class="hint">Nothing said yet.</p>'}
    </div>
    <div class="compose">
      <input id="sayText" placeholder="Say something to the fleet" autocomplete="off">
      <button class="act" id="sayGo">Send</button>
    </div>`;

  wirePane();
  const channel = el('channel');
  if (channel) channel.scrollTop = channel.scrollHeight;
}

/**
 * One division's start: publish, suspend, edit, publish — the whole of the control (§8.4).
 *
 * <b>Each division is entirely independent and there is no rolling sequence.</b> A real race
 * committee's postponement of one start delays the next; here it does not, deliberately,
 * because there is no "now" on the server to count five minutes from. Five divisions is this
 * done five times, which is no cascade to compute and none to get wrong.
 */
/**
 * THE OPERATOR'S OWN ZONE, said on the form.
 *
 * Every time typed here is local and every time on the wire is an instant, so the conversion is
 * this browser's — and a form that showed bare times with no zone would be one somebody could
 * read wrong on a committee boat borrowed from another club. Named rather than offered as a
 * choice: the operator's clock is the one they are looking at.
 */
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'local time';

/** `YYYY-MM-DDTHH:mm` in local time, which is what a `datetime-local` input speaks. */
function localValue(ms) {
  const at = new Date(ms);
  return new Date(ms - at.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** hh:mm of an instant, for saying what a sequence works out to. */
function hhmm(ms) {
  return Number.isFinite(ms) ? hhmmss(ms).slice(0, 5) : '—';
}

/**
 * What is in one division's start fields, seeded once and then left alone.
 *
 * <b>Seeded from the race's PLANNED start where the definition has one</b>, which is what that
 * field in the file is for: a rehearsal somebody wrote down in advance, brought to the screen
 * that publishes it. Otherwise five minutes from now, rounded up to the minute — a start time
 * with seconds in it is not a time anybody announces.
 *
 * Never re-seeded, because this page re-renders every couple of seconds: a seed that ran again
 * would type over whatever the operator was in the middle of entering.
 */
function seeded(name, division) {
  if (!state.starts[name]) {
    const planned = division.start ? Date.parse(division.start) : NaN;
    const from = Number.isFinite(planned) && planned > Date.now()
      ? planned : Math.ceil((Date.now() + 5 * 60000) / 60000) * 60000;
    state.starts[name] = { at: localValue(from), warning: 5, prep: 4 };
  }
  return state.starts[name];
}

function startCard(name, division, standing, now) {
  const which = standing?.state ?? 'none';
  const timer = standing?.timer?.body ?? null;
  const startAt = timer?.startAt ? Date.parse(timer.startAt) : null;
  const gone = startAt != null && startAt <= now;
  const postponed = which === 'postponed';
  const arming = state.arming;
  const typed = seeded(name, division);

  // AN ABSOLUTE TIME, not "in five minutes" — which is what a start sequence IS. A committee
  // decides a race starts at five past two and says so; the countdown to it is every boat's
  // own arithmetic, and the "in N minutes" form made the operator do that sum backwards.
  const wanted = Date.parse(typed.at);
  const ahead = Number.isFinite(wanted) ? (wanted - now) / 60000 : NaN;

  // The two rules of §8.5, enforced where the clock is — and the only clock that matters is the
  // one belonging to the person deciding. Said out loud rather than merely disabling a button:
  // a control that refuses without saying why teaches nothing.
  const floor = postponed ? 6 : 0;
  const tooSoon = !Number.isFinite(ahead) || ahead < floor;
  const past = Number.isFinite(ahead) && ahead < 0;

  return `<div class="card" data-division="${esc(name)}">
    <div class="who">
      <span class="name">${esc(name)}</span>
      <span class="mono muted">${esc(division.course)}${division.variant
        ? `/${esc(division.variant)}` : ''}</span>
      <span class="state ${which}">${esc(which)}</span>
    </div>
    ${startAt ? `<div class="said">start ${esc(hhmmss(startAt))}
      ${gone ? '(gone)' : `in ${Math.round((startAt - now) / 1000)} s`}
      &middot; ${esc(timer?.text ?? '')}</div>` : ''}
    ${postponed ? '<div class="said warn">Postponed. Publishing a start is what clears it — '
      + 'and it must be at least six minutes ahead, a minute before the warning signal and '
      + 'then the usual five.</div>' : ''}
    <div class="row">
      <label for="at_${esc(name)}">start at</label>
      <input type="datetime-local" id="at_${esc(name)}" data-at="${esc(name)}"
        value="${esc(typed.at)}" style="width:190px">
      <span class="said" style="margin:0">${esc(ZONE)}</span>
    </div>
    <!--
      TWO DURATIONS BEFORE IT, which is what the boat needs to show the flags a sailor expects:
      the warning signal five minutes out and the preparatory four. They are durations rather
      than instants because that is what they are — a sequence hangs off its start, and moving
      the start moves all of it.
    -->
    <div class="row">
      <label for="w_${esc(name)}">warning</label>
      <input type="number" min="0" max="60" id="w_${esc(name)}" data-warning="${esc(name)}"
        value="${typed.warning}" style="width:54px">
      <label for="p_${esc(name)}">preparatory</label>
      <input type="number" min="0" max="60" id="p_${esc(name)}" data-prep="${esc(name)}"
        value="${typed.prep}" style="width:54px">
      <label>min before</label>
    </div>
    <div class="row">
      <button class="act" data-publish="${esc(name)}"${tooSoon ? ' disabled' : ''}>
        ${postponed ? 'Re-start sequence' : 'Schedule start'}</button>
      <span class="said" style="margin:0">${Number.isFinite(wanted)
        ? `warning ${esc(hhmm(wanted - typed.warning * 60000))}`
          + ` &middot; preparatory ${esc(hhmm(wanted - typed.prep * 60000))}`
          + ` &middot; start ${esc(hhmm(wanted))}`
        : 'give it a time'}</span>
    </div>
    ${past ? '<div class="said warn">That is in the past. A start already gone cannot be '
      + 'scheduled; abandon the race instead, or give it a later time.</div>'
      : tooSoon ? `<div class="said warn">At least ${floor} minutes ahead after a postponement —
        a minute before the warning signal, then the usual five. A start a boat cannot see coming
        is worse than no postponement.</div>` : ''}
    <div class="row">
      ${gone || which === 'racing'
        // AP IS THE PRE-START SIGNAL AND ABANDONMENT IS THE POST-START ONE — which is not an
        // extra rule but what the two flags mean. So the screen offers the one that applies.
        ? `<button class="act danger ${arming === `abandon:${name}` ? 'arming' : ''}"
            data-abandon="${esc(name)}">${arming === `abandon:${name}`
            ? 'Abandon — press again' : 'Abandon'}</button>`
        : `<button class="act danger ${arming === `ap:${name}` ? 'arming' : ''}"
            data-ap="${esc(name)}"${which === 'none' ? ' disabled' : ''}>
            ${arming === `ap:${name}` ? 'AP — press again' : 'AP (postpone)'}</button>`}
      <button class="act" data-course="${esc(name)}"${division.revision ? '' : ' disabled'}>
        Publish course ${division.revision ? `(${esc(division.revision.slice(0, 6))})` : ''}</button>
    </div>
  </div>`;
}

/* ======================================================================== publishing */

async function publish(message) {
  const row = chosen();
  if (!row) return;
  try {
    await json(`/api/conduct/${encodeURIComponent(row.club)}/${encodeURIComponent(row.series)}`
      + `/${encodeURIComponent(row.id)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(message),
    });
    state.arming = null;
    await poll();
  } catch (error) {
    state.message = `Could not publish: ${error.message}`;
    render();
  }
}

/**
 * An irreversible act asks twice.
 *
 * There is no undo for telling a fleet to stop, which is the whole reason this page is not a
 * tab of the editor — and a confirmation that lives in the button itself rather than in a
 * dialog keeps the gesture in one place, so nobody is ever agreeing to something that has
 * scrolled out of view.
 */
function arm(what, then) {
  if (state.arming === what) {
    then();
    return;
  }
  state.arming = what;
  render();
}

function wirePane() {
  /*
   * THE FIELDS ARE READ ON `change`, NOT ON `input`, and that is not a detail here.
   *
   * This pane is rebuilt on every poll, so re-rendering as somebody types would take the caret
   * out of a half-typed time twice a second — the same trap the editor's forms are guarded
   * against, met on a page that has no guard because everything else on it is a button. On
   * `change` the value is committed and the field has been left, so the render is free.
   */
  const field = (attr, apply) => {
    for (const input of el('pane').querySelectorAll(`[data-${attr}]`)) {
      input.addEventListener('change', (ev) => {
        apply(input.dataset[attr], ev.target.value);
        render();
      });
    }
  };
  field('at', (name, value) => { seeded(name, {}).at = value; });
  field('warning', (name, value) => {
    seeded(name, {}).warning = Math.max(0, Number(value) || 0);
  });
  field('prep', (name, value) => { seeded(name, {}).prep = Math.max(0, Number(value) || 0); });

  for (const button of el('pane').querySelectorAll('[data-publish]')) {
    button.addEventListener('click', () => {
      const name = button.dataset.publish;
      const typed = seeded(name, {});
      const wanted = Date.parse(typed.at);
      if (!Number.isFinite(wanted)) return;
      /*
       * AN ABSOLUTE INSTANT GOES ON THE WIRE, and the conversion from what was typed is this
       * browser's — which is the whole of the timing model (§1.2, §8.4). The operator types a
       * local time because that is what a start is announced in; every boat then counts down to
       * the instant on its own clock, and the server neither ticks nor holds one.
       */
      const startAt = new Date(wanted).toISOString();
      publish({
        v: 1,
        type: 'timer',
        tags: [`division:${name}`],
        body: {
          startAt,
          // DURATIONS BEFORE THE START, so a boat can show the flags a sailor expects: the
          // warning signal and then the preparatory. They hang off the start rather than being
          // instants of their own, so moving the start moves the whole sequence with it.
          warningSeconds: typed.warning * 60,
          startSeconds: typed.prep * 60,
          // TEXT IS REQUIRED ON EVERY STATE MESSAGE (§9.4): it is what the channel shows, and
          // what reaches a sailor whose client is too old to act on the rest. A flag with no
          // words on it is a flag only the software can read — so this spells the sequence out
          // in the times it will actually happen at.
          text: `${name}: warning ${hhmm(wanted - typed.warning * 60000)}`
            + `, preparatory ${hhmm(wanted - typed.prep * 60000)}`
            + `, start ${hhmm(wanted)}`,
        },
      });
    });
  }

  for (const button of el('pane').querySelectorAll('[data-ap]')) {
    button.addEventListener('click', () => arm(`ap:${button.dataset.ap}`, () => publish({
      v: 1,
      type: 'flag',
      tags: [`division:${button.dataset.ap}`],
      body: {
        flag: 'postponed',
        reason: 'postponed by the race committee',
        text: `${button.dataset.ap}: AP — postponed. The start is void until a new one is published.`,
      },
    })));
  }

  for (const button of el('pane').querySelectorAll('[data-abandon]')) {
    button.addEventListener('click', () => arm(`abandon:${button.dataset.abandon}`,
      () => publish({
        v: 1,
        type: 'flag',
        tags: [`division:${button.dataset.abandon}`],
        body: {
          flag: 'abandoned',
          reason: 'abandoned by the race committee',
          text: `${button.dataset.abandon}: ABANDONED. Stop racing.`,
        },
      })));
  }

  for (const button of el('pane').querySelectorAll('[data-course]')) {
    button.addEventListener('click', () => {
      const row = chosen();
      const division = row?.race.divisions?.[button.dataset.course];
      const snapshot = state.courses.get(division?.revision);
      if (!snapshot) return;
      publish({
        v: 1,
        type: 'course',
        tags: [`division:${button.dataset.course}`],
        body: {
          revision: division.revision,
          course: snapshot,
          reason: 'course change',
          text: `${button.dataset.course}: sail course ${division.course}`
            + `${division.variant ? `/${division.variant}` : ''} (${division.revision})`,
        },
      });
    });
  }

  for (const button of el('pane').querySelectorAll('[data-dnf]')) {
    button.addEventListener('click', () => arm(`dnf:${button.dataset.dnf}`, () => publish({
      v: 1,
      type: 'outcome',
      body: {
        boatId: button.dataset.dnf,
        outcome: 'dnf',
        reason: 'did not finish',
        // NEVER INFERRED (§8.6): a boat is DNF because a committee decided and typed it, not
        // because the server worked it out from a boat that stopped reporting.
        text: `${button.dataset.dnf}: DNF, recorded by the race committee.`,
      },
    })));
  }

  el('sayGo')?.addEventListener('click', () => {
    const field = el('sayText');
    const text = field?.value?.trim();
    if (!text) return;
    field.value = '';
    publish({ v: 1, type: 'say', body: { from: 'race committee', text } });
  });
}

/* ========================================================================== start-up */

el('pick').addEventListener('change', (ev) => {
  state.chosen = ev.target.value;
  state.fitted = false;
  state.conduct = null;
  poll();
});

el('basemap').innerHTML = Object.entries(BASEMAPS)
  .map(([k, spec]) => `<option value="${k}"${k === state.basemap ? ' selected' : ''}>${spec.label}</option>`)
  .join('');
el('basemap').addEventListener('change', (ev) => {
  state.basemap = ev.target.value;
  render();
});

el('chart').addEventListener('wheel', (ev) => {
  ev.preventDefault();
  const box = el('chart').getBoundingClientRect();
  state.view.zoomAtPx(ev.clientX - box.left, ev.clientY - box.top,
    wheelZoomStep(ev.deltaY, ev.deltaMode));
  render();
}, { passive: false });

let drag = null;
el('chart').addEventListener('pointerdown', (ev) => {
  drag = { x: ev.clientX, y: ev.clientY };
  el('chart').setPointerCapture(ev.pointerId);
});
el('chart').addEventListener('pointermove', (ev) => {
  if (!drag) return;
  state.view.panByPx(ev.clientX - drag.x, ev.clientY - drag.y);
  drag = { x: ev.clientX, y: ev.clientY };
  render();
});
el('chart').addEventListener('pointerup', () => { drag = null; });

/*
 * DRAWN ONCE BEFORE ANYTHING IS FETCHED, and not only for the look of it: this page makes
 * several round trips before it has a race to show — the programmes, then each series' races,
 * then the conduct, then a snapshot per division — and a page that shows nothing at all until
 * they have all landed is a page that looks broken on a slow link at a club with a bad
 * connection, which is most clubs.
 */
render();
showWhoami();
await loadRaces();
await poll();
// A second is the right rate for a desk: the fleet feed itself is five-second and the states
// change when somebody presses something, so this is only the clock moving.
setInterval(poll, 2000);
setInterval(() => { el('clock').textContent = hhmmss(Date.now()); }, 1000);

/** Exposed for the headless driver only; nothing in the page reads it. */
export const __state = state;
