/**
 * NOTHING INTERRUPTS AN APPROACH — dialog document §9.3, driven.
 *
 * This is the most safety-relevant rule in the whole dialog and the one whose failure would be
 * least visible in a test suite: an alert that opened over the plot would look like an alert
 * working. A sailor thirty metres off a line at nine knots is doing the one thing on this boat
 * that cannot be interrupted, and a dialog over the plot at that moment costs the crossing.
 *
 * So the same flag is published twice, at two moments, and the screen is asked what it did:
 * while the Mark screen has the display it must be a BANNER, and away from a line it must be a
 * MODAL whose dismissal is the acknowledgement the committee reads back.
 *
 * Driven on the rig page, because the rig is the one place a boat can be steered at a line on
 * purpose.
 */
import { $, H, ok, report, settle } from './dom.mjs';

const json = async (path, options) => {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error(`${path} → ${response.status} ${(await response.text()).slice(0, 180)}`);
  return response.json();
};
const post = (path, body) => json(path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
});

/* ------------------------------------------------------ a race to be in, and a course */

const [programme] = await json('/api/programmes');
const KEY = `${programme.club}/${programme.series}`;
const file = await json(`/api/programmes/${KEY}`);

let taken = null;
for (const [course, body] of Object.entries(file.courses)) {
  for (const variant of Object.keys(body.variants ?? { main: {} })) {
    try {
      const result = await post(`/api/lifecycle/${KEY}/snapshots`, { course, variant });
      if (result.snapshot?.steps?.length >= 2) taken = { course, variant };
    } catch { /* incomplete, or a template */ }
    if (taken) break;
  }
  if (taken) break;
}
if (!taken) {
  ok('the fixture holds a course that can be published', false);
  report();
}
await post(`/api/lifecycle/${KEY}/publications`, { publish: [taken] });
file.courses[taken.course].public = true;
const races = {
  'alert-race': {
    name: 'Alert race',
    date: new Date().toLocaleDateString('en-CA'),
    format: 'fleet',
    divisions: { open: { course: taken.course, variant: taken.variant } },
  },
};
await fetch(`/api/programmes/${KEY}`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ points: file.points, lines: file.lines, courses: file.courses, races }),
});

/* --------------------------------------------------------------------- the rig page */

globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
const mod = await import('../../client/www/client.js');
await settle(1200);

const device = () => $('device').innerHTML || '';

const pick = (field, value) => { H(`j_${field}:change`)({ target: { value } }); };
$('j_sail').value = 'AUS 1';
H('j_sail:input')({ target: { value: 'AUS 1' } });
pick('club', programme.club);
pick('series', programme.series);

// A BOAT JOINS A RACE WHERE THERE IS ONE, and the course follows from the division rather than
// being picked again: a boat does not choose the geometry it was entered for.
ok('with a race today, the screen asks for the RACE before any course',
  device().includes('id="j_race"') && !device().includes('id="j_course"'));
pick('race', 'alert-race');
ok('...and then for the division, which is what names the course', device().includes('id="j_division"'));
ok('...naming what each division sails, so the choice is legible',
  device().includes(`&mdash; ${taken.course}`) || device().includes(taken.course));
pick('division', 'open');
ok('...and shows the revision it is about to hand over', /revision [0-9a-f]{12}/.test(device()));
ok('...with no course selector at all, because that is not a second decision',
  !device().includes('id="j_course"'));

H('j_go:click')();
await settle(2000);

ok('the rig joins over the dialog and is told which race it is in',
  device().includes('<svg class="plot"'));

// A SCREEN WITH NOTHING BEHIND IT IS NOT OFFERED — and with a race there IS something behind
// these two, so now they appear. (`drive-boat` asserts the other half: no race, no screens.)
ok('...so Chat and Place are now offered, because there is a channel behind them',
  device().includes('data-view="chat"') && device().includes('data-view="place"'));

/* ------------------------------------------------------ the start, above every screen */

const startAt = new Date(Date.now() + 120000).toISOString();
await post(`/api/conduct/${KEY}/alert-race`, {
  v: 1,
  type: 'timer',
  tags: ['division:open'],
  body: { startAt, warningSeconds: 300, startSeconds: 60, text: 'open: start in two minutes' },
});
const gotStart = await until(() => device().includes('class="start'), 12);
// THE START IS ABOVE EVERY SCREEN, not on one of them: it is the one thing on this device that
// is about a moment rather than a place, and a countdown a sailor has to change screens to see
// is a countdown they will miss.
ok('a published start appears above the screen, whichever screen that is', gotStart);
// Two minutes out, inside a five-minute warning period, counting down as mm:ss.
ok('...counting down on the BOAT\'s own clock, inside the warning period',
  /class="start warning"/.test(device()) && /class="value">[12]:\d\d</.test(device()));

/* ------------------------------------------- a flag while the boat is NOT near a line */

