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
export function triangle(at, along, normal) {
  const base = { x: at.x, y: at.y };
  const apex = { x: at.x + normal.x * TRIANGLE.height, y: at.y + normal.y * TRIANGLE.height };
  const a = { x: at.x - along.x * TRIANGLE.half, y: at.y - along.y * TRIANGLE.half };
  const b = { x: at.x + along.x * TRIANGLE.half, y: at.y + along.y * TRIANGLE.half };
  return {
    base,
    apex,
    points: `${a.x.toFixed(1)},${a.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)} ${apex.x.toFixed(1)},${apex.y.toFixed(1)}`,
    // Where the letter goes: inside the triangle, a third of the way to the apex, which
    // keeps it clear of both the base and the point.
    label: { x: at.x + normal.x * TRIANGLE.height * 0.42, y: at.y + normal.y * TRIANGLE.height * 0.42 },
  };
}

/**
 * Colour along the course, from the start to the finish.
 *
 * Green through orange to red, which is not decoration: the start triangle is already
 * green and the finish red, so a leg's colour says how far through the course it is in
 * the vocabulary the diagram already uses. This is what lets four near-parallel legs up
 * the same beat be told apart at a glance, which was the thing that made the first
 * version unreadable.
 *
 * Colour is never the only channel — every segment also carries an arrow and the letter
 * of the step it leads to — so the drawing still works for a reader who cannot separate
 * green from red.
 */
export function rampColour(t) {
  const stops = [
    [0.0, [47, 208, 122]],   // --ok, matching the start triangle
    [0.5, [224, 138, 58]],   // --toside
    [1.0, [255, 95, 86]],    // --warn, matching the finish triangle
  ];
  const at = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  for (let i = 0; i + 1 < stops.length; i++) {
    const [t0, a] = stops[i];
    const [t1, b] = stops[i + 1];
    if (at <= t1 || i === stops.length - 2) {
      const f = t1 === t0 ? 0 : (at - t0) / (t1 - t0);
      const mix = a.map((v, k) => Math.round(v + (b[k] - v) * Math.max(0, Math.min(1, f))));
      return `rgb(${mix.join(',')})`;
    }
  }
  return 'rgb(255,95,86)';
}

const sub = (p, q) => ({ x: p.x - q.x, y: p.y - q.y });
const add = (p, v) => ({ x: p.x + v.x, y: p.y + v.y });
const scale = (v, k) => ({ x: v.x * k, y: v.y * k });
const negate = (v) => ({ x: -v.x, y: -v.y });
const len = (v) => Math.hypot(v.x, v.y);
const unit = (v) => { const l = len(v) || 1; return { x: v.x / l, y: v.y / l }; };
const rot90 = (v) => ({ x: -v.y, y: v.x });
const rot = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
/** Signed angle from u to v. Positive is clockwise on screen, because y runs down. */
const turn = (u, v) => Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y);
const mean = (points) => points.reduce(
  (acc, p) => ({ x: acc.x + p.x / points.length, y: acc.y + p.y / points.length }),
  { x: 0, y: 0 });
