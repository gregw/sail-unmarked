/**
 * The Mark screen, as specified in the brief's section 5, and the course overview behind it.
 *
 * One screen in three states — approaching, crossed, missed. The line, the boat, its COG
 * projection and the readout cells are identical across all three; only the state and the
 * plotted data change. That is the brief's own emphasis and it is worth keeping: a sailor
 * glancing down mid-tack should not have to work out which screen they are looking at
 * before they can read it.
 *
 * <h2>There is no state chip</h2>
 * The arrow at the top carries the state itself. It reads NEXT LEG while approaching and
 * turns to THIS LEG the moment a crossing latches, and its colour is the state — grey
 * outline approaching, solid green crossed, bold red outline missed. A chip would put the
 * state in a corner where it competes with everything else; putting it in the one element
 * a sailor is already looking at for the next bearing means the state is read whether or
 * not anybody went looking for it.
 *
 * <h2>The plot says what the two tests decided</h2>
 * Every fix is coloured by the SIDE it was resolved to and drawn hollow when its foot fell
 * beyond a finite end. That is sense and extent made visible, separately, which is what
 * makes a miss explicable instead of merely announced: the colours change, so the boat did
 * change sides; the last few are hollow, so it did it past the end. A screen that printed
 * "missed" and nothing else would be asking to be disbelieved.
 *
 * Drawing only. Everything here takes the plain object `RaceClient.markState()` returns and
 * gives back a string, so the screens can be exercised without a boat and the client can be
 * exercised without a screen.
 */

import { LABEL, ROLE_COLOUR, TRIANGLE, arrowHead, forwardNormal, seats, track, triangle } from './coursedraw.js';
import { TRAIL_IN_VIEW, bearingLocal, clock } from './raceclient.js';

/** The three orientations the brief specifies, in the order the selector offers them. */
export const ORIENTATIONS = {
  leg: { label: 'Leg up', turns: true },
  north: { label: 'North up', turns: false },
  perp: { label: 'Line perp', turns: true },
};

/** The three-way selector, on every screen that can be turned — which is both of them. */
export const orientationBar = (orientation) =>
  `<div class="orient">${Object.entries(ORIENTATIONS).map(([key, spec]) =>
    `<button data-orient="${key}" class="${key === orientation ? 'on' : ''}">${esc(spec.label)}</button>`).join('')}</div>`;

/** Compass bearing of a vector given in local metres, x east and y north. */
export const bearingOf = (x, y) => (((Math.atan2(x, y) * 180) / Math.PI) + 360) % 360;

/**
 * The direction a boat must be travelling to make the required crossing, in local metres.
 *
 * Derived from the same sign convention `crossing.js` fixes once: forward runs from
 * negative signed distance to positive, and the gradient of that quantity is
 * `(-d.y, d.x) / length`. A reverse crossing is the same line travelled the other way, so
 * it is simply the negation — which is the whole of why a line crossed three times in one
 * course needs no extra geometry, only a sense per step.
 */
export function crossingNormal(prepared, required) {
  const sign = required === 'reverse' ? -1 : 1;
  return {
    x: (-prepared.d.y / prepared.length) * sign,
    y: (prepared.d.x / prepared.length) * sign,
  };
}

/**
 * Which compass bearing is drawn at the top of the plot.
 *
 * Leg up and Line perp both turn the whole display when the boat crosses onto the next
 * leg; North up never turns. Leg up falls back to the boat's COG when there is no next leg
 * to point at — at the finish of an open course — because a display that snapped to north
 * at the last mark would turn under the helm at the worst possible moment.
 */
export function upBearing(state, orientation) {
  if (orientation === 'north') return 0;
  if (orientation === 'perp') {
    const normal = crossingNormal(state.watched.prepared, state.watched.required);
    return bearingOf(normal.x, normal.y);
  }
  // The leg the boat is ON, not the one the arrow points at. Falling back to the COG rather
  // than to north at the finish of an open course, because a display that snapped to north at
  // the last mark would turn under the helm at the worst possible moment.
  return state.legUp ?? state.legBearing ?? state.cogDeg ?? 0;
}

/**
 * Local metres to plot pixels, with a bearing at the top.
 *
 * A point at bearing `b` and range `r` from the centre is drawn at screen angle `b - up`,
 * which expands to the rotation below. Screen y runs down while north runs up, so the
 * northward term is subtracted rather than added — the same flip `coursedraw` derives for
 * its normals, and the one thing in either file most worth checking by eye: at North up, a
 * point due north of the centre must come out ABOVE it.
 */
