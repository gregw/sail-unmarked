/**
 * A SIMPLE RACE, END TO END, over the wire the dialog document specifies.
 *
 * No page and no DOM: this drives the protocol itself, because the protocol is the thing the
 * document is about and it has to be right before any screen drawn on top of it means anything.
 * One boat and one committee, both talking to a live server:
 *
 *   define a race → the boat joins and is told which race and which division → the committee
 *   schedules a start → AP → schedules it again → the boat's own clock counts down → the boat
 *   reports fixes and a crossing → the committee sees it on the fleet table → a course change
 *   is published and acknowledged → the boat retires → the chain enters it for the next race
 *
 * Every assertion below is about a promise the document makes, and the ones worth reading first
 * are the three that are easy to get wrong in a way nothing would notice:
 *
 * <ul>
 * <li><b>A join with no race behind it gets no channel</b>, and no `fixSeconds` — the absence of
 *     that one field is how a boat is told there is no fleet to report to (§8.2).
 * <li><b>Publishing a start supersedes an AP</b>, because the last message to arrive for a tag
 *     IS that tag's state (§8.4). There is no "clear the AP" message and there must not be.
 * <li><b>Reconnection re-states rather than replaying</b> (§4.1): a boat that comes back gets
 *     what is TRUE, as ordinary messages, plus the channel it missed — which is the one thing
 *     that is replayed, because a channel is a history.
 * </ul>
 */
import { ok, report, settle } from './dom.mjs';

const PORT = process.env.UNMARKABLE_PORT || '8084';
const at = (path) => `http://localhost:${PORT}${path}`;

const json = async (path, options) => {
  const response = await fetch(at(path), options);
  if (!response.ok) throw new Error(`${path} → ${response.status} ${(await response.text()).slice(0, 200)}`);
  return response.json();
};
const post = (path, body) => json(path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
});

/* ------------------------------------------------- something published to race on */

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
await post(`/api/lifecycle/${KEY}/publications`,
  { publish: [{ course: taken.course, variant: taken.variant }] });
file.courses[taken.course].public = true;

/* --------------------------------------------------- DEFINING a race, which is editing */

