/**
 * The executable specification for raceclient.js.
 *
 * This is the bookkeeping that sits on top of the crossing detector, and it decides two
 * things a sailor would notice immediately if they were wrong: WHICH LINE is the live one,
 * and WHICH SCREEN they are looking at. Neither is arithmetic anybody can check by reading
 * it — the first is a sequence rule with a cycle in it and the second is a hysteresis with
 * two thresholds and a dwell — so both belong in the build.
 *
 * The sequence rule is the one with teeth. A two-lap windward/leeward crosses its leeward
 * line three times as three different steps, and a client that offered every fix to every
 * step would latch the finish on the way to the first windward mark. The check for that is
 * below and it fails loudly if the rule is ever relaxed.
 */

import { MAX_ACCEL_MS2, RaceClient, bearingLocal, clock, midpointOf, originOf } from './raceclient.js';
import { offsetBy } from './boatsim.js';

const REF = { latitude: -33.8, longitude: 151.28 };
const at = (eastM, northM) => offsetBy(REF, eastM, northM);

/** A finite line across the course, `northM` up the beat and `halfM` either side. */
function line(id, northM, cross = 'FORWARD', halfM = 150) {
  const port = at(-halfM, northM);
  const starboard = at(halfM, northM);
  return {
    line: id,
    cross,
    port: { latitude: port.latitude, longitude: port.longitude, infinite: false },
    starboard: { latitude: starboard.latitude, longitude: starboard.longitude, infinite: false },
  };
}

/**
 * A line running NORTH along the leg, `eastM` off the centreline, infinite southward.
 *
 * The shape of a gate's side: a mark with a line running back down the leg from it, so the
 * fleet comes up between the two and turns out through one of them. It is also the shape that
 * makes perpendicular distance useless as a measure of how near the mark a boat is.
 */
function alongLeg(id, eastM, cross = 'FORWARD') {
  // Port end south and infinite, starboard end north, so a forward crossing of a line east of
  // the centreline goes east and one west of it goes west — outward, as a gate is rounded.
  const south = at(eastM, -60);
  const north = at(eastM, 40);
  const outward = eastM > 0;
  return {
    line: id,
    cross,
    port: { ...(outward ? north : south), infinite: !outward },
    starboard: { ...(outward ? south : north), infinite: outward },
  };
}

const DEFAULTS = {
  confirmFixes: 3,
  accuracyBandM: null,
  qc: { minSatellites: 4, maxAccuracyM: 25, maxSpeedKn: 40 },
};

function snapshot(steps, options = {}) {
  return {
    revision: 'testrevision',
    club: 'example.org',
    series: 'spec',
    course: 'spec-course',
    variant: 'main',
    name: 'Spec course',
    closed: !!options.closed,
    steps,
    lengthNm: 1,
    defaults: DEFAULTS,
  };
}

/** A start, a windward mark, and a finish back on the start line — the shape that bites. */
const WINDWARD_LEEWARD = snapshot([
  { letter: 'S', entry: false, legNm: null, crossings: [line('leeward', 0, 'FORWARD')] },
  { letter: '1', entry: false, legNm: 0.1, crossings: [line('windward', 300, 'FORWARD')] },
  { letter: 'F', entry: false, legNm: 0.1, crossings: [line('leeward', 0, 'REVERSE')] },
]);

/**
 * Feed the client a straight run of fixes, at a spacing the quality gate will accept.
 *
 * Ten metres every two seconds is a shade under ten knots — well inside the kinematic
 * ceiling — and comfortably outside the five-metre accuracy band, so each fix resolves to
 * a side instead of falling in the band. Both of those have to be true or this spec would
 * be testing the gate rather than the thing it means to.
 */
/** Perpendicular distance, for assertions about what the plot chose to colour. */
const signedOf = (prepared, point) =>
  (prepared.d.x * (point.y - prepared.port.y) - prepared.d.y * (point.x - prepared.port.x))
  / prepared.length;

const CLOCK = new WeakMap();

function sail(client, from, to, options = {}) {
  const stepM = options.stepM ?? 10;
  const dt = options.dtSeconds ?? 2;
  const accuracyM = options.accuracyM ?? 5;
  const distance = Math.hypot(to.e - from.e, to.n - from.n);
  const count = Math.max(1, Math.round(distance / stepM));
  const cog = ((Math.atan2(to.e - from.e, to.n - from.n) * 180) / Math.PI + 360) % 360;
  for (let i = 0; i <= count; i++) {
    const position = at(from.e + ((to.e - from.e) * i) / count, from.n + ((to.n - from.n) * i) / count);
    client.accept({
      latitude: position.latitude,
      longitude: position.longitude,
      time: new Date(tick(client, dt * 1000)),
      accuracyM,
      satellites: 12,
      sogKn: (stepM / dt) * 1.94384,
      cogDeg: cog,
      ...(options.fix ?? {}),
    });
  }
  return client;
}

/** Advance the harness's clock for one client and hand back the instant. */
function tick(client, ms) {
  const now = (CLOCK.get(client) ?? 0) + ms;
  CLOCK.set(client, now);
  return now;
}

const fresh = (snap, options) => new RaceClient(snap, options);

