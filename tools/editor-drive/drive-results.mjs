/**
 * WHAT THE BOATS SENT IN, READ BACK — the two results pages, end to end against a live server.
 *
 * Two kinds of result and they are ranked on different things, which is the whole shape of
 * this file:
 *
 * <ul>
 * <li>A <b>race</b> is a fleet sailing together on one afternoon, read as a finishing order.
 *     Its records reach the store over the DIALOG, which is the only road on which the server
 *     knows which race a boat is in — so this drives a real join and a real record message.
 * <li>A <b>record attempt</b> stands against every other attempt at the same geometry, whenever
 *     it was made, so those are grouped by variant and then by REVISION. A course edited between
 *     two attempts is two courses and the store will not rank across the edit.
 * </ul>
 *
 * The assertion this file exists for is the one about the race stamp: <b>which race a run was
 * entered in is the SERVER's fact, taken from the session, never read off the boat's own
 * message.</b> Everything else in a record is the boat's own account of itself and is trusted
 * as such; a boat that could name its own race could put itself in a results table nobody can
 * check.
 */
import { $, H, ok, report, settle } from './dom.mjs';

const PORT = process.env.UNMARKED_PORT || '8084';
const at = (path) => `http://localhost:${PORT}${path}`;
const json = async (path, options) => {
  const response = await fetch(at(path), options);
  if (!response.ok) throw new Error(`${path} → ${response.status} ${(await response.text()).slice(0, 200)}`);
  return response.json();
};
const post = (path, body) => json(path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
});

/* --------------------------------------------- a published course and a race on it today */

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
await post(`/api/lifecycle/${KEY}/publications`,
  { publish: [{ course: taken.course, variant: taken.variant }] });
file.courses[taken.course].public = true;

const today = new Date().toLocaleDateString('en-CA');
const races = {
  'results-race': {
    name: 'Results race',
    date: today,
    format: 'fleet',
    divisions: { open: { course: taken.course, variant: taken.variant } },
  },
};
await fetch(at(`/api/programmes/${KEY}`), {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ points: file.points, lines: file.lines, courses: file.courses, races }),
});
const saved = await json(`/api/programmes/${KEY}`);
const zone = saved.timezone ?? 'UTC';

/* ------------------------------------------------- two boats race it, over the dialog */

const speak = async (session, ...envelopes) => {
  const body = await post(session ? `/api/dialog/${session}` : '/api/dialog', {
    envelopes: envelopes.map((e) => ({ v: 1, ...e })),
  });
  return body.envelopes ?? [];
};
const only = (got, type) => got.find((m) => m.type === type) ?? null;

/** Sail the race: join, then post a record of a run that took `seconds`. */
const sail = async (sailNo, seconds, tcf, options = {}) => {
  await speak(null, { type: 'hello', body: { versions: [1], client: { name: 'results', build: 'test' } } });
  const joined = only(await speak(null, {
    type: 'join',
    body: {
      sailNo, name: `Boat ${sailNo}`, club: programme.club, series: programme.series,
      course: taken.course, variant: taken.variant, tcf, lengthM: 11,
      ...(options.race ? { race: options.race } : {}),
    },
  }), 'joined');
  const session = joined?.body?.session;
  const start = new Date();
  const finish = new Date(start.getTime() + seconds * 1000);
  await speak(session, {
    type: 'record',
    body: {
      session,
      record: {
        club: programme.club,
        series: programme.series,
        course: taken.course,
        courseRevision: joined?.body?.revision,
        join: options.join ?? 'RACE',
        boatId: sailNo,
        boatName: `Boat ${sailNo}`,
        sailNumber: sailNo,
        tcf,
        lengthM: 11,
        // NAMED BY THE BOAT AND IGNORED BY THE SERVER, which is the point of the assertion
        // below: the stamp comes from the session, so a boat claiming another race gets the
        // one it actually joined.
        ...(options.claims ? { race: options.claims } : {}),
        startTime: start.toISOString(),
        finishTime: finish.toISOString(),
        submittedAt: new Date().toISOString(),
        appVersion: 'drive',
        crossings: [],
        fixes: [],
      },
    },
  });
  return { session, joined, start };
};

const quick = await sail('AUS 1', 1800, 1.02);
await sail('AUS 2', 2100, 0.95, { claims: 'a-race-it-never-joined' });
await settle(300);

ok('a boat that joined a race is told which one', quick.joined?.body?.race === 'results-race');

const filedUnder = new Date(quick.start).toLocaleDateString('en-CA', { timeZone: zone });
const filed = await json(`/api/records/${programme.club}/${taken.course}/${filedUnder}`);
const first = filed.find((r) => r.sailNumber === 'AUS 1');
const liar = filed.find((r) => r.sailNumber === 'AUS 2');
ok('a record filed from a race carries the race it was entered in', first?.race === 'results-race');
ok('...and the division it was entered as, which is how a fleet is read apart',
  first?.division === 'open');
// THE STAMP IS THE SERVER'S. A boat may say what it likes; this is the one field it is not
// the authority on, because being in a race is an entry a committee accepted.
ok('...taken from the SESSION, so a boat cannot enter itself in a race it never joined',
  liar?.race === 'results-race');

/* ------------------------------------------------------ and a record attempt, by REST */

