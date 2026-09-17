/**
 * The client: what a boat holds while it is sailing a course, and what it decides.
 *
 * THIS RUNS ON THE BOAT AND TALKS TO NOBODY. It is handed a published snapshot once, at
 * join time, and from then on it is fed fixes and nothing else. No method here calls the
 * network, and none of them needs to: the crossing detection is `crossing.js`, which is
 * already entirely local, and everything this adds is bookkeeping on top of it — which
 * line is the live one, when to move to the next, and which screen the sailor should be
 * looking at.
 *
 * <h2>One origin for the whole course</h2>
 * Every line is projected into a single local frame, fixed at join time. `crossing.js`
 * says why in the one place it matters: a perpendicular distance computed against one
 * origin and compared against another is quietly wrong by however far apart the origins
 * are, and "quietly" is the problem — nothing would look broken, the marks would just be
 * in slightly the wrong places.
 *
 * <h2>Only the live step sees fixes</h2>
 * A course is a SEQUENCE, and the sequence is the model. On a two-lap windward/leeward the
 * leeward line is the start, mark 2 and the finish — one line, three steps — and each of
 * those steps has its own detector, which is exactly why the positional rule needs no
 * `role:` field. Fixes go only to the step that is live, so a boat crossing that line on
 * its way to the first windward mark cannot latch the finish it will not reach for another
 * twenty minutes.
 *
 * <h2>A gate is one step, and either side ends it</h2>
 * Both alternatives get a detector and both are offered every fix; the first to latch is
 * the one the boat took, and the step is done. Which side that was is recorded, because
 * the next leg's bearing depends on it — the one place in the model where a boat's choice
 * changes what it should be shown.
 */

import {
  CrossingDetector,
  RelocationWatch,
  prepareLine,
  projectCog,
  qualityCheck,
  resolve,
  side,
  signedDistanceM,
  toLocal,
} from './crossing.js';

const M_PER_NM = 1852;
const KN_TO_MS = M_PER_NM / 3600;

/**
 * When the Mark screen takes over from the course overview, and when it gives it back.
 *
 * <b>Distance alone is the wrong quantity, and time alone is worse.</b> A fixed radius
 * hands a drifting boat the Mark screen four minutes out and a skiff thirty seconds out,
 * for the same number of metres; but a pure time-to-line is meaningless the moment a boat
 * slows, stops, or is pointing away from the mark, and it would flick the screen about on
 * every lull. So it is the OR of the two, and each covers the other's blind spot: the
 * radius is the floor that works at any speed, and the time is what gets the screen up
 * early for a boat that is coming in fast.
 *
 * `exitM` is deliberately larger than `enterM`. Without that gap a boat holding station
 * near the start line — which is what a fleet does for the five minutes before a gun —
 * would flip between the two screens on GPS noise alone, several times a minute.
 */
export const APPROACH = {
  enterM: 100,
  exitM: 160,
  enterS: 30,
  /**
   * How long the Mark screen is held after a crossing latches.
   *
   * The moment of the cross is the one thing on this screen somebody will want to look at
   * twice — it carries the interpolated time that a protest would turn on — and cutting
   * straight back to the overview would take it away at exactly that moment. It also
   * makes the latch VISIBLE: without a dwell, a clean crossing at speed shows the green
   * state for a single frame.
   */
  dwellMs: 6000,
};

/** How many recent fixes the Mark screen plots behind the boat. */
export const TRAIL = 120;

/**
 * How many of those the approach view is required to keep on screen.
 *
 * Enough to see that the boat is under way and which way it has come, and no more. Fitting
 * the whole trail is what kept the plot wide — at 5 Hz two minutes of it reaches back a
 * quarter of a mile — and the older dots say nothing an approach needs. Three is the fewest
 * that still shows a direction rather than a pair of points.
 */
export const TRAIL_IN_VIEW = 3;

/**
 * How hard the time-to-line readout is smoothed, as a time constant in seconds.
 *
 * <b>The smoothing is applied to the INPUTS, not to the answer.</b> Time to line is distance
 * over speed, and the two behave quite differently: the distance is geometry and moves
 * smoothly, while the speed is the noisy one — a real receiver's SOG jumps about by a knot
 * between fixes even in flat water. Smoothing the quotient instead would lag the whole
 * readout, and lag is expensive here: the number is counting down, so two seconds of lag is
 * two seconds of error at exactly the moment it matters, in a number somebody is timing a
 * start on. Smoothing the inputs leaves the distance responsive and takes the jitter out of
 * the part that is actually jittering.
 */
export const TTL_TAU_S = 2;

/**
 * How much nearer the other side of a gate has to be before the display swaps to it.
 *
 * Early on the approach the two sides are within metres of each other, so the nearer one
 * changes hands on noise alone — and each change flicks the whole plot from one side of the
 * gate to the other and back. A fifth nearer is a real commitment, not a wobble.
 */
export const WATCH_HYSTERESIS = 0.8;

/**
 * The fastest the smoothed speed is allowed to change, in metres per second per second.
 *
 * <b>Averaging alone cannot defend a number like this and it is worth being clear why.</b> An
 * exponential smoother takes a fixed FRACTION of each new reading, so a single reading four
 * times the truth still moves the answer by a third of the way there — and because time to
 * line is distance over speed, a third of the way up a speed is most of the way down a time.
 * The displayed countdown would halve on one bad fix. Smoothing harder only trades that for
 * lag, which is the one thing a counting-down number cannot afford.
 *
 * So the defence is physics rather than statistics, and it is the same reasoning the kinematic
 * gate rests on: boats have bounded acceleration. A hull that reports going from five knots to
 * forty between one fix and the next has not accelerated, it has misreported, and a limit on
 * how fast the smoothed value may move rejects that while staying perfectly responsive to any
 * acceleration a boat can actually make. One and a half metres per second per second is
 * generous — well beyond a keelboat, and past a skiff surfing off a wave.
 */
