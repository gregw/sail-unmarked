/**
 * The prototype client as a PAGE: join it, start the boat, and watch the screen change by
 * itself as the line comes up.
 *
 * `drive-client.mjs` sails a whole course and never touches a screen; `raceclient-test.js`
 * pins the switching rule and never touches a page. What is left between them is the
 * wiring, and the wiring is where this breaks in the way a user would actually meet it: a
 * handler attached to an element some later render replaced, a slider that reads empty, a
 * screen that renders once and then never again. None of that is visible from either side.
 *
 * The one behaviour this file exists to demonstrate is the one somebody asked for in a
 * sentence: <em>as the boat approaches a line, the screen changes to the crossing display
 * on its own, and when the line is passed the course comes back.</em> Nothing is clicked to
 * make either happen.
 */
import { $, H, choose, chosenIn, ok, optionsOf, paneHtml, report, settle, unfold } from './dom.mjs';
import { BOAT, OVERVIEW_INK } from '../../client/www/markscreen.js';
import { ROLE_COLOUR } from '../../client/www/coursedraw.js';

/* ------------------------------------------- something public and published to join */

const json = async (path, options) => {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error(`${path} → ${response.status}`);
  return response.json();
};
const post = (path, body) => json(path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
});

const [programme] = await json('/api/programmes');
const KEY = `${programme.club}/${programme.series}`;
const file = await json(`/api/programmes/${KEY}`);

/*
 * TWO courses are published here, on purpose, and the second one is what makes the join screen
 * ask a question at all. A level with one answer answers itself — so with a single course
 * published the whole drill settles and there is nothing left to drive. Publishing a second
 * gives the course level a genuine choice, which is the half of the rule this file proves; the
 * settling half is proved by the levels above it, which have one answer each.
 */
const published = [];
for (const [course, body] of Object.entries(file.courses)) {
  for (const variant of Object.keys(body.variants ?? { main: {} })) {
    try {
      const result = await post(`/api/lifecycle/${KEY}/snapshots`, { course, variant });
      if (result.snapshot?.steps?.length >= 2) published.push({ course, variant });
    } catch { /* incomplete, or a template — neither is this driver's business */ }
    if (published.length === 2) break;
  }
  if (published.length === 2) break;
}
const taken = published[0] ?? null;
if (published.length < 2) {
  ok('the fixture holds two courses that can be published', false);
  report();
}
await post(`/api/lifecycle/${KEY}/publications`, { publish: published.map(({ course, variant }) => ({ course, variant })) });
for (const { course } of published) file.courses[course].public = true;
await fetch(`/api/programmes/${KEY}`, {
  method: 'PUT', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ points: file.points, lines: file.lines, courses: file.courses }),
});

/* ------------------------------------------------------------------- the page */

// The page animates on requestAnimationFrame, which the stub has no reason to provide.
// Driven off real time rather than a synthetic clock, because the thing under test is the
// timing of the screens and a clock this file controlled would prove only that it could
// control a clock.
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);

const mod = await import('../../client/www/client.js');
await settle(1200);

const device = () => $('device').innerHTML || '';
// Identified by the form itself rather than by the button's words, which now say which level
// is still unanswered and so are not the same on the first render as on the last.
ok('the page comes up on the join screen', /<div class="join">/.test(device()));
ok('...and asking who the boat is before where it is going',
  device().includes('id="j_sail"') && device().includes('id="j_name"'));

/*
 * A LEVEL WITH ONE ANSWER ANSWERS ITSELF; A LEVEL WITH SEVERAL ASKS.
 *
 * The fixture has one club and one series, so those settle — a field that opened, showed one
 * line and closed again having changed nothing is a question nobody could answer differently.
 * Two courses are published, so THAT level stays a question, asked with an empty field: a
 * default there would read as a suggestion, and on a race morning a suggestion nobody made is
 * how a boat sails yesterday's course.
 */
