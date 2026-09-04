/**
 * Crossing detection: sense, extent, quality control, and the N-and-N latch.
 *
 * THIS IS THE HEART OF THE APPLICATION AND IT RUNS ON THE BOAT. It takes raw GNSS
 * fixes and decides whether a line was crossed and, if so, exactly when. Nothing here
 * needs a network, and no server ever re-runs it — the server stores what this
 * produced. If a copy of this logic ever appears in the Java, something has gone
 * wrong with the architecture, not with this file.
 *
 * The two tests, kept apart because conflating them is what makes infinite ends hard
 * to reason about:
 *
 *   SENSE   Which way did the boat cross? A sign test on the line's port-to-starboard
 *           orientation. It never involves where the ends are.
 *   EXTENT  Did the boat cross the line, or its extension out past a finite end? Only
 *           a finite end can fail this. An infinite end never can.
 *
 * The Mark screen's three states are exactly the combinations: approaching is neither
 * settled, crossed is both passed, missed is sense passed and extent failed.
 */

const M_PER_DEG_LAT = 111320;
const M_PER_NM = 1852;

/**
 * The resolution of the whole system: one metre.
 *
 * Every distance this application computes, displays or scores against is rounded to
 * the nearest metre, and it is declared once here so that no two parts of the system
 * can quietly disagree about how precise they are. GNSS on a phone does not honestly
 * resolve better than this, and a scoring edge that moves with the twelfth decimal
 * place of a float is a scoring edge nobody can reason about or argue in front of a
 * protest committee.
 *
 * The consequence is deliberate and blunt: at one-metre resolution, if you miss the
 * end of a line, you miss. There is no unresolved state at an endpoint and no band of
 * doubt to fall into. What the application owes the sailor instead is WARNING — the
 * Mark screen must say loudly that the COG projection is running near or past an end
 * long before the boat gets there. See {@link projectCog}.
 */
export const RESOLUTION_M = 1;

/** Every distance in the system passes through here. */
export const resolve = (metres) => Math.round(metres / RESOLUTION_M) * RESOLUTION_M;

/** 2D cross product z-component. Positive means b is anticlockwise from a. */
const cross = (a, b) => a.x * b.y - a.y * b.x;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });

/**
 * Project to a local tangent plane in metres, x east and y north, about an origin.
 *
 * A course spans a few kilometres, over which a tangent plane is accurate to far
 * better than the GNSS uncertainty the accuracy band already allows for. Working in
 * metres rather than degrees means the geometry below is ordinary plane geometry and
 * a perpendicular distance is a number a person can check against a chart.
 */
export function toLocal(origin, position) {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((origin.latitude * Math.PI) / 180);
  return {
    x: (position.longitude - origin.longitude) * mPerDegLon,
    y: (position.latitude - origin.latitude) * M_PER_DEG_LAT,
  };
}

/**
 * A line prepared for testing: its two ends in local metres, its port-to-starboard
 * vector, and which ends run on forever.
 */
export function prepareLine(line, origin) {
  const port = toLocal(origin, line.port);
  const starboard = toLocal(origin, line.starboard);
  const d = sub(starboard, port);
  const length = Math.hypot(d.x, d.y);
  if (length === 0) throw new Error(`line has zero length: ${line.id}`);
  return {
    id: line.id,
    port,
    starboard,
    d,
    length,
    portInfinite: !!line.portInfinite,
    starboardInfinite: !!line.starboardInfinite,
  };
}

/**
 * Signed perpendicular distance from the line, in metres. Positive is the side a
 * FORWARD crossing ends on.
 *
 * Sign convention, derived once so nothing downstream has to re-derive it: with the
 * port end to the west and the starboard end to the east, a forward crossing leaves
 * the port end to port and the starboard end to starboard, which means the boat is
 * heading north — from the southern side to the northern one. The northern side is
 * where cross(d, p - port) is positive. So forward is always negative to positive.
 */
export function signedDistanceM(prepared, point) {
  return resolve(cross(prepared.d, sub(point, prepared.port)) / prepared.length);
}