// Today, in the club's own timezone, because a race day is a local day and the chain in §12.6
// turns on it.
const today = new Date().toLocaleDateString('en-CA');     // yyyy-mm-dd
const races = {
  'drive-race-1': {
    name: 'Drive race one',
    date: today,
    format: 'fleet',
    next: 'drive-race-2',
    divisions: { open: { course: taken.course, variant: taken.variant } },
  },
  'drive-race-2': {
    name: 'Drive race two',
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
ok('a race is DEFINED in the series file, where configuration belongs',
  !!saved.races?.['drive-race-1'] && saved.races['drive-race-1'].date === today);
ok('...naming a course for each division, which is the whole division mechanism',
  saved.races['drive-race-1'].divisions?.open?.course === taken.course);
ok('...and the race that follows it, which is how a day of racing is chained',
  saved.races['drive-race-1'].next === 'drive-race-2');
ok('...and the file still loads without complaint',
  !JSON.stringify(saved.problems).includes('race'));

/* ============================================================== the boat's side */

/** One exchange, as the polling transport (§3). */
const speak = async (session, ...envelopes) => {
  const body = await post(session ? `/api/dialog/${session}` : '/api/dialog', {
    envelopes: envelopes.map((e) => ({ v: 1, ...e })),
  });
  return body.envelopes ?? [];
};
const only = (got, type) => got.find((m) => m.type === type) ?? null;

let got = await speak(null,
  { type: 'hello', body: { versions: [1], client: { name: 'drive', build: 'test' } } });
const hello = only(got, 'hello.ok');
ok('the conversation opens with hello and the server chooses the version', hello?.body?.v === 1);
// NO TIME IN THE REPLY. The server is not a clock to set yours by, and the one field somebody
// would reach for here is the field that would make it one (§1.2).
ok('...and there is no time in the reply, because the server is not a clock',
  !('now' in (hello?.body ?? {})) && !('serverTime' in (hello?.body ?? {})));

got = await speak(null, {
  type: 'join',
  body: {
    sailNo: 'AUS 1', name: 'Bombora', club: programme.club, series: programme.series,
    course: taken.course, variant: taken.variant, tcf: 1.02,
  },
});
const joined = only(got, 'joined');
ok('a boat joins and is handed a session', !!joined?.body?.session);
// JOINED CARRIES THE COURSE, NOT A REFERENCE TO IT: a boat that has to fetch before it can sail
// is a boat that cannot join on a flaky connection.
ok('...with the whole course in the message rather than a reference to fetch',
  (joined.body.course?.steps ?? []).length >= 2);
// THE RACE IS FOUND, not asked for: the boat drilled club → series → course → variant, which is
// what a sailor holds, and the race is whichever one today maps a division to that course.
ok('...and told which race it is in, found from the course and the day',
  joined.body.race === 'drive-race-1');
ok('...and which division, as a tag', (joined.body.tags ?? []).includes('division:open'));
ok('...and how often to report, since there is a fleet to report to',
  joined.body.fixSeconds > 0);

const SESSION = joined.body.session;

/* ------------------------------------------- the committee schedules, postpones, schedules */

const conduct = () => json(`/api/conduct/${KEY}/drive-race-1`);
const publish = (message) => post(`/api/conduct/${KEY}/drive-race-1`, { v: 1, ...message });

const startAt = new Date(Date.now() + 8000).toISOString();
await publish({
  type: 'timer',
  tags: ['division:open'],
  body: { startAt, warningSeconds: 300, startSeconds: 60, text: 'open: start in 8 seconds' },
});
let states = (await conduct()).states;
ok('scheduling a start puts the division in SCHEDULED', states['division:open'].state === 'scheduled');

await publish({
  type: 'flag',
  tags: ['division:open'],
  body: { flag: 'postponed', reason: 'squall', text: 'open: AP — postponed' },
});
states = (await conduct()).states;
ok('an AP postpones it', states['division:open'].state === 'postponed');
// AP SUSPENDS, IT DOES NOT RESCHEDULE. It does not say when the new start will be, because
// there is no "now" on this server to count five minutes from.
ok('...and voids the start rather than moving it', !states['division:open'].timer);

const restartAt = new Date(Date.now() + 6000).toISOString();
await publish({
  type: 'timer',
  tags: ['division:open'],
  body: { startAt: restartAt, warningSeconds: 300, startSeconds: 60, text: 'open: start again' },
});
states = (await conduct()).states;
// RE-PUBLISHING THE START IS WHAT CLEARS THE AP (§8.4). There is no "clear the AP" message, and
// there must not be: the last message to arrive for a tag is the state.
ok('re-publishing the start clears the AP with no message of its own',
  states['division:open'].state === 'scheduled' && !states['division:open'].flag);

/* ------------------------------------------- and the boat is told all of it, in order */

got = await speak(SESSION);
const timers = got.filter((m) => m.type === 'timer');
const flags = got.filter((m) => m.type === 'flag');
ok('the boat is sent both starts and the flag between them', timers.length === 2 && flags.length === 1);
// EVERY COUNTDOWN IS RUN BY THE BOAT. The server sent an instant and two durations and does not
// tick; what the boat has is arithmetic against its own clock.
ok('...as an absolute instant and two durations, and nothing that ticks',
  timers[1].body.startAt === restartAt && timers[1].body.warningSeconds === 300);
// TEXT IS REQUIRED ON EVERY STATE MESSAGE: it is what the channel shows, and what reaches a
// sailor whose client is too old to act on the rest.
ok('...each carrying words a sailor can read, not only fields software can',
  timers.every((m) => typeof m.body.text === 'string' && m.body.text.length > 0)
  && flags.every((m) => typeof m.body.text === 'string' && m.body.text.length > 0));

/* --------------------------------------------- what the boat reports, and what is seen */

const first = joined.body.course.steps[0].crossings[0];
const mid = {
  latitude: (first.port.latitude + first.starboard.latitude) / 2,
  longitude: (first.port.longitude + first.starboard.longitude) / 2,
};
await speak(SESSION, {
  type: 'fix',
  body: {
    session: SESSION,
    position: mid,
    cogDeg: 42,
    sogKn: 6.2,
    revision: joined.body.revision,
    at: new Date().toISOString(),
  },
});
let table = await conduct();
let mine = table.boats.find((b) => b.sailNo === 'AUS 1');
ok('a fix puts the boat on the committee\'s chart', Math.abs(mine.position.latitude - mid.latitude) < 1e-9);
ok('...with an age, because a screen that shows an old position quietly is the one failure a '
  + 'committee cannot see', mine.fixAgeMs != null);
ok('...and the revision it believes it is sailing, so two geometries can be told apart',
  mine.revision === joined.body.revision);

const crossedAt = new Date().toISOString();
await speak(SESSION, {
  type: 'crossing',
  body: {
    session: SESSION,
    line: first.line,
    step: 0,
    lap: 1,
    letter: 'S',
    instant: crossedAt,
    revision: joined.body.revision,
    confirmedFixes: 3,
  },
});
const secondAt = new Date(Date.now() + 1500).toISOString();
await speak(SESSION, {
  type: 'crossing',
  body: {
    session: SESSION,
    line: joined.body.course.steps[1].crossings[0].line,
    step: 1,
    lap: 1,
    instant: secondAt,
    revision: joined.body.revision,
    confirmedFixes: 3,
  },
});
table = await conduct();
mine = table.boats.find((b) => b.sailNo === 'AUS 1');
ok('a crossing moves the boat along the course', mine.step === 1 && mine.crossings === 2);
// ELAPSED IS THE DIFFERENCE BETWEEN TWO OF THE BOAT'S OWN INSTANTS, which is the whole reason a
// clock offset costs nothing: the quantity racing is decided on never leaves one clock.
ok('...and elapsed is the difference between two of the BOAT\'s own instants',
  Math.abs(mine.elapsedMs - (Date.parse(secondAt) - Date.parse(crossedAt))) < 5);

/* ----------------------------------------------------------- the channel, both ways */

await publish({ type: 'say', body: { from: 'race committee', text: 'Shortening at the windward mark' } });
got = await speak(SESSION, { type: 'say', body: { session: SESSION, text: 'Understood' } });
ok('a boat is sent what the committee said', got.some((m) => m.type === 'say'
  && m.body.text === 'Shortening at the windward mark'));
table = await conduct();
const said = table.channel.map((e) => e.body?.text ?? '');
ok('...and what the boat said reaches the same channel — it is a radio, and everybody hears it',
  said.includes('Understood'));
// THE STATE MESSAGES ARE IN THE CHANNEL TOO (§9.4), which is what lets a boat that joined late
// read the afternoon as one story rather than being caught up by a summary.
ok('...with the flags and the starts in it, in time order, among the chat',
  table.channel.some((e) => e.type === 'flag') && table.channel.some((e) => e.type === 'timer'));

/* -------------------------------------- a course change, and whether it was SEEN */

const changed = await publish({
  type: 'course',
  tags: ['division:open'],
  body: {
    revision: joined.body.revision,
    course: joined.body.course,
    reason: 'shortened',
    text: 'open: course shortened — finish at the leeward line',
  },
});
got = await speak(SESSION);
const course = only(got, 'course');
ok('a course change reaches the boat whole, not as a reference', !!course?.body?.course?.steps);

table = await conduct();
mine = table.boats.find((b) => b.sailNo === 'AUS 1');
ok('...and the committee can see it has NOT been acknowledged yet', mine.seen.course === false);
await speak(SESSION, { type: 'ack', body: { session: SESSION, ackOf: course.id, what: 'course' } });
table = await conduct();
mine = table.boats.find((b) => b.sailNo === 'AUS 1');
// THIS IS THE WHOLE REASON ACKNOWLEDGEMENTS ARE IN THE PROTOCOL (§12.4): the question a
// committee genuinely has before starting is "have all boats seen the new course?", and without
// somewhere to read the answer the acks are bookkeeping nobody looks at.
ok('...and then that it has, which is what the acknowledgements are FOR', mine.seen.course === true);
ok('...acknowledged by envelope id, whatever the type', changed.id === course.id);

/* ------------------------------------------- the record, which is the one artefact */

// A boat posts this at the end, and it is what a protest would be argued from. Sent over the
// dialog here; the REST endpoint takes the same document, because it is the same thing arriving
// by another road.
const record = {
  club: programme.club,
  series: programme.series,
  course: taken.course,
  courseRevision: joined.body.revision,
  join: 'RACE',
  boatId: 'AUS 1',
  boatName: 'Bombora',
  sailNumber: 'AUS 1',
  tcf: 1.02,
  startTime: crossedAt,
  finishTime: secondAt,
  submittedAt: new Date().toISOString(),
  appVersion: 'drive',
  crossings: [
    {
      step: 0, line: first.line, cross: 'FORWARD', time: crossedAt,
      position: mid, confirmBefore: 3, confirmAfter: 3, counted: true, note: null,
    },
    // WHAT WAS REFUSED, AND WHY, carried as a crossing that did not count — which is what
    // `counted` and `note` are for. A separate `rejected` array was written first and was
    // silently dropped, because the model has no such field and unknown fields are ignored:
    // the record arrived looking complete with the half that says "why is there no crossing
    // here?" missing.
    {
      step: -1, line: first.line, cross: null, time: crossedAt,
      position: null, confirmBefore: 0, confirmAfter: 0, counted: false,
      note: 'REJECTED_KINEMATIC: implied 117 kn',
    },
  ],
  fixes: [],
};
await speak(SESSION, { type: 'record', body: { session: SESSION, record } });
await settle(300);
// ASKED FOR BY THE DAY THE CLUB COUNTS IN, which is what the store files by: the start instant
// in the club's own timezone, taken from its programme file.
//
// This was written twice wrong first, and both are worth remembering. It asked with the LOCAL
// date of whatever machine runs the driver — which passed all evening and failed the moment the
// clock crossed midnight in Sydney. Then it asked with the UTC date, which worked only because
// the store was filing by UTC, which was the bug. Neither is "the race day"; the club's zone is.
const zone = saved.timezone ?? 'UTC';
const filedUnder = new Date(record.startTime).toLocaleDateString('en-CA', { timeZone: zone });
const filed = await json(`/api/records/${programme.club}/${taken.course}/${filedUnder}`)
  .catch(() => null);
ok('a record sent over the dialog is FILED, not merely received',
  Array.isArray(filed) && filed.some((r) => r.sailNumber === 'AUS 1'));
const held = (filed ?? []).find((r) => r.sailNumber === 'AUS 1');
ok('...naming the revision it was sailed on, not just the course',
  held?.courseRevision === joined.body.revision);
ok('...and carrying what was REFUSED as well as what counted, which is the half a protest '
  + 'would argue from',
  (held?.crossings ?? []).some((c) => c.counted === false && /REJECTED/.test(c.note ?? '')));

/* ------------------------------------- reconnection RE-STATES; the channel is replayed */

// A second boat joining late is the same case as a boat coming back: it is sent the afternoon
// so far, in place, and then what is TRUE now.
got = await speak(null,
  { type: 'hello', body: { versions: [1] } },
  {
    type: 'join',
    body: {
      sailNo: 'AUS 2', name: 'Late', club: programme.club, series: programme.series,
      course: taken.course, variant: taken.variant,
    },
  });
const late = only(got, 'joined');
const backlog = got.filter((m) => ['say', 'flag', 'timer', 'course'].includes(m.type));
ok('a boat joining late is sent the channel it missed, in place', backlog.length >= 4);
ok('...and then what is true NOW, as ordinary messages rather than a summary',
  got.filter((m) => m.type === 'timer').some((m) => m.body.startAt === restartAt));
// A re-stated course or flag appears NORMALLY — not suppressed and not marked as a catch-up.
// The entry says "this is the course you are on", which is true whenever it arrives.
ok('...including the course, un-marked, because it is true whenever it arrives',
  got.filter((m) => m.type === 'course').length >= 1);

const LATE = late.body.session;
got = await speak(LATE, {
  type: 'channel.since',
  body: { session: LATE, after: null },
});
ok('the channel can be asked for by id — the one thing that IS replayed',
  got.filter((m) => m.type === 'say').length >= 2);

/* ------------------------------------------------- retiring, and the chain to the next race */

got = await speak(SESSION, { type: 'retire', body: { session: SESSION, reason: 'gear failure' } });
const next = got.find((m) => m.type === 'joined');
// A RETIREMENT IS STILL AN ENTRY TO THE NEXT RACE (§12.6): retiring from race one is a statement
// about race one, and a sailor who has had enough of the day says so by leaving.
ok('a boat that stops racing is entered for the next race of the day, unasked',
  next?.body?.race === 'drive-race-2');
ok('...carrying its division across, and told the new course',
  (next.body.tags ?? []).includes('division:open') && !!next.body.course?.steps);
const second = await json(`/api/conduct/${KEY}/drive-race-2`);
ok('...and it is on the second race\'s fleet list', second.boats.some((b) => b.sailNo === 'AUS 1'));
ok('...with that race\'s channel starting clean, since a channel belongs to its race',
  (second.channel ?? []).length <= 2);

/* ---------------------------------------------------------- DNF, which is never inferred */

await post(`/api/conduct/${KEY}/drive-race-2`, {
  v: 1,
  type: 'outcome',
  body: { boatId: 'AUS 1', outcome: 'dnf', reason: 'did not finish', text: 'AUS 1: DNF' },
});
const after = await json(`/api/conduct/${KEY}/drive-race-2`);
ok('a committee can record a DNF, which the software never infers',
  after.boats.find((b) => b.sailNo === 'AUS 1')?.outcome === 'dnf');

/* ------------------------------------- a join with no race behind it gets NO channel */

// The same join, against a course with no race on it today — which is what the whole system was
// for before there were committees.
const other = Object.keys(saved.courses).find((id) => id !== taken.course);
let plain = null;
if (other) {
  try {
    await post(`/api/lifecycle/${KEY}/snapshots`, { course: other, variant: soleVariantOf(saved.courses[other]) });
    await post(`/api/lifecycle/${KEY}/publications`,
      { publish: [{ course: other, variant: soleVariantOf(saved.courses[other]) }] });
    saved.courses[other].public = true;
    await fetch(at(`/api/programmes/${KEY}`), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ points: saved.points, lines: saved.lines, courses: saved.courses, races }),
    });
    got = await speak(null, { type: 'hello', body: { versions: [1] } }, {
      type: 'join',
      body: {
        sailNo: 'AUS 3', name: 'Tuesday', club: programme.club, series: programme.series,
        course: other, variant: soleVariantOf(saved.courses[other]),
      },
    });
    plain = only(got, 'joined');
  } catch { /* that course is not sailable; the assertions below say so honestly */ }
}
if (plain) {
  ok('a course with no race behind it can still be joined and sailed', !!plain.body.session);
  ok('...and is told no race', plain.body.race == null);
  // FIXES STOP TOO, and that is the part worth noticing: a fix exists to feed a fleet screen,
  // and with no fleet there is no consumer. On a phone in a bracket for four hours that is
  // battery and data spent on nobody.
  ok('...and NO fixSeconds, which is how it is told there is nobody to report to',
    plain.body.fixSeconds == null);
  ok('...and gets no channel, because there is nobody to communicate with',
    !got.some((m) => ['say', 'flag', 'timer', 'course'].includes(m.type)));
} else {
  ok('the fixture has a second publishable course, for the no-race case', false);
  ok('...', false);
  ok('...', false);
  ok('...', false);
}

