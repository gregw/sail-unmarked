/**
 * THE REAL CLIENT, driven: `boat.html` with a fake phone behind it.
 *
 * `drive-clientpage.mjs` drives the rig, where the fixes come from a simulator the page itself
 * owns. This drives the page a boat actually opens, where they come from
 * `navigator.geolocation` — so what is under test is the half that is new: the permission
 * asked for at the right moment, the translation in `receiver.js`, and the fact that a real
 * phone's fix is missing two of the seven fields the simulator supplies.
 *
 * <b>Every position handed over here states NO speed and NO heading</b>, which is what a
 * laptop, a phone positioned by wifi and most devices while stationary report. So the whole
 * approach below — the screen switching by itself, the TTL counting down, the hull drawn
 * pointing somewhere — runs on numbers `receiver.js` derived from consecutive positions. If
 * that derivation is wrong the page still looks entirely plausible, which is exactly why it is
 * driven rather than admired.
 *
 * The clock is REAL time throughout. The thing under test is when screens change and how long
 * a fix is believed, and a synthetic clock this file controlled would prove only that it could
 * control a clock.
 */
import { $, H, ok, report, settle } from './dom.mjs';
import { BoatSim, bearingTo, offsetBy } from '../../client/www/boatsim.js';
import { crossingNormal } from '../../client/www/markscreen.js';

const json = async (path, options) => {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error(`${path} → ${response.status}`);
  return response.json();
};
const post = (path, body) => json(path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
});

/* ------------------------------------------- something public and published to join */

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

/* --------------------------------------------------------------- a fake phone */

/**
 * The Geolocation API, as much of it as a client may touch.
 *
 * Counted rather than merely recorded: the assertion that the watch is NOT started on load is
 * about a number, and a page that quietly asked twice would pass a test that only looked at
 * whether a callback had arrived.
 */
const geo = {
  watches: 0,
  cleared: 0,
  options: null,
  onFix: null,
  onTrouble: null,
  watchPosition(onFix, onTrouble, options) {
    this.watches += 1;
    this.options = options;
    this.onFix = onFix;
    this.onTrouble = onTrouble;
    return this.watches;
  },
  clearWatch() { this.cleared += 1; },
  emit(position) { this.onFix?.(position); },
  refuse(code) { this.onTrouble?.({ code }); },
};

Object.defineProperty(globalThis, 'navigator', {
  value: { geolocation: geo },
  configurable: true,
});
globalThis.document.visibilityState = 'visible';
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 16);

const mod = await import('../../client/www/boat.js');
await settle(1200);

const device = () => $('device').innerHTML || '';

/* -------------------------------------------------- nothing is asked for on load */

ok('the page comes up on the join screen', /<div class="join">/.test(device()));
// A PROMPT ON LOAD IS A PROMPT PEOPLE REFUSE, and a refusal is sticky in a way that takes
// somebody into browser settings to undo. So nothing is asked for until the screen has said
// what it is for and somebody has pressed the button under it.
ok('...and asks the browser for NOTHING until somebody says so', geo.watches === 0);
ok('...having first said what a position is wanted for',
  device().includes('class="gnss') && device().includes('detected and timed on this phone'));
ok('...and offering the button that asks', device().includes('id="gnss_start"'));

// The join button names the location as what is missing, which is the same rule the rest of
// that form follows: a disabled control with no explanation invites somebody to press it
// again harder.
ok('...with the join button naming the permission rather than sitting grey and silent',
  /id="j_go" disabled>Allow location first</.test(device()));

/* ------------------------------------------------------- and then it is asked for */

$('gnss_start').fire('click', {});
await settle(300);
ok('pressing it starts exactly one watch', geo.watches === 1);
// `enableHighAccuracy` is the difference between GNSS and a wifi lookup, and `maximumAge: 0`
// refuses a cached position — on a moving boat a fix from thirty seconds ago is not a fix.
ok('...asking for real GNSS rather than a network guess',
  geo.options?.enableHighAccuracy === true && geo.options?.maximumAge === 0);
ok('...and saying it is looking, rather than looking like nothing happened',
  device().includes('Looking for satellites'));
ok('...while still refusing to join, now for the honest reason',
  /id="j_go" disabled>Waiting for the first fix</.test(device()));

// A refusal is reported and the watch is NOT torn down: a position lost under a bridge comes
// back on the other side, and a client that gave up at the first failure would give up at the
// one moment it matters.
geo.refuse(2);
await settle(250);
ok('a receiver that cannot see the sky says so', device().includes('No position available'));
ok('...without the watch being thrown away', geo.cleared === 0 && geo.watches === 1);
ok('...and only a REFUSED permission reads as the end of it',
  !device().includes('reload'));

