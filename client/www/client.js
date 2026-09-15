/**
 * The prototype client, and the rig that drives it.
 *
 * <h2>The seam is the whole point of this page</h2>
 * There are two things here and exactly one thing passes between them. On the left a
 * simulated boat and a simulated receiver; on the right a {@link RaceClient} fed the fixes
 * that receiver produces. The client is never handed the boat, the target, the speed
 * slider or the knowledge that any of it is simulated — it gets a fix, which is a position,
 * a time, a stated accuracy, a satellite count, SOG and COG, and that is all a real
 * receiver would give it either.
 *
 * So there is one function in this file, {@link emit}, whose body would be replaced by a
 * `navigator.geolocation.watchPosition` callback to put this on the water, and nothing else
 * in `raceclient.js`, `markscreen.js` or `crossing.js` would change by a character. A test
 * client that shared state with the thing it tests is a demonstration, not a test.
 *
 * <h2>What the rig is for</h2>
 * Steering a boat at a line by hand is the only way to see the screens do what they are
 * supposed to do, and the three knobs that are not speed are there because a PERFECT boat
 * exercises none of the code that matters. With no noise every fix resolves cleanly, the
 * accuracy band never does anything, quality control accepts everything for ever, and the
 * 3-and-3 latch confirms instantly every time. Turn the noise up and a boat sitting on the
 * line stops resolving to a side, which is the band earning its keep; turn the flyers up
 * and the kinematic gate starts rejecting fixes that would otherwise have manufactured a
 * matched pair of crossings the boat never made.
 */

import { BASEMAPS, MapView, wheelZoomStep } from './geo.js';
import { BoatSim, bearingTo, metresBetween, offsetBy } from './boatsim.js';
import { RaceClient } from './raceclient.js';
import { PlotView, Turner, crossingNormal, esc, hhmmss, markScreen, overviewPanel } from './markscreen.js';

const el = (id) => document.getElementById(id);

const state = {
  view: new MapView(),
  basemap: 'seaSimple',
  orientation: 'north',
  sim: new BoatSim({ at: { latitude: -33.8, longitude: 151.27 }, running: false }),
  client: null,
  snapshot: null,
  courses: [],
  boat: { sail: '', name: '', tcf: '1.000', mode: 'ANONYMOUS' },
  placing: false,
  pointer: null,
  dragging: false,
  // The Mark screen's frame, held across renders so the boat is seen to move across it
  // rather than sitting in the middle of a picture that re-fits itself every frame.
  plotView: new PlotView(),
  // The overview turns too, and keeps its own swing: the two screens are looking at different
  // things and arrive at a new leg at different moments, so one shared bearing would have each
  // of them jumping whenever the other one moved.
  courseTurn: new Turner(),
  wake: [],
  trail: [],
  tileKey: null,
  timer: null,
  message: null,
};

/* ============================================================ the rig's chart */

/**
 * Tiles are re-rendered only when the view actually moves.
 *
 * The overlay is redrawn every animation frame so the boat moves smoothly, and rewriting
 * the tile images at that rate would have the browser re-create a hundred `<image>`
 * elements sixty times a second — which flickers, and which fetches. The two therefore
 * live in separate groups with separate lifetimes.
 */
function renderTiles() {
  const svg = el('rig');
  const box = svg.getBoundingClientRect();
  if (box.width > 20 && box.height > 20) {
    state.view.width = Math.round(box.width);
    state.view.height = Math.round(box.height);
    svg.setAttribute('viewBox', `0 0 ${state.view.width} ${state.view.height}`);
  }
  const key = [state.view.zoom.toFixed(4), state.view.center.wx.toFixed(7),
    state.view.center.wy.toFixed(7), state.view.width, state.view.height, state.basemap].join('|');
  if (key === state.tileKey) return;
  state.tileKey = key;
  el('tiles').innerHTML = state.view.tileLayer(state.basemap);
  el('scale').innerHTML = state.view.scaleBar();
}

