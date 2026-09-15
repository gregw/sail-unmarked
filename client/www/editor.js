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
  centre,
  distanceM,
  formatPosition,
  rotateAbout,
  snap,
  translateBy,
  wheelZoomStep,
} from './geo.js';

/** How much of the chart a selected line is framed to occupy. */
const FRAME_FRACTION = 0.2;

/**
 * What may be used as an id, and the nearest legal id to what somebody typed.
 *
 * Mirrors `model/Ids.java`, deliberately and in both directions: the server REPORTS a bad
 * id so a hand-edited file still loads, and the editor CORRECTS one so a bad id is fixed in
 * front of the person who wrote it rather than found by whoever comes next. An id is a key,
 * not a label — it ends up in filesystem paths, URL segments, `series/course/variant`
 * composite keys and YAML mapping keys, and a space or a slash breaks one of those.
 *
 * A `/` is legal in a point or line id and nowhere else: those are the only ids that never
 * reach a path, a URL segment or a snapshot label, and the scoped name the editor generates
 * when a mark is promoted to a course reads better with one.
 */
const ID_MAX = 64;

function slug(raw, scoped = false) {
  const keep = scoped ? 'a-z0-9_/-' : 'a-z0-9_-';
  const out = String(raw ?? '').toLowerCase()
    .replace(new RegExp(`[^${keep}]+`, 'g'), '-')
    // A run of separators is one separator, and the scope separator wins the run.
    .replace(/[-_]*(\/)[-_/]*/g, '$1')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_/]+/, '')
    .replace(/[-_/]+$/, '');
  return out.length > ID_MAX ? out.slice(0, ID_MAX).replace(/[-_/]+$/, '') : out;
}

/**
 * Take an id from a field, correcting it and saying so.
 *
 * Returns null when nothing legal survives, which every caller reads as "keep the id it
 * had" — renaming somebody's course to `x` because they typed punctuation would be worse
 * than ignoring the keystroke.
 */
function takeId(input, raw, scoped, say) {
  const clean = slug(raw, scoped);
  if (!clean) return null;
  if (clean !== raw) {
    if (input) input.value = clean;
    say(`'${raw}' is not a legal id — using '${clean}'`);
  }
  return clean;
}



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
  courses: new Map(),   // id -> { id, name, public, notes, variants: Map }
  selectedCourse: null,
  // The Courses tab edits exactly ONE variant, and that is the whole of the scope rule:
  // which tab you are on says whether an edit lands on the club's geometry or on this
  // design alone.
  selectedVariant: null,
  // A snapshot is the fourth level of the drill-down, and selecting one REPLACES the
  // variant in the editor: what is drawn and what the form shows is the capture, read-only.
  selectedSnapshot: null,
  // Which levels are expanded, by explicit answer. A level not named here falls back to
  // the default: open while it has nothing chosen. Several may be open at once — choosing
  // from a list does NOT close it, because the next thing you do is often to choose again.
  open: {},             // level -> true | false
  // Which level was last worked at. With several lists open there is no longer a single
  // "deepest open level" to infer it from, and the form has to follow something.
  // A dragged list keeps its height across renders. The rows are re-rendered, so the
  // inline height the browser wrote would otherwise be thrown away on the next pan.
  listHeight: {},       // level -> px
  // Which way a line end is being edited: by naming a point, or by typing a position.
  // Held here rather than on the end itself, because it is a view state — the end's own
  // shape (`at`, or lat/long) is what gets saved.
  endMode: {},          // "<line>:<side>" -> 'named' | 'inline'
  programmes: [],       // every club/series the server has
  lifecycle: null,      // server-derived: dirty state, snapshots, publications
  lengths: {},          // course -> variant -> nm, computed by the server so there is one rule
  showTrack: true,
  hideUnused: false,
  // Behind a tickbox, like the track: a box round the course is a lot of ink, and its grips
  // are the one gesture that can detach a dozen shared marks at once. Deliberate is right.
  // undefined means "decide from the course": on when it owns all its own geometry. The
  // tickbox writes an explicit answer, which is forgotten when a different variant opens.
  showTransform: undefined,
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

async function loadProgrammeList(keep = null) {
  state.programmes = await json('/api/programmes');
  const wanted = state.programmes.some((p) => `${p.club}/${p.series}` === keep)
    ? keep
    : (state.programmes.length ? `${state.programmes[0].club}/${state.programmes[0].series}` : null);
  if (wanted) await loadProgramme(wanted);
  else { state.key = null; render(); }
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
    id,
    name: c.name ?? null,
    public: !!c.public,
    notes: c.notes ?? null,
    variants: new Map(Object.entries(c.variants ?? {}).map(([vid, v]) => [vid, variantIn(vid, v)])),
  }]));
  state.lengths = programme.lengths ?? {};
  state.selectedCourse = null;
  state.selectedVariant = null;
  state.selectedSnapshot = null;
  state.snapshotShown = null;
  state.selectedLine = null;
  state.picking = null;
  state.open = {};
  state.endMode = {};
  state.courseFormFor = undefined;
  state.courseFieldsFor = undefined;
  state.seriesFormFor = undefined;
  state.rowsHtml = undefined;
  state.rowsTop = undefined;
  select(null);
  await loadLifecycle();

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

/** One variant, deep-copied so editing it cannot reach back into the fetched JSON. */
function variantIn(id, v) {
  return {
    id,
    name: v.name ?? null,
    template: !!v.template,
    closed: !!v.closed,
    // Ad-hoc geometry: no id in the club's list, alive only inside this variant, so
    // moving one affects exactly one variant by construction.
    points: new Map(Object.entries(v.points ?? {}).map(([pid, p]) => [pid, { ...p, id: pid }])),
    lines: new Map(Object.entries(v.lines ?? {}).map(([lid, l]) => [lid, {
      ...l, id: lid,
      port: { ...(l.port ?? {}) },
      starboard: { ...(l.starboard ?? {}) },
    }])),
    sequence: (v.sequence ?? []).map((step) => ({
      ...step,
      gate: (step.gate ?? []).map((alt) => ({ ...alt })),
    })),
    notes: v.notes ?? null,
  };
}

/**
 * Whether each variant is unpublished, current, dirty, incomplete or a template, plus its
 * snapshots and what is published.
 *
 * Fetched rather than computed here, because the state is a comparison between a hash of
 * the RESOLVED variant and the revision of its latest snapshot — and the hash has one
 * implementation, on the server, or two clients could disagree about whether a course had
 * changed.
 */
async function loadLifecycle() {
  if (!state.key) return;
  try {
    state.lifecycle = await json(`/api/lifecycle/${state.key}`);
  } catch (e) {
    state.lifecycle = null;
  }
}

/** The lifecycle row for one variant, or an empty one while the fetch is in flight. */
function lifeOf(courseId, variantId) {
  return state.lifecycle?.courses?.[courseId]?.variants?.[variantId] ?? {};
}

/* ----------------------------------------------------------- scope of an edit */

/**
 * The geometry in scope, which is the whole of the tab rule made concrete.
 *
 * On the Points and Lines tabs this is the club's named geometry and nothing else, so an
 * edit there is a club-wide edit by construction. On the Courses tab with a variant open it
 * is the club's geometry with that variant's AD-HOC geometry on top, so the chart shows the
 * design as it will be sailed while the club's list stays exactly as it was.
 *
 * Rebuilt at the top of every render rather than on each lookup: the maps are small and the
 * alternative is a copy per line per frame.
 */
const GEO = { points: new Map(), lines: new Map() };

function currentCourse() {
  return state.selectedCourse ? state.courses.get(state.selectedCourse) ?? null : null;
}

/**
 * The variant being edited — or, when a snapshot is selected, THAT, as a read-only stand-in.
 *
 * A snapshot is a fully inlined capture, which is exactly what an all-ad-hoc variant is, so
 * it can be handed to the drawing code as one and every line, triangle, leg and label works
 * unchanged. What it must not do is get edited, which {@link readOnly} sees to.
 */
function currentVariant() {
  if (state.tab !== 'courses') return null;
  if (state.selectedSnapshot) return snapshotVariant();
  if (!state.selectedVariant) return null;
  return currentCourse()?.variants.get(state.selectedVariant) ?? null;
}

/** True while a snapshot is on screen: it is a record of what was sailed, not a draft. */
function readOnly() {
  return !!state.selectedSnapshot;
}

/** The snapshot in hand, from the lifecycle's list. */
function currentSnapshotEntry() {
  const life = lifeOf(state.selectedCourse, state.selectedVariant);
  return (life.snapshots ?? []).find((s) => s.revision === state.selectedSnapshot) ?? null;
}

/**
 * The selected snapshot's geometry, shaped as a variant.
 *
 * Cached on the revision, because a revision names one geometry: rebuilding it every render
 * would rebuild something that by definition cannot have changed.
 */
function snapshotVariant() {
  if (state.snapshotShown?.revision !== state.selectedSnapshot) return null;
  return state.snapshotShown.variant;
}

/**
 * Turn a fetched snapshot into a variant the drawing code understands.
 *
 * Every crossing carries its line resolved to two positions, so each becomes an AD-HOC line
 * with inline ends — which is what a snapshot is: geometry belonging to nothing else, that
 * nothing can move. A line crossed three times appears three times in the capture with the
 * same resolved geometry, so it is kept once and referred to three times, exactly as the
 * living course does.
 */
function variantFromSnapshot(snap) {
  const lines = new Map();
  const end = (e) => ({
    latitude: e?.latitude ?? null,
    longitude: e?.longitude ?? null,
    infinite: !!e?.infinite,
  });
  const sequence = (snap.steps ?? []).map((step) => {
    const parts = (step.crossings ?? []).map((c) => {
      if (!lines.has(c.line)) {
        lines.set(c.line, {
          id: c.line, name: c.line,
          port: end(c.port), starboard: end(c.starboard), notes: null,
        });
      }
      return { line: c.line, cross: String(c.cross ?? 'forward').toLowerCase(), gate: [] };
    });
    if (parts.length > 1)
      return { line: null, cross: null, gate: parts, entry: !!step.entry, notes: null };
    return { ...(parts[0] ?? { line: null, cross: 'forward', gate: [] }), entry: !!step.entry, notes: null };
  });
  return {
    id: snap.revision, name: snap.label, template: false, closed: !!snap.closed,
    points: new Map(), lines, sequence, notes: null,
  };
}

function refreshGeo() {
  const variant = currentVariant();
  GEO.points = variant && variant.points.size
    ? new Map([...state.points, ...variant.points]) : state.points;
  GEO.lines = variant && variant.lines.size
    ? new Map([...state.lines, ...variant.lines]) : state.lines;
}

/** True when this id belongs to the open variant rather than to the club. */
function isAdhoc(kind, id) {
  const variant = currentVariant();
  return !!variant && (kind === 'line' ? variant.lines.has(id) : variant.points.has(id));
}

/** A step's alternatives: a gate's sides, or the step itself. */
function alts(step) {
  return step.gate?.length ? step.gate : [step];
}

/** Every variant in the programme, with the course it belongs to. */
function everyVariant() {
  const out = [];
  for (const course of state.courses.values()) {
    for (const variant of course.variants.values()) out.push({ course, variant });
  }
  return out;
}

/**
 * Which variants would be affected by moving this point or line — the answer to "whose
 * racing did I just change?", which the model exists to make answerable.
 *
 * A variant is affected if its sequence names the line, or names a line (the club's or its
 * own) that has an end at the point. A variant that has already detached its own copy is
 * NOT affected, which is the whole purpose of detaching.
 */
function affectedBy(kind, id) {
  const out = [];
  for (const { course, variant } of everyVariant()) {
    const named = new Set();
    for (const step of variant.sequence) {
      for (const alternative of alts(step)) if (alternative.line) named.add(alternative.line);
    }
    let hit = false;
    if (kind === 'line') {
      hit = named.has(id) && !variant.lines.has(id);
    } else {
      for (const lineId of named) {
        // The variant's own copy shadows the club's, so a detached line is looked up here
        // and correctly reports that it no longer depends on the club point.
        const line = variant.lines.get(lineId) ?? state.lines.get(lineId);
        if (line?.port?.at === id || line?.starboard?.at === id) { hit = true; break; }
      }
      if (hit && variant.points.has(id)) hit = false;
    }
    if (hit) out.push({ course: course.id, variant: variant.id });
  }
  return out;
}

/* ---------------------------------------------------- moving a whole course */

/**
 * Everything one variant's geometry is made of: the lines it names, the club points those
 * lines sit on, and the ends that carry their own position.
 *
 * A point used by two of the course's lines appears ONCE, because it is one point and
 * moving it twice would move it twice as far.
 */
function courseParts(variant) {
  const lines = new Set();
  for (const step of variant.sequence) {
    for (const alternative of alts(step)) if (alternative.line) lines.add(alternative.line);
  }
  const points = new Set();
  const inline = [];
  for (const id of lines) {
    const line = variant.lines.get(id) ?? state.lines.get(id);
    if (!line) continue;
    for (const side of ['port', 'starboard']) {
      if (line[side]?.at) points.add(line[side].at);
      else if (line[side]?.latitude != null) inline.push({ line: id, side });
    }
  }
  return { lines, points, inline };
}

/**
 * What this drag is doing to a position, and what to tell the person doing it.
 *
 * Kept as a function of the ORIGINAL position rather than the current one, so previewing
 * frame after frame does not compound: every frame starts from where the course was when
 * the grip was taken hold of.
 *
 * The turn is measured in SCREEN angle, because that is what the hand is doing; screen y
 * runs down, so the sign is flipped on the way into a compass bearing. It snaps to whole
 * degrees — a wind shift is spoken about in degrees, not in fractions of one.
 */
function courseTransform(drag, at, px, py) {
  if (drag.kind === 'coursemove') {
    const dLat = at.latitude - drag.grab.at.latitude;
    const dLon = at.longitude - drag.grab.at.longitude;
    drag.transform = (p) => translateBy(p, dLat, dLon);
    const moved = distanceM(drag.grab.at, at);
    drag.label = `move ${moved} m, ${bearingDeg(drag.grab.at, at).toFixed(0).padStart(3, '0')}°`;
    return drag.transform;
  }
  const [ox, oy] = state.view.toPx(drag.centre);
  const was = Math.atan2(drag.grab.py - oy, drag.grab.px - ox);
  const now = Math.atan2(py - oy, px - ox);
  let deg = Math.round(((now - was) * 180) / Math.PI);
  // Shortest way round, so a drag past due north does not read as 359 degrees the wrong way.
  deg = ((deg % 360) + 540) % 360 - 180;
  drag.amount = deg;
  drag.transform = (p) => rotateAbout(p, drag.centre, deg);
  drag.label = `turn ${deg > 0 ? '+' : ''}${deg}°`;
  return drag.transform;
}

/**
 * Whether the move and turn grips are showing.
 *
 * An explicit answer from the tickbox if there is one, and otherwise: **on when the course
 * owns everything it is built from**. A variant with nothing shared is one that was taken
 * from a template to be raced, and the next thing anybody does with one of those is put it
 * where today's wind wants it. There is nothing to warn about either — no drag of it can
 * reach another course — so making somebody find a tickbox first would be ceremony.
 *
 * A course built on the club's surveyed marks keeps the grips hidden until asked for,
 * because there a drag IS consequential.
 */
function transformShown() {
  const variant = currentVariant();
  // A capture is what a boat was handed. Nothing about it moves, so it is offered no grips.
  if (!variant || readOnly()) return false;
  if (state.showTransform !== undefined) return state.showTransform;
  const { sharedLines, sharedPoints } = sharedParts(variant, currentCourse());
  return sharedLines.length === 0 && sharedPoints.length === 0;
}

/** The live position objects a course transform would touch, with where each started. */
function movables(variant) {
  const { points, inline } = courseParts(variant);
  const out = [];
  const take = (obj) => {
    if (obj && obj.latitude != null)
      out.push({ obj, from: { latitude: obj.latitude, longitude: obj.longitude } });
  };
  for (const id of points) take(GEO.points.get(id));
  for (const { line, side } of inline) take(GEO.lines.get(line)?.[side]);
  return out;
}

/** What this variant's geometry shares with anything else. */
function sharedParts(variant, course) {
  const { lines, points } = courseParts(variant);
  const mine = (u) => u.course === course.id && u.variant === variant.id;
  const sharedLines = [...lines].filter((id) =>
    !variant.lines.has(id) && affectedBy('line', id).some((u) => !mine(u)));
  const sharedPoints = [...points].filter((id) =>
    !variant.points.has(id) && affectedBy('point', id).some((u) => !mine(u)));
  const users = [...new Set([...sharedLines.flatMap((id) => affectedBy('line', id)),
    ...sharedPoints.flatMap((id) => affectedBy('point', id))]
    .filter((u) => !mine(u)).map((u) => `${u.course}/${u.variant}`))];
  return { sharedLines, sharedPoints, users };
}

/**
 * Move or turn a whole course, detaching whatever it shares first if that is the answer.
 *
 * <b>This is the one gesture that can convert most of a course to ad-hoc in one go</b>, so
 * it says how much before it does it. Sliding a freshly cloned course is exactly the case:
 * every named line it inherited belongs to the club, and moving this course must not move
 * the club's marks.
 */
