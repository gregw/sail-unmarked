/**
 * The executable specification for crossing.js.
 *
 * ONE set of assertions, run two ways: crossing-test.html renders them in a browser,
 * and tools/run-crossing-test.mjs runs them in the Maven build. Both import this file
 * rather than copying it, so they cannot drift — add a check here and it runs in both.
 *
 * The convention is sail-jinx's scoring-test.html, for the same reason: the logic that
 * decides a result lives in JavaScript because that is where it runs, so its spec has
 * to run in the build or it rots.
 */

import {
  CrossingDetector,
  RESOLUTION_M,
  alongM,
  intersect,
  prepareLine,
  projectCog,
  qualityCheck,
  side,
  signedDistanceM,
  toLocal,
} from './crossing.js';

// A patch of water near Sydney Heads. Synthetic, and used only to give the geometry
// somewhere to happen — no coordinate in this file claims to be a real mark.
const ORIGIN = { latitude: -33.8, longitude: 151.28 };

/** Metres east/north of ORIGIN, back as a lat/lon, so tests can be written in metres. */
function at(eastM, northM) {
  const mPerDegLon = 111320 * Math.cos((ORIGIN.latitude * Math.PI) / 180);
  return {
    latitude: ORIGIN.latitude + northM / 111320,
    longitude: ORIGIN.longitude + eastM / mPerDegLon,
  };
}

/** A fix at a point given in metres, t seconds after the epoch used by each test. */
function fixAt(eastM, northM, seconds, extra = {}) {
  return {
    ...toLocal(ORIGIN, at(eastM, northM)),
    time: new Date(Date.UTC(2026, 0, 1, 18, 0, seconds)),
    accuracyM: 5,
    satellites: 12,
    ...extra,
  };
}

/** An east-west line: port end 200 m west, starboard end 200 m east, both finite. */
function eastWestLine(portInfinite = false, starboardInfinite = false) {
  return prepareLine(
    {
      id: 'test-line',
      port: at(-200, 0),
      starboard: at(200, 0),
      portInfinite,
      starboardInfinite,
    },
    ORIGIN
  );
}

const QC = { minSatellites: 4, maxAccuracyM: 25, maxSpeedKn: 40 };

