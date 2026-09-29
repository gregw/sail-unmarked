/**
 * The executable specification for handicap.js: where a boat's own line goes for its TCF.
 *
 * Same arrangement as crossing-test.js: one set of assertions, imported by the browser page
 * and the Maven build. The courses are invented in metres east and north of a point in Sydney
 * Harbour, and are nobody's survey.
 */

import { fromLocal, toLocal, prepareLine, signedDistanceM } from './crossing.js';
import {
  envelope, fractionFor, geometry, handicapped, outward, personalise, place, tcfAt, widthThrough, zone,
} from './handicap.js';
import { RaceClient } from './raceclient.js';
import { overview } from './markscreen.js';
import { stripes } from './coursedraw.js';

const ORIGIN = { latitude: -33.8, longitude: 151.25 };
const at = (x, y) => fromLocal(ORIGIN, { x, y });
const end = (x, y) => ({ ...at(x, y), infinite: false });
const crossing = (line, px, py, sx, sy, cross = 'FORWARD') =>
  ({ line, cross, port: end(px, py), starboard: end(sx, sy) });
const local = (position) => toLocal(ORIGIN, position);
const near = (a, b, tolerance = 0.5) => Math.abs(a - b) <= tolerance;

/**
 * Start across the origin, a track up the axis from 1000 to 1200 m, and back: the 1.000 boat
 * rounds 1100 m up, so the course is 2200 m and a tenth of it either way is in the track.
 */
const HAIRPIN = {
  revision: 'abc123',
  closed: false,
  lengthNm: 2200 / 1852,
  tcfMin: 0.91,
  tcfMax: 1.09,
  steps: [
    { letter: 'S', crossings: [crossing('start', -50, 0, 50, 0)] },
    { letter: '1', handicapWidthM: 60, handicapNear: 'starboard',
      crossings: [crossing('top', 0, 1200, 0, 1000)] },
    { letter: 'F', crossings: [crossing('start', -50, 0, 50, 0, 'REVERSE')] },
  ],
};

