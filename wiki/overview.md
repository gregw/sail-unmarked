# How Unmarked works

**Start here.** This is the whole system in one pass: what it is for, what the pieces are, and
what happens between a club drawing a course and a boat's time appearing in a results table. Every
section ends by naming the document that goes deeper.

---

## The idea

### Motive

**First, to need less on the water.** A race normally needs volunteers and boats to lay marks,
raise flags and take times. Unmarked is meant to let a club run a race with no committee boat and
no laid marks, or with fewer of them. Clubs can still use boats, and can mix real marks with
virtual ones.

**Second, to make other race formats possible.** Once a mark costs nothing to lay, the course
doesn't have to wait for a committee to set it up. The usual formats still work: scratch or
pursuit starts, windward/leeward or passage courses. These also become possible:

- **Practice and record attempts.** A course can stay open all the time, so a boat can sail it
  whenever it likes. Best times on each version of the course are kept as records.
- **Self-timed starts.** Each boat's clock starts when it crosses the start line.
- **Circuit, join anywhere.** A course can be a loop with several entry lines. A boat starts at
  one of them and finishes by crossing the same line again, so a boat can start and finish near
  its home waters. This makes a new kind of interclub racing possible, with live rankings when
  there is a network.
- **Dynamic courses.** The committee can move or shorten a course during a race and publish the
  change to the fleet. *Partly built:* a boat is told about the change but does not switch to the
  new course.
