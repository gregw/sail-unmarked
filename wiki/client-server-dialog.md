# The client–server dialog

**What a boat and the server say to each other, and the rules that keep them able to say it
after they have drifted apart in version.**

> **Status: decided, and substantially built.** A simple race runs end to end —
> `tools/editor-drive/drive-race.mjs` defines one, joins a boat, schedules a start, postpones it,
> re-schedules it, reports fixes and crossings, changes the course, has it acknowledged, retires
> the boat and chains it into the next race of the day. What is deliberately NOT built is listed
> in §14.9 below: the WebSocket (the polling transport
> carries the same envelopes), `ask`, `window`, muting, and any authentication at all. §13 lists
> the two things deliberately DEFERRED — both defences against bad actors, both waiting until
> there is something worth attacking.
>
> **Where the build departs from this document, the document is right and the code is behind.**
> One clarification the building produced rather than a departure: §8.4 acknowledges four kinds
> of message, and §9.3 raises a modal for two of them — so *acknowledged* and *interrupting* are
> two sets, not one. A committee message is acknowledged by being READ in the channel, because a
> radio call that put a dialog over somebody's plot would make the committee reluctant to use the
> radio.

**What is settled, and where to find it**

| | |
|---|---|
| **The boat is trusted entirely** — every position and instant comes from it, and nothing checks | §1.1 |
| A clock offset cancels in an elapsed time, so the trust model costs less than it looks | §1.1 |
| The server will not call OCS, or infer any outcome | §1.1, §8.6 |
| The server keeps **no clock**: it publishes an instant, the boat runs the timer | §1.2, §8.4 |
| For the formats that need one, the server acts **in part** as the race committee — never scoring, never recording | §2 |
| WebSocket, degrading to polling, with the same envelopes on both | §3 |
| Everything live is allowed to be absent; the boat sails regardless | §3.1 |
| Order comes from the transport; **no ordinal**, and reconnection re-states rather than replays | §4, §4.1 |
| Fields are only added, unknowns ignored, a break is a new `type` or `v` — for clients that are *installed* | §5 |
| Divisions are **tags**, because there is no division mechanism yet | §6 |
| Sail number, name and a session — **not** authentication | §7 |
| `ANONYMOUS` boats never join; joining is what makes a fleet | §7 |
| One start per division, no rolling sequence; AP suspends, re-publishing clears it | §8.4, §8.5 |
| Retire is the sailor's word, DNF is the committee's; neither is inferred | §8.6 |
| The three screens a boat still needs, and that **nothing interrupts an approach** | §9 |
| Course changes and flags are **channel entries but not chat messages** — state, not events | §9.4 |
| JSON Schema, both sides, in a subset a small validator covers | §10 |
| The record names the course the boat finished under | §11 |
| Defining a race is a `Races` tab; **running** one is a separate page | §12.1 |
| Colour is division on the race chart, texture is progress | §12.2 |
| There is no GO button | §12.3 |
| A race knows its **next** race, which is why *regatta* is not a word here | §12.6 |
| **Authenticate authority, trust data**: OpenID for officers, nothing for boats | §7.1 |
| `rejected` carries a code AND a sentence; an unknown code falls back to the sentence | §8.1 |
| `fleet` goes out on a fixed slow interval, not at the fix rate | §8.4 |
| The channel belongs to its race, and the committee's mute is the limit on it | §8.4, §12.5 |
| A re-stated course or flag is an ordinary channel entry | §4.1 |
| No clock-skew warning, deliberately | §1.1 |
| A mismatched division breaks the chain rather than joining with no course | §12.6 |
| Withdrawing a course never reaches the water; abandonment is the only stop | §11 |
| **A join with no race behind it gets no channel** — and no fixes, fleet, timers or flags | §8.2 |
| **Defences against bad actors are deferred, in writing** — a prototype has nothing worth attacking | §13 |

---

## 1. What is trusted, and what does not move

### 1.1 THE BOAT IS TRUSTED ENTIRELY

**Every position and every instant in this system comes from the boat, and nothing anywhere
checks whether the boat told the truth.** That is not an oversight to be closed later; it is the
shape of the thing, and it should be said plainly to anybody who builds on it or races under it:

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

**And it does not check it deliberately.** The client could compare its clock against the fix
stream, which carries good time, and warn — and that was considered and dropped. Phones discipline
their clocks from the network, the elapsed time is right regardless of the offset, and a warning
about a thing that does not affect the number a sailor is racing on is screen space spent telling
somebody about a problem they do not have. If absolute comparison ever matters here, the honest
fix is to take instants from the fix rather than from the device clock, not to nag about the
difference.

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

- The **device** decides whether a line was crossed, which way, and at what instant. The
  server is told; it does not adjudicate, and it never sends a crossing to a boat.
- **The server keeps no clock of its own for racing.** It publishes an absolute start time and
  that is all; every countdown, every elapsed time and every crossing instant is run and stamped
  by the boat. There is no official time here to disagree with.
- A boat that has been handed a course can sail the whole of it with the server switched off.
  Everything here is an *addition* to that, and every part of it is allowed to be absent.
- The server does not **score**. Places, OCS, corrected times, penalties, drop races and series
  results stay with the club's software, which already has rules for all of them.

## 2. What this document does change

**For the formats that need one, the server can act in part as the race committee** — start
sequences, postponement and abandonment, divisions, and a live fleet feed. *In part*, and *for
the formats that need it*: plenty of formats have no committee at all, and a boat sailing a
published course on its own afternoon needs none of this. A widening of *"there are no races"*,
then, rather than a reversal of it.

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

**WebSocket, degrading to polling.** One socket carries both directions. Where a socket cannot
be had — a captive portal, a proxy that eats upgrades, a platform that suspends sockets in the
background — the client falls back to polling the same message envelopes over HTTP.

| | WebSocket | Polling fallback |
|---|---|---|
| Client → server | frames on the socket | `POST /api/dialog/{session}` with an array of envelopes |
| Server → client | frames on the socket | the same POST's response carries whatever is queued |
| Idle | server pings | the client polls at the interval it was given when it joined |

**The fallback is the same conversation, not a second one.** Identical envelopes, identical
schemas, identical ordering rules — only the pipe differs. A protocol with two dialects has two
sets of bugs.

### 3.1 When the channel is gone

| What stops | What still works |
|---|---|
| Fleet feed, messages, timers, flags, course updates | Crossing detection, latching, interpolated timing, the Mark screen, the course overview, the race clock |
| Live standings — Race progress ages and says so (§9.1) | The channel keeps what it had, and queues what the boat says |
| Alerts, because none can arrive | The current flag and the current course, which the client holds (§9.4) |

