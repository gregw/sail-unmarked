# The client–server dialog

**What a boat and the server say to each other, and the rules that keep them able to say it
after they have drifted apart in version.** Code cites this document by section (`§8.2`); the
numbers are stable.

The conversation is the **optional half** of the application. Nothing in it is on the path from
a fix to a latch — the boat detects and times its own crossings with no network
([crossing-detection.md](crossing-detection.md)) — so every part of what follows is allowed to be
absent, and a boat sails regardless. What it adds, where a club is running a race, is the
committee's side: starts, flags, course changes, a channel, a fleet feed.

`dialog.js` is the boat's half, `Dialog.java` and `DialogServlet.java` the server's, and
`client/www/schemas/*.v1.json` is shared between them. §14 lists the files, the tests and what is
not built.

**What is settled, and where to find it**

| | |
|---|---|
| **The boat is trusted entirely** — every position and instant comes from it, and nothing checks | §1.1 |
| A clock offset cancels in an elapsed time, so the trust model costs less than it looks | §1.1 |
| The server will not call OCS, or infer any outcome | §1.1, §8.6 |
| The server keeps **no clock**: it publishes an instant, the boat runs the timer | §1.2, §8.4 |
| For the formats that need one, the server acts **in part** as the race committee — never scoring, never recording | §2 |
| One conversation on any pipe; polling is the pipe built | §3 |
| Everything live is allowed to be absent; the boat sails regardless | §3.1 |
| Order comes from the transport; **no ordinal**, and reconnection re-states rather than replays | §4, §4.1 |
| Fields are only added, unknowns ignored, a break is a new `type` or `v` — for clients that are *installed* | §5 |
| Divisions are **tags**: `division:<id>`, derived from the race's division map | §6 |
| Sail number, name and a session — **not** authentication | §7 |
| **Authenticate authority, trust data**: a login for officers, nothing for boats | §7.1 |
| `rejected` carries a code AND a sentence; an unknown code falls back to the sentence | §8.1 |
| **A join with no race behind it gets no channel** — and no fixes, fleet, timers or flags | §8.2 |
| `fleet` goes out on a fixed slow interval, not at the fix rate | §8.4 |
| One start per division, no rolling sequence; AP suspends, re-publishing clears it | §8.4, §8.5 |
| The channel belongs to its race; a re-stated course or flag is an ordinary channel entry | §8.4, §4.1 |
| Retire is the sailor's word, DNF is the committee's; neither is inferred | §8.6 |
| The screens a boat needs, and that **nothing interrupts an approach** | §9 |
| Course changes and flags are **channel entries but not chat messages** — state, not events | §9.4 |
| JSON Schema, both sides, in a subset a small validator covers | §10 |
| The record names the course the boat finished under; withdrawing a course never reaches the water | §11 |
| Defining a race is a `Races` tab; **running** one is a separate page with no GO button | §12 |
| A race knows its **next** race, which is why *regatta* is not a word here | §12.6 |
| **Defences against bad actors are deferred, in writing** | §13 |

---

## 1. What is trusted, and what does not move

### 1.1 THE BOAT IS TRUSTED ENTIRELY

**Every position and every instant in this system comes from the boat, and nothing anywhere
checks whether the boat told the truth.** That is the shape of the thing, and it should be said
plainly to anybody who builds on it or races under it:

- **Where a boat says it was, it was.** The server has no independent position for any boat.
- **When a boat says it crossed, it crossed.** The instant is the boat's, interpolated from the
  boat's own fixes, stamped by the boat's own clock.
- **Nothing here detects a dishonest sailor.** The quality-control gates — satellite count,
  stated accuracy, the kinematic budget, the relocation watch — defend against a *bad receiver*,
  which is a device reporting badly in good faith. None of them is evidence about a person, and
  none of them should ever be described as if it were.

What that buys is the thing the whole architecture rests on: a boat needs nobody's permission
and nobody's network to sail a course and know what it did. What it costs is that this system
produces **records, not verdicts**. A club that needs more than a boat's word for it has the
ordinary remedies — a mark boat, a finish line, witnesses — and this system is not a substitute
for any of them.

**A CLOCK OFFSET CANCELS IN AN ELAPSED TIME, and that is why this is not the concession it looks
like.** Elapsed time is the difference between two instants taken from the *same* clock, so a
boat whose clock is a minute fast starts a minute late and finishes a minute late and its elapsed
time is right to the millisecond. Two boats whose clocks disagree by a minute still produce
elapsed times that can be compared with each other directly. Drift *within* one race — a rate
error rather than an offset — is what would not cancel, and on any device carrying GNSS it is far
too small to matter.

So the quantity racing is usually decided on survives the trust model intact. What does *not*
survive it is comparison in **absolute** time: against a gun, or between two boats' instants at
the same mark. Anything that needs those needs boats whose clocks agree, and this system does not
provide that and does not check it.

**And there is no clock-skew warning, deliberately.** The client could compare its clock against
the fix stream and warn. Phones discipline their clocks from the network, the elapsed time is
right regardless of the offset, and a warning about a thing that does not affect the number a
sailor is racing on is screen space spent on a problem they do not have. If absolute comparison
ever matters here, the honest fix is to take instants from the fix rather than from the device
clock.

**The server will not call OCS, or anything like it.** It holds the start time it published and
the instant a boat reported crossing, so it could do the arithmetic — and it does not. **A boat
that says it started fairly is recorded as having started fairly.** Deciding otherwise is a
judgement about a competitor: it belongs to the club's people and the club's software, with
whatever they saw from the committee boat, and never to something whose only evidence is the
competitor's own report.

### 1.2 The server collates and redistributes; it does not measure

**A boat's own rounding and timing are computed entirely on the device and never wait on a
server.** Nothing in this document changes that, and any message that would is wrong by
construction:

- The **device** decides whether a line was crossed, which way, and at what instant. The server
  is told; it does not adjudicate, and it never sends a crossing to a boat.
- **The server keeps no clock of its own for racing.** It publishes an absolute start time and
  that is all; every countdown, every elapsed time and every crossing instant is run and stamped
  by the boat. There is no official time here to disagree with.
