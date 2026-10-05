/**
 * Drawing a course: the sequence triangles on each line, and the track through them.
 *
 * Kept apart from the editor because it is geometry, not interface, and geometry is worth
 * testing. Everything here works in SCREEN PIXELS and takes the projection as a function,
 * so the spec can exercise it without a chart, a DOM or a map.
 *
 * The notation is the brief's, and the diagrams in `wiki/` are the reference: a triangle
 * whose base sits on the line, whose apex points the way you must cross, carrying its
 * sequence letter inside.
 */

/**
 * Which way a forward crossing points, in screen pixels.
 *
 * Derived once here so nothing downstream re-derives it, because it is easy to get
 * backwards and the drawing would still look plausible.
 *
 * In geographic terms a forward crossing leaves the port end to port and the starboard
 * end to starboard, which puts the boat on the side where `cross(portToStarboard, v)` is
 * positive — with x east and y NORTH. Screen y runs the other way, so converting flips
 * the handedness: for a port-to-starboard vector `(dx, dy)` in screen pixels, the forward
 * side is `(dy, -dx)`.
 *
 * Sanity check, and the one to re-run if this is ever doubted: a line drawn left to right
 * across the screen (port west, starboard east) has `(dx, dy) = (1, 0)`, giving `(0, -1)`
 * — straight up the screen, which is north, which is where a boat leaving a western port
 * end to port must be heading.
 */
export function forwardNormal(dx, dy) {
  const length = Math.hypot(dx, dy) || 1;
  return { x: dy / length, y: -dx / length };
}

/**
 * Base half-width and height of a sequence triangle, in pixels, and the closest two may
 * sit on one line.
 *
 * Sized to be read rather than to be small: these carry the course order, and a course
 * diagram whose letters cannot be made out is not saying anything.
 */
export const TRIANGLE = { half: 9.9, height: 16.5, minGap: 29 };

/**
 * How far down the leg the two sides of a gate come back together.
 *
 * Not at the gate: boats that took different sides sail their own line and converge near
 * the mark ahead, not at the one behind. Measured to the next crossing, or to the midpoint
 * of the next gate where the leg ends in one.
 *
 * Well down the leg rather than in the middle of it, because the two sides really are
 * separate routes for almost the whole leg — they only come together at the last moment,
 * as boats converge on the mark ahead.
 */
export const MERGE_FRACTION = 0.85;

/**
 * The labels: the letter inside a crossing's triangle, and the letter on a leg saying
 * where that leg goes.
 *
 * A leg's marker is ONE thing — a circle holding an arrowhead holding the letter — rather
 * than an arrow disc with a lettered disc beside it. Two circles per leg said two things
 * where there is one: this leg, going that way, to there.
 *
 * `arrowPx` is sized so the arrowhead's own centroid sits at the circle's centre and its
 * tip still clears `markR`; the letter then goes at that centroid.
 *
 * `hoverScale` is what a label grows to under the pointer. A course drawn small enough to
 * see whole has labels too small to read; rather than pick one, the drawing does both —
 * small enough for the shape of the course, and one hover away from legible.
 */
export const LABEL = { fontPx: 11, markR: 14, arrowPx: 11, hoverScale: 2 };

/**
 * Where each crossing of one line sits along it, in pixels along the port→starboard axis.
 *
 * A line can carry several crossings — the leeward line of a windward/leeward is the
 * start, mark 2 and the finish — so they are spread along it in course order rather than
 * stacked on top of each other.
 *
 * The triangles are a FIXED PIXEL SIZE and do not shrink with the chart, because their
 * job is to be read. When the line is too short on screen to seat them all, they are
 * spread at the minimum legible gap about the line's midpoint instead, overhanging the
 * ends rather than piling up: an unreadable pile says nothing, whereas an overhang still
 * says "these crossings, in this order, belong to this line".
 */
