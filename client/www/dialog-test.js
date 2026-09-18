/**
 * The executable specification for the boat's half of the conversation.
 *
 * `drive-race.mjs` drives the protocol against a live server, which proves the wire. This proves
 * the part that has no wire in it: the little state machine every party runs over the same
 * events, the channel's idempotence, the alert rule, and the ladder. All of it is pure, and all
 * of it is the kind of thing that looks right on a screen while being wrong.
 *
 * The one to read first is the AP pair. "Publishing a start clears the postponement" is not a
 * rule anybody implements — it is what falls out of the last message for a tag BEING that tag's
 * state, and the moment somebody adds a `clear` message this spec should start failing.
 */

import { Dialog, QUIET_MS, ladder } from './dialog.js';
import { validate } from './schema.js';

/** A dialog with no transport behind it: everything below is what arrives, not how. */
function boat(tags = ['division:1']) {
  const dialog = new Dialog();
  dialog.session = 's1';
  dialog.boatId = 'AUS 1';
  dialog.race = 'race-1';
  dialog.tags = tags;
  return dialog;
}

let counter = 0;
const message = (type, body, tags = []) => ({
  v: 1, type, id: `m${++counter}`, at: new Date().toISOString(), tags, body,
});

export function run(check) {
  /* ------------------------------------------------ the state a division's start is in */

  const one = boat();
  check('with nothing published, a division is in no state at all', one.state() === 'none');

  const at = Date.now() + 60000;
  one.receive(message('timer', {
    startAt: new Date(at).toISOString(), warningSeconds: 300, startSeconds: 60, text: 'start',
  }, ['division:1']));
  check('a timer schedules it', one.state() === 'scheduled');
  // THE COUNTDOWN IS THE BOAT'S OWN. The server sent an instant and does not tick.
  check('...and the countdown is arithmetic against this boat\'s clock',
    Math.abs(one.countdown(Date.now()) - 60) <= 1);
  check('...which goes negative once the start has gone, rather than stopping',
    one.countdown(at + 5000) === -5);
  check('...and the state follows the boat\'s own clock past the start',
    one.state(at + 1000) === 'racing');

  one.receive(message('flag', { flag: 'postponed', text: 'AP' }, ['division:1']));
  check('an AP postpones it', one.state() === 'postponed');
  // AP SUSPENDS, IT DOES NOT RESCHEDULE: it does not say when the new start will be, because
  // there is no "now" on the server to count five minutes from.
  check('...and voids the start rather than moving it', one.countdown() === null);

  one.receive(message('timer', {
    startAt: new Date(Date.now() + 400000).toISOString(), text: 'start again',
  }, ['division:1']));
  // THE ASSERTION WITH TEETH. There is no "clear the AP" message and there must not be: the
  // last message to arrive for a tag IS that tag's state.
  check('re-publishing the start clears the AP with no message of its own',
    one.state() === 'scheduled');

  one.receive(message('flag', { flag: 'abandoned', text: 'abandoned' }, ['division:1']));
  check('abandonment beats everything, whatever the clock says',
    one.state() === 'abandoned' && one.state(Date.now() + 999999) === 'abandoned');

  /* ------------------------------------------------------------------------ the tags */

  const mine = boat(['division:1']);
  mine.receive(message('timer', { startAt: new Date(Date.now() + 1000).toISOString(), text: 'a' },
    ['division:2']));
  check('a start for ANOTHER division is not this boat\'s start', mine.state() === 'none');
  mine.receive(message('flag', { flag: 'abandoned', text: 'everybody' }));
  // A MESSAGE WITH NO TAGS IS FOR EVERYBODY (§6), which for a standing means this boat's own
  // tags — a fleet-wide abandonment has to become each division's state, or a division would go
  // on believing it was racing.
  check('...but an untagged one is for everybody, including this boat',
    mine.state() === 'abandoned');

  /* ------------------------------------------------------------------- the channel */

  const talk = boat();
  const said = message('say', { from: 'committee', text: 'Shortening' });
  talk.receive(said);
  check('a message lands in the channel', talk.channel.length === 1);
  check('...with an unread count, which is the one thing worth knowing from another screen',
    talk.unread === 1);
  talk.receive(said);
  // THE SAME ENVELOPE ARRIVING TWICE IS ONE ENTRY, and that is what `id` is for: the channel's
  // catch-up re-sends the ORIGINAL envelopes, ids and all.
  check('...and arriving again is the same entry, not a second one', talk.channel.length === 1);
  talk.markRead();
  check('reading it clears the count', talk.unread === 0);
  check('...and acknowledges what was said, because reading IS dismissing a message',
    talk.acked.has(said.id));

  const state = message('flag', { flag: 'postponed', text: 'AP — squall' }, ['division:1']);
  talk.receive(state);
  // THE STATE MESSAGES ARE IN THE CHANNEL TOO (§9.4), so a boat that joined late reads the
  // afternoon as one story — and the entry is the receipt while the state is the thing.
  check('a state message writes a channel entry as well as setting the state',
    talk.channel.length === 2 && talk.state() === 'postponed');
  check('...and it is the one that INTERRUPTS, since it changes what the boat is doing',
    talk.alert?.id === state.id);
  // A committee message is acknowledged — it is a thing a protest could turn on — but it does
  // NOT interrupt: it is acknowledged by being read, and a radio call that put a dialog over
  // somebody's plot would make the committee reluctant to use the radio.
  check('...while a chat message is acknowledged by being read rather than by a dialog',
    talk.channel[0].needsAck === true && talk.channel[0].type === 'say');

  talk.ack(state.id);
  check('acknowledging it takes the alert away', talk.alert === null);
  check('...and queues the ack by envelope id, whatever the type',
    talk.out.some((m) => m.type === 'ack' && m.body.ackOf === state.id));
  const before = talk.out.length;
  talk.ack(state.id);
  check('...once only, however many times it is dismissed', talk.out.length === before);

  // A re-stated flag appears normally — not suppressed, not marked as a catch-up — but it does
  // not raise the alert again, because this boat has already said it saw it.
  talk.receive({ ...state, id: 'again' });
  check('a re-stated flag appears in the channel again, because it is true whenever it arrives',
    talk.channel.length === 3);
  talk.ack('again');
  check('...and nothing is outstanding once it is acknowledged too', talk.alert === null);

  /* ------------------------------------------- coming back after a gap asks for the channel */

  // The server re-states what is TRUE by itself, so there is nothing to ask for there. The
  // channel is the exception, because a channel IS a history — and the ask is guarded on there
  // having been a previous exchange, since on the first one there is no gap.
  const back = boat();
  back.channel.push({ id: 'last', type: 'say', at: new Date().toISOString(), text: 'x' });
  back.lastExchange = Date.now() - 60000;
  back.connected = false;
  back.catchUp();
  const asked = back.out.find((m) => m.type === 'channel.since');
  check('a boat coming back asks for the channel after the last entry it holds',
    asked?.body?.after === 'last');

  /* --------------------------------------------------------- the safety three stand out */

  const mayday = boat();
  mayday.receive(message('say', { from: 'AUS 7', text: 'Man overboard' }));
  check('a safety message is marked as one, because it must be impossible to scroll past',
    mayday.channel[0].safety === true);
  mayday.receive(message('say', { from: 'AUS 7', text: 'Nice breeze' }));
  check('...and an ordinary one is not', mayday.channel[1].safety === false);

  /* ----------------------------------------------------------------- what it reports */

  const quiet = boat();
  quiet.fixSeconds = null;
  const fix = { latitude: -33.8, longitude: 151.28, time: Date.now(), sogKn: 6, cogDeg: 42 };
  // FIXES STOP WHEN THERE IS NO FLEET, and the absence of `fixSeconds` is how a boat is told:
  // on a phone in a bracket for four hours, reporting to nobody is battery spent on nobody.
  check('with no fixSeconds, no fix is reported at all', quiet.report(fix) === false);

  const reporting = boat();
  reporting.fixSeconds = 2;
  check('with one, a fix is queued', reporting.report(fix) === true);
  check('...and not again until the interval has passed', reporting.report(fix) === false);
  const queued = reporting.out.find((m) => m.type === 'fix');
  check('...carrying the position, the course and the speed, and nothing else about the boat',
    JSON.stringify(Object.keys(queued.body).sort())
      === JSON.stringify(['at', 'cogDeg', 'position', 'revision', 'session', 'sogKn']));

  const latched = boat();
  latched.crossing({ line: 'manly-cove', time: Date.now() }, { step: 0, lap: 1, letter: 'S' });
  const crossing = latched.out.find((m) => m.type === 'crossing');
  check('a crossing carries the line, the step and the instant', crossing.body.line === 'manly-cove'
    && crossing.body.step === 0 && typeof crossing.body.instant === 'string');

  /* --------------------------------------------------- when nothing is getting through */

  const gone = boat();
  check('a dialog that has never exchanged has no quiet time to report', gone.quietMs() === null);
  gone.lastExchange = Date.now() - QUIET_MS - 1000;
  check('...and one that has not heard anything for a while says so', gone.quiet === true);

  /* ---------------------------------------------------------------------- the ladder */

  const fleet = [
    { boatId: 'a', sailNo: 'A', tags: ['division:1'], step: 2, lap: 1, elapsedMs: 600000, tcf: 1 },
    { boatId: 'b', sailNo: 'B', tags: ['division:1'], step: 3, lap: 1, elapsedMs: 700000, tcf: 1 },
    { boatId: 'c', sailNo: 'C', tags: ['division:2'], step: 1, lap: 1, elapsedMs: 500000 },
    {
      boatId: 'd', sailNo: 'D', tags: ['division:1'], step: 3, lap: 1,
      elapsedMs: 900000, finishedAt: new Date().toISOString(), tcf: 0.8,
    },
  ];
  const all = ladder(fleet);
  check('a boat that has finished is ahead of one still going', all[0].boatId === 'd');
  check('...then the one that is furthest round', all[1].boatId === 'b');
  check('...and every row has a place', all.every((row, i) => row.place === i + 1));
  check('corrected time is elapsed times TCF, where a TCF is known',
    all[0].correctedMs === 720000);
  // Carried, not applied: turning a TCF into a DISTANCE is the open question, and nothing here
  // does that.
  check('...and null where there is none, rather than a guess',
    all.find((row) => row.boatId === 'c').correctedMs === null);

  const division = ladder(fleet, { tags: ['division:1'] });
  check('the ladder filters by division, so a sailor can see their own fleet',
    division.length === 3 && !division.some((row) => row.boatId === 'c'));

  const aged = ladder([{ boatId: 'a', at: new Date(Date.now() - 60000).toISOString() }]);
  check('...and says how old each boat\'s position is, so the screen can age rather than blank',
    aged[0].ageMs >= 59000);

  /* ------------------------------------------------- the validator, on the same subset */

  const schema = {
    type: 'object',
    properties: {
      startAt: { type: 'string', format: 'date-time' },
      warningSeconds: { type: 'integer', minimum: 0 },
      flag: { enum: ['postponed', 'abandoned'] },
    },
    required: ['startAt'],
  };
  check('a sound message passes', validate(schema, { startAt: '2026-09-17T08:00:00Z' }) === null);
  check('a missing required field is named', /startAt/.test(validate(schema, {})));
  check('an instant with no timezone is refused — every one on this wire carries one',
    validate(schema, { startAt: '2026-09-17T08:00:00' }) !== null);
  check('a number below its minimum is refused',
    validate(schema, { startAt: '2026-09-17T08:00:00Z', warningSeconds: -1 }) !== null);
  check('a value outside an enum is refused',
    validate(schema, { startAt: '2026-09-17T08:00:00Z', flag: 'maybe' }) !== null);
  // §5 RULE 2, written where a validator can enforce it: unknown fields are ignored on both
  // sides, because that is what lets an installed client and an updated server go on talking.
  check('an unknown field is IGNORED, which is what keeps an old client talking',
    validate(schema, { startAt: '2026-09-17T08:00:00Z', somethingNew: 42 }) === null);
  check('...and so is an absent optional one, since a field is only ever added',
    validate(schema, { startAt: '2026-09-17T08:00:00Z' }) === null);

  const unknownType = boat();
  unknownType.receive(message('somethingFromTheFuture', { whatever: 1 }));
  // §5 RULE 3: an unknown message type is ignored AND COUNTED. A client silently dropping what
  // the server sends is the failure the versioning scheme exists to make visible.
  check('an unknown message type is ignored and counted, not acted on',
    unknownType.unknown === 1 && unknownType.channel.length === 0);
}
