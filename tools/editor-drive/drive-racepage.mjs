/**
 * THE RACE SCREEN as a page: a fleet on the chart, a start scheduled, and a flag raised.
 *
 * `drive-race.mjs` drives the protocol, which proves the conversation. This drives the screen
 * the committee actually presses, which is where a protocol that works fails a fleet anyway: a
 * button wired to a node some later render replaced, a confirmation that does not confirm, a
 * flag offered when the other one is the one that applies.
 *
 * The assertion worth reading first is the pair about ARMING. An abandonment has no undo, so the
 * button asks twice — and a test that only checked the second press would pass just as happily
 * against a button that published on the first.
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

/* ------------------------------------------------- a race, published, with boats in it */

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
const today = new Date().toLocaleDateString('en-CA');
const races = {
  'page-race': {
    name: 'Page race',
    date: today,
    format: 'fleet',
    divisions: { 'div-1': { course: taken.course, variant: taken.variant } },
  },
};
await fetch(`/api/programmes/${KEY}`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ points: file.points, lines: file.lines, courses: file.courses, races }),
});

/** Two boats, one further round than the other, so the progress textures have something to say. */
const speak = async (session, ...envelopes) => (await post(
  session ? `/api/dialog/${session}` : '/api/dialog',
  { envelopes: envelopes.map((e) => ({ v: 1, ...e })) })).envelopes;

const joinedBoats = [];
for (const [sail, along] of [['AUS 1', 0], ['AUS 42', 2]]) {
  const got = await speak(null, { type: 'hello', body: { versions: [1] } }, {
    type: 'join',
    body: {
      sailNo: sail, name: sail, club: programme.club, series: programme.series,
      course: taken.course, variant: taken.variant,
    },
  });
  const joined = got.find((m) => m.type === 'joined');
  const session = joined.body.session;
  const step = joined.body.course.steps[along].crossings[0];
  const position = {
    latitude: (step.port.latitude + step.starboard.latitude) / 2,
    longitude: (step.port.longitude + step.starboard.longitude) / 2,
  };
  await speak(session, {
    type: 'fix',
    body: {
      session, position, cogDeg: 50, sogKn: 6,
      revision: joined.body.revision, at: new Date().toISOString(),
    },
  });
  for (let i = 0; i < along; i++) {
    await speak(session, {
      type: 'crossing',
      body: {
        session, line: joined.body.course.steps[i].crossings[0].line, step: i, lap: 1,
        instant: new Date(Date.now() - (along - i) * 60000).toISOString(),
        revision: joined.body.revision, confirmedFixes: 3,
      },
    });
  }
  joinedBoats.push({ sail, session });
}

/* ------------------------------------------------------------------------- the page */

globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 16);
const mod = await import('../../client/www/race.js');
await settle(1500);

const pane = () => $('pane').innerHTML || '';
const chart = () => $('chart').innerHTML || '';

ok('the page finds the races defined in the series file',
  mod.__state.races.some((row) => row.id === 'page-race'));
ok('...and opens on one, because on a race morning the race you want is today\'s',
  !!mod.__state.chosen);
ok('...and reads its conduct', !!mod.__state.conduct);
ok('the pane names the race and its divisions',
  pane().includes('Page race') && pane().includes('div-1'));

/* ------------------------------------------- the chart: colour is division, texture is progress */

ok('every boat that has joined is drawn', chart().includes('AUS 1') && chart().includes('AUS 42'));
// COLOUR IS DIVISION HERE, and it deliberately shares no value with the editor's ROLE_COLOUR:
// the two mean different things and must never be confused.
ok('...in the division\'s own colour, which is not a leg role', chart().includes('#35b5e8'));
// PROGRESS IS TEXTURE WITHIN THAT COLOUR. With one boat at the start and one two marks round,
// there must be legs of both kinds on the chart: the band of "some" is the fleet's spread.
ok('the legs some boats have sailed are drawn solid, at full weight',
  /stroke-width="4.5"/.test(chart()));
ok('...and the legs nobody has sailed yet are dashed — still to come',
  /stroke-dasharray="10,7"/.test(chart()));