const away = await post(`/api/conduct/${KEY}/alert-race`, {
  v: 1,
  type: 'flag',
  tags: ['division:open'],
  body: { flag: 'postponed', reason: 'squall', text: 'open: AP — postponed, squall coming through' },
});
const gotModal = await until(() => device().includes('id="alertBox"'), 12);
ok('a flag away from a line opens a MODAL, because it changes what the boat is doing', gotModal);
ok('...saying what arrived and in the words the committee wrote',
  device().includes('squall coming through'));

// DISMISSING IT IS THE ACKNOWLEDGEMENT. One gesture, not two: a dialog offering Dismiss beside
// Acknowledge would ask somebody at a tiller to agree they had read a thing they had just closed.
H('alertOk:click')();
await settle(1500);
ok('dismissing it closes it', !device().includes('id="alertBox"'));
const seen = await until(async () => {
  const conduct = await json(`/api/conduct/${KEY}/alert-race`);
  return conduct.boats.some((b) => b.sailNo === 'AUS 1' && b.seen?.flag === true);
}, 12);
ok('...and IS the acknowledgement, which the committee reads back', seen);

/* --------------------------------------------- and now the same thing, on an approach */

// Sail at the line. The Mark screen takes over by itself — that is the rule this page already
// demonstrates — and the flag published then must NOT open over the plot.
for (const [id, value] of [['speed', '20'], ['hz', '5'], ['noise', '1'], ['flyer', '0']]) {
  $(id).value = value;
  H(`${id}:input`)({ target: { value } });
}
H('run:click')();
const onMark = await until(() => device().includes('class="ttl'), 40);
ok('the Mark screen takes the display as the line closes, as it always did', onMark);

await post(`/api/conduct/${KEY}/alert-race`, {
  v: 1,
  type: 'flag',
  tags: ['division:open'],
  body: { flag: 'abandoned', reason: 'wind', text: 'open: ABANDONED — stop racing' },
});
const banner = await until(() => device().includes('class="banner"'), 12);
ok('A FLAG DURING AN APPROACH SHOWS AS A BANNER, and the plot is not covered', banner);
ok('...with NO modal over the plot, which is the whole of the rule',
  !device().includes('id="alertBox"'));
// It is not a quiet failure: it says what kind of thing arrived and stays until it is read.
ok('...and the banner says what arrived rather than merely blinking',
  device().includes('ABANDONED') && device().includes('after the line'));
ok('...while the approach goes on being drawn, plot and all',
  device().includes('<svg class="plot"') && device().includes('>TTL<'));

// And the modal is raised the moment the approach ends. An abandonment seen twenty seconds late
// costs nothing; a plot covered at the moment of a crossing costs the crossing.
H('run:click')();                       // stop, so the boat is no longer closing
mod.__state.client.setViewMode('overview');
await settle(1500);
ok('the modal is raised the moment the approach ends', device().includes('id="alertBox"'));

/* ---------------------------------------------------------------- the channel screen */

mod.__state.client.setViewMode('chat');
H('alertOk:click')();
await settle(1200);
ok('the channel holds everything that arrived, state messages among the chat',
  device().includes('CHANNEL') && device().includes('ABANDONED'));
// THE SAFETY THREE ARE NOT RACING MESSAGES and must not look like racing messages.
ok('...and offers the safety three, set apart from the racing ones',
  device().includes('data-say="Man overboard"') && device().includes('canned safety'));

/*
 * A WAY OFF THIS SCREEN, which is the one thing it did not have. The selector is on every
 * screen because any one of them may be the one you want to leave — and Chat and Place are the
 * two that draw no chart of their own, so nothing emitted the bar for them and a boat that
 * looked at the channel was stuck there until it reloaded, losing the race it had joined.
 */
ok('...and carries the view selector, because a screen you cannot leave is a trap',
  device().includes('data-view="overview"') && device().includes('data-view="mark"'));

const button = $('device').querySelectorAll('[data-say]').find((b) => b.dataset.say === 'Retiring');
button.fire('click', {});
await settle(1600);
const said = await until(async () => {
  const conduct = await json(`/api/conduct/${KEY}/alert-race`);
  return (conduct.channel ?? []).some((e) => e.body?.text === 'Retiring');
}, 12);
ok('one tap says what a sailor actually says, because typing at a tiller is hostile', said);

/* ------------------------------------------------------------------ race progress */

mod.__state.client.setViewMode('place');
await settle(1200);
ok('the Place screen is the corrected-time ladder', device().includes('PLACE'));
ok('...and it too carries the view selector, for the same reason',
  device().includes('data-view="overview"') && device().includes('data-view="mark"'));
ok('...and says how old the fleet feed is rather than going blank when it stops',
  /class="mono (muted|warn)">(no fleet yet|\d+ s ago)/.test(device()));

/** Wait for something to become true, however long the poll takes to bring it. */
async function until(test, seconds = 20) {
  for (let i = 0; i < seconds * 4; i++) {
    if (await test()) return true;
    await settle(250);
  }
  return false;
}
void away;

report();