/**
 * How far along the line a point on it falls, in metres from the port end. Negative is
 * beyond the port end, greater than the line's length is beyond the starboard end.
 *
 * This is the extent test in the units a person can act on: "the projection cuts 30 m
 * past the pin end" is something a helm can steer against, where a parameter of 1.07
 * is not.
 */
export function alongM(prepared, t) {
  return resolve(t * prepared.length);
}

/**
 * Which side of the line a fix is on: +1, -1, or 0 for "not yet either".
 *
 * Zero is the accuracy band, and it is load-bearing. A boat is resolved to a side only
 * once it is clear of the line by more than the fix uncertainty; close in it is on
 * neither side, which is what stops a boat sitting on the line from emitting a burst
 * of phantom crossings. `bandM` null means use the fix's own stated accuracy, which is
 * more honest and makes the effective line width vary with the sky — an open question.
 */
export function side(prepared, point, accuracyM, bandM) {
  const band = bandM == null ? (accuracyM ?? 0) : bandM;
  const distance = signedDistanceM(prepared, point);
  if (Math.abs(distance) <= band) return 0;
  return distance > 0 ? 1 : -1;
}

/**
 * Where the segment a→b cuts the line, or null if it does not.
 *
 * Detection is the intersection of the segment between two successive quality fixes
 * with the line — NOT proximity to it. Proximity misreads a fast crossing of a thin
 * line, and it cannot give a clean crossing instant at all, which is the one quantity
 * a score depends on.
 *
 * Returns { u, t, point, withinExtent, sense } where u is the fraction along the
 * segment (which is what interpolates the time), t is the fraction along the line from
 * the port end to the starboard end, and withinExtent is the EXTENT test.
 */
export function intersect(prepared, a, b) {
  const r = sub(b, a);
  const denominator = cross(r, prepared.d);
  if (denominator === 0) return null; // parallel: no crossing

  const ap = sub(a, prepared.port);
  const u = -cross(ap, prepared.d) / denominator;
  if (u < 0 || u > 1) return null; // the cut is outside this segment

  const t = cross(ap, r) / cross(prepared.d, r);

  // EXTENT. t < 0 is beyond the port end, t > 1 beyond the starboard end. An infinite
  // end cannot be overrun, which is the whole of "only a finite end can be missed".
  const withinExtent =
    (t >= 0 || prepared.portInfinite) && (t <= 1 || prepared.starboardInfinite);

  // SENSE. Independent of extent, and of where the ends are.
  const sense = signedDistanceM(prepared, b) > signedDistanceM(prepared, a)
    ? 'forward'
    : 'reverse';

  return {
    u,
    t,
    withinExtent,
    sense,
    point: { x: a.x + u * r.x, y: a.y + u * r.y },
  };
}

/**
 * Quality control for one fix, against the last known-good one.
 *
 * Layered, outermost first, because a single out-of-position fix is more dangerous to
 * a line test than to almost anything else: if a flyer lands on the far side, the
 * segment out and the segment back BOTH cut the line, manufacturing a matched pair of
 * crossings the boat never made.
 *
 * The kinematic gate is the one that earns its keep. There is wide headroom between
 * real boat motion and a genuine flyer, so it has almost no false positives while
 * catching the gross outliers. Note that none of this is a smoother: a filter
 * aggressive enough to reject outliers also lags true position and biases the crossing
 * instant. Reject cleanly, then interpolate across the good fixes.
 */
export function qualityCheck(fix, lastGood, qc) {
  if (fix.satellites != null && fix.satellites < qc.minSatellites)
    return { verdict: 'REJECTED_METADATA', reason: `${fix.satellites} satellites` };
  if (fix.accuracyM != null && fix.accuracyM > qc.maxAccuracyM)
    return { verdict: 'REJECTED_METADATA', reason: `stated accuracy ${fix.accuracyM} m` };

  if (lastGood) {
    const seconds = (fix.time - lastGood.time) / 1000;
    if (seconds > 0) {
      const offset = toLocal(lastGood, fix);
      const metres = Math.hypot(offset.x, offset.y);
      const knots = (metres / seconds / M_PER_NM) * 3600;
      if (knots > qc.maxSpeedKn)
        return {
          verdict: 'REJECTED_KINEMATIC',
          reason: `implied ground speed ${knots.toFixed(0)} kn`,
        };
    }
  }
  return { verdict: 'ACCEPTED', reason: null };
}