The boat **queues what it was going to say** — crossings, fixes, its record — and sends them on
reconnection, oldest first. Fixes are the exception: a fix is a statement about *now*, so a
backlog of them is of no use to a fleet screen and only the most recent few are kept.

**The screen says which state it is in.** A boat whose socket is down is not told everything is
fine; the same rule the receiver's own staleness already follows.

---

## 4. The envelope

Every message, in both directions, on either transport:

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
State is then simply the events applied as they arrive: a start is published, an `AP` disables it,
a new start replaces the `AP`. Every party runs the same little state machine over the same
sequence and arrives at the same answer.

> **An ordinal was considered and dropped.** A monotonic `seq` would make "which of these came
> last" decidable without trusting anybody's clock, and it looked necessary for two other jobs
> besides — telling a boat what it missed, and recognising a resend. It is not: **§4.1 answers
> reconnection by re-stating state rather than replaying events**, the envelope's `id` already
> makes a resend recognisable, and within one connection the transport has done the ordering
> already. A field carried on every message for a problem that turned out to be somebody else's
> is a field to leave out.

### 4.1 Reconnection RE-STATES, it does not replay

A boat that was away for two minutes does not want the two minutes. It wants **what is true
now** — which course it is sailing, whether its division is postponed, when it starts, whether the
race has been abandoned. So on reconnection the server **re-states the current state** of every
tag the boat belongs to, as ordinary `course`, `timer`/`window` and `flag` messages.

**The channel is the exception, because a channel IS a history.** What was said cannot be
summarised into a current value, so the boat asks for everything after the last message `id` it
holds and gets the gap. That is a log being caught up, not state being rebuilt.

**A re-stated course or flag writes an ordinary channel entry**, like any other. It is not
suppressed and not marked as a catch-up: the entry says *this is the course you are on* and that
is true whenever it arrives, so a boat that reconnected twice honestly saw it told three times.
Suppression would need the channel to know which entries are news, which is a second concept to
get wrong for the sake of a tidier log.

**Fixes are never replayed**, in either direction. A fix is a statement about *now*; a stale one is
not a smaller truth, it is a wrong one.

**`at` is when the sender says it sent this, and nothing is derived from it.** A crossing carries
its own instant in the body, taken from the fix that produced it — that is the number that
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
3. **Unknown message types are ignored**, and counted. An old client meeting a new message must
   carry on, not close the socket.
4. **A breaking change is a new `type` or a new `v`**, never a quiet change to an existing one.
   The server speaks every `v` it has ever shipped until nothing in the fleet speaks the old
   one; retiring a version is an operational decision, not a release note.
5. **`additionalProperties` is `true` in every schema.** That is rule 2 written where a
   validator can enforce it, and it is why validation cannot be strict about what it has not
   heard of.

### 5.1 The handshake

The client opens with `hello`, naming every `v` it can speak. The server replies `hello.ok` with
the one it chose. **The client proposes, the server disposes** — the server knows what the fleet
is running, the client knows only itself.

A client whose versions the server cannot meet gets `rejected` with a reason it can show
somebody, not a closed socket.

---

## 6. Tags

**Divisions do not exist on the server yet, and this document does not invent them.** What it
does is make sure every message that might one day need to name one can:

- `tags` is an array of `namespace:value` strings.
- `division:1` is the expected first use. `fleet:a`, `class:etchells` and whatever else a club
  needs are the same mechanism.
- **A message with no tags is for everybody.** A message with tags is for boats carrying at
  least one of them.
- The server does not validate tag values. It groups by them; it does not know what they mean.

When a real division mechanism arrives it should be a way of *assigning* tags, not a second
concept beside them.

---

## 7. Identity and sessions

A boat is identified by **sail number and name**, and by a **session** the server issues when it
joins. The session is what later messages carry, so that a boat that changes nothing else can
be recognised across a reconnection.

### 7.1 Officers are authenticated. Boats are not, and never will be

**OpenID for race officers — the Jetty setup sail-jinx already has — and no authentication at all
for boats.** The asymmetry is the point, and it follows from §1.1 rather than from expedience:

- **Authenticating a boat would only tell you which device made a claim you were going to believe
  anyway.** A boat's positions and instants are trusted by design; a login would add a name to an
  unverifiable statement and change nothing about whether to accept it.
- **An officer's actions carry authority.** Publishing a course, scheduling a start, abandoning a
  race, muting somebody: those are decisions imposed on a fleet, and the question *who did this*
  has a real answer that matters. That is where a login earns its keep.

So the rule is **authenticate authority, trust data** — which is [open question
8](../CLAUDE.md), answered since and built — see [`deployment.md`](deployment.md) — narrowed to the
half that can actually be solved.

> **Two risks this leaves, and neither is covered by §1.1.** That section says a boat is trusted
> *about itself*; it says nothing about a third party lying *about* a boat.
>
> - **Impersonation.** Any device can claim any sail number and put a false position, or a false
>   crossing, on the fleet feed. The session issued at join means a sustained impersonation has to
>   hold a session rather than fire one message, which is a speed bump and not a defence.
> - **The open channel.** Anyone who can reach the server can broadcast to the fleet.
>
> Both are attacks by a person, and the instrument against a person is a person: see §8.4.

**ANONYMOUS boats never join.** Practice is querying a course and sailing it: no session, no
`fix`, no live `crossing`, and so nothing to exclude from a fleet feed. Joining is what makes a
boat part of a fleet, which is why the feed needs no privacy rule.

**Not joining is not the same as not recording.** A practising boat may still `POST /api/records`
afterwards, over the REST endpoint that exists today — *stored and published to nobody*, which is
what `ANONYMOUS` has always meant, because a boat that never uploads cannot compare its own laps
or recover a track from a lost phone. Nothing about that touches this protocol; it is a file
posted later by a boat that was never in a conversation. See the table in §8.2 for how it sits
beside the two kinds of join.

---

## 8. The message catalogue

Direction is **C→S** (client to server) or **S→C**.

### 8.1 Session and data

| `type` | Dir | Body | Notes |
|---|---|---|---|
| `hello` | C→S | `versions[]`, `client` (name, build) | opens the conversation |
| `hello.ok` | S→C | `v`, `poll` (ms), `features[]` | no time in it: the server is not a clock to set yours by |
| `rejected` | S→C | `code`, `text` | used for any refusal, including version |

