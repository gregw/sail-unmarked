/**
 * The executable specification for receiver.js — the browser's geolocation as a fix.
 *
 * This is the only piece of the real client that is arithmetic rather than wiring, and it is
 * the piece nobody can check by looking: a speed derived the wrong way is a TTL countdown
 * running on nothing, and it would look entirely plausible on screen. Everything the browser
 * does not tell us is decided here, so this is where those decisions are pinned.
 *
 * The one to read first is the pair about movement inside the stated accuracy. A boat on a
 * mooring under a five-metre sky reports positions five metres apart, and dividing that by a
 * second gives ten knots — which the approach screen would then count down to a line the boat
 * is not approaching. Zero is both safer and truer: we cannot see it moving.
 */

import { MAX_GAP_S, TROUBLE, fixFrom } from './receiver.js';

const REF = { latitude: -33.8, longitude: 151.28 };
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

/** What the browser hands over, in the shape it hands it over in. */
const reading = (coords, atMs = 0) => ({
  coords: { accuracy: 4, speed: null, heading: null, altitude: null, ...coords },
  timestamp: atMs,
});

/** A position a given number of metres east and north of the reference. */
const M_PER_DEG_LAT = 111320;
const away = (eastM, northM) => ({
  latitude: REF.latitude + northM / M_PER_DEG_LAT,
  longitude: REF.longitude
    + eastM / (M_PER_DEG_LAT * Math.cos((REF.latitude * Math.PI) / 180)),
});

export function run(check) {
  /* ------------------------------------------------------------------ the seam */

  // THE ASSERTION THIS FILE EXISTS FOR, and the same one `boatsim-test.js` makes about the
  // other side: the two receivers are interchangeable only while their output is identical in
  // shape, and that decays by one convenient extra field at a time. If this list and the
  // simulator's ever differ, one of the two is feeding the client something the other cannot.
  const fix = fixFrom(reading({ ...REF, speed: 3, heading: 47 }, 1000));
  check('a fix carries exactly what the simulator\'s does, and nothing else',
    JSON.stringify(Object.keys(fix).sort())
      === JSON.stringify(['accuracyM', 'cogDeg', 'latitude', 'longitude', 'satellites', 'sogKn', 'time']));

  check('the position comes straight across', fix.latitude === REF.latitude
    && fix.longitude === REF.longitude);
  check('the instant is the DEVICE\'s, which is the clock the whole system trusts',
    fix.time.getTime() === 1000);
  check('a stated speed is converted from metres a second to knots',
    near(fix.sogKn, 5.83, 0.01));
  check('...and a stated heading is already what we want', fix.cogDeg === 47);

  // The web API does not report a satellite count and there is no way to find out. A number
  // here would be a lie in the one place somebody looks to decide whether to trust the rest
  // of the screen; the QC gate reads a null as "no evidence", not as a failure.
  check('there is no satellite count, and none is invented', fix.satellites === null);

  /* --------------------------------------------------------------- the accuracy */

  check('the stated accuracy is rounded to the system\'s own metre',
    fixFrom(reading({ ...REF, accuracy: 6.4 })).accuracyM === 6);
  // Floored exactly as the simulator floors it: a receiver claiming 0.0 m is not a thing that
  // happens, and a zero band would let a boat sitting on a line resolve to a side on noise.
  check('...and floored at one metre, because a zero band is not a claim anybody can make',
    fixFrom(reading({ ...REF, accuracy: 0 })).accuracyM === 1);
  check('...absent rather than guessed if the browser says nothing at all',
    fixFrom(reading({ ...REF, accuracy: null })).accuracyM === null);

  /* ------------------------------------------- what a laptop does not tell us */

  // `coords.speed` and `coords.heading` are null on a laptop, on a phone positioned by wifi,
  // and on most devices while stationary. TTL is distance over speed and the hull is drawn
  // pointing along its course, so a client with neither has no approach screen worth the name.
  const first = fixFrom(reading({ ...REF, accuracy: 3 }, 0));
  check('with nothing stated and nothing behind it, no speed is claimed', first.sogKn === null);
  check('...and no heading either — north would be a guess dressed as a reading',
    first.cogDeg === null);

  const north = fixFrom(reading({ ...away(0, 20), accuracy: 3 }, 2000), first);
  check('twenty metres north in two seconds reads as ten metres a second',
    near(north.sogKn, 19.44, 0.05));
  check('...heading due north', near(north.cogDeg, 0, 0.01));

  const east = fixFrom(reading({ ...away(20, 0), accuracy: 3 }, 2000), first);
  check('...and twenty metres east reads as 090, so the derivation is a compass bearing',
    near(east.cogDeg, 90, 0.01));
  const southwest = fixFrom(reading({ ...away(-20, -20), accuracy: 3 }, 2000), first);
  check('...with the third quadrant coming out at 225 rather than as a negative',
    near(southwest.cogDeg, 225, 0.01));

  /* ------------------------------ movement inside the accuracy is not movement */

  // The threshold is the receiver's OWN stated accuracy — the same reasoning the kinematic
  // gate rests on one level up. Two fixes four metres apart from a receiver claiming four
  // metres are one position reported twice.
  const wobble = fixFrom(reading({ ...away(0, 4), accuracy: 4 }, 1000), first);
  check('a wobble no bigger than the stated accuracy reads as STOPPED, not as eight knots',
    wobble.sogKn === 0);
  check('...and the heading is HELD rather than taken from the wobble',
    wobble.cogDeg === null);

  const held = fixFrom(reading({ ...away(0, 4), accuracy: 4 }, 1000), { ...first, cogDeg: 123 });
  check('...held meaning the last one we had, since a stopped boat still points somewhere',
    held.cogDeg === 123);

  /* ----------------------------------------------------- and a gap derives nothing */

  const late = fixFrom(reading({ ...away(0, 400), accuracy: 3 }, (MAX_GAP_S + 5) * 1000), first);
  check('a long gap derives no speed — the average across it is not a speed anybody is making',
    late.sogKn === null);
  const instant = fixFrom(reading({ ...away(0, 40), accuracy: 3 }, 10), first);
  check('...and neither does a pair of readings at the same instant', instant.sogKn === null);

  // A stated zero is a reading, not an absence: iOS reports speed 0 with a null heading while
  // stationary, and overriding that with a derived number would be arguing with the receiver.
  const stopped = fixFrom(reading({ ...away(0, 40), speed: 0 }, 2000), { ...first, cogDeg: 200 });
  check('a receiver that says zero is believed, even with a position that moved',
    stopped.sogKn === 0 && stopped.cogDeg === 200);

  /* ------------------------------------------------------------------- trouble */

  check('each of the API\'s three failures has a sentence somebody can act on',
    [1, 2, 3].every((code) => typeof TROUBLE[code] === 'string' && TROUBLE[code].length > 20));
  check('...and only the refusal is final, so the other two do not read as the end of it',
    TROUBLE[1].includes('reload') && !TROUBLE[2].includes('reload') && !TROUBLE[3].includes('reload'));
}