const xy = (p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;

/**
 * An arc leaving `from` on heading `h`, turning at radius `r` until it points at `target`.
 *
 * A boat crossing a line is committed to the crossing direction — that is what the
 * triangle's apex means — so it cannot be on the next leg's heading the instant it clears
 * the line. It has to turn, and a turn has a radius. Drawing an instant corner at the apex
 * says the boat pivots on the spot.
 *
 * SVG's sweep flag is the positive-angle direction, which with y running down is
 * clockwise on screen — the same sense as {@link turn} — so the two agree without a
 * correction. Never a large arc: `turn` returns at most half a circle.
 */
function arcFrom(from, heading, target, radius) {
  const wanted = unit(sub(target, from));
  const theta = turn(heading, wanted);
  if (Math.abs(theta) < 0.02) return null;      // already pointing there; no corner to round
  const centre = add(from, scale(rot90(heading), Math.sign(theta) * radius));
  return {
    end: add(centre, rot(sub(from, centre), theta)),
    sweep: theta > 0 ? 1 : 0,
  };
}

/** The mirror: an arc that ARRIVES at `to` already on heading `h`, coming from `source`. */
function arcTo(to, heading, source, radius) {
  // The same arc travelled backwards, which is why the sweep flag flips.
  const back = arcFrom(to, negate(heading), source, radius);
  return back && { start: back.end, sweep: back.sweep ? 0 : 1 };
}

/**
 * A path from one point to another that honours the heading at either end.
 *
 * Arc out, straight, arc in — any of the three may be absent. A heading of `null` means
 * that end is unconstrained and the path simply starts or finishes straight.
 *
 * The three passes are a fixed-point iteration: the departure arc has to aim at where the
 * arrival arc begins, and the arrival arc has to be aimed at from where the departure arc
 * ends, so each is computed against the other's current answer until they agree. It
 * settles in two; three is cheap insurance.
 */
function tangentPath(from, headingOut, to, headingIn, radius) {
  const span = len(sub(to, from));
  // A corner must never eat its own leg. On a short leg the radius shrinks rather than
  // the arc overshooting the mark it is turning around.
  const r = Math.max(1, Math.min(radius, span / 3));

  let straightFrom = from;
  let straightTo = to;
  let out = null;
  let into = null;
  for (let pass = 0; pass < 3; pass++) {
    out = headingOut ? arcFrom(from, headingOut, straightTo, r) : null;
    straightFrom = out ? out.end : from;
    into = headingIn ? arcTo(to, headingIn, straightFrom, r) : null;
    straightTo = into ? into.start : to;
  }

  let d = `M${xy(from)}`;
  if (out) d += ` A${r.toFixed(1)} ${r.toFixed(1)} 0 0 ${out.sweep} ${xy(out.end)}`;
  d += ` L${xy(straightTo)}`;
  if (into) d += ` A${r.toFixed(1)} ${r.toFixed(1)} 0 0 ${into.sweep} ${xy(to)}`;
  return { d, straightFrom, straightTo };
}

function segment(d, from, to, t, kind) {
  const direction = unit(sub(to, from));
  return {
    d,
    t,
    kind,
    mid: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
    // Degrees, for rotating an arrowhead onto the segment. Taken from the STRAIGHT part
    // of a path, which is where the arrow is drawn — an arrow on a curve points wrong.
    angle: (Math.atan2(direction.y, direction.x) * 180) / Math.PI,
  };
}

/** Build a segment from a tangent path, with the arrow on its straight portion. */
function tangentSegment(from, headingOut, to, headingIn, radius, t, kind) {
  const path = tangentPath(from, headingOut, to, headingIn, radius);
  const seg = segment(path.d, path.straightFrom, path.straightTo, t, kind);
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
 * <h2>Where a gate splits</h2>
 * At the gate, not halfway to it. The junction is the midpoint BETWEEN THE ALTERNATIVES
 * — the mean of their bases going in, of their apexes coming out — so the trunk runs to
 * the gate as one line and the two sides part company where the choice is actually made.
 * Splitting at the halfway point of the leg instead sent two long diagonals across open
 * water that crossed each other and crossed everything else.
 *
 * Both sides of a gate are the same tangent path as anything else: out of an apex on the
 * crossing heading, onto the trunk heading at the junction, and the mirror coming back.
 *
 * @param steps one entry per course step, each `{ crossings: [{base, apex}, ...] }` —
 *              more than one crossing where the step is a gate.
 */
export function track(steps, options = {}) {
  const radius = options.corner ?? 12;
  const segments = [];
  const span = Math.max(1, steps.length - 1);
  /** The heading a boat is on while crossing: base to apex, which is the required sense. */
  const heading = (crossing) => unit(sub(crossing.apex, crossing.base));

  steps.forEach((step, i) => {
    for (const crossing of step.crossings) {
      segments.push(segment(`M${xy(crossing.base)} L${xy(crossing.apex)}`,
        crossing.base, crossing.apex, i / span, 'crossing'));
    }
  });

  for (let i = 0; i + 1 < steps.length; i++) {
    const from = steps[i].crossings;
    const to = steps[i + 1].crossings;
    if (!from.length || !to.length) continue;
    const t = (i + 0.5) / span;

    const K = mean(from.map((c) => c.apex));
    const J = mean(to.map((c) => c.base));
    const trunk = unit(sub(J, K));

    // At a gate junction the branches have already turned the boat onto the trunk, so the
    // trunk itself starts and ends unconstrained. At a plain crossing the trunk is the
    // thing that has to turn.
    segments.push(tangentSegment(K, from.length > 1 ? null : heading(from[0]),
      J, to.length > 1 ? null : heading(to[0]), radius, t, 'leg'));

    if (from.length > 1) {
      for (const crossing of from) {
        segments.push(tangentSegment(crossing.apex, heading(crossing), K, trunk, radius, t, 'merge'));
      }
    }
    if (to.length > 1) {
      for (const crossing of to) {
        segments.push(tangentSegment(J, trunk, crossing.base, heading(crossing), radius, t, 'split'));
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