export function run(check) {
  const g = geometry(HAIRPIN);

  check('a snapshot with a range and a width is handicapped', handicapped(HAIRPIN));
  check('...and one without a range is not, whatever its steps say',
    !handicapped({ ...HAIRPIN, tcfMin: null }));

  // ------------------------------------------------------------ TCF to fraction
  check('the midpoint of the track is the 1.000 boat', near(tcfAt(g, 0), 1, 1e-9));
  check('the near end takes the track\'s half-length off each leg', near(tcfAt(g, -1), 1 - 200 / 2200, 1e-4));
  check('...and the far end adds it', near(tcfAt(g, 1), 1 + 200 / 2200, 1e-4));
  check('a 1.000 boat is placed at the midpoint', near(fractionFor(g, 1), 0, 1e-6));
  check('a TCF half way to the top of the range is placed half way along',
    near(fractionFor(g, 1 + 100 / 2200), 0.5, 1e-4));
  check('a TCF past the range is clamped to the end of the track', fractionFor(g, 2) === 1);

  // ------------------------------------------------------------ which way the line runs
  const out = outward(g, 1);
  check('at a hairpin the line is crossed going away from the turn: north',
    near(out.x, 0, 1e-9) && near(out.y, 1, 1e-9));

  const placed = place(HAIRPIN, 1);
  const line = placed.lines[0];
  check('one line is placed, for the one handicapped step', placed.lines.length === 1 && line.step === 1);
  check('it goes by the track\'s id and the step it is on', line.line === 'top@1' && line.track === 'top');
  const p = local(line.port);
  const s = local(line.starboard);
  check('the 1.000 boat\'s line is centred on the midpoint of the track',
    near((p.x + s.x) / 2, 0) && near((p.y + s.y) / 2, 1100));
  check('...square across it, and as wide as the step says', near(p.y, s.y) && near(Math.hypot(p.x - s.x, p.y - s.y), 60));
  check('...with port to the west, so FORWARD is northbound as crossing.js has it', p.x < s.x);

  const prepared = prepareLine({ id: line.line, port: line.port, starboard: line.starboard }, ORIGIN);
  check('a boat below the line is on the side a forward crossing starts from',
    signedDistanceM(prepared, { x: 0, y: 1090 }) < 0);
  check('...and above it on the side it ends on', signedDistanceM(prepared, { x: 0, y: 1110 }) > 0);

  const faster = local(place(HAIRPIN, 1.05).lines[0].port);
  const slower = local(place(HAIRPIN, 0.95).lines[0].port);
  check('a higher TCF sails further', faster.y > p.y + 50);
  check('...and a lower one less far', slower.y < p.y - 50);

  // ------------------------------------------------------------ the boat's snapshot
  const mine = personalise(HAIRPIN, 1.05);
  check('the revision is the published one: the boat sailed that course, at its handicap',
    mine.revision === HAIRPIN.revision);
  check('the handicapped step\'s one crossing is the boat\'s own line',
    mine.steps[1].crossings.length === 1 && mine.steps[1].crossings[0].line === 'top@1');
  // 1.05 on a 2200 m course is 110 m more, 55 m on each leg: the line sits 55 m out along the track.
  check('...shown to the sailor as the track and how far out along it their line sits, not the step',
    mine.steps[1].crossings[0].name === 'top @ +55 m');
  check('...and a lower handicap as how far in', personalise(HAIRPIN, 0.95).steps[1].crossings[0].name === 'top @ \u221255 m');
  check('...finite at both ends', !mine.steps[1].crossings[0].port.infinite && !mine.steps[1].crossings[0].starboard.infinite);
  check('...crossed in the sense the step gives', mine.steps[1].crossings[0].cross === 'FORWARD');
  check('the track is kept beside it, for drawing', mine.steps[1].track.line === 'top');
  check('every other step is the published one', mine.steps[0] === HAIRPIN.steps[0] && mine.steps[2] === HAIRPIN.steps[2]);
  check('what was placed goes with it, for the record',
    mine.handicap.tcf === 1.05 && mine.handicap.lines.length === 1 && mine.handicap.fraction > 0);
  check('no TCF, or no handicap, leaves the snapshot as it was',
    personalise(HAIRPIN, null) === HAIRPIN && personalise({ ...HAIRPIN, tcfMin: null }, 1) !== undefined);

  const reversed = personalise({
    ...HAIRPIN,
    steps: HAIRPIN.steps.map((step, i) => (i === 1
      ? { ...step, crossings: [{ ...step.crossings[0], cross: 'REVERSE' }] } : step)),
  }, 1);
  check('the reverse button turns a boat\'s line round as it turns any other',
    reversed.steps[1].crossings[0].cross === 'REVERSE');

  // ------------------------------------------------------------ the parallelogram
  const corners = envelope(HAIRPIN, 1).map(local);
  check('everywhere a line can lie is four corners', corners.length === 4);
  check('...from the near end to the far, 60 m across',
    near(corners[0].y, 1000) && near(corners[1].y, 1200) && near(corners[2].y, 1200) && near(corners[3].y, 1000)
    && near(corners[0].x, -30) && near(corners[2].x, 30));
  check('a step that is not handicapped has none', envelope(HAIRPIN, 0) === null);

  // ------------------------------------------------------------ a right-angle turn
  // North up the first leg to a corner at (0, 1000), then east. The track runs out along the
  // bisector, north-west, and the line lies square to it — square to the TRACK, always.
  const CORNER = {
    closed: false,
    lengthNm: 2000 / 1852,
    tcfMin: 0.95,
    tcfMax: 1.05,
    steps: [
      { crossings: [crossing('start', -50, 0, 50, 0)] },
      { handicapWidthM: 40, handicapNear: 'port', crossings: [crossing('corner', 50, 950, -50, 1050)] },
      { crossings: [crossing('finish', 1000, 950, 1000, 1050)] },
    ],
  };
  const cg = geometry(CORNER);
  const turn = outward(cg, 1);
  check('at a right angle the line is crossed outward, to the north-west',
    near(turn.x, -Math.SQRT1_2, 1e-9) && near(turn.y, Math.SQRT1_2, 1e-9));
  check('...and the far end of the track lengthens both legs', tcfAt(cg, 1) > 1 && tcfAt(cg, -1) < 1);

  // ------------------------------------------------------------ a track passed twice
  // Twice round a windward/leeward: the windward track is passed twice, and both passings
  // slide together, so each takes its share of the correction.
  const TWICE = {
    closed: false,
    lengthNm: 3800 / 1852,
    tcfMin: 0.9,
    tcfMax: 1.1,
    steps: [
      { crossings: [crossing('start', -50, 0, 50, 0)] },
      { handicapWidthM: 60, handicapNear: 'starboard', crossings: [crossing('top', 0, 1200, 0, 1000)] },
      { crossings: [crossing('bottom', 50, 200, -50, 200)] },
      { handicapWidthM: 60, handicapNear: 'starboard', crossings: [crossing('top', 0, 1200, 0, 1000)] },
      { crossings: [crossing('start', -50, 0, 50, 0)] },
    ],
  };
  const twice = place(TWICE, 1 + 200 / 3800);
  check('a track passed twice gives a line at each passing',
    twice.lines.length === 2 && twice.lines[0].line === 'top@1' && twice.lines[1].line === 'top@3');
  check('...at the same place along it, so the correction is shared between them',
    near(local(twice.lines[0].port).y, local(twice.lines[1].port).y) && near(local(twice.lines[0].port).y, 1150, 1));

  // ------------------------------------------------------------ on the boat
  const client = new RaceClient(personalise(HAIRPIN, 1.02), { boat: { tcf: '1.02' } });
  const own = client.steps[1].crossings[0];
  check('the boat sails its own line at the handicapped step', own.line === 'top@1');
  check('...and the waypoint names it by the track and its offset, never by the id',
    client.courseList().find((row) => row.index === 1).lines[0].startsWith('top @ '));
  check('...and holds the parallelogram beside it, in its local plane', own.envelope?.length === 4
    && Number.isFinite(own.envelope[0].x));
  const record = client.record();
  check('the record carries the lines the boat was given',
    record.handicap?.lines?.[0]?.line === 'top@1' && record.handicap.fraction > 0);
  check('...and a course nobody handicapped carries none',
    new RaceClient({ ...HAIRPIN, tcfMin: null, tcfMax: null }).record().handicap === null);
  check('the overview stripes where anybody\'s line may be', overview(client).includes('handicap-stripes'));

  const drawn = stripes([{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 30 }, { x: 0, y: 30 }]);
  check('each stripe is one of the possible lines, joining the two long sides',
    drawn.includes('M0.0,0.0L0.0,30.0') && drawn.includes('M60.0,0.0L60.0,30.0'));
  check('...and there is nothing to stripe without four corners', stripes(null) === '');

  // ------------------------------------------------------------ square to the track
  // The same corner with the track drawn due north from it rather than out along the bisector: a
  // boat's line is square to the track as drawn, not to the turn, so it runs east–west and is
  // crossed northbound, and the zone is a rectangle on the track.
  const SKEWED = {
    ...CORNER,
    steps: [CORNER.steps[0], { ...CORNER.steps[1], handicapNear: undefined,
      crossings: [crossing('corner', 0, 1100, 0, 900)] }, CORNER.steps[2]],
  };
  const sg = geometry(SKEWED);
  const north = outward(sg, 1);
  check('a boat\'s line is square to the track, whatever the turn: here crossed due north',
    near(north.x, 0, 1e-9) && near(north.y, 1, 1e-9));
  check('...the near end found the server\'s way when the snapshot does not say: the south one',
    near(sg.ends[1].near.y, 900));
  const box = envelope(SKEWED, 1).map(local);
  check('...and the zone is a rectangle along the track',
    near(box[0].x, box[1].x) && near(box[2].x, box[3].x) && near(Math.abs(box[0].x - box[3].x), 40));

  // ------------------------------------------------------------ a line on its own
  const alone = zone(at(0, 0), at(0, 200), 60).map(local);
  check('a handicap line\'s zone needs no course: its two ends, widened square to it',
    alone.length === 4 && near(Math.abs(alone[0].x - alone[3].x), 60) && near(alone[0].y, 0) && near(alone[1].y, 200));
  check('...and the width grip measures square to the line',
    near(widthThrough(at(0, 0), at(0, 200), at(45, 120)), 90));
  check('...and there is no zone without a width', zone(at(0, 0), at(0, 200), null) === null);
}