export function seats(count, screenLength) {
  if (count <= 0) return [];
  const needed = (count - 1) * TRIANGLE.minGap;
  if (needed <= screenLength) {
    // Comfortable: spread evenly, inset from the ends so a triangle never sits on one.
    const step = screenLength / (count + 1);
    return Array.from({ length: count }, (_, i) => step * (i + 1));
  }
  const start = screenLength / 2 - needed / 2;
  return Array.from({ length: count }, (_, i) => start + i * TRIANGLE.minGap);
}

/**
 * One triangle: the SVG polygon points, and where the track meets it.
 *
 * `base` is the midpoint of the base, which sits on the line, and `apex` is the tip. The
 * track arrives at the base and leaves from the apex, which is what makes the drawn track
 * pass through the line in the required direction rather than merely near it.
 */
export function triangle(at, along, normal, scale = 1) {
  // `scale` grows the whole triangle about its base — the boat's overview draws them larger as
  // the picture is zoomed in (`OVERVIEW_MARK`). One everywhere else.
  const height = TRIANGLE.height * scale;
  const half = TRIANGLE.half * scale;
  const base = { x: at.x, y: at.y };
  const apex = { x: at.x + normal.x * height, y: at.y + normal.y * height };
  const a = { x: at.x - along.x * half, y: at.y - along.y * half };
  const b = { x: at.x + along.x * half, y: at.y + along.y * half };
  return {
    base,
    apex,
    points: `${a.x.toFixed(1)},${a.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)} ${apex.x.toFixed(1)},${apex.y.toFixed(1)}`,
    // Where the letter goes: inside the triangle, a third of the way to the apex, which
    // keeps it clear of both the base and the point.
    label: { x: at.x + normal.x * height * 0.42, y: at.y + normal.y * height * 0.42 },
  };
}

/**
 * What a leg is FOR, as a colour.
 *
 * Not sequence position. On a cycle there is no sequence to
 * be far through — a boat begins and ends wherever it joined — and even on an open course
 * the useful question about a leg is not "how far along" but "does a lap start here, or
 * end here". Green and red are the same green and red the start and finish already use;
 * everything between is one neutral blue, so the two that matter stand out rather than
 * competing with five shades of orange.
 */
export const ROLE_COLOUR = {
  start: 'rgb(47,208,122)',    // --ok
  finish: 'rgb(255,95,86)',    // --warn
  leg: 'rgb(74,134,207)',      // --fromside
};

/**
 * A CYCLE'S ENTRY LINES, drawn in this wherever the course is: the lines a lap may begin and end
 * at. Gold, because they are every one of them a start and a finish and green or red alone would
 * say half of it — and because it is neither the line blue nor any colour a line's state wears.
 */
export const ENTRY_COLOUR = 'rgb(255,200,60)';

/**
 * The colour for a leg or a crossing, or null when it is both a start and a finish and
 * therefore needs a gradient from one to the other.
 *
 * A cycle's entry point is always both: the rule is that a line crossed to begin a lap is
 * crossed again the same way to end it, so the leg leaving one is somebody's first and the
 * leg arriving is somebody else's last.
 */
export function roleColour(starting, finishing) {
  if (starting && finishing) return null;
  if (starting) return ROLE_COLOUR.start;
  if (finishing) return ROLE_COLOUR.finish;
  return ROLE_COLOUR.leg;
}

const sub = (p, q) => ({ x: p.x - q.x, y: p.y - q.y });
const add = (p, v) => ({ x: p.x + v.x, y: p.y + v.y });
const scale = (v, k) => ({ x: v.x * k, y: v.y * k });
const len = (v) => Math.hypot(v.x, v.y);
const unit = (v) => { const l = len(v) || 1; return { x: v.x / l, y: v.y / l }; };
const rot90 = (v) => ({ x: -v.y, y: v.x });
const rot = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
/** Signed angle from u to v. Positive is clockwise on screen, because y runs down. */
const turn = (u, v) => Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y);
const lerp = (p, q, f) => ({ x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f });
const mean = (points) => points.reduce(
  (acc, p) => ({ x: acc.x + p.x / points.length, y: acc.y + p.y / points.length }),
  { x: 0, y: 0 });