- A boat that has been handed a course can sail the whole of it with the server switched off.
  Everything here is an *addition* to that, and every part of it is allowed to be absent.
- The server does not **score**. Places, OCS, corrected times, penalties, drop races and series
  results stay with the club's software, which already has rules for all of them.

## 2. The server as a part-time race committee

**For the formats that need one, the server acts in part as the race committee** — start
sequences, postponement and abandonment, divisions, and a live fleet feed. *In part*, and *for
the formats that need it*: plenty of formats have no committee at all, and a boat sailing a
published course on its own afternoon needs none of this.

**What the server never takes over is the recording.** It does not time a boat and it does not
decide that a line was crossed — see §1. A committee that fires a gun is still a committee that
does not know when you crossed.

**It publishes an instant; the boat runs the timer.** A start time is an absolute instant on the
wire — `2026-09-17T13:05:00Z`, and nothing else. The countdown a sailor watches is their own
device counting towards it, and their elapsed time still runs from their own crossing of the
start line, because that is the instant they can defend. A club scoring from a gun scores from
its own gun and this record's crossing times; the two are never reconciled here.

---

## 3. Transport

**One conversation, whatever the pipe.** The design is a WebSocket carrying both directions,
degrading to polling where a socket cannot be had — a captive portal, a proxy that eats upgrades,
a platform that suspends sockets in the background. **Polling is what is built**, and it carries
exactly the envelopes, schemas and ordering rules a socket would:

| | Polling (built) | WebSocket (not built) |
|---|---|---|
| Before a session | `POST /api/dialog` with `hello` and `join` | frames on the socket |
| Client → server | `POST /api/dialog/{session}` with an array of envelopes | frames on the socket |
| Server → client | the same POST's response carries whatever is queued | frames on the socket |
| Idle | the client polls at the interval `hello.ok` gave it | server pings |

`Dialog.exchange(session, envelopes)` is the whole contract, written so a socket could use it
unchanged: a frame is an exchange of one message with an empty reply, a poll is an exchange of
several with whatever is queued. A protocol with two dialects has two sets of bugs. What a socket
would need beyond this is a ticker, because `fleet` is enqueued when a boat polls.

### 3.1 When the channel is gone

| What stops | What still works |
|---|---|
| Fleet feed, messages, timers, flags, course updates | Crossing detection, latching, interpolated timing, the Mark screen, the course overview, the race clock |
| Live standings — the Place screen ages and says so (§9.1) | The channel keeps what it had, and queues what the boat says |
| Alerts, because none can arrive | The current flag and the current course, which the client holds (§9.4) |

The boat **queues what it was going to say** — crossings, its record, its messages — and sends
them on reconnection, oldest first. Fixes are the exception: a fix is a statement about *now*, so
only the most recent is kept. A poll that throws sets the dialog's `connected` false; it never
propagates into the client that is sailing.

**The screen says which state it is in.** A boat whose channel is down is not told everything is
fine; the same rule the receiver's own staleness follows.

---

## 4. The envelope

Every message, in both directions:

```json
{
  "v": 1,
  "type": "crossing",
  "id": "b7f3c1a2",
  "at": "2026-09-17T08:31:12.250Z",
  "tags": ["division:1"],
  "body": { }
}
```

| Field | Meaning |
|---|---|
| `v` | protocol major version this message is framed in |
| `type` | what the message is; the whole of what decides how `body` is read |
| `id` | unique to the sender; what an acknowledgement names, and what makes a resend idempotent |
| `at` | when the SENDER says it sent it, ISO-8601 with a timezone |
| `tags` | zero or more labels; see §6 |
| `body` | the message's own fields, schema'd per `type` |

**Order comes from the transport, and there is nothing else to it.** A socket delivers in the
order things were sent and a polled batch is a list; that is all the ordering this protocol needs.
State is then simply the events applied as they arrive: a start is published, an `AP` voids it,
a new start replaces the `AP`. Every party — the server (`Dialog.Standing`), the race screen and
every boat (`dialog.js` `state()`) — runs the same little state machine over the same sequence
and arrives at the same answer.

**There is no ordinal.** A monotonic `seq` would make "which of these came last" decidable
without trusting anybody's clock, and would seem to be needed for telling a boat what it missed
and for recognising a resend. It is not: §4.1 answers reconnection by re-stating state rather
than replaying events, the envelope's `id` already makes a resend recognisable, and within one
connection the transport has done the ordering.

### 4.1 Reconnection RE-STATES, it does not replay

A boat that was away for two minutes does not want the two minutes. It wants **what is true
now** — which course it is sailing, whether its division is postponed, when it starts, whether the
race has been abandoned. So on join the server **re-states the current standing** of every tag the
boat belongs to, as ordinary `course`, `timer` and `flag` messages (`Room.restate`).

**The channel is the exception, because a channel IS a history.** What was said cannot be
summarised into a current value, so a boat coming back after a gap sends `channel.since` naming
the last entry it holds and gets **the original envelopes, ids and all**, which is what makes the
catch-up idempotent (`dialog.js` keeps a `seen` set). That is a log being caught up, not state
being rebuilt.

**A re-stated course or flag writes an ordinary channel entry**, like any other. It is not
suppressed and not marked as a catch-up: the entry says *this is the course you are on* and that
is true whenever it arrives. Suppression would need the channel to know which entries are news,
which is a second concept to get wrong for the sake of a tidier log.

**There is no "clear the AP" message and there must not be.** Publishing a start is what clears
it; `dialog-test.js` asserts that as behaviour.

**Fixes are never replayed**, in either direction. A fix is a statement about *now*; a stale one
is not a smaller truth, it is a wrong one.

**`at` is when the sender says it sent this, and nothing is derived from it.** A crossing carries
its own instant in the body, taken from the fixes that produced it — that is the number that
matters, and §1.1 says where it comes from. `at` is for ordering a queue that arrived late and
for de-duplicating a resend.

---

## 5. Versioning, for clients that are installed rather than downloaded

**A boat's client and the server will be different versions on the same afternoon.** A phone in
a bracket is not refreshed between races, and a boat that has to update before it can race is a
boat that does not race. So the wire format is governed by rules rather than by goodwill:

1. **Fields are only ever added.** Never removed, never renamed, never repurposed. A field that
   is wrong keeps its meaning and is joined by a better one.