export const MAX_ACCEL_MS2 = 1.5;

/**
 * How long a fix goes on being treated as current.
 *
 * SOG and COG are instantaneous quantities and a stale one is not merely old, it is WRONG:
 * a boat whose fixes are being refused shows the speed and heading it had when the trouble
 * started, which on the water reads as "everything is fine" at precisely the moment it is
 * not. Position degrades more gracefully — last known is still roughly where you are — so
 * BTW and DTW stay up, with the staleness said out loud beside them.
 */
export const STALE_MS = 4000;

/** `FORWARD` off the wire, `forward` in the detector. One place, so it cannot drift. */
const sense = (value) => String(value ?? '').toLowerCase() === 'reverse' ? 'reverse' : 'forward';

/** The first end anywhere on the course that has coordinates — the local frame's origin. */
export function originOf(snapshot) {
  for (const step of snapshot?.steps ?? []) {
    for (const crossing of step.crossings ?? []) {
      for (const end of [crossing.port, crossing.starboard]) {
        if (end && end.latitude != null && end.longitude != null)
          return { latitude: end.latitude, longitude: end.longitude };
      }
    }
  }
  return null;
}

/** The midpoint of a crossing's two ends: the point legs are measured to and drawn to. */
export function midpointOf(crossing) {
  const { port, starboard } = crossing;
  if (!port || !starboard || port.latitude == null || starboard.latitude == null) return null;
  return {
    latitude: (port.latitude + starboard.latitude) / 2,
    longitude: (port.longitude + starboard.longitude) / 2,
  };
}

/** Compass bearing between two local points, 0 north, as the readouts show it. */
export function bearingLocal(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return 0;
  return (((Math.atan2(dx, dy) * 180) / Math.PI) + 360) % 360;
}

/**
 * One boat's run at one published snapshot.
 *
 * Constructed once, when the join succeeds, and then fed fixes for the rest of the race.
 * Everything it knows is in it; there is nothing to fetch and nothing to wait for.
 */
export class RaceClient {
  constructor(snapshot, options = {}) {
    this.snapshot = snapshot;
    this.boat = options.boat ?? {};
    this.joinMode = options.joinMode ?? 'ANONYMOUS';
    this.approach = { ...APPROACH, ...(options.approach ?? {}) };

    const defaults = snapshot.defaults ?? {};
    this.confirmFixes = defaults.confirmFixes ?? 3;
    this.accuracyBandM = defaults.accuracyBandM ?? null;
    this.qc = {
      minSatellites: defaults.qc?.minSatellites ?? 4,
      maxAccuracyM: defaults.qc?.maxAccuracyM ?? 25,
      maxSpeedKn: defaults.qc?.maxSpeedKn ?? 40,
    };

    this.origin = options.origin ?? originOf(snapshot);
    if (!this.origin) throw new Error('this course has no surveyed positions to sail to');

    // Geometry, prepared once. The lines do not move while a boat is sailing — that is
    // the whole safety property a snapshot exists for — so preparing them per fix would
    // be doing the same trigonometry several times a second for no reason.
    // A step with no crossings is dropped — a snapshot should never contain one, since the
    // server refuses to capture a variant naming a line it cannot resolve, but an archive
    // written by an older build might. Dropped BEFORE `index` is assigned, so that index is
    // always the position in this array: `at` counts through these steps, and an index taken
    // from the snapshot would silently point at a different step from the one being sailed.
    this.steps = (snapshot.steps ?? [])
      .filter((step) => (step.crossings ?? []).length > 0)
      .map((step, index) => ({
      index,
      letter: step.letter,
      entry: !!step.entry,
      legNm: step.legNm ?? null,
      crossings: (step.crossings ?? []).map((crossing) => ({
        line: crossing.line,
        required: sense(crossing.cross),
        midpoint: midpointOf(crossing),
        prepared: prepareLine({
          id: crossing.line,
          port: crossing.port,
          starboard: crossing.starboard,
          portInfinite: !!crossing.port?.infinite,
          starboardInfinite: !!crossing.starboard?.infinite,
        }, this.origin),
      })),
    }));

    this.at = 0;
    this.lap = 1;
    this.finished = false;
    this.crossings = [];       // what latched, in order: the record being built
    this.rejects = [];         // QC refusals and rejected candidates, for the audit trail
    this.fixes = [];           // recent accepted fixes, projected, for the plot
    this.lastGood = null;
    this.point = null;         // where the boat is, in the local frame
    this.fix = null;
    this.startedAt = null;      // the first fix — not the race clock, see startAt
    this.startAt = null;        // when the line that begins the run was crossed
    this.finishAt = null;       // when the one that ends it was
    this.dwellUntil = 0;
    this.crossed = null;
    this.showingMark = false;
    // AUTO: the application decides. See `view`.
    this.viewMode = 'auto';
    this.relocations = 0;
    this.smoothSogMs = null;      // metres per second, smoothed
    this.smoothCogM = null;       // metres along the COG to the cut, smoothed
    this.sinceGood = 0;        // rejected fixes since the last accepted one
    this.fixSeconds = null;    // how fast fixes are arriving, for the confirmation estimate
    this.relocation = new RelocationWatch(this.qc, { confirmFixes: this.confirmFixes });

    this.arm();
  }

