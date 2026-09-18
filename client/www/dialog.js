/**
 * THE BOAT'S HALF OF THE CONVERSATION — the dialog document, from the phone's side.
 *
 * <h2>This is the optional half of the application, and it has to stay that way</h2>
 * Nothing in this file is on the path from a fix to a latch. The boat detects and times its own
 * crossings from raw GNSS with no network, and every message here is either something it is
 * telling the fleet or something the committee is telling it — so the whole of this file can
 * fail, and a boat goes on rounding its marks and timing them to the metre. That is not a happy
 * accident: it is the architecture, and the reason the transport is wrapped in a class that can
 * simply be absent.
 *
 * <b>So every failure here is soft.</b> A poll that throws sets `connected` false and queues
 * what was going to be said; it never propagates into the client that is sailing. The screens
 * then say which state they are in, because a boat whose channel is down must not be told
 * everything is fine (§3.1).
 *
 * <h2>State is the events applied as they arrive</h2>
 * §4: there is no ordinal and nothing to replay. A start is published, an `AP` voids it, a new
 * start supersedes the `AP` — so the last message to arrive for a tag IS that tag's state, and
 * {@link Dialog#state} is that little machine run over what arrived. On reconnection the server
 * re-states rather than replaying (§4.1), and the one thing that IS replayed is the channel,
 * because a channel is a history and what was said cannot be summarised into a current value.
 *
 * <h2>Every countdown is run here</h2>
 * The server sends an instant and two durations and does not tick (§8.4, §1.2). {@link
 * Dialog#countdown} is the clock, and it is the boat's own — which is the same trust model the
 * crossing instants already rest on, and the reason a clock offset costs nothing: elapsed time
 * is a difference between two readings of one clock.
 *
 * <h2>What is NOT built yet</h2>
 * <ul>
 * <li><b>The WebSocket.</b> Polling only; the envelopes and the rules are the ones the socket
 *     will carry, which is what the document promises. `poll` comes from `hello.ok`.
 * <li><b>`ask`.</b> Every join answers itself today.
 * <li><b>`window`.</b> Carried and held as state; nothing shows a start range yet.
 * </ul>
 */

import { Schemas } from './schema.js';

/** How many queued fixes to keep while the channel is down. See `queue`. */
const KEEP_FIXES = 1;

/** How long without a successful exchange before the screens should say so. */
export const QUIET_MS = 15000;

/** What a boat can say in one tap, because typing at a tiller is hostile (§9.2). */
export const CANNED = {
  racing: ['Retiring', 'Protesting', 'OK'],
  // THE SAFETY THREE ARE NOT RACING MESSAGES and must not look like racing messages. They are
  // here because the channel is the radio, and this is what a radio is for when the racing
  // stops mattering.
  safety: ['Need assistance', 'Standing by to assist', 'Man overboard'],
};

/** The types that are STATE rather than events, and therefore hold a standing (§9.4). */
const STANDING = new Set(['course', 'timer', 'window', 'flag']);

/**
 * The types whose "did they see it?" is a real question, and are therefore acknowledged (§8.4).
 *
 * All four are things a protest could turn on, and they are acknowledged the same way — by
 * envelope `id` — so the channel gets one unseen-badge rule rather than four.
 */
const MUST_SEE = new Set(['course', 'flag', 'say', 'outcome']);

/**
 * The types that INTERRUPT, which is a narrower set, and the difference matters.
 *
 * §9.3 is about a course change or a flag: something that changes what the boat is doing, and
 * therefore something that opens a modal whose dismissal IS the acknowledgement. A committee
 * message is not that. It is acknowledged — it is on the list above — but it is acknowledged by
 * being READ in the channel, and a radio call that put a dialog over somebody's plot would make
 * the committee reluctant to use the radio.
 */
const INTERRUPTS = new Set(['course', 'flag', 'outcome']);

export class Dialog {
  /**
   * @param onChange called whenever anything a screen draws has changed, so the page can
   *   redraw without polling this object. One callback rather than an event emitter: there is
   *   exactly one consumer and it is the device.
   */
  constructor({ base = '/api/dialog', onChange = null, schemas = null } = {}) {
    this.base = base;
    this.onChange = onChange;
    this.schemas = schemas ?? new Schemas();

    this.session = null;
    this.boatId = null;
    this.race = null;
    this.raceName = null;
    this.tags = [];
    this.fixSeconds = null;      // absent means "report no fixes" — §8.2, and it is the default
    this.poll = 1000;
    this.features = [];

    this.connected = false;
    this.lastExchange = null;
    this.trouble = null;
    this.unknown = 0;            // §5 rule 3: unknown types are ignored AND COUNTED

    this.out = [];               // queued outgoing envelopes, oldest first
    this.channel = [];           // the inbox: every entry that arrived, in order
    this.standing = new Map();   // tag → { course, timer, window, flag }
    this.fleet = [];
    this.fleetAt = null;
    this.acked = new Set();      // envelope ids this boat has acknowledged
    this.seen = new Set();       // envelope ids already in the channel, so a resend is idempotent
    this.read = 0;               // how much of the channel has been looked at
    this.outcome = null;

    this.timer = null;           // the poll handle
    this.lastFixAt = 0;
  }