// A record attempt needs no race and no session: it stands against the geometry, not against
// an afternoon — which is why this one goes in over the plain REST endpoint.
const attempt = async (sailNo, seconds) => {
  const start = new Date(Date.now() - seconds * 1000);
  await post('/api/records', {
    club: programme.club,
    series: programme.series,
    course: taken.course,
    courseRevision: (await json(`/api/public`))
      .find((c) => c.course === taken.course)?.published?.[0]?.revision,
    join: 'RECORD',
    boatId: sailNo,
    boatName: `Boat ${sailNo}`,
    sailNumber: sailNo,
    startTime: start.toISOString(),
    finishTime: new Date().toISOString(),
    submittedAt: new Date().toISOString(),
    appVersion: 'drive',
    crossings: [],
    fixes: [],
  });
};
await attempt('AUS 7', 2400);
await attempt('AUS 8', 2000);
await settle(200);

/* ------------------------------------------------------------------- the API answers */

const index = await json(`/api/results/${KEY}`);
const race = index.races.find((r) => r.race === 'results-race');
ok('the index lists the series\' races, newest first, with what was sent in for each',
  !!race && race.records === 2 && race.finished === 2);
const variant = index.variants.find((v) => v.course === taken.course && v.variant === taken.variant);
ok('...and the variants anybody has attempted, grouped by revision',
  !!variant && variant.revisions.length >= 1
  && variant.revisions.some((r) => r.attempts === 2));

const order = await json(`/api/results/${KEY}/race/results-race`);
ok('a race reads as a finishing order, quickest elapsed first',
  order.results.map((r) => r.sailNumber).join(',') === 'AUS 1,AUS 2');
ok('...with the boat\'s own elapsed time, from its own clock',
  order.results[0].elapsedSeconds === 1800 && order.results[1].elapsedSeconds === 2100);
// CORRECTED TIME IS OFFERED BESIDE ELAPSED, NEVER INSTEAD OF IT: this server does not score,
// and a TCF multiplication is arithmetic anybody can check rather than a result.
ok('...and corrected time beside it where a boat declared a TCF, which reverses these two',
  order.results[0].correctedSeconds === 1836 && order.results[1].correctedSeconds === 1995);

const best = await json(`/api/results/${KEY}/variant/${encodeURIComponent(taken.course)}`
  + `/${encodeURIComponent(taken.variant)}`);
ok('a variant reads as record attempts, quickest first within one revision',
  best.revisions[0].results.map((r) => r.sailNumber).join(',') === 'AUS 8,AUS 7');
ok('...and a race entry is NOT among them, because a record attempt is a different claim',
  !JSON.stringify(best.revisions).includes('AUS 1'));

/* ---------------------------------------------------------------------- the page */

const mod = await import('../../client/www/results.js');
await settle(400);
const racePanel = () => $('races').innerHTML || '';
const variantPanel = () => $('variants').innerHTML || '';

ok('the page lists the races', racePanel().includes('Results race'));
ok('...saying how many finished of what was sent in, which is what decides opening one',
  /2 finished of 2/.test(racePanel()));
ok('...and lists the variants with their attempts', /attempt/.test(variantPanel()));

// Opening a row fetches that race and draws the table. The rows are wired from the DOCUMENT,
// because they live in two panels under one rule.
const open = (id) => {
  const row = document.querySelectorAll('[data-open]').find((b) => b.dataset.open === id);
  if (!row) return false;
  row.fire('click', {});
  return true;
};
// The table is drawn INTO the row's own container, which in a browser is inside the panel and
// in this stub is a node of its own — so it is read by id rather than by scanning the panel.
const opened = (id) => $(`open-${id}`).innerHTML || '';

ok('a race row opens', open('race:results-race'));
await settle(600);
const finishers = opened('race:results-race');
ok('...into a finishing order, in order, with the elapsed times on it',
  /AUS 1[\s\S]*AUS 2/.test(finishers) && finishers.includes('30:00') && finishers.includes('35:00'));
ok('...and corrected time in its own column, where somebody can see both',
  finishers.includes('Corrected') && finishers.includes('30:36'));

ok('a variant row opens', open(`variant:${taken.course}/${taken.variant}`));
await settle(600);
const attempts = opened(`variant:${taken.course}/${taken.variant}`);
ok('...into the attempts at one revision, quickest first',
  /AUS 8[\s\S]*AUS 7/.test(attempts));
// THE REVISION HEADS ITS OWN TABLE rather than sitting in a column: two attempts under
// different revisions are not two rows of one result.
ok('...headed by the revision they stand against, which is what they are ranked within',
  new RegExp(`<h3>[^<]*${best.revisions[0].revision}`).test(attempts));

// A BOAT STILL OUT IS STILL IN THE TABLE, and has no place rather than a made-up one: a result
// that dropped the boats it could not rank would be one nobody could reconcile against the
// fleet that started.
const { table } = mod;
const unfinished = table([
  { sailNumber: 'AUS 1', elapsedSeconds: 1800, crossings: 3 },
  { sailNumber: 'AUS 9', elapsedSeconds: null, crossings: 1 },
]);
ok('a boat that did not finish is listed and is given no place', /did not finish/.test(unfinished)
  && (unfinished.match(/class="place">1</g) || []).length === 1
  && /class="place">—</.test(unfinished));
// A column of dashes says the page is missing something, where the truth is that this fleet
// races scratch.
ok('...and the corrected column is absent entirely when nobody declared a TCF',
  !unfinished.includes('Corrected'));

report();