**`rejected` carries BOTH a code and a sentence.** The `code` is enumerated — unknown course,
race closed, version unsupported, divisions do not match — and is what a client branches on; the
`text` is what a sailor reads. Neither is sufficient alone: a code cannot be shown to somebody and
a sentence cannot be acted on. **An unknown code falls back to the text**, which the versioning
rules require anyway, since every new code will meet clients that predate it.

Queries for clubs, series, courses and variants stay on the **existing REST endpoints**
(`/api/public`, `/api/join/...`, `/api/courses/{revision}`). They are cacheable, they work before
there is a session, and putting them on the socket would buy nothing.

### 8.2 Joining

| `type` | Dir | Body | Notes |
|---|---|---|---|
| `join` | C→S | `sailNo`, `name`, `club`, `series`, `course`, `variant`, `revision`, `answers{}` | `revision` is what the boat already holds |
| `ask` | S→C | `questions[]` — each `key`, `prompt`, `kind`, `options[]`, `required` | only what the server could not already know |
| `joined` | S→C | `session`, `boatId`, `race`, `tags[]`, `fixSeconds`, `revision`, `course` | the parameters the client is to run on |
| `leave` | C→S | `session`, `reason` | |
| `left` | S→C | `session` | |

**`ask` is a fallback, not a step.** Where the club knows a boat's division and TCF, the join
answers itself and the sailor is asked nothing. A question is a gap in what the server knows.

**`joined` carries the course, not a reference to it.** A boat that has to fetch before it can
sail is a boat that cannot join on a flaky connection.

**`joined` also arrives unasked**, when a boat that has stopped racing is auto-joined to the next
race of the day (§12.6). Same message, same fields; the client has nothing special to do beyond
noticing that the race it is in has changed.

#### A JOIN WITH NO RACE BEHIND IT GETS NO CHANNEL, AND NOTHING ELSE LIVE

A course can be joined without there being a race on it — a boat recording an attempt at a
geometry, which is what the whole system was for before there were committees. **There is then
nobody to communicate with, so there is no channel**: no messages, no backlog, and nothing to
acknowledge. And once that is said, the rest follows without a second decision —

| | Query and sail | Join a course | Join a race |
|---|---|---|---|
| Session | none | yes | yes |
| Where the course comes from | REST | `joined` | `joined` |
| `crossing` | — | yes | yes |
| `record` | over REST, afterwards | yes | yes |
| `fix` | — | — | yes |
| `fleet` | — | — | yes |
| **Channel** | — | **—** | yes |
| `timer`, `window`, `flag` | — | — | yes |
| Chat and Place screens | not offered | **not offered** | offered |

**Fixes stop too, and that is the part worth noticing.** A fix exists to feed a fleet screen; with
no fleet there is no consumer, so `fixSeconds` is absent from `joined` and the boat reports none.
On a phone in a bracket for four hours that is battery and data spent on nobody. What is left —
the join, the crossings, the record — is exactly what the record needs and nothing more.

**A screen with nothing behind it is not offered.** Chat and Place are absent from the view
selector rather than present and empty, and Auto's channel clause (§9.5) never fires. An empty
Chat would say *nobody has spoken yet*, where the truth is *there is nobody*.

> **This is what "for the formats that need one" means** (§2), made concrete: the committee-shaped
> half of this protocol is conditional on there being a race, and a boat sailing a published course
> on a Tuesday afternoon never meets any of it.

> **And practice is a fourth thing, further out still.** `ANONYMOUS` never joins at all (§7): no
> session, no live messages, nothing. It may still `POST /api/records` afterwards over the REST
> endpoint that exists today, which is *stored and published to nobody* — because a boat that
> never uploads cannot compare its own laps or recover a track from a lost phone. Not joining and
> not recording are different things.

### 8.3 What the boat reports

| `type` | Dir | Body | Notes |
|---|---|---|---|
| `fix` | C→S | `session`, `position{latitude,longitude}`, `cogDeg`, `sogKn`, `revision`, `at` | at `fixSeconds` from `joined`, not at the receiver's rate; taken on trust (§1.1) |
| `crossing` | C→S | `session`, `line`, `step`, `lap`, `instant`, `revision`, `confirmedFixes` | one per latch; the instant is the interpolated one |
| `record` | C→S | `session`, `record` (a full `CourseRecord`) | at the end, and on resubmission |
| `retire` | C→S | see §8.6 | the sailor has stopped racing |

**A live crossing is advisory and the record is definitive.** The live message is what makes a
fleet screen and a finish board possible during the race; it can be lost, and a boat that
relocated may retract nothing because the crossing simply never happened. The file posted at the
end is the artefact — it is the one thing that leaves this system, and the only one a protest
could be argued from.

**Fixes carry the revision the boat believes it is sailing.** A fleet screen drawing two boats on
two geometries needs to know which is which.

### 8.4 What the server sends

| `type` | Dir | Body | Ack? |
|---|---|---|---|
| `fleet` | S→C | `boats[]` — `boatId`, `sailNo`, `name`, `tags[]`, `position`, `cogDeg`, `sogKn`, `revision`, `elapsedMs?`, `tcf?` | no |
| `course` | S→C | `revision`, `course` (the whole snapshot), `reason`, **`text`** | **yes** |
| `timer` | S→C | `startAt` (absolute), `warningSeconds`, `startSeconds`, `flags[]`, **`text`** | no |
| `window` | S→C | `opensAt`, `closesAt`, **`text`** | no |
| `flag` | S→C | `flag` (`postponed` \| `abandoned` \| …), `reason`, **`text`** | **yes** |
| `say` | S→C | `from`, `text`, `messageId` | **yes, on dismissal** |
| `say` | C→S | `session`, `text` | relayed to all |
| `ack` | C→S | `session`, `ackOf` (the `id` acknowledged), `what` | |
| `outcome` | S→C | see §8.6 | **yes** |

**Everything the server sends may be tagged.** A timer for one division, a flag for another, a
message for everybody: the same mechanism each time.

**`fleet` goes out on a FIXED slow interval, not at the fix rate.** A few seconds — the working
figure is five — whatever the fleet's size and whatever the boats are reporting at. At nine knots
a boat moves twenty-three metres in five seconds, which on a screen showing a whole course is
nothing, and the alternative scales badly for no benefit: sixty boats at 1 Hz is sixty fan-outs a
second to say what a fleet screen cannot draw the difference of. One message carries every boat,
so the cost is per boat rather than per pair.