  /* ============================================================== the conversation */

  /**
   * Open the conversation and take a course.
   *
   * <p>One call, because from the sailor's side it is one act — and because the three messages
   * it sends are useless apart: a `hello` with no `join` behind it holds nothing, and a `join`
   * without a `hello` has not agreed a version.
   *
   * <p><b>It resolves with the `joined` body, whose `course` is the whole snapshot</b> (§8.2). A
   * boat that has to fetch before it can sail is a boat that cannot join on a flaky connection,
   * so the geometry arrives in the same message as the permission to sail it.
   */
  async join(request) {
    await this.schemas.load().catch(() => false);
    const hello = await this.exchange([
      this.envelope('hello', { versions: [1], client: { name: 'unmarkable', build: 'dev' } }),
      this.envelope('join', request),
    ]);
    const refused = hello.find((m) => m.type === 'rejected');
    if (refused) throw new Error(refused.body?.text ?? refused.body?.code ?? 'refused');
    const joined = hello.find((m) => m.type === 'joined');
    if (!joined) throw new Error('The server did not answer the join.');
    this.start();
    return joined.body;
  }

  /** Begin polling. Idempotent, so a page may call it whenever it likes. */
  start() {
    if (this.timer || !this.session) return;
    const tick = async () => {
      this.timer = setTimeout(async () => {
        this.timer = null;
        await this.pump();
        tick();
      }, this.poll);
    };
    tick();
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
  }

  /** Say goodbye, and mean it: the server drops the session and the channel stops. */
  async leave() {
    if (!this.session) return;
    this.queue(this.envelope('leave', { session: this.session, reason: 'left the course' }));
    await this.pump().catch(() => null);
    this.stop();
    this.session = null;
  }

  /**
   * One exchange: everything queued out, everything waiting in.
   *
   * <b>The queue is drained OPTIMISTICALLY and put back on failure</b>, oldest first, because
   * the alternative — waiting for an acknowledgement before letting go — is a second delivery
   * protocol on top of one whose whole premise is that state gets re-stated.
   */
  async pump() {
    if (!this.session) return [];
    const sending = this.out;
    this.out = [];
    try {
      const got = await this.exchange(sending);
      return got;
    } catch (error) {
      // Put it back, oldest first, and thin the fixes: a fix is a statement about NOW, so a
      // backlog of them is of no use to a fleet screen and only the most recent is worth
      // keeping (§3.1).
      const fixes = sending.filter((m) => m.type === 'fix').slice(-KEEP_FIXES);
      const rest = sending.filter((m) => m.type !== 'fix');
      this.out = [...rest, ...fixes, ...this.out];
      this.connected = false;
      this.trouble = error.message;
      this.changed();
      return [];
    }
  }

