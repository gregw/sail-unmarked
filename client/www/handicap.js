/*
 * DISTANCE-CORRECTED HANDICAPPING: each boat given its own line, placed by its TCF.
 *
 * A line with a `handicapWidthM` is a TRACK, and a step naming it does not ask a boat to cross
 * it: each boat's own line is centred on it. The midpoint is where a 1.000 boat's line sits, the
 * near end (`handicapNear`, decided by the server) is the lowest TCF the course can take and the
 * far end the highest. A boat's line is `handicapWidthM` wide and SQUARE TO THE TRACK, crossed
 * forward going from the near end towards the far — so every boat's line on a track is
 * parallel, and together they sweep the rectangle the editor stripes on the line itself.
 *
 * ONE SLIDE FOR THE WHOLE COURSE. Every handicapped step is placed at the same fraction `u` of
 * its track, −1 at the near end and +1 at the far end, and a boat of TCF t is given the `u` at
 * which the course is t times its nominal length. Every leg runs between two points moving in
 * straight lines, so the length is convex in `u`, the server has refused any course on which it
 * is not also increasing (`Handicap.java`), and one bisection finds it.
 *
 * This runs ON THE BOAT, from the snapshot, with no network: which line a boat must cross is
 * part of deciding its race, and that never waits on a server. The server only says which TCFs
 * the course can take (`tcfMin`, `tcfMax`), so a boat it cannot place is refused at the join.
 *
 * The legs are measured in the same local plane as `Handicap.java`, and only the handicapped
 * ones, as differences from the nominal length — so the plane and the sphere disagreeing by a
 * metre over a leg cancels rather than moving anybody's line.
 */

import { toLocal, fromLocal } from './crossing.js';

const M_PER_NM = 1852;

const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a, k) => ({ x: a.x * k, y: a.y * k });
const norm = (a) => Math.hypot(a.x, a.y);
const unit = (a) => { const n = norm(a); return n === 0 ? { x: 0, y: 0 } : scale(a, 1 / n); };

/** True when this snapshot places a line per boat, which is when it says what TCFs it takes. */
export const handicapped = (snapshot) =>
  snapshot?.tcfMin != null && snapshot?.tcfMax != null
  && (snapshot.steps ?? []).some((step) => step.handicapWidthM != null);

/** Where a crossing's ends are, as positions — the midpoint the legs are measured to. */
const midpoint = (crossing) => ({
  latitude: (crossing.port.latitude + crossing.starboard.latitude) / 2,
  longitude: (crossing.port.longitude + crossing.starboard.longitude) / 2,
});

/**
 * Every step's reference point in the local plane and how it slides with `u`, as the server
 * worked them out. Null when the snapshot has a step with nowhere to measure to.
 */