**`timer` is an instant and two durations, and nothing else.** `startAt` is absolute;
`warningSeconds` and `startSeconds` say when the warning and preparatory signals fall before it,
so a boat can show the flags a sailor expects. **Every countdown is run by the boat**, against
the boat's own clock — the server sends this once and does not tick.

**A start time should not be changed inside the warning period**, and that is a discipline on
whoever is running the race rather than a rule the server can enforce: every boat is counting on
its own clock, so a late change reaches different boats at different points in their own
sequences, and some of them after they have started. The server will carry the change; it cannot
make it safe.

**ONE START PER DIVISION, AND NO ROLLING SEQUENCE.** Each division has either a `timer` — an
absolute start — or a `window`, and they are entirely independent of one another. A real race
committee's postponement of one start delays the next; here it does not, and deliberately so:

- **AP suspends, it does not reschedule.** A `flag` of `postponed`, tagged to a division, voids
  that division's start. It does not say when the new one will be, because *there is no "now"* on
  this server to count five minutes from.
- **Re-publishing the start is what clears the AP.** A `timer` (or `window`) is the whole of a
  division's start state: publishing one supersedes both the previous start and any postponement
  on that tag. So the cycle is *publish → AP → edit → publish*, and the last message to arrive for
  that tag is the state.
- **Five divisions is that done five times.** No cascade to compute and none to get wrong. The
  screen can offer to do all five at once (§12.3), but that is a convenience on the operator's
  side, not a relationship the protocol knows about.

**Messages are an open channel and are relayed to everybody.** No private conversations, by
design — it is a radio, and everybody hears it. A boat joining is sent the backlog for **that
race** and no more: the channel belongs to the race it happened in, and is kept with that race's
conduct record (§12.5). A boat auto-joined to the next race of the day starts that race's channel
clean.

> **THE CHANNEL HAS NO AUTOMATIC LIMIT, AND THE COMMITTEE IS THE LIMIT.** Rate-limiting was left
> to authentication — and §7.1 then decided boats are never authenticated, so there is no identity
> coming to throttle and no arrival date to wait for. The instrument is therefore the one that
> suits an attack by a person: **the race screen can mute a sail number**, which writes its own
> receipt into the channel so the fleet can see it happened.
>
> A cap on message *length* costs nothing and is worth having regardless — a radio channel where
> somebody can paste an essay is its own problem. A cap on *rate* is still **OPEN**: it would fall
> on a sail number rather than on a person, which is the thing that cannot be established.

**`text` is required on every state message** — see §9.4. It is what the channel shows, and it is
what reaches a sailor whose client is too old to act on the rest.

**Acknowledgements exist where "did they see it?" is a real question**: a course change, a flag,
and a message from the committee. All three are things a protest could turn on, and all three are
acknowledged the same way — by envelope `id`, through `ack`.

### 8.5 The state a division's start is in

Every party runs the same machine over the same events (§4), so nobody has to be told what state
a division is in — it follows from what has been published.

| From | On | To |
|---|---|---|
| — | `timer` or `window` | **scheduled** |
| scheduled | `flag: postponed` | **postponed** |
| postponed | `timer` or `window` | **scheduled** |
| scheduled | the start passing, on each boat's own clock | **racing** |
| racing | `flag: abandoned` | **abandoned** |
| racing | `course` | still **racing**, on new geometry |
| racing | every boat finished, retired or DNF | **finished** |

**AP is the pre-start signal and abandonment is the post-start one** — which is not an extra rule
but what the two flags *mean*. So "you cannot AP a start that has already gone" needs no
enforcement machinery: a race that has started is abandoned, and the screen offers the one that
applies.

Two rules the screen holds, both about not publishing something absurd:

- **No `AP` once a start has passed or a window has opened.** After that the honest instrument is
  abandonment.
- **After an `AP`, the next start is at least six minutes ahead** — a minute before the warning
  signal, then the usual five. A postponement followed by a start a boat cannot see coming is
  worse than no postponement.

> **Enforced where the clock is, which is the operator's screen.** Both rules are arithmetic
> against *now*, and the only *now* that matters is the one belonging to the person deciding. The
> server may refuse an obviously impossible publish as a backstop, and that does not make it a
> time authority (§1.2) — it is a sanity check on a form, not a race clock. What the protocol does
> not carry is any "was this legal" flag: an illegal sequence is prevented, not annotated.

### 8.6 Outcomes: retiring, and DNF

| `type` | Dir | Body | Notes |
|---|---|---|---|
| `retire` | C→S | `session`, `reason` | the boat says it has stopped racing |
| `outcome` | S→C | `boatId`, `outcome` (`dnf` \| `dns` \| `racing`), `reason`, `text` | the committee says so |

**The software never infers an outcome; it records one a person entered.** A boat retires because
a sailor pressed *retire*; a boat is DNF because a committee decided and typed it. Neither is the
software working something out from the data — that is the §1.1 rule again, and it is why an
`outcome` is a message from the committee rather than a conclusion the server reaches when a boat
stops reporting.

This is not scoring (§1.2). *Did this boat complete the course* is collation; *what place did it
get and what does that do to its series* is the club's software.

---

## 9. The screens a boat needs

Three additions to what the client already has — the Mark screen, and the course overview
standing in for the Course screen.

### 9.1 Race progress — the brief's third screen

Brief §3's **Live place**, which does not exist at all yet. Fed by `fleet`:

- The corrected-time ladder — every boat that joined, its place, its elapsed time, and its
  corrected time where a TCF is known.
- Filtered by `tags`, so a sailor can see their own division or the whole fleet.
- **It degrades to last-known standings, and says how old they are.** The brief specifies that
  for exactly this reason: live standings are the one thing boats want promptly from the server
  and therefore the one thing that cannot be had without it, so the screen ages rather than
  blanks.
- It is a *view*, not an authority. Nothing on it is scored here, and a place on it is arithmetic
  over what boats reported about themselves (§1.1).

### 9.2 The channel — one inbox for everything the boat was told

A scrolling log, newest last, of everything that arrived: committee messages, chat relayed from
other boats, and **the state messages too** — see §9.4.

- Each entry carries who it was from, when, the text, its tags, and whether it has been
  acknowledged. Unacknowledged entries are marked, and the bar carries an unread count.
- **The backlog on join lands here, in place**, so a boat joining late reads the afternoon in
  order rather than being caught up by a summary.
