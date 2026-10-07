/**
 * RACE MANAGEMENT — the committee's screen, `wiki/client-server-dialog.md` §12. Section numbers
 * (§) below are that document's.
 *
 * <h2>What this page is for, and what it deliberately is not</h2>
 * It watches every race RUNNING — public, today, and not yet over — on one chart, and acts on one
 * of them at a time, chosen by series and then race: it can DELAY a start, POSTPONE one (AP),
 * ABANDON a race and talk on the channel. Everything else about a race — its divisions, its courses and its starts —
 * is set in the editor's Races tab, and while a race is public the server hands its boats the
 * starts defined there (`Dialog.sync`). It does not score, it does not measure, and it has <b>no
 * GO button</b> — which is not an omission but §1.2: the server keeps no clock, so a start cannot be
 * triggered, only scheduled as an absolute instant.
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
 * <li><b>A second tier of officer.</b> The page is behind the login (`UnmarkedSecurityHandler`),
 *     and any account the login admits may abandon a race; *some may abandon, others only
 *     watch* is not enforced (`wiki/open-questions.md`, question 8).
 * <li><b>A session of its own.</b> It reads conduct and publishes over REST, so the committee
 *     writes into the same channel without being one party in the conversation.
 * </ul>
 */

import { BASEMAPS, MapView, wheelZoomStep } from './geo.js';
import { boatArt, esc, hhmmss } from './markscreen.js';
import { stripes } from './coursedraw.js';
import { envelope, geometry } from './handicap.js';
import { duration } from './screens.js';
import { editableClubs, showWhoami } from './whoami.js';

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
  // THE CHART, NOT THE SEA CHART: the committee is watching boats and lines, and every light and
  // buoy on top of the bathymetry is ink competing with them. The sea chart is one choice away.
  basemap: 'chart',
  programmes: [],
  races: [],            // {club, series, id, race}: every race defined
  chosen: null,         // the race the pane is acting on: one of those running
  conducts: new Map(),  // race key → its conduct, for every race polled
  conduct: null,        // the chosen race's conduct
  courses: new Map(),   // revision → snapshot
  delays: {},           // division tag → minutes typed into its Delay field
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
   * screen saying why. A club's connection being briefly bad is not an unusual condition.
   */
  try {
    // Only the clubs this account is an officer of: another club's races are not this desk's.
    const mine = editableClubs(await WHOAMI);
    state.programmes = (await json('/api/programmes')).filter((p) => !mine || mine.has(p.club));
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
  state.races = races;
}

const key = (row) => `${row.club}/${row.series}/${row.id}`;
const today = () => new Date().toLocaleDateString('en-CA');

/** Today's races that boats may join: the ones this page polls. */
const todays = () => state.races.filter((row) => row.race.date === today() && row.race.public !== false);

/**
 * THE RACES RUNNING NOW: public, today, and not over. A race is over once every boat in it has
 * finished or retired, or once every division's line has closed and its time limit has run —
 * which is known only where it has a time limit, so a race with none runs until the day is out.
 */
const running = () => todays().filter((row) => !over(row));

function over(row, now = Date.now()) {
  const conduct = state.conducts.get(key(row));
  const boats = conduct?.boats ?? [];
  if (boats.length && boats.every((boat) => boat.outcome && boat.outcome !== 'racing')) return true;
  const names = Object.keys(row.race.divisions ?? {});
  if (!names.length) return false;
  return names.every((name) => {
    const standing = conduct?.states?.[`division:${name}`];
    if (standing?.state === 'abandoned') return true;
    const body = standing?.timer?.body ?? standing?.derived;
    const limit = Number(body?.timeLimitSeconds);
    if (!body || !(limit > 0)) return false;
    // An allocated start is over once its LAST start's line has closed and its limit has run.
    const opens = Date.parse(body.kind === 'allocated' ? body.lastStartAt ?? '' : body.startAt ?? '');
    if (!Number.isFinite(opens)) return false;
    const closes = body.closesAt ? Date.parse(body.closesAt) : opens + Number(body.openSeconds ?? 600) * 1000;
    return now > closes + limit * 1000;
  });
}

const chosen = () => running().find((row) => key(row) === state.chosen) ?? null;