/* ----------------------------------------------------------------- the first fix */

const snapshot = await post(
  `/api/join/${KEY}/${taken.course}?variant=${encodeURIComponent(taken.variant)}`);
const first = snapshot.steps[0].crossings[0];
const mid = {
  latitude: (first.port.latitude + first.starboard.latitude) / 2,
  longitude: (first.port.longitude + first.starboard.longitude) / 2,
};

const sim = new BoatSim({
  at: mid,
  speedKn: 25,
  // No noise and no flyers. This driver is checking the translation and the wiring, and a run
  // that failed one time in twenty because a flyer landed badly would be worse than useless;
  // noise is where `boatsim-test.js` and the rig's own sliders live.
  noiseM: 0,
  running: false,
  seed: 3,
});

/**
 * What the browser hands over: a position, an accuracy, a timestamp — and NOTHING ELSE.
 *
 * `speed` and `heading` are null on purpose, so everything downstream is running on what
 * `receiver.js` derived. `altitude` is there because the real object carries it and nothing
 * here may quietly depend on its absence.
 */
const position = () => {
  const fix = sim.fix(new Date());
  return {
    coords: {
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracy: fix.accuracyM,
      altitude: null,
      speed: null,
      heading: null,
    },
    timestamp: Date.now(),
  };
};

// Somewhere off the first line and stopped: a boat on a mooring before the start, which is
// where a phone is switched on. Exactly where does not matter yet — there is no client to
// measure anything against until the course has been taken.
sim.placeAt(offsetBy(mid, 0, -250));
geo.emit(position());
await settle(250);

ok('the first fix turns the panel live', device().includes('class="gnss live'));
ok('...and says the crossings will come from this device and no other',
  device().includes('device and no other'));
ok('...printing the position and the accuracy it was stated to, which is what decides trust',
  /±\d+ m/.test(device()));
ok('...and the course can now be taken', /id="j_go" disabled>Choose a club</.test(device()));

// A PHONE REPORTS NO SATELLITE COUNT and that must not read as a bad fix: the quality gate
// treats a missing count as no evidence either way rather than as a failure.
const held = mod.__boat.receiver.last;
ok('a phone\'s fix carries no satellite count, and none is invented', held.satellites === null);
ok('...and the accuracy is floored at the system\'s own metre, as the simulator floors it',
  held.accuracyM >= 1);

/* -------------------------------------------------------------------- the join */

$('j_sail').value = 'AUS 9';
H('j_sail:input')({ target: { value: 'AUS 9' } });
const pick = (field, value) => { H(`j_${field}:change`)({ target: { value } }); };
pick('club', programme.club);
pick('series', programme.series);
pick('course', taken.course);
pick('variant', taken.variant);
ok('with a position in hand the whole path is offerable', /id="j_go">Join and sail</.test(device()));

H('j_go:click')();
await settle(1500);
ok('joining puts the course on the screen', device().includes('<svg class="plot"'));
ok('...and it is the SAME screens the rig shows, not a second client',
  device().includes('BTW') && device().includes('DTW') && device().includes('data-orient="leg"'));

// A SCREEN WITH NOTHING BEHIND IT IS NOT OFFERED (§8.2). This fixture has no race on the
// course, so there is nobody to communicate with and nothing to be placed among — and Chat and
// Place are absent from the selector rather than present and empty. An empty Chat would say
// "nobody has spoken yet", where the truth is "there is nobody".
ok('...with no Chat or Place, because a join with no race behind it has no channel',
  !device().includes('data-view="chat"') && !device().includes('data-view="place"'));
ok('...and no fixes are reported to nobody, which is what the absent fixSeconds asked for',
  mod.__boat.device.dialog.fixSeconds == null);

// The wake lock is asked for on joining, because that is the first moment the browser will
// entertain the question. Where there is no such API the page has to say so rather than
// pretend: a screen that quietly slept would look like the application crashing.
ok('the screen is asked to stay awake on joining, and says honestly whether it will',
  device().includes('id="awake"')
  && device().includes(mod.__boat.awake.held ? 'Screen stays on' : 'Let screen sleep'));

/* ---------------------------------------------------- sailing, on derived numbers */

const client = mod.__boat.device.client;
const live = client.live().crossings[0];
sim.placeAt(offsetBy(live.midpoint,
  crossingNormal(live.prepared, live.required).x * -250,
  crossingNormal(live.prepared, live.required).y * -250));
sim.headingDeg = bearingTo(sim.at, live.midpoint);

let last = Date.now();
const pump = setInterval(() => {
  const now = Date.now();
  sim.step(Math.min(0.5, (now - last) / 1000));
  last = now;
  geo.emit(position());
}, 200);

