/**
 * DEFINING a race — the editor's fourth tab, which had no driver and should have.
 *
 * The bug this file exists because of: the form asked what a race was **followed by**, which is
 * a question whose answer does not exist yet. Races are made in the order they are sailed, so
 * when you create race two, race three has not been invented — and the only races on offer were
 * the ones before it. Asking what this race FOLLOWS can always be answered at the moment of
 * asking, and writes the same single link from the other end.
 *
 * So the assertions below are mostly about that one link: that it is written on the race BEFORE
 * (which is where the server reads it), that changing it does not leave two races leading into
 * one, and that the offers exclude the ways a chain can go wrong — a fork, and a loop.
 */
import { $, H, choose, chosenIn, ok, optionsOf, paneHtml, report, settle } from './dom.mjs';

await import('../../client/www/editor.js');
await settle(900);

const get = async (path) => (await fetch(path)).json();
const [programme] = await get('/api/programmes');
const KEY = `${programme.club}/${programme.series}`;
const file = () => get(`/api/programmes/${KEY}`);

const form = () => $('raceForm').innerHTML || '';
const options = (id) => {
  const block = new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)</select>`).exec(form());
  return block ? [...block[1].matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]) : [];
};
const chosen = (id) => {
  const block = new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)</select>`).exec(form());
  const m = block && /<option value="([^"]*)" selected/.exec(block[1]);
  return m ? m[1] : '';
};

/* ------------------------------------------------------------------- the tab exists */

H('tab-races:click')();
await settle(700);
ok('the editor has a Races tab, because DEFINING a race is editing',
  paneHtml().includes('sel_race'));
ok('...and says what a race is, and where one is RUN, in the same breath',
  paneHtml().includes('race.html'));

/* ------------------------------------------------------------------ making the first */

const before = new Set(optionsOf('race'));
H('cmd_race_add:click')();
await settle(900);
const FIRST = optionsOf('race').find((id) => !before.has(id));
ok('a race can be added', !!FIRST);
// Named for the day it is on, exactly as a variant expanded from a template is — because it is
// the same fact: a race is a shape sailed on a day, and usually not the only one that day.
ok('...named yyyymmdd-race-n, for the race it is rather than for nothing',
  /^\d{8}-race-\d+$/.test(FIRST ?? ''));
ok('...with one division already, since a race with none can hand no boat a course',
  form().includes('data-dcourse='));

// THE QUESTION THAT WAS WRONG. With one race in existence there is nothing before it, so the
// only honest answer is "nothing" — and the old form asked what this race was FOLLOWED BY,
// which could never be answered at the moment of asking.
ok('the form asks what this race FOLLOWS, not what follows it',
  form().includes('id="r_follows"') && !form().includes('id="r_next"'));
ok('...and the first race follows nothing, which is the only answer available',
  chosen('r_follows') === '');

/* --------------------------------------------------- and the second, which follows it */

H('cmd_race_add:click')();
await settle(900);
const SECOND = optionsOf('race').find((id) => id !== FIRST && !before.has(id));
ok('a second race can be added', !!SECOND && SECOND !== FIRST);
ok('...and NOW there is something to follow, which there was not a moment ago',
  options('r_follows').includes(FIRST));

$('r_follows').value = FIRST;
H('r_follows:change')({ target: { value: FIRST } });
await settle(1400);

// THE LINK IS WRITTEN AT THE OTHER END. The model keeps `next` on the race before, because that
// is what the server reads when a boat stops racing and has to be told where it is entered.
const saved = await file();
ok('choosing what this race follows writes `next` on the race BEFORE it',
  saved.races[FIRST].next === SECOND);
ok('...and nothing on this one, which is the end of the chain so far',
  !saved.races[SECOND].next);
ok('...which the form reads back the other way round', chosen('r_follows') === FIRST);
ok('...and says what it means for a boat, rather than leaving a field to be interpreted',
  form().includes('are entered for') || form().includes('entered for'));

/* ------------------------------------------- the two ways a chain goes wrong */

// A race is followed by ONE race. Offering one that already leads somewhere would fork the
// chain, and a boat that stopped racing would be entered for two races at once.
H('cmd_race_add:click')();
await settle(900);
const THIRD = optionsOf('race').find((id) => ![FIRST, SECOND].includes(id) && !before.has(id));
ok('a third race can be added', !!THIRD);
ok('...and the race that already leads into another is NOT offered to follow',
  !options('r_follows').includes(FIRST));
ok('...while the one at the end of the chain is', options('r_follows').includes(SECOND));
ok('...and it says why, rather than leaving a gap in the list to be puzzled over',
  form().includes('the chain would fork'));