/**
 * Watches one required crossing and latches it.
 *
 * Validity requires N consecutive quality fixes confirming the required side, a
 * segment that intersects the line, then N consecutive quality fixes confirming the
 * opposite side — the 3-and-3 rule at the default N. A single flyer cannot produce N
 * consecutive confirmed fixes on the far side, so it fails.
 *
 * Validity and timing are separate jobs. The confirmation decides WHETHER; the
 * interpolated instant decides WHEN, and it is never the time of any fix — taking it
 * from a confirming fix biases it early if from the last near-side fix and late if
 * from the first far-side one.
 *
 * Once a required-sense crossing is confirmed it LATCHES and stands. Nothing later can
 * un-make it, which makes the whole thing monotone and means no late bad fix can
 * corrupt a running parity. The taut-string winding test used for point marks is not
 * used here, because it is undefined for a line: a line holds no loops.
 */
export class CrossingDetector {
  constructor(prepared, requiredSense, options = {}) {
    this.line = prepared;
    this.requiredSense = requiredSense;
    this.confirmFixes = options.confirmFixes ?? 3;
    this.accuracyBandM = options.accuracyBandM ?? null;

    this.latched = null;
    this.rejected = [];

    // The current run of consecutive fixes resolved to one side, and which side. Runs
    // are tracked on BOTH sides, not just the required one: a boat arriving from the
    // far side is making a wrong-sense crossing, and the brief asks for those to be
    // logged for audit rather than merely ignored. A detector that only watched the
    // required side would not see them at all.
    this.runSide = null;
    this.runCount = 0;

    this.pending = null;
    this.afterCount = 0;
    this.lastPoint = null;
    this.lastFix = null;
  }

  /** The side a boat must be on before a crossing in the required sense. */
  get requiredSide() {
    return this.requiredSense === 'forward' ? -1 : 1;
  }

  /**
   * Offer one already-quality-checked fix, projected into the same local frame as the
   * line. Returns the crossing if this fix latched one, otherwise null.
   *
   * Projection is the caller's job rather than this class's, because every line on a
   * course must share one origin: a perpendicular distance computed against one frame
   * and compared against another is quietly wrong by however far apart the origins are.
   */
  accept(point, fix) {
    const here = side(this.line, point, fix.accuracyM, this.accuracyBandM);

    // A segment cuts the line, and the run behind it is long enough to be believed.
    if (this.pending == null && this.lastPoint) {
      const hit = intersect(this.line, this.lastPoint, point);
      if (hit && this.runSide !== null && this.runCount >= this.confirmFixes) {
        const time = new Date(
          this.lastFix.time.getTime() +
            hit.u * (fix.time.getTime() - this.lastFix.time.getTime())
        );
        this.pending = {
          ...hit,
          time,
          fromSide: this.runSide,
          confirmBefore: this.runCount,
        };
        this.afterCount = 0;
      }
    }

    if (this.pending) {
      if (here !== 0 && here === -this.pending.fromSide) {
        this.afterCount += 1;
        if (this.afterCount >= this.confirmFixes) this.settle(here);
      } else if (here === this.pending.fromSide) {
        // Came back without ever confirming the far side. Not a crossing — and this is
        // exactly the shape a single flyer makes.
        this.rejected.push({ ...this.pending, note: 'far side not confirmed' });
        this.pending = null;
        this.runSide = here;
        this.runCount = 1;
      }
    } else if (here !== 0) {
      if (here === this.runSide) this.runCount += 1;
      else {
        this.runSide = here;
        this.runCount = 1;
      }
    }

    this.lastPoint = point;
    this.lastFix = fix;
    return this.latched;
  }