/** Wait for the screen to say something, while the fixes keep arriving. */
async function until(test, seconds = 40) {
  for (let i = 0; i < seconds * 5; i++) {
    if (test()) return true;
    await settle(200);
  }
  return false;
}

await settle(600);
ok('a stopped boat is on the course screen, not the approach — nothing is close',
  !device().includes('class="ttl'));
// The derivation has its floor here: stationary, the movement between fixes is inside the
// stated accuracy, so nothing claims the boat is making way on noise.
ok('...and the speed derived from a boat that is not moving is nothing at all',
  (mod.__boat.receiver.last.sogKn ?? 0) === 0);

sim.running = true;
sim.steerTo(offsetBy(live.midpoint,
  crossingNormal(live.prepared, live.required).x * 200,
  crossingNormal(live.prepared, live.required).y * 200));

const moving = await until(() => (mod.__boat.receiver.last.sogKn ?? 0) > 5, 10);
ok('once it is making way, the speed is derived from consecutive positions', moving);
ok('...and so is a heading, which is what the hull is drawn pointing along',
  mod.__boat.receiver.last.cogDeg != null);
ok('...at about the speed it is really doing, since a TTL is distance over this number',
  Math.abs((mod.__boat.receiver.last.sogKn ?? 0) - sim.sogKn) < 6);

const gotMark = await until(() => device().includes('class="ttl'), 40);
ok('THE MARK SCREEN COMES UP ON ITS OWN, on a real phone\'s fixes — nothing was tapped', gotMark);
ok('...leading with the time to the line, computed from the derived speed',
  /class="ttl (ok|missing)"/.test(device()) && device().includes('>TTL<'));

const crossed = await until(() => device().includes('THIS LEG'), 40);
ok('the crossing latches', crossed);
ok('...naming the instant, off this device\'s own clock', /Crossed \d\d:\d\d:\d\d/.test(device()));
ok('...and the instant is the one the phone stamped, not one the server had a say in',
  client.crossings.length > 0 && client.crossings[0].time != null);

clearInterval(pump);

/* ----------------------------------------------- and when the fixes stop, it SAYS so */

// THE ONE STATE A SCREEN THAT ONLY REDRAWS ON A FIX CANNOT REPORT. The readouts have to go
// dashed and the signal line has to count, which takes a heartbeat of its own — the receiver
// cannot prompt a redraw by not reporting.
const said = await until(() => /No fix for \d+ s/.test(device()), 20);
ok('with the fixes stopped, the screen says so and counts — a dead receiver is not a calm one',
  said);

/* ------------------------------------------------------- leaving, and the watch */

$('leave').fire('click', {});
await settle(400);
ok('leaving the course comes back to the join screen', /<div class="join">/.test(device()));
// The watch is left running on purpose: the permission is already given, and a boat that has
// just finished one course usually starts another. Tearing it down would mean a cold start.
ok('...and keeps the watch, since a cold start over again would be a cost for nothing',
  geo.cleared === 0 && mod.__boat.receiver.running);
ok('...with the location panel showing live rather than asking again',
  device().includes('class="gnss live') && !device().includes('id="gnss_start"'));

/* ------------------------------------------- the seam, asserted as a fact about the files */

// THE DEVICE CANNOT KNOW WHICH RECEIVER IS BEHIND IT, and that is checkable rather than
// merely claimed. Asserted against the IMPORTS rather than the text: both files talk about
// both receivers in their comments, and they should — what must not happen is either of them
// reaching for one. The day `device.js` imports a receiver, the two pages have stopped being
// the same client.
const read = async (name) => (await import('node:fs/promises'))
  .readFile(new URL(`../../client/www/${name}`, import.meta.url), 'utf8');
const imports = (src) => [...src.matchAll(/^import[^;]*?from '([^']+)';/gm)].map((m) => m[1]);

const fromDevice = imports(await read('device.js'));
ok('the device imports neither receiver — it takes a fix and cannot tell where it came from',
  fromDevice.length > 0 && !fromDevice.some((m) => /boatsim|receiver/.test(m)));
const fromBoat = imports(await read('boat.js'));
ok('...the real client imports the real one and no simulator',
  fromBoat.includes('./receiver.js') && !fromBoat.some((m) => m.includes('boatsim')));
const fromRig = imports(await read('client.js'));
ok('...and the rig imports the simulator and no real one',
  fromRig.some((m) => m.includes('boatsim')) && !fromRig.includes('./receiver.js'));
// Both pages reach the screens through the one device, which is the whole of the claim.
ok('...and both of them get their screens from that one device',
  fromBoat.includes('./device.js') && fromRig.includes('./device.js'));

report();