/** The course, the boat and where it is going — everything that moves. */
function renderOverlay() {
  const view = state.view;
  const client = state.client;
  let out = '';

  if (client) {
    // One entry per distinct line, so a line used three times is drawn once. Which steps
    // use it goes on as letters, in course order, which is the same thing the editor's
    // triangles say and says it in the space a chart this small has.
    const byLine = new Map();
    client.steps.forEach((step) => {
      for (const crossing of step.crossings) {
        if (!byLine.has(crossing.line)) byLine.set(crossing.line, { crossing, steps: [] });
        byLine.get(crossing.line).steps.push(step);
      }
    });

    for (const [id, { crossing, steps }] of byLine) {
      const raw = client.snapshot.steps[steps[0].index].crossings
        .find((c) => c.line === id) ?? null;
      if (!raw) continue;
      const [ax, ay] = view.toPx(raw.port);
      const [bx, by] = view.toPx(raw.starboard);
      const live = steps.some((s) => s.index === client.at && !client.finished);
      out += `<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}"`
        + ` stroke="${live ? 'var(--ok)' : 'var(--line)'}" stroke-width="${live ? 4 : 2.5}" stroke-linecap="round" opacity="${live ? 1 : 0.7}"/>`;
      for (const [px, py] of [[ax, ay], [bx, by]])
        out += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3" fill="${live ? 'var(--ok)' : 'var(--line)'}"/>`;
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      out += `<text x="${mx.toFixed(1)}" y="${(my - 8).toFixed(1)}" text-anchor="middle"`
        + ` font-family="var(--mono)" font-size="11" fill="${live ? 'var(--ok)' : 'var(--line)'}"`
        + ` style="paint-order:stroke;stroke:var(--sea);stroke-width:3px">${esc(steps.map((s) => s.letter).join(' '))}</text>`;
    }
  }

  // The TRUE track. This is the rig's own knowledge and is drawn on the rig's own chart
  // only — it is what the boat did, against which what the client believed can be judged.
  if (state.wake.length > 1) {
    const path = state.wake.map((p, i) => `${i ? 'L' : 'M'}${view.toPx(p).map((v) => v.toFixed(1)).join(',')}`).join('');
    out += `<path d="${path}" fill="none" stroke="var(--muted)" stroke-width="1.4" opacity="0.55"/>`;
  }

  // What the CLIENT believes, as the fixes it accepted. Where this parts company with the
  // track above is the receiver lying, which is the thing worth being able to see.
  if (client) {
    for (const point of client.fixes.slice(-40)) {
      const position = offsetBy(client.origin, point.x, point.y);
      const [px, py] = view.toPx(position);
      out += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="1.8" fill="var(--fromside)" opacity="0.8"/>`;
    }
  }

  // THE CURSOR, drawn rather than relied upon. A crosshair from the operating system is one
  // hairline on a chart that is mostly dark water and mostly busy — over tiles it disappears
  // entirely, and this is a page whose whole interaction is "click exactly there". So the
  // chart draws its own, big enough to find without looking for it.
  //
  // It also SAYS WHAT THE CLICK WILL DO, which is the rule the editor's chart already follows:
  // green for a helm order, orange for putting the boat down. Two colours for two gestures
  // that are one click apart and cannot be undone.
  if (state.pointer && !state.dragging) {
    const { x, y } = state.pointer;
    const colour = state.placing ? 'var(--toside)' : 'var(--ok)';

    // Range and bearing from the boat, because on a steering rig the question behind every
    // click is "how far is that, and which way" — and it is free to answer here.
    const [bx0, by0] = view.toPx(state.sim.at);
    out += `<line x1="${bx0.toFixed(1)}" y1="${by0.toFixed(1)}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"`
      + ` stroke="${colour}" stroke-width="1" stroke-dasharray="3,5" opacity="0.5"/>`;
    const target = view.toPosition(x, y);
    const range = metresBetween(state.sim.at, target);
    const label = range >= 1852 ? `${(range / 1852).toFixed(2)} nm` : `${Math.round(range)} m`;
    out += `<text x="${(x + 20).toFixed(1)}" y="${(y - 16).toFixed(1)}" font-family="var(--mono)"`
      + ` font-size="11" fill="${colour}" style="paint-order:stroke;stroke:var(--sea);stroke-width:4px">`
      + `${esc(`${String(Math.round(bearingTo(state.sim.at, target))).padStart(3, '0')}\u00b0  ${label}`)}</text>`;

    // Drawn twice, dark underneath: a reticle in one colour vanishes wherever it crosses
    // something of about that brightness, which on a sea chart is most places.
    for (const [stroke, extra] of [['var(--sea)', 2.6], [colour, 0]]) {
      const w = (1.8 + extra).toFixed(1);
      out += `<g fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" opacity="${stroke === 'var(--sea)' ? 0.85 : 1}">`
        + `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13"/>`
        + `<line x1="${(x - 21).toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x - 6).toFixed(1)}" y2="${y.toFixed(1)}"/>`
        + `<line x1="${(x + 6).toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + 21).toFixed(1)}" y2="${y.toFixed(1)}"/>`
        + `<line x1="${x.toFixed(1)}" y1="${(y - 21).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y - 6).toFixed(1)}"/>`
        + `<line x1="${x.toFixed(1)}" y1="${(y + 6).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y + 21).toFixed(1)}"/></g>`;
    }
    out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="${colour}"/>`;
  }

  if (state.sim.target) {
    const [tx, ty] = view.toPx(state.sim.target);
    out += `<g stroke="var(--toside)" stroke-width="1.6" fill="none">`
      + `<circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="7"/>`
      + `<line x1="${(tx - 11).toFixed(1)}" y1="${ty.toFixed(1)}" x2="${(tx - 3).toFixed(1)}" y2="${ty.toFixed(1)}"/>`
      + `<line x1="${(tx + 3).toFixed(1)}" y1="${ty.toFixed(1)}" x2="${(tx + 11).toFixed(1)}" y2="${ty.toFixed(1)}"/>`
      + `<line x1="${tx.toFixed(1)}" y1="${(ty - 11).toFixed(1)}" x2="${tx.toFixed(1)}" y2="${(ty - 3).toFixed(1)}"/>`
      + `<line x1="${tx.toFixed(1)}" y1="${(ty + 3).toFixed(1)}" x2="${tx.toFixed(1)}" y2="${(ty + 11).toFixed(1)}"/></g>`;
  }

  const [bx, by] = view.toPx(state.sim.at);
  out += `<g transform="translate(${bx.toFixed(1)},${by.toFixed(1)}) rotate(${state.sim.headingDeg.toFixed(1)})">`
    + `<path d="M0,-13 L8,10 L0,5 L-8,10 Z" fill="var(--ink)" stroke="var(--sea)" stroke-width="1.2"/></g>`;

  el('over').innerHTML = out;
  el('truth').textContent = state.client
    ? `${state.sim.at.latitude.toFixed(5)}, ${state.sim.at.longitude.toFixed(5)} · ${state.sim.headingDeg.toFixed(0)}° · ${state.sim.sogKn.toFixed(1)} kn`
    : '';
}

/* ================================================================= the client */

/** Draw whichever screen the client says the sailor should be looking at. */
function renderDevice() {
  if (!state.client) return renderJoin();
  const client = state.client;
  const now = Date.now();
  const mark = client.view(now) === 'mark' ? client.markState(now) : null;
  el('device').innerHTML = (mark
    ? markScreen(mark, {
      orientation: state.orientation, width: 400, height: 330, view: state.plotView, now,
    })
    : overviewPanel(client, {
      orientation: state.orientation, width: 400, height: 330, turner: state.courseTurn, now,
    })) + leaveRow();
  wireOrientation();
  wireLeave();
}

/**
 * The orientation selector is on BOTH screens and sets one setting.
 *
 * Wired here rather than in the Mark branch it started in: the choice is about how somebody
 * reads a chart, not about which screen happens to be up, and a selector that only existed on
 * the approach would mean the setting could not be changed from the screen a boat spends most
 * of its time looking at.
 */
function wireOrientation() {
  for (const button of el('device').querySelectorAll('[data-orient]')) {
    button.addEventListener('click', () => {
      state.orientation = button.dataset.orient;
      renderDevice();
    });
  }
}

const leaveRow = () => `
  <div style="padding:0 12px 16px; display:flex; gap:8px">
    <button class="plain" id="restart">Restart lap</button>
    <button class="plain" id="leave">Leave course</button>
  </div>`;

function wireLeave() {
  el('leave')?.addEventListener('click', () => {
    state.client = null;
    state.snapshot = null;
    state.sim.running = false;
    state.wake = [];
    state.trail = [];
    renderRun();
    renderJoin();
  });
  // A restart re-joins the same snapshot rather than resetting counters in place. Every
  // detector has to be new — they latch and stand by design — and building a fresh client
  // is the one way to be sure nothing was left over from the last attempt.
  el('restart')?.addEventListener('click', () => {
    state.client = new RaceClient(state.snapshot, { boat: state.boat, joinMode: state.boat.mode });
    state.wake = [];
    state.trail = [];
    state.plotView = new PlotView();
    state.courseTurn = new Turner();
    placeOnStart();
    renderDevice();
  });
}

/**
 * The join screen: who the boat is, then club, series, course and variant.
 *
 * The drill is the shape of the answer somebody actually holds — "the Saturday sprints, the
 * short course" — and it is built from `/api/public`, so what can be joined here is exactly
 * what the club made public and published. A course with nothing published is not offered,
 * because there would be nothing to hand over: what a boat sails is a SNAPSHOT.
 */
function renderJoin() {
  const options = (values, chosen) => values.map((v) =>
    `<option value="${esc(v.value)}"${v.value === chosen ? ' selected' : ''}>${esc(v.label)}</option>`).join('');

  const clubs = [...new Set(state.courses.map((c) => c.club))];
  const club = state.boat.club ?? clubs[0];
  const series = [...new Set(state.courses.filter((c) => c.club === club).map((c) => c.series))];
  const chosenSeries = state.boat.series && series.includes(state.boat.series) ? state.boat.series : series[0];
  const courses = state.courses.filter((c) => c.club === club && c.series === chosenSeries);
  const chosenCourse = courses.find((c) => c.course === state.boat.course) ?? courses[0];
  const variants = chosenCourse?.published ?? [];
  const chosenVariant = variants.find((v) => v.variant === state.boat.variant) ?? variants[0];

  el('device').innerHTML = `
    <div class="join">
      <p class="kicker">Prototype client</p>
      <h2>Your boat</h2>
      <div class="pair">
        <div><label for="j_sail">Sail no.</label>
          <input id="j_sail" value="${esc(state.boat.sail)}" placeholder="AUS 1234"></div>
        <div><label for="j_name">Boat name</label>
          <input id="j_name" value="${esc(state.boat.name)}" placeholder="Bombora"></div>
      </div>

      <h2>Course</h2>
      ${state.courses.length === 0 ? `<p class="muted" style="font-size:13px">
        Nothing to join. A course appears here once it is ticked <strong>public</strong>
        and has a published snapshot &mdash; both, because what a boat is handed is a
        snapshot. Use the <a href="editor.html">editor</a>.</p>` : `
        <label for="j_club">Club</label>
        <select id="j_club">${options(clubs.map((v) => ({ value: v, label: v })), club)}</select>
        <label for="j_series">Series</label>
        <select id="j_series">${options(series.map((v) => ({ value: v, label: v })), chosenSeries)}</select>
        <label for="j_course">Course</label>
        <select id="j_course">${options(courses.map((c) =>
          ({ value: c.course, label: c.name && c.name !== c.course ? `${c.name} (${c.course})` : c.course })), chosenCourse?.course)}</select>
        <label for="j_variant">Variant</label>
        <select id="j_variant">${options(variants.map((v) =>
          ({ value: v.variant, label: `${v.name ?? v.variant}${v.lengthNm == null ? '' : ` — ${v.lengthNm.toFixed(2)} nm`}${v.closed ? ', cycle' : ''}` })), chosenVariant?.variant)}</select>
        ${chosenVariant ? `<p class="muted mono" style="font-size:11px; margin-top:6px">
          revision ${esc(chosenVariant.revision)} &middot; ${chosenVariant.steps ?? '?'} marks</p>` : ''}

        <h2>How you are sailing</h2>
        <label for="j_mode">This counts as</label>
        <select id="j_mode">${options([
          { value: 'ANONYMOUS', label: 'Practice — kept for you, published to nobody' },
          { value: 'RACE', label: 'Race — goes to the club, which scores it' },
          { value: 'RECORD', label: 'Record attempt — stands against every other' },
        ], state.boat.mode)}</select>
        <label for="j_tcf">TCF</label>
        <input id="j_tcf" value="${esc(state.boat.tcf)}">
        <p class="muted" style="font-size:11px; margin-top:4px">
          The handicap is carried, not applied. Turning a TCF into a distance is
          <span class="mono">CLAUDE.md</span> open question 5 and is not answered yet, so no
          sub-line is being computed for you.</p>

        <button class="go" id="j_go">Join and sail</button>`}
      ${state.message ? `<p class="warn" style="font-size:12.5px; margin-top:10px">${esc(state.message)}</p>` : ''}
    </div>`;

  const keep = (id, field) => el(id)?.addEventListener('input', (ev) => { state.boat[field] = ev.target.value; });
  keep('j_sail', 'sail');
  keep('j_name', 'name');
  keep('j_tcf', 'tcf');
  keep('j_mode', 'mode');

  // The drill resets everything BELOW the level that changed. Keeping a course id chosen
  // under a different series would offer something that is not there.
  const redraw = (field, ...clear) => el(`j_${field}`)?.addEventListener('change', (ev) => {
    state.boat[field] = ev.target.value;
    for (const lower of clear) state.boat[lower] = null;
    renderJoin();
  });
  redraw('club', 'series', 'course', 'variant');
  redraw('series', 'course', 'variant');
  redraw('course', 'variant');
  redraw('variant');

  el('j_go')?.addEventListener('click', () => join(club, chosenSeries, chosenCourse?.course, chosenVariant?.variant));
}

/**
 * Take the course.
 *
 * This is the one network call the client makes in anger, and it is a real one: the same
 * `POST /api/join` a boat on the water would make, answering with the snapshot that was
 * published rather than whatever the editor currently holds. After it returns, the server
 * can be switched off and nothing on this page will notice.
 */
async function join(club, series, course, variant) {
  state.message = null;
  if (!course || !variant) return;
  try {
    const response = await fetch(
      `/api/join/${encodeURIComponent(club)}/${encodeURIComponent(series)}/${encodeURIComponent(course)}`
      + `?variant=${encodeURIComponent(variant)}`, { method: 'POST' });
    if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 200)}`);
    state.snapshot = await response.json();
    state.client = new RaceClient(state.snapshot, { boat: { ...state.boat }, joinMode: state.boat.mode });
    state.trail = [];
    state.wake = [];
    state.plotView = new PlotView();
    state.courseTurn = new Turner();
    placeOnStart();
    renderDevice();
  } catch (error) {
    state.message = `Could not join: ${error.message}`;
    renderJoin();
  }
}