  /**
   * A confirmed side change: score it, or log why not.
   *
   * The order matters. Sense is checked before extent because they answer different
   * questions and a crossing can fail either — a boat going the wrong way past the end
   * of a line has done two unrelated things wrong, and the audit line should name the
   * first one.
   */
  settle(here) {
    const crossing = this.pending;
    this.pending = null;
    // The far side is now the confirmed run, so a boat that crosses back is measured
    // from here rather than starting again from nothing.
    this.runSide = here;
    this.runCount = this.afterCount;

    if (crossing.sense !== this.requiredSense) {
      this.rejected.push({ ...crossing, note: 'wrong sense' });
      return;
    }
    if (!crossing.withinExtent) {
      this.rejected.push({
        ...crossing,
        note: `side change was past the ${crossing.t < 0 ? 'port' : 'starboard'} end`,
      });
      return;
    }
    // Monotone: once it has latched it stands, and a later crossing in the same sense
    // cannot move the time. Nothing here can un-make it either.
    if (this.latched) return;
    this.latched = {
      line: this.line.id,
      cross: this.requiredSense,
      time: crossing.time,
      confirmBefore: crossing.confirmBefore,
      confirmAfter: this.afterCount,
      counted: true,
    };
  }

  /** What the Mark screen shows: perpendicular distance and the state. */
  status(point) {
    const perpDistM = signedDistanceM(this.line, point);
    if (this.latched) return { state: 'crossed', perpDistM };
    const missed = this.rejected.some((r) => r.note.startsWith('side change was past'));
    return {
      state: missed ? 'missed' : 'approaching',
      perpDistM,
      confirmed: this.runSide === this.requiredSide ? this.runCount : 0,
    };
  }
}

/**
 * Where the boat's COG projection cuts the line, and whether that is somewhere it
 * should be worried about.
 *
 * This feeds the Mark screen's "Dist on COG" readout, the ring drawn where the
 * projection meets the line, and — the reason it carries a warning at all — the
 * endpoint problem. At one-metre resolution a finite end is a hard edge: a boat that
 * changes sides past it has missed, with no band of doubt to fall into. That is a
 * defensible rule only if the boat was told. So this reports the margin to the nearer
 * finite end while the boat is still approaching, and says plainly when the present
 * course is running out past it.
 *
 * Returns null when the projection does not meet the line ahead of the boat, which is
 * itself the answer the Mark screen wants: the "Dist on COG" cell shows a dash once
 * the COG no longer cuts the line.
 */
export function projectCog(prepared, point, cogDeg, options = {}) {
  const warnMarginM = options.warnMarginM ?? 50;
  const radians = ((90 - cogDeg) * Math.PI) / 180; // compass to maths convention
  const heading = { x: Math.cos(radians), y: Math.sin(radians) };

  const denominator = cross(heading, prepared.d);
  if (denominator === 0) return null; // steering parallel to the line

  const bp = sub(point, prepared.port);
  const distance = -cross(bp, prepared.d) / denominator;
  if (distance < 0) return null; // the line is behind us

  const t = cross(bp, heading) / cross(prepared.d, heading);
  const along = alongM(prepared, t);

  // Margin to the nearer end, counting only ends that can actually be missed. An
  // infinite end is not a hazard, so it contributes no margin.
  const toPort = prepared.portInfinite ? Infinity : along;
  const toStarboard = prepared.starboardInfinite ? Infinity : resolve(prepared.length) - along;
  const margin = Math.min(toPort, toStarboard);

  let warning = null;
  if (margin < 0) warning = 'beyond-end';
  else if (margin < warnMarginM) warning = 'near-end';

  return {
    distanceM: resolve(distance),
    t,
    alongM: along,
    marginM: Number.isFinite(margin) ? margin : null,
    withinExtent: (t >= 0 || prepared.portInfinite) && (t <= 1 || prepared.starboardInfinite),
    warning,
  };
}
