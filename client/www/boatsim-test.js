/**
 * The executable specification for boatsim.js.
 *
 * Test equipment gets a spec for the same reason the thing it tests does: an instrument
 * that is quietly wrong is worse than no instrument, because every result taken with it is
 * wrong in a way nobody is looking for. A simulator that reported a heading a degree off,
 * or scattered its noise with a bias, would make the crossing detector look broken.
 *
 * The assertion that matters most in this file is the last one, and it is not about
 * geometry at all: it checks that a fix carries NOTHING the simulator knows and a receiver
 * would not. That is the seam the whole page rests on, and it is exactly the kind of thing
 * that decays by one convenient extra field at a time.
 */

import {
  BoatSim,
  KN_TO_MS,
  TURN_RATE_DEG_S,
  bearingTo,
  gaussianPair,
  metresBetween,
  mulberry32,
  offsetBy,
  turnBetween,
} from './boatsim.js';

// Somewhere off Sydney Heads. Synthetic, like every coordinate in every spec here: it is
// somewhere for the geometry to happen and claims to be no real mark.
const REF = { latitude: -33.8, longitude: 151.28 };

const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

export function run(check) {
  /* ------------------------------------------------------------- the generator */

  const first = mulberry32(42);
  const second = mulberry32(42);
  check('a seeded generator repeats exactly, so a run can be run again',
    [0, 1, 2, 3, 4].every(() => first() === second()));
  check('...and a different seed does not', mulberry32(43)() !== mulberry32(42)());

  const random = mulberry32(7);
  const samples = [];
  for (let i = 0; i < 5000; i++) samples.push(...gaussianPair(random));
  const mean = samples.reduce((sum, v) => sum + v, 0) / samples.length;
  const sd = Math.sqrt(samples.reduce((sum, v) => sum + (v - mean) ** 2, 0) / samples.length);
  check('the noise is centred on the truth — a biased receiver would move every mark',
    near(mean, 0, 0.05));
  check('...with unit variance, so the metres slider means metres', near(sd, 1, 0.05));

  /* ---------------------------------------------------------------- the frame */

  check('a metre north is a metre north', near(metresBetween(REF, offsetBy(REF, 0, 100)), 100, 0.1));
  check('...and a metre east is too, at this latitude',
    near(metresBetween(REF, offsetBy(REF, 100, 0)), 100, 0.1));
  check('bearings are compass bearings: north is 000',
    near(bearingTo(REF, offsetBy(REF, 0, 100)), 0, 0.01));
  check('...east is 090', near(bearingTo(REF, offsetBy(REF, 100, 0)), 90, 0.01));
  check('...south is 180', near(bearingTo(REF, offsetBy(REF, 0, -100)), 180, 0.01));
  check('...and west is 270', near(bearingTo(REF, offsetBy(REF, -100, 0)), 270, 0.01));
  check('a turn takes the short way round — 350 to 010 is twenty degrees right, not 340 left',
    near(turnBetween(350, 10), 20, 1e-9));
  check('...in both directions', near(turnBetween(10, 350), -20, 1e-9));

  /* ----------------------------------------------------------------- the boat */

  const stopped = new BoatSim({ at: REF, speedKn: 6, running: false });
  stopped.steerTo(offsetBy(REF, 0, 1000));
  stopped.step(10);
  check('a boat that has not been started does not move', metresBetween(REF, stopped.at) === 0);

  const under = new BoatSim({ at: REF, speedKn: 6, headingDeg: 0, running: true });
  under.steerTo(offsetBy(REF, 0, 1000));
  under.step(10);
  check('...and one that has covers speed times time',
    near(metresBetween(REF, under.at), 6 * KN_TO_MS * 10, 0.5));
  check('...reporting the speed it is actually making', under.sogKn === 6);

  // A boat that snapped to a new heading would put a right angle in the track and make the
  // COG readout take two values, neither of which any receiver ever sees.
  const turning = new BoatSim({ at: REF, speedKn: 6, headingDeg: 0, running: true });
  turning.steerTo(offsetBy(REF, 1000, 0));   // due east: a ninety degree turn
  turning.step(1);
  check('a boat comes round at a finite rate rather than snapping',
    near(turning.headingDeg, TURN_RATE_DEG_S, 0.01));
  for (let i = 0; i < 10; i++) turning.step(1);
  check('...and settles on the bearing it was given', near(turning.headingDeg, 90, 1));

  const arriving = new BoatSim({ at: REF, speedKn: 6, headingDeg: 0, running: true });
  const target = offsetBy(REF, 0, 30);
  arriving.steerTo(target);
  for (let i = 0; i < 50; i++) arriving.step(1);
  check('a boat stops when it gets where it was sent', arriving.arrived() && arriving.sogKn === 0);
  check('...rather than sailing past and coming back for it',
    metresBetween(target, arriving.at) < 10);

  /* ------------------------------------------------------------- the receiver */

  const honest = new BoatSim({ at: REF, noiseM: 0, running: true });
  const clean = honest.fix(new Date(0));
  check('with the noise off, the fix IS the position',
    near(metresBetween(REF, clean), 0, 0.001));

  // Sampled over a long run at 1 Hz, because the error is CORRELATED and a handful of fixes
  // taken at one instant would all share the same bias and say nothing about its spread.
  const noisy = new BoatSim({ at: REF, noiseM: 10, running: true, seed: 11 });
  const errors = [];
  for (let i = 0; i < 6000; i++) errors.push(metresBetween(REF, noisy.fix(new Date(i * 1000))));
  const spread = Math.sqrt(errors.reduce((sum, v) => sum + v * v, 0) / errors.length / 2);
  check('over a long run the error has the standard deviation the slider asked for',
    near(spread, 10, 1));
  check('...and the receiver states an accuracy the detector can band with',
    noisy.fix(new Date(9e6)).accuracyM === 10);

  /* ----------------------------------------- the error WANDERS, it does not shimmer */

  // The whole point. Independent draws per fix make the plotted dots hop about the truth
  // like nothing any receiver has produced; a real one sits a little way off and STAYS there
  // while satellite geometry and multipath change on a scale of tens of seconds. So the
  // fix-to-fix step has to be a small fraction of the total error, at any fix rate.
  const walking = new BoatSim({ at: REF, noiseM: 2, running: true, seed: 5 });
  const seen = [];
  for (let i = 0; i < 3000; i++) seen.push(walking.fix(new Date(i * 500)));
  const hop = seen.slice(1)
    .map((f, i) => metresBetween(seen[i], f))
    .reduce((sum, v) => sum + v, 0) / (seen.length - 1);
  const off = seen.map((f) => metresBetween(REF, f)).reduce((sum, v) => sum + v, 0) / seen.length;
  check('one fix to the next moves far less than the error itself — it creeps, not hops',
    hop < off / 2);
  check('...which is what makes a plotted track look like a track', hop < 1.5);
  check('...while the position stays honestly wrong by about the stated accuracy',
    off > 1.5 && off < 4);

  // Correlation is in TIME, so the same test at five times the rate must creep five times
  // less per fix — a faster receiver is not a noisier one.
  const quick = new BoatSim({ at: REF, noiseM: 2, running: true, seed: 5 });
  const fast = [];
  for (let i = 0; i < 3000; i++) fast.push(quick.fix(new Date(i * 100)));
  const fastHop = fast.slice(1)
    .map((f, i) => metresBetween(fast[i], f))
    .reduce((sum, v) => sum + v, 0) / (fast.length - 1);
  check('raising the fix rate does not make the receiver noisier', fastHop <= hop * 1.2);

  // And a long gap forgets it: a receiver that has been off for minutes comes back with an
  // unrelated error, which is part of why a re-acquisition looks like a jump.
  const apart = new BoatSim({ at: REF, noiseM: 10, running: true, seed: 9 });
  apart.fix(new Date(0));
  const held = { ...apart.bias };
  apart.fix(new Date(1000));
  const soon = Math.hypot(apart.bias.x - held.x, apart.bias.y - held.y);
  apart.fix(new Date(1000 + 600e3));
  const later = Math.hypot(apart.bias.x - held.x, apart.bias.y - held.y);
  check('a second later the error is much where it was', soon < 0.4);
  check('...ten minutes later it is somewhere else entirely', later > soon);

  // THE ONE THE KINEMATIC GATE EXISTS FOR. A flyer that landed on the far side of a line
  // would make the segment out and the segment back both cut it, manufacturing a matched
  // pair of crossings the boat never made.
  const wild = new BoatSim({ at: REF, noiseM: 3, flyerChance: 1, flyerM: 400, running: true, seed: 3 });
  const flyer = wild.fix(new Date(0));
  const away = metresBetween(REF, flyer);
  check('a flyer lands hundreds of metres away, which is what a real one does',
    away > 180 && away < 650);
  check('...and STILL claims to be accurate, which is why the metadata filter is not enough',
    flyer.accuracyM === 3);

  check('the update rate is the update rate', new BoatSim({ hz: 4 }).intervalMs() === 250);
  check('...and cannot be divided by zero', new BoatSim({ hz: 0 }).intervalMs() === 10000);

  /* ------------------------------------------------------------------ the seam */

  // The client is given a fix and nothing else. If this ever fails because a field was
  // added, the question to ask is not "update the test" — it is whether a real receiver
  // would have supplied that field, because the client is about to be written against it.
  const emitted = new BoatSim({ at: REF, running: true }).fix(new Date(0));
  check('a fix carries only what a receiver could have known',
    JSON.stringify(Object.keys(emitted).sort())
      === JSON.stringify(['accuracyM', 'cogDeg', 'latitude', 'longitude', 'satellites', 'sogKn', 'time']));
}