  /**
   * Give the live step fresh detectors.
   *
   * Called on every advance, which on a cycle means once per step per LAP. A detector is
   * monotone by design — once it latches it stands, and nothing later can un-make it —
   * which is right within a lap and wrong across laps: the second time round the same
   * line, a boat has to cross it again, and a latch left over from the first lap would
   * say it already had.
   */
  arm() {
    const step = this.live();
    if (!step) return;
    for (const crossing of step.crossings) {
      crossing.detector = new CrossingDetector(crossing.prepared, crossing.required, {
        confirmFixes: this.confirmFixes,
        accuracyBandM: this.accuracyBandM,
      });
    }
  }

  /** The step the boat is working on, or null once an open course is complete. */
  live() {
    return this.finished ? null : (this.steps[this.at] ?? null);
  }

  /** The step after the live one, wrapping on a cycle. What the top arrow points at. */
  next() {
    if (this.finished) return null;
    const after = this.at + 1;
    if (after < this.steps.length) return this.steps[after];
    return this.snapshot.closed ? this.steps[0] : null;
  }

  /**
   * Offer one fix. The only way anything gets into this object.
   *
   * Returns what happened, because the page has to say so: a rejected fix is not a silent
   * event, it is a line in the audit trail the brief asks for — "fix at t rejected,
   * implied ground speed 63 kn" is the sentence that makes a contested result defensible.
   */
  accept(fix) {
    const verdict = qualityCheck(fix, this.lastGood, this.qc);
    let relocated = null;
    if (verdict.verdict !== 'ACCEPTED') {
      // Only a KINEMATIC refusal can be a relocation. Bad metadata is bad metadata: a fix
      // from two satellites is not evidence about where the boat is, however many of them
      // agree with each other, so a run of those must never move it.
      if (verdict.verdict !== 'REJECTED_KINEMATIC' || !this.relocation.offer(fix)) {
        this.rejects.push({ at: fix.time, what: verdict.verdict, reason: verdict.reason });
        this.sinceGood += 1;
        return { accepted: false, sinceGood: this.sinceGood, ...verdict };
      }
      relocated = this.relocate(fix);
    }

    this.relocation.reset();
    this.sinceGood = 0;
    this.lastGood = fix;
    this.fix = fix;
    this.point = toLocal(this.origin, fix);
    this.fixes.push({ ...this.point, time: fix.time, accuracyM: fix.accuracyM });
    if (this.fixes.length > TRAIL) this.fixes.shift();
    if (!this.startedAt) this.startedAt = fix.time;
    this.updateApproach(fix);

    const step = this.live();
    if (!step) return { accepted: true, verdict: 'ACCEPTED', reason: null, relocated };

    // Both sides of a gate see every fix. Whichever latches first is the one the boat
    // took, and the other is simply abandoned — there is no sense in which a boat could
    // round both, and a course length that depended on which it chose would make the
    // live-place axis mean different things for different boats.
    let latched = null;
    let took = null;
    for (const crossing of step.crossings) {
      const got = crossing.detector.accept(this.point, fix);
      if (got && !latched) {
        latched = got;
        took = crossing;
      }
    }

    if (!latched) return { accepted: true, verdict: 'ACCEPTED', reason: null, relocated };

    // Held so the Mark screen can go on showing the line that was just crossed for the
    // length of the dwell. Without this, `live()` has already moved on the instant the latch
    // happens, so the screen that says CROSSED would be drawing the NEXT mark's line — a
    // different picture, at a different scale, with the crossing ringed in a frame it did not
    // happen in. The dwell exists to let somebody look at the crossing; it has to still be
    // there to look at.
    this.crossed = { step, crossing: took };
    // THE RACE CLOCK STARTS WHEN THE BOAT CROSSES, and that is a commitment rather than a
    // convenience: there is nothing in this system to fire a gun, so every start is self-timed
    // and elapsed has to run from the crossing of the first line, never from when the app was
    // opened. On a cycle each lap restarts it, which is what makes the number a lap time.
    if (step.index === 0) {
      this.startAt = latched.time;
      this.finishAt = null;
    }
    this.crossings.push({
      step: step.index,
      letter: step.letter,
      lap: this.lap,
      line: took.line,
      cross: took.required,
      time: latched.time,
      point: latched.point,
      confirmBefore: latched.confirmBefore,
      confirmAfter: latched.confirmAfter,
      // Which side of a gate the boat took. Recorded because the next leg's bearing
      // depends on it — the one place a boat's own choice changes what it is shown.
      gateSide: step.crossings.length > 1 ? took.line : null,
    });
    this.dwellUntil = fix.time.getTime() + this.approach.dwellMs;
    this.advance();
    // Taken from the CROSSING, not from the fix that confirmed it: the interpolated instant is
    // the whole point, and an elapsed time built from the confirming fix would be late by up to
    // the fix interval at both ends.
    if (this.finished) this.finishAt = latched.time;
    return { accepted: true, verdict: 'ACCEPTED', reason: null, latched, step, relocated };
  }

