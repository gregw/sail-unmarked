/**
 * A simulated boat, and the GNSS receiver bolted to it.
 *
 * THIS IS TEST EQUIPMENT AND IT SITS OUTSIDE THE CLIENT. What it emits is a fix in
 * exactly the shape a real receiver hands over — a position, a time, a stated accuracy, a
 * satellite count, SOG and COG — and nothing else crosses the boundary. The client is
 * given fixes and is never given the truth, so it cannot accidentally be written against
 * the simulator: swapping this for `navigator.geolocation` is a change to one function in
 * `client.js` and to nothing else.
 *
 * <h2>Why the receiver is modelled and not just the boat</h2>
 * A boat that reports its exact position every tick can never fail quality control and can
 * never need the 3-and-3 latch: every crossing is clean, `qualityCheck` returns ACCEPTED
 * forever, and the most important code in the application is never once exercised by the
 * thing built to exercise it. So the receiver lies, in the two ways receivers actually lie:
 *
 *   NOISE   every fix scattered about the truth by a metre or two, or by twenty when the
 *           sky is bad. This is what makes the accuracy band do its job and what makes a
 *           boat sitting on a line try to emit phantom crossings.
 *   FLYERS  occasionally a fix hundreds of metres away. This is the one that matters,
 *           because a flyer landing on the far side of a line makes the segment out and
 *           the segment back BOTH cut it — a matched pair of crossings the boat never
 *           made. It is what the kinematic gate exists for, and without a way to produce
 *           one there is no way to see the gate work.
 *
 * <h2>Deterministic on purpose</h2>
 * The randomness comes from a seeded generator, so a run can be repeated exactly. A test
 * client whose failures cannot be reproduced is a worse instrument than no test client:
 * the whole value of one is being able to say "do that again, slower".
 */

import { fromLocal } from './crossing.js';

const M_PER_DEG_LAT = 111320;
const M_PER_NM = 1852;
const KN_TO_MS = M_PER_NM / 3600;

/**
 * A small, fast, seeded generator.
 *
 * `Math.random()` cannot be seeded, and an unseedable generator makes a bug that shows up
 * one run in fifty impossible to hold still while it is looked at.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Two independent standard normals from two uniforms — Box-Muller.
 *
 * GNSS scatter is very close to Gaussian in each axis once the gross outliers are taken
 * out separately, which is exactly how it is modelled here: a Gaussian for the ordinary
 * scatter, and flyers drawn from their own distribution rather than from the tail of this
 * one. Modelling both with one heavy-tailed distribution would tangle the two knobs
 * together, and they are knobs a person wants to turn independently.
 */
export function gaussianPair(random) {
  const u = Math.max(random(), Number.MIN_VALUE);
  const v = random();
  const r = Math.sqrt(-2 * Math.log(u));
  return [r * Math.cos(2 * Math.PI * v), r * Math.sin(2 * Math.PI * v)];
}

/**
 * Metres east and north of an origin, back as a position.
 *
 * `crossing.fromLocal` does the arithmetic. Two copies of one tangent-plane approximation is
 * exactly the kind of pair that drifts, and this one would drift between the simulator that
 * places a boat and the detector that decides where it crossed.
 */
export const offsetBy = (origin, eastM, northM) => fromLocal(origin, { x: eastM, y: northM });

