/**
 * The executable specification for markscreen.js.
 *
 * Drawing code usually does not need a spec — a picture that comes out wrong is seen to be
 * wrong. These two do, because they are the ones whose failure still looks like a picture.
 *
 *   {@link crossingNormal} decides which way the apex points. A triangle pointing the
 *   wrong way is still a triangle, and a Mark screen that drew the required crossing
 *   backwards would look entirely normal while telling a boat to cross the wrong way.
 *
 *   {@link projector} decides which way is up. Screen y runs down while north runs up, and
 *   a sign lost in the rotation mirrors the whole plot — which, on a symmetrical course,
 *   is invisible until somebody sails it.
 *
 * `coursedraw-test.js` pins the same derivation for the editor's chart, and the two must
 * agree: the course a boat sees on the water and the course it was designed as are the
 * same geometry, and the day they disagree the sailor is the one who finds out.
 */

import { prepareLine } from './crossing.js';
import { BASEMAPS } from './geo.js';
import { ROLE_COLOUR } from './coursedraw.js';
import { clock } from './raceclient.js';
import {
  HOLD,
  NM_FROM_M,
  BOAT,
  REAL,
  TURN_DEG_S,
  northPointer,
  ORIENTATIONS,
  OVERVIEW_ZOOM,
  OverviewView,
  chartBar,
  orientationBar,
  viewBar,
  overview,
  overviewUp,
  PlotView,
  bearingOf,
  boxesClash,
  clipToView,
  labelBox,
  COG_FIT_CAP,
  turnBetween,
  LINE_LABEL_PX,
  OTHER_SIDE,
  rejectMark,
  signalLine,
  crossingNormal,
  distanceTo,
  hhmmss,
  markScreen,
  overviewPanel,
  plot,
  projector,
  statusLine,
  upBearing,
  waypointRow,
  Turner,
} from './markscreen.js';
import { offsetBy } from './boatsim.js';
import { RaceClient } from './raceclient.js';

const REF = { latitude: -33.8, longitude: 151.28 };
const at = (eastM, northM) => offsetBy(REF, eastM, northM);

/** An east-west line: port 150 m west, starboard 150 m east, both finite. */
const eastWest = () => prepareLine({
  id: 'spec', port: at(-150, 0), starboard: at(150, 0),
  portInfinite: false, starboardInfinite: false,
}, REF);

const near = (a, b, tolerance = 0.5) => Math.abs(a - b) <= tolerance;

