/**
 * THE RACE SCREEN as a page: every race running on one chart, a start given by the definition and
 * delayed here, and a flag raised.
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
/**
 * A start time as the definition writes it — HH:MM in the SERIES' timezone, which need not be this
 * machine's — `minutes` from now.
 */
const zone = file.timezone ?? 'Australia/Sydney';
const hhmmIn = (minutes) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit',
  minute: '2-digit', hour12: false }).format(new Date(Date.now() + minutes * 60000));
const races = {
  'page-race': {
    name: 'Page race',
    date: today,
    format: 'fleet',
    divisions: { 'div-1': { course: taken.course, variant: taken.variant, start: hhmmIn(20) } },
  },
  'page-race-2': {
    name: 'Second race',
    date: today,
    divisions: { 'div-1': { course: taken.course, variant: taken.variant, start: hhmmIn(40) } },
  },
  'page-hidden': {
    name: 'Hidden race',
    date: today,
    public: false,
    divisions: { 'div-1': { course: taken.course, variant: taken.variant, start: hhmmIn(30) } },
  },
};
const saveRaces = () => fetch(`/api/programmes/${KEY}`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ points: file.points, lines: file.lines, courses: file.courses, races }),
});
await saveRaces();

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
      course: taken.course, variant: taken.variant, race: 'page-race',
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
ok('...and opens on one that is running', !!mod.__state.chosen);
ok('...and reads its conduct', !!mod.__state.conduct);
ok('the pane names the race and its divisions',
  pane().includes('Page race') && pane().includes('div-1'));
// EVERY RACE RUNNING, one tab each; a race still being set up is not running.
ok('each race running today has a tab', pane().includes('data-race="') && pane().includes('Second race'));
ok('...and a race that is not public is not among them', !pane().includes('Hidden race'));

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

/* ------------------------------------------ the start is the definition's, delayed here */

const press = (attr, value) => {
  const button = $('pane').querySelectorAll(`[data-${attr}]`)
    .find((b) => b.dataset[attr] === value);
  if (!button) throw new Error(`no [data-${attr}="${value}"] on the pane`);
  return button.fire('click', {});
};
const stateOf = () => mod.__state.conduct.states['division:div-1'];

// THE START IS SET IN THE EDITOR, with the rest of the race: this screen has no start form.
ok('the race screen has no start form: a start is set in the editor',
  !pane().includes('type="datetime-local"') && !pane().includes('data-publish='));
let states = stateOf();
ok('the start the definition gives is what the division is SCHEDULED to',
  states.state === 'scheduled' && Math.abs(Date.parse(states.timer.body.startAt) - (Date.now() + 20 * 60000)) < 90000);
ok('...a scratch start, open ten minutes after it, with the signals before it',
  states.timer.body.kind === 'scratch' && states.timer.body.openSeconds === 600
  && states.timer.body.warningSeconds === 300 && states.timer.body.startSeconds === 240);
ok('...and words a sailor can read', (states.timer.body.text ?? '').length > 10);
const boat = joinedBoats[0];

// DELAY: a new start, the whole sequence moved with it.
const before = Date.parse(states.timer.body.startAt);
press('delay', 'div-1:5');
await settle(1500);
states = stateOf();
ok('delaying five minutes puts the start five minutes later',
  Date.parse(states.timer.body.startAt) - before === 5 * 60000 && /delayed/.test(states.timer.body.text));
ok('...and the boats are sent it', (await speak(boat.session)).some((m) => m.type === 'timer'));

/* ---------------------------------------------- AP, and the second press that means it */

press('ap', 'div-1');
await settle(600);
states = stateOf();
// AN IRREVERSIBLE ACT ASKS TWICE, in the button itself rather than in a dialog, so nobody is
// ever agreeing to something that has scrolled out of view.
ok('the first press on AP only ARMS it — nothing is published', states.state === 'scheduled');
ok('...and the button says so, so it is not a press that silently did nothing',
  pane().includes('press again'));
press('ap', 'div-1');
await settle(1200);
states = stateOf();
ok('the second press publishes it', states.state === 'postponed');
ok('...and voids the start rather than moving it', !states.timer);

// AFTER AN AP A DELAY COUNTS FROM NOW, and has to leave a full sequence: at least a minute before
// the warning signal.
mod.__state.arming = null;
press('delay', 'div-1:5');
await settle(400);
ok('a new start five minutes after a postponement is refused, and the screen says why',
  pane().includes('at least 6 minutes'));
press('delay', 'div-1:10');
await settle(1500);
states = stateOf();
ok('...while ten minutes gives it a new start, which clears the AP with no message of its own',
  states.state === 'scheduled' && !states.flag
  && Math.abs(Date.parse(states.timer.body.startAt) - (Date.now() + 10 * 60000)) < 90000);

// THE DEFINITION WINS WHEN IT CHANGES: editing the race's start in the editor hands the boats the
// new one, over the delay.
races['page-race'].divisions['div-1'].start = hhmmIn(30);
await saveRaces();
await settle(2600);
states = stateOf();
ok('editing the start in the definition hands out the new one, over a delay',
  Math.abs(Date.parse(states.timer.body.startAt) - (Date.now() + 30 * 60000)) < 90000);

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
ok('once the start has gone the division is RACING', stateOf().state === 'racing');
ok('...and now it is abandonment that is offered, not AP, and no delay',
  pane().includes('data-abandon=') && !pane().includes('data-ap=') && !pane().includes('data-delay='));

/* ----------------------------------------------------- a course change, and the channel */

press('course', 'div-1');
await settle(1200);
ok('the course can be re-published, whole', !!mod.__state.conduct.states['division:div-1'].course);
const toBoat = await speak(boat.session);
ok('...and reaches the boats as geometry rather than a reference',
  toBoat.some((m) => m.type === 'course' && !!m.body.course?.steps));

// NOTHING IS REBUILT UNDER SOMEBODY'S HANDS. The pane is redrawn on every poll; while a field in
// it has focus it waits, so whatever is being typed keeps its focus and its caret.
const typing = $('sayText');
typing.tagName = 'INPUT';
document.activeElement = typing;
await settle(2600);
ok('a field being typed in survives the poll: the pane is not rebuilt under it', $('sayText') === typing);
document.activeElement = null;
H('pane:focusout')?.({});
await settle(300);
ok('...and the pane catches up once the field is left', $('sayText') !== typing);

$('sayText').value = 'Shortening at the windward mark';
H('sayGo:click')();
await settle(1200);
ok('the committee can say something to the fleet',
  (mod.__state.conduct.channel ?? []).some((e) => e.body?.text === 'Shortening at the windward mark'));
// THE COMMITTEE IS A PARTICIPANT, not a separate facility: "no private conversations" applies
// to it too, so what it says goes into the same channel the boats are on.
ok('...on the same channel the boats are on', (await speak(boat.session))
  .some((m) => m.type === 'say' && m.body.text === 'Shortening at the windward mark'));

/* ----------------------------------------- no DNF here: the time limit does it */

ok('there is no DNF button: a boat that does not finish in its time limit is not finished',
  !pane().includes('data-dnf='));

/* ----------------------------------------------------------- the other race, by its tab */

press('race', `${KEY}/page-race-2`);
await settle(400);
ok('the tab of another running race puts it in the pane', mod.__state.chosen === `${KEY}/page-race-2`
  && pane().includes('Second race'));

report();