export function run(check) {
  /* ------------------------------------------------------------- the local frame */

  check('the frame is anchored on the first surveyed end anywhere on the course',
    Math.abs(originOf(WINDWARD_LEEWARD).latitude - at(-150, 0).latitude) < 1e-9);
  check('a course with no positions has no frame', originOf(snapshot([])) === null);

  let refused = false;
  try {
    fresh(snapshot([{ letter: 'S', entry: false, crossings: [] }]));
  } catch (e) {
    refused = true;
  }
  check('...and joining one is refused rather than half-working', refused);

  check('a crossing is measured to the midpoint of its two ends',
    Math.abs(midpointOf(line('x', 100)).latitude - at(0, 100).latitude) < 1e-9);
  check('bearings in the local frame are compass bearings',
    Math.abs(bearingLocal({ x: 0, y: 0 }, { x: 100, y: 0 }) - 90) < 1e-9);

  /* ------------------------------------------------------- latching and advancing */

  let client = fresh(WINDWARD_LEEWARD);
  check('a fresh client is on the first step', client.at === 0 && client.live().letter === 'S');
  // Deliberately offset so no fix lands ON the line: the crossing instant is interpolated
  // between two of them, and a run that stepped exactly onto it would assert nothing.
  sail(client, { e: 0, n: -123 }, { e: 0, n: 117 });
  check('sailing through the start line latches it', client.crossings.length === 1);
  check('...and moves to the next mark', client.at === 1 && client.live().letter === '1');
  check('...recording WHEN, interpolated between two fixes rather than taken from one',
    client.crossings[0].time instanceof Date
    && !client.fixes.some((f) => f.time.getTime() === client.crossings[0].time.getTime()));
  check('...and WHERE, which is what the Mark screen rings',
    client.crossings[0].point && Math.abs(client.crossings[0].point.y) < 6);
  check('...on the evidence of three fixes either side',
    client.crossings[0].confirmBefore >= 3 && client.crossings[0].confirmAfter >= 3);

  /* ---------------------------------------------- ONLY THE LIVE STEP SEES FIXES */

  // The boat is now on its way to the windward mark. The leeward line it has just crossed
  // is ALSO the finish — the same line, a different step — and turning back over it must
  // do nothing at all, because the finish is two steps away.
  sail(client, { e: 0, n: 117 }, { e: 0, n: -123 });
  check('recrossing the finish line early latches NOTHING — the sequence is the model',
    client.crossings.length === 1);
  check('...and leaves the boat on the mark it was going to', client.at === 1);

  // Round the windward mark properly, and only then is that line the live one.
  client = fresh(WINDWARD_LEEWARD);
  sail(client, { e: 0, n: -120 }, { e: 0, n: 120 });
  sail(client, { e: 0, n: 120 }, { e: 0, n: 420 });
  check('rounding the windward mark advances to the finish',
    client.at === 2 && client.live().letter === 'F');
  sail(client, { e: 0, n: 420 }, { e: 0, n: -120 });
  check('...and crossing the leeward line the OTHER way now finishes the course',
    client.finished && client.crossings.length === 3);
  check('...with nothing live to sail to', client.live() === null);

  // The same line, crossed the wrong way for the step that is live, is not a crossing.
  const wrongWay = fresh(WINDWARD_LEEWARD);
  sail(wrongWay, { e: 0, n: 120 }, { e: 0, n: -120 });
  check('a required-forward line crossed backwards does not latch', wrongWay.crossings.length === 0);

  /* ------------------------------------------------------------ past the end */

  const missed = fresh(WINDWARD_LEEWARD);
  sail(missed, { e: 260, n: -120 }, { e: 260, n: 120 });
  check('changing sides past the end of the line is not a crossing', missed.crossings.length === 0);
  const detector = missed.live().crossings[0].detector;
  check('...and it is logged as past the end rather than silently dropped',
    detector.rejected.some((r) => r.note.startsWith('side change was past')));
  check('...which the screen reads as MISSED',
    detector.status(missed.point).state === 'missed');

  /* ------------------------------------------------------------------ a gate */

  const GATED = snapshot([
    { letter: 'S', entry: false, crossings: [line('start', 0)] },
    { letter: '1', entry: false, crossings: [line('gate-left', 300, 'FORWARD', 60), line('gate-right', 300, 'FORWARD', 60)] },
    { letter: 'F', entry: false, crossings: [line('start', 600)] },
  ]);
  // The two halves of that gate sit either side of the centreline: shift one east.
  GATED.steps[1].crossings[0].port.longitude = at(-200, 300).longitude;
  GATED.steps[1].crossings[0].starboard.longitude = at(-80, 300).longitude;
  GATED.steps[1].crossings[1].port.longitude = at(80, 300).longitude;
  GATED.steps[1].crossings[1].starboard.longitude = at(200, 300).longitude;

  const gated = fresh(GATED);
  sail(gated, { e: 0, n: -120 }, { e: 0, n: 120 });
  check('a gate is still ONE step', gated.at === 1 && gated.live().crossings.length === 2);
  sail(gated, { e: 0, n: 120 }, { e: -140, n: 420 });
  check('...and taking either side of it is rounding it', gated.at === 2);
  check('...with which side recorded, because the next leg depends on it',
    gated.crossings[1].gateSide === 'gate-left');
  check('...and the other side simply abandoned', gated.crossings.length === 2);

  /* ------------------------------------------------------------------ a cycle */

  const CYCLE = snapshot([
    { letter: '0', entry: true, crossings: [line('south', 0)] },
    { letter: '1', entry: false, crossings: [line('north', 300)] },
  ], { closed: true });

  const cycle = fresh(CYCLE);
  sail(cycle, { e: 0, n: -120 }, { e: 0, n: 120 });
  sail(cycle, { e: 0, n: 120 }, { e: 0, n: 420 });
  check('a cycle comes round to step 0 rather than finishing',
    cycle.at === 0 && !cycle.finished);
  check('...counting the lap', cycle.lap === 2);

  // The second lap must be able to latch the same lines again. A detector latches once and
  // stands, which is right within a lap and wrong across them — so they are rebuilt.
  sail(cycle, { e: 0, n: 420 }, { e: 0, n: -120 });
  sail(cycle, { e: 0, n: -120 }, { e: 0, n: 120 });
  check('...and a line crossed last lap latches again this lap',
    cycle.crossings.filter((c) => c.letter === '0').length === 2);
  check('...tagged with the lap it belongs to',
    cycle.crossings.filter((c) => c.lap === 2).length >= 1);

  /* ------------------------------------------------------------ quality control */

  const noisy = fresh(WINDWARD_LEEWARD);
  const before = noisy.fixes.length;
  const bad = at(0, -100);
  noisy.accept({
    latitude: bad.latitude, longitude: bad.longitude, time: new Date(1000),
    accuracyM: 5, satellites: 2, sogKn: 6, cogDeg: 0,
  });
  check('a fix from two satellites never reaches the detector', noisy.fixes.length === before);
  check('...and says why, because a contested result needs the record',
    noisy.rejects[0].what === 'REJECTED_METADATA' && noisy.rejects[0].reason.includes('2 satellites'));

  const flying = fresh(WINDWARD_LEEWARD);
  sail(flying, { e: 0, n: -120 }, { e: 0, n: -60 });
  const flyer = at(0, 4000);
  flying.accept({
    latitude: flyer.latitude, longitude: flyer.longitude,
    time: new Date(tick(flying, 2000)), accuracyM: 5, satellites: 12, sogKn: 6, cogDeg: 0,
  });
  check('a flyer four kilometres away is rejected on implied speed, not on its own claim',
    flying.rejects.some((r) => r.what === 'REJECTED_KINEMATIC'));
  check('...so it cannot manufacture a crossing on the way out and another on the way back',
    flying.crossings.length === 0);

  /* --------------------------------- a jump that proves not to be a flyer */

  /** Put the boat somewhere else and keep it there, the way a receiver re-acquiring does. */
  function jump(client, to, count = 4, dt = 2) {
    for (let i = 0; i < count; i++) {
      // A metre of drift per fix, so the run agrees with itself the way real fixes do
      // rather than being suspiciously identical.
      const position = at(to.e + i, to.n + i);
      client.accept({
        latitude: position.latitude, longitude: position.longitude,
        time: new Date(tick(client, dt * 1000)), accuracyM: 5, satellites: 12,
        sogKn: 0, cogDeg: 0,
      });
    }
    return client;
  }

  // The old behaviour: every fix after a jump is measured against a position the boat has
  // left, so the SAME displacement is re-refused until enough time has passed to forgive it.
  // A 400 m jump at a 40 kn ceiling took twenty seconds, and for all twenty the boat was
  // navigating on a position it was not at.
  const moved = fresh(WINDWARD_LEEWARD);
  sail(moved, { e: 0, n: -800 }, { e: 0, n: -700 });
  const settled = moved.crossings.length;
  jump(moved, { e: 0, n: -250 }, 4);
  check('a jump that keeps agreeing with itself is believed, not waited out',
    moved.relocations === 1);
  check('...after the same number of fixes a crossing needs, not after twenty seconds',
    moved.rejects.filter((r) => r.what === 'REJECTED_KINEMATIC').length === moved.confirmFixes - 1);
  // Within the drift `jump` puts on the run, which is there so the fixes agree with each
  // other the way real ones do rather than being suspiciously identical.
  check('...and the boat is now where the fixes say it is',
    Math.abs(moved.nearestM() - 250) <= 5);
  check('...with the move itself in the audit trail, and how far it was',
    moved.rejects.some((r) => r.what === 'RELOCATED' && r.metres > 400));

  // THE ONE THAT MATTERS. The segment from where we thought the boat was to where it turns
  // out to be sweeps straight across the start line. Testing it would manufacture a crossing
  // out of a receiver dropout.
  const across = fresh(WINDWARD_LEEWARD);
  sail(across, { e: 0, n: -300 }, { e: 0, n: -200 });
  jump(across, { e: 0, n: 250 }, 5);
  check('A JUMP ACROSS A LINE IS NOT A CROSSING — a dropout must not score a mark',
    across.crossings.length === 0);
  check('...and the boat still owes the mark it never saw itself cross', across.at === 0);
  check('...its detector started again, so no stale run survives the gap',
    across.live().crossings[0].detector.latched === null);
  check('...and the trail was thrown away, since every point in it was somewhere else',
    across.fixes.length <= 5);

  // A flyer is still a flyer: one fix out, and the next one back.
  const lone = fresh(WINDWARD_LEEWARD);
  sail(lone, { e: 0, n: -300 }, { e: 0, n: -200 });
  const wasAt = lone.point.y;
  jump(lone, { e: 0, n: 4000 }, 1);
  sail(lone, { e: 0, n: -200 }, { e: 0, n: -150 });
  check('one fix out on its own still moves nothing', lone.relocations === 0);
  check('...and the boat carries on from where it really was', lone.point.y > wasAt);

  // Bad metadata is not evidence about position, however much of it agrees.
  const blind = fresh(WINDWARD_LEEWARD);
  sail(blind, { e: 0, n: -300 }, { e: 0, n: -200 });
  for (let i = 0; i < 6; i++) {
    const p = at(0, 250 + i);
    blind.accept({ latitude: p.latitude, longitude: p.longitude,
      time: new Date(tick(blind, 2000)), accuracyM: 5, satellites: 2, sogKn: 0, cogDeg: 0 });
  }
  check('a run of two-satellite fixes never moves the boat, however well they agree',
    blind.relocations === 0);

  /* ------------------------------------------------- what the screen may claim is current */

  const quiet = fresh(WINDWARD_LEEWARD);
  sail(quiet, { e: 0, n: -400 }, { e: 0, n: -300 });
  const lastFix = quiet.fix.time.getTime();
  check('a fresh fix is current', !quiet.stale(lastFix + 500) && quiet.sinceFix(lastFix + 500) === 500);
  check('...and one from ten seconds ago is not', quiet.stale(lastFix + 10000));
  check('a client that has never had a fix is stale by definition',
    fresh(WINDWARD_LEEWARD).stale(0));
  check('rejected fixes are counted, so the screen can say how bad it is',
    blind.sinceGood === 6);
  check('...and the count is cleared by a good one', quiet.sinceGood === 0);

  /* ----------------------------------------------------- which screen, and when */

  const screen = fresh(WINDWARD_LEEWARD);
  sail(screen, { e: 0, n: -900 }, { e: 0, n: -600 }, { stepM: 20, dtSeconds: 5 });
  check('a boat six hundred metres off is looking at the course, not at one mark',
    screen.view(screen.fix.time.getTime()) === 'overview');
  check('...which is the distance the rule is actually reading', Math.round(screen.approachM()) === 600);
  check('...and on a line met square that is the perpendicular distance, so nothing about '
    + 'the ordinary case changed', Math.round(screen.nearestM()) === 600);

  // Slowly, so the TIME test cannot be what takes the screen: at 4 m/s, 30 s is 120 m, so a
  // boat at 150 m is outside both tests and one at 80 m is inside the radius.
  sail(screen, { e: 0, n: -600 }, { e: 0, n: -150 }, { stepM: 20, dtSeconds: 5 });
  check('...and is still on the course a hundred and fifty metres out', screen.view(screen.fix.time.getTime()) === 'overview');
  sail(screen, { e: 0, n: -150 }, { e: 0, n: -80 }, { stepM: 20, dtSeconds: 5 });
  check('inside the approach radius the Mark screen takes over by itself',
    screen.view(screen.fix.time.getTime()) === 'mark');

  // Hysteresis. Backing off to 130 m — outside the 100 m it was taken at, inside the 160 m
  // it is given back at — must NOT hand the screen back, or a boat holding station near a
  // start line would flip between them on noise alone.
  sail(screen, { e: 0, n: -80 }, { e: 0, n: -130 }, { stepM: 20, dtSeconds: 5 });
  check('...and holds it while the boat backs off a little — no flicker on station',
    screen.view(screen.fix.time.getTime()) === 'mark');
  sail(screen, { e: 0, n: -130 }, { e: 0, n: -400 }, { stepM: 20, dtSeconds: 5 });
  check('...but gives it back once the boat has genuinely gone away',
    screen.view(screen.fix.time.getTime()) === 'overview');

  // Time, not just distance: a fast boat is shown the mark earlier than a fixed radius
  // would allow, because at fifteen knots a hundred metres is thirteen seconds and a boat
  // wants the screen before that.
  const quick = fresh(WINDWARD_LEEWARD);
  sail(quick, { e: 0, n: -900 }, { e: 0, n: -180 }, { stepM: 30, dtSeconds: 4 });
  check('a boat coming in fast gets the Mark screen before it is inside the radius',
    quick.approachM() > quick.approach.enterM && quick.view(quick.fix.time.getTime()) === 'mark');

  // A LINE THAT RUNS ALONG THE LEG, which is what a gate's half-infinite sides do — and what
  // broke this. Perpendicular distance is the distance to the line's infinite EXTENSION, so a
  // boat four kilometres down the leg between two such lines is still only the gate's
  // half-width from both of them: the Mark screen took over on the start line and never gave
  // it back. Measured to the nearest point of the DEFINED extent instead, the same boat is
  // four kilometres away and is shown the course, which is what it needs.
  const ALONG_THE_LEG = snapshot([
    { letter: 'S', entry: false, legNm: null, crossings: [line('leeward', -4300, 'FORWARD')] },
    { letter: '1', entry: false, legNm: null, crossings: [
      // Both sides run north, infinite southward, 75 m either side of the centreline: the
      // fleet comes up between them and turns out through one.
      alongLeg('gate-west', -75, 'FORWARD'),
      alongLeg('gate-east', 75, 'FORWARD'),
    ] },
    { letter: 'F', entry: false, legNm: null, crossings: [line('leeward', -4300, 'REVERSE')] },
  ]);
  const distant = fresh(ALONG_THE_LEG);
  sail(distant, { e: 0, n: -4400 }, { e: 0, n: -4200 }, { stepM: 20, dtSeconds: 5 });
  check('a boat four kilometres from a gate whose sides run along the leg is shown the '
    + 'COURSE, not the mark', distant.at === 1 && distant.view(distant.fix.time.getTime()) === 'overview');
  check('...because it is measured to the part of the line it would cross, not to the '
    + 'line\'s infinite extension', Math.round(distant.approachM()) > 4000);
  check('...which perpendicular distance put at the gate\'s half-width, and that is the '
    + 'reading that took the screen', Math.round(distant.nearestM()) === 75);
  sail(distant, { e: 0, n: -4200 }, { e: 0, n: -100 }, { stepM: 40, dtSeconds: 8 });
  check('...and it still takes the screen once the boat is genuinely up at the gate',
    distant.view(distant.fix.time.getTime()) === 'mark');

  /* --------------------------------------- and the sailor can overrule the rule */

  // The sailor never has to ASK for the Mark screen, which is the design — but "never has to"
  // is not "cannot": somebody setting up, or checking the next leg on a long beat, has every
  // right to pick, and a display that refused would be insisting it knows better about what
  // somebody wants to look at.
  const forced = fresh(WINDWARD_LEEWARD);
  sail(forced, { e: 0, n: -900 }, { e: 0, n: -600 }, { stepM: 20, dtSeconds: 5 });
  check('six hundred metres out, AUTO says the course', forced.view(forced.fix.time.getTime()) === 'overview');
  forced.setViewMode('mark');
  check('...and asking for the line gets the line, at any range',
    forced.view(forced.fix.time.getTime()) === 'mark');
  // The rule goes on running underneath, so AUTO resumes with the right answer for where the
  // boat is NOW rather than for where it was when a button was pressed.
  sail(forced, { e: 0, n: -600 }, { e: 0, n: -70 }, { stepM: 20, dtSeconds: 5 });
  forced.setViewMode('auto');
  check('...and handing AUTO back answers for where the boat is now, not for where it was '
    + 'when the button was pressed', forced.view(forced.fix.time.getTime()) === 'mark');
  forced.setViewMode('overview');
  check('...asking for the course holds it even inside the approach radius',
    forced.view(forced.fix.time.getTime()) === 'overview');
  check('...and anything else is read as AUTO, so a stale value cannot strand somebody on a '
    + 'screen with no way back',
    forced.setViewMode('nonsense') === 'auto' && forced.view(forced.fix.time.getTime()) === 'mark');

  // Forcing the Mark screen cannot conjure a mark that is not there: a complete course has no
  // live step, and the honest answer then is the course.
  const complete = fresh(WINDWARD_LEEWARD);
  sail(complete, { e: 0, n: -123 }, { e: 0, n: 117 });
  sail(complete, { e: 0, n: 117 }, { e: 0, n: 320 });
  sail(complete, { e: 0, n: 320 }, { e: 0, n: -30 });
  complete.setViewMode('mark');
  check('...but a finished course has no mark to force, and says so',
    complete.finished && complete.view(complete.fix.time.getTime()) === 'overview');

  // And the dwell: the moment of the cross is the thing somebody wants to look at twice.
  // Stopped at the fix that latches — three confirming the far side and no more — so the
  // dwell is measured from the crossing rather than from a minute of sailing after it.
  const dwelling = fresh(WINDWARD_LEEWARD);
  sail(dwelling, { e: 0, n: -123 }, { e: 0, n: 27 }, { dtSeconds: 4 });
  const crossedAt = dwelling.fix.time.getTime();
  check('...the crossing having latched on the fix the run stopped at', dwelling.at === 1);
  check('after a crossing the Mark screen is held, so the latch can be read',
    dwelling.view(crossedAt + 1000) === 'mark');
  check('...and then the course comes back',
    dwelling.view(crossedAt + dwelling.approach.dwellMs + 1) === 'overview');

  /* --------------------------------------------------------- what the screen draws */

  const drawing = fresh(WINDWARD_LEEWARD);
  sail(drawing, { e: 0, n: -400 }, { e: 0, n: -80 });
  const mark = drawing.markState(drawing.fix.time.getTime());
  check('the Mark screen is handed the step it is watching', mark.step.letter === 'S');
  check('...the perpendicular distance in the cell and the picture', Math.round(Math.abs(mark.perpDistM)) === 80);
  check('...a COG projection, since the boat is pointed at the line', mark.projection !== null);
  check('...the bearing of the next leg for the arrow at the top',
    Math.abs(mark.legBearing - 0) < 1 || Math.abs(mark.legBearing - 360) < 1);
  check('...and every recent fix with the side it was resolved to',
    mark.trail.length === drawing.fixes.length && mark.trail.every((f) => f.side === -1));

  const wide = fresh(WINDWARD_LEEWARD);
  sail(wide, { e: 400, n: -400 }, { e: 400, n: -80 });
  check('a boat lined up outside the end is TOLD, well before it gets there',
    wide.markState(wide.fix.time.getTime()).projection.warning === 'beyond-end');

  /* ------------------------------------------------------- what the boat steers for */

  // DTW is to the MIDDLE of the next line and is not the perpendicular distance to it. From
  // 400 m off to one side, the two differ by two hundred metres — and the one worth steering
  // by is the one that says how far there is left to sail.
  const steering = fresh(WINDWARD_LEEWARD);
  sail(steering, { e: 400, n: -400 }, { e: 400, n: -300 });
  const wpt = steering.waypoint();
  check('the waypoint is the midpoint of the next line, not the nearest part of it',
    Math.round(wpt.distanceM) === 500 && Math.round(steering.nearestM()) === 300);
  check('...with a true bearing to it', Math.abs(wpt.bearingDeg - 306.87) < 0.1);
  check('...to one-metre resolution, like every other distance in the system',
    Number.isInteger(wpt.distanceM));
  check('...and it NAMES the line, which is what a sailing instruction talks about',
    wpt.lines.length === 1 && wpt.lines[0] === 'leeward');
  check('...alongside the letter, which is only where in the sequence it is',
    wpt.letter === 'S');
  check('...and is not a gate', !wpt.gate);

  // On a gate it is the mean of the two, which is the same point the model measures a leg
  // into a gate to — so DTW and the course's own leg length are one quantity, not two that
  // nearly agree.
  const atGate = fresh(GATED);
  sail(atGate, { e: 0, n: -120 }, { e: 0, n: 120 });
  const gateWpt = atGate.waypoint();
  // Asserted as a bearing and a range rather than as coordinates: the local frame is
  // anchored on the start line's PORT END, not on the centreline, so a raw x of zero would
  // be a claim about where the origin happens to sit rather than about the gate.
  check('a gate is steered for BETWEEN its two sides — dead ahead from the centreline',
    gateWpt.bearingDeg === 0);
  check('...at the range the model measures the leg into it to',
    Math.round(gateWpt.distanceM) === 180);
  check('...and BOTH lines are named, since the choice has not been made yet',
    gateWpt.lines.length === 2 && gateWpt.lines.includes('gate-left') && gateWpt.lines.includes('gate-right'));
  check('...and it says it is a gate', gateWpt.gate === true);

  const done = fresh(WINDWARD_LEEWARD);
  sail(done, { e: 0, n: -120 }, { e: 0, n: 120 });
  sail(done, { e: 0, n: 120 }, { e: 0, n: 420 });
  sail(done, { e: 0, n: 420 }, { e: 0, n: -120 });
  check('a finished course has nothing left to steer for', done.waypoint() === null);

  // A step with nothing to cross is dropped, and the numbering closes over the gap: `at`
  // counts through the client's own steps, so an index carried over from the snapshot would
  // point at a different step from the one being sailed.
  const holey = fresh(snapshot([
    { letter: 'S', crossings: [line('leeward', 0)] },
    { letter: 'x', crossings: [] },
    { letter: 'F', crossings: [line('windward', 300)] },
  ]));
  check('a step with nothing to cross is not a step', holey.steps.length === 2);
  check('...and the ones that remain are numbered by where they now are',
    holey.steps.map((st) => st.index).join() === '0,1');

  /* ------------------------------------------------------ how long until we cross */

  const closing = fresh(WINDWARD_LEEWARD);
  sail(closing, { e: 0, n: -400 }, { e: 0, n: -200 });
  const ttl = closing.timeToLine();
  // Ten metres every two seconds is 5 m/s; 200 m of it is forty seconds to the water.
  check('time to line is the distance along the COG over the speed being made',
    Math.abs(ttl.reachSeconds - 40) < 4);
  check('...and says the present course DOES cross the line', ttl.crossing === true);

  // THE NUMBER SHOWN COUNTS DOWN TO THE LATCH, NOT TO THE WATER. A crossing is not latched
  // when it happens, it is latched when three consecutive fixes have proved it — so a
  // countdown that stopped at the water would reach zero and then sit there while nothing
  // happened, which reads as the application having missed it.
  check('...with the confirmation delay added, since that is when the screen will say CROSSED',
    Math.abs(ttl.seconds - (ttl.reachSeconds + ttl.confirmSeconds)) < 1e-9
    && ttl.confirmSeconds > 0);
  // Fixes two seconds apart and three of them wanted: six seconds, measured from the fixes
  // that actually arrived rather than from what the receiver was asked for.
  check('...the delay being the fix interval times the count the detector wants',
    Math.abs(ttl.confirmSeconds - closing.confirmFixes * 2) < 0.5);
  const slower = fresh(WINDWARD_LEEWARD);
  sail(slower, { e: 0, n: -400 }, { e: 0, n: -200 }, { dtSeconds: 4 });
  check('...so a receiver reporting half as often is twice as long to be sure',
    slower.timeToLine().confirmSeconds > ttl.confirmSeconds * 1.6);

  // The colour question, which is the more important half: a projection can be a perfectly
  // good twenty seconds away and still be running out past the pin.
  const wide2 = fresh(WINDWARD_LEEWARD);
  sail(wide2, { e: 400, n: -400 }, { e: 400, n: -200 });
  const missing = wide2.timeToLine();
  check('a course running outside the end still has a time...', missing.seconds > 0);
  check('...but is marked as not crossing, which is what turns the number red',
    missing.crossing === false);

  // Smoothed on the INPUTS. Asserted against what the SAME fix would have given unsmoothed,
  // which is the only claim worth making — "the number moved less than X" would be a claim
  // about the fix rate, since an exponential smoother takes a fixed FRACTION of each new
  // reading and the fraction depends on how long it has been.
  const jumpy = fresh(WINDWARD_LEEWARD);
  sail(jumpy, { e: 0, n: -400 }, { e: 0, n: -250 }, { stepM: 5, dtSeconds: 1 });
  const steady = jumpy.timeToLine().seconds;
  const wild = at(0, -245);
  jumpy.accept({ latitude: wild.latitude, longitude: wild.longitude,
    time: new Date(tick(jumpy, 1000)), accuracyM: 5, satellites: 12, sogKn: 40, cogDeg: 0 });
  const after = jumpy.timeToLine().seconds;
  const raw = jumpy.smoothCogM / (40 * 1852 / 3600);   // what that one fix alone would say
  check('one wild speed reading moves the time to line far less than it would raw',
    Math.abs(after - steady) < Math.abs(raw - steady) / 2);
  check('...though it does move it, because a smoother that ignored new data would be a '
    + 'number that never changed', after < steady);

  // The defence is physics, not statistics: a hull reporting five knots to forty between two
  // fixes has not accelerated, it has misreported. Real acceleration passes through freely.
  const surging = fresh(WINDWARD_LEEWARD);
  sail(surging, { e: 0, n: -400 }, { e: 0, n: -300 }, { stepM: 5, dtSeconds: 1 });
  const wasMaking = surging.smoothSogMs;
  const on = at(0, -294);
  surging.accept({ latitude: on.latitude, longitude: on.longitude,
    time: new Date(tick(surging, 1000)), accuracyM: 5, satellites: 12, sogKn: 40, cogDeg: 0 });
  check('the smoothed speed cannot change faster than a boat can accelerate',
    surging.smoothSogMs <= wasMaking + MAX_ACCEL_MS2 * 1 + 1e-9);
  check('...but it does keep climbing while the readings keep saying so',
    surging.smoothSogMs > wasMaking);

  const away = fresh(WINDWARD_LEEWARD);
  sail(away, { e: 0, n: -400 }, { e: 0, n: -300 });
  const backwards = at(0, -310);
  away.accept({ latitude: backwards.latitude, longitude: backwards.longitude,
    time: new Date(tick(away, 2000)), accuracyM: 5, satellites: 12, sogKn: 6, cogDeg: 180 });
  check('a boat sailing away from the line has no time to it — the line is behind it',
    away.timeToLine().seconds === null);

  const parked = fresh(WINDWARD_LEEWARD);
  sail(parked, { e: 0, n: -400 }, { e: 0, n: -300 }, { stepM: 10, dtSeconds: 2 });
  for (let i = 0; i < 12; i++) {
    const p = at(0, -300);
    parked.accept({ latitude: p.latitude, longitude: p.longitude,
      time: new Date(tick(parked, 2000)), accuracyM: 5, satellites: 12, sogKn: 0, cogDeg: 0 });
  }
  check('a stopped boat has no time to the line rather than an infinite one',
    parked.timeToLine().seconds === null);
  check('...and still knows its course would cross it', parked.timeToLine().crossing === true);

  /* ------------------------------------------------------- the leg the boat is ON */

  // Two different legs, both wanted, and using one where the other belongs turns the display
  // to a leg the boat has not started yet. The leg INTO a mark is what Leg up puts at the top;
  // the leg OUT of it is what the arrow points at.
  const onTheBeat = fresh(WINDWARD_LEEWARD);
  check('there is no leg into the start of an open course', onTheBeat.legInto(onTheBeat.steps[0]) === null);
  check('the leg into the windward mark runs north, mark to mark',
    Math.abs(onTheBeat.legInto(onTheBeat.steps[1])) < 0.5);
  check('...and the leg into the finish runs back south',
    Math.abs(onTheBeat.legInto(onTheBeat.steps[2]) - 180) < 0.5);
  check('a cycle has a leg into step 0 — the closing one, from the last mark',
    Math.abs(fresh(CYCLE).legInto(fresh(CYCLE).steps[0]) - 180) < 0.5);

  // Sailing up the beat, crabbing forty degrees off, at the mark the leg runs INTO.
  sail(onTheBeat, { e: 0, n: -120 }, { e: 0, n: 120 });
  sail(onTheBeat, { e: 0, n: 120 }, { e: 0, n: 220 }, { fix: { cogDeg: 40 } });
  const beating = onTheBeat.markState(onTheBeat.fix.time.getTime());
  check('approaching the windward mark, Leg up follows the leg being SAILED',
    onTheBeat.at === 1 && Math.abs(beating.legUp) < 0.5);
  check('...not the boat, which is thirty or forty degrees off it on every tack',
    beating.legUp !== beating.cogDeg);
  check('...and not the leg the ARROW points at, which is the one after this mark',
    Math.abs(beating.legBearing - 180) < 0.5);

  // The brief: on a cross "the display turns so the new leg is up, the this-leg arrow points
  // straight up". So for the length of the dwell the two are the same leg.
  const justCrossed = fresh(WINDWARD_LEEWARD);
  sail(justCrossed, { e: 0, n: -123 }, { e: 0, n: 27 });
  const dwelt = justCrossed.markState(justCrossed.fix.time.getTime());
  check('on a cross the display turns to the NEW leg', dwelt.legUp === dwelt.legBearing);
  check('...which is what makes the this-leg arrow point straight up', dwelt.legUp != null);

  /* ------------------------------------------------------ the leg after this mark */

  // There is a next leg everywhere except one place on a course, and the screen's F marks
  // exactly that place. Crossing the SECOND-LAST line still has a leg after it — the one to
  // the finish — with a bearing well worth pointing at.
  const midCourse = fresh(WINDWARD_LEEWARD);
  sail(midCourse, { e: 0, n: -400 }, { e: 0, n: -300 });
  const atStart = midCourse.markState(midCourse.fix.time.getTime());
  check('approaching the start there is a leg beyond it', atStart.legBearing != null);

  sail(midCourse, { e: 0, n: -300 }, { e: 0, n: 120 });
  sail(midCourse, { e: 0, n: 120 }, { e: 0, n: 220 });
  const atWindward = midCourse.markState(midCourse.fix.time.getTime());
  check('...approaching the SECOND-LAST mark there is still one, to the finish',
    midCourse.at === 1 && atWindward.legBearing != null);

  sail(midCourse, { e: 0, n: 220 }, { e: 0, n: 420 });
  sail(midCourse, { e: 0, n: 420 }, { e: 0, n: 200 });
  const atFinish = midCourse.markState(midCourse.fix.time.getTime());
  check('...and only at the finish itself is there nothing beyond',
    midCourse.at === 2 && atFinish.legBearing === null);

  // A cycle has no finish, so it always has a next leg — the closing one runs back to step 0.
  const looping = fresh(CYCLE);
  sail(looping, { e: 0, n: -120 }, { e: 0, n: -40 });
  check('a cycle always has a next leg, because a lap has no finish of its own',
    looping.markState(looping.fix.time.getTime()).legBearing != null);

  /* ------------------------------------------- what the plot is willing to call */

  // Two questions used to share one band, and sharing it made the picture of a crossing
  // unreadable: with the band set to the fix's own accuracy, a boat crossing at speed under a
  // five-metre sky spends a second inside it, so the moment being explained came out as a run
  // of grey. The plot now asks the GEOMETRIC question — which side, at the metre this system
  // resolves to — while the latch goes on asking the stricter one.
  const plotted = fresh(WINDWARD_LEEWARD);
  sail(plotted, { e: 0, n: -60 }, { e: 0, n: 60 }, { stepM: 1, dtSeconds: 1, accuracyM: 5 });
  const crossed = plotted.steps[0].crossings[0].prepared;
  const shown = plotted.trailAgainst(crossed);
  const grey = shown.filter((f) => f.side === 0).length;
  check('a crossing is plotted with almost nothing left uncalled', grey <= 2);
  check('...only the fixes that round onto the line itself',
    shown.filter((f) => f.side === 0)
      .every((f) => Math.abs(signedOf(crossed, f)) <= 0.5));
  check('...where the old shared band left a dozen of them grey',
    shown.filter((f) => Math.abs(signedOf(crossed, f)) <= 5).length > grey * 3);
  check('and the crossing still latched, because none of this is what the latch counts',
    plotted.crossings.length === 1);

  /* --------------------------------------------------------------- the race clock */

  // Every start is self-timed — there is nothing here to fire a gun — so the clock runs from
  // the crossing, never from when the screen was opened.
  const timed = fresh(WINDWARD_LEEWARD);
  sail(timed, { e: 0, n: -600 }, { e: 0, n: -400 });
  check('before the start there is no elapsed time, not a zero',
    timed.elapsed(timed.fix.time.getTime()) === null && timed.startAt === null);

  // Offset so no fix lands ON the line, or the interpolated instant coincides with one and
  // the next check asserts nothing.
  sail(timed, { e: 0, n: -400 }, { e: 0, n: 123 });
  check('crossing the start starts the clock', timed.startAt instanceof Date);
  check('...at the INTERPOLATED instant, which is why the detector interpolates at all',
    !timed.fixes.some((f) => f.time.getTime() === timed.startAt.getTime()));
  const running = timed.elapsed(timed.startAt.getTime() + 65000);
  check('...and it runs', running === 65000);
  check('...and is not finished', !timed.complete() && timed.finishAt === null);

  sail(timed, { e: 0, n: 123 }, { e: 0, n: 423 });
  check('rounding a mark in between does not touch it', timed.finishAt === null);

  sail(timed, { e: 0, n: 423 }, { e: 0, n: -123 });
  check('crossing the finish stops it', timed.complete() && timed.finishAt instanceof Date);
  const total = timed.elapsed(timed.finishAt.getTime() + 999999);
  check('...and the total stops moving, because it is now a result',
    total === timed.finishAt.getTime() - timed.startAt.getTime());
  check('...which is the two crossings apart, to the interpolated instant',
    total === timed.crossings[2].time.getTime() - timed.crossings[0].time.getTime());

  // On a cycle each lap restarts it, which is what makes the number a lap time.
  const lapped = fresh(CYCLE);
  sail(lapped, { e: 0, n: -120 }, { e: 0, n: 120 });
  const firstLap = lapped.startAt;
  sail(lapped, { e: 0, n: 120 }, { e: 0, n: 420 });
  sail(lapped, { e: 0, n: 420 }, { e: 0, n: -120 });
  sail(lapped, { e: 0, n: -120 }, { e: 0, n: 120 });
  check('a cycle restarts the clock each lap, so the number is a lap time',
    lapped.lap === 2 && lapped.startAt.getTime() > firstLap.getTime());
  check('...and never finishes, because a lap has no finish of its own', !lapped.complete());

  /* ------------------------------------------------------------------ the clock */

  check('a clock reads m:ss', clock(65000) === '1:05');
  check('...and h:mm:ss once there is an hour in it', clock(3725000) === '1:02:05');
  check('...and a dash before there is anything to time', clock(null) === '—');
}
