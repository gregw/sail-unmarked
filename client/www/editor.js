/**
 * The course editor: place and move points on a chart, see the lines they define, and
 * export the result as YAML.
 *
 * SCOPE OF THIS PASS. Points are editable; lines and courses are drawn from the loaded
 * programme but not authored here yet. Drawing them matters even so — a point placed
 * without seeing the line it defines is a coordinate with no meaning, and the whole
 * argument for building an editor rather than importing GPX was that these decisions
 * are visual.
 *
 * SAVES AS YOU GO. Every completed edit is written straight back to the programme file
 * through PUT .../points. An edit is completed when the form loses focus, when a drag
 * ends, or when a click places a point — so there is no Save button and nothing to
 * forget. The server splices only the `points:` block, leaving the rest of the file,
 * comments included, byte for byte as it was.
 *
 * ONE LEVEL OF UNDO, IN MEMORY. The state before the last completed edit is kept in a
 * single slot and offered as an Undo button; taking it writes the old state back and
 * empties the slot. One level rather than a stack because the slot is the whole design:
 * a stack would need to survive reloads to be worth trusting, and the file's own history
 * is git's job, not this page's.
 */

import { ROLE_COLOUR, roleColour } from './coursedraw.js';
import { ARROW_CENTROID, LABEL, TRIANGLE, arrowHead, darken, forwardNormal, seats, track, triangle } from './coursedraw.js';
import {
  BASEMAPS,
  MapView,
  bearingDeg,
  distanceM,
  formatPosition,
  snap,
  wheelZoomStep,
} from './geo.js';

/** How much of the chart a selected line is framed to occupy. */
const FRAME_FRACTION = 0.2;



const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const state = {
  view: new MapView(),
  basemap: 'seaSimple',
  programme: null,      // { club, series, points: {...}, lines: {...}, courses: {...} }
  points: new Map(),    // id -> { id, name, latitude, longitude, notes }
  selected: null,
  dragging: null,
  formFor: undefined,   // which point the open form was built for
  tab: 'courses',       // which editor the pane is showing
  lines: new Map(),     // id -> { id, name, port, starboard, notes }
  selectedLine: null,
  picking: null,        // 'port' | 'starboard' while an end is waiting for a chart click
  courses: new Map(),
  selectedCourse: null,
  lengths: {},          // course id -> nm, computed by the server so there is one rule
  showTrack: true,
  hideUnused: false,
  editing: null,        // snapshot taken when the current edit began
  undo: null,           // the one slot: state before the last completed edit
  saveState: 'idle',    // idle | saving | saved | error
  saveNote: '',
};

/* ------------------------------------------------------------------ loading */