const xy = (p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;

/** Below this a turn is no turn, and no arc is drawn for it. */
const NO_TURN = 0.02;

/**
 * One way of getting from `from` on heading `h1` to `to` on heading `h2`: turn, straight, turn.
 *
 * A boat crossing a line is committed to the crossing direction — that is what the triangle's
 * apex means — so it cannot be on the next leg's heading the instant it clears the line. It has
 * to turn, and a turn has a radius; drawing an instant corner at the apex says the boat pivots
 * on the spot. The same holds coming in: it is on the crossing heading before the base.
 *
 * `s1` and `s2` say which way each turn goes — +1 clockwise on screen, which is {@link turn}'s
 * positive sense and SVG's sweep flag, −1 anticlockwise, and 0 for an end with no heading,
 * which is a turning circle of no size. Each turn's circle sits on its own side of the heading,
 * and the straight is the tangent between the two circles: the outer one where both turn the
 * same way, the inner where they turn opposite ways. Null when the circles are too close for
 * an inner tangent.
 *
 * Exact rather than aimed: the straight leaves the first circle exactly where it heads for the
 * second, so nothing needs iterating into agreement.
 */
function candidate(from, h1, s1, to, h2, s2, r) {
  const c1 = h1 ? add(from, scale(rot90(h1), s1 * r)) : from;
  const c2 = h2 ? add(to, scale(rot90(h2), s2 * r)) : to;
  const between = sub(c2, c1);
  const offset = (s1 - s2) * r;
  const apart = len(between);
  if (apart * apart <= offset * offset + 1e-9) return null;
  const straight = Math.sqrt(apart * apart - offset * offset);
  // The centres' separation is the straight plus the two radii across it; unwinding that
  // gives the straight's direction.
  const d = rot(unit(between), -Math.atan2(-offset, straight));
  const p1 = h1 ? sub(c1, scale(rot90(d), s1 * r)) : from;
  const p2 = h2 ? sub(c2, scale(rot90(d), s2 * r)) : to;
  // Each turn the whole way round in its own sense: a turn the wrong side of nothing is
  // nearly a full circle, which is the honest length of going round that way.
  const sweep = (u, v, sign) => {
    let theta = turn(u, v);
    if (sign > 0 && theta < -NO_TURN) theta += 2 * Math.PI;
    if (sign < 0 && theta > NO_TURN) theta -= 2 * Math.PI;
    return Math.abs(theta) < NO_TURN ? 0 : theta;
  };
  const t1 = h1 ? sweep(h1, d, s1) : 0;
  const t2 = h2 ? sweep(d, h2, s2) : 0;
  return { c1, c2, p1, p2, t1, t2, r, length: r * (Math.abs(t1) + Math.abs(t2)) + straight };
}

/** A path as points, arcs and all — what the crossing test below runs along. */
function polyline(from, h1, path, to, h2) {
  const arc = (centre, start, theta) => {
    const n = Math.max(1, Math.ceil(Math.abs(theta) / (Math.PI / 16)));
    return Array.from({ length: n }, (_, k) => add(centre, rot(sub(start, centre), (theta * (k + 1)) / n)));
  };
  // The crossings either side belong to the test: a leg that cuts back through the triangle it
  // has just left, or the one it is making for, is as much a loop as one that crosses itself.
  const tail = TRIANGLE.height;
  return [
    ...(h1 ? [sub(from, scale(h1, tail))] : []),
    from,
    ...(path.t1 ? arc(path.c1, from, path.t1) : []),
    path.p2,
    ...(path.t2 ? arc(path.c2, path.p2, path.t2) : []),
    to,
    ...(h2 ? [add(to, scale(h2, tail))] : []),
  ];
}

/** How many times the line properly crosses itself, counting only segments not neighbours. */
function crossings(points) {
  const side = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const apart = (p, q) => (p > 1e-6 && q < -1e-6) || (p < -1e-6 && q > 1e-6);
  let count = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    for (let j = i + 2; j + 1 < points.length; j++) {
      const [a, b, c, e] = [points[i], points[i + 1], points[j], points[j + 1]];
      if (apart(side(a, b, c), side(a, b, e)) && apart(side(c, e, a), side(c, e, b))) count += 1;
    }
  }
  return count;
}