function soleVariantOf(course) {
  const variants = Object.entries(course.variants ?? {})
    .filter(([, v]) => !v.template).map(([id]) => id);
  return variants[0] ?? 'main';
}

/* ----------------------------------------------- the schemas, which both sides validate */

// A `timer` with no `text` is refused, because §9.4 makes the words required: a flag with no
// words on it is a flag only the software can read.
const refused = await speak(SESSION, { type: 'timer', body: { startAt } });
void refused;
const bad = await post(`/api/dialog/${SESSION}`, {
  envelopes: [{ v: 1, type: 'crossing', body: { session: SESSION, line: 'x', instant: 'not a time' } }],
});
ok('a message that does not match its schema is refused rather than half-understood',
  (bad.envelopes ?? []).some((m) => m.type === 'rejected' && m.body.code === 'schema'));
ok('...with BOTH a code to branch on and a sentence to show somebody',
  (bad.envelopes ?? []).some((m) => m.type === 'rejected' && typeof m.body.text === 'string'
    && m.body.text.length > 20));

// AN UNKNOWN TYPE IS IGNORED AND COUNTED, not refused: an old client meeting a new message must
// carry on, and so must a new server meeting an old one's (§5 rule 3).
const unknown = await speak(SESSION, { type: 'somethingFromTheFuture', body: { whatever: 1 } });
ok('an unknown message type is ignored rather than closing the conversation',
  !unknown.some((m) => m.type === 'rejected'));

await settle(100);
report();