ok('the legend says what the textures mean, rather than leaving them to be guessed',
  ($('legend').innerHTML || '').includes('some boats have sailed it'));

/* ------------------------------------------------------ the fleet table, and the acks */

ok('one row per boat, with the marks it has passed',
  /<table class="fleet">/.test(pane()) && pane().includes('AUS 42'));
// THE WHOLE REASON ACKNOWLEDGEMENTS ARE IN THE PROTOCOL: the question a committee has before
// starting is "have all boats seen the new course?", and this is where it is read.
ok('...and a column for whether the latest course and flag have been SEEN',
  pane().includes('Course') && pane().includes('Flag'));

/* ------------------------------------------------ scheduling a start, which is not a GO */

const press = (attr, value) => {
  const button = $('pane').querySelectorAll(`[data-${attr}]`)
    .find((b) => b.dataset[attr] === value);
  if (!button) throw new Error(`no [data-${attr}="${value}"] on the pane`);
  return button.fire('click', {});
};

/** Type an absolute local time into a division's start field, the way a person does. */
const typeStart = (division, minutesAhead) => {
  const at = new Date(Date.now() + minutesAhead * 60000);
  const local = new Date(at.getTime() - at.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const input = $('pane').querySelectorAll('[data-at]').find((i) => i.dataset.at === division);
  if (!input) throw new Error(`no start field for ${division}`);
  input.value = local;
  input.fire('change', { target: { value: local } });
  return Date.parse(local);
};

// AN ABSOLUTE TIME, not "in five minutes". A committee decides a race starts at five past two
// and says so; the countdown to it is every boat's own arithmetic.
ok('the start is asked for as an absolute time, with the operator\'s zone named',
  pane().includes('type="datetime-local"') && !pane().includes('start in'));
ok('...and the two signal periods are asked for in minutes before it',
  pane().includes('data-warning="div-1"') && pane().includes('data-prep="div-1"'));
ok('...defaulting to the sequence a sailor expects: warning 5, preparatory 4',
  /data-warning="div-1"[^>]*value="5"/.test(pane())
  && /data-prep="div-1"[^>]*value="4"/.test(pane()));
ok('...and the form works the sequence out in the times it will happen at, before publishing',
  /warning \d\d:\d\d/.test(pane()) && /preparatory \d\d:\d\d/.test(pane()));

const wanted = typeStart('div-1', 12);
await settle(600);
press('publish', 'div-1');
await settle(1200);
let states = mod.__state.conduct.states['division:div-1'];
ok('scheduling a start publishes one, and the division is SCHEDULED', states.state === 'scheduled');
// THERE IS NO GO BUTTON AND THERE CANNOT BE. The server keeps no clock, so what goes on the
// wire is an absolute instant — and the conversion from what was typed happened in this
// browser, against this operator's clock.
ok('...at the instant that was TYPED, converted here rather than there',
  Math.abs(Date.parse(states.timer.body.startAt) - wanted) < 60000);
ok('...with the warning and preparatory signals as durations before it, so the boat can show '
  + 'the flags a sailor expects',
  states.timer.body.warningSeconds === 300 && states.timer.body.startSeconds === 240);
// TEXT IS REQUIRED ON EVERY STATE MESSAGE: it is what the channel shows, and what reaches a
// sailor whose client is too old to act on the rest.
ok('...and words a sailor can read', (states.timer.body.text ?? '').length > 10);

const boat = joinedBoats[0];
const got = await speak(boat.session);
ok('the boats are sent it', got.some((m) => m.type === 'timer'));

/* ---------------------------------------------- AP, and the second press that means it */

press('ap', 'div-1');
await settle(600);
states = mod.__state.conduct.states['division:div-1'];
// AN IRREVERSIBLE ACT ASKS TWICE, in the button itself rather than in a dialog, so nobody is
// ever agreeing to something that has scrolled out of view.
ok('the first press on AP only ARMS it — nothing is published', states.state === 'scheduled');
ok('...and the button says so, so it is not a press that silently did nothing',
  pane().includes('press again'));
press('ap', 'div-1');
await settle(1200);
states = mod.__state.conduct.states['division:div-1'];
ok('the second press publishes it', states.state === 'postponed');
// AP SUSPENDS, IT DOES NOT RESCHEDULE.
ok('...and voids the start rather than moving it', !states.timer);

// AFTER AN AP THE NEXT START IS AT LEAST SIX MINUTES AHEAD — a minute before the warning
// signal, then the usual five. Enforced where the clock is, which is the operator's screen.
mod.__state.arming = null;
typeStart('div-1', 2);
await settle(400);
ok('a start two minutes after a postponement is refused, and the screen says why',
  pane().includes('At least 6 minutes ahead after a postponement'));
ok('...with the button refusing rather than only the words',
  /data-publish="div-1"[^>]*disabled/.test(pane()));

// And a time already gone is its own refusal, with its own reason: a start that has passed
// cannot be scheduled, and abandonment is the instrument that applies.
typeStart('div-1', -3);
await settle(400);
ok('a start in the past is refused too, and says that abandonment is the instrument',
  pane().includes('That is in the past'));

typeStart('div-1', 9);
await settle(400);
press('publish', 'div-1');
await settle(1200);
states = mod.__state.conduct.states['division:div-1'];
// RE-PUBLISHING THE START IS WHAT CLEARS THE AP. There is no "clear" message and there must
// not be: the last message to arrive for a tag is the state.
ok('...while a time far enough ahead is allowed, and clears the AP with no message of its own',
  states.state === 'scheduled' && !states.flag);

/* -------------------------------------- the flag that applies, and the one that does not */

// AP IS THE PRE-START SIGNAL AND ABANDONMENT IS THE POST-START ONE — which is not an extra
// rule but what the two flags mean, so the screen offers the one that applies.
ok('before the start, the screen offers AP and not abandonment',
  pane().includes('data-ap=') && !pane().includes('data-abandon='));

await post(`/api/conduct/${KEY}/page-race`, {
  v: 1,
  type: 'timer',
  tags: ['division:div-1'],
  body: {
    startAt: new Date(Date.now() - 1000).toISOString(),
    warningSeconds: 300,
    startSeconds: 60,
    text: 'div-1: started',
  },
});
await settle(2500);
ok('once the start has gone the division is RACING',
  mod.__state.conduct.states['division:div-1'].state === 'racing');
ok('...and now it is abandonment that is offered, not AP',
  pane().includes('data-abandon=') && !pane().includes('data-ap='));

/* ----------------------------------------------------- a course change, and the channel */

press('course', 'div-1');
await settle(1200);
ok('the course can be re-published, whole', !!mod.__state.conduct.states['division:div-1'].course);
const toBoat = await speak(boat.session);
ok('...and reaches the boats as geometry rather than a reference',
  toBoat.some((m) => m.type === 'course' && !!m.body.course?.steps));

$('sayText').value = 'Shortening at the windward mark';
H('sayGo:click')();
await settle(1200);
ok('the committee can say something to the fleet',
  (mod.__state.conduct.channel ?? []).some((e) => e.body?.text === 'Shortening at the windward mark'));
// THE COMMITTEE IS A PARTICIPANT, not a separate facility: "no private conversations" applies
// to it too, so what it says goes into the same channel the boats are on.
ok('...on the same channel the boats are on', (await speak(boat.session))
  .some((m) => m.type === 'say' && m.body.text === 'Shortening at the windward mark'));

/* --------------------------------------------------------- DNF, which is never inferred */

press('dnf', 'AUS 42');
await settle(400);
ok('a DNF asks twice as well — it is a result being recorded about somebody',
  mod.__state.conduct.boats.find((b) => b.sailNo === 'AUS 42')?.outcome !== 'dnf');
press('dnf', 'AUS 42');
await settle(1200);
ok('...and then records what a person decided, which the software never works out',
  mod.__state.conduct.boats.find((b) => b.sailNo === 'AUS 42')?.outcome === 'dnf');

report();