  /**
   * The boat is not where we thought it was. Start again from where it is.
   *
   * <b>The detectors are re-armed, and that is the whole point.</b> The segment from the
   * position we believed to the one the boat turns out to be at can sweep across any line
   * on the course, and offering it to a detector would manufacture a crossing out of a
   * receiver dropout — the same failure a flyer would cause, at a scale no confirmation
   * count could absorb. The trail goes too, because every point in it describes somewhere
   * the boat is not.
   *
   * The step is NOT advanced. Which mark is live is a fact about the course and the
   * sequence, not about the receiver, and a boat that lost its fixes for twenty seconds
   * still owes the same crossing it owed before. If it made that crossing during the
   * blackout, it was not seen and it will have to be made again — which is the honest
   * outcome, is recorded here, and is why the record carries this event at all.
   */
  relocate(fix) {
    const from = this.point;
    const to = toLocal(this.origin, fix);
    const event = {
      at: fix.time,
      what: 'RELOCATED',
      metres: from ? resolve(Math.hypot(to.x - from.x, to.y - from.y)) : null,
      afterRejected: this.sinceGood,
      step: this.live()?.letter ?? null,
      reason: `position jumped ${from ? resolve(Math.hypot(to.x - from.x, to.y - from.y)) : '?'} m`
        + ` after ${this.sinceGood} rejected fix${this.sinceGood === 1 ? '' : 'es'}`,
    };
    this.rejects.push(event);
    this.relocations += 1;
    this.fixes = [];
    this.point = to;
    this.smoothSogMs = null;
    this.smoothCogM = null;
    this.lastApproachAt = null;
    this.arm();
    return event;
  }

  /**
   * Move to the next step, or round again, or stop.
   *
   * A cycle has no finish of its own — a boat begins and ends a lap wherever it joined —
   * so it never becomes `finished` here. It simply comes round to step 0 with the lap
   * counter advanced and fresh detectors, and stops when the sailor stops it.
   */
  advance() {
    if (this.at + 1 < this.steps.length) {
      this.at += 1;
    } else if (this.snapshot.closed) {
      this.at = 0;
      this.lap += 1;
    } else {
      this.finished = true;
      return;
    }
    // A new step is a new approach, judged from scratch. Without this the hysteresis flag
    // carries over: having held the Mark screen through the crossing, the boat would be
    // treated as already "on" the next mark and keep it at the EXIT threshold — which is
    // wider than the enter one — so a mark three hundred metres away would take the screen
    // the moment the last one was cleared, and on a short course it would never give it
    // back at all.
    this.showingMark = false;
    this.arm();
  }

  /**
   * The point the boat is actually steering at, and the bearing and distance to it.
   *
   * <b>The midpoint of the next line, which is not the same number as the perpendicular
   * distance to it</b>, and the difference is the whole reason both exist. Perpendicular
   * distance answers "how close am I to crossing" and is what decides when the Mark screen
   * takes over; DTW answers "how far have I got to sail", which is what somebody navigating
   * a leg wants and what the published leg length is measured as. On a long start line
   * approached from down the course the two can differ by hundreds of metres.
   *
   * On a GATE it is the mean of the alternatives' midpoints — the same point the model
   * measures a leg into a gate to, so DTW and the course's own leg length are the same
   * quantity rather than two that nearly agree. Before the choice is made, both lines are
   * the target, so both are named.
   *
   * Bearings are TRUE, like every other bearing in this system. There is no variation model
   * anywhere in it, and a readout that was magnetic in one place and true in another would
   * be worse than one that is consistently the harder of the two to steer by.
   */
  waypoint() {
    const step = this.live();
    if (!step) return null;
    const mids = step.crossings
      .map((crossing) => crossing.midpoint)
      .filter(Boolean)
      .map((mid) => toLocal(this.origin, mid));
    if (!mids.length) return null;
    const to = {
      x: mids.reduce((sum, p) => sum + p.x, 0) / mids.length,
      y: mids.reduce((sum, p) => sum + p.y, 0) / mids.length,
    };
    const lines = step.crossings.map((crossing) => crossing.line);
    if (!this.point) return { to, lines, letter: step.letter, bearingDeg: null, distanceM: null };
    return {
      to,
      lines,
      letter: step.letter,
      gate: step.crossings.length > 1,
      bearingDeg: bearingLocal(this.point, to),
      distanceM: resolve(Math.hypot(to.x - this.point.x, to.y - this.point.y)),
    };
  }

  /**
   * The crossing the screens are watching: on a gate, the nearer one.
   *
   * One answer, asked for in three places — the Mark screen's plot, its readouts and the
   * time-to-line — because a screen whose picture watched one side of a gate while its
   * numbers watched the other would be worse than one that picked wrongly and stuck to it.
   */
  watching() {
    const step = this.live();
    if (!step || !this.point) return null;
    if (step.crossings.length === 1) return step.crossings[0];

    // A GATE IS THE CASE THIS EXISTS FOR, and perpendicular distance is the wrong test for it.
    // A proper gate has its two lines either side of the centreline and roughly parallel, so a
    // boat is very nearly the same perpendicular distance from both for the whole leg — the
    // quantity that was picking a side could barely tell them apart, and would swap sides on
    // noise. What actually says which one a boat is sailing towards is where its COURSE takes
    // it, and failing that which MARK is nearer — the midpoint, not the line.
    const cog = this.fix?.cogDeg;
    const aimed = cog == null ? [] : step.crossings.filter((crossing) =>
      projectCog(crossing.prepared, this.point, cog)?.withinExtent);
    const candidates = aimed.length ? aimed : step.crossings;

    const ranked = candidates
      .map((crossing) => ({
        crossing,
        distance: crossing.midpoint
          ? Math.hypot(...Object.values(this.awayFrom(crossing.midpoint)))
          : Infinity,
      }))
      .sort((a, b) => a.distance - b.distance);

    // Held once chosen unless the other is clearly nearer. Early on a gate the two are within
    // metres of each other, and a focus that swapped whenever they crossed over would flick
    // the whole plot from one side to the other and back.
    const held = ranked.find((r) => r.crossing.line === this.watchedLine);
    const best = ranked[0];
    const keep = held && held.distance < best.distance * WATCH_HYSTERESIS;
    this.watchedLine = (keep ? held : best).crossing.line;
    return (keep ? held : best).crossing;
  }