// Read off the rendered form, which is where a settled level has to show: the value is in the
// device's own `boat` (drive-boat.mjs asserts that half directly), and this is the screen.
ok('the levels with one answer settle themselves',
  device().includes(`<option value="${programme.club}" selected>`)
  && device().includes(`<option value="${programme.series}" selected>`));
ok('...and the level with a real choice does not, so nothing is suggested that nobody picked',
  /<select id="j_course"><option value="" selected>Choose a course</.test(device()));
ok('...with the button naming what is still missing rather than sitting greyed out in silence',
  /id="j_go" disabled>Choose a course</.test(device()));

$('j_sail').value = 'AUS 1';
H('j_sail:input')({ target: { value: 'AUS 1' } });
$('j_name').value = 'Bombora';
H('j_name:input')({ target: { value: 'Bombora' } });

// THE DRILL, one level at a time, because that is now the only way through: each `change`
// re-renders and the next level's options appear only then.
const pick = (field, value) => { H(`j_${field}:change`)({ target: { value } }); };
// Both published courses are on offer and nothing else is: what a boat may join is exactly
// what the club made public AND published, because what it is handed is a snapshot.
ok('...offering only courses that are public AND published, since a client is handed a snapshot',
  published.every(({ course }) => device().includes(course))
  && !device().includes('no-such-course'));
pick('course', taken.course);
// The chosen course has ONE published design, so the variant settles the moment the course is
// answered — which is the same fact a race's division states by leaving its variant unsaid.
ok('...and answering it settles the single design under it, without a second question',
  device().includes(`<option value="${taken.variant}" selected>`)
  && /id="j_go">Join and sail</.test(device()));
ok('...and offering to sail once the whole path is chosen',
  /id="j_go">Join and sail</.test(device()));

// The mode is left at its default, which is practice — so what this file drives from here on is
// a boat practising, and the skip buttons below belong to it.
ok('...as practice, which is what the mode selector opens on',
  /<option value="ANONYMOUS" selected>/.test(device()));

// WHAT IS REMEMBERED IS THE BOAT, NOT THE COURSE. A sail number and a club are facts about
// whoever is holding the phone; the series, course and variant are the decision being made, and
// a remembered one would be a default nobody chose.
const held = JSON.parse(globalThis.sessionStorage.getItem('unmarked.join') ?? '{}');
ok('the sail number, the boat name and the club are kept for next time',
  held.sail === 'AUS 1' && held.name === 'Bombora' && held.club === programme.club);
ok('...and the series, course and variant are NOT, since they are today\'s decision',
  !('series' in held) && !('course' in held) && !('variant' in held));

H('j_go:click')();
await settle(1500);

ok('joining puts the course on the screen', device().includes('<svg class="plot"'));

/* ----------------------------------------------------- stepping through, in practice */

// PRACTISING IS SAILING ONE MARK, then the next one. The buttons NAME the mark they land on,
// because the reason for pressing one is to arrive at a particular mark.
const liveLetter = () => mod.__state.client.live()?.letter ?? null;
const first = liveLetter();
const onward = mod.__state.client.skipTarget(1)?.letter ?? null;
ok('a practice boat is offered the next mark without having to sail to it',
  onward != null && device().includes(`id="skip_on">${onward}`));
ok('...and nothing back from the first, which is where the sequence starts',
  mod.__state.client.skipTarget(-1) === null && !device().includes('id="skip_back"'));

H('skip_on:click')();
await settle(400);
ok('...pressing it puts that mark live', liveLetter() === onward && liveLetter() !== first);
ok('...and offers the way back, named for where it goes',
  device().includes(`id="skip_back">&lsaquo; ${first}`));
H('skip_back:click')();
await settle(400);
ok('...which returns to the mark it came from', liveLetter() === first);

// A RACE CANNOT BE STEPPED THROUGH. The client refuses it (`raceclient-test.js` pins that), and
// the screen agrees rather than being the only thing stopping it.
mod.__state.client.joinMode = 'RACE';
mod.__device.render();
ok('...and a boat sailing as RACE is offered no such thing',
  !device().includes('id="skip_on"') && !device().includes('id="skip_back"'));