- Sending needs a text field — and, because typing at a tiller is hostile, a short list of the
  things a sailor actually says, sent in one tap:

  | Racing | **Retiring** · **Protesting** · **OK** (in answer to being asked) |
  |---|---|
  | Safety | **Need assistance** · **Standing by to assist** · **Man overboard** |

  **The safety three are not racing messages and should not look like racing messages.** They
  belong on this list because the channel is the radio and this is what a radio is for when the
  racing stops mattering — so they are set apart on the screen, and a committee's view of the
  channel should make one impossible to scroll past.

### 9.3 Alerts, and the one thing that must never be covered

A course change or a flag changes what the boat is doing, so it interrupts: a modal alert, and
**dismissing it IS the acknowledgement** the server is waiting for. One gesture, not two.

> **NOTHING INTERRUPTS AN APPROACH.** While the Mark screen has the display — inside the
> approach radius, inside the time, or within the dwell after a latch — an alert does not open.
> It shows as a **banner** on the Mark screen, and the modal is raised the moment the approach
> ends. A sailor thirty metres off a line at nine knots is doing the one thing on this boat that
> cannot be interrupted, and a dialog over the plot at that moment is worse than any news it
> could be carrying.
>
> The banner is not a quiet failure: it says what kind of thing arrived and it stays until it is
> read. An abandonment seen twenty seconds late costs nothing; a plot covered at the moment of a
> crossing costs the crossing.

### 9.4 Course changes and flags as channel entries: YES to one inbox, NO to one message type

**Yes, they belong in the channel**, in time order, among the chat. One inbox, one
acknowledgement mechanism, one backlog, one unread count — and a boat that joins late reads
*postponed at 13:02 · course changed at 13:20 · "shortening at the windward mark" at 13:25* as
one story. That list is also precisely what somebody reconstructing the afternoon afterwards
wants, and it is free.

**No, they must not BE chat messages on the wire**, because they are **state, not events**.

- A chat message is an event: it happened, it is in the past, and nothing is derived from it.
- *Postponed* is a condition the race is in. *The course is revision `a1b2c3`* is the course you
  are sailing. If those exist only as entries in a stream, then knowing whether the race is on
  means replaying the stream and reducing it — and one missed entry means the wrong state,
  silently. **"Scroll up to find out whether you are racing" is not a thing to ask of somebody on
  the water.**

So the client **holds the state explicitly**, set by the message it acted on, and writes a
**receipt** into the channel. The entry is the receipt; the state is the thing. Two consequences
worth writing down:

- **Every state message carries a human-readable `text`, and it is required.** That is what the
  channel shows — and it is also what reaches a sailor on an *older* client, which by the
  versioning rules ignores a type it does not know. A flag with no words on it is a flag only the
  software can read.
- **Acknowledgement is by envelope `id`, whatever the type.** `ack` already takes `ackOf`;
  nothing else is needed, and the channel gets one unseen-badge rule rather than three.

### 9.5 Where they sit in the view selector

The device's view control grows from **Course | Line | Auto** to
**Course | Line | Chat | Place | Auto**.

**Auto gains one clause**: a new channel entry brings up the channel — *unless the boat is
approaching a line*, in which case the Mark screen keeps the display and the entry waits. The
test is the one that already exists: if the Line screen would be taken, chat does not take it.

Priority, highest first:

| | |
|---|---|
| 1 | the **Mark screen**, while approaching or within the dwell |
| 2 | a **new channel entry** |
| 3 | whatever the rule already said — the Mark screen by radius or time, else the course |

**`Place` is never automatic.** It is somewhere you go to look, not something that should arrive
— and it is the screen whose data is most likely to be stale.

---

## 10. Schemas

**JSON Schema, in the repository, validated by both sides.**

- They live in **`client/www/schemas/`**, which means one copy reaches both: Maven already
  packages `client/www` as `/static/`, so the server reads them off the classpath and the client
  has them in its own bundle. Two copies of a schema is two schemas.
- One file per message type per major version: `crossing.v1.json`.
- The server validates everything it receives and everything it sends; **the build fails on a
  message that does not match its schema**, which is the point of having them.

> **The client's validator is a deliberate constraint on the schemas, not the other way round.**
> This codebase has no framework, no npm build and no bundler, and the client is offline-first —
> so pulling in a full JSON Schema implementation is a cost paid on every boat. The schemas are
> therefore held to a subset a small hand-written validator covers: `type`, `properties`,
> `required`, `enum`, `const`, `items`, `minimum`/`maximum`, `pattern`, and `format: date-time`.
> `additionalProperties` is always `true` and is never written, because §5 rule 2 says so.
> A schema that needs more than the subset is a message that should be simpler.

---

## 11. Course changes and the record

**The record names the course the boat was sailing when it FINISHED.** Whether that record means
anything is outside this software: a long course shortened where the early legs are common gives
a record that still describes what was sailed, and a course whose leg was extended mid-race gives
one that does not. The software records what happened and does not judge it.

Practically: a boat that accepts a `course` update mid-race keeps sailing, its later `crossing`
messages carry the new revision, and its `record` names the revision it finished under. A course
changed mid-race is usually not one anybody records against in the first place.

**WITHDRAWING A COURSE DOES NOT REACH THE WATER.** Un-publishing stops new boats joining and does
nothing whatever to boats already sailing: they were handed a snapshot, that snapshot still exists
and is still readable by revision, and they finish on it. Nothing is sent and nothing stops.

> **Stopping a race is `flag: abandoned`, and only that.** A publishing act must not have an effect
> on the water as a side effect — somebody tidying next week's courses on race morning would
> otherwise stop a fleet, and would find out from the fleet. Two verbs, two meanings: *withdraw*
> is about who may join, *abandon* is about who must stop.

---

## 12. The server screens

Provisional, and separate from the boat's screens because the people are different: this is a
club's desk or a committee boat, on a laptop, with a keyboard.

The **welcome screen** is left alone; it will be rewritten around authentication when there is
any ([open question 8](../CLAUDE.md), now answered — see [`deployment.md`](deployment.md)).

### 12.1 Defining a race is EDITING; running one is not

A race lives in a series, so defining one belongs in the editor as a fourth tab —
**`Points | Lines | Courses | Races`** — with the same chart and the same drill-down. A race's
definition is configuration: a name, a date, a format, a `division:x → variant` map, and a
planned start. It is authored ahead of time and it diffs.

**Conducting a race is a second page, and the reason is the undo.** The editor saves as you go and
holds exactly one undo, which is right for dragging a mark and wrong for raising an abandonment:
there is no undo for telling a fleet to stop. Live conduct wants actions that are deliberate and
confirmed, and it wants furniture the pane has no room for — the fleet table, the start states,
the channel, the acknowledgement coverage. Same layout, different page, reached from the race's
row.