/** Metres between two positions, on the same local-tangent approximation. */
export function metresBetween(a, b) {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((a.latitude * Math.PI) / 180);
  const dx = (b.longitude - a.longitude) * mPerDegLon;
  const dy = (b.latitude - a.latitude) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/** Compass bearing from one position to another, degrees, 0 north. */
export function bearingTo(from, to) {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((from.latitude * Math.PI) / 180);
  const dx = (to.longitude - from.longitude) * mPerDegLon;
  const dy = (to.latitude - from.latitude) * M_PER_DEG_LAT;
  if (dx === 0 && dy === 0) return 0;
  return (((Math.atan2(dx, dy) * 180) / Math.PI) + 360) % 360;
}

/** The shortest way round from one bearing to another, in degrees, signed. */
export function turnBetween(from, to) {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/**
 * How long a GNSS position error takes to wander somewhere else, in seconds.
 *
 * <b>Real GNSS error is not white noise and modelling it as white is the single most
 * misleading thing a simulator can do.</b> Draw an independent sample per fix and the plotted
 * dots hop about the truth like nothing any receiver has ever produced — at 5 Hz the display
 * is a cloud of confetti. What a real receiver does is sit a little way off and STAY there:
 * the error is dominated by satellite geometry, ionospheric delay and multipath off the rig
 * and the shore, none of which changes between one second and the next. The position creeps,
 * holds an offset for half a minute, and creeps back.
 *
 * So the bias is a first-order Gauss-Markov process — an exponentially correlated random walk
 * that keeps a fixed long-run spread. Over an interval `dt` it retains `exp(-dt/tau)` of
 * itself and takes the rest fresh, which is the standard model for exactly this and has the
 * two properties that matter: consecutive fixes are close together, and the error still has
 * the standard deviation the slider asked for.
 *
 * Forty-five seconds is the right order for the slowly-varying part on a small craft. It is
 * long enough that a boat crossing a line does so under a roughly constant offset, which is
 * the case that matters — a steady offset moves the crossing INSTANT, where white noise would
 * merely have added spread either side of the truth and averaged out.
 */
export const CORRELATION_S = 45;

/**
 * How much of the error variance is genuinely fix-to-fix white noise.
 *
 * Not zero: receiver and tracking-loop noise is real and is what makes the dots shimmer
 * slightly even while the bias holds. But it is a SMALL part, and treating it as the whole is
 * what makes a simulated track look nothing like a real one.
 *
 * Six percent of the variance, which at a stated two metres puts under a metre between one
 * fix and the next while the cloud as a whole sits a couple of metres off the truth. That is
 * the shape a real plot has: a position that is wrong, and stays wrong the same way, rather
 * than one that is right on average and never right at any instant.
 */
export const WHITE_FRACTION = 0.06;

/**
 * How sharply the boat comes round onto a new bearing, in degrees per second.
 *
 * A boat that snapped instantly to a new heading would make the COG readout jump between
 * two values and would put a right-angle in the track, neither of which any receiver ever
 * sees. More to the point, the Mark screen's whole job near a line is to show the COG
 * projection moving as the helm steers, and a heading that only ever takes two values
 * cannot demonstrate that. Twenty degrees a second is a brisk tack in a dinghy.
 */
export const TURN_RATE_DEG_S = 20;

/**
 * The simulated boat.
 *
 * Holds the TRUE state — where the boat really is and which way it is really going — and
 * hands out fixes that are the truth plus whatever the receiver did to it. Nothing reads
 * the truth except the chart that draws the simulator's own panel, which is allowed to,
 * because that panel is the test rig rather than the client.
 */
export class BoatSim {
  constructor(options = {}) {
    this.at = options.at ?? { latitude: 0, longitude: 0 };
    this.target = options.target ?? null;
    this.speedKn = options.speedKn ?? 6;
    this.headingDeg = options.headingDeg ?? 0;
    this.hz = options.hz ?? 1;

    // The receiver's characteristics. `noiseM` is one standard deviation per axis, which
    // is roughly what a phone reports as its accuracy in the open.
    this.noiseM = options.noiseM ?? 3;
    this.satellites = options.satellites ?? 12;
    this.flyerChance = options.flyerChance ?? 0;
    this.flyerM = options.flyerM ?? 400;

    this.correlationS = options.correlationS ?? CORRELATION_S;
    this.whiteFraction = options.whiteFraction ?? WHITE_FRACTION;

    this.random = options.random ?? mulberry32(options.seed ?? 20260914);
    this.running = options.running ?? false;
    this.sogKn = 0;

    // The slowly-wandering part of the error, in units of one standard deviation. Started
    // from the stationary distribution rather than from zero, because a receiver switched on
    // is already somewhere — beginning every run exactly on the truth and drifting off it
    // would make the first half-minute of every experiment unrepresentative.
    const [x, y] = gaussianPair(this.random);
    this.bias = { x, y };
    this.lastFixAt = null;
  }

  /**
   * Let the bias wander for `seconds`.
   *
   * Retains `exp(-dt/tau)` of where it was and takes the remainder fresh, scaled so the
   * long-run variance stays at one whatever the interval. A long gap between fixes therefore
   * forgets almost everything, which is right: a receiver that has been off for two minutes
   * comes back with an unrelated error, and that is part of why re-acquisition looks like a
   * jump.
   */
  drift(seconds) {
    const phi = seconds > 0 ? Math.exp(-seconds / this.correlationS) : 1;
    const [a, b] = gaussianPair(this.random);
    const fresh = Math.sqrt(Math.max(0, 1 - phi * phi));
    this.bias = {
      x: phi * this.bias.x + fresh * a,
      y: phi * this.bias.y + fresh * b,
    };
  }

  /** Point the boat at a place and let it go. A click on the chart lands here. */
  steerTo(position) {
    this.target = position ? { latitude: position.latitude, longitude: position.longitude } : null;
  }

  /**
   * Pick the boat up and put it somewhere else. <b>The helm order is kept.</b>
   *
   * Clearing the target here made the boat stop dead wherever it was dropped and stay
   * there — SOG zero, nothing moving, and no indication why, because from the outside it
   * looks identical to a boat that has arrived. Moving a boat is a statement about WHERE it
   * is, not about where it was going; whoever drops it forward along the course means "and
   * carry on", and if they wanted it stopped there is a Pause button for that.
   *
   * The boat may well land beyond its old target, in which case it has arrived and will sit
   * — so the caller re-aims after placing. That belongs to the caller and not here, because
   * only the caller knows what the boat is supposed to be sailing.
   */
  placeAt(position) {
    this.at = { latitude: position.latitude, longitude: position.longitude };
    this.sogKn = 0;
  }

  /** True once the boat is close enough to its target to call it arrived. */
  arrived() {
    // Within one boat-second of the target, floored at the system's one metre. Stopping
    // dead on a point would have the boat overshoot and oscillate about it at any speed
    // high enough for one step to cross it.
    if (!this.target) return true;
    const reach = Math.max(1, this.speedKn * KN_TO_MS);
    return metresBetween(this.at, this.target) <= reach;
  }

  /**
   * Advance the TRUE state by `seconds`.
   *
   * Separate from {@link fix} because the two happen at different rates in reality and
   * must here too: the boat moves continuously, the receiver reports at its own interval.
   * Tying them together would make the update-rate slider secretly a speed slider.
   */
  step(seconds) {
    if (!this.running || seconds <= 0) return this;
    if (this.target && !this.arrived()) {
      // Come round onto the bearing to the target at a finite rate, then run along the
      // heading actually achieved — not straight at the target, or the boat would crab
      // sideways while turning and the COG would not match the track.
      const wanted = bearingTo(this.at, this.target);
      const turn = turnBetween(this.headingDeg, wanted);
      const most = TURN_RATE_DEG_S * seconds;
      this.headingDeg = (this.headingDeg + Math.max(-most, Math.min(most, turn)) + 360) % 360;
      this.sogKn = this.speedKn;
    } else {
      this.sogKn = 0;
    }

    const distance = this.sogKn * KN_TO_MS * seconds;
    if (distance > 0) {
      const radians = (this.headingDeg * Math.PI) / 180;
      this.at = offsetBy(this.at, distance * Math.sin(radians), distance * Math.cos(radians));
    }
    return this;
  }

  /**
   * What the receiver reports at this instant.
   *
   * The returned object is the whole of the client's knowledge of the world. Note what is
   * NOT in it: the true position, the target, whether this fix is a flyer. A test rig that
   * let any of that through would be testing something other than the thing that ships.
   *
   * `accuracyM` is the receiver's own claim, and it is deliberately allowed to be wrong on
   * a flyer — a real receiver reporting a 400 m error still says "5 m", which is precisely
   * why the metadata pre-filter is necessary and not sufficient, and why the kinematic
   * gate behind it is the one that earns its keep.
   */
  fix(time = new Date()) {
    const at = time instanceof Date ? time : new Date(time);
    const seconds = this.lastFixAt ? (at - this.lastFixAt) / 1000 : this.correlationS * 10;
    this.lastFixAt = at;
    this.drift(seconds);

    const flyer = this.random() < this.flyerChance;
    let eastM = 0;
    let northM = 0;

    if (flyer) {
      const bearing = this.random() * 2 * Math.PI;
      const distance = this.flyerM * (0.5 + this.random());
      eastM = distance * Math.sin(bearing);
      northM = distance * Math.cos(bearing);
    } else if (this.noiseM > 0) {
      // Two parts, their variances summing to one so the slider still means what it says:
      // the wandering bias, which is most of it and is why successive fixes sit together,
      // and a little white noise, which is the shimmer on top.
      const [a, b] = gaussianPair(this.random);
      const slow = Math.sqrt(1 - this.whiteFraction);
      const fast = Math.sqrt(this.whiteFraction);
      eastM = (slow * this.bias.x + fast * a) * this.noiseM;
      northM = (slow * this.bias.y + fast * b) * this.noiseM;
    }

    const reported = offsetBy(this.at, eastM, northM);
    return {
      latitude: reported.latitude,
      longitude: reported.longitude,
      time: at,
      // Rounded up to a metre, because a receiver claiming 0.0 m is not a thing that
      // happens and a zero band would let a boat sitting on a line resolve to a side.
      accuracyM: Math.max(1, Math.round(this.noiseM)),
      satellites: this.satellites,
      sogKn: this.sogKn,
      cogDeg: this.headingDeg,
    };
  }

  /** Seconds between fixes, from the update rate. */
  intervalMs() {
    return 1000 / Math.max(0.1, this.hz);
  }
}

export { M_PER_NM, KN_TO_MS };