/**
 * Point the boat at the mark it owes, and THROUGH it.
 *
 * Steering to the midpoint would have the boat arrive and stop dead on the mark, which is
 * both the one place it must not stop — on the line is inside the accuracy band, resolving
 * to no side at all — and a silly thing to watch: press Start and nothing ever happens.
 *
 * Used on joining and again after the boat is picked up and put down, because a boat
 * dropped somewhere along the course is nearly always meant to carry on sailing it.
 */
function aimAtMark() {
  const step = state.client?.live();
  const crossing = step?.crossings[0];
  if (!crossing?.midpoint) return false;
  const normal = crossingNormal(crossing.prepared, crossing.required);
  state.sim.steerTo(offsetBy(crossing.midpoint, normal.x * 300, normal.y * 300));
  return true;
}

/**
 * Put the boat where a boat would be: short of the first line, on the side it must cross
 * from, pointing at the mark.
 *
 * Dropping it on the origin instead would put it wherever the first surveyed end happened
 * to be, which on a long start line is a quarter mile down the line from anywhere useful —
 * and the first thing anybody would have to do is drag it back.
 */
function placeOnStart() {
  const client = state.client;
  const step = client.live();
  if (!step) return;
  const crossing = step.crossings[0];
  const mid = crossing.midpoint;
  if (!mid) return;
  const normal = crossingNormal(crossing.prepared, crossing.required);
  const back = 300;
  const from = offsetBy(mid, -normal.x * back, -normal.y * back);
  state.sim.placeAt(from);
  state.sim.headingDeg = bearingTo(from, mid);
  aimAtMark();
  state.wake = [{ ...from }];

  const ends = [];
  for (const s of client.steps)
    for (const c of s.crossings)
      ends.push(offsetBy(client.origin, c.prepared.port.x, c.prepared.port.y),
        offsetBy(client.origin, c.prepared.starboard.x, c.prepared.starboard.y));
  state.view.fit([...ends, from], 0.8);
  state.tileKey = null;
}