/**
 * A path from one point to another that honours the heading at either end.
 *
 * Arc out, straight, arc in — any of the three may be absent. A heading of `null` means
 * that end is unconstrained and the path simply starts or finishes straight.
 *
 * <b>Each turn may go either way, and the drawing picks.</b> Turning toward the next mark is
 * usually right and sometimes draws a loop: with the mark nearly astern and a little to one
 * side, turning that side swings the track out and it has to cut back across its own crossing,
 * where turning the other way goes round clean. So every combination is tried, and the one
 * drawn crosses itself and the crossings either side least, and is the shortest of those.
 */
function tangentPath(from, headingOut, to, headingIn, radius) {
  const span = len(sub(to, from));
  // A corner must never eat its own leg. On a short leg the radius shrinks rather than
  // the arc overshooting the mark it is turning around.
  const r = Math.max(1, Math.min(radius, span / 3));

  const sides = (heading) => (heading ? [1, -1] : [0]);
  const options = [];
  for (const s1 of sides(headingOut)) {
    for (const s2 of sides(headingIn)) {
      const path = candidate(from, headingOut, s1, to, headingIn, s2, r);
      if (path) options.push({ path, loops: crossings(polyline(from, headingOut, path, to, headingIn)) });
    }
  }
  const best = options.sort((a, b) => a.loops - b.loops || a.path.length - b.path.length)[0]?.path;
  if (!best) return { d: `M${xy(from)} L${xy(to)}`, straightFrom: from, straightTo: to };

  const arc = (theta, end) => ` A${r.toFixed(1)} ${r.toFixed(1)} 0 ${Math.abs(theta) > Math.PI ? 1 : 0} ${theta > 0 ? 1 : 0} ${xy(end)}`;
  let d = `M${xy(from)}`;
  if (best.t1) d += arc(best.t1, best.p1);
  // With no arc in, the straight runs to the mark itself rather than to where the tangent
  // met a circle of no turn, which is the same place give or take a rounding.
  d += ` L${xy(best.t2 ? best.p2 : to)}`;
  if (best.t2) d += arc(best.t2, to);
  return { d, straightFrom: best.t1 ? best.p1 : from, straightTo: best.t2 ? best.p2 : to };
}

function segment(d, from, to, t, kind, leg) {
  const direction = unit(sub(to, from));
  return {
    d,
    t,
    kind,
    // Which leg this belongs to, and which step it leads to. Every segment of one leg —
    // the trunk and both sides of a gate — leads to the same step, so they can all be
    // lettered with it.
    from: leg?.from,
    to: leg?.to,
    ends: { from: { ...from }, to: { ...to } },
    mid: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
    // Degrees, for rotating an arrowhead onto the segment. Taken from the STRAIGHT part
    // of a path, which is where the arrow is drawn — an arrow on a curve points wrong.
    angle: (Math.atan2(direction.y, direction.x) * 180) / Math.PI,
  };
}

/** Build a segment from a tangent path, with the arrow on its straight portion. */
function tangentSegment(from, headingOut, to, headingIn, radius, t, kind, leg) {
  const path = tangentPath(from, headingOut, to, headingIn, radius);
  const seg = segment(path.d, path.straightFrom, path.straightTo, t, kind, leg);
  seg.d = path.d;
  return seg;
}

