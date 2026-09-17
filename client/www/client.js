/**
 * THE TEST RIG, and the device sitting on the desk beside it.
 *
 * <h2>The seam is the whole point of this page</h2>
 * There are two things here and exactly one thing passes between them. The rig is a simulated
 * boat and a simulated receiver; the phone on top of it is the SAME {@link Device} that
 * `boat.html` runs against a real phone's GNSS, fed the fixes this receiver produces. The
 * client is never handed the boat, the target, the speed slider or the knowledge that any of
 * it is simulated — it gets a fix, which is a position, a time, a stated accuracy, a satellite
 * count, SOG and COG, and that is all a real receiver would give it either.
 *
 * So there is one call in this file that crosses the seam, in {@link emit}, and `boat.js` makes
 * the same call with a `navigator.geolocation` reading in place of the simulator's. Nothing in
 * `device.js`, `raceclient.js`, `markscreen.js` or `crossing.js` can tell which of the two it
 * is being driven by, and each receiver has its own spec pinning the key set of a fix so the
 * two cannot drift apart a convenient field at a time. A test client that shared state with
 * the thing it tests is a demonstration, not a test.
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
import { Device } from './device.js';
import { boatArt, crossingNormal, esc, hhmmss } from './markscreen.js';

/**
 * How long the boat is drawn on the RIG's chart, in pixels.
 *
 * A fixed size, unlike the device's, and a little smaller than it: the rig's chart is usually
 * showing a whole course, where a boat that grew with the zoom would be the largest thing on it.
 */
const RIG_BOAT_PX = 23;

const el = (id) => document.getElementById(id);

const state = {
  view: new MapView(),
  basemap: 'chart',
  sim: new BoatSim({ at: { latitude: -33.8, longitude: 151.27 }, running: false }),
  placing: false,
  // Draw no course on the RIG's chart. The one thing on this page that is not a knob on the
  // receiver: it takes away the operator's own knowledge of where the marks are, so the only
  // thing left saying where to steer is the device beside it — which is the claim the whole
  // application rests on and the one nothing here could otherwise test.
  hideCourse: false,
  pointer: null,
  dragging: false,
  wake: [],
  trail: [],
  tileKey: null,
  timer: null,

  /*
   * WHAT THE DEVICE HOLDS IS THE DEVICE'S, and is reached rather than copied.
   *
   * The client, the held frame and the swing all belong to the thing that would ship, and a
   * second copy of any of them here would be a second answer to a question that has one —
   * "which screen", "which frame" — kept in agreement by hand. These getters exist because
   * the rig genuinely needs to ask: it draws the client's accepted fixes on its own chart, and
   * it drives the animation frame while a display is mid-swing.
   */
  get client() { return device.client; },
  get plotView() { return device.plotView; },
  get courseTurn() { return device.courseTurn; },
};

/* ================================================================== the device */

/**
 * The phone on the desk: the shipping client, with the rig's own button under it.
 *
 * Everything the device does is in `device.js`. What is passed in here is only what a rig can
 * do that a boat cannot — put the boat back behind the start line, and know that a course has
 * been taken. `Restart lap` is a rig button for the same reason: on the water a lap restarts
 * by being sailed.
 */