mod.__state.client.joinMode = 'ANONYMOUS';
mod.__device.render();
ok('...always showing where the next mark is and how far', device().includes('BTW')
  && device().includes('DTW') && device().includes('Elapsed'));
ok('...and NAMING the line it is steering for, which is what an instruction talks about',
  new RegExp('class="name mono">[^<]+<').test(device()));
ok('...and no Mark screen yet, because nothing is close', !device().includes('class="ttl'));

/* ------------------------------------------------------ the sliders, then the boat */

// The stub has no real <input>, so each slider reads empty until it is told otherwise —
// which is the stub being a stub, not the page being wrong.
for (const [id, value] of [['speed', '20'], ['hz', '5'], ['noise', '2'], ['flyer', '0']]) {
  $(id).value = value;
  H(`${id}:input`)({ target: { value } });
}

ok('the run button says what it will do', $('run').textContent === 'Start');
H('run:click')();
ok('...and then says what will stop it', $('run').textContent === 'Pause');

/** Wait for the device to show something, or give up. */
async function until(what, test, seconds = 75) {
  for (let i = 0; i < seconds * 4; i++) {
    if (test()) return true;
    await settle(250);
  }
  return false;
}

const gotMark = await until('mark', () => device().includes('class="ttl'), 25);
ok('THE MARK SCREEN COMES UP ON ITS OWN as the line closes — nothing was clicked', gotMark);
ok('...leading with the time to the line, which is the number being steered to',
  /class="ttl (ok|missing)"/.test(device()) && device().includes('>TTL<'));
ok('...with the distances written on the lines of the plot that measure them, not in cells',
  !device().includes('Perp dist') && !device().includes('Dist on COG')
  && /<text[^>]*>\d+ m<\/text>/.test(device()));
ok('...the state in the arrow rather than in a chip', device().includes('NEXT LEG'));
ok('...the three orientations', device().includes('Line perp'));
ok('...and a plot of the line it is watching', device().includes('<svg class="plot"'));

// The frame is held so the boat is SEEN to move across it. A plot that re-fits every frame
// keeps the boat in the same pixels however fast it is sailing, which is the one thing the
// approach view has to be able to say.
const boatAt = () => {
  const m = /translate\(([-\d.]+),([-\d.]+)\) rotate/.exec(device());
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
};
const wasAt = boatAt();
await settle(3000);
const nowAt = boatAt();
ok('the boat MOVES on the approach plot rather than sitting in the middle of it',
  wasAt && nowAt && Math.hypot(nowAt.x - wasAt.x, nowAt.y - wasAt.y) > 5);

const logged = await until('fixes', () => (($('trail').innerHTML || '').match(/<div/g) || []).length > 3, 15);
ok('the fixes are logged as they arrive, decision and all', logged);

// Sampled on every poll rather than once: the frame is SUPPOSED to be rebuilt during the
// approach, as the boat closes and the useful scale changes. What must not move is the frame
// across the latch, so what matters is its state on the last look before the crossing.
let lastApproach = null;
let firstApproach = null;
let reframes = 0;
const realFrame = mod.__state.plotView.frame.bind(mod.__state.plotView);
mod.__state.plotView.frame = (wanted) => {
  const got = realFrame(wanted);
  if (got.reframed) reframes += 1;
  return got;
};
const crossed = await until('crossed', () => {
  if (device().includes('THIS LEG')) return true;
  if (mod.__state.plotView.scale) {
    firstApproach ??= mod.__state.plotView.scale;
    lastApproach = { scale: mod.__state.plotView.scale, subject: mod.__state.plotView.subject };
  }
  return false;
}, 60);
ok('the crossing latches and the arrow turns to THIS LEG', crossed);
ok('...naming the instant, which is the thing a protest turns on',
  /Crossed \d\d:\d\d:\d\d/.test(device()));