2. **Unknown fields are ignored**, on both sides — the rule the YAML and JSON file formats
   already follow, for the same reason.
3. **Unknown message types are ignored, and counted**, on both sides. An old client meeting a new
   message must carry on, not close the connection; refusing would make every future message type
   a breaking change for every server already deployed.
4. **A breaking change is a new `type` or a new `v`**, never a quiet change to an existing one.
   The server speaks every `v` it has ever shipped until nothing in the fleet speaks the old one;
   retiring a version is an operational decision, not a release note.
5. **`additionalProperties` is never written, so it is always `true`.** That is rule 2 written
   where a validator can enforce it, and it is why validation cannot be strict about what it has
   not heard of.

### 5.1 The handshake

The client opens with `hello`, naming every `v` it can speak. The server replies `hello.ok` with
the one it chose and the polling interval. **The client proposes, the server disposes** — the
server knows what the fleet is running, the client knows only itself. A client whose versions the
server cannot meet gets `rejected` with a reason it can show somebody.

---

## 6. Tags

- `tags` is an array of `namespace:value` strings.
- **A division is a tag**: `division:<id>`, where `<id>` is the key of the race's division map in
  the series file. `Race.tagFor` is the one place that spells it; the map key is the plain id
  because a colon in a YAML key breaks the file.
- `fleet:a`, `class:etchells` and whatever else a club needs would be the same mechanism.
- **A message with no tags is for everybody.** A message with tags is for boats carrying at least
  one of them (`Envelope.addressedTo`). An untagged *state* message becomes every division's state.
- The server does not validate tag values. It groups by them; it does not know what they mean.

---

## 7. Identity and sessions

A boat is identified by **sail number and name**, and by a **session** the server issues when it
joins. Later messages carry the session — in the path and in the body — so a boat can be
recognised across a reconnection. The `boatId` is the sail number, or the session id where no
sail number was given.

### 7.1 Officers are authenticated. Boats are not, and never will be

**OpenID Connect for race officers — the setup sail-jinx has — and no authentication at all for
boats.** The asymmetry is the point, and it follows from §1.1 rather than from expedience:

- **Authenticating a boat would only tell you which device made a claim you were going to believe
  anyway.** A boat's positions and instants are trusted by design; a login would add a name to an
  unverifiable statement and change nothing about whether to accept it.
- **An officer's actions carry authority.** Publishing a course, scheduling a start, abandoning a
  race: those are decisions imposed on a fleet, and the question *who did this* has a real answer
  that matters. That is where a login earns its keep.

So the rule is **authenticate authority, trust data** — built, and described in
[`deployment.md`](deployment.md). The whole of `/api/dialog` stays open.

> **Two risks this leaves, and neither is covered by §1.1.** That section says a boat is trusted
> *about itself*; it says nothing about a third party lying *about* a boat.
>
> - **Impersonation.** Any device can claim any sail number and put a false position, or a false
>   crossing, on the fleet feed. The session issued at join means a sustained impersonation has to
>   hold a session rather than fire one message, which is a speed bump and not a defence.
> - **The open channel.** Anyone who can reach the server can broadcast to the fleet.
>
> Both are attacks by a person, and the instrument against a person is a person: see §8.4 and §13.