/* ==================================================================== the loop */

/**
 * THE SEAM. One fix, from the receiver to the client, and nothing else.
 *
 * Replace the first line with a `navigator.geolocation` reading and this page is on the
 * water. Everything below it — quality control, the latch, which screen — is what ships.
 */
function emit() {
  const fix = state.sim.fix(new Date());
  const verdict = state.client.accept(fix);

  // A relocation is its own line in the trail, not a quiet "accepted". It is the moment the
  // client changed its mind about where the boat is, and it threw away the detectors to do
  // it — which is exactly the kind of thing somebody reconstructing a result needs to see.
  state.trail.unshift({
    at: fix.time,
    ok: verdict.accepted && !verdict.relocated,
    said: verdict.relocated
      ? `RELOCATED — ${verdict.relocated.reason}`
      : verdict.accepted
        ? (verdict.latched ? `LATCHED ${verdict.step.letter} at ${hhmmss(verdict.latched.time)}` : 'accepted')
        : `${verdict.verdict.replace('REJECTED_', '')}: ${verdict.reason}`,
  });
  if (state.trail.length > 60) state.trail.pop();
  renderTrail();
  renderDevice();
}

function renderTrail() {
  el('trail').innerHTML = state.trail.length === 0
    ? '<span class="muted">Not started.</span>'
    : state.trail.slice(0, 30).map((entry) =>
      `<div class="${entry.ok ? '' : 'bad'}">${esc(hhmmss(entry.at))} ${esc(entry.said)}</div>`).join('');
}