// A latch must not move the picture. The screen stays on the line just crossed for the
// length of the dwell, so the crossing can be looked at where it actually happened.
ok('...WITHOUT changing the scale — the picture holds still across the crossing',
  !!lastApproach && mod.__state.plotView.scale === lastApproach.scale
  && mod.__state.plotView.subject === lastApproach.subject);
ok('...still showing the line that was crossed, so it can be looked at where it happened',
  mod.__state.plotView.subject.startsWith('0:'));

// The approach closes in: at three hundred metres the plot shows a couple of hundred metres
// of water, and by the line it is showing tens. In steps, not continuously — a view that
// re-fitted on every fix would be a view that never held still.
// A factor of two, not three. Holding one END of the line in view bounds how far the plot can
// close in: on this fixture's 199 m leeward line the tightest view is about 118 m of water
// rather than 75 m, so the zoom over an approach that starts where the screen takes over is
// now a little over double rather than triple. That bound is the point of the end being in the
// fit and is measured in the unit specs; what this asserts is that the plot still closes in.
ok('the plot ZOOMS IN as the boat closes the line',
  lastApproach.scale > firstApproach * 2);
ok('...in steps rather than on every update', reframes > 3 && reframes < 40);
ok('...the next-leg arrow going green instead, which is what says something happened',
  /stroke="var\(--ok\)" stroke-width="[\d.]+" stroke-linecap="round"/.test(device()));

const back = await until('overview', () => device().includes('DTW'), 30);
ok('AND THEN THE COURSE COMES BACK, once the crossing has been read', back);
ok('the orientation selector is on the course screen too, not only the approach',
  device().includes('data-orient="leg"'));
ok('...steering for the NEXT line now, named and ranged',
  new RegExp('class="name mono">[^<]+<').test(device()) && /DTW<\/div><div class="value">[^<—]/.test(device()));

/* --------------------------- picked up and put down: a jump that is not a flyer */

// The reported gesture, and it went wrong in three separate ways at once: the kinematic
// gate took twenty seconds to forgive the jump, the boat stopped dead because placing it
// threw away the helm order, and all the while the screen showed the last good SOG as
// though it were current.
const st = mod.__state;
const before = st.client.waypoint().distanceM;
const rad = (st.client.waypoint().bearingDeg * Math.PI) / 180;
const { offsetBy, metresBetween } = await import('../../client/www/boatsim.js');
const ahead = offsetBy(st.sim.at, Math.sin(rad) * 150, Math.cos(rad) * 150);

// THE BOAT IS DRAGGED, not armed and clicked: the press starts ON the hull, the hand carries
// it, and letting go puts it down there. A press anywhere else is a helm order, which is what
// makes the two gestures impossible to confuse.
const [fromX, fromY] = st.view.toPx(st.sim.at);
const [px, py] = st.view.toPx(ahead);
H('rig:pointerdown')({ clientX: fromX, clientY: fromY, pointerId: 1 });
H('rig:pointermove')({ clientX: px, clientY: py, pointerId: 1 });
ok('pressing on the boat picks it up rather than panning the chart', !!st.moving);
H('rig:pointerup')({ clientX: px, clientY: py, pointerId: 1 });
ok('...and letting go puts it down there', !st.moving
  && Math.round(metresBetween(st.sim.at, ahead)) <= 2);
ok('dragging the boat keeps it sailing — the helm order survives being picked up',
  !!st.sim.target && !st.sim.arrived());

// The chart draws its own cursor, because a system crosshair is one hairline over tiles and
// this is a page whose whole interaction is "click exactly there".
H('rig:pointermove')({ clientX: 300, clientY: 200, pointerId: 1 });
await settle(400);
const chart = () => $('over').innerHTML || '';
ok('the chart draws a reticle where the pointer is, rather than trusting the system cursor',
  /<circle cx="300.0" cy="200.0" r="13"/.test(chart()));
ok('...saying what the click will do, in the colour of the gesture',
  chart().includes('var(--ok)') || chart().includes('var(--toside)'));