export function projector(centre, up, scale, width, height) {
  const radians = (up * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return (point) => {
    const x = point.x - centre.x;
    const y = point.y - centre.y;
    return {
      x: width / 2 + (x * cos - y * sin) * scale,
      y: height / 2 - (y * cos + x * sin) * scale,
    };
  };
}

/**
 * The smallest span the plot will zoom to, in metres across the shorter axis.
 *
 * A floor rather than a target: the whole system resolves to one metre, so a plot showing
 * fifteen metres across would be drawing detail that is not there. Forty is close enough to
 * see the accuracy band as a real width and still far enough that the boat does not fill it.
 */
export const MIN_SPAN_M = 40;

/**
 * The next-leg arrow, in pixels, and where it sits relative to the triangle.
 *
 * <b>`offset` is what keeps it off the triangle, whichever way it points.</b> The arrow is
 * drawn about its own CENTRE, and that centre is placed in line with the triangle's tip at
 * `offset` of the arrow's own length away — so the nearest the arrow can ever come to the
 * apex is `(offset - 0.5)` of its length, whatever bearing the next leg happens to be. At
 * 0.6 that is a tenth of its length of clear water in every direction, which is why the
 * number is a fraction of the arrow rather than a fixed gap: make the arrow bigger and the
 * clearance grows with it.
 */
export const ARROW = { shaft: 38, head: 11, width: 3.6, offset: 0.6 };

/**
 * The boat and the line are drawn at their REAL SIZE, which is how the plot shows closing.
 *
 * A boat glyph of a fixed pixel size says nothing about range: at four hundred metres and at
 * four it is the same picture, differing only in where things sit. Drawn to scale the two grow
 * together as the view closes in, and the moment the boat is a third the width of the line is
 * a moment nobody has to read a number to understand.
 *
 * Ten metres and five are assumptions, and they are the assumptions until there is somewhere to
 * put a real length: no boat has declared one, and the line's width is really the accuracy band,
 * which varies with the sky and belongs to `crossing.js` rather than to a drawing.
 *
 * Both are floored, because at four hundred metres a 10 m boat is ten pixels and would vanish,
 * and capped, because neither should ever swallow the plot.
 */
export const REAL = {
  boatM: 10,
  lineM: 5,
  boatPx: { min: 13, max: 90 },
  linePx: { min: 3, max: 46 },
};

/**
 * The crossing triangle is sized against the LINE, not against the plot.
 *
 * `coursedraw` deliberately draws its triangles at a fixed pixel size, and is right to: on the
 * editor's chart they are a notation laid over a course, and a notation that shrank with the
 * chart would stop being readable at exactly the zoom somebody uses to see a whole course.
 *
 * Here the opposite holds. The line beneath it is drawn at its real width and grows as the boat
 * closes, so a fixed triangle that was a bold marker at four hundred metres becomes a chip of
 * colour sitting on a band eight times its size — it stops reading as a thing ON the line and
 * starts reading as a blemish in it. Tied to the line's width the pair keep their proportions
 * all the way in, and the triangle goes on saying what it is there to say.
 *
 * Bounded at both ends all the same: a triangle that grew without limit would fill a plot that
 * is thirty metres across, and one that shrank without limit would be gone at four hundred. The
 * upper bound is set where it is because the invariant worth keeping is that the triangle stays
 * clearly PROUD of the line — the first value tried capped it at barely the line's own width
 * close in, which is the very thing the scaling was for.
 */
export const TRIANGLE_PER_LINE = { height: 3.4, half: 2.0, min: 0.55, max: 4.5 };

/** The triangle's height and base half-width in pixels, for a line drawn `lineW` wide. */
export function triangleFor(lineW) {
  const k = Math.max(TRIANGLE_PER_LINE.min, Math.min(TRIANGLE_PER_LINE.max,
    (lineW * TRIANGLE_PER_LINE.height) / TRIANGLE.height));
  return { height: TRIANGLE.height * k, half: TRIANGLE.half * k, scale: k };
}

/** The nominal length of the boat glyph's own path, in its own units. */
const BOAT_PATH_PX = 27;

/** A real length in metres, as pixels at this scale, kept inside legible bounds. */
export const atScale = (metres, scale, bounds) =>
  Math.max(bounds.min, Math.min(bounds.max, metres * scale));

/** The whole drawn length of the arrow, tail to tip. */
export const arrowLength = (grow = 1) => (ARROW.shaft + ARROW.head) * grow;

/**
 * When the plot is allowed to stop holding still.
 *
 * <b>A plot that re-fits every frame cannot show movement.</b> Centring on the boat — or on
 * anything that moves with it — keeps it in the same pixels however fast it is sailing, so
 * the one thing a sailor is looking for on the approach, whether they are actually closing
 * the line, is the one thing the picture cannot say. The line slides under a stationary boat,
 * which reads as the mark moving.
 *
 * So the frame is FROZEN and the boat moves across it, and it is given up only for the two
 * reasons that make holding it useless: the boat is about to leave the picture, or the amount
 * of water worth showing has changed enough that the scale is doing real harm. Both are
 * generous on purpose — a frame that re-fits on any small pretext is a frame that never held
 * still, which is the thing being fixed.
 */
export const HOLD = {
  /**
   * How close to the edge a component may get before the frame is rebuilt around it.
   *
   * A hair inside the boundary rather than exactly on it. The rule is "still in the view",
   * and waiting for something to be strictly outside means waiting until it has already
   * vanished for a frame — which is the one moment somebody is looking hardest at it.
   */
  edgeFraction: 0.06,
  /** How much closer in the view could usefully be before it is worth a jump. */
  scaleTolerance: 0.15,
};

/**
 * How fast the display swings round onto a new leg, in degrees per second.
 *
 * Slowly, and the slowness is the point. In Leg up and Line perp the whole world turns when a
 * boat crosses onto the next leg, and snapping it through ninety degrees between one frame and
 * the next destroys the one thing an oriented display is for — knowing, without thinking,
 * which way things are. A turn that is watched happening is a turn that is followed. Twenty-
 * five degrees a second puts the longest realistic swing comfortably inside the dwell, so the
 * display has settled by the time the crossed screen gives way to the next approach.
 */
export const TURN_DEG_S = 25;

/** The shortest way round from one bearing to another, in degrees, signed. */
export const turnBetween = (from, to) => ((((to - from) % 360) + 540) % 360) - 180;

/**
 * A bearing that chases another one instead of jumping to it.
 *
 * Its own object because BOTH screens turn. The Mark screen turns about one line and the
 * overview turns about a whole course, and they hold quite different things still — but the
 * swing itself is the same swing, and two copies of an easing that had to agree about what
 * "slowly" means would not stay agreed.
 */
export class Turner {
  constructor() {
    this.up = null;
    this.wanted = null;
    this.at = null;
  }

  /**
   * Ease toward `wanted`, in real time.
   *
   * Real time rather than a step per render, because the screens render at the fix rate and
   * on the animation frame respectively — a per-render step would make the same turn take a
   * different length of time depending on how fast the receiver happened to be going.
   *
   * `animate` is false for North up, which never turns, and the first call always snaps: a
   * display that swung into position when it opened would be showing the wrong thing for the
   * first second of every screen.
   */
  turn(wanted, animate, now = Date.now()) {
    this.wanted = wanted;
    if (this.up == null || !animate) {
      this.up = wanted;
    } else {
      const elapsed = Math.max(0, (now - (this.at ?? now)) / 1000);
      const delta = turnBetween(this.up, wanted);
      const most = TURN_DEG_S * elapsed;
      this.up = Math.abs(delta) <= most ? wanted : (this.up + Math.sign(delta) * most + 360) % 360;
    }
    this.at = now;
    return this.up;
  }

  /** True while still swinging, so the page knows to keep drawing. */
  turning() {
    return this.up != null && this.wanted != null
      && Math.abs(turnBetween(this.up, this.wanted)) > 0.5;
  }
}

/**
 * The frame the Mark screen is holding: where it is centred, how close in, and which way up.
 *
 * State, deliberately, and owned by the page rather than by the drawing — the plot is handed
 * one and asks it what to do, so the decision can be exercised on its own and a caller that
 * passes none simply gets the old fit-every-time behaviour.
 */
export class PlotView {
  constructor() {
    this.centre = null;
    this.scale = null;
    this.subject = null;
    /** The bearing actually at the top right now, which chases `wantedUp`. */
    this.up = null;
    this.wantedUp = null;
    this.turnedAt = null;
  }

  /**
   * Ease the displayed bearing toward the one wanted, in real time.
   *
   * Real time rather than a step per render, because the two screens render at the fix rate
   * and the animation frame respectively — a per-render step would make the same turn take a
   * different length of time depending on how fast the receiver happened to be going.
   *
   * `animate` is false for North up, which never turns, and the first draw always snaps: a
   * display that swung into position when it opened would be showing the wrong thing for the
   * first second of every screen.
   */
  turn(wanted, animate, now = Date.now()) {
    this.wantedUp = wanted;
    if (this.up == null || !animate) {
      this.up = wanted;
    } else {
      const elapsed = Math.max(0, (now - (this.turnedAt ?? now)) / 1000);
      const delta = turnBetween(this.up, wanted);
      const most = TURN_DEG_S * elapsed;
      this.up = Math.abs(delta) <= most ? wanted : (this.up + Math.sign(delta) * most + 360) % 360;
    }
    this.turnedAt = now;
    return this.up;
  }

  /** True while the display is still swinging, so the page knows to keep drawing. */
  turning() {
    return this.up != null && this.wantedUp != null
      && Math.abs(turnBetween(this.up, this.wantedUp)) > 0.5;
  }

  /**
   * Keep the frame, or rebuild it around what is wanted now.
   *
   * The identity check comes first and is absolute: a different line, a different lap or a
   * different orientation is a different picture, and holding a frame across one of those
   * would leave the boat somewhere off the edge of a view built for a mark it has left.
   *
   * After that there are exactly two reasons to give a frame up, and both are about the frame
   * having stopped being useful rather than about anything having merely changed: something
   * that has to be seen is about to leave it, or the view could usefully be a sixth closer in.
   */
  frame(wanted) {
    const { up, subject, centre, scale, points, width, height } = wanted;
    let why = 'held';
    // The displayed bearing is NOT part of the identity, because it changes continuously
    // while the display is swinging onto a new leg and a frame rebuilt on every degree of
    // that would be a frame that never held still. A deliberate change of orientation is a
    // different picture and reaches here inside `subject` instead.
    let keep = this.centre !== null && this.subject === subject;
    if (!keep) {
      why = this.centre === null ? 'first' : 'new mark';
    } else {
      const to = projector(this.centre, up, this.scale, width, height);
      const marginX = width * HOLD.edgeFraction;
      const marginY = height * HOLD.edgeFraction;
      const out = (points ?? []).some((point) => {
        const px = to(point);
        return px.x < marginX || px.x > width - marginX
          || px.y < marginY || px.y > height - marginY;
      });
      if (out) {
        keep = false;
        why = 'leaving the view';
      } else if (scale > this.scale * (1 + HOLD.scaleTolerance)) {
        // ZOOMING IN ONLY. A boat closing a line makes the useful scale grow steadily, and
        // giving up the frame each time it has grown a sixth is exactly the stepped zoom an
        // approach wants. Zooming back OUT on the same rule would undo it on every wobble —
        // and a boat that has genuinely gone away trips the test above instead, which is the
        // honest reason to rebuild rather than a number drifting.
        keep = false;
        why = 'closer in';
      }
    }
    if (!keep) {
      this.centre = centre;
      this.scale = scale;
      this.up = up;
      this.subject = subject;
    }
    return { centre: this.centre, scale: this.scale, reframed: !keep, why };
  }
}

const fmt = (value, places = 0) => (value == null || Number.isNaN(value) ? '—' : value.toFixed(places));
const deg = (value) => (value == null ? '—' : String(Math.round(value) % 360).padStart(3, '0'));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (value) => String(value ?? '').replace(/[&<>"]/g, (c) => ESC[c]);

/**
 * The plot: the line, the boat, the projection and the fixes, as one SVG string.
 *
 * The fit deliberately includes the boat, its recent fixes, the projection's cut and the
 * near part of the line, and nothing else. Anything further away is not what somebody a
 * hundred metres from a mark is looking at.
 */
export function plot(state, options = {}) {
  const width = options.width ?? 340;
  const height = options.height ?? 300;
  const orientation = options.orientation ?? 'north';
  const prepared = state.watched.prepared;
  const boat = state.point;

  // The foot of the perpendicular: the part of the line the boat is actually closing on.
  const alongUnit = { x: prepared.d.x / prepared.length, y: prepared.d.y / prepared.length };
  const offset = (boat.x - prepared.port.x) * alongUnit.x + (boat.y - prepared.port.y) * alongUnit.y;
  const foot = {
    x: prepared.port.x + alongUnit.x * offset,
    y: prepared.port.y + alongUnit.y * offset,
  };
  const at = (distance) => ({
    x: prepared.port.x + alongUnit.x * distance,
    y: prepared.port.y + alongUnit.y * distance,
  });

  // WHAT MUST STAY IN VIEW. The boat, the point on the line it is about to cross, the triangle
  // that says which way through, the arrow saying where the next leg goes, and the last few
  // fixes behind the boat — enough to see that it is under way and which way it has come.
  // Everything else was keeping the plot wide for no benefit: the line's ends, which on a
  // quarter-mile start line are a long way from anything that matters, and the rest of the
  // trail, which is history and can fall off the back.
  const seatAlong = Math.max(0, Math.min(prepared.length, offset));
  const seat = at(seatAlong);
  const cut = state.projection
    ? (() => {
      const radians = ((90 - state.cogDeg) * Math.PI) / 180;
      return {
        x: boat.x + Math.cos(radians) * state.projection.distanceM,
        y: boat.y + Math.sin(radians) * state.projection.distanceM,
      };
    })()
    : null;
  // THREE dots, not the whole trail. At 5 Hz two minutes of track reaches back a quarter of
  // a mile, and fitting all of it is what kept the plot wide; three is the fewest that still
  // shows a direction rather than a pair of points.
  const recent = (state.trail ?? state.fixes ?? []).slice(-TRAIL_IN_VIEW);
  const interesting = [boat, seat, ...(cut ? [cut] : []), ...recent];

  const view = options.view ?? new PlotView();
  // The bearing WANTED is derived from the course; the bearing SHOWN chases it, so a boat
  // crossing onto a new leg watches the world swing round rather than finding it already
  // swung. North up never turns and snaps by construction.
  const up = view.turn(upBearing(state, orientation), !!ORIENTATIONS[orientation]?.turns,
    options.now ?? Date.now());
  const radians = (up * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const spin = (p) => ({ x: p.x * cos - p.y * sin, y: p.y * cos + p.x * sin });
  const unspin = (p) => ({ x: p.x * cos + p.y * sin, y: p.y * cos - p.x * sin });
  const rotated = interesting.map(spin);

  // THE TRIANGLE AND THE ARROW ARE FIXED PIXEL SIZES, so they cannot be fitted as points in
  // metres: how far they reach depends on the very scale being solved for. Their DIRECTION
  // does not — both hang off the seat along the crossing normal and then along the next leg,
  // and each of those is settled by `up` alone — so the far tip is a known pixel offset from
  // a known metre point, and the fit is solved by iterating: pick a scale, see where the tip
  // lands in metres, fit again including it. `coursedraw.tangentPath` iterates for the same
  // reason; two passes is ample when the correction is a fifth of a view.
  const seatRot = spin(seat);
  const screenAlong = (() => {
    const turned = spin(alongUnit);
    return { x: turned.x, y: -turned.y };   // screen y runs down where metres run up
  })();
  const grow = state.state === 'crossed' ? 1.2 : 1;
  const crossNormal = (() => {
    const n = forwardNormal(screenAlong.x, screenAlong.y);
    const sign = state.watched.required === 'reverse' ? -1 : 1;
    return { x: n.x * sign, y: n.y * sign };
  })();

  /**
   * Where the next-leg mark sits and which way it runs, in pixels from the seat — for a
   * triangle of a given height.
   *
   * A function of the height rather than a constant, because the triangle is now sized against
   * the line, the line against the scale, and the scale is what the fit is solving for. The
   * same circularity the arrow already had, one level deeper, and answered the same way.
   */
  const legGeom = (triangleHeight) => {
    const length = arrowLength(grow);
    const reach = triangleHeight + length * ARROW.offset;
    const middle = { x: crossNormal.x * reach, y: crossNormal.y * reach };
    if (state.legBearing == null) return { middle, dir: null, length };
    const theta = ((state.legBearing - up) * Math.PI) / 180;
    return { middle, dir: { x: Math.sin(theta), y: -Math.cos(theta) }, length };
  };

  /** Both ends of the arrow, so the fit reserves room for it whichever way it points. */
  const decorFor = (triangleHeight) => {
    const leg = legGeom(triangleHeight);
    const half = leg.length * 0.5;
    return leg.dir
      ? [
        { x: leg.middle.x + leg.dir.x * half, y: leg.middle.y + leg.dir.y * half },
        { x: leg.middle.x - leg.dir.x * half, y: leg.middle.y - leg.dir.y * half },
      ]
      : [
        { x: leg.middle.x, y: leg.middle.y - 14 * grow },
        { x: leg.middle.x, y: leg.middle.y + 14 * grow },
      ];
  };

  /** The triangle's height at a given scale, which is what the line's width decides. */
  const triangleHeightAt = (px) => triangleFor(atScale(REAL.lineM, px, REAL.linePx)).height;

  const fit = (points) => {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const spanX = Math.max(MIN_SPAN_M, Math.max(...xs) - Math.min(...xs));
    const spanY = Math.max(MIN_SPAN_M, Math.max(...ys) - Math.min(...ys));
    return {
      scale: Math.min((width * 0.82) / spanX, (height * 0.82) / spanY),
      centre: {
        x: (Math.max(...xs) + Math.min(...xs)) / 2,
        y: (Math.max(...ys) + Math.min(...ys)) / 2,
      },
    };
  };

  // Three passes now, not two: the scale decides the line's width, which decides the
  // triangle's height, which decides where the arrow hangs — and only then is the scale
  // that must hold all of it known. It settles quickly because every step is a shrinking
  // correction, but there is one more link in the chain than there was.
  let solved = fit(rotated);
  for (let pass = 0; pass < 3; pass++) {
    const inMetres = decorFor(triangleHeightAt(solved.scale)).map((px) => ({
      x: seatRot.x + px.x / solved.scale,
      y: seatRot.y - px.y / solved.scale,
    }));
    solved = fit([...rotated, ...inMetres]);
  }
  const wantScale = solved.scale;
  // Centred on everything that has to be seen, which is now a precise list — rather than
  // between the boat and the line, which was a guess made when the list was not.
  const wantCentre = unspin(solved.centre);

  // ...and then held still, so the boat is seen to move across it. Without a view passed in
  // this is the old fit-every-frame behaviour, which is what the specs that draw one picture
  // want and what nothing on screen should use.
  const { centre, scale } = view.frame({
    up,
    subject: `${state.step.index}:${state.watched.line}:${state.lap ?? 1}:${orientation}`,
    centre: wantCentre,
    scale: wantScale,
    // Every one of them, not just the boat: the frame is worth holding only while all of
    // them are still in it, and the crossing point leaves first when a boat bears away.
    points: interesting,
    width,
    height,
  });
  const to = projector(centre, up, scale, width, height);

  let out = '';

  // How far an infinite end is run out before the viewport clips it: the diagonal, so it
  // reaches the corner whichever way the line lies.
  const reach = Math.hypot(width, height);

  // THE OTHER SIDE OF A GATE FIRST, so the focused one draws over it wherever they meet.
  // Deliberately NOT in the fit: it is shown where it happens to fall in view and never at the
  // cost of zooming out from the side the boat is actually sailing at. Drawing only one side
  // would say there is only one, and the choice is the boat's right up to the moment it
  // crosses.
  for (const other of state.alternatives ?? []) {
    out += crossingArt(other.prepared, other.required, {
      to, scale, boat, focused: false, reach,
    }).out;
  }

  // THE LINE BEING CROSSED, at its real width, with its ends said honestly: a finite end is a
  // dot that can be overrun, an infinite end runs on because it cannot be.
  const art = crossingArt(prepared, state.watched.required, {
    to, scale, boat, focused: true, missed: state.state === 'missed', reach,
  });
  out += art.out;
  const seatPx = art.seatPx;

  // THE NEXT LEG, in line with the triangle's tip and clear of it whichever way it points —
  // cross HERE, going THAT way, and then head THERE. Green and a fifth larger once the
  // crossing has latched, which is the one change of state the plot makes on its own: the
  // scale deliberately does not move, so growth and colour are what say something happened.
  //
  // An F where there is NO next leg, which happens at exactly one place on a course: the
  // finish of an open one. Crossing the second-last line still has a leg after it — the one
  // to the finish — and that leg has a bearing worth pointing at, so it gets an arrow like
  // any other. Only when nothing follows is there nothing to point at.
  // Off the triangle that was actually drawn, at the scale actually held — so the arrow keeps
  // its clearance whatever size the triangle came out.
  const nextLeg = legGeom(art.triangleHeight);
  const legAt = { x: seatPx.x + nextLeg.middle.x, y: seatPx.y + nextLeg.middle.y };
  const legColour = state.state === 'crossed' ? 'var(--ok)' : 'var(--muted)';
  if (!nextLeg.dir) {
    out += `<text x="${legAt.x.toFixed(1)}" y="${(legAt.y + 10).toFixed(1)}" text-anchor="middle"`
      + ` font-family="var(--disp)" font-size="${(30 * grow).toFixed(0)}" font-weight="700"`
      + ` fill="${legColour}" style="paint-order:stroke;stroke:var(--sea);stroke-width:4px">F</text>`;
  } else if (nextLeg.dir) {
    // THE DRAWN EXTENT IS EXACTLY `length`, tail to tip, and getting that wrong is what let
    // the arrow touch the triangle. `arrowHead` puts its point a further `size` BEYOND the
    // place it is given, so passing the intended tip as its anchor pushed the real tip a
    // head-length further out than the clearance allowed for — invisible at most bearings and
    // an overlap at the one that matters, a next leg doubling straight back down the last.
    const half = nextLeg.length * 0.5;
    const headSize = ARROW.head * grow;
    const along = (distance) => ({
      x: legAt.x + nextLeg.dir.x * distance,
      y: legAt.y + nextLeg.dir.y * distance,
    });
    const tail = along(-half);
    const anchor = along(half - headSize);      // so the head's point lands at +half
    const neck = along(half - headSize * 1.7);  // where the head's back corners are
    out += `<line x1="${tail.x.toFixed(1)}" y1="${tail.y.toFixed(1)}" x2="${neck.x.toFixed(1)}" y2="${neck.y.toFixed(1)}"`
      + ` stroke="${legColour}" stroke-width="${(ARROW.width * grow).toFixed(1)}" stroke-linecap="round"/>`;
    out += `<polygon points="${arrowHead(anchor, (Math.atan2(nextLeg.dir.y, nextLeg.dir.x) * 180) / Math.PI, headSize)}" fill="${legColour}"/>`;
  }

  // THE PERPENDICULAR, thin and dashed, with the distance written along it.
  const footPx = to(art.foot);
  const boatPx = to(boat);
  out += `<line x1="${boatPx.x.toFixed(1)}" y1="${boatPx.y.toFixed(1)}" x2="${footPx.x.toFixed(1)}" y2="${footPx.y.toFixed(1)}" stroke="var(--muted)" stroke-width="1.4" stroke-dasharray="2,4"/>`;
  // The number ON the line it measures, with no label. A cell somewhere else headed "Perp
  // dist" makes a reader match a word to a picture; the figure sitting on the dashes IS the
  // label, and needs no legend to be learned. Both readouts that describe a line on this plot
  // are drawn this way, which is also what freed the space the time-to-line now uses.
  out += onLine(boatPx, footPx, `${Math.round(Math.abs(state.perpDistM))} m`, 'var(--muted)');

  // THE COG PROJECTION, with a ring where it cuts. The ring is the warning made visual:
  // when it sits outside the line's ends, the present course is running out past the pin,
  // and it goes red to say so long before the boat gets there.
  if (cut) {
    const hit = to(cut);
    const colour = state.projection.warning === 'beyond-end'
      ? 'var(--warn)'
      : state.projection.warning === 'near-end' ? 'var(--toside)' : 'var(--line)';
    out += `<line x1="${boatPx.x.toFixed(1)}" y1="${boatPx.y.toFixed(1)}" x2="${hit.x.toFixed(1)}" y2="${hit.y.toFixed(1)}" stroke="var(--cog)" stroke-width="1.7" stroke-dasharray="7,5"/>`;
    out += onLine(boatPx, hit, `${Math.round(state.projection.distanceM)} m`, 'var(--cog)');
    out += `<circle cx="${hit.x.toFixed(1)}" cy="${hit.y.toFixed(1)}" r="6.5" fill="none" stroke="${colour}" stroke-width="2"/>`;
  }

  // THE FIXES, coloured by the side they were resolved to and hollow past an end. The
  // band's zero — neither side yet — is drawn muted rather than omitted, because a run of
  // fixes that resolved to NOTHING is a thing worth seeing: it is a boat sitting on a line.
  for (const fix of state.trail ?? []) {
    const px = to(fix);
    const colour = fix.side === 0 ? 'var(--muted)' : fix.side > 0 ? 'var(--toside)' : 'var(--fromside)';
    out += fix.beyond
      ? `<circle cx="${px.x.toFixed(1)}" cy="${px.y.toFixed(1)}" r="3.5" fill="var(--sea)" stroke="${colour}" stroke-width="2"/>`
      : `<circle cx="${px.x.toFixed(1)}" cy="${px.y.toFixed(1)}" r="3.5" fill="${colour}"/>`;
  }

  // THE CROSSING, ringed in green at the INTERPOLATED instant — never at a fix. Drawing it
  // on a fix would be drawing the wrong point: the crossing happened between two of them,
  // and which one it was drawn on would bias the picture the same way taking the time from
  // one biases the time.
  if (state.latched && state.latchedPoint) {
    const px = to(state.latchedPoint);
    out += `<circle cx="${px.x.toFixed(1)}" cy="${px.y.toFixed(1)}" r="8" fill="none" stroke="var(--ok)" stroke-width="2.5"/>`;
    out += `<circle cx="${px.x.toFixed(1)}" cy="${px.y.toFixed(1)}" r="3" fill="var(--ok)"/>`;
    out += `<text x="${(px.x - 14).toFixed(1)}" y="${(px.y + 14).toFixed(1)}" text-anchor="end" font-family="var(--mono)" font-size="11" fill="var(--ok)">${esc(hhmmss(state.latched.time))}</text>`;
  }

  // THE REJECTED CANDIDATES, marked where they happened. The brief asks for these to be
  // shown rather than swallowed: a boat told only that nothing counted has no way to tell a
  // miss from a bug in the application. But they are not all the same KIND of thing, and one
  // symbol for all of them said they were.
  for (const reject of state.rejected ?? []) {
    if (!reject.point) continue;
    out += rejectMark(to(reject.point), reject.note);
  }

  // THE BOAT, pointing along its COG. Turned by the COG less whatever is at the top, so
  // that at North up it points at its true bearing and at Leg up it points straight up
  // while the boat is on the leg.
  const boatK = atScale(REAL.boatM, scale, REAL.boatPx) / BOAT_PATH_PX;
  out += `<g transform="translate(${boatPx.x.toFixed(1)},${boatPx.y.toFixed(1)}) rotate(${(state.cogDeg - up).toFixed(1)}) scale(${boatK.toFixed(3)})">`
    + `<path d="M0,-15 L9,12 L0,6 L-9,12 Z" fill="var(--ink)" stroke="var(--sea)" stroke-width="${(1.2 / boatK).toFixed(2)}"/></g>`;

  out += northPointer(up, width);

  return `<svg class="plot" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${out}</svg>`;
}

/**
 * How large the two distances written on the plot's own lines are drawn.
 *
 * Big, because they are now the only numbers on the picture and they are read at a glance from
 * a tiller — and because the room for them came from somewhere: the four readout cells they
 * replaced took a third of the screen to say what the plot was already showing.
 */
export const LINE_LABEL_PX = 36;

/**
 * One crossing drawn: the line at its real width, its ends said honestly, and the triangle
 * that says which way through.
 *
 * <b>One routine for the focused crossing and for the other side of a gate</b>, because the
 * two must not drift apart: a subdued copy written separately would be the place a change to
 * how a line is drawn quietly failed to reach, and the reader would be looking at two lines
 * drawn to different rules without being told.
 *
 * Returns what the caller needs to hang the next-leg arrow off, so the arrow geometry has a
 * single source for where the triangle actually ended up.
 */
export function crossingArt(prepared, required, options) {
  const { to, scale, boat, focused = true, missed = false, reach = 900 } = options;
  const alongUnit = { x: prepared.d.x / prepared.length, y: prepared.d.y / prepared.length };
  const offset = (boat.x - prepared.port.x) * alongUnit.x + (boat.y - prepared.port.y) * alongUnit.y;
  const at = (distance) => ({
    x: prepared.port.x + alongUnit.x * distance,
    y: prepared.port.y + alongUnit.y * distance,
  });

  const port = to(at(0));
  const starboard = to(at(prepared.length));
  const span = Math.hypot(starboard.x - port.x, starboard.y - port.y) || 1;
  const screenUnit = { x: (starboard.x - port.x) / span, y: (starboard.y - port.y) / span };
  const lineW = atScale(REAL.lineM, scale, REAL.linePx);
  const fade = focused ? 0.9 : 0.3;

  // BUTT ENDS, not round. A round cap extends a stroke by half its width past the point it was
  // drawn to, which was invisible at three pixels and is half a boat-length once the line is
  // drawn at its real width — and it would extend it exactly where the extent test says the
  // line stops. A line that looks longer than it can be crossed is the one lie this must not
  // tell.
  let out = `<line x1="${port.x.toFixed(1)}" y1="${port.y.toFixed(1)}" x2="${starboard.x.toFixed(1)}"`
    + ` y2="${starboard.y.toFixed(1)}" stroke="var(--line)" stroke-width="${lineW.toFixed(1)}"`
    + ` stroke-linecap="butt" opacity="${fade}"/>`;

  for (const [end, infinite, direction] of [
    [port, prepared.portInfinite, -1],
    [starboard, prepared.starboardInfinite, 1],
  ]) {
    if (infinite) {
      // AS SUBSTANTIAL AS THE LINE ITSELF, near enough. An infinite end is not a weaker part
      // of the line — it is the part that cannot be missed, so if anything it is the safer
      // water to cross. Drawn as a thin fading hairline it read as the opposite: a boundary
      // petering out, something to stay inside. Same width, long dashes rather than short.
      const away = { x: end.x + screenUnit.x * reach * direction, y: end.y + screenUnit.y * reach * direction };
      const dash = Math.max(9, lineW * 1.6);
      out += `<line x1="${end.x.toFixed(1)}" y1="${end.y.toFixed(1)}" x2="${away.x.toFixed(1)}"`
        + ` y2="${away.y.toFixed(1)}" stroke="var(--line)" stroke-width="${(lineW * 0.85).toFixed(1)}"`
        + ` stroke-dasharray="${dash.toFixed(0)},${(dash * 0.55).toFixed(0)}" opacity="${(fade * 0.78).toFixed(2)}"/>`;
    } else {
      out += `<circle cx="${end.x.toFixed(1)}" cy="${end.y.toFixed(1)}" r="${missed ? 6.5 : 3}"`
        + ` fill="${missed ? 'none' : 'var(--line)'}" stroke="var(--line)" stroke-width="2"`
        + ` opacity="${missed ? 1 : fade * 0.6}"/>`;
      if (missed)
        out += `<text x="${end.x.toFixed(1)}" y="${(end.y - 11).toFixed(1)}" text-anchor="middle" font-family="var(--mono)" font-size="9" fill="var(--line)">END</text>`;
    }
  }

  const seat = to(at(Math.max(0, Math.min(prepared.length, offset))));
  const n = forwardNormal(screenUnit.x, screenUnit.y);
  const sign = required === 'reverse' ? -1 : 1;
  const crossNormal = { x: n.x * sign, y: n.y * sign };
  // Scaled with the line rather than fixed, and built by hand rather than through
  // `coursedraw.triangle` — that one is deliberately a fixed size, which is right on a chart
  // and wrong on a line drawn at its real width.
  const size = triangleFor(lineW);
  const mark = sizedTriangle(seat, screenUnit, crossNormal, size);
  // Filled where the boat is going, outlined where it might have. The shape says the sense
  // either way; the fill says which one this screen is about.
  out += focused
    ? `<polygon points="${mark.points}" fill="var(--line)"/>`
    : `<polygon points="${mark.points}" fill="none" stroke="var(--line)" stroke-width="${(1.6 * size.scale).toFixed(1)}" opacity="0.55"/>`;

  return { out, seatPx: seat, screenUnit, crossNormal, foot: at(offset), triangleHeight: mark.height };
}

/** A crossing triangle at a chosen size: the same shape `coursedraw` draws, scaled. */
export function sizedTriangle(at, along, normal, size) {
  const apex = { x: at.x + normal.x * size.height, y: at.y + normal.y * size.height };
  const a = { x: at.x - along.x * size.half, y: at.y - along.y * size.half };
  const b = { x: at.x + along.x * size.half, y: at.y + along.y * size.half };
  return {
    base: { x: at.x, y: at.y },
    apex,
    points: `${a.x.toFixed(1)},${a.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)} ${apex.x.toFixed(1)},${apex.y.toFixed(1)}`,
    height: size.height,
  };
}

/**
 * A figure written along a line on the plot, clear of it and the right way up.
 *
 * Offset perpendicular to the line rather than sitting on it, because a number drawn over a
 * dashed stroke is a number with a dashed stroke through it. Always upright, never rotated to
 * follow the line: a rotated label is unreadable at exactly the angles where a boat is closing
 * a mark fastest.
 */
export function onLine(from, to, text, colour) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const away = { x: -dy / length, y: dx / length };
  const at = {
    x: (from.x + to.x) / 2 + away.x * (LINE_LABEL_PX * 0.5),
    y: (from.y + to.y) / 2 + away.y * (LINE_LABEL_PX * 0.5),
  };
  return `<text x="${at.x.toFixed(1)}" y="${(at.y + 12).toFixed(1)}" text-anchor="middle"`
    + ` font-family="var(--mono)" font-size="${LINE_LABEL_PX}" fill="${colour}"`
    + ` style="paint-order:stroke;stroke:var(--sea);stroke-width:6px">${esc(text)}</text>`;
}

/**
 * How a rejected crossing candidate is drawn, which depends entirely on what it was.
 *
 * <b>Crossing the wrong way is not a mistake and must not be marked as one.</b> A boat that
 * finds itself on the far side of a line and comes back across it to set up properly has done
 * the ordinary thing — it happens on every start and every time somebody overstands — and the
 * detector logs it as a wrong-sense candidate because that is what it is, not because anything
 * went wrong. A RED cross there tells a sailor mid-manoeuvre that they have blown the mark,
 * which is both untrue and exactly the wrong moment to be told it. So it is a BLUE one: the
 * same shape, saying the same thing about what happened, in a colour that says nothing is
 * wrong. It happened, it counted for nothing, and there is nothing to fix.
 *
 * A red cross is kept for the one thing that IS a miss — changing sides past the end of the
 * line, where the crossing was in the right direction and simply did not happen on the line.
 *
 * A candidate that never confirmed its far side is neither: the boat dipped over and came
 * back, or a fix wobbled. It gets a small hollow ring, because saying nothing would hide it
 * and saying either of the other two would be a claim about it that is not true.
 */
export function rejectMark(px, note = '') {
  if (note.startsWith('wrong sense')) {
    // A BLUE CROSS, the same shape as the red one and unmistakably a different colour. It
    // was a tick, which was the right sentiment and the wrong mark: a thin stroke in the
    // orange already used for one side of the line, on a dark plot, at a glance, from a
    // cockpit — it simply could not be seen. Shape carries the fact that something was
    // rejected; colour carries whether that matters.
    return `<g stroke="var(--fromside)" stroke-width="2.6" stroke-linecap="round">`
      + `<line x1="${(px.x - 7).toFixed(1)}" y1="${(px.y - 7).toFixed(1)}" x2="${(px.x + 7).toFixed(1)}" y2="${(px.y + 7).toFixed(1)}"/>`
      + `<line x1="${(px.x + 7).toFixed(1)}" y1="${(px.y - 7).toFixed(1)}" x2="${(px.x - 7).toFixed(1)}" y2="${(px.y + 7).toFixed(1)}"/></g>`;
  }
  if (note.startsWith('side change was past')) {
    return `<g stroke="var(--warn)" stroke-width="2">`
      + `<line x1="${(px.x - 6).toFixed(1)}" y1="${(px.y - 6).toFixed(1)}" x2="${(px.x + 6).toFixed(1)}" y2="${(px.y + 6).toFixed(1)}"/>`
      + `<line x1="${(px.x + 6).toFixed(1)}" y1="${(px.y - 6).toFixed(1)}" x2="${(px.x - 6).toFixed(1)}" y2="${(px.y + 6).toFixed(1)}"/></g>`;
  }
  return `<circle cx="${px.x.toFixed(1)}" cy="${px.y.toFixed(1)}" r="5" fill="none"`
    + ` stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="2,2"/>`;
}

/** A fix time as the status line prints it. */
export function hhmmss(time) {
  if (!time) return '—';
  const at = time instanceof Date ? time : new Date(time);
  return [at.getHours(), at.getMinutes(), at.getSeconds()]
    .map((v) => String(v).padStart(2, '0')).join(':');
}

/**
 * The sentence under the readouts, which is the screen's audit trail in one line.
 *
 * It names what was decided and on what evidence — "Crossed 18:42:07. Required direction.
 * Latched. 3 + 3." — because the number of confirming fixes either side is what makes a
 * latch defensible, and a result nobody can interrogate is a result nobody will accept.
 */
export function statusLine(state) {
  if (state.state === 'crossed' && state.latched)
    return `Crossed ${hhmmss(state.latched.time)}. Required direction. Latched.`;
  if (state.state === 'missed') {
    const past = state.rejected.find((r) => r.note?.startsWith('side change was past'));
    return past ? `${past.note[0].toUpperCase()}${past.note.slice(1)}. No crossing.`
      : 'Side change was past the end. No crossing.';
  }
  if (state.projection?.warning === 'beyond-end')
    return `On this course you will pass ${fmt(Math.abs(state.projection.marginM))} m outside the end. No crossing.`;
  if (state.projection?.warning === 'near-end')
    return `Running close: ${fmt(state.projection.marginM)} m inside the end on this course.`;
  return `Approaching. Required side confirmed, ${state.confirmed} fix${state.confirmed === 1 ? '' : 'es'}.`;
}

/**
 * TIME TO LINE: how long until this boat crosses, at the course and speed it is making.
 *
 * The one number on this screen that is worth a whole line to itself. Perpendicular distance
 * and distance along the COG are both on the plot now, drawn on the very lines they measure,
 * and COG and SOG were taking up a third of the screen to say what the boat already knows and
 * what the plot already shows — the boat is drawn pointing along its COG, and its speed is the
 * thing the time is computed FROM.
 *
 * <b>The colour is the second question, and it is the more important one.</b> A projection can
 * be a perfectly good twenty seconds away and still be running out past the pin, so green means
 * the present course crosses the line and red means it does not. A red thirty is not a countdown
 * — it is thirty seconds' warning that the boat is about to sail past the end having scored
 * nothing, which is exactly the warning the one-metre hard edge obliges this screen to give.
 */
export function timeToLine(state) {
  const { seconds, crossing } = state.ttl ?? {};
  const colour = crossing ? 'ok' : 'missing';
  // A stale fix cannot say how long anything will take: the speed and course it was computed
  // from are both instantaneous, so an old answer is wrong rather than merely old.
  const shown = state.stale || seconds == null || !Number.isFinite(seconds) || seconds > 3600
    ? '—'
    : seconds >= 60
      ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`
      : String(Math.round(seconds));
  return `<div class="ttl ${colour}">
    <span class="label">TTL</span>
    <span class="value">${esc(shown)}</span>
    <span class="unit">${!state.stale && seconds != null && seconds < 60 ? 's' : ''}</span>
  </div>`;
}

/** The whole Mark screen: the header strip, the plot, the time to line and the status. */
export function markScreen(state, options = {}) {
  const orientation = options.orientation ?? 'north';
  const arrow = state.state === 'crossed'
    ? { text: 'THIS LEG', cls: 'crossed' }
    : state.state === 'missed' ? { text: 'NEXT LEG', cls: 'missed' } : { text: 'NEXT LEG', cls: '' };

  const cell = (label, value, unit) =>
    `<div><div class="label">${esc(label)}</div><div class="value">${esc(value)}<span class="unit">${esc(unit ?? '')}</span></div></div>`;

  return `
    <div class="bar">
      <span class="mono">${esc(hhmmss(state.time))}</span>
      <span class="mono muted">GPS ${state.satellites ?? '—'} SV</span>
      <span class="sp"></span>
      <strong class="disp">MARK ${esc(state.step.letter)}</strong>
      <span class="mono muted">${state.step.index + 1} / ${state.of}${state.lap > 1 ? ` &middot; lap ${state.lap}` : ''}</span>
    </div>
    ${orientationBar(orientation)}
    <div class="leg ${arrow.cls}">
      <svg viewBox="0 0 22 22" width="22" height="22"><polygon points="11,2 19,20 11,15 3,20" fill="currentColor"/></svg>
      <span class="disp">${arrow.text}</span>
      <span class="mono">${state.legBearing == null ? 'FINISH' : `${deg(state.legBearing)}&deg;`}</span>
    </div>
    ${plot(state, { ...options, orientation })}
    ${timeToLine(state)}
    <p class="status ${state.state}">${esc(statusLine(state))}</p>
    ${state.sinceGood > 0
      ? `<p class="signal warn">No usable fix &mdash; ${state.sinceGood} rejected in a row.</p>`
      : state.stale ? '<p class="signal warn">No fix.</p>' : ''}`;
}

/** Below this, DTW reads in metres; at or above it, in nautical miles. */
export const NM_FROM_M = 370;   // 0.2 nm

/**
 * A range, in the unit somebody would actually say it in.
 *
 * Nautical miles down the leg and metres close in, switching at a fifth of a mile. A single
 * unit is wrong at one end or the other: "0.03 nm" is not a number anybody steers by in the
 * last hundred metres, and "1 483 m" is not how a leg is described. Switching is safe here
 * only because the unit is printed beside the figure every time — the same readout with a
 * bare number would be a trap.
 */
export function distanceTo(metres) {
  if (metres == null || Number.isNaN(metres)) return { value: '—', unit: '' };
  return metres >= NM_FROM_M
    ? { value: (metres / 1852).toFixed(2), unit: 'nm' }
    : { value: String(Math.round(metres)), unit: 'm' };
}

/**
 * What the boat is steering at, named.
 *
 * <b>The line's own id, not just the mark letter.</b> A letter says where in the sequence
 * the boat is; the name says which piece of water, and that is what somebody checks a
 * course against — the sailing instructions and the club's chart both talk about the
 * leeward line, never about "mark 2". On a gate both names are given, because until the
 * choice is made both are the target and DTW is measured to the point between them.
 */
export function waypointRow(waypoint) {
  if (!waypoint) return '<div class="wpt"><span class="muted">Nothing to steer for.</span></div>';
  return `<div class="wpt">
    <span class="letter">${esc(waypoint.letter)}</span>
    <span class="name mono">${esc(waypoint.lines.join('  /  '))}</span>
    ${waypoint.gate ? '<span class="mono muted gate">gate</span>' : ''}
  </div>`;
}

/**
 * Which bearing the OVERVIEW puts at the top, for each of the three modes.
 *
 * The same three the Mark screen offers, because they are a property of the display and not
 * of one screen: somebody who has chosen Leg up has chosen how they read a chart, and having
 * that hold for the approach and then be abandoned the moment the course came back would be
 * two different conventions on one device.
 *
 * <b>Leg up here is the LEG, not the bearing to the mark.</b> On the approach those are
 * nearly the same thing; on an overview they are not, because a boat halfway up a beat is
 * pointing thirty or forty degrees off the rhumb line and a display that followed the boat
 * would swing back and forth on every tack. So the leg is measured mark to mark — from the
 * step behind to the step in front — which is fixed for the whole leg and is what "the leg"
 * means. With nothing behind it, at the start of an open course, it falls back to the bearing
 * to the first mark, which is the only leg there is.
 */
export function overviewUp(client, orientation) {
  if (orientation === 'north') return 0;
  const step = client.live();
  if (!step) return 0;
  if (orientation === 'perp') {
    const normal = crossingNormal(step.crossings[0].prepared, step.crossings[0].required);
    return bearingOf(normal.x, normal.y);
  }
  // One definition of "the current leg", shared with the approach screen: mark behind to mark
  // ahead. Two copies of it would be two things to keep agreeing, and the day they stopped
  // agreeing the two screens would be turned different ways with no way to tell which was
  // right.
  return client.legInto(step)
    ?? client.waypoint()?.bearingDeg
    ?? client.fix?.cogDeg
    ?? 0;
}

/**
 * A north pointer, for when north is not up.
 *
 * A rotated chart with no north reference is a chart you cannot relate to anything else — the
 * printed one on the nav table, the wind direction somebody called across the water, the
 * forecast. It costs a corner of the plot and it is drawn only when it is needed, which is
 * also what makes it informative: seeing it at all tells you the display is turned.
 */
export function northPointer(up, width) {
  if (Math.abs(((up % 360) + 360) % 360) < 0.5) return '';
  const x = width - 22;
  const y = 22;
  return `<g transform="translate(${x},${y}) rotate(${(-up).toFixed(1)})" opacity="0.75">`
    + `<path d="M0,-11 L5,6 L0,2 L-5,6 Z" fill="var(--muted)"/>`
    + `<text x="0" y="17" text-anchor="middle" font-family="var(--mono)" font-size="9"`
    + ` fill="var(--muted)" transform="rotate(${up.toFixed(1)})">N</text></g>`;
}

/**
 * The course overview: the whole course, with the boat on it.
 *
 * Drawn with the same `coursedraw` the editor uses, because the course a boat is shown on
 * the water and the course it was designed as must be the same picture. A second drawing
 * of the same geometry would be a second thing to keep right, and the first time the two
 * disagreed the sailor would be the one who found out.
 */
export function overview(client, options = {}) {
  const width = options.width ?? 340;
  const height = options.height ?? 300;
  const orientation = options.orientation ?? 'north';
  const points = [];
  for (const step of client.steps)
    for (const crossing of step.crossings)
      points.push(crossing.prepared.port, crossing.prepared.starboard);
  if (client.point) points.push(client.point);
  if (!points.length) return '<svg class="plot" viewBox="0 0 340 300"></svg>';

  // The whole course is ALWAYS fitted here — that is what an overview is for, and holding a
  // frame still would let a boat sail off the edge of its own course. It is the Mark screen,
  // where the question is "am I closing this line", that has to hold still.
  const up = (options.turner ?? new Turner())
    .turn(overviewUp(client, orientation), !!ORIENTATIONS[orientation]?.turns,
      options.now ?? Date.now());

  // Fitted in ROTATED space: a course that is long east-west needs a different scale once it
  // is stood on end, and fitting on the unrotated extent would crop it.
  const radians = (up * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const turned = points.map((p) => ({ x: p.x * cos - p.y * sin, y: p.y * cos + p.x * sin }));
  const xs = turned.map((p) => p.x);
  const ys = turned.map((p) => p.y);
  const spanX = Math.max(80, Math.max(...xs) - Math.min(...xs));
  const spanY = Math.max(80, Math.max(...ys) - Math.min(...ys));
  const scale = Math.min((width * 0.84) / spanX, (height * 0.84) / spanY);
  // The centre of the extent, taken back out of rotated space so the projector applies the
  // rotation itself rather than the two of them doing half each.
  const midX = (Math.max(...xs) + Math.min(...xs)) / 2;
  const midY = (Math.max(...ys) + Math.min(...ys)) / 2;
  const centre = { x: midX * cos + midY * sin, y: midY * cos - midX * sin };
  const to = projector(centre, up, scale, width, height);

  // How many crossings each line carries, so the ones that repeat can be seated along it
  // in course order rather than stacked. The leeward line of a windward/leeward is the
  // start, mark 2 and the finish, and drawing three triangles on one spot says none of it.
  const byLine = new Map();
  client.steps.forEach((step) => {
    for (const crossing of step.crossings) {
      if (!byLine.has(crossing.line)) byLine.set(crossing.line, []);
      byLine.get(crossing.line).push({ step, crossing });
    }
  });

  const placed = new Map();
  for (const [, uses] of byLine) {
    const a = to(uses[0].crossing.prepared.port);
    const b = to(uses[0].crossing.prepared.starboard);
    const screenLength = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const along = { x: (b.x - a.x) / screenLength, y: (b.y - a.y) / screenLength };
    const normal = forwardNormal(along.x, along.y);
    seats(uses.length, screenLength).forEach((atPx, i) => {
      const { step, crossing } = uses[i];
      const sign = crossing.required === 'reverse' ? -1 : 1;
      const seat = { x: a.x + along.x * atPx, y: a.y + along.y * atPx };
      placed.set(`${step.index}:${crossing.line}`, triangle(seat, along,
        { x: normal.x * sign, y: normal.y * sign }));
    });
  }

  let out = '';
  for (const [, uses] of byLine) {
    const a = to(uses[0].crossing.prepared.port);
    const b = to(uses[0].crossing.prepared.starboard);
    out += `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="var(--line)" stroke-width="2" opacity="0.75"/>`;
  }

  const steps = client.steps.map((step) => ({
    crossings: step.crossings.map((c) => placed.get(`${step.index}:${c.line}`)).filter(Boolean),
  }));
  for (const segment of track(steps, { closed: !!client.snapshot.closed })) {
    const crossing = segment.kind === 'crossing';
    out += `<path d="${segment.d}" fill="none" stroke="${crossing ? 'var(--muted)' : ROLE_COLOUR.leg}" stroke-width="1.4" opacity="0.5" stroke-dasharray="${crossing ? 'none' : '4,4'}"/>`;
  }

  client.steps.forEach((step) => {
    const done = client.crossings.some((c) => c.step === step.index && c.lap === client.lap);
    const live = step.index === client.at && !client.finished;
    for (const crossing of step.crossings) {
      const shape = placed.get(`${step.index}:${crossing.line}`);
      if (!shape) continue;
      const colour = live ? ROLE_COLOUR.start : done ? 'var(--muted)' : ROLE_COLOUR.leg;
      out += `<polygon points="${shape.points}" fill="${colour}" opacity="${live ? 1 : done ? 0.35 : 0.75}"/>`;
      out += `<text x="${shape.label.x.toFixed(1)}" y="${(shape.label.y + 4).toFixed(1)}" text-anchor="middle" font-family="var(--mono)" font-size="${LABEL.fontPx}" fill="var(--sea)">${esc(step.letter)}</text>`;
    }
  });

  if (client.point) {
    const px = to(client.point);
    // Turned by its COG less whatever is at the top, so the boat points its true way round
    // at North up and straight up the leg at Leg up.
    out += `<g transform="translate(${px.x.toFixed(1)},${px.y.toFixed(1)}) rotate(${((client.fix?.cogDeg ?? 0) - up).toFixed(1)})">`
      + `<path d="M0,-11 L7,9 L0,4.5 L-7,9 Z" fill="var(--ink)" stroke="var(--sea)" stroke-width="1"/></g>`;
  }

  out += northPointer(up, width);
  return `<svg class="plot" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${out}</svg>`;
}

/**
 * The race clock: when the boat started, when it finished, and how long it took.
 *
 * <b>Nothing at all until it has started</b>, because before that there is no elapsed time to
 * show and a zero would be a claim. Once the start line is behind, the instant it was crossed
 * and a clock running from it; once the finish is behind, both instants and a total that has
 * stopped moving — which is the moment the number turns from a reading into a result, so it is
 * marked as one.
 *
 * The instants come off the interpolated crossings rather than off the fixes that confirmed
 * them. That is the entire reason the crossing detector interpolates, and showing a fix time
 * here would throw the precision away at the last step.
 */
export function timingRow(client, now = Date.now()) {
  if (!client.startAt) {
    return '<div class="readout"><div><div class="label">Elapsed</div>'
      + '<div class="value">&mdash;</div></div></div>';
  }
  const done = client.complete();
  const cell = (label, value) =>
    `<div><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div></div>`;
  return `<div class="readout${done ? ' done' : ''}">
    ${cell('Started', hhmmss(client.startAt))}
    ${done ? cell('Finished', hhmmss(client.finishAt)) : ''}
    ${cell(done ? 'Elapsed &mdash; final' : 'Elapsed', clock(client.elapsed(now)))}
  </div>`;
}

/**
 * What the receiver is doing, said out loud, and only when it is not doing it well.
 *
 * A screen that quietly keeps showing the last good numbers while every new fix is being
 * thrown away is telling the sailor that everything is fine. It is the one state where the
 * application knows something is wrong and the person cannot see it, so it says how long it
 * has been, how many fixes went in the bin and why the most recent one did.
 */
export function signalLine(client, now = Date.now()) {
  if (!client.stale(now) && client.sinceGood === 0) return '';
  const since = client.sinceFix(now);
  const last = client.rejects[client.rejects.length - 1];
  if (client.sinceGood > 0) {
    return `<p class="signal warn">No usable fix for ${Math.round((since ?? 0) / 1000)} s &mdash; `
      + `${client.sinceGood} rejected. ${esc(last?.reason ?? '')}</p>`;
  }
  return `<p class="signal warn">No fix for ${Math.round((since ?? 0) / 1000)} s.</p>`;
}

/** The overview's header and the list of what has been crossed so far. */
export function overviewPanel(client, options = {}) {
  const now = options.now ?? Date.now();
  const step = client.live();
  const waypoint = client.waypoint();
  const range = distanceTo(waypoint?.distanceM);
  const stale = client.stale(now);
  return `
    <div class="bar">
      <span class="mono">${esc(hhmmss(client.fix?.time))}</span>
      <span class="mono muted">GPS ${client.fix?.satellites ?? '—'} SV</span>
      <span class="sp"></span>
      <strong class="disp">${esc(client.snapshot.name ?? client.snapshot.course)}</strong>
      <span class="mono muted">${esc(client.snapshot.revision)}</span>
    </div>
    ${orientationBar(options.orientation ?? 'north')}
    ${overview(client, options)}
    ${waypointRow(waypoint)}
    <!--
      BTW and DTW get a line to themselves, at twice the size. They are what the course screen
      is FOR — which way, and how far — and they were sharing a row with two numbers that are
      not: speed, which the boat can feel and which says nothing about where it is going, and
      elapsed, which matters once at the end. Sharing made all four small enough to need
      looking at rather than glancing at.
    -->
    <div class="steer${stale ? ' stale' : ''}">
      <div><div class="label">BTW</div><div class="value">${deg(waypoint?.bearingDeg)}<span class="unit">°</span></div></div>
      <div><div class="label">DTW</div><div class="value">${range.value}<span class="unit">${range.unit}</span></div></div>
    </div>
    ${timingRow(client, now)}
    ${signalLine(client, now)}
    <p class="status${client.complete() ? ' crossed' : ''}">${client.finished
      ? `Finished ${esc(hhmmss(client.finishAt))} in ${clock(client.elapsed(now))}, `
        + `${client.crossings.length} crossings latched.`
      : step
        ? `Sailing to mark ${esc(step.letter)}${client.snapshot.closed ? `, lap ${client.lap}` : ''}. The Mark screen comes up on its own.`
        : 'Waiting for a fix.'}</p>
    ${client.crossings.length === 0 ? '' : `<ul class="crossings mono">${client.crossings.slice().reverse().map((c) =>
      `<li><span class="ok">&check;</span> ${esc(c.letter)} &middot; ${esc(c.line)} &middot; ${esc(hhmmss(c.time))}${c.lap > 1 ? ` &middot; lap ${c.lap}` : ''}</li>`).join('')}</ul>`}`;
}

export { esc, fmt, deg };
