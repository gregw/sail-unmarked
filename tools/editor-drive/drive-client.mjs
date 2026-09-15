/**
 * The prototype client, end to end, against a live server: publish a course, make it
 * public, join it as a boat would, and sail the whole thing.
 *
 * The unit specs drive `raceclient.js` against snapshots this file wrote itself, which
 * proves the logic and proves nothing about the shape of what the server actually sends —
 * and the shapes differ in exactly the way that is easy to miss. The wire says
 * {@code "cross": "FORWARD"} where the detector wants {@code 'forward'}; the wire nests a
 * gate as two crossings on one step; the wire may hand back a cycle with no finish at all.
 * Every one of those is a fixture somebody would write correctly in a spec and get wrong
 * in the client.
 *
 * The assertion this file exists for is the LAST one. Between joining and finishing, the
 * network is taken away — `fetch` is replaced with something that throws — and the boat
 * sails the entire course with it gone. That is the architecture's central claim made
 * mechanical: a boat joins before the start, caches what it was handed, and between that
 * moment and the finish the server can be switched off without anybody on the water
 * noticing. A claim that is only in a comment is a claim nobody is checking.
 */
import { ok, report } from './dom.mjs';
import { BoatSim, bearingTo, offsetBy } from '../../client/www/boatsim.js';
import { RaceClient } from '../../client/www/raceclient.js';
import { crossingNormal } from '../../client/www/markscreen.js';

const json = async (path, options) => {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error(`${path} → ${response.status} ${(await response.text()).slice(0, 160)}`);
  return response.json();
};
const post = (path, body) => json(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body ?? {}),
});

/* ------------------------------------------------- find something worth sailing */

const [programme] = await json('/api/programmes');
const KEY = `${programme.club}/${programme.series}`;
const file = await json(`/api/programmes/${KEY}`);

// Snapshot each variant in turn and keep the first that is complete enough to be captured.
// Asked of the server rather than worked out here: "is this course sailable" is the
// server's question and it already answers it, in the same sentence the editor shows.
let taken = null;
for (const [course, body] of Object.entries(file.courses)) {
  for (const variant of Object.keys(body.variants ?? { main: {} })) {
    try {
      const result = await post(`/api/lifecycle/${KEY}/snapshots`, { course, variant });
      if (result.snapshot?.steps?.length >= 2) {
        taken = { course, variant, revision: result.snapshot.revision };
        break;
      }
    } catch {
      // Incomplete, or a template. Both are ordinary and neither is this driver's business.
    }
  }
  if (taken) break;
}
ok('the fixture holds at least one course complete enough to be captured', !!taken);
if (!taken) {
  report();
  process.exit(0);
}

await post(`/api/lifecycle/${KEY}/publications`, {
  publish: [{ course: taken.course, variant: taken.variant, revision: taken.revision }],
});

// Public is the third gate and it is a separate switch: a published snapshot on a private
// course is not offered to anybody, which is what the next assertion is really checking.
// Forced private first, so a second run against a fixture this driver has already touched
// asks the same question as the first — a driver whose result depends on whether it has
// been run before is one nobody can believe.
file.courses[taken.course].public = false;
await fetch(`/api/programmes/${KEY}`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ points: file.points, lines: file.lines, courses: file.courses }),
});
const privately = await json('/api/public');
ok('a published snapshot on a PRIVATE course is offered to nobody',
  !privately.some((c) => c.course === taken.course));

file.courses[taken.course].public = true;
await fetch(`/api/programmes/${KEY}`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ points: file.points, lines: file.lines, courses: file.courses }),
});

const offered = await json('/api/public');
const listed = offered.find((c) => c.course === taken.course);
ok('ticking public offers it, with the snapshot that was published under it',
  !!listed && listed.published.some((p) => p.revision === taken.revision));

/* ------------------------------------------------------------------- joining */

const snapshot = await post(
  `/api/join/${KEY}/${taken.course}?variant=${encodeURIComponent(taken.variant)}`);
ok('a boat is handed the PUBLISHED geometry, not whatever the editor now holds',
  snapshot.revision === taken.revision);
ok('...fully inlined, so nothing has to be resolved on the water',
  snapshot.steps.every((s) => s.crossings.every((c) => c.port?.latitude != null)));
ok('...and carrying the detection defaults the club set', !!snapshot.defaults);

const client = new RaceClient(snapshot, { boat: { sail: 'AUS 1', name: 'Spec' }, joinMode: 'ANONYMOUS' });
ok('the client prepares every step it was given', client.steps.length === snapshot.steps.length);
ok('...against one local frame for the whole course', !!client.origin);
ok('...with the senses off the wire understood',
  client.steps.every((s) => s.crossings.every((c) => c.required === 'forward' || c.required === 'reverse')));