async function transformCourse(variant, course, transform, what) {
  const parts = movables(variant);
  if (!parts.length) return;

  const { sharedLines, sharedPoints, users } = sharedParts(variant, course);
  const shared = sharedLines.length + sharedPoints.length;
  let answer = 'here';
  if (shared) {
    const siblingsOnly = users.every((u) => u.startsWith(`${course.id}/`));
    // Moving the club's marks IS offered here, unlike on a single mark's drag. The
    // invariant is that scope is never widened by ACCIDENT, and an explicit answer is the
    // mechanism for widening it — and on race morning, "the whole fleet's course has
    // shifted twenty degrees" is a real thing somebody means.
    const choices = [{
      key: 'all',
      label: siblingsOnly
        ? `Move them for all of ${course.id}`
        : `Move them for every course — ${users.join(', ')}`,
      primary: siblingsOnly,
    }, {
      key: 'here',
      label: `Detach ${shared} shared ${shared === 1 ? 'mark' : 'marks'} and move only this course`,
      primary: !siblingsOnly,
    }];
    answer = await ask(`${what} ${course.id}/${variant.id}?`,
      `It is built on <b>${shared}</b> ${shared === 1 ? 'mark' : 'marks'} the club shares with `
      + `<b>${esc(users.join(', '))}</b>. Detaching makes those this course's own copies and `
      + 'leaves the others where they are; moving them for everybody moves the club\'s marks, '
      + 'and every course built on them comes too.', choices);
    if (!answer) return;
  }

  if (answer === 'here') {
    // Lines first: a line the variant now owns is repointed in place by detachPoint, so
    // doing it the other way round would copy some lines twice.
    for (const id of sharedLines) detachLine(id, variant);
    for (const id of sharedPoints)
      detachPoint(id, [{ course: course.id, variant: variant.id }],
        { points: variant.points, lines: variant.lines }, '');
    refreshGeo();
  }
  for (const m of movables(variant)) Object.assign(m.obj, snap(transform(m.obj)));
  state.courseFormFor = undefined;
}

/* -------------------------------------------------- moving named geometry */

/**
 * Every list in the pane is sorted by id.
 *
 * File order is the order somebody authored things in, which was worth preserving while
 * the lists were short. They are not short any more, and a list you have to read all of is
 * not a list you can find anything in. The FILE keeps its own order regardless — the writer
 * emits the map it is given, and nothing here reorders what is on disk.
 */
function byId(entries, id = (e) => e.id) {
  return [...entries].sort((a, b) => String(id(a)).localeCompare(String(id(b))));
}

/** An id not taken in any of these maps. */
function freeAcross(base, ...maps) {
  base = slug(base, true) || 'x';
  const has = (id) => maps.some((m) => m.has(id));
  if (!has(base)) return base;
  for (let n = 2; ; n++) if (!has(`${base}-${n}`)) return `${base}-${n}`;
}

/**
 * Move a point, asking first if that would change somebody else's racing.
 *
 * THE INVARIANT: from the Courses tab you can never change the geometry of a course you are
 * not in, and you can never do it by accident. Widening the scope beyond the open variant
 * always takes an explicit answer to an explicit question.
 *
 * Four cases, and they are the whole of the interaction:
 *
 *   nothing else uses it (ad-hoc)    it moves, no question, no notice
 *   only this variant                it moves — named, but nobody else is holding it
 *   sibling variants of this course   move for all / make ad-hoc here / cancel
 *   another course                    make ad-hoc here / promote a shared mark / cancel
 */
async function movePoint(pointId, to) {
  const variant = currentVariant();
  const course = currentCourse();

  // Not on the Courses tab, or the point is this variant's own: the club's list is the
  // scope, or nobody else is holding it. Either way it just moves.
  if (!variant || variant.points.has(pointId)) {
    Object.assign(GEO.points.get(pointId), to);
    return;
  }

  const users = affectedBy('point', pointId);
  const mine = users.some((u) => u.course === course.id && u.variant === variant.id);
  if (!mine) {
    // This mark is not on the open course, so moving it here could only be a club-wide
    // edit — which is what the Lines tab is for. Refusing is the invariant, not pedantry.
    await ask('Not on this course',
      `<b>${esc(pointId)}</b> is not used by ${esc(course.id)}/${esc(variant.id)}. `
      + 'Move it from the Points or Lines tab, where the scope is the club\'s geometry.',
      []);
    return;
  }

  const others = users.filter((u) => !(u.course === course.id && u.variant === variant.id));
  if (!others.length) {
    Object.assign(state.points.get(pointId), to);
    return;
  }

  const siblingsOnly = others.every((u) => u.course === course.id);
  const who = others.map((u) => `${u.course}/${u.variant}`).join(', ');
  const choices = [];
  if (siblingsOnly) {
    choices.push({ key: 'all', label: `Move it for all ${others.length + 1} variants`, primary: true });
  } else if (course.variants.size > 1) {
    // A mark wanted by this course's variants but not by the rest of the club is a real
    // thing that deserves a name, and the TOOL supplies one — a namespace held together by
    // human naming discipline lasts about a season.
    choices.push({ key: 'named', label: `New shared mark for ${course.id}` });
  }
  choices.push({ key: 'adhoc', label: 'Make it ad-hoc for this variant', primary: !siblingsOnly });
  if (!siblingsOnly) {
    // The invariant says you cannot change another course's geometry FROM HERE. It does not
    // say the change is forbidden — the Points tab is where the club's marks are edited, on
    // purpose. Naming that turns a dead end into a signpost. It does NOT carry the drag
    // over: a club-wide move is made deliberately, on the tab whose scope is the club.
    choices.push({ key: 'tab', label: 'Move it for every course — take me to the Points tab' });
  }

  const answer = await ask(`${pointId} is shared`,
    `Also used by <b>${esc(who)}</b>.`
    + (siblingsOnly ? ' All of them are variants of this course.' : '')
    + (siblingsOnly ? '' : ' This tab edits one course, so moving it for the others is not '
      + 'something it can do &mdash; the Points tab is where the club\'s marks are edited.'),
    choices);

  if (answer === 'tab') {
    showTab('points');
    select(pointId);
    state.formFor = undefined;
    render();
    note(`${pointId} is the club's — moving it here moves it for every course that uses it`);
    return;
  }
  if (answer === 'all') {
    Object.assign(state.points.get(pointId), to);
  } else if (answer === 'adhoc') {
    const id = detachPoint(pointId, [{ course: course.id, variant: variant.id }],
      { points: variant.points, lines: variant.lines }, '');
    Object.assign(variant.points.get(id), to);
  } else if (answer === 'named') {
    const targets = [...course.variants.keys()].map((v) => ({ course: course.id, variant: v }));
    const id = detachPoint(pointId, targets,
      { points: state.points, lines: state.lines }, `${course.id}/`);
    Object.assign(state.points.get(id), to);
  }
  state.courseFormFor = undefined;
}

/**
 * Move an inline end, or a whole line loose at both ends, asking first if it is shared.
 *
 * The same rule a shared point gets, one level up. A line is the club's unless this variant
 * has already taken its own copy, so dragging one from the Courses tab can reach every
 * course that names it — which is exactly what the invariant forbids doing by accident.
 *
 * `side` names the end to move, or null to move both.
 */
async function moveLine(lineId, side, to) {
  const variant = currentVariant();
  const course = currentCourse();
  const apply = (line) => {
    if (side) Object.assign(line[side], to);
    else for (const s of ['port', 'starboard']) Object.assign(line[s], to[s]);
  };

  // Not on the Courses tab, or the line is this variant's own: nobody else is holding it.
  if (!variant || variant.lines.has(lineId)) {
    apply(GEO.lines.get(lineId));
    return;
  }

  const users = affectedBy('line', lineId);
  const mine = users.some((u) => u.course === course.id && u.variant === variant.id);
  if (!mine) {
    await ask('Not on this course',
      `<b>${esc(lineId)}</b> is not used by ${esc(course.id)}/${esc(variant.id)}. `
      + 'Move it from the Lines tab, where the scope is the club\'s geometry.', []);
    return;
  }
  const others = users.filter((u) => !(u.course === course.id && u.variant === variant.id));
  if (!others.length) {
    apply(state.lines.get(lineId));
    return;
  }

  const siblingsOnly = others.every((u) => u.course === course.id);
  const who = others.map((u) => `${u.course}/${u.variant}`).join(', ');
  const choices = [];
  if (siblingsOnly)
    choices.push({ key: 'all', label: `Move it for all ${others.length + 1} variants`, primary: true });
  choices.push({ key: 'adhoc', label: 'Make it ad-hoc for this variant', primary: !siblingsOnly });
  if (!siblingsOnly)
    choices.push({ key: 'tab', label: 'Move it for every course — take me to the Lines tab' });

  const answer = await ask(`${lineId} is shared`,
    `Also used by <b>${esc(who)}</b>.`
    + (siblingsOnly ? ' All of them are variants of this course.'
      : ' This tab edits one course, so moving it for the others is not something it can do '
        + '&mdash; the Lines tab is where the club\'s lines are edited.'),
    choices);

  if (answer === 'tab') {
    showTab('lines');
    state.selectedLine = lineId;
    state.lineFormFor = undefined;
    render();
    note(`${lineId} is the club's — moving it here moves it for every course that uses it`);
    return;
  }
  if (answer === 'all') {
    apply(state.lines.get(lineId));
  } else if (answer === 'adhoc') {
    apply(variant.lines.get(detachLine(lineId, variant)));
  }
  state.courseFormFor = undefined;
}

/**
 * Copy a club line into one variant, and point that variant's steps at the copy.
 *
 * Simpler than detaching a point, because a line is named by the sequence directly: there
 * is no second level of reference to follow. Its ENDS come across as they are — a named end
 * stays named, so the copy still moves when the club moves that mark, which is right: only
 * the thing that was actually detached is detached.
 */
function detachLine(lineId, variant) {
  const club = state.lines.get(lineId);
  const copyId = freeAcross(lineId, state.lines, variant.lines);
  variant.lines.set(copyId, {
    ...club, id: copyId,
    port: { ...club.port }, starboard: { ...club.starboard },
  });
  for (const step of variant.sequence) {
    for (const alternative of alts(step)) {
      if (alternative.line === lineId) alternative.line = copyId;
    }
  }
  return copyId;
}

/**
 * Copy a point out of the club's list, and repoint the named variants at the copy.
 *
 * The subtle part, and it was a deliberate correction: <b>only the end that names this point
 * moves</b>. A line's two ends are independent — one may be a surveyed feature the whole
 * club knows and the other a handle dropped this morning — so detaching one end leaves the
 * other still pointing at the club's point. Forcing them to share a fate would either
 * promote the handle to a name nobody wants or detach the feature everybody relies on.
 *
 * `into` is where the copies go: a variant's own maps for an ad-hoc detach, the club's for a
 * promoted shared mark. One function, because the two differ only in that and in the name.
 */
function detachPoint(pointId, targets, into, prefix) {
  const source = state.points.get(pointId);
  const newPointId = freeAcross(prefix + pointId, state.points, into.points);
  into.points.set(newPointId, { ...source, id: newPointId });

  // One copy per club line, shared across the targets, so two variants that used the same
  // line still share it afterwards.
  const copies = new Map();
  for (const target of targets) {
    const v = state.courses.get(target.course)?.variants.get(target.variant);
    if (!v) continue;
    for (const step of v.sequence) {
      for (const alternative of alts(step)) {
        if (!alternative.line) continue;
        // A line this variant already owns is repointed in place: it is already ad-hoc, so
        // there is nothing to detach it from.
        const own = v.lines.get(alternative.line);
        if (own) {
          for (const side of ['port', 'starboard']) {
            if (own[side]?.at === pointId) own[side] = { ...own[side], at: newPointId };
          }
          continue;
        }
        const club = state.lines.get(alternative.line);
        if (!club || (club.port?.at !== pointId && club.starboard?.at !== pointId)) continue;
        let copyId = copies.get(alternative.line);
        if (!copyId) {
          copyId = freeAcross(prefix + alternative.line, state.lines, into.lines);
          const copy = {
            ...club, id: copyId,
            port: { ...club.port }, starboard: { ...club.starboard },
          };
          for (const side of ['port', 'starboard']) {
            if (copy[side]?.at === pointId) copy[side] = { ...copy[side], at: newPointId };
          }
          into.lines.set(copyId, copy);
          copies.set(alternative.line, copyId);
        }
        alternative.line = copyId;
      }
    }
  }
  return newPointId;
}

/**
 * A question with named answers, as a promise.
 *
 * A modal rather than an undo-able action, because the choice changes what the edit MEANS
 * and cannot be inferred afterwards: a point that ended up in two places could have got
 * there by detaching or by moving, and the file would not say which was intended.
 */
function ask(title, body, choices) {
  return new Promise((resolve) => {
    el('askTitle').textContent = title;
    el('askBody').innerHTML = body;
    el('askChoices').innerHTML = choices
      .map((c) => `<button data-key="${esc(c.key)}"${c.primary ? ' class="on"' : ''}>${esc(c.label)}</button>`)
      .join('') + '<button data-key="">Cancel</button>';
    el('askback').style.display = 'flex';
    for (const button of el('askChoices').querySelectorAll('button')) {
      button.addEventListener('click', () => {
        el('askback').style.display = 'none';
        resolve(button.dataset.key || null);
      });
    }
  });
}

/* ---------------------------------------------------------------- rendering */

/**
 * Drag handles, collected while the lines are drawn and emitted LAST.
 *
 * Everything else on the chart draws over the lines — the next line in the loop, the
 * course's legs and triangles, the points, the bearings. A handle buried under any of that
 * is one you cannot hit, so they are held back and put on top.
 */
let HANDLES = '';