  /** The vector from the boat to a position, in local metres. */
  awayFrom(position) {
    const to = toLocal(this.origin, position);
    return { x: to.x - this.point.x, y: to.y - this.point.y };
  }

  /**
   * How long until this boat crosses the line, on the course and speed it is making.
   *
   * <b>And whether it will cross it at all</b>, which is the more important half and is a
   * different question: the projection can be a perfectly good twenty seconds away and still
   * be running out past the pin. So the answer carries both, and the screen colours the
   * number by the second one — a green thirty is a promise, a red thirty is a warning that
   * thirty seconds from now the boat will be past the end having scored nothing.
   */
  timeToLine() {
    if (this.smoothCogM == null || this.smoothSogMs == null) {
      return { seconds: null, crossing: false, reachSeconds: null, confirmSeconds: this.confirmSeconds() };
    }
    const crossing = !!this.cogCrosses;
    if (this.smoothSogMs < 0.2) {
      return { seconds: null, crossing, reachSeconds: null, confirmSeconds: this.confirmSeconds() };
    }
    const reachSeconds = this.smoothCogM / this.smoothSogMs;
    const confirmSeconds = this.confirmSeconds();
    // THE NUMBER COUNTS DOWN TO THE LATCH, not to the water. See `confirmSeconds`.
    return { seconds: reachSeconds + confirmSeconds, crossing, reachSeconds, confirmSeconds };
  }

  /**
   * How long after the boat crosses before the crossing is CONFIRMED, in seconds.
   *
   * <b>A crossing is not latched when it happens; it is latched when it has been proved.</b>
   * The detector wants `confirmFixes` consecutive fixes resolved to the far side before it will
   * call it — that is what stops a boat sitting on a line assembling a crossing out of noise —
   * so between the instant the bow cuts the line and the instant the screen says CROSSED there
   * is a real gap, and at one fix a second with the default of three it is about three seconds.
   * A time-to-line that ignored it counted down to zero and then sat at zero while nothing
   * happened, which reads as the application having missed it.
   *
   * <b>The estimate is the fix interval times the count</b>, and both parts are honest: the
   * count is the detector's own, and the interval is measured from the fixes actually arriving
   * rather than from what the receiver was asked for. It is an over-estimate by up to one
   * interval — the first confirming fix may land immediately after the crossing, so the true
   * delay is somewhere between `(N-1)` and `N` intervals — and over-estimating is the right
   * way round: a countdown that reaches zero a moment early has told the truth late, where one
   * that reaches zero a moment late says the boat has already crossed when it has not.
   *
   * Falls back to the interval the receiver was asked for when nothing has arrived yet, and to
   * one second when even that is unknown, because a null here would take the whole readout away
   * over a detail.
   */
  confirmSeconds() {
    const interval = this.fixSeconds ?? 1;
    return this.confirmFixes * interval;
  }

  /** Blend this fix's speed and COG cut into the smoothed pair the readout is built from. */
  updateApproach(fix) {
    const watched = this.watching();
    const projection = watched
      ? projectCog(watched.prepared, this.point, fix.cogDeg ?? 0)
      : null;
    this.cogCrosses = !!projection?.withinExtent;

    const seconds = this.lastApproachAt ? (fix.time - this.lastApproachAt) / 1000 : null;
    this.lastApproachAt = fix.time;
    // How fast fixes are actually arriving, which is what the confirmation delay is measured
    // in. Smoothed the same way everything else on this screen is, and only from intervals
    // that look like a fix rate: a gap while a receiver was refusing everything says nothing
    // about how quickly the next three will come.
    if (seconds > 0 && seconds < 10) {
      this.fixSeconds = this.fixSeconds == null
        ? seconds
        : this.fixSeconds + (1 - Math.exp(-seconds / TTL_TAU_S)) * (seconds - this.fixSeconds);
    }
    const alpha = seconds > 0 ? 1 - Math.exp(-seconds / TTL_TAU_S) : 1;
    const blend = (was, now) => (was == null || now == null ? now : was + alpha * (now - was));

    const reported = (fix.sogKn ?? 0) * KN_TO_MS;
    const blended = blend(this.smoothSogMs, reported);
    // Clamped on the way out rather than on the way in, so the limit is on what the screen
    // shows changing — which is the thing being defended — rather than on one input to it.
    this.smoothSogMs = this.smoothSogMs == null || !(seconds > 0)
      ? blended
      : Math.max(this.smoothSogMs - MAX_ACCEL_MS2 * seconds,
        Math.min(this.smoothSogMs + MAX_ACCEL_MS2 * seconds, blended));
    // Null when the COG does not meet the line ahead at all — the boat is pointing away, or
    // along it. Kept as null rather than held at its last value: a time to a line you are
    // sailing away from is not a stale number, it is a wrong one.
    this.smoothCogM = projection ? blend(this.smoothCogM, projection.distanceM) : null;
  }

  /** Where a step is measured to, in the local frame: the mean of its crossings' midpoints. */
  midOf(step) {
    const points = (step?.crossings ?? []).map((c) => c.midpoint).filter(Boolean)
      .map((m) => toLocal(this.origin, m));
    if (!points.length) return null;
    return {
      x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
    };
  }