export function run(check) {
  // ---------------------------------------------------------------- sense: the sign
  // Port end west, starboard end east. A forward crossing leaves the port end to port
  // and the starboard end to starboard, so the boat is heading north — from the
  // southern side to the northern one. Everything else here rests on that.
  const line = eastWestLine();

  check('north of the line is the positive side', signedDistanceM(line, toLocal(ORIGIN, at(0, 50))) > 0);
  check('south of the line is the negative side', signedDistanceM(line, toLocal(ORIGIN, at(0, -50))) < 0);
  check('perpendicular distance is in metres', Math.abs(signedDistanceM(line, toLocal(ORIGIN, at(0, 84))) - 84) < 1);
  check('distance does not depend on position along the line', Math.abs(signedDistanceM(line, toLocal(ORIGIN, at(150, 84))) - 84) < 1);

  const northbound = intersect(line, toLocal(ORIGIN, at(0, -50)), toLocal(ORIGIN, at(0, 50)));
  const southbound = intersect(line, toLocal(ORIGIN, at(0, 50)), toLocal(ORIGIN, at(0, -50)));
  check('northbound over this line is forward', northbound.sense === 'forward');
  check('southbound over this line is reverse', southbound.sense === 'reverse');
  check('a segment that does not reach the line does not cut it', intersect(line, toLocal(ORIGIN, at(0, -80)), toLocal(ORIGIN, at(0, -20))) === null);
  check('a segment parallel to the line does not cut it', intersect(line, toLocal(ORIGIN, at(-50, 30)), toLocal(ORIGIN, at(50, 30))) === null);

  // -------------------------------------------------------------- extent: the ends
  check('a crossing between the ends is within extent', northbound.withinExtent);

  const pastEast = intersect(line, toLocal(ORIGIN, at(300, -50)), toLocal(ORIGIN, at(300, 50)));
  check('a crossing past the starboard end has the right sense', pastEast.sense === 'forward');
  check('...and fails extent on a finite line', !pastEast.withinExtent);
  check('...which is the Mark screen "missed" state: sense passed, extent failed', pastEast.sense === 'forward' && !pastEast.withinExtent);

  const pastWest = intersect(line, toLocal(ORIGIN, at(-300, -50)), toLocal(ORIGIN, at(-300, 50)));
  check('a crossing past the port end also fails extent', !pastWest.withinExtent);

  // An infinite end cannot be overrun. This is the whole of "only a finite end can be
  // missed", and it is why the crossing rule needs no exception at infinity.
  const halfInfinite = eastWestLine(false, true);
  const pastInfinite = intersect(halfInfinite, toLocal(ORIGIN, at(5000, -50)), toLocal(ORIGIN, at(5000, 50)));
  check('an infinite starboard end cannot be overrun', pastInfinite.withinExtent);
  const stillFinite = intersect(halfInfinite, toLocal(ORIGIN, at(-5000, -50)), toLocal(ORIGIN, at(-5000, 50)));
  check('...while the finite port end of the same line still can be', !stillFinite.withinExtent);

  // Sliding an infinite end's point along the line is a no-op geometrically. This is
  // what makes that point free to be used as the leg-measurement handle.
  const shortHandle = prepareLine({ id: 'l', port: at(-200, 0), starboard: at(200, 0), starboardInfinite: true }, ORIGIN);
  const longHandle = prepareLine({ id: 'l', port: at(-200, 0), starboard: at(9000, 0), starboardInfinite: true }, ORIGIN);
  const p = toLocal(ORIGIN, at(1000, 37));
  check('an infinite end\'s point does not change the line', Math.abs(signedDistanceM(shortHandle, p) - signedDistanceM(longHandle, p)) < 0.5);

  // --------------------------------------------------------- the accuracy band
  check('well clear of the line resolves to a side', side(line, toLocal(ORIGIN, at(0, 40)), 5, 10) === 1);
  check('inside the band resolves to neither side', side(line, toLocal(ORIGIN, at(0, 4)), 5, 10) === 0);
  check('a null band falls back to the fix\'s own accuracy', side(line, toLocal(ORIGIN, at(0, 4)), 25, null) === 0);
  check('...and that same fix resolves when the receiver claims better', side(line, toLocal(ORIGIN, at(0, 4)), 1, null) === 1);

  // ------------------------------------------------- resolution and the COG warning
  // One metre, declared once, for the whole system. A scoring edge that moves with the
  // twelfth decimal place is one nobody can argue in front of a protest committee.
  check('the system resolution is one metre', RESOLUTION_M === 1);
  check('distances are rounded to the metre', signedDistanceM(line, toLocal(ORIGIN, at(0, 84.4))) === 84);
  check('...in both directions', signedDistanceM(line, toLocal(ORIGIN, at(0, -84.4))) === -84);

  // The Mark screen's COG projection. Boat 100 m south of the line, steering due north.
  const straightAt = projectCog(line, toLocal(ORIGIN, at(0, -100)), 0);
  check('the COG projection finds the line ahead', straightAt !== null);
  check('...at the right distance', straightAt.distanceM === 100);
  check('...comfortably inside the ends', straightAt.warning === null);
  check('...halfway along a 400 m line', Math.abs(straightAt.alongM - 200) <= 1);

  check('a COG pointing away from the line reads as a dash', projectCog(line, toLocal(ORIGIN, at(0, -100)), 180) === null);
  check('a COG parallel to the line reads as a dash', projectCog(line, toLocal(ORIGIN, at(0, -100)), 90) === null);

  // The endpoint is a hard edge at this resolution, so the boat has to be told early.
  const nearEnd = projectCog(line, toLocal(ORIGIN, at(180, -100)), 0);
  check('a projection close to a finite end warns', nearEnd.warning === 'near-end');
  check('...and says how many metres are left', nearEnd.marginM <= 50 && nearEnd.marginM >= 0);

  const pastEnd = projectCog(line, toLocal(ORIGIN, at(260, -100)), 0);
  check('a projection past a finite end warns harder', pastEnd.warning === 'beyond-end');
  check('...and reports the miss before the boat gets there', !pastEnd.withinExtent);

  // An infinite end is not a hazard, so it must not raise a warning.
  const pastInfiniteEnd = projectCog(eastWestLine(false, true), toLocal(ORIGIN, at(9000, -100)), 0);
  check('running out past an infinite end is not a warning', pastInfiniteEnd.warning === null);
  check('...because an infinite end cannot be missed', pastInfiniteEnd.withinExtent);

  check('distance along the line is reported in metres from the port end', alongM(line, 0.5) === 200);
  check('...and is negative beyond the port end', alongM(line, -0.25) === -100);

  // ------------------------------------------------------------ quality control
  check('a good fix is accepted', qualityCheck(fixAt(0, 0, 0), null, QC).verdict === 'ACCEPTED');
  check('too few satellites is rejected on metadata', qualityCheck(fixAt(0, 0, 0, { satellites: 2 }), null, QC).verdict === 'REJECTED_METADATA');
  check('a poor stated accuracy is rejected on metadata', qualityCheck(fixAt(0, 0, 0, { accuracyM: 90 }), null, QC).verdict === 'REJECTED_METADATA');

  // The kinematic gate. A flyer 400 m away one second later implies about 780 kn.
  const lastGood = { ...at(0, 0), time: new Date(Date.UTC(2026, 0, 1, 18, 0, 0)) };
  const flyer = { ...at(0, 400), time: new Date(Date.UTC(2026, 0, 1, 18, 0, 1)), accuracyM: 5, satellites: 12 };
  const gated = qualityCheck(flyer, lastGood, QC);
  check('an impossible ground speed is rejected on kinematics', gated.verdict === 'REJECTED_KINEMATIC');
  check('...and the reason names the speed, for the audit trail', /kn$/.test(gated.reason));

  const real = { ...at(0, 3), time: new Date(Date.UTC(2026, 0, 1, 18, 0, 1)), accuracyM: 5, satellites: 12 };
  check('a fast boat is not a flyer', qualityCheck(real, lastGood, QC).verdict === 'ACCEPTED');

  // ------------------------------------------------- confirmation and the latch
  // A boat approaching from the south and crossing north, one fix a second.
  function runTrack(detector, metres) {
    let latched = null;
    metres.forEach(([e, n], i) => {
      const fix = fixAt(e, n, i);
      latched = detector.accept({ x: fix.x, y: fix.y }, fix) ?? latched;
    });
    return latched;
  }

  const clean = new CrossingDetector(eastWestLine(), 'forward', { confirmFixes: 3, accuracyBandM: 2 });
  const crossing = runTrack(clean, [[0, -40], [0, -30], [0, -20], [0, -10], [0, 10], [0, 20], [0, 30]]);
  check('a clean 3-and-3 crossing latches', crossing !== null);
  check('...in the required sense', crossing.cross === 'forward');
  check('...with three confirmations each side', crossing.confirmBefore >= 3 && crossing.confirmAfter >= 3);

  // The crossing instant is INTERPOLATED. The boat is 10 m south at t=3 and 10 m north
  // at t=4, so it cut the line halfway between them — at t=3.5, which is the time of
  // no fix at all. Taking it from either confirming fix would bias it by half a second.
  check('the crossing time is interpolated, not a fix time', crossing.time.getTime() === Date.UTC(2026, 0, 1, 18, 0, 3, 500));

  // A single flyer onto the far side and back. It cuts the line twice, which is exactly
  // the failure the confirmation count exists to defeat: it cannot produce three
  // consecutive confirmed fixes on the far side.
  const flyerTrack = new CrossingDetector(eastWestLine(), 'forward', { confirmFixes: 3, accuracyBandM: 2 });
  check('a single flyer does not manufacture a crossing',
    runTrack(flyerTrack, [[0, -40], [0, -30], [0, -20], [0, 60], [0, -20], [0, -30], [0, -40]]) === null);

  // Wrong sense is logged and ignored, never scored.
  const wrongWay = new CrossingDetector(eastWestLine(), 'forward', { confirmFixes: 3, accuracyBandM: 2 });
  check('a crossing the wrong way does not latch',
    runTrack(wrongWay, [[0, 40], [0, 30], [0, 20], [0, -20], [0, -30], [0, -40]]) === null);
  check('...but is logged for audit', wrongWay.rejected.some((r) => r.note === 'wrong sense'));

  // Missed: the boat changed sides past the finite starboard end.
  const missed = new CrossingDetector(eastWestLine(), 'forward', { confirmFixes: 3, accuracyBandM: 2 });
  check('a side change past a finite end does not latch',
    runTrack(missed, [[400, -40], [400, -30], [400, -20], [400, 20], [400, 30], [400, 40]]) === null);
  check('...and says which end it was past', missed.rejected.some((r) => r.note.includes('starboard end')));
  check('...and the Mark screen reads "missed"', missed.status(toLocal(ORIGIN, at(400, 40))).state === 'missed');

  // The same track over a line whose starboard end is infinite does latch.
  const infiniteEnd = new CrossingDetector(eastWestLine(false, true), 'forward', { confirmFixes: 3, accuracyBandM: 2 });
  check('the same track latches when that end is infinite',
    runTrack(infiniteEnd, [[400, -40], [400, -30], [400, -20], [400, 20], [400, 30], [400, 40]]) !== null);

  // Latching is monotone: nothing later can un-make it.
  const latchedThenBack = new CrossingDetector(eastWestLine(), 'forward', { confirmFixes: 3, accuracyBandM: 2 });
  runTrack(latchedThenBack, [[0, -40], [0, -30], [0, -20], [0, 10], [0, 20], [0, 30], [0, -30], [0, -40], [0, -50]]);
  check('a crossing that has latched stands', latchedThenBack.latched !== null);
  check('...and the Mark screen still reads "crossed"', latchedThenBack.status(toLocal(ORIGIN, at(0, -50))).state === 'crossed');
}