async function json(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

async function loadProgrammeList() {
  const programmes = await json('/api/programmes');
  const select = el('programme');
  select.innerHTML = programmes
    .map((p) => `<option value="${esc(p.club)}/${esc(p.series)}">${esc(p.club)} &middot; ${esc(p.series)}</option>`)
    .join('');
  if (programmes.length) await loadProgramme(select.value);
}

async function loadProgramme(key) {
  const programme = await json(`/api/programmes/${key}`);
  state.key = key;
  state.programme = programme;
  // Undo does not survive changing programme: the slot holds points from a different
  // file, and writing them into this one would be a very confusing kind of help.
  state.undo = null;
  state.editing = null;
  state.points = new Map(
    Object.entries(programme.points ?? {}).map(([id, p]) => [id, { ...p, id }])
  );
  state.lines = new Map(
    Object.entries(programme.lines ?? {}).map(([id, l]) => [id, {
      ...l, id,
      port: { ...(l.port ?? {}) },
      starboard: { ...(l.starboard ?? {}) },
    }])
  );
  state.courses = new Map(Object.entries(programme.courses ?? {}).map(([id, c]) => [id, {
    ...c, id,
    sequence: (c.sequence ?? []).map((step) => ({
      ...step,
      gate: (step.gate ?? []).map((alt) => ({ ...alt })),
    })),
  }]));
  state.lengths = programme.lengths ?? {};
  state.selectedCourse = null;
  state.selectedLine = null;
  state.picking = null;
  select(null);

  const surveyed = [...state.points.values()].filter((p) => p.latitude != null);
  if (surveyed.length) state.view.fit(surveyed);
  else {
    // Nothing surveyed yet, which is the normal starting state. Sydney Harbour is where
    // the worked course is, and it is a place to start placing rather than a claim.
    state.view.fit([{ latitude: -33.82, longitude: 151.27 }]);
    state.view.zoom = 13;
  }
  render();
}

/* ---------------------------------------------------------------- rendering */

/** Lines the loaded programme defines, drawn from whichever ends are placed. */
function renderLines() {
  const used = inUse();
  let out = '';
  for (const [id, line] of state.lines) {
    if (used && !used.lines.has(id)) continue;
    const on = id === state.selectedLine && state.tab === 'lines';
    const port = endPosition(line.port);
    const starboard = endPosition(line.starboard);
    if (!port || !starboard) continue;

    const [ax, ay] = state.view.toPx(port);
    const [bx, by] = state.view.toPx(starboard);
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    // Far enough to leave the view from anywhere in it.
    const reach = Math.hypot(state.view.width, state.view.height);

    // The DEFINED segment, between the two points that were actually given, is drawn at
    // full weight. Beyond an infinite end the line is real but nobody chose where it
    // goes — it is implied by a bearing — so it is drawn thin and faint. The weight is
    // carrying the distinction the model makes: an infinite end is a bearing, not a
    // place, and the point is a handle rather than a position anybody surveyed.
    const faint = (x0, y0, x1, y1) =>
      `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="var(--line)" stroke-width="1" opacity="0.28"/>`;
    if (line.port?.infinite) out += faint(ax, ay, ax - ux * reach, ay - uy * reach);
    if (line.starboard?.infinite) out += faint(bx, by, bx + ux * reach, by + uy * reach);

    out += `<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${on ? 'var(--ok)' : 'var(--line)'}" stroke-width="${on ? 4 : 2.5}" opacity="0.9"/>`;

    // The wiki notation: a dot for a finite end, an arrowhead out along the line for an
    // infinite one, sitting at the defining point where the solid line gives way.
    out += endMarker(ax, ay, -ux, -uy, line.port?.infinite);
    out += endMarker(bx, by, ux, uy, line.starboard?.infinite);

    // The midpoint is where the legs either side are measured to, so it is drawn: it is
    // the thing an infinite end's point is a handle for.
    const midX = (ax + bx) / 2;
    const midY = (ay + by) / 2;
    out += `<circle cx="${midX.toFixed(1)}" cy="${midY.toFixed(1)}" r="3" fill="none" stroke="var(--toside)" stroke-width="1.5"/>`;
    out += `<text x="${(midX + 7).toFixed(1)}" y="${(midY - 6).toFixed(1)}" font-family="var(--mono)" font-size="10" fill="${on ? 'var(--ok)' : 'var(--muted)'}">${esc(id)}</text>`;
  }
  return out;
}

function endMarker(x, y, ux, uy, infinite) {
  if (!infinite) return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="var(--line)"/>`;
  const tip = 11;
  const wing = 4.5;
  return `<polygon points="${(x + ux * tip).toFixed(1)},${(y + uy * tip).toFixed(1)} ${(x - uy * wing).toFixed(1)},${(y + ux * wing).toFixed(1)} ${(x + uy * wing).toFixed(1)},${(y - ux * wing).toFixed(1)}" fill="var(--line)"/>`;
}

function endPosition(end) {
  if (!end) return null;
  if (end.latitude != null && end.longitude != null) return end;
  const named = state.points.get(end.at);
  return named && named.latitude != null ? named : null;
}

/**
 * Every crossing of the selected course, seated along its line and turned the right way.
 *
 * Grouped by line first, because a line can carry several crossings and they have to be
 * spread along it rather than drawn on top of one another — the leeward line of a
 * windward/leeward is the start, mark 2 and the finish.
 */
function courseCrossings(course) {
  const byLine = new Map();
  const steps = (course.sequence ?? []).map((step, index) => ({
    index,
    letter: courseLetter(course, index),
    entry: !!(course.closed && step.entry),
    alternatives: (step.gate?.length ? step.gate : [step]).filter((a) => a.line),
  }));
  for (const step of steps) {
    for (const alternative of step.alternatives) {
      if (!byLine.has(alternative.line)) byLine.set(alternative.line, []);
      byLine.get(alternative.line).push({ step, alternative });
    }
  }

  // A gate's alternatives are seated in OPPOSITE orders along their lines. Seated the
  // same way, the two sides of lap one sit at the same end of each line and the two sides
  // of lap two at the other, so both roundings split from nearly the same place and the
  // paths run on top of each other. Reversing one line pulls the two roundings apart and
  // sends each through its own spot.
  const reversed = new Set();
  for (const step of steps) {
    step.alternatives.forEach((alternative, j) => {
      if (j % 2 === 1) reversed.add(alternative.line);
    });
  }

  const drawn = new Map();   // step index -> [{ base, apex, points, label, letter }]
  for (const [lineId, uses] of byLine) {
    const line = state.lines.get(lineId);
    const port = endPosition(line?.port);
    const starboard = endPosition(line?.starboard);
    if (!port || !starboard) continue;

    const [ax, ay] = state.view.toPx(port);
    const [bx, by] = state.view.toPx(starboard);
    const length = Math.hypot(bx - ax, by - ay) || 1;
    const along = { x: (bx - ax) / length, y: (by - ay) / length };
    const forward = forwardNormal(bx - ax, by - ay);

    const positions = seats(uses.length, length);
    (reversed.has(lineId) ? [...positions].reverse() : positions).forEach((distance, i) => {
      const { step, alternative } = uses[i];
      const at = { x: ax + along.x * distance, y: ay + along.y * distance };
      const normal = alternative.cross === 'REVERSE' || alternative.cross === 'reverse'
        ? { x: -forward.x, y: -forward.y }
        : forward;
      const shape = triangle(at, along, normal);
      if (!drawn.has(step.index)) drawn.set(step.index, []);
      drawn.get(step.index).push({
        ...shape,
        letter: step.letter,
        entry: step.entry,
        line: lineId,
      });
    });
  }
  return { steps, drawn };
}

/**
 * The lines and points the selected course actually uses.
 *
 * Null when nothing is selected or the setting is off, which every caller reads as "show
 * everything" — a tickbox that emptied the chart the moment no course was selected would
 * look like a bug rather than a filter.
 */
function inUse() {
  if (state.tab !== 'courses' || !state.hideUnused || !state.selectedCourse) return null;
  const course = state.courses.get(state.selectedCourse);
  if (!course) return null;
  const lines = new Set();
  const points = new Set();
  for (const step of course.sequence ?? []) {
    for (const alternative of (step.gate?.length ? step.gate : [step])) {
      if (!alternative.line) continue;
      lines.add(alternative.line);
      const line = state.lines.get(alternative.line);
      for (const end of [line?.port, line?.starboard]) {
        if (end?.at) points.add(end.at);
      }
    }
  }
  return { lines, points };
}

/** S, then the ordinals, then F — derived from position, never stored. */
function courseLetter(course, index) {
  // A CLOSED course has neither a start nor a finish of its own: a boat begins and ends
  // wherever it joined, so calling one step S and another F would claim something untrue
  // about the course. Every step is numbered, and which may be joined at is ringed on the
  // chart instead.
  if (course.closed) return String(index + 1);
  if (index === 0) return 'S';
  if (index === (course.sequence ?? []).length - 1) return 'F';
  return String(index);
}

function renderCourse() {
  if (state.tab !== 'courses' || !state.selectedCourse) return '';
  const course = state.courses.get(state.selectedCourse);
  if (!course) return '';
  const { steps, drawn } = courseCrossings(course);
  const usable = steps.filter((step) => (drawn.get(step.index) ?? []).length);
  if (!usable.length) return '';
  const ordered = usable.map((step) => ({ crossings: drawn.get(step.index) }));

  /**
   * Which steps a lap may begin or end at.
   *
   * On a CYCLE, an entry point is both: the rule is that a line crossed to begin a lap is
   * crossed again the same way to end it, so the leg leaving one is somebody's first and
   * the leg arriving is somebody else's last. On an open course the first step starts and
   * the last finishes, and nothing does both unless the course is two steps long.
   */
  const starts = usable.map((step, i) => (course.closed ? step.entry : i === 0));
  const finishes = usable.map((step, i) => (course.closed ? step.entry : i === usable.length - 1));

  let defs = '';
  let out = '';

  /**
   * A leg's paint: one colour, or a gradient when it both starts and finishes.
   *
   * The gradient runs along the segment, so a leg out of a cycle's entry point reads green
   * where a lap begins and red where the next one ends.
   */
  const paint = (starting, finishing, ends, id) => {
    const flat = roleColour(starting, finishing);
    if (flat) return flat;
    defs += `<linearGradient id="${id}" gradientUnits="userSpaceOnUse"`
      + ` x1="${ends.from.x.toFixed(1)}" y1="${ends.from.y.toFixed(1)}"`
      + ` x2="${ends.to.x.toFixed(1)}" y2="${ends.to.y.toFixed(1)}">`
      + `<stop offset="0" stop-color="${ROLE_COLOUR.start}"/>`
      + `<stop offset="1" stop-color="${ROLE_COLOUR.finish}"/></linearGradient>`;
    return `url(#${id})`;
  };

  if (state.showTrack) {
    const segments = track(ordered, { closed: course.closed });
    segments.forEach((seg, n) => {
      if (seg.kind === 'crossing') {
        const colour = paint(starts[seg.from], finishes[seg.from], seg.ends, `cx${n}`);
        out += `<path d="${seg.d}" fill="none" stroke="${colour}" stroke-width="2.4" opacity="0.95" stroke-linecap="round"/>`;
        return;
      }
      // A leg is coloured by what it is FOR: it starts a lap if it leaves a step a boat
      // may join at, and finishes one if it arrives at such a step.
      const colour = paint(starts[seg.from], finishes[seg.to], seg.ends, `lg${n}`);
      out += `<path d="${seg.d}" fill="none" stroke="${colour}" stroke-width="1.8" stroke-dasharray="6 4" opacity="0.95" stroke-linecap="round"/>`;
    });

    // EVERY arrow carries the step it leads to, the branches of a gate included. One
    // lettered and one bare said the two halves of a split were different kinds of thing.
    segments.forEach((seg, n) => {
      if (seg.kind === 'crossing') return;
      const colour = paint(starts[seg.from], finishes[seg.to], seg.ends, `mk${n}`);
      const radians = (seg.angle * Math.PI) / 180;
      const nose = { x: seg.mid.x - ARROW_CENTROID * LABEL.arrowPx * Math.cos(radians),
        y: seg.mid.y - ARROW_CENTROID * LABEL.arrowPx * Math.sin(radians) };
      // Grouped by the step this leg LEADS TO, which is the set that shares a letter:
      // the trunk, both branches of a gate, and the triangles they arrive at.
      out += `<g class="cmark" data-id="leg-${n}" data-group="step-${seg.to}" data-ox="${seg.mid.x.toFixed(1)}" data-oy="${seg.mid.y.toFixed(1)}">`;
      out += `<circle cx="${seg.mid.x.toFixed(1)}" cy="${seg.mid.y.toFixed(1)}" r="${LABEL.markR}" fill="var(--sea)" fill-opacity="0.92" stroke="${colour}" stroke-width="1.3"/>`;
      out += `<polygon points="${arrowHead(nose, seg.angle, LABEL.arrowPx)}" fill="${colour}"/>`;
      out += `<text x="${seg.mid.x.toFixed(1)}" y="${(seg.mid.y + LABEL.fontPx * 0.35).toFixed(1)}" text-anchor="middle" font-family="var(--mono)" font-size="${LABEL.fontPx}" font-weight="600" fill="${darken(ROLE_COLOUR.leg)}">${esc(usable[seg.to].letter)}</text>`;
      out += `</g>`;
    });
  }

  usable.forEach((step, i) => {
    for (const shape of drawn.get(step.index)) {
      const accent = paint(starts[i], finishes[i], { from: shape.base, to: shape.apex }, `tr${i}-${shape.line}`);
      out += `<g class="cmark" data-id="${esc(shape.letter)}@${esc(shape.line)}" data-group="step-${i}" data-ox="${shape.base.x.toFixed(1)}" data-oy="${shape.base.y.toFixed(1)}">`;
      // An entry point on a cycle is a start and a finish at once — a boat joins here and
      // closes its lap by crossing the same line the same way again. Ringed rather than
      // lettered, because a cycle has no S or F to give it.
      if (shape.entry) {
        const ring = { x: (shape.base.x + shape.apex.x) / 2, y: (shape.base.y + shape.apex.y) / 2 };
        out += `<circle cx="${ring.x.toFixed(1)}" cy="${ring.y.toFixed(1)}" r="${TRIANGLE.height}" fill="none" stroke="var(--line)" stroke-width="1.6" stroke-dasharray="3 3"/>`;
      }
      // Filled rather than outlined, because that is what lets the letter be DARKER than
      // the triangle: a letter in the triangle's own colour vanishes wherever the two
      // touch, and a darker one needs something bright to sit on.
      out += `<polygon points="${shape.points}" fill="${accent}" fill-opacity="0.92" stroke="${accent}" stroke-width="1.4"/>`;
      out += `<text x="${shape.label.x.toFixed(1)}" y="${(shape.label.y + LABEL.fontPx * 0.35).toFixed(1)}" text-anchor="middle" font-family="var(--mono)" font-size="${LABEL.fontPx}" font-weight="600" fill="${darken(ROLE_COLOUR.leg)}">${esc(shape.letter)}</text>`;
      out += `</g>`;
    }
  });

  return (defs ? `<defs>${defs}</defs>` : '') + out;
}

function renderPoints() {
  const used = inUse();
  let out = '';
  for (const point of state.points.values()) {
    if (point.latitude == null) continue;
    if (used && !used.points.has(point.id)) continue;
    const [x, y] = state.view.toPx(point);
    const on = point.id === state.selected;
    out += `<g class="pt" data-id="${esc(point.id)}" style="cursor:grab">`;
    out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" fill="transparent"/>`;
    out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${on ? 7 : 5}" fill="${on ? 'var(--ok)' : 'var(--ink)'}" stroke="var(--sea)" stroke-width="2"/>`;
    out += `<text x="${(x + 10).toFixed(1)}" y="${(y + 4).toFixed(1)}" font-family="var(--mono)" font-size="11" fill="${on ? 'var(--ok)' : 'var(--ink)'}" style="paint-order:stroke;stroke:var(--sea);stroke-width:3px">${esc(point.id)}</text>`;
    out += `</g>`;
  }
  return out;
}

function render() {
  const svg = el('map');
  const box = svg.getBoundingClientRect();
  if (box.width > 20 && box.height > 20) {
    state.view.width = Math.round(box.width);
    state.view.height = Math.round(box.height);
    svg.setAttribute('viewBox', `0 0 ${state.view.width} ${state.view.height}`);
  }
  svg.innerHTML =
    state.view.tileLayer(state.basemap) +
    renderLines() +
    renderCourse() +
    renderPoints() +
    state.view.scaleBar();

  // Grown under the pointer by setting the transform directly, rather than by
  // re-rendering: hover fires constantly, and rebuilding the whole chart for each one
  // would make the map stutter. An SVG transform attribute also avoids the transform-box
  // rules that decide where a CSS transform-origin lands on an SVG element.
  // A hover lights the whole STEP, not the one shape under the pointer: the leg into it,
  // both branches where that leg is a gate, and every triangle those branches reach. They
  // all carry the same letter, so lighting one and not the others invites the reader to
  // wonder which of them the letter belonged to.
  const marks = [...svg.querySelectorAll('.cmark')];
  for (const g of marks) {
    const group = marks.filter((m) => m.dataset.group === g.dataset.group);
    g.addEventListener('mouseenter', () => {
      for (const member of group) {
        const ox = Number(member.dataset.ox);
        const oy = Number(member.dataset.oy);
        // Each grows about its OWN anchor — for a triangle that is its base, so it stays
        // on its line rather than lifting off it.
        member.setAttribute('transform',
          `translate(${ox} ${oy}) scale(${LABEL.hoverScale}) translate(${-ox} ${-oy})`);
        // Last in the document is topmost in SVG. The hovered shape is moved last so it
        // ends up above the rest of its own group as well as above everything else.
        if (member !== g) member.parentNode.appendChild(member);
      }
      g.parentNode.appendChild(g);
    });
    g.addEventListener('mouseleave', () => {
      for (const member of group) member.removeAttribute('transform');
    });
  }

  for (const g of svg.querySelectorAll('.pt')) {
    g.addEventListener('mousedown', (ev) => {
      // While an end is armed, a point on the chart is a CHOICE, not something to drag —
      // so let the click fall through to the map handler that resolves it.
      if (state.tab === 'lines' && state.picking) return;
      ev.stopPropagation();
      beginEdit();
      // Selected only on its own tab; elsewhere the drag happens and nothing is left
      // holding the chart's next click.
      if (state.tab === 'points') select(g.dataset.id);
      state.dragging = g.dataset.id;
      render();
    });
  }
  renderList();
  if (state.tab === 'points') renderForm();
  else if (state.tab === 'lines') renderLineForm();
  else renderCourseForm();
}

/** Switch the pane. The two editors share the chart and replace each other entirely. */
function showTab(tab) {
  state.tab = tab;
  state.picking = null;
  state.selected = tab === 'points' ? state.selected : null;
  state.courseFormFor = undefined;
  // Both forms are rebuilt from scratch on a tab change, since the pane they live in is
  // the same element.
  state.formFor = undefined;
  state.lineFormFor = undefined;
  for (const button of document.querySelectorAll('[data-tab]')) {
    button.classList.toggle('on', button.dataset.tab === tab);
  }
  el('paneTitle').textContent =
    { points: 'Points', lines: 'Lines', courses: 'Courses' }[tab];
  el('add').disabled = false;
  el('paneInfo').dataset.info = INFO[tab];
  render();
}

/**
 * What each pane would have said in a paragraph, said on hover instead.
 *
 * The pane is for the thing being edited. A paragraph explaining how the pane works is
 * read once and then permanently in the way of the list it sits above.
 */
const INFO = {
  points: '<b>Points</b> are places, named once and shared by every line that touches '
    + 'them &mdash; so a correction is one edit, and two lines that meet at a mark stay '
    + 'together. Select one and click the chart to put it there, drag it to move it, or '
    + 'type coordinates. Positions snap to the system\'s one metre resolution. A point '
    + 'used by a line cannot be deleted until the line lets go of it.',
  lines: '<b>Lines</b> are the virtual marks. Each has a <b>port</b> and a '
    + '<b>starboard</b> end: a forward crossing leaves the port end to port and the '
    + 'starboard end to starboard. Set an end by choosing a point, by picking one on the '
    + 'chart, or by clicking open water &mdash; which creates a point there and attaches '
    + 'it. An <b>infinite</b> end is a bearing rather than a place: the line runs out '
    + 'through that point and keeps going, drawn thin and faint, and only a finite end '
    + 'can be missed.',
  courses: '<b>Courses</b> are an ordered sequence of crossings over the lines. The first '
    + 'step is the start and the last is the finish, so the letters S, 1, 2 &hellip; F are '
    + 'derived from position rather than stored. A <b>gate</b> is a choice within one '
    + 'step: the track splits at the gate and rejoins well down the next leg, because '
    + 'boats that took different sides sail their own line and converge near the mark '
    + 'ahead.',
};

/** Selecting is its own function because it decides what the map click will do. */
function select(id) {
  state.selected = id;
}

/**
 * True when a click on the chart should place the selected point rather than do nothing.
 *
 * There is no mode button. A selected point with no position is self-evidently waiting to
 * be put somewhere, and a selected point with one is being edited — in both cases the
 * next click on the chart means "here". A mode toggle would only be a second thing to
 * remember to turn off.
 */
function placingArmed() {
  // Only the points tab places points. A point stays draggable on the other tabs — that
  // is useful while laying out a line or a course — but dragging it must not leave it
  // SELECTED, or every later click on the chart teleports it. Selection belongs to the
  // tab that edits the thing.
  if (state.tab === 'points') return state.selected != null && state.points.has(state.selected);
  if (state.tab === 'lines') return state.picking != null;
  return false;
}

/**
 * Resolve a click on the chart to a point: the nearest existing one if the click landed
 * near it, otherwise a new point created where the click fell.
 *
 * Snapping to an existing point matters more than it sounds. Two lines that share a mark
 * — both Sow and Pigs lines do — must share the POINT, not merely sit at the same
 * coordinates, or a later correction moves one line and leaves the other behind.
 */
function pointAtClick(px, py, forLine, end) {
  const NEAR_PX = 14;
  let best = null;
  let bestDistance = NEAR_PX;
  for (const point of state.points.values()) {
    if (point.latitude == null) continue;
    const [x, y] = state.view.toPx(point);
    const distance = Math.hypot(x - px, y - py);
    if (distance <= bestDistance) { best = point; bestDistance = distance; }
  }
  if (best) return best.id;

  const id = freePointId(`${forLine}-${end}`);
  state.points.set(id, {
    id,
    name: null,
    ...snap(state.view.toPosition(px, py)),
    notes: null,
  });
  return id;
}

/** `<base>`, or `<base>-2`, `<base>-3` … — whatever is not taken. */
function freePointId(base) {
  return freeId(state.points, base);
}

function freeId(map, base) {
  if (!map.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!map.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}

/* ------------------------------------------------------------ add and delete */

/**
 * Add an empty point or line and open its form.
 *
 * The generated id is a placeholder to be typed over, not a name — but it has to be a
 * legal, unique one from the moment it exists, because the thing is saved as soon as the
 * edit completes and a file cannot hold two of the same key.
 */
function addThing() {
  beginEdit();
  if (state.tab === 'points') {
    const id = freeId(state.points, 'point');
    state.points.set(id, { id, name: null, latitude: null, longitude: null, notes: null });
    state.selected = id;
    state.formFor = undefined;
  } else if (state.tab === 'courses') {
    const id = freeId(state.courses, 'course');
    state.courses.set(id, { id, name: null, closed: false, sequence: [], notes: null });
    state.selectedCourse = id;
    state.courseFormFor = undefined;
  } else if (state.tab === 'lines') {
    const id = freeId(state.lines, 'line');
    state.lines.set(id, {
      id, name: null,
      port: { at: null, infinite: false },
      starboard: { at: null, infinite: false },
      notes: null,
    });
    state.selectedLine = id;
    state.lineFormFor = undefined;
  }
  endEdit();
  render();
}

/** The lines whose ends name this point. */
function linesUsing(pointId) {
  return [...state.lines.values()]
    .filter((l) => l.port?.at === pointId || l.starboard?.at === pointId)
    .map((l) => l.id);
}

/** The courses whose sequence names this line, gate alternatives included. */
function coursesUsing(lineId) {
  const used = [];
  for (const [id, course] of state.courses ?? []) {
    const steps = course.sequence ?? [];
    const names = steps.flatMap((step) => (step.gate?.length ? step.gate : [step]));
    if (names.some((step) => step.line === lineId)) used.push(id);
  }
  return used;
}

/**
 * Delete the selected point or line, unless something still refers to it.
 *
 * Refused rather than cascaded. Deleting a point out from under a line, or a line out
 * from under a course, would leave the file naming something that no longer exists — and
 * because the save is immediate, it would be on disk before the consequence was visible.
 * Naming what is holding it is more useful than either silently breaking the file or
 * silently deleting more than was asked.
 */
function deleteThing() {
  if (state.tab === 'points') {
    const id = state.selected;
    if (!id || !state.points.has(id)) return;
    const held = linesUsing(id);
    if (held.length) {
      warnInForm('f_dm', `still used by ${held.join(', ')} — change those ends first`);
      return;
    }
    beginEdit();
    state.points.delete(id);
    state.selected = null;
    state.formFor = undefined;
    endEdit();
  } else if (state.tab === 'courses') {
    const id = state.selectedCourse;
    if (!id || !state.courses.has(id)) return;
    beginEdit();
    // Nothing refers to a course by id, so there is nothing to orphan and nothing to
    // refuse — the only delete in the editor that needs no guard.
    state.courses.delete(id);
    state.selectedCourse = null;
    state.courseFormFor = undefined;
    endEdit();
  } else if (state.tab === 'lines') {
    const id = state.selectedLine;
    if (!id || !state.lines.has(id)) return;
    const held = coursesUsing(id);
    if (held.length) {
      warnInForm('l_span', `still used by course ${held.join(', ')} — courses are not editable yet`);
      return;
    }
    beginEdit();
    state.lines.delete(id);
    state.selectedLine = null;
    state.lineFormFor = undefined;
    endEdit();
  }
  render();
}

function warnInForm(id, message) {
  const target = el(id);
  if (target) target.innerHTML = `<span class="warn">${esc(message)}</span>`;
}

function renderList() {
  if (state.tab === 'courses') return renderCourseList();
  if (state.tab === 'lines') return renderLineList();
  const points = [...state.points.values()];
  const unplaced = points.filter((p) => p.latitude == null);

  el('pointList').innerHTML = points.length === 0
    ? '<p class="muted">No points.</p>'
    : points.map((p) => {
        const on = p.id === state.selected;
        // One line. Where the point actually is belongs in the form below; repeating it
        // here halved how many rows fitted on screen.
        return `<div class="row${on ? ' on' : ''}" data-id="${esc(p.id)}">
          <span class="mono">${esc(p.id)}</span>
          ${p.latitude == null ? '<span class="warn trail small">not placed</span>' : ''}
        </div>`;
      }).join('');

  for (const row of el('pointList').querySelectorAll('.row')) {
    row.addEventListener('click', () => {
      select(row.dataset.id);
      const point = state.points.get(row.dataset.id);
      if (point?.latitude != null) state.view.fit([point]);
      render();
    });
  }

  el('status').innerHTML = unplaced.length
    ? `<span class="warn">${unplaced.length} of ${points.length} not placed</span>`
    : `<span class="ok">all ${points.length} placed</span>`;
}

function renderLineList() {
  const lines = [...state.lines.values()];
  el('pointList').innerHTML = lines.length === 0
    ? '<p class="muted">No lines.</p>'
    : lines.map((line) => {
        const on = line.id === state.selectedLine;
        const placed = endPosition(line.port) && endPosition(line.starboard);
        return `<div class="row${on ? ' on' : ''}" data-id="${esc(line.id)}">
          <span class="mono">${esc(line.id)}</span>
          ${placed ? `<span class="muted trail small">${lineLength(line)} m</span>`
            : '<span class="warn trail small">incomplete</span>'}
        </div>`;
      }).join('');

  for (const row of el('pointList').querySelectorAll('.row')) {
    row.addEventListener('click', () => {
      state.selectedLine = row.dataset.id;
      state.picking = null;
      const line = state.lines.get(row.dataset.id);
      const ends = [endPosition(line?.port), endPosition(line?.starboard)].filter(Boolean);
      // A FIFTH of the chart, not four fifths. Filling the view with the line leaves it
      // floating on featureless water: what a line means is where it sits relative to the
      // shore and the marks around it, so the surroundings are the point.
      if (ends.length) state.view.fit(ends, FRAME_FRACTION);
      render();
    });
  }

  const unplaced = lines.filter((l) => !(endPosition(l.port) && endPosition(l.starboard)));
  el('status').innerHTML = unplaced.length
    ? `<span class="warn">${unplaced.length} of ${lines.length} incomplete</span>`
    : `<span class="ok">all ${lines.length} lines placed</span>`;
}

function lineLength(line) {
  const a = endPosition(line.port);
  const b = endPosition(line.starboard);
  return a && b ? distanceM(a, b) : '\u2014';
}

/**
 * The line editor.
 *
 * An end can be set three ways, and all three exist because they suit different moments:
 * choose an existing point from the list when the mark is already surveyed; click a point
 * on the chart when you can see it and would rather not read ids; click open water to
 * create a point there when the mark does not exist yet. The third is how a course gets
 * built from nothing.
 */
function renderLineForm() {
  const line = state.selectedLine ? state.lines.get(state.selectedLine) : null;

  if (state.lineFormFor === state.selectedLine) { syncLineForm(line); return; }
  state.lineFormFor = state.selectedLine;

  if (!line) {
    el('form').innerHTML = '<p class="muted small">Select a line to edit it.</p>';
    return;
  }

  el('form').innerHTML = `
    <label class="label" for="l_id">Short name (id)</label>
    <input id="l_id" value="${esc(line.id)}" spellcheck="false">
    <label class="label" for="l_name">Long name</label>
    <input id="l_name" value="${esc(line.name ?? '')}">
    ${endFields('port', line.port)}
    ${endFields('starboard', line.starboard)}
    <div id="l_span" class="mono small muted"></div>
    <label class="label" for="l_notes">Notes</label>
    <textarea id="l_notes" rows="3" spellcheck="false">${esc(line.notes ?? '')}</textarea>
    <button id="l_delete" class="danger" style="margin-top:4px">Delete line</button>`;

  el('l_delete').addEventListener('click', deleteThing);

  for (const field of ['l_id', 'l_name', 'l_notes']) el(field).addEventListener('focus', beginEdit);
  el('l_id').addEventListener('change', (ev) => renameLine(line.id, ev.target.value.trim()));
  el('l_id').addEventListener('blur', endEdit);
  el('l_name').addEventListener('input', (ev) => { line.name = ev.target.value; });
  el('l_name').addEventListener('blur', endEdit);
  el('l_notes').addEventListener('input', (ev) => { line.notes = ev.target.value; });
  el('l_notes').addEventListener('blur', endEdit);

  for (const side of ['port', 'starboard']) {
    el(`l_${side}_at`).addEventListener('change', (ev) => {
      beginEdit();
      line[side] = { at: ev.target.value || null, infinite: !!line[side]?.infinite };
      endEdit();
      render();
    });
    el(`l_${side}_inf`).addEventListener('change', (ev) => {
      beginEdit();
      line[side] = { ...line[side], infinite: ev.target.checked };
      endEdit();
      render();
    });
    el(`l_${side}_pick`).addEventListener('click', () => {
      // Arming rather than acting: the next chart click is the answer, and it may be an
      // existing point or a patch of open water.
      state.picking = state.picking === side ? null : side;
      render();
    });
  }
  syncLineForm(line);
}

function endFields(side, end) {
  const options = ['<option value="">&mdash; choose a point &mdash;</option>']
    .concat([...state.points.values()].map((p) =>
      `<option value="${esc(p.id)}"${end?.at === p.id ? ' selected' : ''}>${esc(p.id)}${p.latitude == null ? ' (not placed)' : ''}</option>`))
    .join('');
  return `
    <div class="endblock">
      <div class="label">${side} end</div>
      <select id="l_${side}_at">${options}</select>
      <div class="endrow">
        <button id="l_${side}_pick" class="pick">Pick on chart</button>
        <label class="cb"><input type="checkbox" id="l_${side}_inf"${end?.infinite ? ' checked' : ''}> infinite</label>
      </div>
    </div>`;
}

function syncLineForm(line) {
  if (!line) return;
  for (const side of ['port', 'starboard']) {
    const select = el(`l_${side}_at`);
    if (select) select.value = line[side]?.at ?? '';
    const check = el(`l_${side}_inf`);
    if (check) check.checked = !!line[side]?.infinite;
    const button = el(`l_${side}_pick`);
    if (button) {
      button.classList.toggle('on', state.picking === side);
      button.textContent = state.picking === side ? 'Click the chart\u2026' : 'Pick on chart';
    }
  }
  const a = endPosition(line.port);
  const b = endPosition(line.starboard);
  el('l_span').innerHTML = a && b
    ? `${distanceM(a, b)} m, ${bearingDeg(a, b).toFixed(0).padStart(3, '0')}&deg; port&rarr;starboard`
    : '<span class="warn">both ends need a position before this line can be measured</span>';
}

/**
 * Rename a line, carrying every course step that referred to it.
 *
 * Exactly the problem a point rename has, one level up: courses name their steps with
 * `line:`, so a rename that only touched the lines block would leave the sequence
 * pointing at a line that no longer exists.
 */
function renameLine(oldId, newId) {
  if (!newId || newId === oldId) { render(); return; }
  if (state.lines.has(newId)) {
    el('l_id').value = oldId;
    el('l_span').innerHTML = `<span class="warn">a line called ${esc(newId)} already exists</span>`;
    return;
  }
  const rebuilt = new Map();
  for (const [id, line] of state.lines) {
    if (id === oldId) rebuilt.set(newId, { ...line, id: newId });
    else rebuilt.set(id, line);
  }
  state.lines = rebuilt;

  // The course steps that name this line have to move with it IN MEMORY, not only in the
  // file. The save now sends the courses block as well, so a server-side text rename
  // would be overwritten a moment later by a client block still holding the old id — the
  // rename would appear to work and then quietly undo itself.
  for (const course of state.courses.values()) {
    for (const step of course.sequence ?? []) {
      if (step.line === oldId) step.line = newId;
      for (const alternative of step.gate ?? []) {
        if (alternative.line === oldId) alternative.line = newId;
      }
    }
  }

  if (state.editing) state.editing.renames.push({ kind: 'line', from: oldId, to: newId });
  state.selectedLine = newId;
  state.lineFormFor = undefined;
  render();
}

function renderCourseList() {
  const courses = [...state.courses.values()];
  el('pointList').innerHTML = courses.length === 0
    ? '<p class="muted">No courses.</p>'
    : courses.map((course) => {
        const on = course.id === state.selectedCourse;
        // The length stays: the tab is required to show it always. It moves onto the
        // same line rather than onto one of its own.
        return `<div class="row${on ? ' on' : ''}" data-id="${esc(course.id)}">
          <span class="mono">${esc(course.id)}</span>
          <span class="muted trail small">${nm(course.id)}</span>
        </div>`;
      }).join('');

  for (const row of el('pointList').querySelectorAll('.row')) {
    row.addEventListener('click', () => {
      state.selectedCourse = row.dataset.id;
      state.courseFormFor = undefined;
      frameCourse(state.courses.get(row.dataset.id));
      render();
    });
  }
  el('status').innerHTML = state.selectedCourse
    ? `<span class="ok">${nm(state.selectedCourse)}</span>`
    : `<span class="muted">${courses.length} courses</span>`;
}

/** A course length for display. Server-computed, so there is one rule and not two. */
function nm(courseId) {
  const value = state.lengths?.[courseId];
  return value == null ? '&mdash; nm' : `${value.toFixed(2)} nm`;
}

/** Frame every placed end of every line the course uses, at the usual central fifth. */
function frameCourse(course) {
  if (!course) return;
  const seen = [];
  for (const step of course.sequence ?? []) {
    for (const alternative of (step.gate?.length ? step.gate : [step])) {
      const line = state.lines.get(alternative.line);
      for (const end of [line?.port, line?.starboard]) {
        const position = endPosition(end);
        if (position) seen.push(position);
      }
    }
  }
  if (seen.length) state.view.fit(seen, FRAME_FRACTION * 4);
}

/**
 * The course editor.
 *
 * The sequence is the whole of it. Everything else — id, name, notes — is one field; the
 * sequence is an ordered list whose order IS the course, since the first step is the start
 * and the last the finish and the letters follow from position.
 */
function renderCourseForm() {
  const course = state.selectedCourse ? state.courses.get(state.selectedCourse) : null;

  if (state.courseFormFor === state.selectedCourse) { syncCourseForm(course); return; }
  state.courseFormFor = state.selectedCourse;

  if (!course) {
    el('form').innerHTML = '<p class="muted small">Select a course to edit it.</p>';
    return;
  }

  el('form').innerHTML = `
    <label class="label" for="c_id">Short name (id)</label>
    <input id="c_id" value="${esc(course.id)}" spellcheck="false">
    <label class="label" for="c_name">Long name</label>
    <input id="c_name" value="${esc(course.name ?? '')}">
    <label class="cb" style="margin-bottom:8px"><input type="checkbox" id="c_closed"${course.closed ? ' checked' : ''}>
      cycle &mdash; a loop with no start or finish of its own</label>

    <div class="paneHead" style="margin:12px 0 4px">
      <span class="label">Sequence</span>
      <span class="sp"></span>
      <span id="c_len" class="mono small"></span>
    </div>
    <div id="c_steps"></div>
    <div class="endrow" style="margin:6px 0 10px">
      <button id="c_add">Add line</button>
      <button id="c_alt">Add alternative</button>
    </div>

    <div class="endrow" style="margin-bottom:8px">
      <label class="cb"><input type="checkbox" id="c_track"${state.showTrack ? ' checked' : ''}> show track</label>
      <label class="cb"><input type="checkbox" id="c_unused"${state.hideUnused ? ' checked' : ''}> hide unused</label>
    </div>

    <label class="label" for="c_notes">Notes</label>
    <textarea id="c_notes" rows="3" spellcheck="false">${esc(course.notes ?? '')}</textarea>
    <button id="c_delete" class="danger" style="margin-top:4px">Delete course</button>`;

  for (const field of ['c_id', 'c_name', 'c_notes']) el(field).addEventListener('focus', beginEdit);
  el('c_id').addEventListener('change', (ev) => renameCourse(course.id, ev.target.value.trim()));
  el('c_id').addEventListener('blur', endEdit);
  el('c_name').addEventListener('input', (ev) => { course.name = ev.target.value; });
  el('c_name').addEventListener('blur', endEdit);
  el('c_notes').addEventListener('input', (ev) => { course.notes = ev.target.value; });
  el('c_notes').addEventListener('blur', endEdit);
  el('c_delete').addEventListener('click', deleteThing);

  el('c_closed').addEventListener('change', (ev) => {
    beginEdit();
    course.closed = ev.target.checked;
    // Entry points mean nothing on an open course, which has one start and one finish by
    // position. Dropped rather than left dormant, so a course cannot carry a marking that
    // says something untrue about it.
    if (!course.closed) for (const step of course.sequence ?? []) step.entry = false;
    state.courseFormFor = undefined;
    endEdit();
    render();
  });

  // Both are view settings, not edits: they change what is drawn, not what is stored, so
  // neither saves nor consumes the undo slot.
  el('c_track').addEventListener('change', (ev) => {
    state.showTrack = ev.target.checked;
    render();
  });

  // Only on this tab, and only while a course is selected — see inUse(). A club's water
  // carries every line it ever races, and reading one course off a chart with all of them
  // on it is the problem this solves.
  el('c_unused').addEventListener('change', (ev) => {
    state.hideUnused = ev.target.checked;
    render();
  });

  el('c_add').addEventListener('click', () => {
    beginEdit();
    course.sequence.push({ line: firstLineId(lastLineId(course)), cross: 'forward', gate: [], notes: null });
    state.courseFormFor = undefined;
    endEdit();
    render();
  });

  // "Alternative to the previous line": the last step becomes a gate, or gains another
  // side if it is one already. A gate is a choice at ONE step, never a step of its own.
  el('c_alt').addEventListener('click', () => {
    const last = course.sequence[course.sequence.length - 1];
    if (!last) return;
    beginEdit();
    if (!last.gate?.length) {
      last.gate = [{ line: last.line, cross: last.cross ?? 'forward' }];
      last.line = null;
    }
    // An alternative to the same line is not a choice, so it too avoids repeating.
    last.gate.push({ line: firstLineId(last.gate[0]?.line), cross: 'forward' });
    state.courseFormFor = undefined;
    endEdit();
    render();
  });

  renderSteps(course);
  syncCourseForm(course);
}

/**
 * A line to seed a new step with.
 *
 * Not simply the first one: a step naming the same line as the step before it makes a
 * ZERO-LENGTH LEG, which the model treats as an error rather than a short leg, since two
 * steps sharing a reference point is not something any course means. Seeding with a
 * different line means adding a step leaves the course valid, and the length actually
 * moves — which is the feedback the button is for.
 */
function firstLineId(notThisOne) {
  const ids = [...state.lines.keys()];
  return ids.find((id) => id !== notThisOne) ?? ids[0] ?? null;
}

/** The line the last step ends on, so the next one can avoid repeating it. */
function lastLineId(course) {
  const last = (course.sequence ?? [])[course.sequence.length - 1];
  if (!last) return null;
  return last.gate?.length ? last.gate[last.gate.length - 1].line : last.line;
}

function renderSteps(course) {
  const steps = course.sequence ?? [];
  // Alphabetical, not file order. The lists in the pane keep file order, which is the
  // order somebody authored them in and is worth preserving; a dropdown is for FINDING a
  // line, and a list you have to read all of is not a list you can find anything in.
  const options = (selected) => [...state.lines.keys()].sort((a, b) => a.localeCompare(b))
    .map((id) => `<option value="${esc(id)}"${id === selected ? ' selected' : ''}>${esc(id)}</option>`)
    .join('');

  el('c_steps').innerHTML = steps.length === 0
    ? '<p class="muted small">Empty. Add a line to start.</p>'
    : steps.map((step, i) => {
        const gate = step.gate?.length ? step.gate : null;
        // Reordering belongs to the STEP, so up/down sit on its first row only — a
        // gate's alternatives are a choice within the step, not steps of their own.
        const rows = (gate ?? [step]).map((entry, j) => `
          <div class="steprow${gate && j > 0 ? ' alt' : ''}">
            <span class="seq">${gate && j > 0 ? '&#8627;' : esc(courseLetter(course, i))}</span>
            <select data-step="${i}" data-alt="${j}" class="s_line">${options(entry.line)}</select>
            <button data-step="${i}" data-alt="${j}" class="s_dir" title="crossing sense">${senseOf(entry) === 'reverse' ? 'rev' : 'fwd'}</button>
            ${course.closed && j === 0
              ? `<button data-step="${i}" class="s_entry${step.entry ? ' on' : ''}" title="a boat may begin and end a lap here">&#8635;</button>`
              : ''}
            ${j === 0
              ? `<button data-step="${i}" class="s_up" title="earlier">&uarr;</button>
                 <button data-step="${i}" class="s_down" title="later">&darr;</button>`
              : '<span class="grow"></span>'}
            <button data-step="${i}" data-alt="${j}" class="s_del" title="remove">&times;</button>
          </div>`).join('');
        return `<div class="stepblock">${rows}</div>`;
      }).join('');

  const on = (cls, fn) => {
    for (const node of el('c_steps').querySelectorAll(`.${cls}`)) {
      node.addEventListener(cls === 's_line' ? 'change' : 'click', (ev) => {
        beginEdit();
        fn(Number(node.dataset.step), Number(node.dataset.alt), ev, node);
        state.courseFormFor = undefined;
        endEdit();
        render();
      });
    }
  };

  on('s_line', (i, j, ev, node) => { entryAt(course, i, j).line = node.value; });
  on('s_dir', (i, j) => {
    const entry = entryAt(course, i, j);
    entry.cross = senseOf(entry) === 'forward' ? 'reverse' : 'forward';
  });
  on('s_del', (i, j) => {
    const step = course.sequence[i];
    if (step.gate?.length) {
      step.gate.splice(j, 1);
      // One alternative left is not a choice: collapse it back to a plain step.
      if (step.gate.length === 1) { step.line = step.gate[0].line; step.cross = step.gate[0].cross; step.gate = []; }
      if (step.gate.length === 0 && !step.line) course.sequence.splice(i, 1);
    } else {
      course.sequence.splice(i, 1);
    }
  });
  // A line crossed to begin a lap must be crossed again, in the same sense, to end it —
  // so an entry point is a start and a finish at once, and a lap is bounded by the same
  // crossing twice. That is what keeps the scoring from having to decide which of several
  // crossings closed the loop, and it puts the burden on course design instead.
  on('s_entry', (i) => { course.sequence[i].entry = !course.sequence[i].entry; });
  on('s_up', (i) => { if (i > 0) course.sequence.splice(i - 1, 0, course.sequence.splice(i, 1)[0]); });
  on('s_down', (i) => {
    if (i < course.sequence.length - 1) course.sequence.splice(i + 1, 0, course.sequence.splice(i, 1)[0]);
  });
}

function entryAt(course, i, j) {
  const step = course.sequence[i];
  return step.gate?.length ? step.gate[j] : step;
}

function senseOf(entry) {
  return String(entry?.cross ?? 'forward').toLowerCase();
}

function syncCourseForm(course) {
  if (!course) return;
  el('c_len').innerHTML = nm(course.id);
  const track = el('c_track');
  if (track) track.checked = state.showTrack;
  const unused = el('c_unused');
  if (unused) unused.checked = state.hideUnused;
}

function renameCourse(oldId, newId) {
  if (!newId || newId === oldId) { render(); return; }
  if (state.courses.has(newId)) {
    el('c_id').value = oldId;
    el('c_len').innerHTML = `<span class="warn">a course called ${esc(newId)} already exists</span>`;
    return;
  }
  const rebuilt = new Map();
  for (const [id, course] of state.courses) {
    if (id === oldId) rebuilt.set(newId, { ...course, id: newId });
    else rebuilt.set(id, course);
  }
  state.courses = rebuilt;
  // No rename to follow: nothing in the file refers to a course by id.
  state.selectedCourse = newId;
  state.courseFormFor = undefined;
  render();
}







/* -------------------------------------------------------------------- form */

/**
 * The edit form for the selected point.
 *
 * Rebuilt only when the SELECTION changes. Every pan and zoom calls render(), and
 * rebuilding the markup on each of those would take the caret out of whatever field
 * somebody was typing in. So a re-render with the same selection only syncs the values
 * of fields nobody is currently in — which is what lets a drag update the latitude box
 * live while a note is being typed in the box below it.
 */
function renderForm() {
  const point = state.selected ? state.points.get(state.selected) : null;

  if (state.formFor === state.selected) {
    syncForm(point);
    return;
  }
  state.formFor = state.selected;

  if (!point) {
    el('form').innerHTML = '<p class="muted small">Select a point to edit it.</p>';
    return;
  }

  el('form').innerHTML = `
    <label class="label" for="f_id">Short name (id)</label>
    <input id="f_id" value="${esc(point.id)}" spellcheck="false">
    <label class="label" for="f_name">Long name</label>
    <input id="f_name" value="${esc(point.name ?? '')}">
    <div class="pair">
      <div><label class="label" for="f_lat">Latitude</label><input id="f_lat" inputmode="decimal" spellcheck="false"></div>
      <div><label class="label" for="f_lon">Longitude</label><input id="f_lon" inputmode="decimal" spellcheck="false"></div>
    </div>
    <div id="f_dm" class="mono small muted"></div>
    <label class="label" for="f_notes">Notes</label>
    <textarea id="f_notes" rows="3" spellcheck="false">${esc(point.notes ?? '')}</textarea>
    <div id="f_used"></div>
    <button id="f_delete" class="danger" style="margin-top:10px">Delete point</button>`;

  el('f_delete').addEventListener('click', deleteThing);

  for (const field of ['f_id', 'f_name', 'f_lat', 'f_lon', 'f_notes']) {
    el(field).addEventListener('focus', beginEdit);
  }
  el('f_id').addEventListener('change', (ev) => rename(point.id, ev.target.value.trim()));
  el('f_id').addEventListener('blur', endEdit);
  el('f_name').addEventListener('input', (ev) => { point.name = ev.target.value; });
  el('f_name').addEventListener('blur', endEdit);
  el('f_notes').addEventListener('input', (ev) => { point.notes = ev.target.value; });
  el('f_notes').addEventListener('blur', endEdit);

  for (const field of ['f_lat', 'f_lon']) {
    el(field).addEventListener('blur', (ev) => {
      // Tabbing between latitude and longitude is still one edit in progress. Committing
      // on the first blur would see a half-typed pair and clear the position out from
      // under somebody who was midway through entering it.
      const to = ev && ev.relatedTarget;
      if (to && (to.id === 'f_lat' || to.id === 'f_lon')) return;

      const lat = parseFloat(el('f_lat').value);
      const lon = parseFloat(el('f_lon').value);
      // Both or neither. Half a position is not a position, and silently keeping the old
      // half would put the point somewhere nobody typed.
      if (Number.isFinite(lat) && Number.isFinite(lon)) Object.assign(point, snap({ latitude: lat, longitude: lon }));
      else { point.latitude = null; point.longitude = null; }
      render();
      endEdit();
    });
  }
  syncForm(point);
}

function syncForm(point) {
  if (!point) return;
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  const set = (id, value) => {
    const input = el(id);
    if (input && input !== active) input.value = value;
  };
  set('f_lat', point.latitude != null ? point.latitude.toFixed(6) : '');
  set('f_lon', point.longitude != null ? point.longitude.toFixed(6) : '');
  el('f_dm').innerHTML = point.latitude != null
    ? esc(formatPosition(point))
    : '<span class="warn">not placed &mdash; click the chart to put it somewhere</span>';
  el('f_used').innerHTML = relatedLines(point.id);
}

/**
 * Rename a point, carrying every line end that referred to it.
 *
 * A point's id is not a label: lines name their ends by it. Renaming without following
 * the references would silently detach a line from its end, which the server would then
 * report as an unknown point long after anybody remembered doing it.
 */
function rename(oldId, newId) {
  if (!newId || newId === oldId) { render(); return; }
  if (state.points.has(newId)) {
    // Two points with one id is not a rename, it is a merge, and no editor should do
    // that quietly.
    el('f_id').value = oldId;
    el('f_dm').innerHTML = `<span class="warn">a point called ${esc(newId)} already exists</span>`;
    return;
  }
  // Rebuilt rather than mutated, so the list keeps its file order across a rename.
  const rebuilt = new Map();
  for (const [id, point] of state.points) {
    if (id === oldId) rebuilt.set(newId, { ...point, id: newId });
    else rebuilt.set(id, point);
  }
  state.points = rebuilt;

  for (const line of state.lines.values()) {
    for (const end of [line.port, line.starboard]) {
      if (end && end.at === oldId) end.at = newId;
    }
  }
  // Recorded on the edit in progress, so the save can carry it: the points block is
  // regenerated under the new id, but the `at:` references in the lines block are text
  // the server has to follow.
  if (state.editing) state.editing.renames.push({ kind: 'point', from: oldId, to: newId });

  state.selected = newId;
  state.formFor = undefined;   // the form is for a different id now; rebuild it
  render();
}

/** Which lines use this point, and how far it is from the other end. */
function relatedLines(pointId) {
  const lines = [...state.lines].filter(
    ([, l]) => l.port?.at === pointId || l.starboard?.at === pointId
  );
  if (!lines.length) return '<p class="muted small" style="margin-top:10px">Not used by any line.</p>';
  return `<div style="margin-top:10px"><div class="label">Used by</div>${lines.map(([id, line]) => {
    const side = line.port?.at === pointId ? 'port' : 'starboard';
    const other = endPosition(side === 'port' ? line.starboard : line.port);
    const here = state.points.get(pointId);
    const span = other && here?.latitude != null
      ? `${distanceM(here, other)} m, ${bearingDeg(here, other).toFixed(0).padStart(3, '0')}&deg;`
      : '&mdash;';
    const inf = (side === 'port' ? line.port : line.starboard)?.infinite;
    return `<div class="small"><span class="mono">${esc(id)}</span> <span class="muted">${side}${inf ? ' (infinite &mdash; a handle, not a place)' : ''} &middot; ${span}</span></div>`;
  }).join('')}</div>`;
}

/* ------------------------------------------------------- saving and undo */

/** Everything an undo needs to put back. Serialised, so it cannot alias live state. */
function snapshot() {
  return {
    points: JSON.stringify([...state.points]),
    lines: JSON.stringify([...state.lines]),
    courses: JSON.stringify([...state.courses]),
    selected: state.selected,
    selectedLine: state.selectedLine,
    selectedCourse: state.selectedCourse,
    renames: [],
  };
}

/**
 * Mark the start of an edit.
 *
 * Called on focus, on grabbing a point, and on pressing the chart — before anything has
 * changed, because that is the state undo has to be able to return to. Re-entrant calls
 * are ignored: tabbing from latitude to longitude is one edit, not two.
 */
function beginEdit() {
  if (!state.editing) state.editing = snapshot();
}

/**
 * Mark the end of an edit, and save if it changed anything.
 *
 * The no-op guard matters more than it looks. The form saves on blur, and focusing a
 * field and leaving it again without typing is an extremely ordinary thing to do — with
 * no guard, every one of those would write the file and, worse, consume the undo slot
 * with a change nobody made.
 */
function endEdit() {
  const before = state.editing;
  state.editing = null;
  if (!before) return;
  const unchanged = before.points === JSON.stringify([...state.points])
    && before.lines === JSON.stringify([...state.lines])
    && before.courses === JSON.stringify([...state.courses])
;
  if (unchanged && before.renames.length === 0) return;
  state.undo = before;
  save(before.renames);
}

/** Put back the state from before the last edit, and write that too. */
function takeUndo() {
  const back = state.undo;
  if (!back) return;
  state.undo = null;
  state.points = new Map(JSON.parse(back.points));
  state.lines = new Map(JSON.parse(back.lines));
  state.courses = new Map(JSON.parse(back.courses));
  state.selected = back.selected;
  state.selectedLine = back.selectedLine;
  state.selectedCourse = back.selectedCourse;
  state.courseFormFor = undefined;
  state.formFor = undefined;
  // Renames have to be undone in the file as well as in memory: backwards, inverted, and
  // KEEPING THE KIND. Without the kind the server follows the wrong key — a line rename
  // undone as a point rename rewrites nothing, and the course step stays orphaned.
  save([...back.renames].reverse().map(({ kind, from, to }) => ({ kind, from: to, to: from })));
  render();
}

async function save(renames = []) {
  if (!state.key) return;
  setSaveState('saving');
  const points = {};
  for (const [id, p] of state.points) {
    points[id] = {
      name: p.name ?? null,
      latitude: p.latitude ?? null,
      longitude: p.longitude ?? null,
      notes: p.notes ?? null,
    };
  }
  const courses = {};
  for (const [id, c] of state.courses) {
    courses[id] = {
      name: c.name ?? null,
      closed: !!c.closed,
      notes: c.notes ?? null,
      sequence: (c.sequence ?? []).map((step) => ({
        line: step.gate?.length ? null : (step.line ?? null),
        cross: step.gate?.length ? null : senseOf(step),
        gate: (step.gate ?? []).map((a) => ({ line: a.line ?? null, cross: senseOf(a) })),
        lengthNm: step.lengthNm ?? null,
        // Only meaningful on a closed course, and dropped with it — a step cannot be left
        // carrying a marking that says something untrue about an open course.
        entry: !!(c.closed && step.entry),
        notes: step.notes ?? null,
      })),
    };
  }
  const lines = {};
  for (const [id, l] of state.lines) {
    lines[id] = {
      name: l.name ?? null,
      port: cleanEnd(l.port),
      starboard: cleanEnd(l.starboard),
      notes: l.notes ?? null,
    };
  }
  try {
    const response = await fetch(`/api/programmes/${state.key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      // Both blocks every time. Editing a line can create a point, and the two halves of
      // that have to land together or the file names a point that does not exist yet.
      body: JSON.stringify({ renames, points, lines, courses }),
    });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    const result = await response.json();
    setSaveState('saved', `${result.points}p ${result.lines}l`);
    // Lengths come back recomputed, so the tab shows the new figure the moment a step
    // changes rather than the one from before the edit.
    if (result.lengths) state.lengths = result.lengths;
    // The server recomputes what is wrong with the programme on every write, so the
    // problems panel is never stale.
    state.problems = result.problems ?? [];
    renderList();
    if (state.tab === 'courses') syncCourseForm(state.courses.get(state.selectedCourse));
  } catch (e) {
    // Left on screen rather than cleared on a timer: a failed save means the file on
    // disk no longer matches what is in front of you, and that is worth interrupting for.
    setSaveState('error', e.message);
  }
}

/** A line end as the file wants it: a named point, or a bare position, never both. */
function cleanEnd(end) {
  if (!end) return { infinite: false };
  if (end.at) return { at: end.at, infinite: !!end.infinite };
  return {
    latitude: end.latitude ?? null,
    longitude: end.longitude ?? null,
    infinite: !!end.infinite,
  };
}


function setSaveState(which, note = '') {
  state.saveState = which;
  state.saveNote = note;
  renderActions();
}

function renderActions() {
  const label = {
    idle: '<span class="muted">no changes</span>',
    saving: '<span class="muted">saving&hellip;</span>',
    saved: `<span class="ok">saved</span> <span class="muted">${esc(state.saveNote)}</span>`,
    error: `<span class="warn">save failed &mdash; ${esc(state.saveNote)}</span>`,
  }[state.saveState];
  el('save').innerHTML = label;

  const button = el('undo');
  button.disabled = !state.undo;
  button.textContent = state.undo ? 'Undo last edit' : 'Nothing to undo';
}

/* ------------------------------------------------------------ interaction */

function svgPx(ev) {
  const box = el('map').getBoundingClientRect();
  return [
    ((ev.clientX - box.left) * state.view.width) / box.width,
    ((ev.clientY - box.top) * state.view.height) / box.height,
  ];
}

function wire() {
  const svg = el('map');
  let panning = null;

  svg.addEventListener('mousedown', (ev) => {
    // Begun here rather than on mouseup, because a click that places a point has to be
    // able to return to where the point was before it.
    if (placingArmed()) beginEdit();
    panning = { at: svgPx(ev), from: svgPx(ev), moved: false };
  });

  window.addEventListener('mousemove', (ev) => {
    if (state.dragging) {
      const [px, py] = svgPx(ev);
      const point = state.points.get(state.dragging);
      // The true position while dragging; the grid only on commit, so a drag feels
      // continuous and the stored value is still on the metre.
      if (point) Object.assign(point, state.view.toPosition(px, py));
      render();
      return;
    }
    if (!panning) return;
    const [px, py] = svgPx(ev);
    if (Math.hypot(px - panning.from[0], py - panning.from[1]) > 3) panning.moved = true;
    state.view.panByPx(px - panning.at[0], py - panning.at[1]);
    panning.at = [px, py];
    render();
  });

  window.addEventListener('mouseup', (ev) => {
    if (state.dragging) {
      const point = state.points.get(state.dragging);
      if (point) Object.assign(point, snap(point));
      state.dragging = null;
      render();
      endEdit();
      panning = null;
      return;
    }
    // A click, not a drag: the two are the same gesture until the mouse moves, so the
    // distinction has to be made here rather than on mousedown.
    if (panning && !panning.moved && placingArmed()) {
      const [px, py] = svgPx(ev);
      if (state.tab === 'lines') {
        const line = state.lines.get(state.selectedLine);
        const side = state.picking;
        // Either an existing point that the click landed on, or a new one where it fell.
        line[side] = { at: pointAtClick(px, py, line.id, side), infinite: !!line[side]?.infinite };
        state.picking = null;
        state.lineFormFor = undefined;   // the point list in the selects has changed
      } else {
        Object.assign(state.points.get(state.selected), snap(state.view.toPosition(px, py)));
      }
      render();
      endEdit();
    } else {
      // A pan, not an edit. Drop the snapshot rather than leaving it to be attributed to
      // whatever is edited next.
      state.editing = null;
    }
    panning = null;
  });

  svg.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const [px, py] = svgPx(ev);
    state.view.zoomAtPx(px, py, wheelZoomStep(ev.deltaY, ev.deltaMode));
    render();
  }, { passive: false });

  el('programme').addEventListener('change', (ev) => loadProgramme(ev.target.value));

  // Built from BASEMAPS so the labels and the order live in one place, and adding a
  // background needs no change here.
  const basemap = el('basemap');
  basemap.innerHTML = Object.entries(BASEMAPS)
    .map(([id, spec]) => `<option value="${id}"${id === state.basemap ? ' selected' : ''}>${esc(spec.label)}</option>`)
    .join('');
  basemap.addEventListener('change', (ev) => {
    state.basemap = ev.target.value;
    render();
  });

  el('undo').addEventListener('click', takeUndo);

  for (const button of document.querySelectorAll('[data-tab]')) {
    button.addEventListener('click', () => showTab(button.dataset.tab));
  }

  el('add').addEventListener('click', addThing);

  const pop = el('infopop');
  const info = el('paneInfo');
  info.addEventListener('mouseenter', () => {
    pop.innerHTML = info.dataset.info ?? '';
    const box = info.getBoundingClientRect();
    pop.style.display = 'block';
    // Right-aligned to the icon and hanging below it, so a long explanation opens over
    // the chart rather than off the edge of a 330px pane.
    pop.style.top = `${box.bottom + 6}px`;
    pop.style.left = `${Math.max(8, box.right - pop.offsetWidth)}px`;
  });
  info.addEventListener('mouseleave', () => { pop.style.display = 'none'; });

  window.addEventListener('resize', render);
}

wire();
showTab('courses');
renderActions();
loadProgrammeList().catch((e) => {
  el('status').innerHTML = `<span class="warn">${esc(e.message)}</span>`;
});