export function geometry(snapshot) {
  const steps = snapshot?.steps ?? [];
  const first = steps[0]?.crossings?.[0];
  if (!first?.port || first.port.latitude == null) return null;
  const origin = { latitude: first.port.latitude, longitude: first.port.longitude };

  const n = steps.length;
  const closed = !!snapshot.closed;
  const base = [];
  const tracks = [];
  for (const step of steps) {
    const crossings = step.crossings ?? [];
    if (!crossings.length || crossings.some((c) => c.port?.latitude == null || c.starboard?.latitude == null)) return null;
    if (step.handicapWidthM != null && crossings.length === 1) {
      const port = toLocal(origin, crossings[0].port);
      const starboard = toLocal(origin, crossings[0].starboard);
      base.push(scale(add(port, starboard), 0.5));
      tracks.push({ port, starboard });
    } else {
      // A gate is measured to the midpoint between its sides, successively, as the server does.
      let at = null;
      for (const crossing of crossings) {
        const m = toLocal(origin, midpoint(crossing));
        at = at ? scale(add(at, m), 0.5) : m;
      }
      base.push(at);
      tracks.push(null);
    }
  }
  const prev = (i) => (i > 0 ? i - 1 : closed ? n - 1 : i);
  const next = (i) => (i < n - 1 ? i + 1 : closed ? 0 : i);

  // WHICH END IS NEAR: the server's word on a snapshot. The editor draws a track before there is
  // one, and decides it by the server's rule — the end that makes the legs either side shorter,
  // against the nominal neighbours — because on a rectangle it sets which way forward points.
  const slide = [];
  const ends = [];
  steps.forEach((step, i) => {
    const track = tracks[i];
    if (!track) { slide.push({ x: 0, y: 0 }); ends.push(null); return; }
    let portNear = step.handicapNear === 'port';
    if (!step.handicapNear) {
      const via = (end) => norm(sub(end, base[prev(i)])) + norm(sub(base[next(i)], end));
      portNear = via(track.port) <= via(track.starboard);
    }
    const near = portNear ? track.port : track.starboard;
    const far = portNear ? track.starboard : track.port;
    slide.push(scale(sub(far, near), 0.5));
    ends.push({ near, far });
  });
  const legs = [];
  for (let i = 1; i < n; i += 1) legs.push([i - 1, i]);
  if (closed && n > 1) legs.push([n - 1, 0]);
  return {
    origin, base, slide, ends, closed, legs,
    nominalM: (snapshot.lengthNm ?? 0) * M_PER_NM,
    at: (i, u) => add(base[i], scale(slide[i], u)),
    slides: (i) => slide[i].x !== 0 || slide[i].y !== 0,
    prev,
    next,
  };
}

/** How much longer than nominal the course is with every track at `u`, in metres. */
export function deltaM(g, u) {
  let total = 0;
  for (const [from, to] of g.legs) {
    if (!g.slides(from) && !g.slides(to)) continue;
    total += norm(sub(g.at(to, u), g.at(from, u))) - norm(sub(g.base[to], g.base[from]));
  }
  return total;
}

/** The TCF a boat placed at `u` is handicapped to. */
export const tcfAt = (g, u) => 1 + deltaM(g, u) / g.nominalM;

/**
 * The fraction along every track at which a boat of this TCF is placed: −1 at the near ends,
 * 0 at the midpoints, +1 at the far ends.
 *
 * Clamped to the tracks, because the server rounds the range it admits inward to three places
 * and a TCF on its edge may sit a hair past the end in this arithmetic. Forty halvings is far
 * finer than the metre everything else is resolved to.
 */