ok('...and how far away it is, which is the question behind every click on a steering rig',
  /\d{3}\u00b0/.test(chart()));
H('rig:pointerleave')({});
await settle(400);
ok('...and takes it away when the pointer leaves', !/r="13"/.test(chart()));

const recovered = await until('recovered', () => st.client.relocations > 0, 15);
ok('a jump that keeps agreeing with itself is believed within a few fixes',
  recovered && st.client.relocations === 1);
ok('...and the rig says so, rather than burying it among the accepted fixes',
  ($('trail').innerHTML || '').includes('RELOCATED'));
ok('...the client having moved to where the fixes actually are',
  st.client.waypoint().distanceM < before - 100);
ok('...without inventing a crossing out of the jump', st.client.crossings.length === 1);

// And it must be SAILING again, not sitting where it was dropped.
const d0 = st.client.waypoint().distanceM;
await settle(4000);
const d1 = st.client.waypoint().distanceM;
ok('the boat is making way again, at about the speed the slider says',
  d0 - d1 > 20 && st.sim.sogKn > 0);
ok('...and the screen reports a speed rather than a dash', !st.client.stale(Date.now()));

H('run:click')();
ok('the boat can be stopped again', $('run').textContent === 'Start');

/* ---------------------------------------------------- navigating on the device alone */

// HIDE COURSE takes away the operator's own knowledge of where the marks are, which is the
// only way to find out whether the device beside it is enough to sail by. What it must hide is
// exactly the geometry; what it must NOT hide is everything the operator steers with.
const lineIds = st.client.steps.flatMap((step) => step.crossings.map((c) => c.line));
const drawnCourse = () => lineIds.some((id) => (chart() || '').includes(`>${id}<`))
  || /stroke="var\(--line\)" stroke-width="2.5"/.test(chart() || '')
  || /stroke="var\(--ok\)" stroke-width="4"/.test(chart() || '');
H('run:click')();                          // sailing again, so the overlay keeps redrawing
await settle(600);
ok('the rig draws the course by default — it is the operator\'s chart', drawnCourse());

$('hidecourse').checked = true;
$('hidecourse').fire('change', { target: { checked: true } });
await settle(600);
ok('ticking Hide course takes the lines, their ends and their letters off the rig',
  st.hideCourse === true && !drawnCourse());
// The point of the exercise is that the boat is still sailable, so none of what the operator
// steers with may go with the course: the boat itself, its true track and the fixes the client
// accepted are all still there.
ok('...and leaves the boat on the chart, or there would be nothing to steer',
  chart().includes(BOAT.hull));
ok('...along with its true track and the fixes, which say nothing about where a mark is',
  chart().includes('var(--fromside)'));
// And the DEVICE still says where to go, which is the whole claim: BTW, DTW and the line's name.
const shown = $('device').innerHTML || '';
ok('...while the device still says which way, how far, and to which line',
  shown.includes('BTW') && shown.includes('DTW') && lineIds.some((id) => shown.includes(id)));

$('hidecourse').fire('change', { target: { checked: false } });
await settle(600);
ok('unticking it puts the course back', st.hideCourse === false && drawnCourse());

/* ------------------------------------- picking the screen, and COG up */

// AUTO is the design — the sailor never has to ask for the Mark screen — but never has to is
// not cannot, and the selector is on both screens because either may be the one you want to
// leave.
const on = (attr, key) => new RegExp(`data-${attr}="${key}" class="on"`).test(device());
// Found through the SAME selector the page's own handler uses, so the click lands on the very
// node the handler was wired to. (That selector is what caught the stub reading `[data-view]`
// as a character class and answering with divs.)
const press = (attr, key) => {
  const button = $('device').querySelectorAll(`[data-${attr}]`)
    .find((b) => b.dataset[attr] === key);
  if (!button) throw new Error(`no button with data-${attr}="${key}"`);
  return button.fire('click', {});
};
ok('the device opens on AUTO, the application deciding which screen', on('view', 'auto'));
const auto = st.client.view(Date.now());
H('run:click')();                            // held still, so the rule cannot change under us
press('view', auto === 'mark' ? 'overview' : 'mark');
ok('...and asking for the other screen gets it, at whatever range the boat is at',
  st.client.view(Date.now()) !== auto && on('view', auto === 'mark' ? 'overview' : 'mark'));