/**
 * The track through a course, as drawable segments.
 *
 * A first approximation, deliberately: legs from the apex a boat leaves by to the base it
 * arrives at next. That draws the crossing through each line in the required direction,
 * and the leg between, which is enough to see whether a course reads the way it was meant.
 *
 * It is NOT a sailed track. Nothing here knows about beating, laylines, tide or which end
 * of a long line a boat would actually choose, so a windward leg is drawn as the straight
 * line no boat sails. The route between two marks is the boat's business; the point of
 * this drawing is the order and the sense.
 *
 * <h2>Turns have a radius</h2>
 * A boat leaves a triangle's apex still heading the way it crossed, and joins the next leg
 * only after turning — so the track arcs out of the apex, and arcs back in to the next
 * base to be on the crossing heading before it gets there. An instant corner would say the
 * boat pivots on the spot the moment it clears the line.
 *
 * <h2>Where a gate splits, and where it joins</h2>
 * <b>The split is at the gate.</b> Its junction is the midpoint BETWEEN THE ALTERNATIVES,
 * so the trunk runs to the gate as one line and the two sides part company where the
 * choice is actually made. Splitting at the halfway point of the leg instead sent two long
 * diagonals across open water that crossed each other and crossed everything else.
 *
 * <b>The join is not.</b> Converging again the instant the gate is cleared would draw
 * boats rejoining at the mark they have just left, which is not what happens: having taken
 * different sides, they sail their own line down the leg and only come together near the
 * next mark. So the merge junction sits {@link MERGE_FRACTION} of the way along the leg —
 * measured to the next crossing, or to the midpoint of the next gate where there is one.
 *
 * The asymmetry is the point. A choice is made at the gate and paid for over the leg that
 * follows, and drawing it symmetrically hid that.
 *
 * Both sides of a gate are the same tangent path as anything else: out of an apex on the
 * crossing heading, onto the trunk heading at the junction, and the mirror coming back.
 *
 * @param steps one entry per course step, each `{ crossings: [{base, apex}, ...] }` —
 *              more than one crossing where the step is a gate.
 */
export function track(steps, options = {}) {
  const radius = options.corner ?? 12;
  const mergeAt = options.mergeFraction ?? MERGE_FRACTION;
  const segments = [];
  const span = Math.max(1, steps.length - 1);
  /** The heading a boat is on while crossing: base to apex, which is the required sense. */
  const heading = (crossing) => unit(sub(crossing.apex, crossing.base));

  steps.forEach((step, i) => {
    for (const crossing of step.crossings) {
      segments.push(segment(`M${xy(crossing.base)} L${xy(crossing.apex)}`,
        crossing.base, crossing.apex, i / span, 'crossing', { from: i, to: i }));
    }
  });

  // The legs, and on a CYCLE one more: from the last mark back to the first. A closed
  // course is a loop, and drawing it open leaves the one gap a boat never sails.
  const pairs = [];
  for (let i = 0; i + 1 < steps.length; i++) pairs.push([i, i + 1]);
  if (options.closed && steps.length > 1) pairs.push([steps.length - 1, 0]);

  for (const [i, next] of pairs) {
    const from = steps[i].crossings;
    const to = steps[next].crossings;
    if (!from.length || !to.length) continue;
    const t = (i + 0.5) / span;
    const leg = { from: i, to: next };

    const K = mean(from.map((c) => c.apex));
    const J = mean(to.map((c) => c.base));
    // The split stays at the gate; the join is carried down the leg toward the next mark.
    const merge = from.length > 1 ? lerp(K, J, mergeAt) : K;
    const trunk = unit(sub(J, merge));

    // At a gate junction the branches have already turned the boat onto the trunk, so the
    // trunk itself starts and ends unconstrained. At a plain crossing the trunk is the
    // thing that has to turn.
    segments.push(tangentSegment(merge, from.length > 1 ? null : heading(from[0]),
      J, to.length > 1 ? null : heading(to[0]), radius, t, 'leg', leg));

    if (from.length > 1) {
      for (const crossing of from) {
        segments.push(tangentSegment(crossing.apex, heading(crossing), merge, trunk, radius, t, 'merge', leg));
      }
    }
    if (to.length > 1) {
      for (const crossing of to) {
        segments.push(tangentSegment(J, trunk, crossing.base, heading(crossing), radius, t, 'split', leg));
      }
    }
  }
  return segments;
}