export function run(check) {
  /* ----------------------------------------------- which way the crossing goes */

  const line = eastWest();
  const forward = crossingNormal(line, 'forward');
  check('a forward crossing of an east-west line goes NORTH — the check to re-run if ever in doubt',
    near(bearingOf(forward.x, forward.y), 0));
  check('...and the reverse of the same line goes south',
    near(bearingOf(...Object.values(crossingNormal(line, 'reverse'))), 180));
  check('...as a unit vector, so it can be scaled to whatever the plot needs',
    near(Math.hypot(forward.x, forward.y), 1, 1e-9));

  /* -------------------------------------------------------- which way is up */

  const centre = { x: 0, y: 0 };
  const northUp = projector(centre, 0, 1, 200, 200);
  const above = northUp({ x: 0, y: 50 });
  check('at North up, a point due north is drawn ABOVE the centre',
    near(above.x, 100) && above.y < 100);
  const right = northUp({ x: 50, y: 0 });
  check('...and a point due east is drawn to the right of it',
    right.x > 100 && near(right.y, 100));

  // Turning the display must turn the WORLD, not the boat: with east at the top, the thing
  // that was to the right comes to the top and the thing that was at the top goes left.
  const eastUp = projector(centre, 90, 1, 200, 200);
  const wasEast = eastUp({ x: 50, y: 0 });
  check('with east at the top, what was east is now above the centre',
    near(wasEast.x, 100) && wasEast.y < 100);
  const wasNorth = eastUp({ x: 0, y: 50 });
  check('...and what was north has swung to the left', wasNorth.x < 100 && near(wasNorth.y, 100));

  const scaled = projector(centre, 0, 2, 200, 200)({ x: 0, y: 50 });
  check('the scale is metres to pixels', near(scaled.y, 100 - 100));

  /* -------------------------------------------------------- the orientations */

  const state = {
    watched: { prepared: line, required: 'forward' },
    legUp: 60,
    legBearing: 285,
    cogDeg: 30,
  };
  check('North up never turns', upBearing(state, 'north') === 0);
  check('Leg up puts the leg being SAILED at the top, not the one after it',
    upBearing(state, 'leg') === 60 && upBearing(state, 'leg') !== state.legBearing);
  check('Line perp squares the line across, so the crossing is always straight up',
    near(upBearing(state, 'perp'), 0));
  check('COG up puts the boat\'s own heading at the top, which is not the leg it is sailing',
    upBearing(state, 'cog') === 30 && upBearing(state, 'cog') !== upBearing(state, 'leg'));
  check('...falling back to the leg with no COG to hand, rather than snapping the world to '
    + 'north under somebody who asked for it not to',
    upBearing({ ...state, cogDeg: null }, 'cog') === 60);
  check('...and Leg up falls back to the COG where there is no leg at all, rather than '
    + 'snapping to north under the helm at the last mark',
    upBearing({ ...state, legUp: null, legBearing: null }, 'leg') === 30);

  /* -------------------------------------------------------------- the sentences */

  check('approaching says how much evidence there is so far',
    statusLine({ state: 'approaching', confirmed: 3, projection: null }).includes('3 fixes'));
  check('...and reads properly when there is only one',
    statusLine({ state: 'approaching', confirmed: 1, projection: null }).includes('1 fix.'));
  check('a crossing names the instant a protest would turn on',
    statusLine({ state: 'crossed', latched: { time: new Date(2026, 0, 1, 18, 42, 7) } })
      .includes('18:42:07'));
  check('a miss says where it went wrong, not merely that it did',
    statusLine({ state: 'missed', rejected: [{ note: 'side change was past the starboard end' }] })
      .includes('past the starboard end'));
  check('and a course running out past the end is a WARNING, long before it is a miss',
    statusLine({ state: 'approaching', confirmed: 2, projection: { warning: 'near-end', marginM: 30 } })
      .includes('30 m'));

  check('a time reads as a clock', hhmmss(new Date(2026, 0, 1, 6, 5, 4)) === '06:05:04');
  check('...and nothing reads as a dash', hhmmss(null) === '—');

  /* ----------------------------------------------------------- it actually draws */

  // A smoke test through the real client, because the plot takes what markState() produces
  // and the two drifting apart is the failure this catches.
  const snapshot = {
    revision: 'spec', club: 'c', series: 's', course: 'co', variant: 'main', name: 'Spec',
    closed: false,
    // Three steps, so the mark being approached has a leg BEYOND the next one. With only two,
    // every approach is an approach to the last-but-one and the screen would always be
    // drawing the finish marker — which is a real case, checked separately, and a poor
    // fixture for everything else.
    steps: [
      { letter: 'S', crossings: [{ line: 'a', cross: 'FORWARD',
        port: { ...at(-150, 0), infinite: false }, starboard: { ...at(150, 0), infinite: false } }] },
      { letter: '1', crossings: [{ line: 'b', cross: 'FORWARD',
        port: { ...at(-150, 300), infinite: false }, starboard: { ...at(150, 300), infinite: false } }] },
      { letter: 'F', crossings: [{ line: 'c', cross: 'FORWARD',
        port: { ...at(-150, 600), infinite: false }, starboard: { ...at(150, 600), infinite: false } }] },
    ],
    defaults: { confirmFixes: 3, accuracyBandM: null, qc: { minSatellites: 4, maxAccuracyM: 25, maxSpeedKn: 40 } },
  };
  const client = new RaceClient(snapshot);
  let t = 0;
  for (let n = -80; n <= -20; n += 10) {
    const p = at(0, n);
    client.accept({ latitude: p.latitude, longitude: p.longitude, time: new Date((t += 2000)),
      accuracyM: 5, satellites: 12, sogKn: 9.7, cogDeg: 0 });
  }
  const mark = client.markState(t);
  const svg = plot(mark, { orientation: 'north' });
  check('the plot draws the line it is watching', svg.includes('var(--line)'));
  check('...the boat, as a hull seen from above rather than an arrow — an arrow says which way '
    + 'something points and on a chart reads as a cursor',
    svg.includes(BOAT.hull) && /<circle cx="0" cy="-2.6"/.test(svg));
  check('...the COG projection with a ring where it cuts', svg.includes('stroke-dasharray="7,5"'));
  check('...and every fix it has accepted',
    (svg.match(/r="3\.5"/g) || []).length === client.fixes.length);

  /* ------------------------------------ the frame holds still so the boat can be seen to move */

  // A plot that re-fits every frame cannot show movement: centre it on anything that moves
  // with the boat and the boat stays in the same pixels however fast it is sailing, which is
  // the one thing the approach view has to be able to say.
  const held = new PlotView();
  // The projection has to move WITH the boat: the COG cut is reckoned from the boat's own
  // position, so advancing one without the other puts the crossing point beyond the line and
  // the frame is then right to rebuild itself around it.
  const shot = (boatPoint) => plot({
    ...mark,
    point: boatPoint,
    fixes: [boatPoint],
    trail: [],
    projection: { ...mark.projection, distanceM: mark.projection.distanceM - (boatPoint.y - mark.point.y) },
  }, { orientation: 'north', view: held, width: 340, height: 300 });
  const whereBoat = (svg) => {
    const m = /translate\(([-\d.]+),([-\d.]+)\) rotate/.exec(svg);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  };

  // A HUNDRED AND EIGHTY METRES FURTHER OUT than the fixture everything else uses, because
  // the fixture sits at twenty metres, which is on the zoom floor: inside `MIN_SPAN_M` the
  // scale is clamped, so twelve metres of progress is a fifth of the scale and the frame is
  // rightly given up as "closer in". That is the stepped zoom working, not a frame failing to
  // hold, and asserting the hold at the one range where it should not hold tested nothing.
  const startPoint = { x: mark.point.x, y: mark.point.y - 180 };
  const first = whereBoat(shot(startPoint));
  const framedAt = { ...held.centre, scale: held.scale };
  const crept = whereBoat(shot({ x: startPoint.x, y: startPoint.y + 12 }));
  check('with the frame held, a boat that sails twelve metres MOVES on the plot',
    Math.abs(first.y - crept.y) > 4);
  check('...upward, because it closed a line that is north of it', crept.y < first.y);
  check('...and the frame did not move under it, which is what makes that visible',
    held.centre.x === framedAt.x && held.centre.y === framedAt.y && held.scale === framedAt.scale);

  // It gives the frame up for the two reasons that make holding it useless.
  const held3 = (scale, points) => ({ up: 0, subject: 'a', centre: { x: 0, y: 0 }, scale, points, width: 340, height: 300 });
  const edging = new PlotView();
  edging.frame(held3(1, [{ x: 0, y: 0 }]));
  check('a boat well inside the picture does not disturb the frame',
    !edging.frame(held3(1, [{ x: 0, y: 40 }])).reframed);
  const leaving = edging.frame(held3(1, [{ x: 0, y: 140 }]));
  check('...one about to leave it rebuilds it around itself', leaving.reframed
    && leaving.why === 'leaving the view');

  // The rule is about ALL THREE, not just the boat: the crossing point is the one that leaves
  // first when a boat bears away from the line it was lined up on.
  const wide = new PlotView();
  wide.frame(held3(1, [{ x: 0, y: 0 }]));
  check('the boat staying put does not save a frame the crossing point has left',
    wide.frame(held3(1, [{ x: 0, y: 0 }, { x: 300, y: 0 }])).reframed);

  const zooming = new PlotView();
  zooming.frame(held3(1, [{ x: 0, y: 0 }]));
  check('a scale that has barely drifted is not worth a jump',
    !zooming.frame(held3(1 + HOLD.scaleTolerance * 0.5, [{ x: 0, y: 0 }])).reframed);
  const closer = zooming.frame(held3(1 + HOLD.scaleTolerance * 2, [{ x: 0, y: 0 }]));
  check('...one that could usefully be a sixth closer in is', closer.reframed
    && closer.why === 'closer in');

  // Zooming in only. A boat that has genuinely gone away trips the edge test instead, which
  // is an honest reason to rebuild rather than a number drifting the other way.
  const out = new PlotView();
  out.frame(held3(1, [{ x: 0, y: 0 }]));
  check('the view does not zoom back OUT on a wobble',
    !out.frame(held3(0.5, [{ x: 0, y: 0 }])).reframed);

  const named = (subject, up = 0) => ({ up, subject, centre: { x: 0, y: 0 }, scale: 1, points: [{ x: 0, y: 0 }], width: 340, height: 300 });
  const moving = new PlotView();
  moving.frame(named('step-1:north'));
  check('a different mark is a different picture and is never held across',
    moving.frame(named('step-2:north')).why === 'new mark');
  check('...and so is a deliberate change of orientation, which arrives in the subject',
    moving.frame(named('step-2:leg')).reframed);
  // But the bearing ITSELF is not part of the identity: it changes on every frame while the
  // display swings onto a new leg, and a frame rebuilt on every degree of that never holds.
  const swinging = new PlotView();
  swinging.frame(named('step-1:leg'));
  check('a display mid-swing keeps its frame, degree by degree',
    !swinging.frame(named('step-1:leg', 37)).reframed);

  /* ------------------------------------------------ turning onto the new leg, slowly */

  const turner = new PlotView();
  check('the first draw snaps — a display that swung into place on opening would be wrong '
    + 'for the first second of every screen', turner.turn(90, true, 0) === 90);
  check('...and is not turning', !turner.turning());
  const half = turner.turn(180, true, 1000);
  check('a second later it has come round by the turn rate, not all the way',
    Math.abs(half - (90 + TURN_DEG_S)) < 1e-9);
  check('...and says it is still turning', turner.turning());
  check('...arriving when it arrives', turner.turn(180, true, 10000) === 180 && !turner.turning());
  check('North up never turns: it snaps and stays snapped',
    new PlotView().turn(0, false, 0) === 0
    && new PlotView().turn(270, false, 0) === 270);
  const shortWay = new PlotView();
  shortWay.turn(350, true, 0);
  check('a swing takes the short way round, not the long way',
    shortWay.turn(10, true, 200) > 350);
  check('the very first draw has nothing to hold', new PlotView().frame({ up: 0, subject: 'a', centre: { x: 1, y: 2 }, scale: 3, boat: { x: 0, y: 0 }, width: 340, height: 300 }).why === 'first');

  /* ------------------------------------------- a wrong-way crossing is not a mistake */

  // Crossing back to set up properly is the ordinary thing — it happens on every start and
  // every time somebody overstands — so marking it like a miss tells a sailor mid-manoeuvre
  // that they have blown the mark, which is untrue and badly timed.
  const wrongWay = rejectMark({ x: 50, y: 50 }, 'wrong sense');
  check('a wrong-way crossing is a BLUE cross, never a red one',
    wrongWay.includes('var(--fromside)') && !wrongWay.includes('var(--warn)'));
  check('...a cross rather than a tick, because a thin tick could not be seen on a dark plot',
    (wrongWay.match(/<line/g) || []).length === 2);

  const pastEnd = rejectMark({ x: 50, y: 50 }, 'side change was past the starboard end');
  check('a MISS keeps the red cross, because a miss is what it is',
    pastEnd.includes('var(--warn)') && (pastEnd.match(/<line/g) || []).length === 2);

  const wobble = rejectMark({ x: 50, y: 50 }, 'far side not confirmed');
  check('a candidate that never confirmed is neither, and is drawn as neither',
    wobble.includes('<circle') && wobble.includes('var(--muted)'));

  /* ------------------------------------------- what the primary screen always shows */

  check('a long leg reads in nautical miles, which is how a leg is described',
    distanceTo(1852).value === '1.00' && distanceTo(1852).unit === 'nm');
  check('...and the last hundred metres in metres, which is what is steered in',
    distanceTo(140).value === '140' && distanceTo(140).unit === 'm');
  check('...switching at a fifth of a mile', distanceTo(NM_FROM_M).unit === 'nm'
    && distanceTo(NM_FROM_M - 1).unit === 'm');
  check('...and nothing reads as a dash rather than as zero', distanceTo(null).value === '—');

  check('the waypoint row names the LINE, not only the mark letter',
    waypointRow({ letter: '1', lines: ['manly-to-shark/windward'] })
      .includes('manly-to-shark/windward'));
  check('...and carries the letter too, since that is where in the sequence it is',
    waypointRow({ letter: '1', lines: ['x'] }).includes('>1<'));
  check('...naming both sides of a gate, because until the choice is made both are the target',
    waypointRow({ letter: '2', lines: ['gate-left', 'gate-right'], gate: true })
      .includes('gate-left') && waypointRow({ letter: '2', lines: ['a', 'b'], gate: true })
      .includes('gate'));
  check('...and says so plainly when there is nothing left to steer for',
    waypointRow(null).includes('Nothing to steer'));

  /* --------------------------- the overview turns too, because the setting is the display */

  // Fixture: a boat below a west-east start line, with the next mark due north of it.
  check('North up never turns the course either', overviewUp(client, 'north') === 0);
  check('Leg up on the first leg points at the mark, since there is no leg behind it',
    Math.abs(overviewUp(client, 'leg') - (client.waypoint().bearingDeg)) < 1);
  check('...and both screens read the current leg from ONE definition',
    overviewUp(client, 'leg') === (client.legInto(client.live()) ?? client.waypoint().bearingDeg));
  check('Line perp stands the live line square across',
    Math.abs(overviewUp(client, 'perp')) < 1);

  const overviewSvg = (orientation) => overview(client, { orientation, turner: new Turner() });
  check('the course is drawn whichever way up', overviewSvg('leg').includes('<polygon'));
  check('...and a turned chart says where north is, or it relates to nothing',
    overviewSvg('north').indexOf('>N<') === -1);

  // Once past the start, Leg up is the LEG — mark to mark — and not the bearing to the mark:
  // a boat halfway up a beat points thirty degrees off the rhumb line, and a display that
  // followed the boat would swing back and forth on every tack.
  const onLeg = new RaceClient(snapshot);
  let u = 0;
  for (let n = -40; n <= 60; n += 10) {
    const p = at(0, n);
    onLeg.accept({ latitude: p.latitude, longitude: p.longitude, time: new Date((u += 2000)),
      accuracyM: 5, satellites: 12, sogKn: 9.7, cogDeg: 45 });
  }
  check('past the first mark, Leg up follows the LEG and not the boat',
    onLeg.at === 1 && Math.abs(overviewUp(onLeg, 'leg')) < 1);

  check('a north pointer appears only when north is not up',
    northPointer(0, 340) === '' && northPointer(90, 340).includes('>N<'));

  check('the orientation selector offers all three', ['Leg up', 'North up', 'Line perp']
    .every((label) => orientationBar('north').includes(label)));
  check('...marking the one in force', orientationBar('perp').includes('data-orient="perp" class="on"'));
  check('...COG up among them, beside Leg up, since the two are the course-referenced pair',
    Object.keys(ORIENTATIONS).slice(0, 2).join() === 'leg,cog');

  /* -------------------------------------------------- what to look at, and who decides */

  check('the view selector offers the course, the line and AUTO',
    ['Course', 'Line', 'Auto'].every((label) => viewBar('auto').includes(label)));
  check('...marking the one in force', viewBar('mark').includes('data-view="mark" class="on"'));
  check('...and AUTO is what it opens on, because the sailor never has to ASK for the Mark '
    + 'screen — only to be able to', viewBar('auto').includes('data-view="auto" class="on"'));

  /* ----------------------------------------------------------- the clock on screen */

  const unstarted = overviewPanel(client, { now: t });
  check('before the start the overview shows no elapsed time, not a zero',
    unstarted.includes('>Elapsed<') && !/Elapsed<\/div><div class="value">\d/.test(unstarted));
  check('...and does not claim a start time it has not got', !unstarted.includes('>Started<'));

  const startedClient = new RaceClient(snapshot);
  let ticking = 0;
  for (let n = -120; n <= 120; n += 10) {
    const p = at(0, n);
    startedClient.accept({ latitude: p.latitude, longitude: p.longitude,
      time: new Date((ticking += 2000)), accuracyM: 5, satellites: 12, sogKn: 9.7, cogDeg: 0 });
  }
  const started = overviewPanel(startedClient, { now: startedClient.startAt.getTime() + 95000 });
  check('once the start is crossed it says WHEN', started.includes('>Started<')
    && new RegExp(`>${hhmmss(startedClient.startAt)}<`).test(started));
  check('...and how long ago', started.includes('>1:35<'));
  check('...and does not yet claim a finish', !started.includes('>Finished<'));

  // On round the mark at 300 and through the finish at 600.
  for (let n = 130; n <= 720; n += 10) {
    const p = at(0, n);
    startedClient.accept({ latitude: p.latitude, longitude: p.longitude,
      time: new Date((ticking += 2000)), accuracyM: 5, satellites: 12, sogKn: 9.7, cogDeg: 0 });
  }
  const done = overviewPanel(startedClient, { now: ticking + 600000 });
  check('once the finish is crossed it says both instants',
    startedClient.complete() && done.includes('>Started<') && done.includes('>Finished<'));
  // Asked of the elapsed CELL, not of the whole panel: once a course is finished there is
  // nothing left to steer for, so BTW and DTW are dashes and a panel-wide check for one would
  // pass whatever the clock said.
  const frozen = /Elapsed[^<]*<\/div><div class="value">([^<]+)</.exec(done);
  check('...and the elapsed has stopped moving, because it is a result now',
    frozen && frozen[1] === clock(startedClient.elapsed(ticking + 600000))
    && frozen[1] === clock(startedClient.finishAt - startedClient.startAt));
  // MARKED AS FINAL BY THE COLOUR, NOT BY THE LABEL. It used to say "Elapsed — final", written
  // with an `&mdash;` and then put through `esc` like every other label — which escaped the
  // ampersand and printed the entity, so the screen read "ELAPSED &MDASH; FINAL". `.readout.done`
  // turns the row green, which says result in the place somebody is already looking.
  check('...and is marked as final, by the row that carries the colour',
    done.includes('class="readout done"'));
  check('...with the label still just the word, and no entity printed at it',
    done.includes('>Elapsed<') && !done.includes('&amp;') && !done.toLowerCase().includes('mdash'));

  const primary = overviewPanel(client, { now: t });
  check('the primary screen ALWAYS shows BTW, DTW and the line',
    primary.includes('BTW') && primary.includes('DTW') && primary.includes('>a<'));
  check('...the bearing as three digits, so 7 degrees cannot be read as 70',
    /BTW<\/div><div class="value">\d{3}/.test(primary));
  check('...with the unit printed beside DTW, which is what makes switching it safe',
    /DTW<\/div><div class="value">[^<]*<span class="unit">(m|nm)</.test(primary));
  check('...the two of them on a line of their own, at the size the screen exists for',
    /<div class="steer[^"]*">[\s\S]*BTW[\s\S]*DTW[\s\S]*<\/div>\s*<div class="readout/.test(primary));
  check('...with SOG gone, which said nothing about where the boat was going',
    !primary.includes('>SOG<'));
  check('...and still the course, the boat and the clock',
    primary.includes('<svg class="plot"') && primary.includes('Elapsed'));
  check('...and the orientation selector, so it can be changed from the screen a boat '
    + 'spends most of its time on', primary.includes('data-orient="leg"'));

  /* ------------------------------------- a screen must not present a stale fix as current */

  // SOG and COG are instantaneous, so an old one is WRONG rather than merely old: a boat
  // whose fixes are being refused would otherwise show the speed and heading it had when
  // the trouble started, which reads as "everything is fine" at the moment it is not.
  const live = markScreen({ ...mark, stale: false, sinceGood: 0, ttl: { seconds: 24, crossing: true } }, {});
  const old = markScreen({ ...mark, stale: true, sinceGood: 0, ttl: { seconds: 24, crossing: true } }, {});
  check('a current fix gives a time to the line', /class="value">24</.test(live));
  check('...and a stale one dashes it rather than lying, since a time is computed from a '
    + 'speed and a course and both of those are instantaneous', /class="value">—</.test(old));
  check('...while the plot stays, because last-known position still says something',
    old.includes('<svg class="plot"'));
  check('...and the screen says so out loud', old.includes('No fix'));
  check('a screen being fed nothing usable says how many went in the bin',
    markScreen({ ...mark, stale: true, sinceGood: 7 }, {}).includes('7 rejected'));

  const rejecting = { stale: () => true, sinceFix: () => 9000, sinceGood: 4,
    rejects: [{ reason: 'implied ground speed 393 kn' }] };
  check('the overview names WHY the last fix was refused, not just that it was',
    signalLine(rejecting, 0).includes('393 kn') && signalLine(rejecting, 0).includes('4 rejected'));
  check('...and says nothing at all while the receiver is behaving',
    signalLine({ stale: () => false, sinceFix: () => 200, sinceGood: 0, rejects: [] }, 0) === '');

  /* ------------------------- everything that must be seen is actually inside the plot */

  // Swept over a whole approach rather than asserted at one distance: the fit is solved by
  // iteration, the decoration is a fixed PIXEL size hanging off a metre point, and the case
  // that breaks is always some particular geometry at some particular range. So: every five
  // metres from four hundred out, in four orientations, with the boat crabbing.
  const W = 400;
  const Hgt = 330;
  // NOT MERELY INSIDE — WELL INSIDE. Something a few pixels off the border reads as on its
  // way out of the picture, and on a phone in a bracket the outermost pixels are the ones a
  // thumb and a rounded corner take first. So the sweep asserts a real buffer rather than
  // mere containment. Measured over these four approaches the closest anything came to the
  // border went from 25 px to 45 px when `FIT_FRACTION` and `HOLD.edgeFraction` were widened
  // together; 11% of the axis is just inside that, so the spec has headroom without being
  // satisfied by a near miss.
  const BUFFER = 0.11;
  const inView = (x, y) => x >= W * BUFFER && x <= W * (1 - BUFFER)
    && y >= Hgt * BUFFER && y <= Hgt * (1 - BUFFER);

  function sweep(cogDeg, orientation) {
    const flown = new RaceClient(snapshot);
    let when = 0;
    const missing = { triangle: 0, arrow: 0, dots: 0, boat: 0, frames: 0 };
    for (let n = -400; n <= -5; n += 5) {
      const p = at(0, n);
      flown.accept({ latitude: p.latitude, longitude: p.longitude, time: new Date((when += 1000)),
        accuracyM: 3, satellites: 12, sogKn: 9, cogDeg });
      const shown = flown.markState(when);
      if (!shown || flown.finished) continue;
      missing.frames += 1;
      const svg = plot(shown, { orientation, view: new PlotView(), width: W, height: Hgt });
      const polys = [...svg.matchAll(/<polygon points="([^"]+)"/g)]
        .map((x) => x[1].split(' ').map((q) => q.split(',').map(Number)));
      if (polys[0] && !polys[0].every(([x, y]) => inView(x, y))) missing.triangle += 1;
      if (polys[1] && !polys[1].every(([x, y]) => inView(x, y))) missing.arrow += 1;
      const dots = [...svg.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="3\.5"/g)]
        .map((x) => [Number(x[1]), Number(x[2])]);
      if (!dots.slice(-3).every(([x, y]) => inView(x, y))) missing.dots += 1;
      const boat = /translate\(([-\d.]+),([-\d.]+)\) rotate\([-\d.]+\) scale\([\d.]+\)">/.exec(svg);
      if (boat && !inView(Number(boat[1]), Number(boat[2]))) missing.boat += 1;
    }
    return missing;
  }

  for (const [label, cogDeg, orientation] of [
    ['sailing straight at it', 0, 'north'],
    ['crabbing forty degrees off', 40, 'north'],
    ['leg up', 20, 'leg'],
    ['line perp', 20, 'perp'],
  ]) {
    const swept = sweep(cogDeg, orientation);
    check(`over a whole approach, ${label}: the crossing triangle stays well clear of the border`,
      swept.frames > 50 && swept.triangle === 0);
    check(`...the next-leg arrow too, though where it hangs depends on a triangle whose size `
      + `depends on the very scale being solved for`, swept.arrow === 0);
    check(`...the last three fixes behind the boat`, swept.dots === 0);
    check(`...and the boat`, swept.boat === 0);
  }

  /* ----------------------------- the overview: a background, zoom and pan */

  const courseOf = (client, extra = {}) =>
    overview(client, { orientation: 'north', width: 400, height: 330, ...extra });
  const overClient = (() => {
    const flown = new RaceClient(snapshot);
    let when = 0;
    for (let n = -300; n <= -100; n += 20) {
      const p = at(0, n);
      flown.accept({ latitude: p.latitude, longitude: p.longitude, time: new Date((when += 1000)),
        accuracyM: 3, satellites: 12, sogKn: 9, cogDeg: 0 });
    }
    return flown;
  })();
  const imagesIn = (svg) => (svg.match(/<image/g) || []).length;

  // THE LINE THE BOAT IS HEADING FOR is drawn in the same colour as the triangle on it, and
  // thicker. It was the same blue as every other line, so the one thing worth finding on the
  // picture was marked on a shape a few pixels across and not on the stroke it sits on.
  const overSvg = courseOf(overClient);
  const strokes = [...overSvg.matchAll(/<line [^>]*stroke="([^"]+)" stroke-width="([\d.]+)"/g)]
    .map((m) => ({ colour: m[1], width: Number(m[2]) }));
  const liveLine = strokes.find((l) => l.colour === ROLE_COLOUR.start);
  check('the overview marks the LINE the boat is heading for, not only the triangle on it',
    !!liveLine);
  check('...in the live triangle\'s own colour, so the two say the same thing',
    overSvg.includes(`fill="${ROLE_COLOUR.start}"`) && liveLine.colour === ROLE_COLOUR.start);
  check('...and heavier than the lines that are not being sailed at',
    strokes.some((l) => l.colour === 'var(--line)' && l.width < liveLine.width));

  // THE COG, run out as far as the picture goes: on this screen the question is what the boat
  // is pointing at, and that is only legible if the line reaches it.
  const cogLine = /<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)" stroke="var\(--cog\)"/
    .exec(overSvg);
  check('the overview runs the COG out across the whole picture', !!cogLine);
  check('...from the boat, forward only — a line through it would show a back bearing '
    + 'nobody asked for', !!cogLine && (() => {
    const [, x1, y1, x2, y2] = cogLine.map(Number);
    const boat = /translate\(([-\d.]+),([-\d.]+)\) rotate\([-\d.]+\) scale/.exec(overSvg)
      .slice(1, 3).map(Number);
    return Math.hypot(x1 - boat[0], y1 - boat[1]) < 0.2
      && Math.hypot(x2 - x1, y2 - y1) > Math.hypot(400, 330) * 0.99;
  })());
  check('...and none of it is drawn before there is a fix to draw it from',
    !/stroke="var\(--cog\)"/.test(courseOf(new RaceClient(snapshot))));

  check('the overview draws no background by default, and asks nothing of the network for it',
    imagesIn(courseOf(overClient)) === 0 && imagesIn(courseOf(overClient, { basemap: 'none' })) === 0);
  check('...and draws one when asked for it', imagesIn(courseOf(overClient, { basemap: 'chart' })) > 0);
  check('...the sea chart being the same base with the seamarks stacked on it, so it is more',
    imagesIn(courseOf(overClient, { basemap: 'sea' }))
      > imagesIn(courseOf(overClient, { basemap: 'chart' })));
  check('...turned with the world rather than left north-up under a turned course',
    /rotate\(-?\d/.test(courseOf(overClient, { basemap: 'chart', orientation: 'leg' })));

  // THE POINT OF THE WHOLE THING: tiles are <image> elements, so the browser fetches them on
  // its own and NOTHING on the path from a fix to a drawn course touches the network. Asserted
  // with `fetch` replaced by something that throws, which is how `drive-client` sails the
  // course — a background that could block would be the one thing that must never be on this
  // screen.
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('the network is not available'); };
  let offline = null;
  try {
    offline = courseOf(overClient, { basemap: 'sea' });
  } catch (e) {
    offline = null;
  } finally {
    globalThis.fetch = realFetch;
  }
  check('A BACKGROUND NEVER BLOCKS: the course draws with the network gone, tiles and all',
    !!offline && imagesIn(offline) > 0 && offline.includes('<svg class="plot"'));

  // Zoom and pan. Untouched, the overview is the fit it always was; touched, it is anchored to
  // the fit at the moment it was taken hold of, so it does not wander while it is being dragged.
  const boatOn = (svg) => /translate\(([-\d.]+),([-\d.]+)\) rotate\([-\d.]+\) scale/.exec(svg)
    .slice(1, 3).map(Number);
  const hand = new OverviewView();
  const fitted = boatOn(courseOf(overClient, { view: hand }));
  check('an untouched overview is the fit, and says so', !hand.manual);
  hand.zoomBy(OVERVIEW_ZOOM.step);
  const zoomed = boatOn(courseOf(overClient, { view: hand }));
  check('zooming in moves everything away from the middle of the picture',
    hand.manual && Math.hypot(zoomed[0] - 200, zoomed[1] - 165)
      > Math.hypot(fitted[0] - 200, fitted[1] - 165) * 1.4);
  hand.zoomBy(1 / OVERVIEW_ZOOM.step);
  check('...and zooming back out returns exactly where it was',
    boatOn(courseOf(overClient, { view: hand })).every((v, i) => Math.abs(v - fitted[i]) < 0.05));
  hand.panByPx(40, -25);
  const panned = boatOn(courseOf(overClient, { view: hand }));
  check('...a pan moves the picture by the pixels the finger moved, and no more',
    Math.abs(panned[0] - fitted[0] - 40) < 0.05 && Math.abs(panned[1] - fitted[1] + 25) < 0.05);
  hand.reset();
  check('...and Fit gives the screen its own answer back',
    !hand.manual && boatOn(courseOf(overClient, { view: hand })).every((v, i) => Math.abs(v - fitted[i]) < 0.05));

  const wayOut = new OverviewView();
  for (let i = 0; i < 20; i += 1) wayOut.zoomBy(OVERVIEW_ZOOM.step);
  const wayIn = new OverviewView();
  for (let i = 0; i < 20; i += 1) wayIn.zoomBy(1 / OVERVIEW_ZOOM.step);
  check('the zoom is bounded at both ends — the fit is the picture this screen is for, and '
    + 'these are for looking into it and back out a little',
    wayOut.zoom === OVERVIEW_ZOOM.max && wayIn.zoom === OVERVIEW_ZOOM.min);

  // The bar under the chart, which is where the controls for it live.
  check('the chart bar offers zoom, fit and a background, under the chart they act on',
    ['data-zoom="out"', 'data-zoom="in"', 'data-zoom="fit"', 'id="o_basemap"']
      .every((bit) => chartBar({ basemap: 'none' }).includes(bit)));
  check('...every background the selector knows, so the labels live in one place',
    Object.values(BASEMAPS).every((spec) => chartBar({}).includes(spec.label)));
  check('...with Fit dead while there is nothing to reset', chartBar({}).includes('disabled'));
  check('...and lit, and live, once the picture is the sailor\'s',
    chartBar({ view: wayOut }).includes('class="on"')
    && !chartBar({ view: wayOut }).includes('disabled'));

  /* ------------------------- the line's own midpoint never leaves the view */

  // THE MIDPOINT IS WHAT BOUNDS THE ZOOM. The seat is the nearest point of the line to the
  // boat, so boat and seat converge as a boat closes and a fit built on those two alone zooms
  // in without limit — on a patch of water that no longer holds the mark. Invisible sailing
  // straight at the middle, where the seat IS the midpoint; plain the moment a boat comes in
  // off-centre. Measured on a 300 m line approached at the pin end, the midpoint left the plot
  // a hundred metres out and was 419 px off a 400 px picture by twenty.
  const approach = (eastM, orientation = 'north') => {
    const flown = new RaceClient(snapshot);
    let when = 0;
    const view = new PlotView();          // held across the approach, as the real client does
    const seen = [];
    for (let n = -400; n <= -10; n += 5) {
      const p = at(eastM, n);
      flown.accept({ latitude: p.latitude, longitude: p.longitude, time: new Date((when += 1000)),
        accuracyM: 3, satellites: 12, sogKn: 9, cogDeg: 0 });
      const shown = flown.markState(when);
      if (!shown || flown.finished) continue;
      plot(shown, { orientation, view, width: W, height: Hgt });
      const line = shown.watched.prepared;
      const px = projector(view.centre, view.up, view.scale, W, Hgt)({
        x: (line.port.x + line.starboard.x) / 2,
        y: (line.port.y + line.starboard.y) / 2,
      });
      seen.push({ n, px, across: Hgt / view.scale });
    }
    return seen;
  };

  // The line runs 150 m either side of the fixture's origin, so east 140 is all but on the pin.
  for (const [label, eastM] of [['straight at the middle', 0], ['in at the pin end', 140]]) {
    for (const orientation of ['north', 'leg', 'perp']) {
      const frames = approach(eastM, orientation);
      check(`coming ${label}, ${orientation}: the LINE'S MIDPOINT is in the picture at every `
        + `range — it is the mark the leg is measured to, and the zoom must not lose it`,
        frames.length > 70 && frames.every(({ px }) => inView(px.x, px.y)));
    }
  }

  // And the close-in behaviour is untouched where it was already right: straight at the middle
  // the seat and the midpoint are the same point, so the plot goes on closing in exactly as
  // before. It is only the off-centre approach that is held back, and only as far as the mark.
  const middle = approach(0);
  const pin = approach(140);
  check('...and the view still closes in on a centred approach, which is what an approach '
    + 'screen is for', middle[middle.length - 1].across < middle[0].across / 4);
  // WITH AN END HELD IN VIEW AS WELL, the two approaches now frame IDENTICALLY: whichever part
  // of the line a boat comes in at, the picture holds the same three things — the mark, the
  // nearer end and the boat — so the frame no longer depends on where along the line you are.
  // Before the end was in the fit, the centred approach closed to 75 m of water and the pin-end
  // one stopped at 165 m; they are both 177 m now on this 300 m line.
  check('...and comes in at the same scale wherever along the line the boat is, since the '
    + 'picture holds the same things either way',
    Math.abs(pin[pin.length - 1].across - middle[middle.length - 1].across) < 2);

  /* ------------------ the COG cut is capped for the view and drawn where it really is */

  // A boat sailing nearly parallel to a line cuts it a very long way away, and at exactly
  // parallel never at all. The cut is one of the things the frame is fitted around, so
  // honouring its position at that angle zoomed the plot out until the boat was a dot: at 88°
  // off the line the visible water was three kilometres across.
  const shallow = (cogDeg) => {
    const flown = new RaceClient(snapshot);
    let when = 0;
    for (let i = 0; i <= 20; i += 1) {
      const p = at(-100 + i * 8, -120 + i * 0.7);
      flown.accept({ latitude: p.latitude, longitude: p.longitude, time: new Date((when += 1000)),
        accuracyM: 3, satellites: 12, sogKn: 9, cogDeg });
    }
    const shown = flown.markState(when);
    const view = new PlotView();
    const svg = plot(shown, { orientation: 'north', view, width: 400, height: 330 });
    return { shown, view, svg, acrossM: 330 / view.scale };
  };

  const headOn = shallow(0);
  const parallel = shallow(88);
  check('a boat sailing nearly parallel to a line cuts it thousands of metres away',
    parallel.shown.projection.distanceM > 3000);
  // The line is 300 m between its defined points, so the cap is 600 m and the view has to
  // hold that plus the boat, the seat and the decoration — comfortably under a kilometre, and
  // nothing like the three it was.
  check('...and the view is capped rather than zooming out to hold it',
    parallel.acrossM < 1000 && headOn.acrossM < parallel.acrossM);
  check('...the cap being twice the line\'s own length, which is the scale a line is '
    + 'approached on', parallel.acrossM > COG_FIT_CAP * 300 * 0.5);
  // Capping what is DRAWN would move the warning, which is the one thing on this screen that
  // must not be moved: the figure reads the real distance and the ring falls where it falls.
  check('...while the figure on the dashes still reads the true distance',
    parallel.svg.includes(`>${parallel.shown.projection.distanceM} m<`));
  check('...and it is brought inside the plot, since a warning nobody can see is not one',
    (() => {
      const m = /<text x="([-\d.]+)" y="([-\d.]+)"[^>]*fill="var\(--cog\)"/.exec(parallel.svg);
      return m && Number(m[1]) > 0 && Number(m[1]) < 400 && Number(m[2]) > 0 && Number(m[2]) < 330;
    })());

  /* --------------------------------- the line says which way through, and where next */

  // The triangle is the editor's own notation: base on the line, apex the way you must cross.
  // A plain stroke says where to go and not which way through, and the required sense is the
  // one thing about a virtual mark that cannot be guessed from looking at it.
  const drawn = plot(mark, { orientation: 'north', view: new PlotView() });
  const apexOf = (svg) => {
    const m = /<polygon points="([^"]+)" fill="var\(--line\)"/.exec(svg);
    if (!m) return null;
    const pts = m[1].split(' ').map((p) => p.split(',').map(Number));
    return { base: pts.slice(0, 2), apex: { x: pts[2][0], y: pts[2][1] } };
  };
  const shape = apexOf(drawn);
  check('the line carries a triangle saying which way it must be crossed', !!shape);
  // The fixture crosses a west-east line FORWARD, which is northward, which is up the screen
  // at North up — so the apex must sit above the base. The check to re-run if ever in doubt.
  check('...pointing the way the crossing goes, which here is up the screen',
    shape.apex.y < (shape.base[0][1] + shape.base[1][1]) / 2);

  // And just beyond the apex, where the triangle is pointing, the next leg.
  // Matched on the round cap, which the arrow's shaft has and the dashed perpendicular —
  // also grey — does not. A looser pattern found the perpendicular and quietly passed.
  const arrow = (svg) =>
    /stroke="var\(--(muted|ok)\)" stroke-width="([\d.]+)" stroke-linecap="round"/.exec(svg);
  const ahead = arrow(drawn);
  check('a grey arrow sits in front of the triangle, saying where the next leg goes',
    !!ahead && ahead[1] === 'muted');

  // On a latch the scale deliberately does not move, so growth and colour are the whole of
  // what says something happened.
  const after = plot({ ...mark, state: 'crossed' }, { orientation: 'north', view: new PlotView() });
  const grown = arrow(after);
  check('once the crossing latches that arrow turns green', grown && grown[1] === 'ok');
  check('...and grows by a fifth', Number(grown[2]) > Number(ahead[2]) * 1.15);

  // The same frame, before and after: nothing about a latch may move the picture.
  const steady = new PlotView();
  plot(mark, { orientation: 'north', view: steady });
  const wasScale = steady.scale;
  plot({ ...mark, state: 'crossed' }, { orientation: 'north', view: steady });
  check('...while the scale stays exactly where it was', steady.scale === wasScale);

  // The F marks the one place on a course with nothing beyond it. Crossing the second-last
  // line still has a leg after it, so that gets an arrow like any other — which is the whole
  // of the distinction, and was got wrong by keying the F off "the next mark is the finish".
  const atEnd = plot({ ...mark, legBearing: null }, { orientation: 'north', view: new PlotView() });
  check('with no next leg at all, an F stands where the arrow would be', atEnd.includes('>F<'));
  check('...and no arrow is drawn beside it', !arrow(atEnd));
  check('a leg that merely runs TO the finish still gets its bearing pointed at',
    !plot({ ...mark, legBearing: 275 }, { orientation: 'north', view: new PlotView() }).includes('>F<'));

  // The arrow is drawn about its own centre, in line with the triangle's tip — so it clears
  // the triangle whichever way the next leg runs. Measured against the TRIANGLE ITSELF rather
  // than against its apex point, and every part of the arrow rather than its corners: the
  // overlap that got through was the arrowhead's true point, which sits a head-length beyond
  // the place `arrowHead` is given, and the bearing that exposed it was a leg doubling
  // straight back down the last one.
  const triPoints = () => {
    const m = /<polygon points="([^"]+)" fill="var\(--line\)"/.exec(
      plot(mark, { orientation: 'north', view: new PlotView() }));
    return m[1].split(' ').map((q) => q.split(',').map(Number));
  };
  const tri = triPoints();
  const nearestOnTriangle = (x, y) => Math.min(...tri.map(([ax, ay], i) => {
    const [bx, by] = tri[(i + 1) % tri.length];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
  }));
  for (let bearing = 0; bearing < 360; bearing += 15) {
    const svg = plot({ ...mark, legBearing: bearing }, { orientation: 'north', view: new PlotView() });
    const head = [...svg.matchAll(/<polygon points="([^"]+)"/g)]
      .map((m) => m[1].split(' ').map((q) => q.split(',').map(Number)))[1];
    const shaft = /<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)" stroke="var\(--muted\)"/.exec(svg);
    const parts = [...head, [Number(shaft[1]), Number(shaft[2])], [Number(shaft[3]), Number(shaft[4])]];
    const clearance = Math.min(...parts.map(([x, y]) => nearestOnTriangle(x, y)));
    check(`the arrow clears the triangle with the next leg at ${String(bearing).padStart(3, '0')}\u00b0`,
      clearance > 1.5);
  }

  /* ------------------------------------------------ both sides of a gate, one in focus */

  const GATED = {
    revision: 'gate', club: 'c', series: 's', course: 'co', variant: 'main', name: 'Gated',
    closed: false,
    steps: [
      { letter: 'S', crossings: [{ line: 'start', cross: 'FORWARD',
        port: { ...at(-150, -300), infinite: false }, starboard: { ...at(150, -300), infinite: false } }] },
      { letter: '1', crossings: [
        { line: 'gate-left', cross: 'FORWARD',
          port: { ...at(-120, 0), infinite: false }, starboard: { ...at(-30, 0), infinite: false } },
        { line: 'gate-right', cross: 'FORWARD',
          port: { ...at(30, 0), infinite: false }, starboard: { ...at(120, 0), infinite: false } },
      ] },
      { letter: 'F', crossings: [{ line: 'fin', cross: 'FORWARD',
        port: { ...at(-150, 300), infinite: false }, starboard: { ...at(150, 300), infinite: false } }] },
    ],
    defaults: { confirmFixes: 3, accuracyBandM: null, qc: { minSatellites: 4, maxAccuracyM: 25, maxSpeedKn: 40 } },
  };

  /** Sail up the middle and then commit to one side of the gate. */
  const throughGate = (towardsEast) => {
    const boat = new RaceClient(GATED);
    let when = 0;
    const step = (e, n, cogDeg) => {
      const p = at(e, n);
      boat.accept({ latitude: p.latitude, longitude: p.longitude, time: new Date((when += 1000)),
        accuracyM: 3, satellites: 12, sogKn: 9, cogDeg });
    };
    for (let n = -400; n <= -290; n += 10) step(0, n, 0);      // through the start
    const side = towardsEast ? 1 : -1;
    for (let i = 0; i <= 20; i += 1) step(side * i * 3.5, -250 + i * 10, towardsEast ? 20 : 340);
    return boat;
  };

  const east = throughGate(true);
  const west = throughGate(false);
  check('a boat bearing away to one side of a gate is watching THAT side',
    east.at === 1 && east.watching().line === 'gate-right');
  check('...and one going the other way is watching the other',
    west.at === 1 && west.watching().line === 'gate-left');
  check('...which perpendicular distance could not have told apart, the two being parallel',
    Math.abs(Math.abs(east.nearestM()) - Math.abs(west.nearestM())) < 30);

  const gateState = east.markState(east.fix.time.getTime());
  check('the screen is handed the other side as well', gateState.alternatives.length === 1
    && gateState.alternatives[0].line === 'gate-left');
  const gateSvg = plot(gateState, { orientation: 'north', view: new PlotView(), width: 400, height: 330 });
  const triangles = [...gateSvg.matchAll(/<polygon points="[^"]+" (fill="var\(--line\)"|fill="none")/g)]
    .map((m) => m[1]);
  check('BOTH sides of the gate are drawn', triangles.length === 2);
  check('...the one being sailed at filled, the other outlined — the shape says the sense '
    + 'either way, the fill says which this screen is about',
    triangles[1] === 'fill="var(--line)"' && triangles[0] === 'fill="none"');
  // Compared on where the two TRIANGLES sit in the document, not on the first occurrence of
  // each fill: a finite end is a dot filled in the line's own colour, and the alternative's
  // dots are drawn before its triangle.
  const triAt = [...gateSvg.matchAll(/<polygon points="[^"]+" (fill="var\(--line\)"|fill="none")/g)]
    .map((m) => ({ fill: m[1], at: m.index }));
  check('...and the other side is drawn first, so the focused one is over it wherever they meet',
    triAt.find((t) => t.fill === 'fill="none"').at
    < triAt.find((t) => t.fill === 'fill="var(--line)"').at);

  // Not in the fit: the other side is shown where it falls, never at the cost of zooming out
  // from the side the boat is actually sailing at.
  const framed = new PlotView();
  plot(gateState, { orientation: 'north', view: framed, width: 400, height: 330 });
  const withGate = framed.scale;
  const alone = new PlotView();
  plot({ ...gateState, alternatives: [] }, { orientation: 'north', view: alone, width: 400, height: 330 });
  check('...and never widens the view to fit it in', Math.abs(withGate - alone.scale) < 1e-9);

  // BOTH SIDES GET A PERPENDICULAR AND BOTH GET AN ARROW. They are the two things the choice
  // is made on, and the numbers differ between the sides — which is exactly why one of each
  // was not enough.
  const perps = [...gateSvg.matchAll(/font-size="([\d.]+)" fill="var\(--line\)"/g)]
    .map((m) => Number(m[1])).sort((a, b) => b - a);
  check('both sides of a gate show their perpendicular distance', perps.length === 2);
  check('...the watched one at the plot\'s own label size and the other at half it, so the '
    + 'comparison is offered rather than asserted',
    near(perps[0], LINE_LABEL_PX, 1e-9) && near(perps[1], LINE_LABEL_PX * OTHER_SIDE.label, 1e-9));
  check('...and the figure is the LINE\'s colour, not another grey beside the COG\'s',
    perps.length === 2 && !gateSvg.includes(`font-size="${LINE_LABEL_PX}" fill="var(--muted)"`));
  const arrows = [...gateSvg.matchAll(/<polygon points="[^"]+" fill="var\(--muted\)"/g)];
  check('both sides of a gate get a next-leg arrow', arrows.length === 2);

  // The other side is not in the fit, so its foot is routinely outside the picture. The
  // figure comes to the viewport rather than the viewport going to the figure, because
  // widening the fit for it is the one thing that must not happen.
  const figures = [...gateSvg.matchAll(
    /<text x="([-\d.]+)" y="([-\d.]+)"[^>]*font-size="([\d.]+)" fill="var\(--line\)"/g)]
    .map((m) => ({ x: Number(m[1]), y: Number(m[2]), size: Number(m[3]) }));
  check('...and the other side\'s figure is inside the plot even when the line it measures '
    + 'to is not', figures.length === 2
    && figures.every((f) => f.x > 0 && f.x < 400 && f.y > 0 && f.y < 330));

  // Both figures on this plot run from the boat to somewhere on the line, so a boat pointed
  // square at the line has them within a pixel of each other: the perpendicular foot and the
  // COG's cut are the same place. Offset to opposite sides of the dashes they separate.
  // A boat well off the line and crabbing across it shows BOTH figures: there is room for
  // them, and at that angle they are genuinely different quantities. Close in and square on
  // only the perpendicular is drawn, which the sweep below is about.
  const crabbing = (() => {
    const flown = new RaceClient(snapshot);
    let when = 0;
    for (let n = -400; n <= -150; n += 10) {
      const p = at(0, n);
      flown.accept({ latitude: p.latitude, longitude: p.longitude, time: new Date((when += 1000)),
        accuracyM: 3, satellites: 12, sogKn: 9, cogDeg: 30 });
    }
    return plot(flown.markState(when), { orientation: 'north', view: new PlotView(), width: 400, height: 330 });
  })();
  const both = [...crabbing.matchAll(
    /<text x="([-\d.]+)" y="([-\d.]+)"[^>]*font-size="36" fill="var\((--line|--cog)\)"/g)]
    .map((m) => ({ x: Number(m[1]), y: Number(m[2]), colour: m[3] }));
  check('the perpendicular and the COG figures are both drawn where there is room for them',
    both.length === 2);
  check('...in significantly different colours, since two greys a shade apart read as one '
    + 'number from a cockpit',
    both[0].colour !== both[1].colour);

  // AND THEY DO NOT LAND ON TOP OF EACH OTHER, at any heading that still cuts the line ahead.
  // Both run from the boat to somewhere on the line, so near square on they measure almost the
  // same segment — and opposite sides of it is not enough separation for two readings seventy
  // pixels wide: they overlapped into "61 0m m". The fix is different FRACTIONS along their own
  // dashes, a fifth and four fifths, which pulls them apart where the two segments diverge.
  //
  // Anchors, not boxes, because a text box needs a DOM. In a browser the closest the two boxes
  // come over this sweep is 16 px of clear space, against 27 px of overlap before; the anchors
  // are 68 px apart at the tightest, so a floor of 55 px guards the arrangement without being
  // a restatement of the numbers.
  const figuresIn = (svg) => {
    const found = {};
    for (const m of svg.matchAll(
      /<text x="([-\d.]+)" y="([-\d.]+)"[^>]*font-size="36"[^>]*fill="var\((--line|--cog)\)"[^>]*>([^<]*m)</g))
      // `onLine` puts the baseline a third of the size below the anchor; back it out, so the
      // box is computed from the same anchor the drawing used.
      found[m[3]] = { x: Number(m[1]), y: Number(m[2]) - LINE_LABEL_PX / 3, text: m[4] };
    return found;
  };
  let clashes = 0;
  let dropped = 0;
  let sweeps = 0;
  for (const range of [-200, -150, -100, -60, -30]) {
    for (let cogDeg = -60; cogDeg <= 60; cogDeg += 10) {
      const flown = new RaceClient(snapshot);
      let when = 0;
      for (let n = -400; n <= range; n += 10) {
        const p = at(0, n);
        flown.accept({ latitude: p.latitude, longitude: p.longitude, time: new Date((when += 1000)),
          accuracyM: 3, satellites: 12, sogKn: 9, cogDeg });
      }
      const shown = flown.markState(when);
      if (!shown || !shown.projection) continue;
      sweeps += 1;
      const pair = figuresIn(plot(shown, { orientation: 'north', view: new PlotView(), width: 400, height: 330 }));
      // The perpendicular is always there; the COG's figure gives way when it cannot fit.
      if (!pair['--line']) clashes += 1;
      if (!pair['--cog']) { dropped += 1; continue; }
      // Boxes, through the same routine the drawing uses, so the two cannot disagree about
      // what "on top of each other" means.
      if (boxesClash(labelBox(pair['--line'], pair['--line'].text, LINE_LABEL_PX),
        labelBox(pair['--cog'], pair['--cog'].text, LINE_LABEL_PX))) clashes += 1;
    }
  }
  check('...at any heading that still cuts the line ahead, and at any range', sweeps > 50);
  check('...with NO pair of figures ever drawn over one another — the perpendicular keeps its '
    + 'figure and the COG\'s gives way, which costs nothing where it happens because there the '
    + 'two numbers are the same measurement', clashes === 0);
  // The perpendicular's figure sits at the CENTRE of its own dashes, which is where a figure
  // measuring a segment belongs; the COG's takes what is left. That costs some give-ways — it
  // was 3 of 65 with the perpendicular pushed down near the boat — and buying them back by
  // moving either figure is worse in both directions: see the note in `plot`.
  check(`...and it gives way in the minority of frames: ${dropped} of ${sweeps}, all of them `
    + `close in or near square on`, dropped > 0 && dropped < sweeps / 4);

  // A segment from the boat always meets the box, because the fit is built round the boat.
  const clipped = clipToView({ x: 200, y: 165 }, { x: 900, y: 165 }, 400, 330, 18);
  check('clipping keeps the near end and brings the far one inside',
    clipped.from.x === 200 && clipped.to.x < 400 && clipped.to.x > 200);
  check('...and a segment that misses the box entirely is handed back unchanged rather than '
    + 'silently moved', clipToView({ x: -50, y: -50 }, { x: -20, y: -60 }, 400, 330, 18).to.x === -20);

  /* ------------------------------------- Line perp at a gate: the join, not one side's normal */

  // THE SHAPE THAT MAKES THE DIFFERENCE. A gate whose two lines are PARALLEL either side of a
  // centreline has its crossing normals pointing outward in opposite directions, so squaring
  // up to the side a boat happens to be watching turns the display ninety degrees off the
  // approach — and the other way round the moment it changes its mind. Both lines run north
  // and are infinite southward, so the gate is two marks to be rounded outward: cross the
  // western line going WEST or the eastern one going EAST. That is the real club shape; the
  // fixture above, with the two sides collinear, is the other one.
  const PARALLEL = {
    revision: 'pgate', club: 'c', series: 's', course: 'co', variant: 'main', name: 'Parallel gate',
    closed: false,
    steps: [
      { letter: 'S', crossings: [{ line: 'start', cross: 'FORWARD',
        port: { ...at(-150, -300), infinite: false }, starboard: { ...at(150, -300), infinite: false } }] },
      { letter: '1', crossings: [
        // Port end south and infinite, starboard end north: a forward crossing goes WEST.
        { line: 'gate-west', cross: 'FORWARD',
          port: { ...at(-75, -60), infinite: true }, starboard: { ...at(-75, 40), infinite: false } },
        // The mirror of it, so a forward crossing goes EAST.
        { line: 'gate-east', cross: 'FORWARD',
          port: { ...at(75, 40), infinite: false }, starboard: { ...at(75, -60), infinite: true } },
      ] },
      { letter: 'F', crossings: [{ line: 'fin', cross: 'FORWARD',
        port: { ...at(150, -300), infinite: false }, starboard: { ...at(-150, -300), infinite: false } }] },
    ],
    defaults: { confirmFixes: 3, accuracyBandM: null, qc: { minSatellites: 4, maxAccuracyM: 25, maxSpeedKn: 40 } },
  };

  /**
   * Up the middle of the parallel gate and then out towards one side of it.
   *
   * `reach` is how far out to the side, in metres: short of 75 the boat has committed to a
   * side without crossing it yet, which is the state Line perp has to be right about.
   */
  const throughParallel = (west, reach = 60) => {
    const boat = new RaceClient(PARALLEL);
    let when = 0;
    const step = (e, n, cogDeg) => {
      const p = at(e, n);
      boat.accept({ latitude: p.latitude, longitude: p.longitude, time: new Date((when += 1000)),
        accuracyM: 3, satellites: 12, sogKn: 9, cogDeg });
    };
    for (let n = -400; n <= -100; n += 10) step(0, n, 0);        // through the start, up the middle
    const side = west ? -1 : 1;
    for (let e = 0; e <= reach; e += 6) step(side * e, -60, west ? 270 : 90);
    return { boat, at: (when) => when };
  };

  const westward = throughParallel(true).boat;
  check('a boat bearing away through one side of a parallel gate is watching that side',
    westward.at === 1 && westward.watching().line === 'gate-west');
  const pstate = westward.markState(westward.fix.time.getTime());
  const ownNormal = bearingOf(...Object.values(
    crossingNormal(pstate.watched.prepared, pstate.watched.required)));
  check('...and its own crossing normal points WEST, out through the line', near(ownNormal, 270));
  check('...while Line perp squares up to the gate\'s AXIS — the perpendicular to the join '
    + 'between the two centres, which is the approach', near(upBearing(pstate, 'perp'), 0));
  check('...so the two disagree by a right angle on this shape, which is the whole reason '
    + 'for the rule', near(Math.abs(turnBetween(upBearing(pstate, 'perp'), ownNormal)), 90));
  check('...and the boat that took the other side is squared up the SAME way, where one '
    + 'side\'s own normal would have turned the display the other way about',
    near(upBearing(throughParallel(false).boat.markState(0), 'perp'), 0, 1));

  // The sign is taken from the leg INTO the gate and not from where the boat is, so it cannot
  // flip through half a turn as the boat draws level — which is the latch, and the one moment
  // the display is required to hold still.
  const latchedUp = (() => {
    const boat = new RaceClient(PARALLEL);
    let when = 0;
    const step = (e, n, cogDeg) => {
      const p = at(e, n);
      boat.accept({ latitude: p.latitude, longitude: p.longitude, time: new Date((when += 1000)),
        accuracyM: 3, satellites: 12, sogKn: 9, cogDeg });
    };
    for (let n = -400; n <= -100; n += 10) step(0, n, 0);
    const seen = [];
    for (let e = 0; e <= 150; e += 6) {
      step(-e, -60, 270);
      const drawn = boat.markState(when);
      // Only while the gate is still the live step: once the boat is on the leg to the
      // finish it is squaring up to a different line, which is not what this is about.
      if (drawn && drawn.step.letter === '1') seen.push(upBearing(drawn, 'perp'));
    }
    return seen;
  })();
  check('Line perp holds the same bearing all the way through the gate and past it, '
    + 'the crossing included',
    latchedUp.length > 20 && latchedUp.every((b) => near(b, latchedUp[0], 1e-9)));

  // On a gate whose sides are COLLINEAR the join runs along the lines, so its perpendicular
  // IS the crossing normal and the rule needs no special case for the other shape.
  check('on a collinear gate the axis and the crossing normal are the same bearing, so there '
    + 'is one rule rather than two',
    near(upBearing(gateState, 'perp'),
      bearingOf(...Object.values(crossingNormal(gateState.watched.prepared,
        gateState.watched.required)))));

  // The overview is turned by the same rule, because an orientation is a property of the
  // display and not of one screen.
  check('the overview squares up to the same axis, so the two screens are never turned '
    + 'different ways at a gate',
    near(overviewUp(westward, 'perp'), upBearing(pstate, 'perp'), 1e-9));
  check('...and an ordinary single-line step still squares up to its own crossing normal',
    near(overviewUp(east, 'perp'), upBearing(gateState, 'perp')));

  /* ------------------------------- the boat and the line are drawn at their real size */

  // A glyph of fixed pixel size says nothing about range: at four hundred metres and at four
  // it is the same picture. Drawn to scale, the two grow together as the view closes in.
  // ON A SHORT LINE, and deliberately: with one END of the line held in view the scale cannot
  // close in past half the line's length, so on the 300 m fixture everything else uses, the
  // boat grows by half again over an approach rather than by four times. That bound has its own
  // spec below, with the measured figures; this one is about the growth mechanism, so it uses a
  // line the bound does not reach — 92 m, which is what the club's gate sides actually are.
  const across = (id, northM, halfM) => ({
    line: id, cross: 'FORWARD',
    port: { ...at(-halfM, northM), infinite: false },
    starboard: { ...at(halfM, northM), infinite: false },
  });
  const SHORT = {
    ...snapshot,
    steps: [
      { letter: 'S', crossings: [across('a', 0, 46)] },
      { letter: '1', crossings: [across('b', 300, 46)] },
      { letter: 'F', crossings: [across('c', 600, 46)] },
    ],
  };
  const sized = (n) => {
    const flown = new RaceClient(SHORT);
    let when = 0;
    for (let y = -400; y <= n; y += 5) {
      const p = at(0, y);
      flown.accept({ latitude: p.latitude, longitude: p.longitude, time: new Date((when += 1000)),
        accuracyM: 3, satellites: 12, sogKn: 9, cogDeg: 0 });
    }
    const svg = plot(flown.markState(when), { orientation: 'north', view: new PlotView(), width: 400, height: 330 });
    return {
      boat: Number(/rotate\([-\d.]+\) scale\(([\d.]+)\)/.exec(svg)[1]) * 27,
      line: Number(/stroke="var\(--line\)" stroke-width="([\d.]+)"/.exec(svg)[1]),
    };
  };
  const far = sized(-300);
  const close = sized(-15);
  check('the boat grows as the line is closed, which is what shows the closing',
    close.boat > far.boat * 3);
  check('...and so does the line, drawn at the width it really is', close.line > far.line * 3);
  check('...both floored, or a ten-metre boat at four hundred metres would be ten pixels '
    + 'and vanish', far.boat >= REAL.boatPx.min - 0.1 && far.line >= REAL.linePx.min - 0.1);
  check('...and capped, since neither should ever swallow the plot',
    close.boat <= REAL.boatPx.max && close.line <= REAL.linePx.max);
  check('ten metres of boat is ten metres of boat once it is big enough to matter',
    Math.abs(close.boat - REAL.boatM * (close.line / REAL.lineM)) < 1);

  // THE RATIO HOLDS AT EVERY RANGE, INCLUDING WHERE THE CLAMPS BIND, and that is the check
  // worth having. It did not: the bounds were asserted independently, so the boat sat frozen
  // on its 13 px floor from about 130 m out while the line went on scaling down to 3 px — over
  // the part of an approach that takes longest the line visibly thickened and the boat did not
  // move at all, and their ratio drifted from 4.3:1 at four hundred metres to 2.4:1 at a
  // hundred and seventy-five. The line's bounds are derived from the boat's now, so one clamp
  // governs both and there is no second number to keep in agreement.
  const ratios = [-400, -250, -175, -150, -100, -60, -30, -15].map((n) => {
    const drawn = sized(n);
    return { n, line: drawn.line, ratio: drawn.boat / drawn.line,
      beam: (drawn.boat * BOAT.beam) / BOAT.length };
  });
  check('the boat and the line keep their true proportion at EVERY range, floors and caps '
    + 'included', ratios.every((r) => Math.abs(r.ratio - REAL.boatM / REAL.lineM) < 0.05));
  // THE COMPARISON A READER ACTUALLY MAKES is the hull's beam against the line's thickness,
  // and the figure moved when the arrow became a boat: the dart was 0.67 of its length across
  // and a hull is 0.42, so what was 2.2x is now 1.4x. Still wider than the line at every
  // range, which is the rule — and the length, which is what a hull shape makes legible, is
  // over three times it. Asserted a little under the 1.4 so there is slack, and asserted at
  // all because the two are clamped together and a change to either could invert them.
  check('...so the boat is wider than the line is thick at every range, its beam by half '
    + 'again and its length by over three times',
    ratios.every((r) => r.beam > r.line * 1.25 && r.ratio > 3));

  // The triangle is sized against the LINE, not the plot. `coursedraw` fixes its triangles in
  // pixels and is right to — on a chart they are a notation. Here the line beneath grows, and a
  // fixed triangle becomes a chip of colour on a band eight times its size: it stops reading as
  // a thing ON the line and starts reading as a blemish in it.
  // On the same SHORT line as `sized`, and for the same reason: the triangle is sized against
  // the line's width, the width against the scale, and the scale is what the end held in view
  // bounds. This is about the triangle tracking the line, not about that bound.
  const triHeight = (n) => {
    const flown = new RaceClient(SHORT);
    let when = 0;
    for (let y = -400; y <= n; y += 5) {
      const p = at(0, y);
      flown.accept({ latitude: p.latitude, longitude: p.longitude, time: new Date((when += 1000)),
        accuracyM: 3, satellites: 12, sogKn: 9, cogDeg: 0 });
    }
    const svg = plot(flown.markState(when), { orientation: 'north', view: new PlotView(), width: 400, height: 330 });
    const pts = /<polygon points="([^"]+)" fill="var\(--line\)"/.exec(svg)[1]
      .split(' ').map((q) => q.split(',').map(Number));
    const mid = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
    return Math.hypot(pts[2][0] - mid[0], pts[2][1] - mid[1]);
  };
  check('the crossing triangle grows with the line it sits on', triHeight(-15) > triHeight(-300) * 2);
  // Asserted as the invariant rather than as a constant ratio, because the triangle is bounded
  // at both ends and a ratio would just be re-stating where the bounds happen to sit. What has
  // to hold at every range is that it stands clearly proud of the line — which is the whole
  // reason for scaling it, and which the first cap tried broke close in.
  check('...standing clearly proud of the line at long range', triHeight(-300) > far.line * 1.5);
  check('...and still proud of it at fifteen metres, where the line is eleven times thicker',
    triHeight(-15) > close.line * 1.5);
  check('...bounded, so it neither disappears at range nor swallows a plot thirty metres across',
    triHeight(-300) > 8 && triHeight(-15) < 120);

  // A thick line must not be drawn longer than it can be crossed: a round cap would extend the
  // stroke half its width past the very point the extent test says the line stops.
  check('the line has square ends, so its drawn length is its real length',
    plot(mark, { orientation: 'north', view: new PlotView() }).includes('stroke-linecap="butt"'));

  const screen = markScreen(mark, { orientation: 'north' });
  check('the screen carries the state in the arrow rather than in a chip',
    screen.includes('NEXT LEG') && !screen.includes('state-chip'));
  check('...offers all three orientations', ['Leg up', 'North up', 'Line perp']
    .every((label) => screen.includes(label)));
  /* ------------------------------------------- the numbers moved onto the picture */

  // Perpendicular distance and distance along the COG are drawn ON the lines that measure
  // them, with no label: the figure sitting on the dashes IS the label, and a cell elsewhere
  // headed "Perp dist" makes a reader match a word to a picture instead.
  check('the perpendicular distance is written on the perpendicular, not in a cell',
    !screen.includes('Perp dist')
    && new RegExp(`>${Math.round(Math.abs(mark.perpDistM))} m<`).test(screen));
  check('...and the distance along the COG on the COG line',
    !screen.includes('Dist on COG')
    && new RegExp(`>${Math.round(mark.projection.distanceM)} m<`).test(screen));
  check('COG and SOG are gone: the boat is drawn pointing along one and the time is '
    + 'computed from the other', !screen.includes('>COG<') && !screen.includes('>SOG<'));

  check('a course that crosses the line gives a GREEN time',
    markScreen({ ...mark, ttl: { seconds: 30, crossing: true } }, {}).includes('class="ttl ok"'));
  check('...and one running out past the end a red one, which is the warning the hard edge '
    + 'obliges this screen to give',
    markScreen({ ...mark, ttl: { seconds: 30, crossing: false } }, {}).includes('class="ttl missing"'));
  check('a long time reads as minutes and seconds',
    markScreen({ ...mark, ttl: { seconds: 95, crossing: true } }, {}).includes('>1:35<'));
  check('...a short one as plain seconds with a unit',
    /class="value">42<\/span>\s*<span class="unit">s</.test(
      markScreen({ ...mark, ttl: { seconds: 42, crossing: true } }, {})));
  check('...and no answer as a dash',
    markScreen({ ...mark, ttl: { seconds: null, crossing: false } }, {}).includes('>—<'));
}