/** Lines the loaded programme defines, drawn from whichever ends are placed. */
function renderLines() {
  const used = inUse();
  HANDLES = '';
  let out = '';
  for (const [id, line] of GEO.lines) {
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
    //
    // An INLINE end is draggable, because it belongs to this line and nothing else — there
    // is no point on the chart standing for it, so without a handle here the only way to
    // move one would be to type coordinates. A NAMED end is not: the point is already
    // draggable in its own right, and two handles on one place would be two ways to do one
    // thing.
    // A grip is HELD BACK and drawn last — see HANDLES. Left in place it would be painted
    // over by the next line in the loop, and by the course, the points and the bearings
    // that all draw after this. A handle you cannot hit is not a handle.
    const grip = (x, y, side, markup) => {
      if (line[side]?.at || state.tab === 'points' || readOnly()) return markup;
      HANDLES += `<g class="lend" data-id="${esc(id)}:${side}" data-line="${esc(id)}" data-side="${side}" style="cursor:grab">`
        + `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" fill="transparent"/>`
        + markup + '</g>';
      return '';
    };
    out += grip(ax, ay, 'port', endMarker(ax, ay, -ux, -uy, line.port?.infinite));
    out += grip(bx, by, 'starboard', endMarker(bx, by, ux, uy, line.starboard?.infinite));

    // The midpoint is where the legs either side are measured to, so it is drawn: it is
    // the thing an infinite end's point is a handle for.
    const midX = (ax + bx) / 2;
    const midY = (ay + by) / 2;
    // And when BOTH ends are inline the whole line belongs to nothing else, so the midpoint
    // moves it bodily. With a named end there is no such freedom: dragging the line would
    // have to drag a point somebody else's line is holding.
    const loose = !line.port?.at && !line.starboard?.at && state.tab !== 'points' && !readOnly();
    if (loose) {
      // Twice the size of the plain midpoint dot, because this one is a target rather than
      // a marker: it sits in the middle of the course, among the legs and the triangles,
      // and it is what a whole line is dragged by.
      HANDLES += `<g class="lmid" data-id="${esc(id)}" data-line="${esc(id)}" style="cursor:grab">`
        + `<circle cx="${midX.toFixed(1)}" cy="${midY.toFixed(1)}" r="20" fill="transparent"/>`
        + `<circle cx="${midX.toFixed(1)}" cy="${midY.toFixed(1)}" r="6" fill="var(--sea)" fill-opacity="0.6" stroke="var(--toside)" stroke-width="2"/>`
        + `</g>`;
    } else {
      out += `<circle cx="${midX.toFixed(1)}" cy="${midY.toFixed(1)}" r="3" fill="none" stroke="var(--toside)" stroke-width="1.5"/>`;
    }
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
  const named = GEO.points.get(end.at);
  return named && named.latitude != null ? named : null;
}

/**
 * Every crossing of the selected course, seated along its line and turned the right way.
 *
 * Grouped by line first, because a line can carry several crossings and they have to be
 * spread along it rather than drawn on top of one another — the leeward line of a
 * windward/leeward is the start, mark 2 and the finish.
 */
function courseCrossings(variant) {
  const byLine = new Map();
  const steps = (variant.sequence ?? []).map((step, index) => ({
    index,
    letter: variantLetter(variant, index),
    entry: !!(variant.closed && step.entry),
    alternatives: alts(step).filter((a) => a.line),
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
    const line = GEO.lines.get(lineId);
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
  const variant = state.hideUnused ? currentVariant() : null;
  if (!variant) return null;
  const lines = new Set();
  const points = new Set();
  for (const step of variant.sequence ?? []) {
    for (const alternative of alts(step)) {
      if (!alternative.line) continue;
      lines.add(alternative.line);
      const line = GEO.lines.get(alternative.line);
      for (const end of [line?.port, line?.starboard]) {
        if (end?.at) points.add(end.at);
      }
    }
  }
  return { lines, points };
}

/** S, then the ordinals, then F — derived from position, never stored. */
function variantLetter(variant, index) {
  // A CLOSED course has neither a start nor a finish of its own: a boat begins and ends
  // wherever it joined, so calling one step S and another F would claim something untrue
  // about the course. Every step is numbered, and which may be joined at is ringed on the
  // chart instead.
  // From ZERO, so a cycle's numbering lines up with an open course's rather than running one
  // ahead of it — the leg into step 1 is leg 1 either way. Must agree with
  // CourseVariant.sequenceLetter, which is the same rule written twice.
  if (variant.closed) return String(index);
  if (index === 0) return 'S';
  if (index === (variant.sequence ?? []).length - 1) return 'F';
  return String(index);
}

function renderCourse() {
  const variant = currentVariant();
  if (!variant) return '';
  const { steps, drawn } = courseCrossings(variant);
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
  const starts = usable.map((step, i) => (variant.closed ? step.entry : i === 0));
  const finishes = usable.map((step, i) => (variant.closed ? step.entry : i === usable.length - 1));

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

  // The track stands down while bearings are up: two sets of lines over the same water,
  // one of them the number somebody is turning to, is one set too many.
  if (state.showTrack && !bearingDrag()) {
    const segments = track(ordered, { closed: variant.closed });
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

/**
 * The box round the course, with a grip to move it and a grip to turn it.
 *
 * Placed on the OUTER LIMITS rather than in the middle, because the middle of a course is
 * where the course is: a grip there would sit on top of the marks and legs it was meant to
 * be moving. Move at the foot, turn at the head, both clear of the drawing.
 */
function renderTransform() {
  const variant = transformShown() ? currentVariant() : null;
  if (!variant) return '';
  const parts = movables(variant);
  if (parts.length < 2) return '';

  const px = parts.map((m) => state.view.toPx(m.obj));
  const pad = 26;
  const x0 = Math.min(...px.map((p) => p[0])) - pad;
  const x1 = Math.max(...px.map((p) => p[0])) + pad;
  const y0 = Math.min(...px.map((p) => p[1])) - pad;
  const y1 = Math.max(...px.map((p) => p[1])) + pad;
  const cx = (x0 + x1) / 2;

  const r = 13;
  const box = `<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${(x1 - x0).toFixed(1)}"`
    + ` height="${(y1 - y0).toFixed(1)}" fill="none" stroke="var(--toside)" stroke-width="1"`
    + ` stroke-dasharray="5 5" opacity="0.7"/>`;

  // The turn grip sits on a short stalk above the box, the way every drawing tool puts it,
  // so it is never confused with the corner of the box itself.
  const ty = y0 - 18;
  const stalk = `<line x1="${cx.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${cx.toFixed(1)}"`
    + ` y2="${(ty + r).toFixed(1)}" stroke="var(--toside)" stroke-width="1" opacity="0.7"/>`;

  return box + stalk
    + grip('tmove', cx, y1 + 18, r, moveGlyph(cx, y1 + 18, 6), 'drag to move the whole course')
    + grip('trotate', cx, ty, r, turnGlyph(cx, ty, 6), 'drag to turn the whole course');
}

function grip(kind, x, y, r, glyph, title) {
  return `<g class="tgrip" data-id="${kind}" data-kind="${kind}" style="cursor:grab">`
    + `<title>${esc(title)}</title>`
    + `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="var(--sea)"`
    + ` fill-opacity="0.92" stroke="var(--toside)" stroke-width="1.5"/>`
    + glyph + '</g>';
}

/** Four arrows from one centre: the universal "this moves" mark. */
function moveGlyph(x, y, s) {
  const line = (x1, y1, x2, y2) =>
    `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="var(--toside)" stroke-width="1.3"/>`;
  const head = (hx, hy, angle) =>
    `<polygon points="${arrowHead({ x: hx, y: hy }, angle, 5)}" fill="var(--toside)"/>`;
  return line(x - s, y, x + s, y) + line(x, y - s, x, y + s)
    + head(x + s, y, 0) + head(x - s, y, 180) + head(x, y + s, 90) + head(x, y - s, 270);
}

/** An arc over the top with an arrowhead: the universal "this turns" mark. */
function turnGlyph(x, y, s) {
  return `<path d="M ${(x - s).toFixed(1)} ${y.toFixed(1)} A ${s} ${s} 0 1 1 ${(x + s).toFixed(1)} ${y.toFixed(1)}"`
    + ` fill="none" stroke="var(--toside)" stroke-width="1.3"/>`
    + `<polygon points="${arrowHead({ x: x + s, y: y + 2 }, 90, 5)}" fill="var(--toside)"/>`;
}

/**
 * Where a step counts as being: the midpoint of its line's two defined points, and for a
 * gate the mean of its alternatives' midpoints.
 *
 * The same rule the server measures legs by, because a heading drawn to one place and a
 * length measured to another would be two answers to one question.
 */
function stepMid(step) {
  const mids = [];
  for (const alternative of alts(step)) {
    const line = GEO.lines.get(alternative.line);
    const port = endPosition(line?.port);
    const starboard = endPosition(line?.starboard);
    if (!port || !starboard) return null;
    mids.push({
      latitude: (port.latitude + starboard.latitude) / 2,
      longitude: (port.longitude + starboard.longitude) / 2,
    });
  }
  if (!mids.length) return null;
  return {
    latitude: mids.reduce((t, m) => t + m.latitude, 0) / mids.length,
    longitude: mids.reduce((t, m) => t + m.longitude, 0) / mids.length,
  };
}

/**
 * Which legs' headings to show, while something is being dragged.
 *
 * A whole-course MOVE changes no heading, so it shows none — the course arrives at the same
 * angles it left at. A TURN changes all of them, which is the number somebody is turning
 * TO, so it shows the lot. Dragging one line changes only the legs that touch it.
 *
 * Returns null when nothing should be shown.
 */
function bearingDrag() {
  const drag = state.dragging;
  if (!drag || !currentVariant()) return null;
  if (drag.kind === 'courseturn') return { all: true };
  if (drag.kind === 'line' || drag.kind === 'end') return { line: drag.id };
  return null;
}

/**
 * The heading, and its reciprocal, of every leg in play.
 *
 * <b>The track is hidden while these show.</b> A course under the pointer already carries
 * its legs, its arrows and its letters; laying bearings over the top of all that would make
 * the one number somebody is turning to the hardest thing on the chart to read.
 */
function renderBearings() {
  const which = bearingDrag();
  const variant = which && currentVariant();
  if (!variant) return '';

  const steps = variant.sequence ?? [];
  const legs = [];
  for (let i = 0; i < steps.length - 1; i++) legs.push([steps[i], steps[i + 1]]);
  // A cycle's last leg runs back to its first mark, and it is a leg like any other.
  if (variant.closed && steps.length > 2) legs.push([steps[steps.length - 1], steps[0]]);

  let out = '';
  for (const [from, to] of legs) {
    if (which.line && !alts(from).concat(alts(to)).some((a) => a.line === which.line)) continue;
    const a = stepMid(from);
    const b = stepMid(to);
    if (!a || !b || distanceM(a, b) < 1) continue;
    const [ax, ay] = state.view.toPx(a);
    const [bx, by] = state.view.toPx(b);
    const heading = bearingDeg(a, b);
    const back = (heading + 180) % 360;
    const deg = (v) => v.toFixed(0).padStart(3, '0');
    out += `<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}"`
      + ` stroke="var(--toside)" stroke-width="1.4" stroke-dasharray="7 3" opacity="0.95"/>`;
    // At the middle of the leg, where it belongs to both marks equally. Big, because it is
    // the number being steered by while the hand is still on the grip — read at a glance,
    // from across a desk, not squinted at. Stacked rather than run together: the headings
    // are what the turn is for, the length is what it cost.
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const size = 22;
    out += `<rect x="${(mx - 70).toFixed(1)}" y="${(my - 26).toFixed(1)}" width="140" height="52" rx="5"`
      + ` fill="var(--sea)" fill-opacity="0.88" stroke="var(--toside)" stroke-width="1" stroke-opacity="0.4"/>`;
    out += `<text x="${mx.toFixed(1)}" y="${(my - 3).toFixed(1)}" text-anchor="middle"`
      + ` font-family="var(--mono)" font-size="${size}" fill="var(--toside)">`
      + `${deg(heading)}&deg;/${deg(back)}&deg;</text>`;
    out += `<text x="${mx.toFixed(1)}" y="${(my + 20).toFixed(1)}" text-anchor="middle"`
      + ` font-family="var(--mono)" font-size="${size}" fill="var(--toside)">`
      + `${(distanceM(a, b) / 1852).toFixed(1)} nm</text>`;
  }
  return out;
}

function renderPoints() {
  const used = inUse();
  let out = '';
  for (const point of GEO.points.values()) {
    if (point.latitude == null) continue;
    if (used && !used.points.has(point.id)) continue;
    const [x, y] = state.view.toPx(point);
    const on = point.id === state.selected;
    // An ad-hoc point is drawn HOLLOW. It looks different because it behaves differently:
    // dragging it asks nobody, because by construction nobody else is holding it. A shared
    // mark and a handle dropped this morning should not look like the same kind of thing.
    const adhoc = isAdhoc('point', point.id);
    out += `<g class="pt" data-id="${esc(point.id)}" style="cursor:grab">`;
    out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" fill="transparent"/>`;
    out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${on ? 7 : 5}" fill="${adhoc ? 'var(--sea)' : (on ? 'var(--ok)' : 'var(--ink)')}" stroke="${adhoc ? (on ? 'var(--ok)' : 'var(--toside)') : 'var(--sea)'}" stroke-width="2"/>`;
    out += `<text x="${(x + 10).toFixed(1)}" y="${(y + 4).toFixed(1)}" font-family="var(--mono)" font-size="11" fill="${on ? 'var(--ok)' : 'var(--ink)'}" style="paint-order:stroke;stroke:var(--sea);stroke-width:3px">${esc(point.id)}</text>`;
    out += `</g>`;
  }
  return out;
}

function render() {
  // The scope of what is drawn follows the tab and the open variant, so it is settled
  // before anything is drawn rather than asked for again by each drawing function.
  refreshGeo();
  const svg = el('map');
  // The cursor says what the chart will do: an arrow over open water, a hand over a
  // handle (set on the handle itself), a closed hand while something is moving, and a
  // crosshair while a click is armed to place something.
  svg.classList.toggle('dragging', !!state.dragging);
  svg.classList.toggle('picking', !state.dragging && placingArmed());
  const box = svg.getBoundingClientRect();
  if (box.width > 20 && box.height > 20) {
    state.view.width = Math.round(box.width);
    state.view.height = Math.round(box.height);
    svg.setAttribute('viewBox', `0 0 ${state.view.width} ${state.view.height}`);
  }
  // renderLines() fills HANDLES as it goes, so it has to run before HANDLES is read —
  // named rather than inlined, so that order is a statement and not an accident of how a
  // template literal is evaluated.
  const lines = renderLines();
  svg.innerHTML =
    state.view.tileLayer(state.basemap) +
    lines +
    renderCourse() +
    renderBearings() +
    renderPoints() +
    renderTransform() +
    HANDLES +
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
      if (readOnly()) return;
      ev.stopPropagation();
      beginEdit();
      // Selected only on its own tab; elsewhere the drag happens and nothing is left
      // holding the chart's next click.
      if (state.tab === 'points') select(g.dataset.id);
      // Where it started, so a move that turns out to need consent can be put back while
      // the question is asked — and put back for good if the answer is no.
      const from = GEO.points.get(g.dataset.id);
      state.dragging = {
        kind: 'point',
        id: g.dataset.id,
        from: { latitude: from?.latitude, longitude: from?.longitude },
      };
      render();
    });
  }

  // An inline end, and a line loose at both ends. Same three phases as a point — grab,
  // follow, then ask if the answer would reach somebody else's course.
  for (const g of svg.querySelectorAll('.lend')) {
    g.addEventListener('mousedown', (ev) => {
      if (state.tab === 'lines' && state.picking) return;
      ev.stopPropagation();
      beginEdit();
      const line = GEO.lines.get(g.dataset.line);
      const end = line?.[g.dataset.side];
      state.dragging = {
        kind: 'end',
        id: g.dataset.line,
        side: g.dataset.side,
        from: { latitude: end?.latitude, longitude: end?.longitude },
      };
      render();
    });
  }
  for (const g of svg.querySelectorAll('.tgrip')) {
    g.addEventListener('mousedown', (ev) => {
      ev.stopPropagation();
      const variant = currentVariant();
      if (!variant) return;
      beginEdit();
      const parts = movables(variant);
      state.dragging = {
        kind: g.dataset.kind === 'tmove' ? 'coursemove' : 'courseturn',
        parts,
        centre: centre(parts.map((m) => m.from)),
        grab: null,
        amount: 0,
      };
      render();
    });
  }
  for (const g of svg.querySelectorAll('.lmid')) {
    g.addEventListener('mousedown', (ev) => {
      if (state.tab === 'lines' && state.picking) return;
      ev.stopPropagation();
      beginEdit();
      const line = GEO.lines.get(g.dataset.line);
      state.dragging = {
        kind: 'line',
        id: g.dataset.line,
        from: {
          port: { latitude: line?.port?.latitude, longitude: line?.port?.longitude },
          starboard: { latitude: line?.starboard?.latitude, longitude: line?.starboard?.longitude },
        },
        // Where the pointer took hold, so the line moves BY the drag rather than centring
        // itself on the cursor.
        grab: null,
      };
      render();
    });
  }
  renderList();
  // ONE level's fields, never two concatenated: the form follows whichever level you are
  // pointing at, which is the level whose list is open, or else the deepest one chosen.
  // The bottom of the pane is the deepest thing: a point, a line, or a variant. The series
  // and course fields live under their own lists.
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
  refreshGeo();
  // Both forms are rebuilt from scratch on a tab change, since the pane they live in is
  // the same element.
  state.formFor = undefined;
  state.lineFormFor = undefined;
  for (const button of document.querySelectorAll('[data-tab]')) {
    button.classList.toggle('on', button.dataset.tab === tab);
  }
  // The tab is a level of the hierarchy, so switching it drops whatever was pinned open
  // below: the levels under Points are not the levels under Courses.
  state.open = {};
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
  snapshots: '<b>A snapshot</b> is an immutable, fully inlined capture of this variant, '
    + 'named <b>course/variant/datetime</b> by the tool and identified by a content hash '
    + 'over its geometry. <b>Publishing</b> is a separate step: it chooses which snapshot '
    + 'boats are given, and replaces the previous one. Editing a shared mark can never '
    + 'change a snapshot, so nothing a boat already holds can move under it.',
  courses: '<b>Courses</b> are an ordered sequence of crossings over the lines. The first '
    + 'step is the start and the last is the finish, so the letters S, 1, 2 &hellip; F are '
    + 'derived from position rather than stored. A <b>gate</b> is a choice within one '
    + 'step: the track splits at the gate and rejoins well down the next leg, because '
    + 'boats that took different sides sail their own line and converge near the mark '
    + 'ahead. A course holds one or more <b>variants</b> &mdash; Div 1, the short course '
    + '&mdash; and this tab edits exactly one of them: moving a mark shared with another '
    + 'course asks first. A variant marked <b>template</b> can be edited but never '
    + 'snapshotted, so no boat can ever be given it; clone it to race it.',
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
  if (readOnly()) return false;
  // Only the points tab places points. A point stays draggable on the other tabs — that
  // is useful while laying out a line or a course — but dragging it must not leave it
  // SELECTED, or every later click on the chart teleports it. Selection belongs to the
  // tab that edits the thing.
  if (state.tab === 'points') return state.selected != null && state.points.has(state.selected);
  if (state.tab === 'lines') return state.picking != null;
  return false;
}

/**
 * The existing point a click landed on, or null for open water.
 *
 * Snapping to an existing point matters more than it sounds. Two lines that share a mark
 * — both Sow and Pigs lines do — must share the POINT, not merely sit at the same
 * coordinates, or a later correction moves one line and leaves the other behind.
 *
 * <b>Open water gets no point.</b> It used to manufacture one (`line-2-port`, and so on),
 * which filled the club's list with names nobody had chosen and nobody referred to. Naming
 * is identity, not sharing: a handle dropped on the water is not a thing anyone names, so
 * the end takes an INLINE position instead — the same distinction the course model draws
 * between named and ad-hoc geometry, one level down.
 */
function pointNear(px, py) {
  const NEAR_PX = 14;
  let best = null;
  let bestDistance = NEAR_PX;
  for (const point of GEO.points.values()) {
    if (point.latitude == null) continue;
    const [x, y] = state.view.toPx(point);
    const distance = Math.hypot(x - px, y - py);
    if (distance <= bestDistance) { best = point; bestDistance = distance; }
  }
  return best ? best.id : null;
}

function freeId(map, base) {
  base = slug(base) || 'x';
  if (!map.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!map.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}

/**
 * What a variant made from a template is called: {@code yyyymmdd-race-n}.
 *
 * A template is a shape; what comes out of one is a race, on a day, and usually not the only
 * race that day. Naming it after the template ("two-laps", "two-laps-2") said what it was
 * made from rather than what it IS, and a season of them sorted into one indistinguishable
 * run. Dated first, so the list reads chronologically under the templates that sit above it.
 *
 * The LOCAL date, because a race day is a local day. `n` counts from 1 within this course,
 * so the numbering is the day's race numbering rather than a uniqueness suffix.
 */
function raceId(variants) {
  const now = new Date();
  const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
    + String(now.getDate()).padStart(2, '0');
  for (let n = 1; ; n++) {
    if (!variants.has(`${day}-race-${n}`)) return `${day}-race-${n}`;
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
    delete state.endMode[`${id}:port`];
    delete state.endMode[`${id}:starboard`];
    // A line with no ends is not a line, and the next thing anybody does is place them. So
    // the chart is armed for the starboard end immediately, and chains to port when that
    // one lands — a new line is two clicks and nothing else.
    state.picking = 'starboard';
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

/** The variants whose sequence names this line, gate alternatives included. */
function coursesUsing(lineId) {
  return affectedBy('line', lineId).map((u) => `${u.course}/${u.variant}`);
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
  } else if (state.tab === 'lines') {
    const id = state.selectedLine;
    if (!id || !state.lines.has(id)) return;
    const held = coursesUsing(id);
    if (held.length) {
      warnInForm('l_span', `still used by ${held.join(', ')} — take those steps off it first`);
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

/* ------------------------------------------------------------- the rows */

/**
 * One level of the hierarchy, collapsed to a line, with its own commands.
 *
 * The whole command area is these rows: every button that acts on a level lives on that
 * level's row, at the top, and the form below holds fields only. Before this, Add and
 * Delete for a course were at the top while Snapshot, Publish and Delete variant were at
 * the bottom, with a scrolling sequence editor between them — two conventions in one pane,
 * and half the commands below the fold.
 */
function crumb(level, label, chip, commands, empty) {
  const open = isOpen(level);
  // OPEN: the row names the level, not the selection — the selected item is right below it
  // in the list, highlighted, and saying it twice made the row look like a second entry.
  // CLOSED: the row IS the selection, with its state chip, so a dirty course stays visible
  // from the top of the pane.
  return `<div class="crumb" data-level="${level}">
    <button class="pick" id="crumb_${level}">
      <span class="chev">${open ? '&#9662;' : '&#9656;'}</span>
      <span class="${open || !label ? 'none' : 'mono'}">${esc(open ? level : (label ?? empty ?? '—'))}</span>
      ${open ? '' : (chip ?? '')}
    </button>
    <span class="cmds">${commands.map(([id, glyph, title]) =>
      `<button class="cmd" id="cmd_${id}" title="${esc(title)}">${glyph}</button>`).join('')}</span>
  </div>`;
}

/**
 * Whether a level's list is showing.
 *
 * Two sources, in order: an explicit answer from the chevron, then the default — a level is
 * open while it has nothing chosen, which is what gets you started without anybody managing
 * it. Selecting from a list <b>pins it open</b> rather than collapsing it, because the next
 * thing somebody does is very often choose again, and a list that shut itself the instant
 * it was used made that two clicks.
 */
function isOpen(level) {
  if (state.open[level] !== undefined) return state.open[level];
  if (level === 'series') return !state.key;
  if (level === 'items') return state.tab !== 'courses';
  // Not a level of the drill-down — a field group inside the variant's form — but it folds
  // the same way and by the same rule, so there is one mechanism rather than two. Open by
  // default: the sequence IS the course, and hiding it by default would hide the point.
  if (level === 'sequence') return true;
  if (state.tab !== 'courses') return false;
  if (level === 'course') return !state.selectedCourse;
  if (level === 'variant') return !!state.selectedCourse && !state.selectedVariant;
  // Open while nothing is chosen, like every other level: the list is how you find one,
  // and once you have, the breadcrumb says which and the capture takes the space.
  if (level === 'snapshot')
    return !!state.selectedVariant && !state.selectedSnapshot
      && (lifeOf(state.selectedCourse, state.selectedVariant).snapshots ?? []).length > 0;
  return false;
}

/** Toggle a level's list, without disturbing any other level or any selection. */
function toggle(level) {
  state.open[level] = !isOpen(level);
  render();
}

/**
 * The open list, as markup, placed directly under the row that owns it.
 *
 * One slot at the bottom of all the rows was wrong in two visible ways: the series list
 * opened BELOW the tab strip it is choosing for, and the variant list opened below the
 * course it belongs to and above that course's own fields. A list belongs under its level.
 */
function listSlot(level) {
  // Its OWN container: several lists can be open at once now, so one shared slot would
  // have them overwrite each other.
  if (!isOpen(level)) return '';
  const height = state.listHeight[level];
  return `<div class="listSlot" id="list_${level}"${height ? ` style="height:${height}px"` : ''}></div>`;
}

/** Remember what a drag on the resize grip did, so the next render keeps it. */
function watchHeight(level) {
  const slot = el(`list_${level}`);
  if (!slot || typeof ResizeObserver === 'undefined') return;
  new ResizeObserver(() => { state.listHeight[level] = slot.offsetHeight; }).observe(slot);
}

function renderRows() {
  const course = currentCourse();
  const variant = currentVariant();

  // A level's FORM sits under its list, not at the bottom of the pane: the variant list
  // belongs below the course's fields, and both belong to the level whose chevron is open.
  // Closing the chevron hides the list and the fields together — there is one thing there,
  // not two.
  const top = crumb('series', state.key, '', [
    ['series_add', '+', 'new series'],
    ['series_clone', '&#10697;', 'clone this series'],
    ['series_delete', '&times;', 'delete this series'],
  ], 'no series') + listSlot('series')
    + (isOpen('series') ? '<div id="seriesForm"></div>' : '');
  // Assigned only when it CHANGED, because these containers hold form fields and rewriting
  // them on every pan would take the caret out of whatever somebody was typing in.
  if (state.rowsTop !== top) {
    el('rowSeries').innerHTML = top;
    state.rowsTop = top;
    state.seriesFormFor = undefined;
    // Wired HERE, beside the assignment that destroyed the old buttons. It used to be
    // wired with the rest below, under a guard that watches #rows — a different element —
    // so any render that rebuilt this row while #rows stayed put left the series chevron
    // and its commands dead. Each container re-wires its own.
    wireRow(['series']);
    // Wired HERE, beside the assignment that destroyed the old buttons. It used to be
    // wired with the rest below, under a guard that watches #rows — a different element —
    // so any render that rebuilt this row while #rows stayed put left the series chevron
    // and its commands dead. Each container re-wires its own.
  }

  let out = '';
  if (state.tab === 'courses') {
    out += crumb('course', state.selectedCourse,
      state.selectedCourse ? dirtyDot(course) : '', [
        ['course_add', '+', 'new course'],
        ['course_clone', '&#10697;', 'clone this course, with all its variants'],
        ['course_delete', '&times;', 'delete this course'],
      ], 'no course') + listSlot('course')
      + (isOpen('course') ? '<div id="courseForm"></div>' : '');
    if (course) {
      out += crumb('variant', state.selectedVariant,
        state.selectedVariant ? chip(course.id, state.selectedVariant) : '', [
          ['variant_add', '+', 'new variant'],
          ['variant_clone', '&#10697;', 'clone this variant'],
          ['variant_template', '&#9873;', 'add a variant from a template'],
          ['variant_delete', '&times;', 'delete this variant'],
        ], 'no variant') + listSlot('variant');
    }
    if (state.selectedVariant) {
      const life = lifeOf(course.id, state.selectedVariant);
      const design = course.variants.get(state.selectedVariant);
      out += `<div class="lifecycle">
        <button id="cmd_snapshot"${design?.template ? ' disabled title="a template can never be snapshotted"' : ''}>Snapshot</button>
        <span class="info" id="lifeInfo" data-info="${esc(INFO.snapshots)}">?</span>
      </div>`;
      // The fourth level. A snapshot is not a draft — it is what a boat was handed — so its
      // commands are what you can do ABOUT one, never to it.
      if ((life.snapshots ?? []).length) {
        const chosen = currentSnapshotEntry();
        out += crumb('snapshot', state.selectedSnapshot ? (chosen?.label ?? state.selectedSnapshot) : null,
          state.selectedSnapshot === life.published
            ? '<span class="state current">published</span>' : '', [
            ['snapshot_clone', '&#10697;', 'create a new variant from this capture'],
            ['snapshot_publish', '&#8593;', 'publish this snapshot'],
            ['snapshot_delete', '&times;', 'delete this snapshot'],
            // The row is only emitted when there ARE snapshots, so the closed label says
            // that none is CHOSEN, not that none exists — "no snapshot" read as the latter.
          ], 'snapshots') + listSlot('snapshot');
      }
    }
  } else {
    // Points and lines are the CLUB's, so their row sits under the series and carries no
    // course above it — which is the tab rule made visible. No chevron here: this list has
    // no level below it to collapse into.
    out += `<div class="crumb">
      <span class="pick" style="cursor:default">
        <span class="mono">${state.tab === 'points' ? 'points' : 'lines'}</span>
        <span class="info" id="paneInfo">?</span>
      </span>
      <span class="cmds">
        <button class="cmd" id="cmd_item_add" title="new ${state.tab === 'points' ? 'point' : 'line'}">+</button>
        <button class="cmd" id="cmd_item_delete" title="delete the selected ${state.tab === 'points' ? 'point' : 'line'}">&times;</button>
      </span>
    </div>` + listSlot('items');
  }
  out += '<div id="rowMsg"></div>';
  if (state.rowsHtml === out) return;
  el('rows').innerHTML = out;
  state.rowsHtml = out;
  state.courseFieldsFor = undefined;
  wireRow(['course', 'variant', 'items']);
  if (el('paneInfo')) el('paneInfo').dataset.info = INFO[state.tab];
}

/**
 * Wire the chevrons and commands of the levels that were just rebuilt.
 *
 * Every handler resolves the course and variant AT CLICK TIME, never from the enclosing
 * render's closure. The markup is only re-assigned when it changes, so a handler that
 * captured them would go on acting on whatever was selected when the row was last built —
 * and selecting a different variant does not change the row's markup while its list is
 * open.
 */
function wireRow(levels) {
  for (const level of levels) {
    el(`crumb_${level}`)?.addEventListener('click', () => toggle(level));
    watchHeight(level);
  }
  if (levels.includes('variant')) {
    el('crumb_snapshot')?.addEventListener('click', () => toggle('snapshot'));
    watchHeight('snapshot');
  }
  const on = (id, fn) => el(id)?.addEventListener('click', fn);
  const withCourse = (fn) => () => { const c = currentCourse(); if (c) fn(c); };
  const withVariant = (fn) => () => {
    const c = currentCourse();
    const v = currentVariant();
    if (c && v) fn(c, v);
  };
  if (levels.includes('series')) {
    on('cmd_series_add', () => createSeries(null));
    on('cmd_series_clone', () => createSeries(state.key));
    on('cmd_series_delete', deleteSeries);
  }
  on('cmd_course_add', addCourse);
  on('cmd_course_clone', withCourse(cloneCourse));
  on('cmd_course_delete', deleteCourse);
  on('cmd_variant_add', withCourse((c) => addVariant(c, null)));
  on('cmd_variant_clone', withVariant((c, v) => cloneVariant(c, v, c)));
  on('cmd_variant_template', withCourse(addFromTemplate));
  on('cmd_variant_delete', deleteVariant);
  on('cmd_snapshot', withVariant(takeSnapshot));
  on('cmd_snapshot_clone', cloneSnapshot);
  on('cmd_snapshot_publish', publishSnapshot);
  on('cmd_snapshot_delete', forgetSnapshot);
  on('cmd_item_add', addThing);
  on('cmd_item_delete', deleteThing);
}

/** The one message line for everything the rows do. */
function note(message, bad = false) {
  const target = el('rowMsg');
  if (target) target.innerHTML = `<span class="${bad ? 'warn' : 'ok'}">${esc(message)}</span>`;
}

function renderList() {
  renderRows();
  if (isOpen('series')) renderSeriesForm();
  if (isOpen('course') && currentCourse()) renderCourseFields();
  // The tab is required to show the course length ALWAYS, so it is set from the selection
  // rather than by whichever list happens to be open — collapsing a list must not take the
  // figure off the screen with it.
  if (state.tab === 'courses' && state.selectedVariant) {
    el('status').innerHTML = `<span class="ok">${nm(state.selectedCourse, state.selectedVariant)}</span>`;
  }
  // Unconditionally, and after the forms: both of them return early on a guard, and several of
  // those early returns are before the point a form would have synced itself. One call here
  // means whatever is on screen agrees with the lifecycle after every render, whichever branch
  // got there.
  if (state.tab === 'courses') syncCourseForm();
  // Each open level fills its own slot. Slots are not emitted when closed, rather than
  // emitted and hidden, so no empty box is left behind.
  if (isOpen('series')) renderSeriesList();
  if (state.tab === 'courses') {
    if (isOpen('course')) renderCourseList();
    if (isOpen('variant') && state.selectedCourse) renderVariantList();
    if (isOpen('snapshot') && state.selectedVariant) renderSnapshotList();
  } else if (isOpen('items')) {
    if (state.tab === 'lines') renderLineList();
    else renderPointList();
  }
}

function renderLineList() {
  const into = el('list_items');
  if (!into) return;
  const lines = byId(state.lines.values());
  into.innerHTML = lines.length === 0
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

  for (const row of into.querySelectorAll('.row')) {
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
 * <b>Starboard is above port</b>, because that is the order a line gets drawn in: a forward
 * crossing leaves the starboard end to starboard, so placing that end first fixes which way
 * the line is crossed and the port end follows from it. Adding a line arms the starboard
 * pick straight away and chains to the port pick once starboard lands, so a new line is two
 * clicks on the chart and nothing else.
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
    <div class="idname">
      <div>
        <label class="label" for="l_id">Short name (id)</label>
        <input id="l_id" value="${esc(line.id)}" spellcheck="false">
      </div>
      <div>
        <label class="label" for="l_name">Long name</label>
        <input id="l_name" value="${esc(line.name ?? '')}">
      </div>
    </div>
    ${endFields('starboard', line.starboard, line)}
    ${endFields('port', line.port, line)}
    <div id="l_span" class="mono small muted"></div>
    <div id="l_used"></div>
    <label class="label" for="l_notes">Notes</label>
    <textarea id="l_notes" rows="3" spellcheck="false">${esc(line.notes ?? '')}</textarea>`;

  for (const field of ['l_id', 'l_name', 'l_notes']) el(field).addEventListener('focus', beginEdit);
  el('l_id').addEventListener('change', (ev) => renameLine(line.id, ev.target.value.trim()));
  el('l_id').addEventListener('blur', endEdit);
  el('l_name').addEventListener('input', (ev) => { line.name = ev.target.value; });
  el('l_name').addEventListener('blur', endEdit);
  el('l_notes').addEventListener('input', (ev) => { line.notes = ev.target.value; });
  el('l_notes').addEventListener('blur', endEdit);

  for (const side of ['port', 'starboard']) {
    el(`l_${side}_at`).addEventListener('change', (ev) => {
      const at = ev.target.value || null;
      // Choosing a point is how an inline end goes back to being a named one — the
      // selector is the reverse of the `inline` button, so neither shape is a trap.
      if (!at && endMode(line, side) === 'inline') { render(); return; }
      beginEdit();
      line[side] = { at, infinite: !!line[side]?.infinite };
      state.endMode[`${line.id}:${side}`] = at ? 'named' : 'inline';
      state.lineFormFor = undefined;
      endEdit();
      render();
    });

    // Take this end's own position, seeded from the point it was naming, and let go of the
    // point. The coordinates are copied so the line does not move when it detaches.
    el(`l_${side}_inline`)?.addEventListener('click', () => {
      beginEdit();
      const was = endPosition(line[side]);
      line[side] = {
        latitude: was?.latitude ?? null,
        longitude: was?.longitude ?? null,
        infinite: !!line[side]?.infinite,
      };
      state.endMode[`${line.id}:${side}`] = 'inline';
      state.lineFormFor = undefined;
      endEdit();
      render();
    });

    for (const field of [`l_${side}_lat`, `l_${side}_lon`]) {
      el(field)?.addEventListener('focus', beginEdit);
      el(field)?.addEventListener('blur', (ev) => {
        // Tabbing between latitude and longitude is still one edit in progress: committing
        // on the first blur would see a half-typed pair and clear the position out from
        // under somebody midway through entering it.
        const to = ev && ev.relatedTarget;
        if (to && (to.id === `l_${side}_lat` || to.id === `l_${side}_lon`)) return;
        const lat = parseFloat(el(`l_${side}_lat`).value);
        const lon = parseFloat(el(`l_${side}_lon`).value);
        // Both or neither. Half a position is not a position.
        line[side] = Number.isFinite(lat) && Number.isFinite(lon)
          ? { ...snap({ latitude: lat, longitude: lon }), infinite: !!line[side]?.infinite }
          : { latitude: null, longitude: null, infinite: !!line[side]?.infinite };
        render();
        endEdit();
      });
    }
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

/**
 * Which way an end is being edited.
 *
 * Read off the end itself unless somebody has said otherwise: an end that names a point is
 * named, one that carries coordinates is inline, and an empty one starts named because a
 * surveyed mark is the commoner answer.
 */
function endMode(line, side) {
  const said = state.endMode[`${line.id}:${side}`];
  if (said) return said;
  const end = line[side];
  return (!end?.at && end?.latitude != null) ? 'inline' : 'named';
}

/**
 * One line end, in whichever of its two shapes is being edited.
 *
 * <b>Named</b> is a point from the club's list: two lines that share a mark share the
 * point, so a later correction moves both. <b>Inline</b> is a position typed or clicked
 * into this line and belonging to nothing else — the right answer for a handle that only
 * exists to give an infinite end its bearing, or a corner nobody will ever refer to.
 *
 * The reverse of the <b>inline</b> button is the selector itself: choosing a point puts the
 * end back to named. One button rather than two, and no way to get stuck in either shape.
 */
function endFields(side, end, line) {
  const mode = endMode(line, side);
  const at = mode === 'named' ? end?.at : null;
  const options = [`<option value="">${mode === 'inline'
    ? '&mdash; inline position &mdash;' : '&mdash; choose a point &mdash;'}</option>`]
    .concat(byId(state.points.values()).map((p) =>
      `<option value="${esc(p.id)}"${at === p.id ? ' selected' : ''}>${esc(p.id)}${p.latitude == null ? ' (not placed)' : ''}</option>`))
    .join('');
  return `
    <div class="endblock">
      <div class="label">${side} end</div>
      <select id="l_${side}_at">${options}</select>
      ${mode === 'inline' ? `
      <div class="pair">
        <div><label class="label" for="l_${side}_lat">Latitude</label>
          <input id="l_${side}_lat" inputmode="decimal" spellcheck="false"></div>
        <div><label class="label" for="l_${side}_lon">Longitude</label>
          <input id="l_${side}_lon" inputmode="decimal" spellcheck="false"></div>
      </div>` : ''}
      <div class="endrow">
        <button id="l_${side}_pick" class="pick">Pick on chart</button>
        ${mode === 'named'
          ? `<button id="l_${side}_inline" class="pick" title="give this end its own position, belonging to no other line">inline</button>`
          : ''}
        <label class="cb"><input type="checkbox" id="l_${side}_inf"${end?.infinite ? ' checked' : ''}> infinite</label>
      </div>
    </div>`;
}

function syncLineForm(line) {
  if (!line) return;
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  for (const side of ['port', 'starboard']) {
    const select = el(`l_${side}_at`);
    if (select) select.value = (endMode(line, side) === 'named' ? line[side]?.at : '') ?? '';
    // Not into a field somebody is typing in — which is what lets a drag update these
    // live while a note is being written below them.
    for (const [field, value] of [[`l_${side}_lat`, line[side]?.latitude],
      [`l_${side}_lon`, line[side]?.longitude]]) {
      const input = el(field);
      if (input && input !== active) input.value = value != null ? value.toFixed(6) : '';
    }
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
  const used = el('l_used');
  if (used) used.innerHTML = affectsBlock('line', line.id);
}

/**
 * Rename a line, carrying every course step that referred to it.
 *
 * Exactly the problem a point rename has, one level up: courses name their steps with
 * `line:`, so a rename that only touched the lines block would leave the sequence
 * pointing at a line that no longer exists.
 */
function renameLine(oldId, wanted) {
  const newId = takeId(el('l_id'), wanted, true, (m) => warnInForm('l_span', m));
  if (!newId || newId === oldId) { if (!newId && el('l_id')) el('l_id').value = oldId; render(); return; }
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
  for (const { variant } of everyVariant()) {
    // A variant that has detached its own copy under this id keeps it: its line is a
    // different line that happens to share a name, and following the club's rename into it
    // would silently repoint the design at geometry it deliberately stopped using.
    if (variant.lines.has(oldId)) continue;
    for (const step of variant.sequence) {
      for (const alternative of alts(step)) {
        if (alternative.line === oldId) alternative.line = newId;
      }
    }
  }

  if (state.editing) state.editing.renames.push({ kind: 'line', from: oldId, to: newId });
  state.selectedLine = newId;
  state.lineFormFor = undefined;
  // Saved HERE, not left to the blur that would normally do it. A rename re-renders, and
  // the re-render destroys the very input the browser was in the middle of leaving — so the
  // `blur` that calls endEdit() lands on a detached node, or never fires at all, and the
  // edit was left in memory only: the editor showed the new id while the file and the
  // server kept the old one, which is a 404 on the next snapshot and no length on the row.
  endEdit();
  render();
}

/** The club's points. Its own list, on its own tab, at the series level. */
function renderPointList() {
  const into = el('list_items');
  if (!into) return;
  const points = byId(state.points.values());
  const unplaced = points.filter((p) => p.latitude == null);

  into.innerHTML = points.length === 0
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

  for (const row of into.querySelectorAll('.row')) {
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

/**
 * Every club and series the server has.
 *
 * Moved off the chart bar and into the head of the hierarchy: choosing a programme is
 * choosing a SCOPE, not a chart control, and the bar above the chart is for things that act
 * on the chart — background, undo, save state.
 */
function renderSeriesList() {
  const into = el('list_series');
  if (!into) return;
  into.innerHTML = state.programmes.length === 0
    ? '<p class="muted">No series. Add one with +.</p>'
    : byId(state.programmes, (p) => `${p.club}/${p.series}`).map((p) => {
        const key = `${p.club}/${p.series}`;
        return `<div class="row${key === state.key ? ' on' : ''}" data-series="${esc(key)}">
          <span class="mono">${esc(p.series)}</span>
          <span class="muted trail small">${esc(p.club)}</span>
        </div>`;
      }).join('');
  for (const row of into.querySelectorAll('.row')) {
    // Choosing a series is working at the series level, so its form is what follows.
    row.addEventListener('click', () => loadProgramme(row.dataset.series));
  }
  el('status').innerHTML = `<span class="muted">${state.programmes.length} series</span>`;
}

/**
 * The variants of the selected course.
 *
 * A list of its own rather than rows nested under the course, because a course and a
 * variant are different kinds of thing and looking alike made a course row select a course
 * with NO variant — a state the form could only apologise for.
 */
function renderVariantList() {
  const into = el('list_variant');
  const course = currentCourse();
  if (!into || !course) return;
  // Templates first, then the races. A template is what the others were made FROM, so it
  // reads as the heading of the list rather than an entry buried in the middle of it — and
  // the list fills up with dated races over a season while the templates stay put.
  const order = [...course.variants.values()]
    .sort((a, b) => (b.template - a.template) || a.id.localeCompare(b.id));
  // A course with no design is an ordinary state, not a broken one — every new course
  // starts there, and the last variant may be deleted — so the empty list says what to do
  // rather than leaving a blank box.
  into.innerHTML = order.length === 0
    ? '<p class="muted small">No variants. Add one with + or from a template with &#9873;.</p>'
    : order.map((variant) => {
        const on = variant.id === state.selectedVariant;
        return `<div class="row${on ? ' on' : ''}" data-course="${esc(course.id)}" data-variant="${esc(variant.id)}">
          <span class="mono">${esc(variant.id)}</span>
          ${chip(course.id, variant.id)}
          <span class="muted trail small">${nm(course.id, variant.id)}</span>
        </div>`;
      }).join('');
  for (const row of into.querySelectorAll('.row')) {
    row.addEventListener('click', () => {
      state.selectedVariant = row.dataset.variant;
      state.selectedSnapshot = null;     // a capture belongs to the design it was taken of
      state.snapshotShown = null;
      state.showTransform = undefined;   // decide afresh for this design
      // Pinned open, not collapsed: picking a variant is often followed by picking a
      // different one to compare.
      state.open.variant = true;
      state.courseFormFor = undefined;
      refreshGeo();
      frameVariant(currentVariant());
      render();
    });
  }
}

/**
 * The captures taken of this variant, newest last.
 *
 * Selecting one puts it in the editor INSTEAD of the variant, read-only. A snapshot is not
 * a draft to be corrected — it is what a boat was handed, and the whole model rests on it
 * being unable to change — so what you can do here is about it, never to it: make a new
 * variant from it, hand it to boats, or take it out of the list.
 */
function renderSnapshotList() {
  const into = el('list_snapshot');
  if (!into) return;
  const life = lifeOf(state.selectedCourse, state.selectedVariant);
  const snapshots = life.snapshots ?? [];
  into.innerHTML = snapshots.length === 0
    ? '<p class="muted">None yet.</p>'
    : snapshots.map((snap) => {
        const on = snap.revision === state.selectedSnapshot;
        return `<div class="row${on ? ' on' : ''}" data-revision="${esc(snap.revision)}">
          <span class="mono small">${esc(snap.label ?? snap.revision)}</span>
          ${snap.revision === life.published ? '<span class="state current trail">published</span>' : ''}
        </div>`;
      }).join('');
  for (const row of into.querySelectorAll('.row')) {
    row.addEventListener('click', () => selectSnapshot(row.dataset.revision));
  }
}

/**
 * Put a capture on the chart.
 *
 * Fetched by revision rather than taken from the lifecycle index, which carries only the
 * label and the date — the geometry lives in the archive, which is the whole point of
 * archiving it. Cached on the revision because a revision names ONE geometry: re-fetching
 * would be asking again for something that cannot have changed.
 */
async function selectSnapshot(revision) {
  if (state.selectedSnapshot === revision) {
    state.selectedSnapshot = null;      // clicking the chosen one puts the design back
    state.snapshotShown = null;
    state.courseFormFor = undefined;
    render();
    return;
  }
  try {
    const snap = await json(`/api/courses/${revision}`);
    state.snapshotShown = { revision, snapshot: snap, variant: variantFromSnapshot(snap) };
    state.selectedSnapshot = revision;
    state.courseFormFor = undefined;
    refreshGeo();
    frameVariant(currentVariant());
    render();
  } catch (e) {
    note(`could not read ${revision}: ${e.message}`, true);
  }
}

/* ------------------------------------------- what you can do about a capture */

/** A new variant from a capture — the only way a snapshot leads anywhere. */
function cloneSnapshot() {
  const course = currentCourse();
  const shown = state.snapshotShown;
  if (!course || !shown) { note('select a snapshot first', true); return; }
  beginEdit();
  // Named for the design and the day it captured, not for the revision: `div1-2027-06-06`
  // says what it is, and twelve hex characters say nothing anybody can read.
  const day = (shown.snapshot.archivedAt ?? '').slice(0, 10);
  const base = slug(`${shown.snapshot.variant ?? 'snapshot'}${day ? `-${day}` : ''}`) || 'snapshot';
  const id = freeId(course.variants, base);
  const from = shown.variant;
  course.variants.set(id, {
    id, name: null, template: false, closed: from.closed,
    points: new Map(),
    // Everything a snapshot holds is inlined, so the new variant owns all of it outright
    // and can be moved without asking anybody.
    lines: new Map([...from.lines].map(([lid, l]) => [lid, {
      ...l, id: lid, port: { ...l.port }, starboard: { ...l.starboard },
    }])),
    sequence: from.sequence.map((step) => ({ ...step, gate: (step.gate ?? []).map((a) => ({ ...a })) })),
    notes: `From snapshot ${shown.snapshot.label ?? shown.revision}.`,
  });
  state.selectedSnapshot = null;
  state.snapshotShown = null;
  state.selectedVariant = id;
  state.open.variant = true;
  state.showTransform = undefined;
  state.courseFormFor = undefined;
  endEdit();
  render();
  note(`${id} made from ${shown.snapshot.label ?? shown.revision}`);
}

/** Hand this capture to boats, in place of whatever they were being handed. */
async function publishSnapshot() {
  const course = currentCourse();
  if (!course || !state.selectedSnapshot) { note('select a snapshot first', true); return; }
  try {
    await post(`/api/lifecycle/${state.key}/publications`, {
      publish: [{ course: course.id, variant: state.selectedVariant, revision: state.selectedSnapshot }],
    });
    await loadLifecycle();
    state.courseFormFor = undefined;
    render();
    note('published');
  } catch (e) {
    note(e.message, true);
  }
}

/**
 * Take a capture out of the list.
 *
 * Its geometry stays in the archive, because a record names a revision and a result whose
 * course cannot be read is a time with nothing attached. This removes it from the list, the
 * dirty comparison and the offer — not from history.
 */
async function forgetSnapshot() {
  const course = currentCourse();
  if (!course || !state.selectedSnapshot) { note('select a snapshot first', true); return; }
  const gone = state.selectedSnapshot;
  const response = await fetch(`/api/lifecycle/${state.key}/snapshots/${gone}`
    + `?course=${encodeURIComponent(course.id)}&variant=${encodeURIComponent(state.selectedVariant)}`,
    { method: 'DELETE' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { note(body.message ?? `could not forget ${gone}`, true); return; }
  state.selectedSnapshot = null;
  state.snapshotShown = null;
  await loadLifecycle();
  state.courseFormFor = undefined;
  render();
  note(`${gone} is off the list — its geometry is still readable`);
}

/**
 * Courses.
 *
 * A course with a single plain variant shows as ONE row and selects that variant directly,
 * because that is the ordinary club course and nobody editing one should have to learn the
 * word "variant" to do it. A course with several shows its variants indented under it, each
 * with its own state, because that is when the distinction starts earning its keep.
 */
function renderCourseList() {
  const into = el('list_course');
  if (!into) return;
  const courses = byId(state.courses.values());
  into.innerHTML = courses.length === 0
    ? '<p class="muted">No courses. Add one with +.</p>'
    : courses.map((course) => {
        const on = course.id === state.selectedCourse;
        const only = course.variants.size === 1 ? [...course.variants.keys()][0] : null;
        return `<div class="row${on ? ' on' : ''}" data-course="${esc(course.id)}"${only ? ` data-variant="${esc(only)}"` : ''}>
          <span class="mono">${esc(course.id)}</span>
          ${course.public ? '<span class="state open" title="listed on the front page">public</span>' : ''}
          ${dirtyDot(course)}
          <span class="muted trail small">${only ? nm(course.id, only)
            : (course.variants.size === 0 ? 'no variants' : `${course.variants.size} variants`)}</span>
        </div>`;
      }).join('');

  for (const row of into.querySelectorAll('.row')) {
    row.addEventListener('click', () => {
      state.selectedCourse = row.dataset.course;
      // A course with ONE design opens straight onto it, so nobody editing an ordinary club
      // course has to learn the word "variant" to do it. A course with several leaves the
      // variant unchosen, which opens the variant list — you have to say which one.
      state.selectedVariant = row.dataset.variant ?? null;
      state.selectedSnapshot = null;
      state.snapshotShown = null;
      state.showTransform = undefined;   // decide afresh for this design
      state.open.course = true;
      state.courseFormFor = undefined;
      refreshGeo();
      frameVariant(currentVariant());
      render();
    });
  }
  if (!state.selectedVariant)
    el('status').innerHTML = `<span class="muted">${courses.length} courses</span>`;
}

/**
 * The state of one variant, as a word.
 *
 * DERIVED on the server and never stored: the hash of the resolved variant against the
 * revision of its latest snapshot. No dirty flag is written anywhere, so none can go stale,
 * be missed by an edit path, or survive an undo it should not have.
 */
function chip(courseId, variantId) {
  const state_ = lifeOf(courseId, variantId).state;
  if (!state_) return '';
  return `<span class="state ${esc(state_)}">${esc(state_)}</span>`;
}

/**
 * A course is dirty if any of its variants is — the race-morning scan.
 *
 * No `template` here: a template is a property of one DESIGN, not of the thing a club
 * publishes. A course row saying "template" would claim the course is unsailable, when a
 * course usually holds a template alongside the races cloned from it.
 */
function dirtyDot(course) {
  const states = [...course.variants.keys()].map((id) => lifeOf(course.id, id).state);
  if (states.includes('dirty')) return '<span class="state dirty">dirty</span>';
  if (states.includes('incomplete')) return '<span class="state incomplete">incomplete</span>';
  return '';
}

/** A variant's length for display. Server-computed, so there is one rule and not two. */
function nm(courseId, variantId) {
  const value = state.lengths?.[courseId]?.[variantId];
  return value == null ? '&mdash; nm' : `${value.toFixed(2)} nm`;
}

/**
 * Frame every placed end of every line the variant uses, at the usual central fifth.
 *
 * A fifth, not four fifths: filling the view with the course leaves it floating on
 * featureless water, and what a course MEANS is where it sits relative to the shore.
 */
function frameVariant(variant) {
  if (!variant) return;
  const seen = [];
  for (const step of variant.sequence ?? []) {
    for (const alternative of alts(step)) {
      const line = GEO.lines.get(alternative.line);
      for (const end of [line?.port, line?.starboard]) {
        const position = endPosition(end);
        if (position) seen.push(position);
      }
    }
  }
  if (seen.length) state.view.fit(seen, FRAME_FRACTION * 4);
}

/**
 * The course editor: the course above, the open variant below.
 *
 * The sequence is the whole of the variant. Everything else — id, name, notes — is one
 * field; the sequence is an ordered list whose order IS the course, since the first step is
 * the start and the last the finish and the letters follow from position.
 */
/**
 * The variant's fields, at the bottom of the pane.
 *
 * The COURSE's fields are not here — they live under the course list, in
 * {@link renderCourseFields}, so that closing the course chevron puts both away together
 * and the variant list can sit below them.
 */
function renderCourseForm() {
  const course = currentCourse();
  const variant = currentVariant();
  // The fold is part of the key, not just of the markup: the guard exists to keep the
  // caret in whatever somebody is typing, and without this a folded sequence would be
  // recognised as the same form and never redrawn.
  const key = `${state.selectedCourse}/${variant ? variant.id : ''}/${isOpen('sequence') ? 'seq' : 'fold'}`;

  if (state.courseFormFor === key) { syncCourseForm(); return; }
  state.courseFormFor = key;

  if (readOnly()) {
    el('form').innerHTML = snapshotFields();
    return;
  }
  if (!variant) {
    el('form').innerHTML = course
      ? '<p class="muted small">Select a variant to edit its sequence.</p>'
      : '<p class="muted small">Select a course.</p>';
    return;
  }
  el('form').innerHTML = variantFields(course, variant);
  wireVariantFields(course, variant);
  syncCourseForm();
}

/** The course's own three fields, under its list and above the variant list. */
function renderCourseFields() {
  const into = el('courseForm');
  const course = currentCourse();
  if (!into || !course) return;
  if (state.courseFieldsFor === course.id) return;
  state.courseFieldsFor = course.id;

  into.innerHTML = `
    <div class="idname">
      <div>
        <label class="label" for="c_id">Course (id)</label>
        <input id="c_id" value="${esc(course.id)}" spellcheck="false">
      </div>
      <div>
        <label class="label" for="c_name">Long name</label>
        <input id="c_name" value="${esc(course.name ?? '')}">
      </div>
    </div>
    <label class="cb" style="margin:2px 0 8px"><input type="checkbox" id="c_public"${course.public ? ' checked' : ''}>
      public &mdash; listed on the front page, with whatever is published under it</label>
    <!--
      THE RACE-MORNING PAIR, and they sit here because this is where the scope is the COURSE.
      A line moved at eight in the morning dirties every variant that stands on it, and doing
      those one at a time means walking the list and hoping none was missed — on the morning
      there is least time to walk a list. Beside the public tickbox because these three are the
      whole of "what will a fleet be handed today": capture it, release it, show it.
    -->
    <div class="lifecycle" style="margin:0 0 10px">
      <button id="c_snapshot_dirty">Snapshot dirty</button>
      <button id="c_publish_latest">Publish latest</button>
    </div>
    <label class="label" for="c_notes">Course notes</label>
    <textarea id="c_notes" rows="2" spellcheck="false">${esc(course.notes ?? '')}</textarea>`;

  // Not a view setting: it decides who can see the course, so it is an edit, it saves, and
  // it consumes the undo slot like any other. Ticking it on a course that already has
  // published snapshots makes those snapshots visible without anything being published,
  // which is why the server logs the flip as an event of its own.
  el('c_snapshot_dirty').addEventListener('click', () => snapshotDirty(course));
  el('c_publish_latest').addEventListener('click', () => publishLatest(course));
  // Set now rather than written into the markup above: what these two offer depends on the
  // lifecycle, which moves while this form stays put.
  syncCourseForm();
  el('c_public').addEventListener('change', (ev) => {
    beginEdit();
    course.public = ev.target.checked;
    endEdit();
    render();
  });

  for (const field of ['c_id', 'c_name', 'c_notes']) el(field).addEventListener('focus', beginEdit);
  el('c_id').addEventListener('change', (ev) => renameCourse(course.id, ev.target.value.trim()));
  el('c_id').addEventListener('blur', endEdit);
  el('c_name').addEventListener('input', (ev) => { course.name = ev.target.value; });
  el('c_name').addEventListener('blur', endEdit);
  el('c_notes').addEventListener('input', (ev) => { course.notes = ev.target.value; });
  el('c_notes').addEventListener('blur', endEdit);
}

/**
 * A capture, read only.
 *
 * No inputs at all, rather than disabled ones. A greyed-out field says "you may edit this
 * later"; a snapshot is never editable by anybody, and the form should say what it IS —
 * what was captured, when, and whether boats are being handed it — rather than showing the
 * shape of an editor that cannot run.
 */
function snapshotFields() {
  const shown = state.snapshotShown;
  if (!shown) return '<p class="muted small">Reading&hellip;</p>';
  const snap = shown.snapshot;
  const life = lifeOf(state.selectedCourse, state.selectedVariant);
  const published = snap.revision === life.published;
  const rows = (shown.variant.sequence ?? []).map((step, i) => {
    const letter = variantLetter(shown.variant, i);
    const parts = alts(step).map((a) => `${esc(a.line)} ${senseOf(a) === 'reverse' ? 'rev' : 'fwd'}`);
    const legNm = snap.steps?.[i]?.legNm;
    return `<div class="steprow">
      <span class="seq">${esc(letter)}</span>
      <span class="grow mono small">${parts.join(' &nbsp;/&nbsp; ')}</span>
      <span class="muted small">${legNm == null ? '' : `${legNm.toFixed(2)} nm`}</span>
    </div>`;
  }).join('');

  return `
    <div class="vblock">
      <p class="small muted" style="margin:0 0 8px">
        A capture of <b>${esc(snap.course)}/${esc(snap.variant)}</b>, fully inlined and
        unchangeable. ${published
          ? 'Boats joining this course are being handed <b>this</b>.'
          : 'Not currently published.'}
      </p>
      <div class="label">Revision</div>
      <div class="mono small" style="margin-bottom:6px">${esc(snap.revision)}</div>
      <div class="label">Taken</div>
      <div class="mono small" style="margin-bottom:6px">${esc((snap.archivedAt ?? '').replace('T', ' ').slice(0, 19))}</div>
      <div class="label">Length</div>
      <div class="mono small" style="margin-bottom:10px">${snap.lengthNm == null ? '&mdash;' : `${snap.lengthNm.toFixed(2)} nm`}${snap.closed ? ' &middot; cycle' : ''}</div>

      <div class="paneHead" style="margin:0 0 4px"><span class="label">Sequence</span></div>
      ${rows || '<p class="muted small">No steps.</p>'}
      <p class="small muted" style="margin-top:10px">Nothing here can be edited. Use
        <b>&#10697;</b> above to start a new variant from it.</p>
    </div>`;
}

/** Everything that belongs to the open variant. Fields only; its commands are on its row. */
function variantFields(course, variant) {
  const adhoc = variant.points.size + variant.lines.size;
  const seqOpen = isOpen('sequence');
  return `
    <div class="vblock">
      <div class="idname">
        <div>
          <label class="label" for="v_id">Variant (id)</label>
          <input id="v_id" value="${esc(variant.id)}" spellcheck="false">
        </div>
        <div>
          <label class="label" for="v_name">Long name</label>
          <input id="v_name" value="${esc(variant.name ?? '')}">
        </div>
      </div>
      <label class="cb"><input type="checkbox" id="v_closed"${variant.closed ? ' checked' : ''}>
        cycle &mdash; a loop with no start or finish of its own</label>
      <label class="cb" style="margin-bottom:8px"><input type="checkbox" id="v_template"${variant.template ? ' checked' : ''}>
        template &mdash; editable, but never snapshotted and so never sailed</label>
      ${variant.template ? `<p class="small muted" style="margin:0 0 8px">
        Editing this changes only what FUTURE clones start from. Courses already cloned from
        it are independent copies and are not affected.</p>` : ''}
      ${adhoc ? `<p class="small muted" style="margin:0 0 8px">${adhoc} ad-hoc
        ${adhoc === 1 ? 'mark' : 'marks'} belong to this variant alone (drawn hollow).</p>` : ''}

      <button class="seqhead" id="c_seq">
        <span class="chev">${seqOpen ? '&#9662;' : '&#9656;'}</span>
        <span class="${seqOpen ? 'label' : 'mono small'}">${seqOpen ? 'Sequence' : crossings(variant)}</span>
        <span class="sp"></span>
        <span id="c_len" class="mono small"></span>
      </button>
      ${seqOpen ? `
        <div id="c_steps"></div>
        <div class="endrow" style="margin:4px 0 10px">
          <button id="c_add">Add line</button>
          <button id="c_alt">Add alternative</button>
        </div>` : ''}

      <div class="endrow" style="margin-bottom:8px">
        <label class="cb"><input type="checkbox" id="c_track"${state.showTrack ? ' checked' : ''}> show track</label>
        <label class="cb"><input type="checkbox" id="c_unused"${state.hideUnused ? ' checked' : ''}> hide unused</label>
        <label class="cb"><input type="checkbox" id="c_move"${transformShown() ? ' checked' : ''}> move/turn</label>
      </div>

      <label class="label" for="v_notes">Variant notes</label>
      <textarea id="v_notes" rows="2" spellcheck="false">${esc(variant.notes ?? '')}</textarea>

    </div>`;
}


function wireVariantFields(course, variant) {
  for (const field of ['v_id', 'v_name', 'v_notes']) el(field).addEventListener('focus', beginEdit);
  el('v_id').addEventListener('change', (ev) => renameVariant(course, variant, ev.target.value.trim()));
  el('v_id').addEventListener('blur', endEdit);
  el('v_name').addEventListener('input', (ev) => { variant.name = ev.target.value; });
  el('v_name').addEventListener('blur', endEdit);
  el('v_notes').addEventListener('input', (ev) => { variant.notes = ev.target.value; });
  el('v_notes').addEventListener('blur', endEdit);

  el('v_closed').addEventListener('change', (ev) => {
    beginEdit();
    variant.closed = ev.target.checked;
    // Entry points mean nothing on an open course, which has one start and one finish by
    // position. Dropped rather than left dormant, so a course cannot carry a marking that
    // says something untrue about it.
    if (!variant.closed) for (const step of variant.sequence) step.entry = false;
    state.courseFormFor = undefined;
    endEdit();
    render();
  });

  // One flag, and every other consequence follows: no snapshot, so no publication, so no
  // boat can ever join it, so it is permanently unpublished and never dirty.
  el('v_template').addEventListener('change', (ev) => {
    beginEdit();
    variant.template = ev.target.checked;
    state.courseFormFor = undefined;
    endEdit();
    render();
  });

  // Both are view settings, not edits: they change what is drawn, not what is stored, so
  // neither saves nor consumes the undo slot.
  el('c_track').addEventListener('change', (ev) => { state.showTrack = ev.target.checked; render(); });
  el('c_unused').addEventListener('change', (ev) => { state.hideUnused = ev.target.checked; render(); });
  el('c_move').addEventListener('change', (ev) => { state.showTransform = ev.target.checked; render(); });

  el('c_seq').addEventListener('click', () => toggle('sequence'));
  // Folded, there is no sequence editor to wire and no rows to render — and the two Add
  // buttons go with it, since adding a step you cannot see is not something to offer.
  if (!isOpen('sequence')) return;

  el('c_add').addEventListener('click', () => {
    beginEdit();
    // On a CYCLE the new step is also the one the closing leg runs from, so it must differ
    // from the first step's line too, or it arrives with a zero-length leg back to the start.
    variant.sequence.push({
      line: firstLineId(lastLineId(variant), variant.closed ? firstLineOf(variant) : null),
      cross: 'forward', gate: [], notes: null,
    });
    state.courseFormFor = undefined;
    endEdit();
    render();
  });

  // "Alternative to the previous line": the last step becomes a gate, or gains another
  // side if it is one already. A gate is a choice at ONE step, never a step of its own.
  el('c_alt').addEventListener('click', () => {
    const last = variant.sequence[variant.sequence.length - 1];
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

  renderSteps(variant);
}

/* ------------------------------------------------------------ the series */

/**
 * Create a series, empty or as a copy of the open one.
 *
 * A clone is a BYTE copy on the server, so the source's banner comments and folded notes
 * come with it — which is how a club starts next summer from last summer's file, and why
 * the copy is not a serialise-and-emit.
 */
async function createSeries(cloneFrom) {
  const club = state.programme?.club ?? (state.key ?? '').split('/')[0];
  if (!club) { note('no club to create a series under', true); return; }
  // Created with a generated id and renamed in the form, exactly as a point, a line, a
  // course or a variant is. A modal asking for a name would be the one place in the editor
  // that named something before making it.
  const taken = new Set(state.programmes.filter((p) => p.club === club).map((p) => p.series));
  const series = freeId({ has: (id) => taken.has(id) }, cloneFrom ? `${state.programme.series}-copy` : 'series');
  await flush();
  try {
    const made = await post('/api/programmes', { club, series, name: null, cloneFrom });
    await loadProgrammeList(`${made.club}/${made.series}`);
    state.open.series = true;   // its fields sit under that list, ready to be renamed
    render();
    note(cloneFrom ? `cloned to ${made.series} — rename it below` : `created ${made.series} — rename it below`);
  } catch (e) {
    note(e.message, true);
  }
}

/**
 * The series form: its id and its title, under the series list.
 *
 * Both go to the server rather than into the autosaved blocks, because a series id is a
 * FILENAME and its title is a top-level line of the file — neither is inside the
 * points/lines/courses blocks the editor splices.
 */
function renderSeriesForm() {
  const into = el('seriesForm');
  if (!into || state.seriesFormFor === state.key) return;
  state.seriesFormFor = state.key;
  const programme = state.programme;
  if (!programme) {
    into.innerHTML = '<p class="muted small">No series. Add one with + above.</p>';
    return;
  }
  into.innerHTML = `
    <div class="idname">
      <div>
        <label class="label" for="s_id">Series (id)</label>
        <input id="s_id" value="${esc(programme.series)}" spellcheck="false">
      </div>
      <div>
        <label class="label" for="s_name">Long name</label>
        <input id="s_name" value="${esc(programme.name ?? '')}">
      </div>
    </div>
    <p class="small muted">Club <span class="mono">${esc(programme.club)}</span> is the
      directory this file sits in, and a club domain does not change. Renaming the series
      moves the file and carries its publications with it.</p>`;
  el('s_id').addEventListener('change', (ev) => {
    const id = takeId(el('s_id'), ev.target.value.trim(), false, note);
    if (id && id !== programme.series) retitleSeries({ series: id });
    else el('s_id').value = programme.series;
  });
  el('s_name').addEventListener('change', (ev) => retitleSeries({ name: ev.target.value }));
}

async function retitleSeries(change) {
  await flush();
  try {
    const done = await post(`/api/programmes/${state.key}/rename`, change);
    state.seriesFormFor = undefined;
    // Wired HERE, beside the assignment that destroyed the old buttons. It used to be
    // wired with the rest below, under a guard that watches #rows — a different element —
    // so any render that rebuilt this row while #rows stayed put left the series chevron
    // and its commands dead. Each container re-wires its own.
    wireRow(['series']);
    await loadProgrammeList(`${done.club}/${done.series}`);
    note(change.series ? `renamed to ${done.series}` : 'renamed');
  } catch (e) {
    note(e.message, true);
    state.seriesFormFor = undefined;
    // Wired HERE, beside the assignment that destroyed the old buttons. It used to be
    // wired with the rest below, under a guard that watches #rows — a different element —
    // so any render that rebuilt this row while #rows stayed put left the series chevron
    // and its commands dead. Each container re-wires its own.
    wireRow(['series']);
    render();
  }
}

/**
 * Retire the open series.
 *
 * Refused by the server while any of its courses is still published, and the refusal names
 * them — so this asks rather than guessing, using the same dialog the geometry edits use.
 * Its snapshots are kept either way: a record names a revision, and a record whose geometry
 * cannot be read is a time with no course attached.
 */
async function deleteSeries() {
  if (!state.key) return;
  await flush();
  const gone = async (force) => {
    const response = await fetch(`/api/programmes/${state.key}${force ? '?force=true' : ''}`,
      { method: 'DELETE' });
    return { ok: response.ok, status: response.status, body: await response.json().catch(() => ({})) };
  };
  let result = await gone(false);
  if (result.status === 409) {
    const answer = await ask(`Retire ${state.key}?`,
      `Boats can still join <b>${esc((result.body.published ?? []).join(', '))}</b>. `
      + 'The snapshots they were given are kept either way, so anything already sailed stays readable.',
      [{ key: 'force', label: 'Retire it anyway' }]);
    if (answer !== 'force') return;
    result = await gone(true);
  }
  if (!result.ok) { note(result.body.message ?? `could not retire (${result.status})`, true); return; }
  const was = state.key;
  await loadProgrammeList(null);
  note(`retired ${was}`);
}

/* --------------------------------------------------- snapshot, publish, clone */

/**
 * Capture the open variant, immutably.
 *
 * The save has to land first: the server snapshots what is ON DISK, and a variant edited a
 * moment ago but not yet written would be captured as it was before the edit — the one
 * failure mode that would put a design nobody drew in front of a fleet.
 */
async function takeSnapshot(course, variant) {
  await flush();
  try {
    const result = await post(`/api/lifecycle/${state.key}/snapshots`,
      { course: course.id, variant: variant.id });
    await loadLifecycle();
    state.courseFormFor = undefined;
    render();
    note(result.fresh
      ? `snapshot ${result.label}`
      : `already captured as ${result.label} — nothing has changed since`);
  } catch (e) {
    note(e.message, true);
  }
}

/**
 * Publish the latest snapshot of one variant.
 *
 * Publishing REPLACES that variant's previous publication rather than adding to it: a course
 * has one live design per variant, and offering a fleet a choice of vintages would be a way
 * to start a race with two different courses on the water.
 */
/**
 * The variants of one course that have something new to capture.
 *
 * <b>Dirty means the design has moved since the last snapshot</b>, and unpublished means it
 * has never been captured at all — both want capturing and neither is the other. Templates are
 * excluded by construction rather than by a filter: a template cannot be snapshotted, so it can
 * never be dirty, and `lifeOf` reports it as `template` and nothing else.
 */
function dirtyVariants(course) {
  return [...course.variants.keys()].filter((id) => {
    const life = lifeOf(course.id, id);
    return life.state === 'dirty' || life.state === 'unpublished';
  });
}

/** The variants of one course that have a snapshot to hand a fleet. */
function publishableVariants(course) {
  return [...course.variants.keys()]
    .filter((id) => (lifeOf(course.id, id).snapshots ?? []).length > 0);
}

/**
 * Capture every variant of this course that has changed.
 *
 * One at a time and deliberately not atomic, because a snapshot is not a promise to anybody:
 * capturing is private until something is published, so a run that got half way through has
 * simply captured half of them and can be pressed again. The atomicity that matters is one
 * level down, in publish.
 */
async function snapshotDirty(course) {
  await flush();
  const wanted = dirtyVariants(course);
  if (!wanted.length) return note('nothing has changed since it was last captured');
  const taken = [];
  for (const id of wanted) {
    try {
      const result = await post(`/api/lifecycle/${state.key}/snapshots`,
        { course: course.id, variant: id });
      if (result.fresh) taken.push(id);
    } catch (e) {
      await loadLifecycle();
      state.courseFormFor = undefined;
      render();
      return note(`${id}: ${e.message}`, true);
    }
  }
  await loadLifecycle();
  state.courseFormFor = undefined;
  render();
  note(taken.length
    ? `captured ${taken.length} of ${wanted.length}: ${taken.join(', ')}`
    : 'already captured — nothing had changed');
}

/**
 * Hand the fleet the latest capture of every variant of this course, in ONE write.
 *
 * <b>All of them or none</b>, which is the constraint the whole ledger is arranged around: a
 * line common to three variants moved on race morning has to reach all three together, or the
 * fleets are sailing to inconsistent instructions and nobody on the water can tell. Sending
 * one request rather than a loop is what makes that true — the server commits the pointers in
 * a single atomic write, so a crash leaves the previous set and never half the new one.
 *
 * No revision is named. The endpoint reads that as "whatever was last captured", which is
 * exactly the race-morning intent and is why this pairs with the button beside it.
 */
async function publishLatest(course) {
  const wanted = publishableVariants(course);
  if (!wanted.length) return note('nothing captured to publish', true);
  try {
    await post(`/api/lifecycle/${state.key}/publications`,
      { publish: wanted.map((id) => ({ course: course.id, variant: id })) });
    await loadLifecycle();
    state.courseFormFor = undefined;
    render();
    note(`published the latest of ${wanted.length}: ${wanted.join(', ')}`
      + (course.public ? '' : ' — the course is not public, so nobody can see it yet'));
  } catch (e) {
    note(e.message, true);
  }
}

/**
 * Clone a variant.
 *
 * Cloning ALWAYS clears the template flag, or the copy could not be snapshotted either and
 * the clone would be as unsailable as the thing it came from. Named geometry is shared by
 * reference and ad-hoc geometry is copied, which is what makes a template built on the
 * club's marks produce clones that all move when a club mark moves.
 */
function cloneVariant(course, variant, into = course) {
  beginEdit();
  const { id, name } = cloneName(course, variant, into);
  into.variants.set(id, {
    ...variant,
    id,
    name,
    template: false,
    points: new Map([...variant.points].map(([pid, p]) => [pid, { ...p }])),
    lines: new Map([...variant.lines].map(([lid, l]) => [lid, {
      ...l, port: { ...l.port }, starboard: { ...l.starboard },
    }])),
    sequence: variant.sequence.map((step) => ({ ...step, gate: (step.gate ?? []).map((a) => ({ ...a })) })),
  });
  state.selectedCourse = into.id;
  state.selectedVariant = id;
  state.showTransform = undefined;
  state.open.variant = true;     // show what was just made, beside its siblings
  state.courseFormFor = undefined;
  endEdit();
  render();
}

/* ------------------------------------------------------- from a template */

/**
 * Add a variant to this course by expanding a template from anywhere in the library.
 *
 * The inversion that matters: you pick the course you are building and then reach for the
 * shape, rather than navigating to the shape and having the copy appear beside it. It is
 * also the only way a template is usable outside its own course — the model has always
 * allowed a variant to be cloned into any course, and nothing in the UI reached one.
 */
async function addFromTemplate(course) {
  let templates;
  try {
    templates = await json('/api/templates');
  } catch (e) {
    note(e.message, true);
    return;
  }
  if (!templates.length) {
    await ask('No templates', 'Nothing in the library is marked as a template. Mark a '
      + 'variant as one and it becomes available to every course.', []);
    return;
  }
  // Series, then course, then variant — because that is how somebody holds the answer:
  // "the one we use for the Saturday series", not one row out of a flat list of forty.
  const bySeries = new Map();
  for (const t of templates) {
    const key = `${t.club}/${t.series}`;
    if (!bySeries.has(key)) bySeries.set(key, new Map());
    const byCourse = bySeries.get(key);
    if (!byCourse.has(t.course)) byCourse.set(t.course, []);
    byCourse.get(t.course).push(t);
  }
  const chosen = await pickTemplate(course, bySeries);
  if (chosen) await expandTemplate(course, chosen);
}

/**
 * One stage of the drill.
 *
 * <b>A stage with one answer answers itself</b> and says it did, so a club whose templates
 * all live in one series never sees a question with a single button on it. That is the whole
 * value of a hierarchy over a flat list: it collapses to nothing when there is nothing to
 * choose.
 */
async function stageOf(title, body, options, back) {
  if (options.length === 1) return { value: options[0].key, auto: true };
  const choices = options.slice();
  // A literal character, not an entity: ask() escapes every label, because the others are
  // ids out of a file. "&#8617; back" therefore rendered as those nine characters.
  if (back) choices.push({ key: '__back', label: '\u2190 back' });
  const answer = await ask(title, body, choices);
  if (answer === null) return null;
  return answer === '__back' ? { back: true } : { value: answer };
}

/**
 * Walk series &rarr; course &rarr; variant, skipping any stage that has only one answer.
 *
 * Back steps over the stages that answered themselves. Going back INTO one would answer it
 * again and go straight forward, which is a button that does nothing — so it skips to the
 * last stage that was actually a choice, and is not offered at all when there was none.
 */
async function pickTemplate(into, bySeries) {
  const count = (n) => `${n} template${n === 1 ? '' : 's'}`;
  let series = null;
  let courseId = null;
  const auto = [false, false];
  let level = 0;

  for (;;) {
    if (level === 0) {
      const options = byId([...bySeries.keys()], (k) => k).map((key) => ({
        key,
        label: `${key} — ${count([...bySeries.get(key).values()].flat().length)}`,
      }));
      const r = await stageOf(`Add a variant to ${into.id}`,
        'Which series holds the template? Its geometry comes across into this one &mdash; '
        + 'marks it names by name are made here too, reusing yours where they already match.',
        options, false);
      if (!r) return null;
      auto[0] = !!r.auto;
      series = r.value;
      level = 1;
    } else if (level === 1) {
      const byCourse = bySeries.get(series);
      const options = byId([...byCourse.keys()], (k) => k).map((key) => ({
        key, label: `${key} — ${count(byCourse.get(key).length)}`,
      }));
      const r = await stageOf(`${series}`, 'Which course?', options, !auto[0]);
      if (!r) return null;
      if (r.back) { series = null; level = 0; continue; }
      auto[1] = !!r.auto;
      courseId = r.value;
      level = 2;
    } else {
      const variants = bySeries.get(series).get(courseId);
      const options = byId(variants, (t) => t.variant).map((t) => ({
        key: t.variant,
        label: `${t.variant} — ${t.steps} ${t.steps === 1 ? 'mark' : 'marks'}`
          + `${t.lengthNm == null ? '' : `, ${t.lengthNm.toFixed(2)} nm`}`
          + `${t.closed ? ' · cycle' : ''}`,
      }));
      const r = await stageOf(`${series} · ${courseId}`, 'Which template?',
        options, !(auto[0] && auto[1]));
      if (!r) return null;
      if (r.back) {
        // Past any stage that answered itself, to the last one that was a real choice.
        if (auto[1]) { series = null; courseId = null; auto[1] = false; level = 0; }
        else { courseId = null; level = 1; }
        continue;
      }
      return variants.find((t) => t.variant === r.value) ?? null;
    }
  }
}

/**
 * Bring a template's geometry into this series, and add it as a variant.
 *
 * <b>A programme file is self-contained</b> — it names no other file and resolves nothing
 * from outside itself — so a template from another series cannot be referred to, only
 * copied. What comes across keeps its shape: a mark the template NAMES is made a named mark
 * here, because naming is identity and a course that refers to Sow and Pigs should go on
 * referring to it. Ad-hoc geometry stays ad-hoc, belonging to the new variant alone.
 *
 * The one hard case is a name that already means something else here. See {@link adopt}.
 */
async function expandTemplate(course, template) {
  let source;
  try {
    source = await json(`/api/programmes/${template.club}/${template.series}`);
  } catch (e) {
    note(e.message, true);
    return;
  }
  const from = variantIn(template.variant,
    source.courses?.[template.course]?.variants?.[template.variant] ?? {});
  const srcPoints = new Map(Object.entries(source.points ?? {}).map(([id, p]) => [id, { ...p, id }]));
  const srcLines = new Map(Object.entries(source.lines ?? {}).map(([id, l]) => [id, {
    ...l, id, port: { ...(l.port ?? {}) }, starboard: { ...(l.starboard ?? {}) },
  }]));

  beginEdit();
  const renamed = [];
  const id = raceId(course.variants);
  const made = {
    id, name: from.name === from.id ? null : from.name, template: false,
    closed: from.closed, points: new Map(), lines: new Map(), sequence: [], notes: from.notes,
  };

  // ONE crossing of each name, however many times the sequence names it. A leeward line
  // that is start, mark 2 and finish appears three times and is still one line; taking it
  // across per OCCURRENCE made three copies of it in the same water, which every later
  // correction would then have to be made to three times — and for an ad-hoc line every
  // copy got its own id, so they were not even recognisable as the same mark. The same
  // goes for a point two of those lines stand on. Both are memoised on the template's id.
  const asPoint = new Map();
  const asLine = new Map();

  /** A point the template names, adopted into this series under a name that is free to mean it. */
  const point = (pointId) => {
    if (asPoint.has(pointId)) return asPoint.get(pointId);
    const want = srcPoints.get(pointId);
    const got = want ? adopt(state.points, pointId, want, samePlace, renamed, 'mark') : pointId;
    asPoint.set(pointId, got);
    return got;
  };
  const end = (e) => (e?.at ? { at: point(e.at), infinite: !!e.infinite } : { ...e });

  const line = (lineId) => {
    if (asLine.has(lineId)) return asLine.get(lineId);
    let got;
    const own = from.lines.get(lineId);
    if (own) {
      // Ad-hoc in the template, so ad-hoc here: it belonged to that design alone and it
      // belongs to this one alone.
      got = freeAcross(lineId, state.lines, made.lines);
      made.lines.set(got, { ...own, id: got, port: end(own.port), starboard: end(own.starboard) });
    } else {
      const want = srcLines.get(lineId);
      got = want
        ? adopt(state.lines, lineId,
          { ...want, port: end(want.port), starboard: end(want.starboard) },
          sameLine, renamed, 'line')
        : lineId;
    }
    asLine.set(lineId, got);
    return got;
  };

  // The set first, in order of first use, so every line this variant will stand on exists
  // before any step refers to one — and then the sequence, built against what was made.
  for (const step of from.sequence) {
    for (const entry of (step.gate?.length ? step.gate : [step])) {
      if (entry.line) line(entry.line);
    }
  }
  for (const step of from.sequence) {
    made.sequence.push({
      ...step,
      line: step.line ? line(step.line) : null,
      gate: (step.gate ?? []).map((a) => ({ ...a, line: a.line ? line(a.line) : null })),
    });
  }

  course.variants.set(id, made);
  state.selectedVariant = id;
  state.open.variant = true;
  state.showTransform = undefined;
  state.courseFormFor = undefined;
  endEdit();
  render();
  note(renamed.length
    ? `${id} added — ${renamed.join(', ')}`
    : `${id} added from ${template.course}/${template.variant}`);
}

/**
 * Take a named thing into this series under a name that is free to mean it.
 *
 * Three situations, and only the third is interesting:
 *
 * <ul>
 *   <li>the name is free here — create it, and the template goes on referring to it by the
 *       name it always used;</li>
 *   <li>the name is taken by something in the SAME PLACE — reuse it. Two files calling one
 *       reef by one name is the point of naming;</li>
 *   <li>the name is taken by something <b>somewhere else</b> — neither default is safe.
 *       Reusing silently puts the template where it is not; overwriting is far worse,
 *       because it moves every other course in this series that stands on that mark. So a
 *       distinct id is made, and it is <b>said</b>.</li>
 * </ul>
 */
function adopt(into, wantedId, value, same, renamed, what) {
  const existing = into.get(wantedId);
  if (!existing) {
    into.set(wantedId, { ...value, id: wantedId });
    return wantedId;
  }
  if (same(existing, value)) return wantedId;
  const id = freeAcross(wantedId, into);
  into.set(id, { ...value, id });
  renamed.push(`${what} ${wantedId} already means somewhere else here, so this one is ${id}`);
  return id;
}

/** Two marks are the same mark when they are in the same place, to the metre. */
function samePlace(a, b) {
  return a.latitude != null && b.latitude != null
    && distanceM(a, b) === 0;
}

/**
 * Two lines are the same line when both ends are, and run on in the same directions.
 *
 * Resolved against the CLUB's points rather than GEO, because the points this line's ends
 * name may have been adopted moments ago and GEO is only rebuilt on a render.
 */
function sameLine(a, b) {
  const at = (end) => {
    if (!end) return null;
    if (end.latitude != null) return end;
    const named = state.points.get(end.at);
    return named && named.latitude != null ? named : null;
  };
  return ['port', 'starboard'].every((side) => {
    const x = at(a[side]);
    const y = at(b[side]);
    return !!x && !!y && distanceM(x, y) === 0 && !a[side]?.infinite === !b[side]?.infinite;
  });
}

/**
 * What a clone is called.
 *
 * Two cases, because they are two different acts:
 *
 * <b>A variant cloned into another course</b> keeps its own id: the target's namespace is
 * fresh, so cloning a whole course leaves `div1` as `div1` rather than `div1-copy`, and the
 * structure of variants the course was cloned for survives.
 *
 * <b>A variant cloned beside itself</b> is `<id>-copy`, because that is what it is.
 *
 * <b>A TEMPLATE, cloned anywhere</b>, is `yyyymmdd-race-n` — see {@link raceId}. Both of the
 * rules above are about a design keeping or losing its identity; a template has no identity
 * to keep, because the copy is the first thing anybody will actually sail.
 */
function cloneName(course, variant, into) {
  // A clone OF A TEMPLATE is the same act as expanding one — a shape becoming a race — so it
  // is named the same way, and not "two-laps-copy", which says what it was made from.
  if (variant.template)
    return { id: raceId(into.variants), name: variant.name === variant.id ? null : variant.name };
  if (into !== course && !into.variants.has(variant.id))
    return { id: variant.id, name: variant.name === variant.id ? null : variant.name };
  return { id: freeId(into.variants, `${variant.id}-copy`), name: null };
}

/** Clone every variant of a course into a new one, keeping the structure of variants. */
function cloneCourse(course) {
  beginEdit();
  const id = freeId(state.courses, `${course.id}-copy`);
  // NOT public, whatever the original was. A clone has nothing published under it yet,
  // and inheriting the flag would put an empty course on the front page the moment it was
  // made — visibility is a decision about a course, taken once, for that course.
  const copy = { id, name: null, public: false, notes: course.notes, variants: new Map() };
  state.courses.set(id, copy);
  for (const variant of course.variants.values()) cloneVariant(course, variant, copy);
  state.selectedCourse = id;
  state.selectedVariant = [...copy.variants.keys()][0] ?? null;
  state.courseFormFor = undefined;
  endEdit();
  render();
}

/**
 * A new course, with the one variant a course written flat reads back as.
 *
 * The `variants:` level only appears in the file once somebody adds a second design, so a
 * course created here looks in the file exactly like every course written before variants
 * existed.
 */
function addCourse() {
  beginEdit();
  const id = freeId(state.courses, 'course');
  // NO variants. A course is not a design, and guessing one called `main` put a blank
  // sequence in front of somebody whose next move is very often "start from the
  // windward/leeward we always use". An empty variant list with `+` and `⚐` on its row
  // asks the question instead of answering it wrong.
  // Private until somebody says otherwise: a half-built shape is not an offer.
  state.courses.set(id, { id, name: null, public: false, notes: null, variants: new Map() });
  state.selectedCourse = id;
  state.selectedVariant = null;
  state.open.course = true;      // show what was just made, beside its siblings
  state.courseFormFor = undefined;
  endEdit();
  render();
}

function deleteCourse() {
  const id = state.selectedCourse;
  if (!id || !state.courses.has(id)) { note('no course selected', true); return; }
  beginEdit();
  // Nothing refers to a course by id, so there is nothing to orphan and nothing to refuse
  // — the only delete in the editor that needs no guard. Its SNAPSHOTS are not deleted
  // with it: they are what boats sailed, and they simply leave the dirty conversation.
  state.courses.delete(id);
  state.selectedCourse = null;
  state.selectedVariant = null;
  state.courseFormFor = undefined;
  endEdit();
  render();
}

function addVariant(course, from) {
  beginEdit();
  const id = freeId(course.variants, 'variant');
  course.variants.set(id, from ? { ...from, id } : {
    id, name: null, template: false, closed: false,
    points: new Map(), lines: new Map(), sequence: [], notes: null,
  });
  state.selectedVariant = id;
  state.showTransform = undefined;
  state.open.variant = true;     // show what was just made, beside its siblings
  state.courseFormFor = undefined;
  endEdit();
  render();
}

function deleteVariant() {
  const course = currentCourse();
  const variant = currentVariant();
  if (!course || !variant) return;
  beginEdit();
  // The snapshots stay. They are what boats sailed, and they leave the dirty conversation
  // rather than the record.
  course.variants.delete(variant.id);
  state.selectedVariant = [...course.variants.keys()][0] ?? null;
  // The LAST one may go. A course with no design is an ordinary state — every new course
  // starts there — and refusing left somebody who wanted to start over with nothing to do
  // but delete the course and make it again under the same id. With none left, the empty
  // list with its + and its ⚐ is the only thing worth looking at, so open it even if the
  // chevron had been shut.
  if (course.variants.size === 0) state.open.variant = true;
  state.courseFormFor = undefined;
  endEdit();
  render();
}

async function post(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160));
  return JSON.parse(text);
}

/**
 * The line to seed a new step with.
 *
 * Not simply the first one: a step naming the same line as the step before it makes a
 * ZERO-LENGTH LEG, which the model treats as an error rather than a short leg, since two
 * steps sharing a reference point is not something any course means. Seeding with a
 * different line means adding a step leaves the course valid and the length actually
 * moves, which is the feedback the button is for.
 */
function firstLineId(...notThese) {
  const avoid = new Set(notThese.filter(Boolean));
  const ids = [...GEO.lines.keys()];
  return ids.find((id) => !avoid.has(id)) ?? ids[0] ?? null;
}

/** The line the last step ends on, so the next one can avoid repeating it. */
function lastLineId(variant) {
  const last = (variant.sequence ?? [])[variant.sequence.length - 1];
  if (!last) return null;
  return last.gate?.length ? last.gate[last.gate.length - 1].line : last.line;
}

/**
 * The line the FIRST step crosses — what a cycle's closing leg runs back to.
 *
 * On a cycle the new last step has a leg into step 0 as well as one out of the step before
 * it, so seeding it needs to avoid both or the step arrives with a zero-length leg it did
 * not have on an open course.
 */
function firstLineOf(variant) {
  const first = (variant.sequence ?? [])[0];
  if (!first) return null;
  return first.gate?.length ? first.gate[0].line : first.line;
}

/**
 * What the folded sequence says about itself: how many lines are in the list.
 *
 * Rows, not steps — a gate's two alternatives are two lines to cross and two rows to read,
 * and a count that called them one would not match what unfolding shows.
 */
function crossings(variant) {
  const rows = (variant.sequence ?? []).reduce((n, step) => n + (step.gate?.length || 1), 0);
  return rows === 0 ? 'empty' : `${rows} ${rows === 1 ? 'line' : 'lines'}`;
}

function renderSteps(variant) {
  const steps = variant.sequence ?? [];
  // Alphabetical, not file order. The lists in the pane keep file order, which is the
  // order somebody authored them in and is worth preserving; a dropdown is for FINDING a
  // line, and a list you have to read all of is not a list you can find anything in.
  const options = (selected) => [...GEO.lines.keys()].sort((a, b) => a.localeCompare(b))
    .map((id) => `<option value="${esc(id)}"${id === selected ? ' selected' : ''}>${esc(id)}${isAdhoc('line', id) ? ' (ad-hoc)' : ''}</option>`)
    .join('');

  el('c_steps').innerHTML = steps.length === 0
    ? '<p class="muted small">Empty. Add a line to start.</p>'
    : steps.map((step, i) => {
        const gate = step.gate?.length ? step.gate : null;
        // Reordering belongs to the STEP, so up/down sit on its first row only — a
        // gate's alternatives are a choice within the step, not steps of their own.
        const rows = (gate ?? [step]).map((entry, j) => `
          <div class="steprow${gate && j > 0 ? ' alt' : ''}">
            <span class="seq">${gate && j > 0 ? '&#8627;' : esc(variantLetter(variant, i))}</span>
            <select data-step="${i}" data-alt="${j}" class="s_line">${options(entry.line)}</select>
            <button data-step="${i}" data-alt="${j}" class="s_dir" title="crossing sense">${senseOf(entry) === 'reverse' ? 'rev' : 'fwd'}</button>
            ${variant.closed && j === 0
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

  on('s_line', (i, j, ev, node) => { entryAt(variant, i, j).line = node.value; });
  on('s_dir', (i, j) => {
    const entry = entryAt(variant, i, j);
    entry.cross = senseOf(entry) === 'forward' ? 'reverse' : 'forward';
  });
  on('s_del', (i, j) => {
    const step = variant.sequence[i];
    if (step.gate?.length) {
      step.gate.splice(j, 1);
      // One alternative left is not a choice: collapse it back to a plain step.
      if (step.gate.length === 1) { step.line = step.gate[0].line; step.cross = step.gate[0].cross; step.gate = []; }
      if (step.gate.length === 0 && !step.line) variant.sequence.splice(i, 1);
    } else {
      variant.sequence.splice(i, 1);
    }
  });
  // A line crossed to begin a lap must be crossed again, in the same sense, to end it —
  // so an entry point is a start and a finish at once, and a lap is bounded by the same
  // crossing twice. That is what keeps the scoring from having to decide which of several
  // crossings closed the loop, and it puts the burden on course design instead.
  on('s_entry', (i) => { variant.sequence[i].entry = !variant.sequence[i].entry; });
  on('s_up', (i) => { if (i > 0) variant.sequence.splice(i - 1, 0, variant.sequence.splice(i, 1)[0]); });
  on('s_down', (i) => {
    if (i < variant.sequence.length - 1) variant.sequence.splice(i + 1, 0, variant.sequence.splice(i, 1)[0]);
  });
}

function entryAt(variant, i, j) {
  const step = variant.sequence[i];
  return step.gate?.length ? step.gate[j] : step;
}

function senseOf(entry) {
  return String(entry?.cross ?? 'forward').toLowerCase();
}

/**
 * Everything on the course and variant forms that changes without the form being rebuilt.
 *
 * <b>The forms are guarded on identity, not on content</b> — `renderCourseFields` returns
 * early while the same course is selected, and `renderCourseForm` while the same variant is —
 * because the guard exists to keep the caret in whatever somebody is typing. So anything whose
 * appearance depends on state that moves under a selection has to be updated HERE, not baked
 * into the markup once and left.
 *
 * That caught the race-morning buttons: their disabled state was computed from the lifecycle at
 * the moment the course was first drawn, so a variant going dirty under them updated the row's
 * chip — the rows are rebuilt — and left the button that acts on it greyed out. The state was
 * right everywhere except on the control for it.
 */
function syncCourseForm() {
  const course = currentCourse();
  if (course) {
    const dirty = dirtyVariants(course).length;
    const snapshotDirty = el('c_snapshot_dirty');
    if (snapshotDirty) {
      snapshotDirty.disabled = dirty === 0;
      snapshotDirty.textContent = dirty ? `Snapshot dirty (${dirty})` : 'Snapshot dirty';
      snapshotDirty.title = dirty
        ? `capture ${dirty === 1 ? 'the variant that has' : `all ${dirty} variants that have`} changed`
        : 'nothing has changed since it was last captured';
    }
    const publishLatest = el('c_publish_latest');
    if (publishLatest) {
      const ready = publishableVariants(course).length;
      publishLatest.disabled = ready === 0;
      publishLatest.title = ready
        ? `hand the fleet the latest capture of ${ready === 1 ? 'it' : `all ${ready}`}`
        : 'nothing captured to publish';
    }
  }

  const length = el('c_len');
  if (length) length.innerHTML = nm(state.selectedCourse, state.selectedVariant);
  const track = el('c_track');
  if (track) track.checked = state.showTrack;
  const unused = el('c_unused');
  if (unused) unused.checked = state.hideUnused;
  const move = el('c_move');
  if (move) move.checked = transformShown();
}

function renameCourse(oldId, wanted) {
  const newId = takeId(el('c_id'), wanted, false, note);
  if (!newId || newId === oldId) { if (!newId && el('c_id')) el('c_id').value = oldId; render(); return; }
  if (state.courses.has(newId)) {
    el('c_id').value = oldId;
    note(`a course called ${newId} already exists`, true);
    return;
  }
  const rebuilt = new Map();
  for (const [id, course] of state.courses) {
    if (id === oldId) rebuilt.set(newId, { ...course, id: newId });
    else rebuilt.set(id, course);
  }
  state.courses = rebuilt;
  // No rename to follow: nothing in the file refers to a course by id. The SNAPSHOTS keep
  // the old name, which is right — they record what a boat was given, not what the design
  // is called now.
  state.selectedCourse = newId;
  state.courseFormFor = undefined;
  state.courseFieldsFor = undefined;
  // Saved HERE, not left to the blur that would normally do it. A rename re-renders, and
  // the re-render destroys the very input the browser was in the middle of leaving — so the
  // `blur` that calls endEdit() lands on a detached node, or never fires at all, and the
  // edit was left in memory only: the editor showed the new id while the file and the
  // server kept the old one, which is a 404 on the next snapshot and no length on the row.
  endEdit();
  render();
}

function renameVariant(course, variant, wanted) {
  const newId = takeId(el('v_id'), wanted, false, note);
  if (!newId || newId === variant.id) { if (!newId && el('v_id')) el('v_id').value = variant.id; render(); return; }
  if (course.variants.has(newId)) {
    el('v_id').value = variant.id;
    note(`this course already has a variant called ${newId}`, true);
    return;
  }
  const rebuilt = new Map();
  for (const [id, v] of course.variants) {
    if (id === variant.id) rebuilt.set(newId, { ...v, id: newId });
    else rebuilt.set(id, v);
  }
  course.variants = rebuilt;
  state.selectedVariant = newId;
  state.courseFormFor = undefined;
  // Saved HERE, not left to the blur that would normally do it. A rename re-renders, and
  // the re-render destroys the very input the browser was in the middle of leaving — so the
  // `blur` that calls endEdit() lands on a detached node, or never fires at all, and the
  // edit was left in memory only: the editor showed the new id while the file and the
  // server kept the old one, which is a 404 on the next snapshot and no length on the row.
  endEdit();
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
    <div class="idname">
      <div>
        <label class="label" for="f_id">Short name (id)</label>
        <input id="f_id" value="${esc(point.id)}" spellcheck="false">
      </div>
      <div>
        <label class="label" for="f_name">Long name</label>
        <input id="f_name" value="${esc(point.name ?? '')}">
      </div>
    </div>
    <div class="pair">
      <div><label class="label" for="f_lat">Latitude</label><input id="f_lat" inputmode="decimal" spellcheck="false"></div>
      <div><label class="label" for="f_lon">Longitude</label><input id="f_lon" inputmode="decimal" spellcheck="false"></div>
    </div>
    <div id="f_dm" class="mono small muted"></div>
    <label class="label" for="f_notes">Notes</label>
    <textarea id="f_notes" rows="3" spellcheck="false">${esc(point.notes ?? '')}</textarea>
    <div id="f_used"></div>`;

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
  el('f_used').innerHTML = relatedLines(point.id) + affectsBlock('point', point.id);
}

/**
 * Rename a point, carrying every line end that referred to it.
 *
 * A point's id is not a label: lines name their ends by it. Renaming without following
 * the references would silently detach a line from its end, which the server would then
 * report as an unknown point long after anybody remembered doing it.
 */
function rename(oldId, wanted) {
  const newId = takeId(el('f_id'), wanted, true, (m) => warnInForm('f_dm', m));
  if (!newId || newId === oldId) { if (!newId && el('f_id')) el('f_id').value = oldId; render(); return; }
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
  // An ad-hoc line may still name a CLUB point — detaching a point does not detach the
  // other end — so a club rename has to reach into the variants as well.
  for (const { variant } of everyVariant()) {
    if (variant.points.has(oldId)) continue;
    for (const line of variant.lines.values()) {
      for (const end of [line.port, line.starboard]) {
        if (end && end.at === oldId) end.at = newId;
      }
    }
  }
  // Recorded on the edit in progress, so the save can carry it: the points block is
  // regenerated under the new id, but the `at:` references in the lines block are text
  // the server has to follow.
  if (state.editing) state.editing.renames.push({ kind: 'point', from: oldId, to: newId });

  state.selected = newId;
  state.formFor = undefined;   // the form is for a different id now; rebuild it
  // Saved HERE, not left to the blur that would normally do it — see renameVariant.
  endEdit();
  render();
}

/**
 * Which variants an edit to this point would reach.
 *
 * The Points and Lines tabs edit the CLUB's geometry, and the whole club is in scope
 * deliberately — this is where a survey is corrected or a mark that really moved is moved.
 * Nothing is blocked and nothing is cascaded; the consequences are made visible and then
 * tracked as dirty state.
 */
function affectsBlock(kind, id) {
  const users = affectedBy(kind, id);
  if (!users.length) return '';
  return `<div style="margin-top:10px"><div class="label">Moving this affects</div>${users
    .map((u) => `<div class="small"><span class="mono">${esc(u.course)}/${esc(u.variant)}</span>
      ${chip(u.course, u.variant)}</div>`).join('')}
    <p class="small muted" style="margin:4px 0 0">Published snapshots are untouched &mdash;
      they are fully inlined, so nothing a boat has been handed can change here.</p></div>`;
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

/**
 * The courses as the file wants them: variants, each with its own ad-hoc geometry.
 *
 * Built once and used twice — it is both the save payload and the undo slot's serialised
 * form — so a shape the server accepts is by construction a shape undo can put back.
 */
function coursesPayload() {
  const courses = {};
  for (const [id, course] of state.courses) {
    const variants = {};
    for (const [vid, v] of course.variants) {
      variants[vid] = {
        name: v.name ?? null,
        template: !!v.template,
        closed: !!v.closed,
        points: Object.fromEntries([...v.points].map(([pid, p]) => [pid, {
          name: p.name ?? null,
          latitude: p.latitude ?? null,
          longitude: p.longitude ?? null,
          notes: p.notes ?? null,
        }])),
        lines: Object.fromEntries([...v.lines].map(([lid, l]) => [lid, {
          name: l.name ?? null,
          port: cleanEnd(l.port),
          starboard: cleanEnd(l.starboard),
          notes: l.notes ?? null,
        }])),
        sequence: v.sequence.map((step) => ({
          line: step.gate?.length ? null : (step.line ?? null),
          cross: step.gate?.length ? null : senseOf(step),
          gate: (step.gate ?? []).map((a) => ({ line: a.line ?? null, cross: senseOf(a) })),
          lengthNm: step.lengthNm ?? null,
          // Only meaningful on a closed course, and dropped with it — a step cannot be
          // left carrying a marking that says something untrue about an open one.
          entry: !!(v.closed && step.entry),
          notes: step.notes ?? null,
        })),
        notes: v.notes ?? null,
      };
    }
    courses[id] = {
      name: course.name ?? null,
      public: !!course.public,
      notes: course.notes ?? null,
      variants,
    };
  }
  return courses;
}

/** The inverse, for undo. `variantIn` is the same reader the initial load uses. */
function coursesFrom(payload) {
  return new Map(Object.entries(payload).map(([id, c]) => [id, {
    id,
    name: c.name ?? null,
    public: !!c.public,
    notes: c.notes ?? null,
    variants: new Map(Object.entries(c.variants ?? {}).map(([vid, v]) => [vid, variantIn(vid, v)])),
  }]));
}

/** Everything an undo needs to put back. Serialised, so it cannot alias live state. */
function snapshot() {
  return {
    points: JSON.stringify([...state.points]),
    lines: JSON.stringify([...state.lines]),
    courses: JSON.stringify(coursesPayload()),
    selected: state.selected,
    selectedLine: state.selectedLine,
    selectedCourse: state.selectedCourse,
    selectedVariant: state.selectedVariant,
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
    && before.courses === JSON.stringify(coursesPayload());
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
  state.courses = coursesFrom(JSON.parse(back.courses));
  state.selected = back.selected;
  state.selectedLine = back.selectedLine;
  state.selectedCourse = back.selectedCourse;
  state.selectedVariant = back.selectedVariant;
  state.courseFormFor = undefined;
  state.formFor = undefined;
  // Renames have to be undone in the file as well as in memory: backwards, inverted, and
  // KEEPING THE KIND. Without the kind the server follows the wrong key — a line rename
  // undone as a point rename rewrites nothing, and the course step stays orphaned.
  save([...back.renames].reverse().map(({ kind, from, to }) => ({ kind, from: to, to: from })));
  render();
}

/**
 * Wait for whatever save is in flight.
 *
 * A snapshot is taken of what is ON DISK, so a variant edited a moment ago and not yet
 * written would be captured as it was before the edit — the one failure mode that would put
 * a design nobody drew in front of a fleet.
 */
async function flush() {
  await state.saving;
}

async function save(renames = []) {
  if (!state.key) return;
  state.saving = doSave(renames);
  await state.saving;
}

async function doSave(renames) {
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
  const courses = coursesPayload();
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
    // And so is the dirty state, which is a comparison against the file that was just
    // written: an edit that dirties three variants should say so as it lands, not on the
    // next reload.
    await loadLifecycle();
    renderList();
    if (state.tab === 'courses') syncCourseForm();
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
      const at = state.view.toPosition(px, py);
      // The true position while dragging; the grid only on commit, so a drag feels
      // continuous and the stored value is still on the metre.
      if (state.dragging.kind === 'point') {
        const point = GEO.points.get(state.dragging.id);
        if (point) Object.assign(point, at);
      } else if (state.dragging.kind === 'end') {
        const line = GEO.lines.get(state.dragging.id);
        if (line) Object.assign(line[state.dragging.side], at);
      } else if (state.dragging.kind === 'line') {
        const line = GEO.lines.get(state.dragging.id);
        if (line) {
          // BY the drag, not TO the cursor: taking hold anywhere on the midpoint and
          // having the line jump so its centre sat under the pointer would move it further
          // than the gesture asked for.
          if (!state.dragging.grab) state.dragging.grab = at;
          const dLat = at.latitude - state.dragging.grab.latitude;
          const dLon = at.longitude - state.dragging.grab.longitude;
          for (const side of ['port', 'starboard']) {
            line[side].latitude = state.dragging.from[side].latitude + dLat;
            line[side].longitude = state.dragging.from[side].longitude + dLon;
          }
        }
      } else {
        // The whole course, previewed live so the shape can be seen where it is going.
        // Committed only on release, and only after the sharing question is answered.
        if (!state.dragging.grab) state.dragging.grab = { at, px, py };
        const fn = courseTransform(state.dragging, at, px, py);
        for (const m of state.dragging.parts) Object.assign(m.obj, fn(m.from));
        note(state.dragging.label);
      }
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
      const drag = state.dragging;
      state.dragging = null;
      panning = null;
      // Put it back before asking. The move is applied by the mover, which may apply it
      // here, to a fresh ad-hoc copy, or to nothing at all.
      let done;
      if (drag.kind === 'point') {
        const point = GEO.points.get(drag.id);
        if (!point) { endEdit(); return; }
        const to = snap(point);
        Object.assign(point, drag.from);
        done = movePoint(drag.id, to);
      } else if (drag.kind === 'end' || drag.kind === 'line') {
        const line = GEO.lines.get(drag.id);
        if (!line) { endEdit(); return; }
        const to = drag.kind === 'end'
          ? snap(line[drag.side])
          : { port: snap(line.port), starboard: snap(line.starboard) };
        for (const side of ['port', 'starboard']) {
          if (drag.kind === 'end' && side !== drag.side) continue;
          Object.assign(line[side], drag.kind === 'end' ? drag.from : drag.from[side]);
        }
        done = moveLine(drag.id, drag.kind === 'end' ? drag.side : null, to);
      } else {
        const variant = currentVariant();
        const course = currentCourse();
        // Everything back where it started before the question is asked — the answer may
        // be to detach first, and the copies must be made from the untouched originals.
        for (const m of drag.parts) Object.assign(m.obj, m.from);
        if (!variant || !drag.transform) { render(); endEdit(); return; }
        done = transformCourse(variant, course, drag.transform,
          drag.kind === 'coursemove' ? 'Move' : 'Turn');
      }
      render();
      done.then(() => { render(); endEdit(); });
      return;
    }
    // A click, not a drag: the two are the same gesture until the mouse moves, so the
    // distinction has to be made here rather than on mousedown.
    if (panning && !panning.moved && placingArmed()) {
      const [px, py] = svgPx(ev);
      if (state.tab === 'lines') {
        const line = state.lines.get(state.selectedLine);
        const side = state.picking;
        // A known point if the click landed on one, an inline position if it did not.
        const at = pointNear(px, py);
        line[side] = at
          ? { at, infinite: !!line[side]?.infinite }
          : { ...snap(state.view.toPosition(px, py)), infinite: !!line[side]?.infinite };
        state.endMode[`${line.id}:${side}`] = at ? 'named' : 'inline';
        // Straight on to the other end while it has nowhere to be. Stopping between the two
        // halves of one gesture only to re-arm is a click nobody meant to make.
        const other = side === 'starboard' ? 'port' : 'starboard';
        state.picking = endPosition(line[other]) ? null : other;
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

  // Delegated, because the pane rebuilds its forms constantly and a second `?` inside one
  // of them would otherwise need its own wiring every time.
  const pop = el('infopop');
  document.addEventListener('mouseover', (ev) => {
    const info = ev.target.closest?.('.info');
    if (!info) return;
    pop.innerHTML = info.dataset.info ?? '';
    const box = info.getBoundingClientRect();
    pop.style.display = 'block';
    // Right-aligned to the icon and hanging below it, so a long explanation opens over
    // the chart rather than off the edge of the pane.
    pop.style.top = `${box.bottom + 6}px`;
    pop.style.left = `${Math.max(8, box.right - pop.offsetWidth)}px`;
  });
  document.addEventListener('mouseout', (ev) => {
    if (ev.target.closest?.('.info')) pop.style.display = 'none';
  });

  window.addEventListener('resize', render);
}

wire();
showTab('courses');
renderActions();
loadProgrammeList(null).catch((e) => {
  el('status').innerHTML = `<span class="warn">${esc(e.message)}</span>`;
});