/**
 * Re-arm the fix timer. Separate from the animation loop, because they run at different
 * rates and tying them together would make the update-rate slider secretly a speed slider.
 *
 * A generation counter rather than `clearTimeout` alone: this is called once when the rate
 * slider applies its initial value and once more at start-up, and a cancelled timeout does
 * not cancel the chain that scheduled it — so the naive version left two chains running and
 * quietly emitted fixes at twice the rate the slider said.
 */
let generation = 0;
function armFixes() {
  clearTimeout(state.timer);
  const mine = ++generation;
  const again = () => {
    if (mine !== generation) return;
    state.timer = setTimeout(() => {
      if (mine !== generation) return;
      if (state.sim.running && state.client) emit();
      again();
    }, state.sim.intervalMs());
  };
  again();
}

let lastFrame = performance.now();
function frame(now) {
  const seconds = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;
  if (state.sim.running) {
    const before = state.sim.at;
    state.sim.step(seconds);
    // The true track, thinned: a point every few metres is enough to draw a wake and
    // keeps a long session from growing an unbounded array.
    if (metresBetween(before, state.sim.at) > 3) {
      state.wake.push({ ...state.sim.at });
      if (state.wake.length > 4000) state.wake.shift();
    }
  }
  renderTiles();
  renderOverlay();
  // The device normally redraws once per FIX, which is right — nothing on it changes between
  // fixes. The exception is a display swinging onto a new leg: that is driven by the clock
  // rather than by the receiver, and at two fixes a second a ninety-degree turn would arrive
  // in six visible jerks instead of turning. So while it is turning, and only then, it is
  // drawn on the animation frame like anything else that moves.
  if (state.client && (state.plotView.turning() || state.courseTurn.turning()))
    renderDevice();
  requestAnimationFrame(frame);
}