### 12.2 The chart: colour is DIVISION here, and texture is progress

**In the editor, colour means leg role** — green leaves a lap, red arrives at one, blue between
(`ROLE_COLOUR`). **On the race screen, colour means division.** The two never share a chart, so
there is no collision; what there must not be is a third meaning for colour anywhere.

Progress is carried by **texture within a division's own colour**, because the question the
committee is actually asking is *which legs have been sailed*:

| A leg that | drawn |
|---|---|
| **some** boats have sailed | **solid**, full weight — this is where the fleet is |
| **no** boat has yet sailed | the same colour, **dashed** — still to come |
| **all** boats have sailed | the same colour, **faint and thin** — behind everybody |

> **The band of "some" legs IS the fleet's spread, and that is why it gets the ink.** Its front
> edge is where the leader has got to and its back edge is where the last boat has got to, so the
> one thing a committee wants to know — *is this fleet going to finish, and can I shorten* — is the
> width of that band, read at a glance and without a number. Putting the ink on the water still to
> come was the alternative, and it answers a question nobody is asking: the course does not change,
> and where the boats are does.

Every boat that has joined is drawn, in its division's colour, with the hull glyph the boat's own
screens use. A boat whose last fix is old is drawn faded and says how old — the same rule the
boat's own staleness already follows.

### 12.3 The panel

Under a race, in the drill-down's own idiom — a label, a selector, and that level's commands:

- **Race**: name, date, format, the division map, and **the race that follows this one** (§12.6).
  Creating a division is creating a tag and picking a variant for it.
- **Start**: per division, a `timer` or a `window`, with `AP` beside it. The cycle from §8.4 is
  the whole of the control: publish, suspend, edit, publish. An offer to apply the same edit to
  every division is a convenience, not a rolling sequence.
- **Flags**: `postponed` per division, `abandoned` per division or for the fleet. Confirmed, and
  each one writes its receipt into the channel (§9.4).
- **The channel**: the same open channel the boats are on, read and written from here. The
  committee is a participant, not a separate facility — "no private conversations" applies to it
  too.

**There is no GO button, and that follows from §1.2.** The server keeps no clock, so a start
cannot be *triggered*; it is **scheduled** as an absolute instant. "Start in five minutes" is
arithmetic done in the operator's browser against the operator's clock and published as an
instant. Which suits sailing anyway: a start sequence is planned, not pressed.

### 12.4 The fleet table, and why the acknowledgements exist

One row per boat that has joined: sail number, name, division, **last fix age**, current mark and
lap, elapsed, and **whether it has acknowledged the latest course and flag**.

> That last column is the whole reason acknowledgements are in the protocol. The question a
> committee genuinely has before starting is **"have all boats seen the new course?"** — and
> without somewhere to read the answer, the acks in §8.4 are bookkeeping nobody looks at.

### 12.5 Where the data lives

| | |
|---|---|
| **Definition** — name, date, format, division map, planned start | the series YAML. Configuration: diffable, and still something a club can hand to another club whole |
| **Conduct** — entries, joins, the channel, flags raised, positions, acknowledgements | `data/store/`, which is already gitignored real-people data |

**The channel is kept with the race it happened in**, which is what bounds it: a race's log is as
long as a race, a joining boat is sent that race's messages and no others, and a day of chained
races is a series of separate conversations rather than one that grows all afternoon. Nothing is
deleted on a timer, because nothing needs to be — and the log of what a fleet was told is exactly
the kind of thing somebody asks for weeks later.

Keeping that line is what stops a programme file filling up with an afternoon.

### 12.6 Several races in a day: a race knows its NEXT race

**A race carries the id of the race that follows it, and a boat that stops racing one is
auto-joined to the next** — provided the next is on the same day. The server sends a `joined` for
it, unasked, carrying the new course and the new start.

That answers the day's racing without a new level in the hierarchy, and it is why **"regatta" does
not need to be a word**: a regatta is a series, and the thing that was actually missing was a link
between consecutive races rather than a bracket around them.

| | |
|---|---|
| **Joined on** | finishing, retiring, or being given an outcome — anything that means *no longer racing this one* |
| **Guarded by** | the same local day, so a weekly series does not enter you for next Saturday |
| **Carried over** | the boat's tags, where the next race has a division of that name |
| **Declined by** | `leave`, like any other join. Being entered is not being obliged |

**A retirement is still an entry to the next race.** Retiring from race one is a statement about
race one; a sailor who has had enough of the day says so by leaving, and the two should not be the
same gesture.

`ask` (§8.2) therefore fires at most once a day for a boat the club does not already know — the
first join. Every join after that is the server telling the boat where it is sailing next.

**A division the next race does not have breaks the chain, and that is the safe way round.** A
boat tagged `division:2` is not auto-joined to a race that only has `division:a`: the chain simply
does not fire, and the boat joins by hand — which asks it for a division that race actually has.
The alternative, entering it with a tag that maps to no course, would put a boat on the fleet list
with nothing to sail and no moment at which anybody found out. Breaking the chain means the sailor
discovers it when they look, which is before the start rather than after it.

---

## 13. What is deferred, and why that is a decision

Everything that was on this list has been answered and moved into the body, where the reasoning
belongs. **Two** things are left, both consequences of §7.1 — they are what *not* authenticating
boats costs — and both are now **deferred on purpose rather than unresolved**. This is a prototype
that needs a great deal of testing before anybody races on it; a defence built now would be built
against an attacker who does not exist yet, tested by nobody, and in the way of the testing that
does matter. If it succeeds there will be bad actors and this section is where to start.

1. **A rate cap on the channel.** §7.1 decided boats are never authenticated, so there is no
   identity to throttle: a cap would fall on a sail number, which is a thing anybody can claim.
   A **length** cap is worth having and costs nothing, so it stays (§8.4); the instrument against a
   person jamming the channel is the committee's mute. A per-session *rate* cap is **not built**.
2. **Impersonation.** §7.1 names it and does not solve it: any device can claim any sail number and
   put a false position or a false crossing on the fleet feed. §1.1 does not cover this — it trusts
   a boat *about itself*, not a third party *about* a boat. A join token from the notice of race
   would raise the cost without being authentication, and is the obvious first move if it is ever
   needed. **Not built.**
~~3. **The formats that need none of this.**~~ **Answered** in §8.2: a join with no race behind it
   gets no channel, because there is nobody to communicate with — and no fixes, no fleet, no timers
   and no flags follow from that without a second decision. What is left is the record, which is
   what such a boat came for.