/* --------------------------------------------- the server goes away, and we sail */

const realFetch = globalThis.fetch;
globalThis.fetch = () => {
  throw new Error('the client reached for the network while sailing');
};

const sim = new BoatSim({
  at: { latitude: 0, longitude: 0 },
  speedKn: 12,
  // No noise and no flyers: this driver is checking the wiring and the sequence, and a
  // run that failed one time in twenty because a flyer landed badly would be worse than
  // useless here. Noise is where boatsim-test.js and the page's own sliders live.
  noiseM: 0,
  running: true,
  seed: 1,
});

/** A waypoint `metres` beyond a crossing, on the far side of the sense it must be taken in. */
function beyond(crossing, metres) {
  const normal = crossingNormal(crossing.prepared, crossing.required);
  return offsetBy(crossing.midpoint, normal.x * metres, normal.y * metres);
}

// Start where a boat would: short of the first line, on the side it must cross from.
const first = client.live().crossings[0];
sim.placeAt(beyond(first, -250));
sim.headingDeg = bearingTo(sim.at, first.midpoint);

let clockMs = Date.UTC(2026, 8, 14, 12, 0, 0);
let fixes = 0;
let laps = 0;
const seen = [];
const target = client.snapshot.closed ? 2 : 1;   // two laps of a cycle, one pass of a course

/**
 * Sail until something happens, feeding every fix to the client as it goes.
 *
 * One second per fix at twelve knots is about six metres of travel, which is well outside
 * the accuracy band and well inside the kinematic ceiling — so every fix resolves to a side
 * and none of them is rejected. Both have to hold or this driver would be measuring the
 * quality gate instead of the sequence.
 */
function sailUntil(waypoint, done, limit = 900) {
  sim.steerTo(waypoint);
  for (let i = 0; i < limit; i++) {
    sim.step(1);
    clockMs += 1000;
    client.accept(sim.fix(new Date(clockMs)));
    fixes += 1;
    if (done()) return true;
    if (sim.arrived()) return done();
  }
  return done();
}

let sailing = true;
while (sailing && fixes < 12000) {
  const step = client.live();
  if (!step) break;
  const crossing = step.crossings[0];
  const before = client.crossings.length;
  const wasLap = client.lap;
  const latched = () => client.crossings.length > before;

  // TWO LEGS, and the first one is the point. A boat is often left on the far side of the
  // next line by the mark it has just rounded — which happens on any course that doubles
  // back, and on every cycle — and steering straight at a waypoint beyond a line you are
  // already beyond never crosses it at all. So: come back to the side the crossing must
  // START from, then sail through. That is also what a boat does, for the same reason.
  sailUntil(beyond(crossing, -250), latched);
  if (!latched()) sailUntil(beyond(crossing, 200), latched);

  if (!latched()) {
    sailing = false;
    break;
  }
  seen.push(client.crossings[client.crossings.length - 1].letter);
  if (client.lap > wasLap) {
    laps += 1;
    if (laps >= target) break;
  }
  if (client.finished) {
    laps = 1;
    break;
  }
}

const expected = snapshot.steps.map((s) => s.letter);
ok('the boat latched a crossing at every mark on the course',
  seen.slice(0, expected.length).join(' ') === expected.join(' '));
ok('...in the order the sequence gives them, which is the only order that exists',
  seen.length >= expected.length);
ok('...and got round', laps >= 1);
ok(snapshot.closed
  ? '...twice, with the second lap latching lines the first had already latched'
  : '...finishing, since an open course has a finish of its own',
  snapshot.closed ? client.lap >= 3 || laps >= target : client.finished);
ok('every latch carries an interpolated instant and the point it happened at',
  client.crossings.every((c) => c.time instanceof Date && c.point
    && Number.isFinite(c.point.x) && Number.isFinite(c.point.y)));
ok('nothing was rejected — a clean boat on a clean receiver should trouble nothing',
  client.rejects.length === 0);

// THE ONE THIS FILE IS FOR. Every crossing above was detected, timed and latched with the
// network throwing on contact.
ok('THE WHOLE COURSE WAS SAILED WITH THE NETWORK GONE — a boat is handed its course and '
  + 'then needs nobody', fixes > 0 && client.crossings.length >= expected.length);

globalThis.fetch = realFetch;

// And once it is back, what the boat did is still expressible against the revision it was
// handed — which is what makes a record interpretable months later.
const back = await json(`/api/courses/${snapshot.revision}`);
ok('the geometry that was sailed can still be read back by revision',
  back.revision === snapshot.revision);

report();