/**
 * A darker shade of a colour, for text drawn ON that colour.
 *
 * A letter in the same colour as the triangle it sits in disappears wherever the two
 * touch. Darkening the text rather than lightening it keeps the letter the recessive
 * element — the shape carries the direction, the letter only says which step — and works
 * on a filled triangle, which a lighter tint would not.
 */
export function darken(colour, factor = 0.42) {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(colour);
  if (!m) return colour;
  return `rgb(${[1, 2, 3].map((i) => Math.round(Number(m[i]) * factor)).join(',')})`;
}

/**
 * Where the arrowhead's own centroid lands, relative to the point passed to
 * {@link arrowHead}, as a fraction of its size along the heading.
 *
 * The shape runs from -0.7 to +1 of its size, so its centroid is behind the point it is
 * drawn about. Anything wanting the arrow CENTRED on something — a circle, a letter —
 * has to correct for that rather than assume the two agree.
 */
export const ARROW_CENTROID = (1 - 0.7 - 0.7) / 3;

/** An arrowhead, as polygon points, centred on `at` and pointing along `angle` degrees. */
export function arrowHead(at, angle, size = 5) {
  const a = (angle * Math.PI) / 180;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const tip = { x: at.x + ux * size, y: at.y + uy * size };
  const left = { x: at.x - ux * size * 0.7 - uy * size * 0.8, y: at.y - uy * size * 0.7 + ux * size * 0.8 };
  const right = { x: at.x - ux * size * 0.7 + uy * size * 0.8, y: at.y - uy * size * 0.7 - ux * size * 0.8 };
  return `${xy(tip)} ${xy(left)} ${xy(right)}`;
}

/**
 * How a handicap's zone is drawn: the stripes every so many pixels, and how faint.
 *
 * Faint on purpose. It is not a line anybody crosses — it is everywhere somebody else's line
 * might be — and it has to read as a region under the course rather than as more course.
 */
export const STRIPES = { spacingPx: 6, opacity: 0.32, outline: 0.5, widthPx: 1 };

/**
 * EVERYWHERE A BOAT'S LINE CAN LIE at a handicapped step, as a striped rectangle.
 *
 * `corners` are the four screen points `handicap.js`'s `envelope` gives, in order: near end to
 * port, far end to port, far end to starboard, near end to starboard. Each stripe joins the
 * two long sides at the same fraction along them, so it is one of the lines a boat could be
 * given — the stripes are the possible lines themselves, not a texture laid over the shape.
 *
 * One drawing for the editor, the race screen and the boat's own overview, as every other
 * part of a course is.
 */
export function stripes(corners, options = {}) {
  if (!corners || corners.length !== 4) return '';
  const colour = options.colour ?? 'var(--line)';
  const spacing = options.spacingPx ?? STRIPES.spacingPx;
  const [nearPort, farPort, farStarboard, nearStarboard] = corners;
  const lengthPx = Math.max(
    Math.hypot(farPort.x - nearPort.x, farPort.y - nearPort.y),
    Math.hypot(farStarboard.x - nearStarboard.x, farStarboard.y - nearStarboard.y),
  );
  // Capped, so a zone zoomed to fill a big screen is a few hundred strokes and not
  // thousands.
  const count = Math.min(400, Math.max(2, Math.round(lengthPx / spacing)));
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  let d = '';
  for (let k = 0; k <= count; k += 1) {
    const t = k / count;
    const a = lerp(nearPort, farPort, t);
    const b = lerp(nearStarboard, farStarboard, t);
    d += `M${a.x.toFixed(1)},${a.y.toFixed(1)}L${b.x.toFixed(1)},${b.y.toFixed(1)}`;
  }
  const outline = corners.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return `<g class="handicap-stripes" pointer-events="none">`
    + `<polygon points="${outline}" fill="none" stroke="${colour}" stroke-width="${STRIPES.widthPx}"`
    + ` opacity="${options.outline ?? STRIPES.outline}"/>`
    + `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${STRIPES.widthPx}"`
    + ` opacity="${options.opacity ?? STRIPES.opacity}"/></g>`;
}