/** Read every one of today's races, and the geometry each division is sailing. */
async function poll() {
  if (++polls % 8 === 0) await loadRaces();
  for (const row of todays()) {
    try {
      state.conducts.set(key(row), await json(`/api/conduct/${encodeURIComponent(row.club)}`
        + `/${encodeURIComponent(row.series)}/${encodeURIComponent(row.id)}`));
      state.message = null;
    } catch (error) {
      state.message = `Could not read ${row.id}: ${error.message}`;
    }
    // A snapshot that cannot be fetched costs that division's geometry on the chart, and nothing
    // else.
    await loadCourses(row).catch((error) => {
      state.message = `Could not read a course: ${error.message}`;
    });
  }
  if (!chosen()) state.chosen = running()[0] ? key(running()[0]) : null;
  state.conduct = state.chosen ? state.conducts.get(state.chosen) ?? null : null;
  render();
}

/** Races are re-read every so often, so one made public in the editor appears here. */
let polls = 0;

/**
 * The geometry each division is sailing, fetched once per revision.
 *
 * A revision names one geometry, so a fetched snapshot can never go stale — which is what makes
 * caching it correct rather than merely cheap.
 */
async function loadCourses(row) {
  const published = await json('/api/public').catch(() => []);
  for (const division of Object.values(row.race.divisions ?? {})) {
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
  // A rounding is measured to its mark, the line's port end.
  const mids = (step.crossings ?? []).map((crossing) => (crossing.point
    ? { latitude: crossing.port?.latitude ?? 0, longitude: crossing.port?.longitude ?? 0 }
    : {
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

/**
 * EVERY RACE RUNNING, on one chart: each division of each race in a colour of its own, its legs
 * textured by how much of it has sailed them, and every boat that has joined. The pane acts on one
 * race at a time; the water is shared, so the chart shows all of it.
 */
function renderChart() {
  const svg = el('chart');
  const box = svg.getBoundingClientRect();
  if (box.width > 20 && box.height > 20) {
    state.view.width = Math.round(box.width);
    state.view.height = Math.round(box.height);
    svg.setAttribute('viewBox', `0 0 ${state.view.width} ${state.view.height}`);
  }
  const rows = running();
  const divisions = rows.flatMap((row) => Object.keys(row.race.divisions ?? {})
    .map((name) => ({ row, name, division: row.race.divisions[name] })));
  if (!divisions.length) {
    svg.innerHTML = state.view.tileLayer(state.basemap);
    el('legend').innerHTML = '';
    return;
  }
  if (!state.fitted) {
    const positions = rows.flatMap((row) => extent(row));
    if (positions.length) {
      state.view.fit(positions, 0.75);
      state.fitted = true;
    }
  }

  let out = state.view.tileLayer(state.basemap);
  const colourOf = (row, name) => {
    const i = divisions.findIndex((d) => d.row === row && d.name === name);
    return DIVISION_COLOURS[(i < 0 ? 0 : i) % DIVISION_COLOURS.length];
  };

  for (const { row, name, division } of divisions) {
    const snapshot = state.courses.get(division.revision);
    if (!snapshot) continue;
    const colour = colourOf(row, name);
    const boats = state.conducts.get(key(row))?.boats ?? [];
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

    // The lines themselves, and the letter of each step on them. A step handicapped by distance
    // has no one line: every boat has its own, somewhere in the striped zone.
    const shape = geometry(snapshot);
    steps.forEach((step, index) => {
      const corners = step.handicapWidthM != null ? envelope(snapshot, index, shape) : null;
      if (corners) {
        out += stripes(corners.map((p) => { const [x, y] = state.view.toPx(p); return { x, y }; }),
          { colour, opacity: 0.45, outline: 0.8 });
      }
      for (const crossing of step.crossings ?? []) {
        if (crossing.port?.latitude == null) continue;
        const [px, py] = state.view.toPx(crossing.port);
        if (crossing.point) {
          // A rounding is its mark, a dot, never the line it is crossed as.
          out += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="5" fill="${colour}"/>`
            + `<text x="${px.toFixed(1)}" y="${(py - 9).toFixed(1)}" text-anchor="middle"`
            + ` font-family="var(--disp)" font-size="15" font-weight="700" fill="${colour}"`
            + ` style="paint-order:stroke;stroke:var(--sea);stroke-width:3px">`
            + `${esc(step.letter ?? index)}</text>`;
          continue;
        }
        const [sx, sy] = state.view.toPx(crossing.starboard);
        if (!corners) {
          out += `<line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${sx.toFixed(1)}"`
            + ` y2="${sy.toFixed(1)}" stroke="${colour}" stroke-width="3.5" stroke-linecap="butt"/>`;
        }
        const mx = (px + sx) / 2;
        const my = (py + sy) / 2;
        out += `<text x="${mx.toFixed(1)}" y="${(my - 7).toFixed(1)}" text-anchor="middle"`
          + ` font-family="var(--disp)" font-size="15" font-weight="700" fill="${colour}"`
          + ` style="paint-order:stroke;stroke:var(--sea);stroke-width:3px">`
          + `${esc(step.letter ?? index)}</text>`;
      }
    });
  }

  // EVERY BOAT THAT HAS JOINED, in its division's colour and with the hull glyph its own
  // screens use. Faded when its last fix is old, and saying how old — a screen that quietly shows
  // an old position is the one failure a committee cannot see.
  for (const row of rows) {
    for (const boat of state.conducts.get(key(row))?.boats ?? []) {
      if (!boat.position?.latitude) continue;
      const name = (boat.tags ?? []).map((t) => t.replace('division:', ''))[0];
      const colour = colourOf(row, name);
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
  }

  out += state.view.scaleBar();
  svg.innerHTML = out;

  el('legend').innerHTML = divisions.map(({ row, name }) =>
    `<span><i style="background:${colourOf(row, name)}"></i>${esc(rows.length > 1
      ? `${row.race.name ?? row.id} · ${name}` : name)}</span>`).join('') + `
    <span><i style="background:var(--muted)"></i>solid: some boats have sailed it</span>
    <span>dashed: nobody yet</span>
    <span>faint: everybody</span>`;
}

/* ======================================================================== the pane */

/*
 * THE PANE IS NOT REBUILT UNDER SOMEBODY'S HANDS. It is rebuilt on every poll, twice a second,
 * and rebuilding it replaces every field in it — so a start time being typed, or the channel's
 * text box, lost its focus and its caret mid-edit, and a click whose press and release met two
 * different buttons was swallowed. While a field in the pane has focus, or a pointer is down in
 * it, the pane waits; the chart and the clock go on. The redraw held back happens when the field
 * is left or the press released — after the click has landed, and after `change` has committed
 * what was typed, which is when the fields read their value.
 */
const paneState = { pressing: false, heldBack: false };
function paneBusy() {
  const active = document.activeElement;
  return paneState.pressing || (!!active && !!el('pane').contains?.(active)
    && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName ?? ''));
}
el('pane').addEventListener('pointerdown', () => { paneState.pressing = true; }, true);
const releasePane = () => {
  if (!paneState.pressing) return;
  paneState.pressing = false;
  if (paneState.heldBack) setTimeout(render, 0);
};
window.addEventListener('pointerup', releasePane, true);
window.addEventListener('pointercancel', releasePane, true);
el('pane').addEventListener('focusout', () => { if (paneState.heldBack) setTimeout(render, 0); });

function render() {
  renderChart();
  el('clock').textContent = hhmmss(Date.now());
  if (paneBusy()) {
    paneState.heldBack = true;
    return;
  }
  paneState.heldBack = false;
  const rows = running();
  const row = chosen();
  const now = Date.now();
  // A SERIES, THEN A RACE: race names repeat from one series to the next ("Race 3"), so a race
  // is picked within its series. The chart shows every race running; the controls act on this one.
  const seriesOf = (r) => `${r.club}/${r.series}`;
  const series = [...new Set(rows.map(seriesOf))];
  const inSeries = row ? rows.filter((r) => seriesOf(r) === seriesOf(row)) : [];
  const tabs = row ? `<div class="pick">
      <select data-pick="series" title="series">${series.map((s) => `<option value="${esc(s)}"${s
        === seriesOf(row) ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <select data-pick="race" title="race">${inSeries.map((r) => `<option value="${esc(key(r))}"${key(r)
        === state.chosen ? ' selected' : ''}>${esc(r.race.name ?? r.id)}</option>`).join('')}</select>
    </div>` : '';
  if (!row) {
    el('pane').innerHTML = `${state.message ? `<p class="warn" style="font-size:12px">${esc(state.message)}</p>` : ''}
      <p class="hint">No race is running. A race is DEFINED — its divisions, courses and starts — in the
      <a href="editor.html">editor</a>, on its Races tab, and runs here once it is public on its day.</p>`;
    wirePane();
    return;
  }
  const states = state.conduct?.states ?? {};
  const boats = state.conduct?.boats ?? [];

  el('pane').innerHTML = `
    ${tabs}
    <h2>${esc(row.race.name ?? row.id)}</h2>
    <p class="hint">${esc(row.race.date ?? '')} &middot; ${esc(KIND_SAID[row.race.startType ?? 'scratch'])}
      &middot; ${esc(row.club)}/${esc(row.series)}
      ${row.race.next ? `&middot; next: ${esc(row.race.next)}` : ''}</p>
    ${state.message ? `<p class="warn" style="font-size:12px">${esc(state.message)}</p>` : ''}

    <h2>Starts</h2>
    <p class="hint">Set in the editor, with the rest of the race. Here a start can be delayed,
      postponed (AP) or abandoned.</p>
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
            <td class="mono">${esc(boat.outcome && boat.outcome !== 'racing' ? boat.outcome : '')}</td>
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

/** What each way of starting a race means, said under the race's name. */
const KIND_SAID = {
  scratch: 'Scratch start: one start for all, elapsed from it',
  open: 'Open start: the line opens and closes, elapsed from each boat\'s crossing',
  allocated: 'Allocated start: each boat gave its own time when it joined',
};

/** hh:mm of an instant, for saying what a sequence works out to. */
function hhmm(ms) {
  return Number.isFinite(ms) ? hhmmss(ms).slice(0, 5) : '—';
}


/**
 * A DELAYED START, as the timer that says so: the start this division has (or, after an AP, the
 * one its definition gives) moved later, the whole sequence with it.
 *
 * Moved on from ITSELF while it is still scheduled — delay ten minutes, and it is ten minutes
 * later than it was. After an AP there is no start to move, so the new one counts from now, and
 * must leave a full sequence: at least a minute before the warning signal (§8.5). An allocated
 * start has no common time to move. Null, with the reason, when it cannot be done.
 */
export function delayed(standing, name, minutes, now = Date.now()) {
  const base = standing?.timer?.body ?? standing?.derived;
  if (!base) return { error: `${name} has no start to delay.` };
  if (base.kind === 'allocated') return { error: `${name} starts at each boat's own time: there is no common start to delay.` };
  const start = Date.parse(base.startAt ?? '');
  if (!Number.isFinite(start)) return { error: `${name} has no start time to delay.` };
  const postponed = standing?.state === 'postponed';
  if (!postponed && start <= now) return { error: `${name} has started: abandon it instead.` };
  const warning = Number(base.warningSeconds ?? 300) * 1000;
  const newStart = postponed
    ? Math.ceil((now + minutes * 60000) / 60000) * 60000
    : start + minutes * 60000;
  if (newStart - now < warning + 60000) {
    return { error: `${name}: a new start has to be at least ${Math.round(warning / 60000) + 1} minutes`
      + ' away, a minute before its warning signal.' };
  }
  const shift = newStart - start;
  const body = { ...base, startAt: new Date(newStart).toISOString() };
  if (base.closesAt) body.closesAt = new Date(Date.parse(base.closesAt) + shift).toISOString();
  body.text = `${name}: delayed — warning ${hhmm(newStart - warning)}`
    + `, preparatory ${hhmm(newStart - Number(base.startSeconds ?? 240) * 1000)}`
    + (base.kind === 'open' ? `, line opens ${hhmm(newStart)}, closes ${hhmm(Date.parse(body.closesAt))}`
      : `, start ${hhmm(newStart)}`);
  return { body };
}

/**
 * One division's start, as it stands, and the three things that can be done to it here: delay it,
 * postpone it (AP) before it has gone, abandon it after. Everything else about a start is set in
 * the editor.
 *
 * <b>Each division is entirely independent and there is no rolling sequence.</b> A real race
 * committee's postponement of one start delays the next; here it does not, deliberately, because
 * there is no "now" on the server to count five minutes from.
 */
function startCard(name, division, standing, now) {
  const which = standing?.state ?? 'none';
  const body = standing?.timer?.body ?? null;
  const startAt = body?.startAt ? Date.parse(body.startAt) : null;
  const gone = startAt != null && startAt <= now;
  const postponed = which === 'postponed';
  const arming = state.arming;
  const tag = `division:${name}`;
  const typed = state.delays[tag] ?? '';
  const allocated = (body ?? standing?.derived)?.kind === 'allocated';
  const canDelay = !allocated && !gone && which !== 'abandoned' && (standing?.timer || standing?.derived);

  return `<div class="card" data-division="${esc(name)}">
    <div class="who">
      <span class="name">${esc(name)}</span>
      <span class="mono muted">${esc(division.course)}${division.variant
        ? `/${esc(division.variant)}` : ''}</span>
      <span class="state ${which}">${esc(which)}</span>
    </div>
    ${body ? `<div class="said">${esc(body.text ?? '')}</div>` : ''}
    ${startAt ? `<div class="said">${body?.kind === 'open' ? 'opens' : 'start'} ${esc(hhmmss(startAt))}
      ${gone ? '(gone)' : `in ${Math.round((startAt - now) / 1000)} s`}</div>` : ''}
    ${postponed ? '<div class="said warn">Postponed. Delay gives it a new start, which clears the AP.</div>' : ''}
    ${!body && !standing?.derived ? '<div class="said warn">No start yet: set one in the editor.</div>' : ''}
    ${canDelay ? `<div class="row">
      <label>delay</label>
      ${[5, 10, 15].map((m) => `<button class="act" data-delay="${esc(name)}:${m}">${m} min</button>`).join('')}
      <input data-delaymin="${esc(tag)}" value="${esc(typed)}" placeholder="min" inputmode="numeric" style="width:48px">
      <button class="act" data-delaygo="${esc(name)}">Delay</button>
    </div>` : ''}
    <div class="row">
      ${gone || which === 'racing'
        // AP IS THE PRE-START SIGNAL AND ABANDONMENT IS THE POST-START ONE — which is not an
        // extra rule but what the two flags mean. So the screen offers the one that applies.
        ? `<button class="act danger ${arming === `abandon:${name}` ? 'arming' : ''}"
            data-abandon="${esc(name)}"${which === 'abandoned' ? ' disabled' : ''}>${arming === `abandon:${name}`
          ? 'Abandon — press again' : 'Abandon'}</button>`
        : `<button class="act ${arming === `ap:${name}` ? 'arming' : ''}"
            data-ap="${esc(name)}"${which === 'none' || postponed ? ' disabled' : ''}>
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
  const pick = (chosenKey) => {
    state.chosen = chosenKey;
    state.conduct = state.conducts.get(state.chosen) ?? null;
    state.arming = null;
    el('pane').querySelector('[data-pick]:focus')?.blur?.();
    render();
  };
  el('pane').querySelector('[data-pick="series"]')?.addEventListener('change', (ev) => {
    const first = running().find((r) => `${r.club}/${r.series}` === ev.target.value);
    if (first) pick(key(first));
  });
  el('pane').querySelector('[data-pick="race"]')?.addEventListener('change', (ev) => pick(ev.target.value));

  // DELAY: a new start, the whole sequence moved with it — see `delayed`.
  const delay = (name, minutes) => {
    const standing = state.conduct?.states?.[`division:${name}`];
    const result = delayed(standing, name, minutes);
    if (result.error) {
      state.message = result.error;
      render();
      return;
    }
    publish({ v: 1, type: 'timer', tags: [`division:${name}`], body: result.body });
  };
  for (const button of el('pane').querySelectorAll('[data-delay]')) {
    button.addEventListener('click', () => {
      const [name, minutes] = button.dataset.delay.split(':');
      delay(name, Number(minutes));
    });
  }
  for (const input of el('pane').querySelectorAll('[data-delaymin]')) {
    input.addEventListener('change', (ev) => { state.delays[input.dataset.delaymin] = ev.target.value; });
  }
  for (const button of el('pane').querySelectorAll('[data-delaygo]')) {
    button.addEventListener('click', () => {
      const name = button.dataset.delaygo;
      const minutes = Math.round(Number(state.delays[`division:${name}`]));
      if (!(minutes > 0)) {
        state.message = `${name}: give the delay in minutes.`;
        render();
        return;
      }
      delay(name, minutes);
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
        text: `${button.dataset.ap}: AP — postponed. The start is void until a new one is given.`,
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

  // A COURSE CHANGE, kept until shortening is designed: the same course handed out again.
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

  el('sayGo')?.addEventListener('click', () => {
    const field = el('sayText');
    const text = field?.value?.trim();
    if (!text) return;
    field.value = '';
    publish({ v: 1, type: 'say', body: { from: 'race committee', text } });
  });
}

/* ========================================================================== start-up */

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
const WHOAMI = showWhoami();
await loadRaces();
await poll();
// A second is the right rate for a desk: the fleet feed itself is five-second and the states
// change when somebody presses something, so this is only the clock moving.
setInterval(poll, 2000);
setInterval(() => { el('clock').textContent = hhmmss(Date.now()); }, 1000);

/** Exposed for the headless driver only; nothing in the page reads it. */
export const __state = state;