$('r_follows').value = SECOND;
H('r_follows:change')({ target: { value: SECOND } });
await settle(1400);
const chained = await file();
ok('a three-race day chains end to end', chained.races[FIRST].next === SECOND
  && chained.races[SECOND].next === THIRD);

// And a chain must not eat its own tail.
choose('race', FIRST);
await settle(900);
ok('a race cannot be made to follow one it already leads to, however far down',
  !options('r_follows').includes(THIRD) && !options('r_follows').includes(SECOND));

/* ------------------------------------------------ changing the answer moves the link */

choose('race', THIRD);
await settle(900);
$('r_follows').value = '';
H('r_follows:change')({ target: { value: '' } });
await settle(1400);
const cut = await file();
// WITHOUT THE CLEAR, changing the answer would leave two races leading into this one, and the
// chain would fork the moment anybody finished.
ok('answering "nothing" cuts the link rather than adding a second one',
  !cut.races[SECOND].next);
ok('...leaving the rest of the chain alone', cut.races[FIRST].next === SECOND);

/* ---------------------------------------------------- divisions, which are tags and courses */

choose('race', FIRST);
await settle(900);
const course = Object.keys((await file()).courses)[0];
const select = $('raceForm').querySelectorAll('[data-dcourse]')[0];
ok('a division names a course', !!select);
select.fire('change', { target: { value: course } });
await settle(1400);
ok('...which reaches the file', (await file()).races[FIRST].divisions.open?.course === course);

H('r_add_div:click')();
await settle(1400);
const divisions = Object.keys((await file()).races[FIRST].divisions);
ok('a race can have more than one division, each with its own course', divisions.length === 2);

/* ----------------------------------------- what leaving the variant unsaid actually means */

// It means "the course's only sailable design", which the server resolves at join time — and
// that is an answer only where the course HAS one. The empty option therefore says which case
// the chosen course is in, rather than the same four words either way.
const sailable = (c) => Object.values(c.variants ?? {}).filter((v) => !v.template).length;
const one = Object.entries((await file()).courses).find(([, c]) => sailable(c) === 1);
$('raceForm').querySelectorAll('[data-dcourse]')[0]
  .fire('change', { target: { value: one[0] } });
await settle(1200);
ok('with one design, the empty option NAMES it rather than saying "the only one"',
  form().includes('its only design'));

// THE SITUATION IS MADE RATHER THAN LOOKED FOR. The fixture happens to have no course with two
// sailable designs, and a driver that shrugs at that asserts nothing — so it goes and adds one,
// which is what somebody splitting a fleet over one course would do anyway.
H('tab-courses:click')();
await settle(800);
choose('course', one[0]);
await settle(800);
H('cmd_variant_add:click')();
await settle(1600);
ok('a second design can be added to that course', sailable((await file()).courses[one[0]]) === 2);

H('tab-races:click')();
await settle(800);
choose('race', FIRST);
await settle(900);
$('raceForm').querySelectorAll('[data-dcourse]')[0]
  .fire('change', { target: { value: one[0] } });
await settle(1400);
ok('with several, the empty option says how many there are to pick from',
  /pick one of \d/.test(form()));
// AND THE SERVER SAYS SO TOO, because a division naming no variant of a course with two hands a
// boat nothing — and without this it would say so only when somebody tried to join, on the water.
ok('...and the file reports it rather than waiting for a boat to find out',
  JSON.stringify((await file()).problems ?? []).includes('must say which variant'));

/* ------------------------------------------------------------------ deleting, and the chain */

choose('race', SECOND);
await settle(900);
H('cmd_race_delete:click')();
await settle(900);
// A race another race names as its NEXT is holding it: deleting it would break the chain
// silently, and a boat finishing would find nothing to be entered for.
ok('a race that another leads into cannot be deleted while it does',
  optionsOf('race').includes(SECOND) && $('rowMsg').innerHTML.includes('next race'));

// AND FREEING IT IS DONE FROM THE RACE ITSELF, which is the whole point of asking the question
// this way round: what holds SECOND is FIRST's `next`, and the way to clear that is to stand on
// SECOND and say it follows nothing. Standing on FIRST and answering "nothing" clears whatever
// leads into FIRST, which is a different link entirely — and was this driver's own mistake
// first, which is a fair sign the question is now being asked at the end a person thinks from.
choose('race', SECOND);
await settle(900);
$('r_follows').value = '';
H('r_follows:change')({ target: { value: '' } });
await settle(1400);
ok('saying a race follows nothing clears the link that held it',
  !(await file()).races[FIRST].next);
H('cmd_race_delete:click')();
await settle(1400);
ok('...and it can then be deleted', !optionsOf('race').includes(SECOND));

report();