  /**
   * The bearing of the leg INTO a step: from the mark behind it to the mark itself.
   *
   * <b>This is "the current leg", and it is not the same as the leg the arrow points at.</b>
   * A boat approaching mark 2 is sailing the leg from mark 1 to mark 2; the arrow on its
   * screen shows where it goes after mark 2. Both are legs and both are wanted, and using one
   * where the other belongs turns the display to the leg the boat has not started yet.
   *
   * Mark to mark, never boat to mark: a boat halfway up a beat points thirty or forty degrees
   * off the rhumb line, and a display that followed the boat would swing back and forth on
   * every tack. Null where there is no mark behind — the start of an open course, where the
   * only leg there is runs to the first mark and the caller says what to do about it.
   */
  legInto(step) {
    if (!step) return null;
    const behind = step.index > 0
      ? this.steps[step.index - 1]
      : (this.snapshot.closed ? this.steps[this.steps.length - 1] : null);
    const from = this.midOf(behind);
    const here = this.midOf(step);
    if (!from || !here || (from.x === here.x && from.y === here.y)) return null;
    return bearingLocal(from, here);
  }

  /**
   * A gate's own AXIS: its two crossings' centres, and the leg that leads into them.
   *
   * <b>What Line perp squares up at a gate, because neither side's own normal is the answer
   * there.</b> The two shapes a gate takes pull in different directions. Where the sides are
   * collinear — two lines end to end with a gap between them — each side's crossing normal
   * already points the way the fleet comes through, and the join between the centres runs
   * along them. Where they are parallel, either side of a centreline, the normals point
   * OUTWARD in opposite directions: squaring up to one of them turns the display ninety
   * degrees off the approach, and squaring up to the other turns it ninety degrees the other
   * way, so the same gate reads two different ways depending only on which side a boat has
   * committed to. The perpendicular to the join between the centres is the one bearing both
   * shapes agree on: it is the normal itself when they are collinear, and the approach when
   * they are parallel.
   *
   * <b>The sign comes from the leg INTO the gate, never from where the boat is.</b> A join
   * has two perpendiculars and the geometry cannot choose between them. Taking the one
   * pointing from the boat towards the gate would flip through a hundred and eighty degrees
   * the moment the boat drew level with it — which is the latch, and the one moment the
   * display must hold still. The leg is a fact about the course and does not move.
   *
   * Null for an ordinary step, which has no axis beyond its own crossing normal.
   */
  gateOf(step) {
    if (!step || step.crossings.length < 2) return null;
    const centres = step.crossings
      .map((crossing) => (crossing.midpoint ? toLocal(this.origin, crossing.midpoint) : null));
    if (centres.some((centre) => !centre)) return null;
    const mean = {
      x: centres.reduce((sum, c) => sum + c.x, 0) / centres.length,
      y: centres.reduce((sum, c) => sum + c.y, 0) / centres.length,
    };
    // A gate can be neither the first step nor the last, so the leg into it is there to be
    // had. The fallback is for an archive from an older build that says otherwise: the
    // bearing to the gate is a worse answer, since it moves, but it is an answer.
    const legInDeg = this.legInto(step)
      ?? (this.point ? bearingLocal(this.point, mean) : null);
    return { centres, mean, legInDeg };
  }

  /**
   * Perpendicular distance to the live step, in metres: the nearer side of a gate.
   *
   * <b>Which screen a sailor is looking at is deliberately NOT decided by this</b> — see
   * `approachM`, which is the one the rule reads. This is the distance to the line's infinite
   * extension, which is the right quantity for "how close am I to crossing" and the wrong one
   * for "how near the mark am I". Kept because the difference between the two is exactly what
   * the specs for both have to argue about.
   */
  nearestM() {
    const step = this.live();
    if (!step || !this.point) return null;
    return Math.min(...step.crossings.map((c) => Math.abs(signedDistanceM(c.prepared, this.point))));
  }

  /**
   * How far the boat is from the part of the line it would actually cross, in metres.
   *
   * <b>Perpendicular distance is the wrong quantity for deciding when the Mark screen takes
   * over, and a line that runs ALONG the leg is where it falls apart.</b> It is the distance
   * to the line's infinite extension, so it answers "how far to the plane of the line"
   * rather than "how far to the crossing" — and the two are the same number only for a line
   * the fleet meets square. A gate's sides do the opposite: they run out along the leg, half
   * infinite, so the fleet comes up between them and turns out through one. A boat FOUR
   * KILOMETRES down that leg is still only the gate's half-width from both lines'
   * extensions, so the approach screen took over on the start line and never gave up — which
   * is exactly what was seen on the water.
   *
   * So the boat is measured to the nearest point of the line BETWEEN ITS TWO DEFINED POINTS,
   * infinite ends included. That sounds like it contradicts "an infinite end is a bearing,
   * not a place", and it does not: the point given for an infinite end is the handle that
   * says where the fleet actually crosses, which is its whole job, so it is precisely the
   * right bound for this question. Nothing about SCORING changes — the extent test still
   * runs out without limit past an infinite end, and a crossing out there still counts. This
   * decides which screen a sailor is looking at, and no more.
   *
   * It is also the point the plot seats its triangle on, so the screen comes up about the
   * part of the line the picture is already about.
   */
  approachM() {
    const step = this.live();
    if (!step || !this.point) return null;
    return Math.min(...step.crossings.map((c) => this.seatedM(c.prepared)));
  }

