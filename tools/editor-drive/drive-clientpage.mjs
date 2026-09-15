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
import { $, H, ok, report, settle } from './dom.mjs';

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

let taken = null;
for (const [course, body] of Object.entries(file.courses)) {
  for (const variant of Object.keys(body.variants ?? { main: {} })) {
    try {
      const result = await post(`/api/lifecycle/${KEY}/snapshots`, { course, variant });
      if (result.snapshot?.steps?.length >= 2) taken = { course, variant };
    } catch { /* incomplete, or a template — neither is this driver's business */ }
    if (taken) break;
  }
  if (taken) break;
}
if (!taken) {
  ok('the fixture holds a course that can be published', false);
  report();
}
await post(`/api/lifecycle/${KEY}/publications`, { publish: [{ course: taken.course, variant: taken.variant }] });
file.courses[taken.course].public = true;
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
ok('the page comes up on the join screen', device().includes('Join and sail'));
ok('...offering only courses that are public AND published, since a client is handed a snapshot',
  device().includes(taken.course));
ok('...and asking who the boat is before where it is going',
  device().includes('id="j_sail"') && device().includes('id="j_name"'));

$('j_sail').value = 'AUS 1';
H('j_sail:input')({ target: { value: 'AUS 1' } });
$('j_name').value = 'Bombora';
H('j_name:input')({ target: { value: 'Bombora' } });
H('j_go:click')();
await settle(1500);

ok('joining puts the course on the screen', device().includes('<svg class="plot"'));
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
ok('the plot ZOOMS IN as the boat closes the line',
  lastApproach.scale > firstApproach * 3);
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
const { offsetBy } = await import('../../client/www/boatsim.js');
const ahead = offsetBy(st.sim.at, Math.sin(rad) * 150, Math.cos(rad) * 150);

H('place:click')();
const [px, py] = st.view.toPx(ahead);
H('rig:pointerdown')({ clientX: px, clientY: py, pointerId: 1 });
H('rig:pointerup')({ clientX: px, clientY: py, pointerId: 1 });
ok('placing the boat keeps it sailing — the helm order survives being picked up',
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

report();