/* ==================================================================== wiring */

function renderRun() {
  el('run').textContent = state.sim.running ? 'Pause' : 'Start';
  el('run').classList.toggle('on', state.sim.running);
}

el('run').addEventListener('click', () => {
  if (!state.client) {
    state.message = 'Join a course first — the client has nothing to be fed fixes about.';
    return renderJoin();
  }
  state.sim.running = !state.sim.running;
  renderRun();
});

el('place').addEventListener('click', () => {
  state.placing = !state.placing;
  el('place').classList.toggle('on', state.placing);
});

const knob = (id, format, apply) => {
  const input = el(id);
  const show = () => { el(`${id}_v`).textContent = format(Number(input.value)); };
  input.addEventListener('input', () => { apply(Number(input.value)); show(); });
  show();
  apply(Number(input.value));
};
knob('speed', (v) => `${v.toFixed(1)} kn`, (v) => { state.sim.speedKn = v; });
knob('hz', (v) => `${v.toFixed(1)} Hz`, (v) => { state.sim.hz = v; armFixes(); });
knob('noise', (v) => `${v} m`, (v) => { state.sim.noiseM = v; });
knob('flyer', (v) => `${v} %`, (v) => { state.sim.flyerChance = v / 100; });

el('basemap').innerHTML = Object.entries(BASEMAPS)
  .map(([key, spec]) => `<option value="${key}"${key === state.basemap ? ' selected' : ''}>${spec.label}</option>`).join('');