  /** The distance from the boat to the nearest point of one line's defined extent. */
  seatedM(prepared) {
    const unit = { x: prepared.d.x / prepared.length, y: prepared.d.y / prepared.length };
    const along = (this.point.x - prepared.port.x) * unit.x
      + (this.point.y - prepared.port.y) * unit.y;
    const clamped = Math.max(0, Math.min(prepared.length, along));
    const seat = {
      x: prepared.port.x + unit.x * clamped,
      y: prepared.port.y + unit.y * clamped,
    };
    return resolve(Math.hypot(this.point.x - seat.x, this.point.y - seat.y));
  }

  /**
   * Which screen the sailor should be looking at, and why.
   *
   * The sailor never asks for the Mark screen. On a boat the hands are busy and the
   * decision of which screen matters right now is one the application is better placed to
   * make than the person steering — it knows where the line is and they are looking at
   * the water. So the screen follows the situation, which is what makes it worth writing
   * down carefully rather than leaving to a magic number in a render function.
   *
   * The distance it reads is `approachM` and not the perpendicular one — see there, and note
   * that the two agree for every line the fleet meets square. Where they part company is a
   * line running along the leg, and the screen was taking over four kilometres out.
   *
   * <b>And the sailor can overrule it.</b> `viewMode` is `auto` by default, which is the design
   * above; set to `overview` or `mark` it simply says which screen, because somebody setting up
   * or checking the next leg has every right to pick and a display that refused would be
   * insisting it knows better about what somebody wants to look at. The rule underneath goes on
   * running either way — the hysteresis is still updated below — so `auto` resumes with the
   * right answer rather than with whatever happened to be true when it was left.
   */
  view(now = Date.now()) {
    // No live step means the course is complete, and there is no Mark screen to force: there
    // is no mark. This comes before the override deliberately.
    if (!this.live()) return 'overview';
    // The dwell is its own reason to be on the Mark screen and deliberately does NOT set
    // the hysteresis flag. Priming it here would hand the next mark the screen at the exit
    // threshold instead of the enter one, purely because the last mark had been crossed.
    if (now < this.dwellUntil) return 'mark';
    const near = this.approachM();
    if (near == null) return 'overview';

    // Seconds to the line at the speed the boat is making. Floored so a stopped boat gets
    // a large number rather than an infinite one, and so the sum is never a division by
    // zero on a fix that reports no SOG at all.
    const speed = Math.max(0.3, (this.fix?.sogKn ?? 0) * KN_TO_MS);
    const seconds = near / speed;

    if (this.showingMark) {
      // Hysteresis: having taken the screen, hold it further out than it was taken at.
      this.showingMark = near <= this.approach.exitM;
    } else {
      this.showingMark = near <= this.approach.enterM || seconds <= this.approach.enterS;
    }
    // Tracked above whatever is returned, so a forced view does not leave the rule stale: the
    // moment AUTO is handed back it answers for where the boat is NOW, not for where it was
    // when somebody pressed a button.
    if (this.viewMode !== 'auto') return this.viewMode;
    return this.showingMark ? 'mark' : 'overview';
  }

  /**
   * Which screen the sailor has asked for: `auto`, `overview` or `mark`.
   *
   * Here rather than on the page, because `view()` is the single answer to "which screen" and a
   * page that second-guessed it would be a second rule to keep in agreement with the first.
   * Anything other than the three is treated as `auto`, so a stale value cannot strand somebody
   * on a screen with no way back.
   */
  setViewMode(mode) {
    this.viewMode = mode === 'overview' || mode === 'mark' ? mode : 'auto';
    return this.viewMode;
  }