> **Deferring is not forgetting, and the two are told apart by where they are written.** A defence
> nobody decided against is a hole; a defence somebody decided to do without, in writing, with the
> reason and the first move recorded, is a schedule. The distinction matters here because the trust
> model (§1.1) is *designed* to be exploitable by anyone who wants to — the boat is believed
> absolutely — so the day this leaves the prototype, §13 is the whole of the list to work through.

> **What is NOT open**, and should not be reopened without a reason: the trust model (§1.1), the
> absence of a server clock (§1.2), the absence of an ordinal (§4), that boats are unauthenticated
> (§7.1), and that a withdrawal never reaches the water (§11).

---

## 14. As built

**What exists, and the rules a change has to respect.** The design is above; this is the state of it.
`dialog.js` is the boat's half, `Dialog.java` and `DialogServlet.java` the server's, with
`client/www/schemas/*.v1.json` shared between them.

**The conversation is the OPTIONAL half of this application, and every line of it is arranged to stay
that way.** Nothing in `dialog.js`, `Dialog.java` or `DialogServlet.java` is on the path from a fix to a
latch: `device.feed()` gives the fix to the client, the client decides everything that matters, and only
*then* is anything queued for the server. A poll that throws sets `connected` false and queues what was
going to be said, and a boat goes on rounding its marks and timing them to the metre.
`drive-client.mjs` takes the network away and sails a whole course with it gone, which is the claim made
mechanical.

### 14.1 Definition is configuration; conduct is a record of an afternoon

| | Where | Why |
|---|---|---|
| **Race definition** — name, date, format, `division → course/variant`, the next race | the series YAML (`Race`, `races:`) | authored ahead of time, it diffs, and it is part of the file a club could hand to another club whole |
| **Conduct** — who joined, the channel, flags raised, positions, acknowledgements | `data/store/conduct/{club}/{series}/{race}.json` | a record of an afternoon involving real people, which is what that gitignored directory is for |

Keeping that line is what stops a programme file filling up with a Saturday. The editor's Races tab is
the UI for the definition half — see [`course-editor.md`](course-editor.md).

### 14.2 State is the events applied as they arrive

There is no ordinal on the envelope and nothing is replayed. A start is published, an `AP` voids it, a
new start supersedes the `AP` — so **the last message to arrive for a tag IS that tag's state**, and the
same little machine runs on the server (`Dialog.Standing`), on the race screen and on every boat
(`dialog.js` `state()`). Three consequences, each a thing somebody would otherwise add:

- **There is no "clear the AP" message and there must not be.** Publishing a start is what clears it.
  `dialog-test.js` asserts that as behaviour, so the day somebody adds a `clear` type the spec fails.
- **Reconnection RE-STATES rather than replaying.** A boat that was away for two minutes does not want
  the two minutes; it wants which course it is sailing, whether its division is postponed, and when it
  starts. `Room.restate` sends the current standing as ordinary `course`, `timer` and `flag` messages,
  unmarked, because the entry says *this is the course you are on* and that is true whenever it arrives.
- **The channel is the one thing that IS replayed**, because a channel is a history and what was said
  cannot be summarised into a current value. `channel.since` hands back **the original envelopes, ids and
  all**, which is what makes it idempotent: `dialog.js` keeps a `seen` set.

**Every countdown is run by the boat.** `timer` is an instant and two durations; the server sends it once
and does not tick. That costs nothing that matters, because what a race is decided on is a difference
between two readings of *one* clock.

### 14.3 The schemas, and why there are two validators

One file per message type, each describing that message's **body**. The envelope is the one shape every
message shares, so it is checked in code rather than repeated twenty times, and `$ref` is deliberately
outside the subset.

They live under `client/www` because that is what makes one copy reach both sides: Maven packages it as
`/static/`, so `Schemas.java` reads them off the classpath and the client fetches them from `/schemas/`.
**Two copies of a schema is two schemas.**

**The client's validator is a constraint on the schemas, not the other way round.** No framework, no npm
build, no bundler, and offline-first — so the subset is what a small hand-written validator covers:
`type`, `properties`, `required`, `enum`, `const`, `items`, `minimum`/`maximum`, `pattern`,
`format: date-time`. `additionalProperties` is always true and is never written, because unknown fields
are ignored on both sides and that is what lets an installed client and an updated server go on talking.
A schema that needs more than the subset is a message that should be simpler.

> **`maxLength` was written and then taken out.** It is not in the promised subset, and the length cap it
> was for is better done by TRUNCATING (`Dialog.MAX_SAY`) than by refusing: a sailor's message that is
> too long should arrive clipped, not be thrown away.

> **An unknown message TYPE is accepted, not refused** — on both sides. It is ignored and *counted*.
> Refusing would make every future message type a breaking change for every server already deployed, and
> a client silently dropping what the server sends is the failure the versioning rules exist to make
> visible.

### 14.4 The transport: polling is built, the socket is not

`POST /api/dialog` before there is a session (`hello` and `join`), `POST /api/dialog/{session}`
afterwards. One call — `Dialog.exchange(session, envelopes)` — is the whole contract, written that way so
the socket can use it unchanged: a frame is an exchange of one message with an empty reply, a poll is an
exchange of several with whatever is queued.

**Polling was built first on purpose.** The promise is that the fallback is the same conversation —
identical envelopes, schemas and ordering — so the socket is a pipe to add rather than a protocol to
design; building it first would have meant writing the fallback twice. What the socket will need beyond
what exists is a **ticker**, because `fleet` is enqueued when a boat polls, which is right for polling
and not enough for a socket.

**`fleet` goes out on a fixed slow interval** (`FLEET_SECONDS`), not at the fix rate. At nine knots a boat
moves twenty-three metres in five seconds, which on a screen showing a whole course is nothing; sixty
boats at 1 Hz would be sixty fan-outs a second to say what a fleet screen cannot draw the difference of.

### 14.5 A join with no race behind it gets no channel

**A BOAT JOINS A RACE WHERE THERE IS ONE**, and the join screen asks club → series → race → division,
with the course following from the division. The server can still FIND a race from the course and the day
— which is what an older client gets — but finding works only while one division sails one course. A
division name that is not in that race is ignored rather than obeyed: that is a boat describing a race it
is not in.

**A screen with nothing behind it is not offered**: `viewBar` filters Chat and Place out rather than
showing them empty, because an empty Chat would say *nobody has spoken yet* where the truth is *there is
nobody*.

