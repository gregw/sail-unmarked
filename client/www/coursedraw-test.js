/**
 * The executable specification for coursedraw.js.
 *
 * The thing most worth pinning here is the direction of the apex. A triangle pointing the
 * wrong way still looks like a course diagram, so a mistake would survive being looked at
 * — which is exactly the kind of error a test has to catch instead of an eye.
 */

import {
  ARROW_CENTROID, LABEL, MERGE_FRACTION, ROLE_COLOUR, TRIANGLE,
  arrowHead, darken, forwardNormal, roleColour, seats, track, triangle,
} from './coursedraw.js';

export function run(check) {
  // ------------------------------------------------------- which way is forward
  // The sanity check from the module's own comment, done as an assertion: a line drawn
  // left to right has its forward side UP the screen, which is north, which is where a
  // boat leaving a western port end to port must be heading.
  const leftToRight = forwardNormal(1, 0);
  check('a west-to-east line points forward up the screen',
    Math.abs(leftToRight.x) < 1e-9 && Math.abs(leftToRight.y + 1) < 1e-9);

  const rightToLeft = forwardNormal(-1, 0);
  check('reversing the ends reverses the apex',
    Math.abs(rightToLeft.y - 1) < 1e-9);

  // Port at the north end, starboard at the south: on screen that is downwards, and a
  // forward crossing then runs east, which is to the right.
  const topToBottom = forwardNormal(0, 1);
  check('a north-to-south line points forward to the right',
    Math.abs(topToBottom.x - 1) < 1e-9 && Math.abs(topToBottom.y) < 1e-9);

  const diagonal = forwardNormal(3, 4);
  check('the normal is a unit vector', Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-9);
  check('...and is perpendicular to the line', Math.abs(diagonal.x * 3 + diagonal.y * 4) < 1e-9);

  // ------------------------------------------------------------- seating them
  const roomy = seats(3, 600);
  check('three crossings on a long line are evenly spread', roomy.length === 3);
  check('...in order along the line', roomy[0] < roomy[1] && roomy[1] < roomy[2]);
  check('...inset from both ends', roomy[0] > 0 && roomy[2] < 600);
  check('...symmetrically', Math.abs((roomy[0] + roomy[2]) / 2 - 300) < 0.01);

  // A line only a few pixels long still has to say which crossings belong to it, so the
  // triangles keep their legible gap and overhang rather than piling into one blob.
  const cramped = seats(3, 10);
  check('a tiny line still separates its crossings',
    cramped[1] - cramped[0] === TRIANGLE.minGap && cramped[2] - cramped[1] === TRIANGLE.minGap);
  check('...still centred on the line', Math.abs((cramped[0] + cramped[2]) / 2 - 5) < 0.01);
  check('...and overhanging, which is the trade being made', cramped[0] < 0);

  check('one crossing sits at the middle', Math.abs(seats(1, 400)[0] - 200) < 0.01);
  check('no crossings, no seats', seats(0, 400).length === 0);

  // ------------------------------------------------------------- the triangle
  const along = { x: 1, y: 0 };
  const normal = { x: 0, y: -1 };
  const t = triangle({ x: 100, y: 200 }, along, normal);

  check('the base sits on the line', t.base.x === 100 && t.base.y === 200);
  check('the apex is a triangle-height away, in the crossing direction',
    t.apex.x === 100 && t.apex.y === 200 - TRIANGLE.height);
  check('the polygon has three corners', t.points.split(' ').length === 3);
  check('...two of them on the line, either side of the base',
    t.points.startsWith(`${(100 - TRIANGLE.half).toFixed(1)},200.0 ${(100 + TRIANGLE.half).toFixed(1)},200.0`));
  check('the label sits inside, between base and apex',
    t.label.y < t.base.y && t.label.y > t.apex.y);

  // Sized to be read. A course diagram whose letters cannot be made out says nothing.
  check('the triangle is big enough to hold a letter', TRIANGLE.half * 2 > LABEL.fontPx);
  check('crossings on one line stay clear of each other',
    TRIANGLE.minGap > TRIANGLE.half * 2);
  check('hovering doubles a label', LABEL.hoverScale === 2);

  // ---------------------------------------------------- the leg marker fits together
  // A circle holding an arrowhead holding a letter: each has to fit inside the last, or
  // the marker is three shapes that happen to overlap.
  const nose = { x: -ARROW_CENTROID * LABEL.arrowPx, y: 0 };
  const corners = arrowHead(nose, 0, LABEL.arrowPx).split(' ').map((p) => p.split(',').map(Number));
  check('the arrowhead sits inside its circle',
    corners.every(([x, y]) => Math.hypot(x, y) < LABEL.markR));
  check('...with room to spare, so the stroke does not clip',
    corners.every(([x, y]) => Math.hypot(x, y) < LABEL.markR - 1));
  const centroid = {
    x: corners.reduce((a, [x]) => a + x / 3, 0),
    y: corners.reduce((a, [, y]) => a + y / 3, 0),
  };
  check('...and its centroid on the circle centre, which is where the letter goes',
    Math.abs(centroid.x) < 0.1 && Math.abs(centroid.y) < 0.1);
  check('the arrowhead is wide enough for a letter at its centroid',
    LABEL.arrowPx * 1.6 * 0.66 > LABEL.fontPx * 0.7);

  // ---------------------------------------------------------- text on a triangle
  // A letter in the triangle's own colour disappears wherever the two touch.
  const bright = 'rgb(224,138,58)';
  check('text on a triangle is darker than it', darken(bright) !== bright);
  check('...noticeably so', Number(/\d+/.exec(darken(bright))[0]) < 224 * 0.6);
  check('...but not black', Number(/\d+/.exec(darken(bright))[0]) > 0);
  check('darkening keeps the hue', (() => {
    const [r, g, b] = darken(bright).match(/\d+/g).map(Number);
    return r > g && g > b;
  })());
  check('a colour it cannot parse is passed through', darken('var(--ok)') === 'var(--ok)');
  check('every role colour darkens to something legible on it',
    Object.values(ROLE_COLOUR).every((c) => darken(c) !== c));

  // ------------------------------------------------------- what a leg is FOR
  // Sequence position was the wrong thing to colour by. On a cycle there is no sequence to
  // be far through, and even on an open course the useful question about a leg is not "how
  // far along" but "does a lap start here, or end here".
  check('a leg that starts a lap is green', roleColour(true, false) === ROLE_COLOUR.start);
  check('a leg that ends one is red', roleColour(false, true) === ROLE_COLOUR.finish);
  check('everything between is one neutral colour', roleColour(false, false) === ROLE_COLOUR.leg);
  check('...so the two that matter stand out', ROLE_COLOUR.leg !== ROLE_COLOUR.start
    && ROLE_COLOUR.leg !== ROLE_COLOUR.finish);
  // A cycle's entry point is always both: a line crossed to begin a lap is crossed again
  // the same way to end it.
  check('a leg that does both asks for a gradient instead', roleColour(true, true) === null);
  check('the start colour is the start triangle\'s green', ROLE_COLOUR.start === 'rgb(47,208,122)');
  check('the finish colour is the finish triangle\'s red', ROLE_COLOUR.finish === 'rgb(255,95,86)');

  // ---------------------------------------------------------------- the track
  const cross = (bx, by, ax, ay) => ({ base: { x: bx, y: by }, apex: { x: ax, y: ay } });

  const plain = track([
    { crossings: [cross(0, 100, 0, 80)] },
    { crossings: [cross(0, 20, 0, 0)] },
    { crossings: [cross(60, 20, 60, 40)] },
  ]);
  check('three steps give three crossings and two legs', plain.length === 5);
  check('every segment is a drawable path', plain.every((seg) => seg.d.startsWith('M')));
  check('crossings are marked as such', plain.filter((s) => s.kind === 'crossing').length === 3);
  check('legs are marked as such', plain.filter((s) => s.kind === 'leg').length === 2);

  // Direction, which the first version had no way of showing at all.
  const firstLeg = plain.find((s) => s.kind === 'leg');
  check('a leg knows its midpoint', Math.abs(firstLeg.mid.y - 50) < 0.01);
  check('...and which way it runs', Math.abs(firstLeg.angle + 90) < 0.01);
  const crossingUp = plain.find((s) => s.kind === 'crossing');
  check('a crossing points the way the triangle does', Math.abs(crossingUp.angle + 90) < 0.01);

  // Course position, which drives the colour.
  check('the first crossing is at the start of the ramp', plain[0].t === 0);
  check('the last is at the end', plain[2].t === 1);
  check('a leg sits between the steps it joins', plain.find((s) => s.kind === 'leg').t === 0.25);

  // --------------------------------------------------------- turns have a radius
  // A boat leaving an apex is still on the crossing heading, so it cannot be on the next
  // leg's heading until it has turned — and a turn has a radius. An instant corner says
  // the boat pivots on the spot the moment it clears the line.
  const turned = track([
    { crossings: [cross(0, 100, 0, 80)] },      // crossing northwards
    { crossings: [cross(300, 0, 300, -20)] },   // next mark away to the east
  ]);
  const leg = turned.find((s) => s.kind === 'leg');
  check('the leg arcs out of the apex', /^M0\.0,80\.0 A/.test(leg.d));
  check('...then runs straight', leg.d.includes(' L'));
  check('...then arcs into the next base', /A[\d. ]+\d ([\d.]+),([\d.]+)$/.test(leg.d));
  check('the departure turns the right way',
    / A[\d. ]+0 1 /.test(leg.d.split(' L')[0]));
  check('...and the arrival turns back the other', / A[\d. ]+0 0 /.test(leg.d.split(' L')[1]));
  check('the arrow sits on the straight part, not on a curve',
    leg.mid.x > 20 && leg.mid.x < 280);

  // A leg that already leaves in the right direction needs no corner at all.
  const straightOn = track([
    { crossings: [cross(0, 100, 0, 80)] },
    { crossings: [cross(0, 20, 0, 0)] },
  ]).find((s) => s.kind === 'leg');
  check('a leg needing no turn draws no arc', !straightOn.d.includes('A'));

  // The corner must never eat the leg it is turning onto.
  const shortLeg = track([
    { crossings: [cross(0, 40, 0, 36)] },
    { crossings: [cross(20, 20, 20, 16)] },
  ], { corner: 500 }).find((s) => s.kind === 'leg');
  check('a huge radius is clamped to the leg', /A([\d.]+) /.exec(shortLeg.d)[1] < 20);
  check('...and the path still reaches its mark', shortLeg.d.trim().endsWith('20.0,20.0'));

  // ------------------------------------------------------- where a gate splits
  // AT the gate — the midpoint between the alternatives — and not halfway along the leg,
  // which is what sent two long diagonals across open water crossing everything else.
  const gated = track([
    { crossings: [cross(0, 400, 0, 380)] },
    { crossings: [cross(-40, 100, -40, 80), cross(40, 100, 40, 80)] },
    { crossings: [cross(0, -200, 0, -220)] },
  ]);
  const splits = gated.filter((s) => s.kind === 'split');
  const merges = gated.filter((s) => s.kind === 'merge');
  check('entering a gate splits once per alternative', splits.length === 2);
  check('leaving it merges once per alternative', merges.length === 2);

  // The trunk into the gate must reach the gate, not stop halfway across the course.
  const trunkIn = gated.filter((s) => s.kind === 'leg')[0];
  check('the trunk runs almost all the way to the gate', trunkIn.mid.y < 270 && trunkIn.mid.y > 220);

  check('each split reaches its own side', splits.some((s) => s.d.trim().endsWith('-40.0,100.0'))
    && splits.some((s) => s.d.trim().endsWith('40.0,100.0')));
  check('both split branches leave the same junction',
    splits[0].d.slice(1).split(' ')[0] === splits[1].d.slice(1).split(' ')[0]);
  check('both merge branches arrive at the same junction',
    merges[0].d.trim().split(' ').pop() === merges[1].d.trim().split(' ').pop());
  check('a split turns with a radius, not a kink', splits.every((s) => s.d.includes('A')));
  check('a merge does too', merges.every((s) => s.d.includes('A')));
  check('both sides of the gate carry the same course position', splits[0].t === splits[1].t);

  // ------------------------------------------------- and where a gate JOINS again
  // Not at the gate. Boats that took different sides sail their own line down the leg and
  // converge near the mark ahead, not at the one behind. Drawing the join at the gate as
  // well made the split look like a decorative bulge rather than a choice with a cost.
  const gateApexY = 80;
  const nextBaseY = -200;
  const expected = gateApexY + MERGE_FRACTION * (nextBaseY - gateApexY);
  const joinY = Number(/,(-?[\d.]+)$/.exec(merges[0].d.trim().split(' ').pop())[1]);
  check(`the join sits ${MERGE_FRACTION * 100}% down the leg (y ${joinY.toFixed(0)} vs ${expected.toFixed(0)})`,
    Math.abs(joinY - expected) < 14);
  check('...which is well clear of the gate it left', Math.abs(joinY - gateApexY) > 100);
  check('...and short of the mark it is heading for', Math.abs(joinY - nextBaseY) > 20);
  check('the trunk picks up from there, not from the gate',
    Math.abs(Number(/^M[-\d.]+,(-?[\d.]+)/.exec(gated.filter((s) => s.kind === 'leg')[1].d)[1]) - expected) < 14);

  // The two sides run their own line, so they are still apart at the halfway mark.
  const halfway = (gateApexY + nextBaseY) / 2;
  check('the alternatives are still separated halfway down the leg',
    merges.every((s) => /L(-?[\d.]+),/.test(s.d))
    && Math.abs(Number(/L(-?[\d.]+),/.exec(merges[0].d)[1]) - Number(/L(-?[\d.]+),/.exec(merges[1].d)[1])) > 0);

  // The fraction is a knob, not a constant baked into the geometry.
  const early = track([
    { crossings: [cross(0, 400, 0, 380)] },
    { crossings: [cross(-40, 100, -40, 80), cross(40, 100, 40, 80)] },
    { crossings: [cross(0, -200, 0, -220)] },
  ], { mergeFraction: 0.1 }).filter((s) => s.kind === 'merge');
  const earlyJoin = Number(/,(-?[\d.]+)$/.exec(early[0].d.trim().split(' ').pop())[1]);
  check('joining earlier moves it back towards the gate', earlyJoin > joinY);

  // A leg out of a plain crossing has no join to move.
  check('a non-gate leg starts at the apex itself',
    /^M0\.0,380\.0/.test(gated.filter((s) => s.kind === 'leg')[0].d));

  // A gate at both ends of a leg: merge out of one, trunk, split into the next.
  const between = track([
    { crossings: [cross(-30, 200, -30, 180), cross(30, 200, 30, 180)] },
    { crossings: [cross(-30, 0, -30, -20), cross(30, 0, 30, -20)] },
  ]);
  check('a leg between two gates still has one trunk',
    between.filter((s) => s.kind === 'leg').length === 1);
  check('...with two merges in and two splits out',
    between.filter((s) => s.kind === 'merge').length === 2
    && between.filter((s) => s.kind === 'split').length === 2);
  check('...and the trunk itself needs no corner, the branches having turned already',
    !between.find((s) => s.kind === 'leg').d.includes('A'));

  // ------------------------------------------------------------ closing a cycle
  // A closed course is a loop, and drawing it open leaves the one gap a boat never sails.
  const loop = [
    { crossings: [cross(0, 200, 0, 180)] },
    { crossings: [cross(200, 0, 200, -20)] },
    { crossings: [cross(0, -200, 0, -220)] },
  ];
  const openLegs = track(loop).filter((s) => s.kind === 'leg');
  const cycleLegs = track(loop, { closed: true }).filter((s) => s.kind === 'leg');
  check('an open course has one leg fewer than it has steps', openLegs.length === 2);
  check('a cycle joins the last mark back to the first', cycleLegs.length === 3);
  check('...and that leg runs from the last step to the first',
    cycleLegs[2].from === 2 && cycleLegs[2].to === 0);
  check('a cycle of one step has nothing to close', track([loop[0]], { closed: true }).filter((s) => s.kind === 'leg').length === 0);

  // Every segment says which step it leads to, so a gate's branches can be lettered with
  // the same step as the trunk they belong to.
  const branched = track([
    { crossings: [cross(0, 300, 0, 280)] },
    { crossings: [cross(-40, 100, -40, 80), cross(40, 100, 40, 80)] },
  ]);
  const onLeg = branched.filter((s) => s.kind !== 'crossing');
  check('the trunk and both branches lead to the same step',
    onLeg.every((s) => s.to === 1) && onLeg.length === 3);
  check('...and know which step they left', onLeg.every((s) => s.from === 0));
  check('a crossing belongs to its own step', branched.find((s) => s.kind === 'crossing').to === 0);

  check('a one-step course has one crossing and no legs', track([{ crossings: [cross(0, 0, 0, 10)] }]).length === 1);
  check('an empty course draws nothing', track([]).length === 0);
  check('a step with no drawable crossing is skipped',
    track([{ crossings: [cross(0, 0, 0, 10)] }, { crossings: [] }]).length === 1);

  // ------------------------------------------------------------- arrowheads
  const head = arrowHead({ x: 100, y: 100 }, 0, 5);
  check('an arrowhead has three corners', head.split(' ').length === 3);
  check('...with its tip in the direction of travel', head.startsWith('105.0,100.0'));
  const rotated = arrowHead({ x: 100, y: 100 }, 90, 5);
  check('...and turns with the angle', rotated.startsWith('100.0,105.0'));
}