  /**
   * Everything the Mark screen draws, gathered in one place.
   *
   * Gathered here rather than reached for by the drawing code, so that the drawing can be
   * handed a plain object and tested without a client, and so the client can be tested
   * without a screen.
   */
  markState(now = Date.now()) {
    // While the dwell runs, the screen stays on the mark that was just crossed rather than
    // jumping to the next one. Everything else follows from that: the frame does not move,
    // the scale does not change, and the crossing stays ringed where it happened.
    const dwelling = now < this.dwellUntil && this.crossed;
    const step = dwelling ? this.crossed.step : this.live();
    if (!step || !this.point) return null;

    // The crossing being watched: on a gate, the nearer one. A screen that drew both
    // would have to say which readout belonged to which, and the boat has committed to a
    // side long before either is close enough to matter.
    const watched = dwelling ? this.crossed.crossing : this.watching();
    if (!watched) return null;

    const status = watched.detector.status(this.point);
    const cog = this.fix?.cogDeg ?? 0;
    const projection = projectCog(watched.prepared, this.point, cog);

    // Where the next leg goes, from the midpoint of the live step to the midpoint of the
    // one after it. Null at the finish of an open course, where there is no next leg —
    // and the arrow says FINISH rather than pointing at nothing.
    const after = dwelling ? this.live() : this.next();
    let legBearing = null;
    if (after && watched.midpoint) {
      const from = toLocal(this.origin, watched.midpoint);
      const to = this.midOf(after);
      if (to) legBearing = bearingLocal(from, to);
    }

    // THE LEG THE BOAT IS ON, which is what Leg up puts at the top — a different leg from the
    // one the arrow points at, and the brief is explicit about the moment they swap: on a
    // cross "the display turns so the new leg is up, the this-leg arrow points straight up".
    // So while the dwell runs they are the same leg, and the arrow does point straight up.
    const legUp = dwelling
      ? legBearing
      : (this.legInto(step)
        // Nothing behind it: the start of an open course, where the only leg there is runs
        // from where the boat happens to be to the first mark.
        ?? (watched.midpoint ? bearingLocal(this.point, toLocal(this.origin, watched.midpoint)) : null));

    const latched = dwelling && this.crossings.length
      ? this.crossings[this.crossings.length - 1]
      : null;

    return {
      step,
      watched,
      state: latched ? 'crossed' : status.state,
      perpDistM: status.perpDistM,
      confirmed: status.confirmed ?? 0,
      confirmFixes: this.confirmFixes,
      projection,
      cogDeg: cog,
      sogKn: this.fix?.sogKn ?? 0,
      satellites: this.fix?.satellites ?? null,
      time: this.fix?.time ?? null,
      point: this.point,
      fixes: this.fixes,
      // The fixes with their side and extent against THIS line. Resolved here rather than
      // in the drawing, because deciding which side a fix fell on is the detector's
      // question and the plot's job is only to show the answer.
      trail: this.trailAgainst(watched.prepared),
      legBearing,
      legUp,
      latched,
      latchedPoint: latched?.point ?? null,
      rejected: watched.detector.rejected,
      lap: this.lap,
      of: this.steps.length,
      // The Mark screen dashes SOG and COG when these are stale rather than showing the
      // last good ones: they are instantaneous, so an old one is wrong rather than merely
      // old, and this is the screen somebody is staring at while a line comes up.
      stale: this.stale(now),
      sinceGood: this.sinceGood,
      ttl: this.timeToLine(),
      // The other side of a gate, so the plot can show it where it falls in view. Not part of
      // what the screen is focused on — the readouts, the fit and the time all belong to the
      // one the boat is sailing towards — but drawing only one side of a gate says there is
      // only one side, and the choice is the boat's to make right up to the moment it crosses.
      //
      // EACH SIDE CARRIES ITS OWN PERPENDICULAR DISTANCE AND ITS OWN NEXT LEG, because those
      // are the two numbers the choice actually turns on and they differ between the sides.
      // The distance comes from that side's own detector rather than being measured by the
      // drawing: how far off a line a boat is is the detector's question, and two sides
      // answered by two different routines would put two different quantities on one screen
      // drawn the same way. The leg runs from THAT side's midpoint, so the arrows say what
      // taking each side costs on the leg that follows — which is the whole of what a gate
      // is a choice between.
      alternatives: step.crossings
        .filter((crossing) => crossing !== watched)
        .map((crossing) => ({
          line: crossing.line,
          prepared: crossing.prepared,
          required: crossing.required,
          perpDistM: crossing.detector
            ? crossing.detector.status(this.point).perpDistM
            : signedDistanceM(crossing.prepared, this.point),
          legBearing: after && crossing.midpoint
            ? (() => {
              const to = this.midOf(after);
              return to ? bearingLocal(toLocal(this.origin, crossing.midpoint), to) : null;
            })()
            : null,
        })),
      // The gate's own axis, for the orientation that squares up to a line. See `gateOf`.
      gate: this.gateOf(step),
      relocations: this.relocations,
    };
  }

  /**
   * The side each recent fix was resolved to, against one prepared line.
   *
   * The brief asks for every logged fix to be coloured by the side it was resolved to and
   * drawn hollow when its foot fell beyond the line end, which is the plot saying out loud
   * what the two independent tests decided — and it is the picture that makes a miss
   * explicable rather than merely announced.
   */
  trailAgainst(prepared) {
    return this.fixes.map((point) => {
      // Which side it is ON, at the system's own resolution — not which side it confirms.
      // The plot's job is to show where the boat went; whether a fix was good enough to count
      // is the detector's judgement and is already visible in whether anything latched.
      const resolved = side(prepared, point);
      // The foot of the perpendicular, as a fraction along the line from the port end.
      const dx = point.x - prepared.port.x;
      const dy = point.y - prepared.port.y;
      const t = (dx * prepared.d.x + dy * prepared.d.y) / (prepared.length * prepared.length);
      const beyond = (t < 0 && !prepared.portInfinite) || (t > 1 && !prepared.starboardInfinite);
      return { ...point, side: resolved, beyond };
    });
  }

  /** Milliseconds since the last ACCEPTED fix, or null before the first one. */
  sinceFix(now = Date.now()) {
    return this.fix ? Math.max(0, now - this.fix.time.getTime()) : null;
  }

  /** True when nothing usable has arrived lately, so the instantaneous readouts are lies. */
  stale(now = Date.now()) {
    const since = this.sinceFix(now);
    return since == null || since > STALE_MS;
  }

  /**
   * Elapsed on the race clock: from crossing the start to crossing the finish, or to now.
   *
   * <b>Null until the boat has started</b>, rather than counting from when the screen was
   * opened. A number that was already running before the boat crossed anything is not an
   * elapsed time, it is how long somebody has been holding a phone, and the one thing this
   * system is uniquely able to be right about is when a boat crossed a line.
   *
   * Frozen once finished, because it is then a result.
   */
  elapsed(now = Date.now()) {
    if (!this.startAt) return null;
    const to = this.finishAt ? this.finishAt.getTime() : now;
    return Math.max(0, to - this.startAt.getTime());
  }

  /** True once the run has a start and an end and the clock has stopped. */
  complete() {
    return !!(this.startAt && this.finishAt);
  }
}

/** Milliseconds as `m:ss` or `h:mm:ss` — the only clock format either screen uses. */
export function clock(ms) {
  if (ms == null) return '—';
  const total = Math.floor(ms / 1000);
  const seconds = String(total % 60).padStart(2, '0');
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

export { KN_TO_MS, M_PER_NM };