**How a boat is sailing is not the conversation's business.** Practice, race or record attempt
(`JoinMode`) is chosen on the join screen and carried on the record, where it decides who sees
it (see [course-model.md](course-model.md#three-ways-to-sail)). What decides what the conversation
offers is whether there is a **race** behind the join (§8.2).

---

## 8. The message catalogue

Direction is **C→S** (client to server) or **S→C**. The schemas are the exact bodies.

### 8.1 Session and data

| `type` | Dir | Body | Notes |
|---|---|---|---|
| `hello` | C→S | `versions[]`, `client` (name, build) | opens the conversation |
| `hello.ok` | S→C | `v`, `poll` (ms), `features[]` | no time in it: the server is not a clock to set yours by |
| `rejected` | S→C | `code`, `text` | any refusal, including version and schema |

**`rejected` carries BOTH a code and a sentence.** The `code` is what a client branches on —
`version`, `course`, `variant`, `unpublished`, `handicap`, `start`, `schema`, `record`, `internal`; the `text` is what a
sailor reads. Neither is sufficient alone: a code cannot be shown to somebody and a sentence cannot
be acted on. **An unknown code falls back to the text**, which the versioning rules require anyway.

Queries for clubs, series, races, courses and variants stay on the **REST endpoints**
(`/api/public`, `/api/races/...`, `/api/courses/{revision}`). They are cacheable, they work before
there is a session, and putting them on the conversation would buy nothing.

### 8.2 Joining

| `type` | Dir | Body | Notes |
|---|---|---|---|
| `join` | C→S | `sailNo`, `name`, `club`, `series`, `course`, `variant`, `race`, `division`, `tcf`, `lengthM`, `revision`, `answers{}` | `race` and `division` where the sailor named them |
| `joined` | S→C | `session`, `boatId`, `race`, `raceName`, `tags[]`, `fixSeconds`, `revision`, `course` or `waiting`, `reason` | the parameters the client is to run on |
| `ask` | S→C | `questions[]` | **not built** — every join answers itself |
| `leave` | C→S | `session`, `reason` | |
| `left` | S→C | `session` | |

**A boat joins a race where there is one.** The join screen asks club → series → race →
division, and the course follows from the division rather than being picked again: a boat does
not choose the geometry it was entered for. Where the join names no race — *no race, just sail a
course*, or an older client — the server finds one: whichever race today maps a division to that
course and variant. Finding works only while one division sails one course; a join that names its
division never relies on it, and a division name that is not in the race is ignored rather than
obeyed.

**`joined` carries the course, not a reference to it** — the whole published snapshot. A boat that
has to fetch before it can sail is a boat that cannot join on a flaky connection. It hands over
what was **published**, never what the editor currently holds, and a course with nothing published
cannot be joined on its own.

**A public race is joined before its course is published.** The committee opens the race and sets
the course once it has seen the wind, and the boats are entered meanwhile, whether or not the course
is public. Such a `joined` carries `waiting` instead of `course`: a sentence, and the `startLine` as
the course's first line stands in the programme now — somewhere to wait, not geometry to sail. The
boat shows a zone around it (`waitingPanel`) and the race's start row. When the club publishes, every
boat waiting in that division is sent a `course` message carrying the whole snapshot
(`Dialog.coursePublished`), and begins on it as it would have on a `joined` that carried one. A
handicapped course's TCF range is not checked for a boat that joined waiting.

**A course handicapped by distance needs the boat's TCF**, because the TCF places the boat's own
line at each handicapped step. A join with no TCF, or one outside the snapshot's `tcfMin` to
`tcfMax`, is `rejected` with code `handicap` and a sentence giving the range; the REST join takes
`?tcf=` and refuses the same way, with a 409, so a device does not fall back from one refusal to
the other. With the snapshot in hand the boat places its lines itself (`handicap.js`) — see
[course-model.md](course-model.md#distance-corrected-handicap-each-boats-own-line). The fleet
feed's `distanceCorrected` says a boat's elapsed time is already its corrected time.

**`joined` also arrives unasked**, when a boat that has stopped racing is entered for the next race
of the day (§12.6). Same message, same fields.

**If there is no conversation to be had at all, the boat sails anyway.** The device falls back to
`POST /api/join/{club}/{series}/{course}?variant=…&tcf=…`, which hands over the published snapshot and
nothing else, and says on screen that it is sailing with no race behind it.

#### A JOIN WITH NO RACE BEHIND IT GETS NO CHANNEL, AND NOTHING ELSE LIVE

A course can be joined without there being a race on it — a boat practising, or making a record
attempt. **There is then nobody to communicate with, so there is no channel**: no messages, no
backlog, and nothing to acknowledge. The rest follows without a second decision:

| | REST join (no dialog) | Join a course | Join a race |
|---|---|---|---|
| Session | none | yes | yes |
| Where the course comes from | REST | `joined` | `joined` |
| `crossing` | — | yes | yes |
| `record` | `POST /api/records` | yes | yes |
| `fix` | — | — | yes |
| `fleet` | — | — | yes |
| **Channel** | — | **—** | yes |
| `timer`, `window`, `flag` | — | — | yes |
| Chat and Place screens | not offered | **not offered** | offered |

**Fixes stop too.** A fix exists to feed a fleet screen; with no fleet there is no consumer, so
`fixSeconds` is absent from `joined` and the boat reports none. On a phone in a bracket for four
hours that is battery and data spent on nobody.

**A screen with nothing behind it is not offered.** Chat and Place are absent from the view
selector rather than present and empty. An empty Chat would say *nobody has spoken yet*, where the
truth is *there is nobody*.

### 8.3 What the boat reports

| `type` | Dir | Body | Notes |
|---|---|---|---|
| `fix` | C→S | `session`, `position{latitude,longitude}`, `cogDeg`, `sogKn`, `revision`, `at` | every `fixSeconds` (2 s), not at the receiver's rate; accepted fixes only; taken on trust (§1.1) |
| `crossing` | C→S | `session`, `line`, `step`, `lap`, `letter`, `instant`, `revision`, `confirmedFixes`, `finish` | one per latch; the instant is the interpolated one |
| `record` | C→S | `session`, `record` (a whole `CourseRecord`) | sent the moment the course completes |
| `retire` | C→S | `session`, `reason` | the sailor has stopped racing (§8.6) |

**A live crossing is advisory and the record is definitive.** The live message is what makes a
fleet screen possible during the race; it can be lost. The record is the artefact — the one thing
that leaves this system, and the only one a protest could be argued from.

**The server stamps the record with the session's race and division** before filing it
(`CourseRecord.enteredIn`). Everything else in a record is the boat's own account of itself and is
trusted as such — but which race a boat is in is an entry the committee accepted, so it is the
server's to say. Reading it off the boat's message would let a boat put itself in a results table
nobody can check. (A record posted over REST has no session to stamp it from; see §14.)

**Fixes carry the revision the boat believes it is sailing.** A fleet screen drawing two boats on
two geometries needs to know which is which.

### 8.4 What the server sends

| `type` | Dir | Body | Ack? |
|---|---|---|---|
| `fleet` | S→C | `race`, `boats[]` — `boatId`, `sailNo`, `name`, `tags[]`, `position`, `cogDeg`, `sogKn`, `revision`, `step`, `lap`, `startedAt`, `finishedAt`, `elapsedMs`, `tcf`, `outcome`, `at` | no |
| `course` | S→C | `revision`, `course` (the whole snapshot), `reason`, **`text`** | **yes** |
| `timer` | S→C | `kind`, `startAt` (absolute), `closesAt`, `openSeconds`, `warningSeconds`, `startSeconds`, `timeLimitSeconds`, `flags[]`, **`text`** | no |
| `window` | S→C | `opensAt`, `closesAt`, **`text`** — superseded by a `timer` of kind `open`; still read | no |
| `flag` | S→C | `flag` (`postponed` \| `abandoned` \| …), `reason`, **`text`** | **yes** |
| `say` | S→C | `from`, `text` | **yes, by being read** |
| `say` | C→S | `session`, `text` | relayed to all |
| `ack` | C→S | `session`, `ackOf` (the `id` acknowledged), `what` | |
| `outcome` | S→C | `boatId`, `outcome`, `reason`, `text` | **yes** |
| `channel.since` | C→S | `session`, `after` (an envelope `id`) | answered with the original envelopes |

**Everything the server sends may be tagged.** A timer for one division, a flag for another, a
message for everybody: the same mechanism each time.

**`fleet` goes out on a FIXED slow interval, not at the fix rate** — `FLEET_SECONDS`, five. At nine
knots a boat moves twenty-three metres in five seconds, which on a screen showing a whole course is
nothing; sixty boats at 1 Hz would be sixty fan-outs a second to say what a fleet screen cannot draw
the difference of. One message carries every boat, so the cost is per boat rather than per pair.

**`timer` is a division's start: how it starts, when, and for how long its line is open.** Every
start line is OPEN for a period and a crossing counts only while it is — a boat over early sees
nothing register and comes back (OCS). How the race starts is the race's (`startType` in the
definition, every division alike) and says what else goes with it:

| `kind` | The line is open | Elapsed runs from | The boat is shown |
|---|---|---|---|
| `scratch` | from `startAt` for `openSeconds` (600 unless said) | `startAt`, however late the boat crossed | a countdown to the start |
| `open` | from `startAt` to `closesAt` | the boat's own crossing | when the line opens, for how long, then when it closes |
| `allocated` | from this boat's own start time for `openSeconds` | that time | a countdown to its own start |

An allocated start has no common `startAt`: each boat gives its own time when it joins
(`allocatedStart` on `join`), between the division's `firstStartAt` and `lastStartAt`; a join with no
time, or one outside them, is `rejected` with code `start`. `warningSeconds` and `startSeconds` say when the warning and
preparatory signals fall before the line opens, in every kind; `timeLimitSeconds` is the division's
time limit from the instant a boat's elapsed runs from, after which its finish is closed to it.
**Every countdown is run by the boat**, against the boat's own clock — the server sends this once
and does not tick.

**A start time should not be changed inside the warning period**, and that is a discipline on
whoever is running the race rather than a rule the server can enforce: every boat is counting on its
own clock, so a late change reaches different boats at different points in their own sequences.

**ONE START PER DIVISION, AND NO ROLLING SEQUENCE.** Each division has either a `timer` — an
absolute start — or a `window`, and they are entirely independent of one another. A real race
committee's postponement of one start delays the next; here it does not, deliberately:

- **AP suspends, it does not reschedule.** A `flag` of `postponed`, tagged to a division, voids that
  division's start. It does not say when the new one will be, because *there is no "now"* on this
  server to count five minutes from.
- **Re-publishing the start is what clears the AP.** A `timer` (or `window`) is the whole of a
  division's start state: publishing one supersedes both the previous start and any postponement on
  that tag. So the cycle is *publish → AP → edit → publish*, and the last message to arrive for
  that tag is the state.
- **Five divisions is that done five times.** No cascade to compute and none to get wrong.

**Messages are an open channel and are relayed to everybody.** No private conversations, by
design — it is a radio, and everybody hears it. A boat joining is sent the backlog for **that race**
and no more: the channel belongs to the race it happened in, and is kept with that race's conduct
record (§12.5). A boat auto-joined to the next race starts that race's channel clean. A message is
**truncated** at `Dialog.MAX_SAY` (400) characters rather than refused: a sailor's message that is
too long should arrive clipped, not be thrown away.

> **THE CHANNEL HAS NO AUTOMATIC RATE LIMIT, AND THE COMMITTEE IS THE LIMIT.** Boats are never
> authenticated, so there is no identity to throttle; a rate cap would fall on a sail number, which
> anybody can claim. The instrument that suits an attack by a person is a person: **the race screen
> muting a sail number**, writing its own receipt into the channel so the fleet can see it happened.
> Muting is not built (§14).

**`text` is required on every state message** — see §9.4. It is what the channel shows, and it is
what reaches a sailor whose client is too old to act on the rest.

**Acknowledgements exist where "did they see it?" is a real question**: a course change, a flag, an
outcome, and a message from the committee. All four are things a protest could turn on, and all are
acknowledged the same way — by envelope `id`, through `ack`.

### 8.5 The state a division's start is in

Every party runs the same machine over the same events (§4), so nobody has to be told what state a
division is in — it follows from what has been published.

| From | On | To |
|---|---|---|
| — | `timer` or `window` | **scheduled** |
| scheduled | `flag: postponed` | **postponed** |
| postponed | `timer` or `window` | **scheduled** |
| scheduled | the start passing, on each reader's own clock | **racing** |
| racing | `flag: abandoned` | **abandoned** |
| racing | every boat finished, retired or DNF | **finished** |

**AP is the pre-start signal and abandonment is the post-start one** — which is not an extra rule
but what the two flags *mean*. So "you cannot AP a start that has already gone" needs no
enforcement machinery: a race that has started is abandoned, and the race screen offers the one
that applies.

Two rules the race screen holds, both about not publishing something absurd:

- **No `AP` once a start has passed or a window has opened.** After that the honest instrument is
  abandonment.
- **After an `AP`, the next start is at least six minutes ahead** — a minute before the warning
  signal, then the usual five — and the screen says so rather than merely disabling a button.

> **Enforced where the clock is, which is the operator's screen.** Both rules are arithmetic
> against *now*, and the only *now* that matters is the one belonging to the person deciding. What
> the protocol does not carry is any "was this legal" flag: an illegal sequence is prevented, not
> annotated.

### 8.6 Outcomes: retiring, and DNF

| `type` | Dir | Body | Notes |
|---|---|---|---|
| `retire` | C→S | `session`, `reason` | the boat says it has stopped racing |
| `outcome` | S→C | `boatId`, `outcome` (`dnf` \| `dns` \| `racing` \| …), `reason`, `text` | the committee says so |

**The software never infers an outcome; it records one a person entered.** A boat retires because
a sailor pressed *retire*; a boat is DNF because a committee decided and pressed it. Neither is the
software working something out from the data — that is the §1.1 rule again, and it is why an
`outcome` is a message from the committee rather than a conclusion the server reaches when a boat
stops reporting.

This is not scoring (§1.2). *Did this boat complete the course* is collation; *what place did it get
and what does that do to its series* is the club's software.

---

## 9. The screens a boat needs

The boat's own screens are the Mark screen and the course overview
([boat-client.md](boat-client.md)). The conversation adds three things: the start row, the channel,
and race progress — `screens.js`.

### 9.1 Race progress — the Place screen

Fed by `fleet`, it is a ladder: every boat that joined, how far round, its elapsed time, and its
corrected time where a TCF is known (`dialog.js` `ladder`). It stands in for the brief's **Live
place** (brief §5), which draws every boat along the course at the moment its corrected time equals
yours; that picture is not built.

- Filtered by `tags`, so a sailor can see their own division or the whole fleet.
- **It ages rather than blanks, and says how old it is.** Live standings are the one thing boats
  want promptly from the server and therefore the one thing that cannot be had without it; a
  screen that went empty would be saying the fleet had vanished.
- It is a *view*, not an authority. Nothing on it is scored here, and a place on it is arithmetic
  over what boats reported about themselves (§1.1).

### 9.2 The channel — one inbox for everything the boat was told

A scrolling log, newest last, of everything that arrived: committee messages, chat relayed from
other boats, and **the state messages too** — see §9.4.

- Each entry carries who it was from, when, the text, its tags, and whether it has been
  acknowledged. Unacknowledged entries are marked, and the view bar carries an unread count.
- **The backlog on join lands here, in place**, so a boat joining late reads the afternoon in order
  rather than being caught up by a summary.
- Sending takes a text field — and, because typing at a tiller is hostile, the things a sailor
  actually says, in one tap:

  | Racing | **Retiring** · **Protesting** · **OK** |
  |---|---|
  | Safety | **Need assistance** · **Standing by to assist** · **Man overboard** |

  **The safety three are not racing messages and must not look like racing messages.** They are
  here because the channel is the radio and this is what a radio is for when the racing stops
  mattering — so they are set apart, in warn colour with a rule above them.

### 9.3 Alerts, and the one thing that must never be covered

A course change, a flag or an outcome changes what the boat is doing, so it interrupts: a modal
alert, and **dismissing it IS the acknowledgement** the server is waiting for. One gesture, not
two: a dialog offering *Dismiss* beside *Acknowledge* would ask somebody at a tiller to agree they
had read a thing they had just closed.

> **NOTHING INTERRUPTS AN APPROACH.** While the Mark screen has the display — inside the approach
> radius, inside the time, or within the dwell after a latch — an alert does not open. It shows as a
> **banner** on the Mark screen (`alertBanner`), and the modal is raised the moment the approach
> ends. A sailor thirty metres off a line at nine knots is doing the one thing on this boat that
> cannot be interrupted, and a dialog over the plot at that moment is worse than any news it could
> be carrying.
>
> The banner is not a quiet failure: it says what kind of thing arrived and it stays until it is
> read. An abandonment seen twenty seconds late costs nothing; a plot covered at the moment of a
> crossing costs the crossing.

**Acknowledged and INTERRUPTING are two different sets.** `MUST_SEE` is what carries an unseen badge
and gets an `ack` — a course, a flag, an outcome and a committee message. `INTERRUPTS` is the
narrower set that opens a modal: a course, a flag, an outcome. A committee message is acknowledged
by being **read** in the channel, because a radio call that put a dialog over somebody's plot would
make the committee reluctant to use the radio.

### 9.4 Course changes and flags as channel entries: YES to one inbox, NO to one message type

**Yes, they belong in the channel**, in time order, among the chat. One inbox, one acknowledgement
mechanism, one backlog, one unread count — and a boat that joins late reads *postponed at 13:02 ·
course changed at 13:20 · "shortening at the windward mark" at 13:25* as one story. That list is
also precisely what somebody reconstructing the afternoon afterwards wants.

**No, they must not BE chat messages on the wire**, because they are **state, not events**.

- A chat message is an event: it happened, it is in the past, and nothing is derived from it.
- *Postponed* is a condition the race is in. *The course is revision `a1b2c3`* is the course you are
  sailing. If those existed only as entries in a stream, knowing whether the race is on would mean
  replaying the stream and reducing it — and one missed entry would mean the wrong state, silently.
  **"Scroll up to find out whether you are racing" is not a thing to ask of somebody on the water.**

So the client **holds the state explicitly**, set by the message it acted on, and writes a
**receipt** into the channel. The entry is the receipt; the state is the thing. Every state message
therefore carries a required human-readable `text` — what the channel shows, and what reaches a
sailor on an older client — and acknowledgement is by envelope `id`, whatever the type.

### 9.5 Where they sit in the view selector

The view selector is **Course | Line | Chat | Place | Auto**, and it is on every screen, because any
one of them may be the one you want to leave. Chat and Place appear only where there is a channel
(§8.2). `VIEW_MODES` in `raceclient.js` is what may be asked for by name; anything else reads as
`auto`, so a stale value cannot strand somebody.

**Auto has one clause for the channel**: a new channel entry brings up the channel, *unless the
boat is approaching a line*, in which case the Mark screen keeps the display and the entry waits.
The channel arrives as a **hint** (`view(now, {channel})`) rather than as a field, because
`RaceClient` knows about lines and fixes and must not learn what a chat message is. It is offered
once per entry rather than while something is unread, or a boat with an unread message could never
look at its own course.

| Priority | |
|---|---|
| 1 | the **Mark screen**, while approaching or within the dwell |
| 2 | a **new channel entry** |
| 3 | the Mark screen by radius or time, else the course |

**`Place` is never automatic.** It is somewhere you go to look, not something that should arrive —
and it is the screen whose data is most likely to be stale.

**The start is ABOVE every screen** (`startRow`), not on one of them. It is the one thing on the
device that is about a moment rather than a place, and a countdown a sailor has to change screens
to see is a countdown they will miss.

---

## 10. Schemas

**JSON Schema, in the repository, validated by both sides.**

- They live in **`client/www/schemas/`**, which means one copy reaches both: Maven packages
  `client/www` as `/static/`, so `Schemas.java` reads them off the classpath and the client fetches
  them from `/schemas/`. **Two copies of a schema is two schemas.**
- One file per message type per major version (`crossing.v1.json`), each describing that message's
  **body**. The envelope is the one shape every message shares, so it is checked in code rather
  than repeated twenty times.
- **Each side validates what it receives**: the server in `DialogServlet`, refusing a message that
  does not match with a `rejected` of code `schema`; the boat in `dialog.js` `receive`, which drops
  and counts it. A schema file missing from the build is logged at start-up.

> **The client's validator is a deliberate constraint on the schemas, not the other way round.**
> This codebase has no framework, no npm build and no bundler, and the client is offline-first — so
> a full JSON Schema implementation would be a cost paid on every boat. The schemas are held to a
> subset a small hand-written validator covers (`schema.js`, and `Schemas.java` beside it): `type`,
> `properties`, `required`, `enum`, `const`, `items`, `minimum`/`maximum`, `pattern`, and
> `format: date-time`. `additionalProperties` is never written (§5 rule 5), `$ref` is outside the
> subset, and a length is capped by truncating rather than by `maxLength`. A schema that needs more
> than the subset is a message that should be simpler.

---

## 11. Course changes and the record

**The record names the course the boat was sailing when it FINISHED.** Whether that record means
anything is outside this software: a long course shortened where the early legs are common gives a
record that still describes what was sailed, and a course whose leg was extended mid-race gives one
that does not. The software records what happened and does not judge it.

The committee publishes a course change as a `course` message carrying the whole new snapshot; the
boat holds it as its division's state, writes the receipt into its channel, and acknowledges it. A
boat that took it would sail on with its later `crossing` messages carrying the new revision.
**The boat does not yet switch its own geometry** on a `course` message — see §14.

**WITHDRAWING A COURSE DOES NOT REACH THE WATER.** Un-publishing stops new boats joining and does
nothing whatever to boats already sailing: they were handed a snapshot, that snapshot still exists
and is still readable by revision, and they finish on it. Nothing is sent and nothing stops.

> **Stopping a race is `flag: abandoned`, and only that.** A publishing act must not have an effect
> on the water as a side effect — somebody tidying next week's courses on race morning would
> otherwise stop a fleet, and would find out from the fleet. Two verbs, two meanings: *withdraw* is
> about who may join, *abandon* is about who must stop.

---

## 12. The server screens

Separate from the boat's screens because the people are different: this is a club's desk or a
committee boat, on a laptop, with a keyboard. Both are behind the officers' login.

### 12.1 Defining a race is EDITING; running one is not

A race lives in a series, so defining one is the editor's fourth tab —
**`Points | Lines | Courses | Races`** — with the same chart and the same drill-down. A race's
definition is configuration: an id, a name, a date, a format, how it starts, whether it is public,
a `division → course/variant` map, **each division's start** — its time (or opening and closing
times), warning, preparatory and open period — and time limit, and the race it follows. It is
authored ahead of time and it diffs ([course-editor.md](course-editor.md#the-races-tab)).

**The start is the definition's.** While a race is public the server hands each division the start
its definition works out to (`Dialog.definedStart`), as a `timer`, whenever a boat joins and whenever
the definition is saved — only when that start has changed since it was last handed out
(`Dialog.sync`, which keeps it with the conduct). So a delay or an AP from the race screen stands
until somebody edits the race's start in the editor, and then the edit wins.

**Managing a race is a second page, `race.html`, and the reason is the undo.** The editor saves as
you go and holds exactly one undo, which is right for dragging a mark and wrong for raising an
abandonment: there is no undo for telling a fleet to stop. Live conduct wants actions that are
deliberate and confirmed — **an irreversible act asks twice, in the button itself** — and it wants
furniture the editor's pane has no room for: the fleet table, the start states, the channel, the
acknowledgement coverage.

### 12.2 The chart: colour is DIVISION here, and texture is progress

**In the editor, colour means leg role** — green leaves a lap, red arrives at one, blue between
(`ROLE_COLOUR`). **On the race screen, colour means division** (`DIVISION_COLOURS`, which shares no
value with `ROLE_COLOUR`). The two never share a chart; what there must not be is a third meaning
for colour anywhere.

Progress is carried by **texture within a division's own colour**, because the question the
committee is actually asking is *which legs have been sailed*:

| A leg that | drawn |
|---|---|
| **some** boats have sailed | **solid**, full weight — this is where the fleet is |
| **no** boat has yet sailed | the same colour, **dashed** — still to come |
| **all** boats have sailed | the same colour, **faint and thin** — behind everybody |

> **The band of "some" legs IS the fleet's spread, and that is why it gets the ink.** Its front edge
> is where the leader has got to and its back edge is where the last boat has got to, so *is this
> fleet going to finish, and can I shorten* is the width of that band, read at a glance and without a
> number.

Every boat that has joined is drawn, in its division's colour, with the hull glyph the boat's own
screens use. A boat whose last fix is old is drawn faded and says how old. The legs are drawn
straight; the editor's `coursedraw.track` arcs them, which this screen does not need.

### 12.3 The panel

The chart shows **every race running** — public, today, and not over (every boat finished or
retired, or every division's line closed and time limit run) — and the panel acts on **one**, chosen
by series and then by race, since race names repeat from one series to the next.

- **Race**: name, date, how it starts, club and series, and the race that follows.
- **Starts**: per division, the start as it stands, with what can be done to it here and nothing
  else — the start itself is set in the editor:
  - **Delay** by 5, 10, 15 or any number of minutes: a new start, the whole sequence moved with it.
    While scheduled it moves the start on from itself; after an AP it counts from now and must leave
    a full sequence (at least a minute before the warning signal). It clears an AP. An allocated
    start has no common time to delay.
  - **AP** before the start, or **abandon** after it — whichever applies, each asking twice.
- **Course**: publish the division's current published snapshot to its boats as a `course` change
  (until shortening is designed).
- **Fleet**: one row per boat, with whether it has seen the latest course and flag. There is no DNF
  button: a boat that has not finished within its division's time limit is simply not finished.
- **The channel**: the same open channel the boats are on, read and written from here. The committee
  is a participant, not a separate facility — "no private conversations" applies to it too.

**There is no GO button, and that follows from §1.2.** The server keeps no clock, so a start cannot
be *triggered*; it is **scheduled** as an absolute instant. Which suits sailing anyway: a start
sequence is planned, not pressed.

### 12.4 The fleet table, and why the acknowledgements exist

One row per boat that has joined: sail number, division, **last fix age**, mark and lap, elapsed
and outcome, **whether it has acknowledged the latest course and flag**, and a **DNF** button that
asks twice.

> That last column is the whole reason acknowledgements are in the protocol. The question a committee
> genuinely has before starting is **"have all boats seen the new course?"** — and without somewhere
> to read the answer, the acks would be bookkeeping nobody looks at.

### 12.5 Where the data lives

| | Where | Why |
|---|---|---|
| **Definition** — name, date, format, division map, planned start, next race | the series YAML (`Race`, `races:`) | configuration: authored ahead, diffable, part of the file a club could hand to another club whole |
| **Conduct** — who joined, the channel, flags raised, the standings, acknowledgements | `data/store/conduct/{club}/{series}/{race}.json` | a record of an afternoon involving real people, which is what that gitignored directory is for |

**The channel is kept with the race it happened in**, which is what bounds it: a race's log is as
long as a race, a joining boat is sent that race's messages and no others, and a day of chained races
is a series of separate conversations rather than one that grows all afternoon. On a server restart
the channel and the standings come back from the conduct file; the sessions do not, so a boat that
was talking to it joins again and is re-stated.

Keeping that line is what stops a programme file filling up with a Saturday.

### 12.6 Several races in a day: a race knows its NEXT race

**A race carries the id of the race that follows it (`next`), and a boat that stops racing one is
auto-joined to the next** — provided the next is on the same day. The server sends a `joined` for
it, unasked, carrying the new course, and re-states the new race's standing.

That answers the day's racing without a new level in the hierarchy, and it is why **"regatta" does
not need to be a word**: a regatta is a series, and the thing that was needed was a link between
consecutive races rather than a bracket around them.

| | |
|---|---|
| **Joined on** | retiring. Finishing and a committee outcome mean *no longer racing this one* too, and do not yet fire it (§14) |
| **Guarded by** | the same day, so a weekly series does not enter you for next Saturday |
| **Carried over** | the boat's division tag, where the next race has a division of that name |
| **Declined by** | `leave`, like any other join. Being entered is not being obliged |

**A retirement is still an entry to the next race.** Retiring from race one is a statement about
race one; a sailor who has had enough of the day says so by leaving.

**A division the next race does not have breaks the chain, and that is the safe way round.** A boat
tagged `division:2` is not auto-joined to a race that only has `division:a`: the chain does not fire,
and the boat joins by hand — choosing a division that race actually has. Entering it with a tag that
maps to no course would put a boat on the fleet list with nothing to sail and no moment at which
anybody found out.

---

## 13. What is deferred

**Two** things are deferred on purpose rather than unresolved. Both are consequences of §7.1 — they
are what *not* authenticating boats costs — and both are defences against bad actors, waiting until
there is something worth attacking. A defence built for a prototype would be built against an
attacker who does not exist yet, tested by nobody, and in the way of the testing that does matter.

1. **A rate cap on the channel.** There is no identity to throttle: a cap would fall on a sail number,
   which is a thing anybody can claim. A **length** cap costs nothing and is built (§8.4); the
   instrument against a person jamming the channel is the committee's mute (not built).
2. **Impersonation.** Any device can claim any sail number and put a false position or a false
   crossing on the fleet feed. §1.1 does not cover this — it trusts a boat *about itself*, not a
   third party *about* a boat. A join token from the notice of race would raise the cost without
   being authentication, and is the obvious first move if it is ever needed.

> **Deferring is not forgetting, and the two are told apart by where they are written.** A defence
> nobody decided against is a hole; a defence somebody decided to do without, in writing, with the
> reason and the first move recorded, is a schedule. The trust model (§1.1) is *designed* to be
> exploitable by anyone who wants to — the boat is believed absolutely — so the day this leaves the
> prototype, §13 is the list to work through.

> **What is NOT open**, and should not be reopened without a reason: the trust model (§1.1), the
> absence of a server clock (§1.2), the absence of an ordinal (§4), that boats are unauthenticated
> (§7.1), and that a withdrawal never reaches the water (§11).

---

## 14. Where it lives, how it is tested, and what is not built

| | |
|---|---|
| `client/www/dialog.js` | the boat's half: joining, the queue, the held standing, the channel, `ladder` |
| `client/www/screens.js` | the start row, the channel, the Place screen, the alert and its banner |
| `client/www/schema.js` | the client's validator |
| `client/www/race.html` / `race.js` | the committee's screen |
| `dialog/Dialog.java` | sessions, rooms (one per race), standings, the chain, the channel |
| `dialog/Envelope.java`, `dialog/Schemas.java` | the envelope and the server's validator |
| `server/DialogServlet.java` | the polling transport |
| `server/ApiServlet.java` | `GET /api/conduct/…` (what the race screen reads) and `POST /api/conduct/…` (what it publishes) |

| Test | What it holds |
|---|---|
| `dialog-test.js` | the part with no wire in it: the start state machine, the channel's idempotence, the alert rule, the ladder, the validator |
| `DialogTest.java` | that every schema is in the build, and that the Java validator agrees with the JavaScript one about the subset |
| `drive-race.mjs` | a simple race end to end over the wire — define, join, schedule, AP, re-schedule, fix, crossing, course change, ack, retire, chain to the next race |
| `drive-racepage.mjs` | the committee's screen: the progress textures, the arming, the flag that applies, DNF |
| `drive-alert.mjs` | **nothing interrupts an approach** — the same flag published away from a line and on one |
| `drive-racedef.mjs` | the editor's Races tab: that a race reaches the file, and the chain |
| `drive-results.mjs` | the results pages, and that the race on a record is stamped from the session |
| `drive-client.mjs` | the network taken away between joining and finishing, and the whole course sailed anyway |

**Not built**

| | |
|---|---|
| **The WebSocket** | polling carries the same envelopes; a socket would need a ticker for `fleet` |
| **`ask`** on join | every join answers itself; the join screen names the race and the division |
| **`window`** (a start range) | schema'd, carried, and held as state by the client; the race screen does not publish one |
| **Muting a sail number** | §8.4's instrument against a person jamming the channel |
| **The rate cap** and **impersonation** defences | §13, deferred on purpose |
| **The chain on finishing** | only `retire` enters a boat for the next race; finishing, or being given an outcome, does not |
| **The boat switching course** | a `course` change and an unasked `joined` for the next race reach the boat's conversation — held, shown, acknowledged — but the boat goes on sailing the geometry it joined with |
| **A session for the race screen** | it reads conduct and publishes over REST; the committee writes into the same channel without being one party in the conversation |
| **Stamping REST records** | a record posted to `POST /api/records` has no session, so it keeps whatever `race` it carries |
| **Nothing is cached across a reload** | a browser reloading a backgrounded tab throws away a joined race mid-afternoon |
| **Re-posting the record with its track** | the thin record goes when the course completes; nothing waits for wifi to send the fat one |