  async exchange(sending) {
    const url = this.session ? `${this.base}/${encodeURIComponent(this.session)}` : this.base;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ envelopes: sending }),
    });
    if (!response.ok) throw new Error(`${response.status}`);
    const body = await response.json();
    /*
     * COMING BACK AFTER A GAP ASKS FOR THE CHANNEL, and only then.
     *
     * The server re-states what is TRUE on its own (§4.1) — the course, the start, the flag —
     * so there is nothing to ask for there. The channel is the exception, because a channel IS
     * a history and what was said cannot be summarised into a current value, so the boat asks
     * for everything after the last entry it holds.
     *
     * Guarded on there having BEEN a previous exchange: on the very first one there is no gap,
     * and asking for the whole channel a second time on top of the backlog `join` already sent
     * would be harmless — the entries are idempotent by id — and would still be a request made
     * for no reason.
     */
    const returning = this.lastExchange != null && !this.connected && !!this.session;
    this.connected = true;
    this.trouble = null;
    this.lastExchange = Date.now();
    const got = Array.isArray(body.envelopes) ? body.envelopes : [];
    for (const message of got) this.receive(message);
    if (returning) this.catchUp();
    this.changed();
    return got;
  }

  /* ==================================================================== what arrives */

  receive(message) {
    if (!message || !message.type) return;
    const bad = this.schemas.check(message);
    if (bad) {
      // Refused rather than half-understood — and counted, because a client silently dropping
      // what the server sends is the failure this whole versioning scheme exists to make
      // visible.
      this.unknown += 1;
      this.trouble = `Could not read a ${message.type}: ${bad}`;
      return;
    }
    switch (message.type) {
      case 'hello.ok':
        this.poll = Number(message.body?.poll) > 0 ? Number(message.body.poll) : this.poll;
        this.features = message.body?.features ?? [];
        break;
      case 'joined':
        // ARRIVES UNASKED TOO, when a boat that has stopped racing is entered for the next race
        // of the day (§12.6). Nothing special to do beyond noticing the race has changed.
        this.session = message.body?.session ?? this.session;
        this.boatId = message.body?.boatId ?? this.boatId;
        this.race = message.body?.race ?? null;
        this.raceName = message.body?.raceName ?? null;
        this.tags = message.body?.tags ?? [];
        this.fixSeconds = message.body?.fixSeconds ?? null;
        break;
      case 'left':
        this.session = null;
        this.stop();
        break;
      case 'fleet':
        this.fleet = Array.isArray(message.body?.boats) ? message.body.boats : [];
        this.fleetAt = Date.now();
        break;
      case 'outcome':
        if (message.body?.boatId === this.boatId) this.outcome = message.body?.outcome ?? null;
        this.entry(message);
        break;
      case 'rejected':
        this.trouble = message.body?.text ?? message.body?.code ?? 'refused';
        break;
      case 'say':
        this.entry(message);
        break;
      default:
        if (STANDING.has(message.type)) {
          this.hold(message);
          this.entry(message);
        } else {
          // UNKNOWN TYPES ARE IGNORED AND COUNTED (§5 rule 3). An old client meeting a new
          // message must carry on, not close the socket.
          this.unknown += 1;
        }
    }
  }

  /**
   * Hold a state message as the standing for every tag it addresses.
   *
   * <b>Publishing a start supersedes both the previous start and any postponement</b> on that
   * tag (§8.4), which is the whole of the *publish → AP → edit → publish* cycle. An untagged
   * message is for everybody, which for a standing means the boat's own tags — and the empty
   * string besides, so a boat with no division still has somewhere to keep it.
   */
  hold(message) {
    const tags = message.tags?.length ? message.tags : [...this.tags, ''];
    for (const tag of tags) {
      const held = this.standing.get(tag) ?? {};
      if (message.type === 'course') held.course = message;
      if (message.type === 'timer') { held.timer = message; held.flag = null; held.window = null; }
      if (message.type === 'window') { held.window = message; held.flag = null; held.timer = null; }
      if (message.type === 'flag') {
        held.flag = message;
        if (message.body?.flag === 'postponed') { held.timer = null; held.window = null; }
      }
      this.standing.set(tag, held);
    }
  }

  /**
   * Write a channel entry. The entry is the receipt; the state is the thing (§9.4).
   *
   * <b>A re-stated course or flag appears normally</b> — not suppressed, not marked as a
   * catch-up. The entry says *this is the course you are on*, which is true whenever it
   * arrives, so a boat that reconnected twice honestly saw it told three times. Suppression
   * would need the channel to know which entries are news, which is a second concept to get
   * wrong for the sake of a tidier log.
   *
   * <b>The same envelope arriving twice is one entry</b>, though, and that is what `id` is for:
   * the channel's catch-up re-sends the original envelopes, ids and all.
   */
  entry(message) {
    if (this.seen.has(message.id)) return;
    this.seen.add(message.id);
    this.channel.push({
      id: message.id,
      type: message.type,
      at: message.at,
      from: message.body?.from ?? (message.type === 'say' ? 'committee' : 'race committee'),
      text: message.body?.text ?? '',
      tags: message.tags ?? [],
      needsAck: MUST_SEE.has(message.type),
      safety: CANNED.safety.some((what) => (message.body?.text ?? '').startsWith(what)),
    });
  }

  /* ======================================================================== what it says */

  envelope(type, body, tags = []) {
    return {
      v: 1,
      type,
      id: `c${(this.counter = (this.counter ?? 0) + 1).toString(16)}${Date.now().toString(36)}`,
      // The SENDER's own clock, and nothing is derived from it (§4).
      at: new Date().toISOString(),
      tags,
      body,
    };
  }

  queue(message) {
    this.out.push(message);
    return message;
  }

  /**
   * A fix, at the rate the server asked for — not at the receiver's.
   *
   * <b>And none at all when `fixSeconds` is absent</b>, which is how a join with no race behind
   * it is told there is no fleet to report to (§8.2). On a phone in a bracket for four hours
   * that is battery and data spent on nobody.
   */
  report(fix) {
    if (!this.session || !this.fixSeconds) return false;
    const now = Date.now();
    if (now - this.lastFixAt < this.fixSeconds * 1000) return false;
    this.lastFixAt = now;
    this.queue(this.envelope('fix', {
      session: this.session,
      position: { latitude: fix.latitude, longitude: fix.longitude },
      cogDeg: fix.cogDeg ?? null,
      sogKn: fix.sogKn ?? null,
      revision: this.revision ?? null,
      at: new Date(fix.time ?? now).toISOString(),
    }));
    return true;
  }

  /** One latch. Advisory — the record is the artefact (§8.3). */
  crossing(latched, { step, lap, letter, finish, revision, confirmFixes } = {}) {
    if (!this.session) return false;
    this.queue(this.envelope('crossing', {
      session: this.session,
      line: latched.line,
      step: step ?? null,
      lap: lap ?? 1,
      letter: letter ?? null,
      instant: new Date(latched.time).toISOString(),
      revision: revision ?? this.revision ?? null,
      confirmedFixes: confirmFixes ?? null,
      finish: !!finish,
    }));
    return true;
  }

  say(text) {
    if (!this.session || !text || !text.trim()) return false;
    this.queue(this.envelope('say', { session: this.session, text: text.trim() }));
    return true;
  }

  retire(reason) {
    if (!this.session) return false;
    this.queue(this.envelope('retire', { session: this.session, reason: reason ?? 'retired' }));
    return true;
  }

  /** The artefact, at the end. The same shape the REST endpoint takes, because it is the same. */
  record(record) {
    if (!this.session) return false;
    this.queue(this.envelope('record', { session: this.session, record }));
    return true;
  }

  /**
   * Acknowledge, by envelope id, whatever the type (§9.4).
   *
   * <b>Dismissing the alert IS the acknowledgement</b> — one gesture, not two — so this is what
   * the modal's button calls, and the channel's unseen badge and the committee's coverage column
   * are the same fact read from two ends.
   */
  ack(id, what = null, notify = true) {
    if (!this.session || !id || this.acked.has(id)) return false;
    this.acked.add(id);
    this.queue(this.envelope('ack', { session: this.session, ackOf: id, what }));
    // Not notified from inside a render, for the same reason `markRead` is not: `changed()` is
    // a request to render, and a render is what called this.
    if (notify) this.changed();
    return true;
  }

  /** Ask for the channel after the last entry held — the one thing that IS replayed (§4.1). */
  catchUp() {
    if (!this.session) return false;
    const last = this.channel[this.channel.length - 1];
    this.queue(this.envelope('channel.since', { session: this.session, after: last?.id ?? null }));
    return true;
  }

  /* ============================================================== what the screens read */

  /**
   * The state a division's start is in, run on this boat's own clock (§8.5).
   *
   * Every party runs the same machine over the same events and arrives at the same answer,
   * which is what makes this safe to compute here rather than be told: nobody has to be
   * informed what state a division is in, because it follows from what has been published.
   */
  state(now = Date.now()) {
    const held = this.held();
    if (!held) return 'none';
    if (held.flag?.body?.flag === 'abandoned') return 'abandoned';
    if (held.flag?.body?.flag === 'postponed') return 'postponed';
    const start = this.startAt();
    if (start == null) return 'none';
    return now >= start ? 'racing' : 'scheduled';
  }

  /** The standing for this boat: its own division's, else the untagged one. */
  held() {
    for (const tag of this.tags) {
      if (this.standing.has(tag)) return this.standing.get(tag);
    }
    return this.standing.get('') ?? null;
  }

  startAt() {
    const held = this.held();
    const at = held?.timer?.body?.startAt ?? held?.window?.body?.opensAt ?? null;
    if (!at) return null;
    const parsed = Date.parse(at);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /**
   * Seconds to the start, negative once it has gone. Null when there is no start to count to.
   *
   * THE COUNTDOWN IS THE BOAT'S OWN. The server sent an instant and two durations and does not
   * tick, so this is the clock — and being the boat's own clock costs nothing that matters,
   * because what a race is decided on is a difference between two readings of one clock.
   */
  countdown(now = Date.now()) {
    const start = this.startAt();
    return start == null ? null : Math.round((start - now) / 1000);
  }

  /** The current course revision the committee says this boat is on, if it has said. */
  courseRevision() {
    return this.held()?.course?.body?.revision ?? null;
  }

  /** Is there a channel at all? A screen with nothing behind it is not offered (§8.2). */
  get live() {
    return !!this.session && !!this.race;
  }

  get unread() {
    return Math.max(0, this.channel.length - this.read);
  }

  /**
   * The channel has been looked at.
   *
   * <b>Which acknowledges what was said</b>, because for a message *dismissal* means having read
   * it — there is nothing else to do about one. A flag and a course change are different: they
   * are acknowledged by dismissing the modal they raised, which is a deliberate gesture about a
   * thing that changed what the boat is doing.
   */
  markRead(notify = true) {
    /*
     * NOTHING TO DO IS NOT A CHANGE, and saying otherwise here was an infinite loop.
     *
     * The device calls this from `render`, because being on the channel screen is what reading
     * it means — and `changed()` is what asks the device to render. So an unconditional notify
     * is render → markRead → changed → render, for ever. Found by `drive-alert.mjs` as a stack
     * overflow the moment a boat looked at its channel, which is a thing every boat does.
     *
     * Two guards rather than one, because either alone is a trap: this method reports whether
     * it did anything, and the device passes `notify = false` since it is already rendering.
     */
    const unread = this.read !== this.channel.length;
    const unacked = this.channel.filter((entry) =>
      entry.type === 'say' && entry.needsAck && !this.acked.has(entry.id));
    if (!unread && !unacked.length) return false;
    this.read = this.channel.length;
    for (const entry of unacked) this.ack(entry.id, 'say', false);
    if (notify) this.changed();
    return true;
  }

  /** The newest entry, which is what Auto's one new clause is about (§9.5). */
  get latest() {
    return this.channel[this.channel.length - 1] ?? null;
  }

  /**
   * The thing that must be acknowledged and has not been.
   *
   * The device decides whether it opens as a modal or waits as a banner — NOTHING INTERRUPTS AN
   * APPROACH (§9.3) — so this only says what is outstanding, not what to do about it.
   */
  get alert() {
    for (let i = this.channel.length - 1; i >= 0; i--) {
      const entry = this.channel[i];
      if (INTERRUPTS.has(entry.type) && !this.acked.has(entry.id)) return entry;
    }
    return null;
  }

  /** How long since anything got through, for the screens that have to say so (§3.1). */
  quietMs(now = Date.now()) {
    return this.lastExchange == null ? null : now - this.lastExchange;
  }

  get quiet() {
    const since = this.quietMs();
    return since != null && since > QUIET_MS;
  }

  changed() {
    this.onChange?.(this);
  }
}