press('view', 'auto');
ok('...while handing AUTO back returns the rule\'s own answer',
  st.client.view(Date.now()) === auto && on('view', 'auto'));

// COG up is the fourth orientation and the one every plotter has: the boat's heading straight
// up, so what is ahead on the screen is what is ahead over the bow.
press('view', 'mark');
press('orient', 'cog');
ok('COG up is offered alongside the brief\'s three, and takes', on('orient', 'cog'));
ok('...and it is a different bearing from the leg the boat is sailing',
  Math.abs(mod.__state.client.legInto(mod.__state.client.live())
    - (mod.__state.client.fix.cogDeg ?? 0)) > 0.5);
press('orient', 'north');
press('view', 'auto');

/* -------------------------------------- the overview's own chart controls */

press('view', 'overview');
const overviewSvg = () => /<svg class="plot"[\s\S]*?<\/svg>/.exec(device())?.[0] ?? '';
const boatOn = () => /translate\(([-\d.]+),([-\d.]+)\) rotate\([-\d.]+\) scale/
  .exec(overviewSvg())?.slice(1, 3).map(Number) ?? [0, 0];
// THE LINE THE BOAT IS HEADING FOR, in the live triangle's own colour, and the COG run out
// across the whole picture.
ok('the overview marks the line being sailed at, not only the triangle on it',
  new RegExp(`<line [^>]*stroke="${ROLE_COLOUR.start.replace(/[()]/g, '\\$&')}" stroke-width="3.5"`)
    .test(overviewSvg()));
// Width and brightness off the constant rather than written here: the overview is drawn to be
// read in DAYLIGHT, and the numbers that decide that are one place, in `OVERVIEW_INK`.
ok('...and runs the COG out as far as the picture goes',
  new RegExp(`stroke="var\\(--cog\\)" stroke-width="${OVERVIEW_INK.cogWidth}"`)
    .test(overviewSvg()));

// THE TRACK SINCE THE LAST LINE, in the boat's own ink: where it has BEEN on this leg, which
// no part of the course drawing can say.
ok('...and draws the boat\'s own track back down the leg it is sailing',
  new RegExp(`<path d="M[^"]+" fill="none" stroke="var\\(--ink\\)" stroke-width="${OVERVIEW_INK.trailWidth}"`)
    .test(overviewSvg()) && mod.__state.client.legTrack.length > 1);

ok('the overview carries a bar of chart controls under the chart',
  /data-zoom="in"/.test(device()) && /id="o_basemap"/.test(device()));
ok('...with Fit dead while the picture is still the screen\'s own fit',
  /data-zoom="fit"[^>]*disabled/.test(device()));

const fitted = boatOn();
press('zoom', 'in');
ok('zooming in moves the course away from the middle of the picture',
  Math.hypot(boatOn()[0] - 200, boatOn()[1] - 165) > Math.hypot(fitted[0] - 200, fitted[1] - 165));
ok('...and Fit comes alive, since there is now something to go back from',
  !/data-zoom="fit"[^>]*disabled/.test(device()));
press('zoom', 'fit');
ok('...and Fit puts it back where the screen had it',
  boatOn().every((v, i) => Math.abs(v - fitted[i]) < 0.5));

// A BACKGROUND IS FETCHED BY THE BROWSER, NOT BY US. Selecting one emits <image> elements and
// asks nothing of `fetch`, which is what lets it exist on a screen that has to work offline.
ok('the overview draws no background until one is asked for',
  !overviewSvg().includes('<image'));