const device = new Device(el('device'), {
  kicker: 'Prototype client',
  onJoin: () => {
    state.trail = [];
    state.wake = [];
    placeOnStart();
  },
  onLeave: () => {
    state.sim.running = false;
    state.wake = [];
    state.trail = [];
    renderRun();
    renderTrail();
  },
  extras: () => '<button class="plain" id="restart">Restart lap</button>',
  wireExtras: () => {
    // A restart re-joins the same snapshot rather than resetting counters in place: every
    // detector has to be new, because they latch and stand by design, and building a fresh
    // client is the one way to be sure nothing was left over from the last attempt.
    el('restart')?.addEventListener('click', () => device.start());
  },
});

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

  // THE COURSE, unless it is being deliberately withheld. What is hidden is exactly the rig's
  // own knowledge of the geometry — the lines, their ends and their letters — and nothing else:
  // the true track, the accepted fixes, the helm order and the boat are all still drawn, because
  // they are what the operator is steering with and none of them says where a mark is.
  if (client && !state.hideCourse) {
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

  // THE BOAT, the same hull the device draws — `boatArt`, not a second copy of the path. At a
  // FIXED size here, because the rig is a desk: this chart is panned and zoomed to suit whoever
  // is sailing it, so a boat drawn to scale would be a dot at one zoom and fill the harbour at
  // another. Showing range by size is the device's job, where the scale means something.
  const [bx, by] = view.toPx(state.sim.at);
  out += boatArt(bx, by, state.sim.headingDeg, RIG_BOAT_PX);

  el('over').innerHTML = out;
  el('truth').textContent = state.client
    ? `${state.sim.at.latitude.toFixed(5)}, ${state.sim.at.longitude.toFixed(5)} · ${state.sim.headingDeg.toFixed(0)}° · ${state.sim.sogKn.toFixed(1)} kn`
    : '';
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
 * `boat.js` has the same two lines with a `navigator.geolocation` reading in place of the
 * simulator's. Everything below them — quality control, the latch, which screen — is what
 * ships, and is reached through the one `Device` both pages import.
 */
function emit() {
  const fix = state.sim.fix(new Date());
  const verdict = device.feed(fix);

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
  if (device.turning()) device.render();
  requestAnimationFrame(frame);
}

/* ==================================================================== wiring */

function renderRun() {
  el('run').textContent = state.sim.running ? 'Pause' : 'Start';
  el('run').classList.toggle('on', state.sim.running);
}

el('run').addEventListener('click', () => {
  if (!state.client) {
    device.message = 'Join a course first — the client has nothing to be fed fixes about.';
    return device.renderJoin();
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

// Nothing to invalidate and nothing to re-fit: the overlay is redrawn every frame, so the next
// one simply leaves the course out. The tiles are untouched — a chart with no marks on it is
// still the water, and taking that away would be testing something nobody is claiming.
el('hidecourse').addEventListener('change', (ev) => {
  state.hideCourse = !!ev.target.checked;
});

/* --------------------------------------------------------- moving the phone */

/**
 * The phone is dragged by its CASE, never by its screen.
 *
 * The screen's own chart pans on a drag, so a phone that also moved on one would be two
 * gestures fighting over a single pointer — and whichever won, the other would be a control
 * that sometimes does nothing. The case settles it the way the real object does: you pick a
 * phone up by its edges. So a press that started anywhere inside the screen is not a drag, and
 * everything else on the phone is.
 *
 * Followed on the DOCUMENT like the chart's pan, and for a milder version of the same reason: a
 * pointer that leaves the case mid-drag — which it does the moment the phone is behind the
 * finger rather than under it — would stop being tracked by the element it started on.
 *
 * <b>Kept on the screen by its edges, not by its corner.</b> Clamped so a strip of the case is
 * always in the window on every side: a phone dragged just past the edge and released is a
 * phone nobody can get back, and this page has no command to fetch it.
 */
const PHONE_MARGIN = 36;

function wirePhone() {
  const phone = el('phone');
  if (!phone) return;
  phone.addEventListener('pointerdown', (ev) => {
    if (ev.target?.closest?.('.device')) return;      // the screen is not a handle
    const box = phone.getBoundingClientRect();
    const grab = { x: ev.clientX - box.left, y: ev.clientY - box.top };
    phone.classList.add('dragging');
    // Switched to left/top on the first drag: it starts pinned to the right so that it sits out
    // of the way whatever the window is, and a box with both `right` and `left` set would
    // stretch rather than move.
    phone.style.right = 'auto';
    const move = (m) => {
      const width = phone.offsetWidth;
      const height = phone.offsetHeight;
      phone.style.left = `${Math.max(PHONE_MARGIN - width,
        Math.min(window.innerWidth - PHONE_MARGIN, m.clientX - grab.x))}px`;
      phone.style.top = `${Math.max(0,
        Math.min(window.innerHeight - PHONE_MARGIN, m.clientY - grab.y))}px`;
    };
    const up = () => {
      phone.classList.remove('dragging');
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });
}

wirePhone();

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

// What can be joined is what the club made public AND published — asked once, on the way in.
await device.load();

renderRun();
device.renderJoin();
renderTrail();
armFixes();
requestAnimationFrame(frame);

/** Exposed for the headless drivers only; nothing in the page reads it. */
export const __state = state;