/**
 * THE CORRECTED-TIME LADDER — brief §3's Live place, from what the fleet said about itself.
 *
 * <b>It is a view, not an authority.</b> Nothing here is scored: a place on this ladder is
 * arithmetic over what boats reported about themselves (§1.1), and the club's software is what
 * turns a time into a result. Which is also why it can be wrong in the ordinary way a screen is
 * wrong — a boat whose fixes stopped ages last — without anything being at stake.
 *
 * Corrected time is elapsed × TCF where a TCF is known, which is the one handicap arithmetic
 * this system does. That is not the open question: turning a TCF into a DISTANCE is (CLAUDE.md
 * open question 5), and nothing here does that.
 */
export function ladder(fleet, { tags = null, now = Date.now() } = {}) {
  const rows = (fleet ?? [])
    .filter((boat) => !tags || !tags.length || (boat.tags ?? []).some((t) => tags.includes(t)))
    .map((boat) => {
      const elapsedMs = boat.elapsedMs ?? null;
      const tcf = typeof boat.tcf === 'number' && boat.tcf > 0 ? boat.tcf : null;
      return {
        ...boat,
        elapsedMs,
        correctedMs: elapsedMs != null && tcf != null ? Math.round(elapsedMs * tcf) : null,
        ageMs: boat.at ? Math.max(0, now - Date.parse(boat.at)) : null,
      };
    });

  // Ordered by what there is: a boat that has finished beats one still going, further round
  // beats less far round, and among boats level on marks the corrected time decides. Nothing
  // here invents a position for a boat that has said nothing.
  rows.sort((a, b) => {
    const done = (r) => (r.finishedAt ? 0 : 1);
    if (done(a) !== done(b)) return done(a) - done(b);
    const at = (r) => (r.step ?? -1) + (r.lap ?? 1) * 1000;
    if (at(a) !== at(b)) return at(b) - at(a);
    const time = (r) => r.correctedMs ?? r.elapsedMs ?? Number.MAX_SAFE_INTEGER;
    return time(a) - time(b);
  });
  rows.forEach((row, i) => { row.place = i + 1; });
  return rows;
}