### 14.6 The boat's three screens

**`VIEW_MODES` in `raceclient.js` is what may be asked for by name** — anything else reads as `auto`, so a
screen that existed in an older build cannot strand somebody.

**Auto gained one clause**: a new channel entry brings up the channel, *unless the boat is approaching a
line*. The channel arrives as a **hint** (`view(now, {channel})`) rather than as a field, because
`RaceClient` knows about lines and fixes and must not learn what a chat message is. Offered once per
entry rather than while something is unread, or a boat with an unread message could never look at its own
course. **`Place` is never automatic**: it is somewhere you go to look, and it is the screen whose data is
most likely to be stale.

**The start is ABOVE every screen** (`startRow`), not on one of them. It is the one thing on the device
that is about a moment rather than a place, and a countdown a sailor has to change screens to see is a
countdown they will miss.

**NOTHING INTERRUPTS AN APPROACH.** While the Mark screen has the display an alert shows as a banner
(`alertBanner`) and the modal waits, raised the moment the approach ends. A sailor thirty metres off a
line at nine knots is doing the one thing on this boat that cannot be interrupted. The banner is not a
quiet failure — it says what arrived and stays until read.

**Dismissing the alert IS the acknowledgement.** One gesture, not two: a dialog offering *Dismiss* beside
*Acknowledge* would ask somebody at a tiller to agree they had read a thing they had just closed.

> **Acknowledged and INTERRUPTING are two different sets.** `MUST_SEE` is what carries an unseen badge and
> gets an `ack` — a course, a flag, an outcome and a committee message, all four being things a protest
> could turn on. `INTERRUPTS` is the narrower set that opens a modal: a course, a flag, an outcome. A
> committee message is acknowledged by being read.

**The safety three are set apart on the channel screen**, in warn colour with a rule above them. They are
not racing messages and must not look like racing messages: the channel is the radio, and this is what a
radio is for when the racing stops mattering.

**Race progress ages rather than blanks**, and says how old it is. Live standings are the one thing boats
want promptly from the server and therefore the one thing that cannot be had without it; a screen that
went empty would be saying the fleet had vanished. It is a *view*, not an authority.

### 14.7 The race screen

`race.html` is a **second page**, and the reason is the undo: the editor saves as you go and holds exactly
one undo, which is right for dragging a mark and wrong for raising an abandonment.

**Colour is DIVISION here.** In the editor colour means leg role; the two never share a chart, and
`DIVISION_COLOURS` deliberately shares no value with `ROLE_COLOUR`. What there must not be anywhere is a
third meaning for colour.

**Progress is texture within a division's own colour**, because the question a committee is asking is
*which legs have been sailed*: **solid** where some boats have sailed, **dashed** where none has yet,
**faint and thin** where all have. The band of "some" is the fleet's spread, so *can I shorten* is the
width of that band, read at a glance and without a number.

**There is no GO button and there cannot be.** The server keeps no clock, so a start is scheduled as an
absolute instant — **and the form asks for one**, in the operator's own zone with that zone named, plus
the warning and preparatory durations that hang off it. A start sequence is a thing a committee decides —
*this race starts at five past two* — and "start in N minutes" made the operator do that sum backwards
against a clock that had moved by the time they pressed the button.

> **The durations are durations, not instants**, because a sequence hangs off its start: moving the start
> moves all of it, which is what a postponement does. And they are per DIVISION, since div-1 starting at
> 14:05 and div-2 at 14:10 is the entire point.
>
> **Seeded once, from the race's PLANNED start where the definition has one.** Never re-seeded, because
> the page re-renders every couple of seconds and a seed that ran again would type over what somebody was
> entering. For the same reason the fields commit on `change` rather than `input`.

**An irreversible act asks twice, in the button itself** rather than in a dialog, so nobody is agreeing to
something that has scrolled out of view. The screen offers **the flag that applies**: `AP` before a start
has passed, **abandon** after. After an `AP` the next start is at least six minutes ahead, said out loud
rather than merely disabling a button.

**The fleet table's last two columns are the whole reason acknowledgements are in the protocol.** The
question a committee genuinely has before starting is *have all boats seen the new course?*, and without
somewhere to read the answer the acks would be bookkeeping nobody looks at.

### 14.8 How it is tested

| | |
|---|---|
| `dialog-test.js` | the part with no wire in it: the start state machine, the channel's idempotence, the alert rule, the ladder, the validator |
| `drive-race.mjs` | a simple race end to end over the wire — define, join, schedule, AP, re-schedule, fix, crossing, course change, ack, retire, chain to the next race |
| `drive-racepage.mjs` | the committee's screen: the progress textures, the arming, the flag that applies, DNF |
| `drive-alert.mjs` | **nothing interrupts an approach** — the same flag published twice, once away from a line and once on one |
| `drive-racedef.mjs` | the editor's Races tab: that a race REACHES THE FILE, the chain written from the end a person thinks from, and the two ways a chain goes wrong |
| `DialogTest.java` | that every schema is in the build, and that the Java validator agrees with the JavaScript one about the subset |

> **The page-level drivers exist because the protocol driver alone would ship the wiring bugs.** The one
> that proved it was a render loop — being on the channel screen *is* reading it, and marking read
> requested a render. Two guards now, because either alone is a trap: **nothing to do is not a change**,
> and a caller already rendering passes `notify = false`.

### 14.9 What is left as TODO, deliberately

| | |
|---|---|
| **The WebSocket** | polling carries the same envelopes; the socket needs a ticker for `fleet` |
| **`ask`** on join | every join answers itself today, because the division comes from the course. A question is a gap in what the server knows |
| **`window`** (a start range) | schema'd, carried, and held as state by the client; the race screen does not publish one |
| **Muting a sail number** | §8.4's instrument against a person jamming the channel |
| **The rate cap** and **impersonation** | §13, deferred on purpose — defences against attackers a prototype does not have |
| **The race screen holds no session** | it reads conduct over REST and publishes over REST. The committee IS a participant — its messages go into the same channel — but it is not yet one party in the conversation |
| **Cornered legs on the race chart** | drawn straight; `coursedraw.track` does it properly |
| **Nothing is cached across a reload** | a browser reloading a backgrounded tab throws away a joined race mid-afternoon |
| **Re-posting the record with its track** | `record({track: true})` builds it; nothing waits for wifi and sends it |
| **Divisions are assigned by the COURSE a boat joined** | enough for one division per course, wrong the moment two share one. `ask` is where that gets fixed |