// The render is HELD while the selector has focus, or the panel — rebuilt on every fix —
// destroys the open popup and the browser closes it. At a fix a second that made the
// background unpickable: the list appeared and vanished before the pointer reached an option.
//
// SAILING for this, and that is the whole test: with the boat stopped nothing re-renders
// anyway, so a held panel and a running one look identical and both checks pass saying
// nothing. (They did, until this comment.)
H('run:click')();
await settle(1500);
const running = device();
await settle(1500);
ok('the panel is being rebuilt as fixes arrive, which is what makes the rest of this a test',
  device() !== running);

document.activeElement = $('o_basemap');
const beforeChoosing = device();
await settle(1500);
ok('the panel holds still while a background is being chosen, so the popup survives a fix',
  device() === beforeChoosing);
document.activeElement = null;
await settle(1500);
ok('...and starts again the moment focus goes elsewhere, with nothing to remember to release',
  device() !== beforeChoosing);
H('run:click')();
await settle(400);

H('o_basemap:change')({ target: { value: 'chart', blur: () => { document.activeElement = null; } } });
await settle(300);
ok('...and draws one when it is, without a single call of its own',
  overviewSvg().includes('<image'));
H('o_basemap:change')({ target: { value: 'none', blur: () => { document.activeElement = null; } } });
await settle(300);

// THE PAN, followed on the document rather than on the chart: this panel is rebuilt on every
// fix, so a `pointermove` wired to the element the drag started on would stop arriving halfway
// through the gesture and the chart would follow the finger and then stick.
const beforeDrag = boatOn();
$('device').querySelector('.plot').fire('pointerdown', { clientX: 100, clientY: 100 });
H('document:pointermove')({ clientX: 140, clientY: 75 });
ok('dragging the overview moves it by the distance the finger moved',
  Math.abs(boatOn()[0] - beforeDrag[0] - 40) < 0.5 && Math.abs(boatOn()[1] - beforeDrag[1] + 25) < 0.5);
H('document:pointerup')({});
// Letting go means the document is no longer being listened to at all — asserted as the
// handler being GONE rather than as a move that does nothing, because a handler still there
// and merely inert is a drag that resumes the next time anything moves.
ok('...and lets go of the document when the finger lifts, rather than listening for ever',
  H('document:pointermove') === undefined);
press('zoom', 'fit');

press('view', 'auto');
H('run:click')();

/* ------------------------------------------------ the phone moves around the desk */

// The case is the handle and the screen is not, because the screen's own chart pans on a drag
// and two gestures on one pointer means one of them sometimes does nothing. The targets below
// stand in for what a real node answers to `closest`, which is what the page asks.
const CASE = { closest: () => null };
const SCREEN = { closest: (sel) => (sel === '.device' ? $('device') : null) };
const phone = $('phone');

phone.fire('pointerdown', { clientX: 100, clientY: 20, target: SCREEN });
ok('a press on the SCREEN does not move the phone — that gesture belongs to the chart',
  H('document:pointermove') === undefined && !phone.classList.contains('dragging'));

// Taken hold of 100 px in and 20 px down from the phone's own top-left, so the grip offset is
// (100, 20) and every position below is the pointer less that.
phone.fire('pointerdown', { clientX: 100, clientY: 20, target: CASE });
ok('...but a press on the case takes hold of it, and says so',
  phone.classList.contains('dragging'));
H('document:pointermove')({ clientX: 400, clientY: 300 });
ok('...and it follows the pointer, keeping the grip where it was taken',
  phone.style.left === '300px' && phone.style.top === '280px');
// Dragged hard at the edge: a phone released just off the screen is a phone nobody can get
// back, and this page has no command to fetch it.
H('document:pointermove')({ clientX: 9000, clientY: 9000 });
ok('...and cannot be dragged off the desk, whatever the pointer does',
  Number(phone.style.left.replace('px', '')) <= 1400
  && Number(phone.style.top.replace('px', '')) <= 900);
H('document:pointerup')({});
ok('...and is put down when the pointer lifts',
  !phone.classList.contains('dragging') && H('document:pointermove') === undefined);

report();