- **Distance-corrected handicap.** Each boat gets its own position for a handicap line, so that
  the boat's handicap becomes extra distance rather than a factor on its time. All boats start
  together, and the first one home wins on handicap. A TCF of *t* sails *t* times the course
  → [course-model.md](course-model.md#distance-corrected-handicap-each-boats-own-line).

The [brief](unmarked-racing-brief.html) §2 describes each format in more detail.

### Method

Every mark is a **virtual line checked by GPS** rather than a buoy checked by eyeball. A boat
rounds a virtual mark by crossing a line in the required direction, and its phone decides that it
did and at what instant. Fleets already cross start lines this way, and Unmarked does the same for
every rounding.

This also means that **RRS 18 (mark-room) never applies.** A line has no zone and no boat inside or
outside at an overlap, so there is nothing to judge. Boats that meet near a line use the Part 2
right-of-way rules instead. This is a deliberate safety choice.

---

## The pieces

```
        ON SHORE                                         ON THE BOAT
 ┌───────────────────────────────┐              ┌──────────────────────────────┐
 │  editor.html   design courses │              │  boat.html (a phone)         │
 │  race.html     run a race     │   before:    │    receiver.js  GNSS → fix   │
 │  results.html  read results   │   the course │    device.js    the screens  │
 │                               │ ───────────► │    raceclient.js             │
 │  Java server (Jetty, :8083)   │              │      crossing.js  DECIDES    │
 │    series YAML  → courses     │   during:    │                              │
 │    ledger       → published   │ ◄──────────► │    dialog.js  (optional)     │
 │    store        → records,    │   the race   │                              │
 │                   conduct     │   after:     │  client.html: the same device│
 │                               │ ◄─────────── │  on a simulated boat (a rig) │
 └───────────────────────────────┘   the record └──────────────────────────────┘
```

**The line between the two halves is the architecture: a boat's own rounding and timing are
computed entirely on the device and never wait on a server.** The server hands out the course
before the start and collects the record afterwards. In between it carries the race committee's
side of a race — starts, flags, a channel, a fleet feed — and every bit of that is allowed to be
absent: the server can be switched off mid-race and no boat's crossings or times change.

The server is Java 21 on embedded Jetty, with YAML configuration and JSON files on disk — no
database, no framework. The client is plain HTML and JavaScript ES modules, no framework and no
build step; the same files are served by the server and would be wrapped by Capacitor for a native
app.

---

## From a drawn course to a result

### 1. A club describes its water

Everything a club races is in one YAML file per **series**:
`data/config/clubs/<club domain>/<series>.yaml`. The path is the identity. The file holds **points**
(named places), **lines** over those points, **courses** over those lines, and **races** that use
the courses. It is self-contained, and it is written for people to read: the editor splices what
it changes back into the text and leaves every comment where it was.

A **line** has two ends, `port` and `starboard`, either of which may be **infinite** — a bearing
rather than a place, so the line runs on without limit and that end cannot be missed.

→ [course-model.md](course-model.md), [course-editor.md](course-editor.md)

### 2. It designs courses

A course is an ordered **sequence of steps**; each step is *cross this line, forward or reverse*,
or a **gate** of alternatives. The first step is the start and the last the finish — there is no
role field, and the letters S, 1, 2 … F are derived. A **cycle** (`closed`) is a loop a boat may
join at any step marked as an **entry**, and finish where it joined.

A course has one or more **variants** — Div 1, the short course — each an editable design. Any
variant may be marked a **template**: a shape to start from, which can never itself be raced.

→ [course-model.md](course-model.md), [course-lifecycle.html](course-lifecycle.html)

### 3. It snapshots and publishes

Courses are edited live, so what a boat sails cannot be the editable design. A **snapshot** is an
immutable, fully-resolved capture of one variant, identified by its **revision** — twelve hex
characters hashed over the geometry and nothing else. **Publishing** chooses which snapshot boats
are handed; **public** decides whether anybody outside the club may see it. Editing a mark after
publishing changes nothing on the water until somebody publishes again.

→ [course-model.md § the lifecycle](course-model.md#the-lifecycle-as-built)

### 4. It may define a race

A race is a date, a format, and for each **division** a course and variant to sail, with a planned
start and the race that follows it. The definition lives in the series file; what happens on the
day is written to the store as the race's **conduct**. Many courses are sailed with no race at all —
practice, and record attempts.

→ [client-server-dialog.md §12](client-server-dialog.md#12-the-server-screens)

### 5. A boat joins

On `boat.html` a sailor enters a sail number, a name and a length, then chooses club → series →
race → division — or, with no race, a course and variant — and whether this counts as practice, a
race or a record attempt. The join goes over the **dialog**, and the answer carries the whole
published snapshot; if there is no conversation to be had, a plain REST join hands the snapshot
over anyway. From then on the phone needs nothing from the server to sail.

→ [boat-client.md](boat-client.md), [client-server-dialog.md §8.2](client-server-dialog.md#82-joining)

### 6. The committee runs the start

On `race.html` an officer schedules each division's start as an absolute time of day, postpones
it, re-schedules it, abandons, publishes a course change, types into the channel, and watches the
fleet on a chart and in a table that says whether every boat has seen the latest course. There is
no GO button: the server keeps no clock, so a start is a published instant and **every boat runs
its own countdown**.

→ [client-server-dialog.md](client-server-dialog.md)

### 7. The boat sails

Each GNSS fix goes through quality control, then to the detectors of the **live step** only. A
crossing is **latched** when N fixes confirm one side, the segment between two fixes cuts the line,
and N fixes confirm the other side — and its instant is **interpolated** where the segment cut the
line, never the time of a fix. A boat's elapsed time runs from its own start crossing.

The screen follows the situation: a course overview most of the time, and the **Mark screen**,
which takes over by itself within 100 m or 25 s of the line, holds still while the boat closes, and
says in its colours whether the present course crosses the line or runs out past its end.

→ [crossing-detection.md](crossing-detection.md), [boat-client.md](boat-client.md)

### 8. The record goes in

When the course completes, the boat sends its **record** — the crossings with their interpolated
instants, and every quality-control refusal with its reason. The server stamps it with the race the
boat joined, files it under the club's own race day, and trusts everything else in it: **the boat
is trusted entirely**, which works because a clock offset cancels in an elapsed time.

→ [client-server-dialog.md §1.1](client-server-dialog.md#11-the-boat-is-trusted-entirely),
[course-model.md § the record](course-model.md#the-record-is-the-interface)

### 9. Results are read, never stored

`results.html` reads straight from the records: a race as a finishing order by elapsed time, with
corrected time beside it where a boat declared a TCF; record attempts grouped by revision, because a
course edited between two attempts is two courses. **Nothing here scores** — places, penalties and
protests belong to the club's own software.

→ [course-model.md § reading results back](course-model.md#reading-results-back)

---

## Who may do what

**Authenticate authority, trust data.** The editor, the race screen and the writes behind them sit
behind an OpenID Connect login when `auth.yaml` configures one; boats are never authenticated, and
every read, every join and the whole of the dialog stay open.

→ [deployment.md](deployment.md)

---

## Where to read next

| Document | What it covers |
|---|---|
| [unmarked-racing-brief.html](unmarked-racing-brief.html) | the design intent: formats, screens, diagrams. Open it in a browser |
| [course-model.md](course-model.md) | lines and ends, sequences, letters, leg length, ids, the file, the record, results, and the lifecycle as built |
| [course-lifecycle.html](course-lifecycle.html) | the reasoning behind course, variant, snapshot, publish and templates |
| [crossing-detection.md](crossing-detection.md) | the algorithm that decides a crossing, and its tuning |
| [boat-client.md](boat-client.md) | the boat's pages, the seam, the screens and their rules |
| [client-server-dialog.md](client-server-dialog.md) | the conversation: trust, messages, starts, the channel, the race screen |
| [course-editor.md](course-editor.md) | the editor's pane, the chart, drawing a course, the Races tab, writing the file |
| [deployment.md](deployment.md) | the login, and installing on a Raspberry Pi |
| [open-questions.md](open-questions.md) | what is not decided |

---

## Glossary

| Term | Meaning |
|---|---|
| **line** | a virtual mark: two ends, `port` and `starboard`, each finite or infinite |
| **infinite end** | a bearing, not a place — the line runs on through the given point without limit, so that end cannot be missed |
| **forward / reverse** | the required crossing sense: forward leaves the port end to port and the starboard end to starboard |
| **sense / extent** | the two tests of a crossing: which way, and whether within the finite ends |
| **step** | one position in a course's sequence: one line to cross, or a gate |
| **gate** | a step of alternatives; the boat crosses any one of them |
| **leg** | the water between two steps, measured midpoint to midpoint; named by the step it runs into |
| **cycle** | a closed course; a boat begins at an **entry** step and finishes by crossing it again |
| **course / variant** | what a club publishes and a boat joins / one editable design of it |
| **template** | a variant that can never be snapshotted — a shape to start races from |
| **snapshot / revision** | an immutable capture of a variant / its hash over geometry and order |
| **publish / public** | which snapshot boats are handed / whether anyone outside the club can see it |
| **race / division** | a dated event in a series / a group of boats in it, sailing one course and variant |
| **conduct** | what happened in a race: who joined, the channel, the flags |
| **join mode** | practice (`ANONYMOUS`), `RACE` or `RECORD` — who sees the record |
| **fix** | one GNSS reading: position, time, stated accuracy, satellites, SOG, COG |
| **flyer** | a single wild fix; the kinematic gate rejects it |
| **relocation** | a real jump in position after a dropout; accepted, and never treated as a crossing |
| **latch** | a confirmed crossing in the required sense; once latched it stands |
| **record** | a boat's account of one run at a course: the artefact that leaves the system |