el('basemap').addEventListener('change', (ev) => {
  state.basemap = ev.target.value;
  state.tileKey = null;
});

/* ------------------------------------------------------------ chart gestures */

const svgPx = (ev) => {
  const box = el('rig').getBoundingClientRect();
  return [ev.clientX - box.left, ev.clientY - box.top];
};

let drag = null;
el('rig').addEventListener('pointerdown', (ev) => {
  drag = { at: svgPx(ev), moved: false };
  el('rig').setPointerCapture(ev.pointerId);
});
el('rig').addEventListener('pointermove', (ev) => {
  const at = svgPx(ev);
  state.pointer = { x: at[0], y: at[1] };
  if (!drag) return;
  const [x, y] = at;
  const [dx, dy] = [x - drag.at[0], y - drag.at[1]];
  if (Math.hypot(dx, dy) > 3) {
    drag.moved = true;
    state.dragging = true;
    el('rig').classList.add('dragging');
    state.view.panByPx(dx, dy);
    drag.at = [x, y];
  }
});
el('rig').addEventListener('pointerleave', () => {
  state.pointer = null;
});
el('rig').addEventListener('pointerup', (ev) => {
  el('rig').classList.remove('dragging');
  state.dragging = false;
  if (!drag) return;
  const moved = drag.moved;
  drag = null;
  if (moved) return;
  // A click is a helm order: steer there. Holding the Place button down instead teleports,
  // which is not something a boat does and is therefore a separate, deliberate gesture
  // rather than a modifier on the ordinary one.
  const position = state.view.toPosition(...svgPx(ev));
  if (state.placing) {
    state.sim.placeAt(position);
    // Put down beyond wherever it was headed, the boat has "arrived" and would sit there.
    // Re-aimed at the mark it still owes, because dropping a boat further along the course
    // means "carry on from here" — which is the gesture, and the boat stopping dead instead
    // looked for all the world like the simulator had hung.
    if (state.sim.arrived()) aimAtMark();
    state.wake = [{ ...position }];
    state.placing = false;
    el('place').classList.remove('on');
  } else {
    state.sim.steerTo(position);
  }
});
el('rig').addEventListener('wheel', (ev) => {
  ev.preventDefault();
  const [x, y] = svgPx(ev);
  state.view.zoomAtPx(x, y, wheelZoomStep(ev.deltaY, ev.deltaMode));
}, { passive: false });

/* -------------------------------------------------------------------- start */

el('rig').innerHTML = '<g id="tiles"></g><g id="over"></g><g id="scale"></g>';
state.view.fit([{ latitude: -33.83, longitude: 151.27 }, { latitude: -33.81, longitude: 151.29 }]);

try {
  state.courses = (await (await fetch('/api/public')).json())
    .filter((course) => course.published.length > 0);
} catch (error) {
  state.message = `Could not read the public courses: ${error.message}`;
}

renderRun();
renderJoin();
renderTrail();
armFixes();
requestAnimationFrame(frame);

/** Exposed for the headless drivers only; nothing in the page reads it. */
export const __state = state;