export function fractionFor(g, tcf) {
  let lo = -1;
  let hi = 1;
  if (tcf <= tcfAt(g, lo)) return lo;
  if (tcf >= tcfAt(g, hi)) return hi;
  for (let k = 0; k < 40; k += 1) {
    const mid = (lo + hi) / 2;
    if (tcfAt(g, mid) < tcf) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Which way a boat crosses its line at step `i`: along the track, from the near end towards the
 * far, which is outward — the way the track takes a boat further round the course. The line
 * lies square to it.
 */
export function outward(g, i) {
  return unit(sub(g.ends[i].far, g.ends[i].near));
}

/**
 * One boat's line at step `i`, placed at `u`, as local ends.
 *
 * Named so a FORWARD crossing is the one heading `out`: with the heading north, port is to the
 * west — `crossing.js`'s convention, where forward runs from the negative side to the positive.
 * The step's own `cross` is then kept as it is, so the reverse button turns it round as it
 * turns any other line.
 */
export function lineAt(g, i, u, widthM) {
  const out = outward(g, i);
  const left = { x: -out.y, y: out.x };
  const centre = g.at(i, u);
  return {
    port: add(centre, scale(left, widthM / 2)),
    starboard: sub(centre, scale(left, widthM / 2)),
  };
}

/**
 * Everywhere a boat's line at step `i` can lie, as four positions round the rectangle: near end
 * to port, far end to port, far end to starboard, near end to starboard.
 */
export function envelope(snapshot, i, g = geometry(snapshot)) {
  const step = snapshot?.steps?.[i];
  if (!g || !g.ends[i] || step?.handicapWidthM == null) return null;
  const near = lineAt(g, i, -1, step.handicapWidthM);
  const far = lineAt(g, i, 1, step.handicapWidthM);
  return [near.port, far.port, far.starboard, near.starboard].map((p) => fromLocal(g.origin, p));
}

/** The id a boat's own line at a step goes by: the track's, and which step it is on. */
export const placedId = (track, index) => `${track}@${index}`;

/**
 * The lines placed for this TCF: the fraction along the tracks, and each line — which is what
 * the record carries, so a result can be explained long after this code has changed.
 */
export function place(snapshot, tcf) {
  const g = geometry(snapshot);
  if (!g || !handicapped(snapshot) || !(tcf > 0)) return null;
  const u = fractionFor(g, tcf);
  const lines = [];
  (snapshot.steps ?? []).forEach((step, i) => {
    if (!g.ends[i]) return;
    const track = step.crossings[0].line;
    const { port, starboard } = lineAt(g, i, u, step.handicapWidthM);
    lines.push({
      step: i, line: placedId(track, i), track,
      port: fromLocal(g.origin, port), starboard: fromLocal(g.origin, starboard),
    });
  });
  return { tcf, fraction: u, lines };
}

/**
 * The snapshot as THIS boat sails it: every handicapped step's track replaced by the boat's
 * own line, and the track and its zone kept beside it for drawing.
 *
 * The revision is left alone — the boat sailed the published course, at its handicap — and
 * `handicap` on the result says what was placed. A snapshot with nothing handicapped, or with
 * no TCF to place by, comes back unchanged; the server refuses to hand out the second.
 */
export function personalise(snapshot, tcf) {
  const placed = place(snapshot, tcf);
  if (!placed) return snapshot;
  const g = geometry(snapshot);
  const byStep = new Map(placed.lines.map((line) => [line.step, line]));
  return {
    ...snapshot,
    handicap: placed,
    steps: snapshot.steps.map((step, i) => {
      const line = byStep.get(i);
      if (!line) return step;
      const track = step.crossings[0];
      return {
        ...step,
        crossings: [{
          line: line.line,
          cross: track.cross,
          port: { ...line.port, infinite: false },
          starboard: { ...line.starboard, infinite: false },
        }],
        track,
        envelope: envelope(snapshot, i, g),
      };
    }),
  };
}

/**
 * THE ZONE OF A HANDICAP LINE ON ITS OWN, with no course round it: the rectangle its boats' lines
 * sweep, as four positions — port end to one side, starboard end to that side, starboard end to
 * the other, port end to the other. Which side is which needs a course; the shape does not, so
 * the editor draws it on the line itself.
 */
export function zone(port, starboard, widthM) {
  if (!port || !starboard || !(widthM > 0)) return null;
  const p = { x: 0, y: 0 };
  const s = toLocal(port, starboard);
  const along = unit(sub(s, p));
  if (along.x === 0 && along.y === 0) return null;
  const side = scale({ x: -along.y, y: along.x }, widthM / 2);
  return [add(p, side), add(s, side), sub(s, side), sub(p, side)].map((q) => fromLocal(port, q));
}

/**
 * The width a handicap line would have for its zone's edge to pass through `position`: twice how
 * far the position is from the line, square to it — what the editor's width grip is dragged by.
 */
export function widthThrough(port, starboard, position) {
  if (!port || !starboard || !position) return null;
  const s = toLocal(port, starboard);
  const q = toLocal(port, position);
  const length = norm(s);
  if (length === 0) return null;
  return Math.abs(2 * (s.x * q.y - s.y * q.x) / length);
}

/** Where the width grip sits: halfway along one long side of the zone. */
export function widthHandle(port, starboard, widthM) {
  const corners = zone(port, starboard, widthM);
  if (!corners) return null;
  return {
    latitude: (corners[0].latitude + corners[1].latitude) / 2,
    longitude: (corners[0].longitude + corners[1].longitude) / 2,
  };
}
