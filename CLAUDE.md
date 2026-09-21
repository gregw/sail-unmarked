# unmarked

**Sail racing around virtual marks.** Every mark is a line to be crossed via GPS rather than a
point to be rounded.

`README.md` is the outside view. This file is the working one: what must not regress, where
things live, and where the reasoning is written down.

## Where the reasoning lives

Nothing below repeats what a document or a source file already says. The code is heavily
commented on purpose — **comments explain why, not what** — and for most questions the file
named is the answer.

| Document | What it settles | Status |
|---|---|---|
| [`wiki/unmarked-racing-brief.html`](wiki/unmarked-racing-brief.html) | *what this is*: the screens, the formats, the diagrams. Open it in a browser — the SVGs beside it are referenced from it | provisional by its own declaration; §6's YAML is superseded |
| [`wiki/course-model.md`](wiki/course-model.md) | lines and ends, sense vs extent, letters, leg length, ids, the record, reading results back, the lifecycle as built | settled |
| [`wiki/course-lifecycle.html`](wiki/course-lifecycle.html) | course / variant / snapshot, named vs ad-hoc, dirty state, publish, templates — the reasoning | settled |
| [`wiki/client-server-dialog.md`](wiki/client-server-dialog.md) | what a boat and the server say to each other; §14 is what is built | decided, substantially built |
| [`wiki/boat-client.md`](wiki/boat-client.md) | the two pages, the seam, the screens and the QC rules | built |
| [`wiki/course-editor.md`](wiki/course-editor.md) | the editor's pane, the chart, `coursedraw`, the Races tab, `ProgrammeWriter` | built |
| [`wiki/deployment.md`](wiki/deployment.md) | who is authenticated and who must never be; installing on the Pi | built |

---

## The one thing to know

**A boat's own rounding and timing are computed entirely on the device and never wait on a
server.**

Everything follows from that. Crossing detection, fix quality control and latching run in
JavaScript on the boat, from raw GNSS, with no network. The server distributes course definitions
beforehand and aggregates records afterwards. Between those two moments it can be switched off
without a boat on the water noticing.

So: if you find yourself adding an endpoint a client must call before it can score a mark, or
moving the crossing tests into Java so the server can "check" a rounding, stop — that is the
regression this architecture exists to prevent. Live circuit rankings are the one thing boats want
promptly from the server, and they are *specified* to degrade to last-known standings for exactly
this reason.

The second thing, which shapes the rules and the geometry both: **RRS 18 (mark-room) never applies
at a virtual mark.** There is no zone to reach and no inside/outside overlap to adjudicate. That
is a deliberate safety choice, not a side effect.

The third: **the boat is trusted entirely.** Every position and every instant comes from it and
nothing anywhere checks whether it told the truth. The QC gates defend against a bad receiver,
never against a dishonest sailor. That is workable because a clock offset cancels in an elapsed
time; it is *absolute* comparison — against a gun, or between two boats — that the trust model
does not support.

---

## Technology

Matches [`sail-jinx`](../sail-jinx) and [`sailing-pf`](../sailing-pf) — both symlinked at the repo
root. When a convention here is unclear, look at what those do rather than inventing one.

| Concern | Choice |
|---|---|
| Language | Java 21 |
| HTTP server | Jetty 12 (embedded), `jetty-ee10-servlet` |
| Front end | Plain HTML + JavaScript, ES modules, no framework |
| Configuration | YAML via Jackson |
| Persistence | JSON files on disk via Jackson |
| Build | Maven |
| Client wrapper | Capacitor (planned — not yet present) |

No database, no framework, no outbound HTTP client except OpenID discovery at start-up. Port
**8083** (8081 is sailing-pf, 8082 is sail-jinx, 8888 is sailing-pf's admin connector).

```bash
mvn exec:java                              # serves http://localhost:8083/ from ./data
mvn exec:java -Dunmarked-data=/path/to/data
mvn test                                   # Java tests + the JavaScript specs
node tools/run-js-tests.mjs                # just the JavaScript specs
tools/editor-drive/run.sh                  # the editor, both clients, the race screen and the
                                           # whole conversation, against a live server
```

---

## Layout

```txt
unmarked/
  wiki/                                 the documents above, and the brief's SVGs
  data/config/config.yaml               site + listener. Small on purpose
  data/config/clubs/<club>/<series>.yaml points, lines, courses and races
  data/config/auth.yaml                 the login (GITIGNORED — holds a client secret);
                                        auth.yaml.example beside it shows the shape
  data/store/records/                   race records (GITIGNORED — real people's tracks)
  data/store/conduct/                   what happened in each race: the channel, the flags
  etc/sail-unmarked.service             systemd unit for the Pi
  etc/install.sh                        installs it; safe to re-run for an upgrade
  client/www/                           THE CLIENT. Capacitor webDir, and packaged as /static/
                                        so the browser fallback is the same build
    crossing.js                         >>> the crossing detector: sense, extent, QC, latch
    geo.js                              Web Mercator, tiles, pan/zoom — for the chart
    editor.html / editor.js             the course editor (shore-side)
    coursedraw.js                       course geometry: triangles, legs, arrows, tracks
    device.js / device.css              >>> THE CLIENT: join, screens, selectors. ONE copy,
                                        imported by both pages below
    boat.html / boat.js                 THE REAL CLIENT — the device, fed by this phone
    receiver.js                         navigator.geolocation as a fix. What ships
    dialog.js                           >>> the boat's half of the client-server conversation
    screens.js                          the channel, race progress, the alerts and the start row
    schema.js / schemas/*.v1.json       the wire's schemas, and a validator small enough to ship
    race.html / race.js                 RUNNING a race: the committee's screen
    results.html / results.js           what the boats sent in: races and record attempts
    client.html / client.js             THE TEST RIG, with the device sitting on its chart
    raceclient.js                       what a boat holds while sailing: live step, screen
    markscreen.js                       the Mark screen and the course overview, per brief §5
    boatsim.js                          a simulated boat and a receiver that lies (TEST RIG)
    *-test.js / *-test.html             executable specs, in a browser
  tools/run-js-tests.mjs                the same specs, in the Maven build
  tools/editor-drive/                   the pages, driven headlessly against a live server
  src/main/java/org/mortbay/sailing/unmarked/
    model/                              records: Position, NamedPoint, LineEnd, Line, CourseStep,
                                        CourseVariant, Course, Programme, Race, Fix,
                                        CrossingEvent, CourseRecord, CourseSnapshot, Ids, Geo
    dialog/                             Envelope, Dialog (sessions, rooms, standings), Schemas
    course/ProgrammeLibrary.java        loads and validates the club/series files
    course/ProgrammeWriter.java         splices YAML rather than serialising it
    store/JsonStore.java                atomic writes, journal, defensive load
    store/CourseLedger.java             snapshots taken and publications live, one JSON
                                        document per club
    server/                             UnmarkedServer, ApiServlet, DialogServlet,
                                        StaticResourceServlet, and the login:
                                        UnmarkedSecurityHandler, AuthFilter, SignedIn
    config/                             UnmarkedConfig, AuthConfig
```

The Java package stays `org.mortbay.sailing.unmarked`; only the **deployed** names — the unit, the
service user, `/opt/sail-unmarked`, `/var/lib/sail-unmarked` — carry the `sail-` prefix.

---

## Invariants a change has to respect

**Where the logic that decides a race lives.** In JavaScript, in `client/www/crossing.js`, because
that is where it runs. Its executable spec is `crossing-test.js`, run two ways from one file:
`crossing-test.html` renders it in a browser, and `tools/run-js-tests.mjs` runs it in `mvn test`.
Both *import* it rather than copying it. This is sail-jinx's `scoring.js` convention, for the same
reason: logic that decides a result and is not in the build rots.

**There is deliberately no Java implementation of crossing detection.** `Geo` does distance and
midpoint for course measurement and nothing else.

**One metre, everywhere.** `Geo.RESOLUTION_M` and `crossing.js`'s `RESOLUTION_M` are the same
number written twice and must stay that way. A finite end is a hard edge; the band of doubt exists
only about the line itself.

**One client, not two.** `device.js` is imported by both `boat.html` and `client.html`; the only
thing crossing into it on either page is a GPS fix. A second copy of the device would drift, and
the difference would be discovered on the water.

**One drawing of a course.** `coursedraw.js` serves the editor, the boat's overview and the race
screen. Two drawings would disagree, and the sailor would find out first.

**One schema per message, in `client/www/schemas/`,** read by the Java side off the classpath and
by the client over HTTP. Two copies of a schema is two schemas.

**Anything added to the programme file has to be added in FOUR places**: the model, the payload,
the writer — and the change guard in `editor.js`'s `endEdit()`, with `snapshot()` and `takeUndo()`
beside it. The fourth is the one that fails silently: everything works on screen and nothing
reaches the disk.

**The tab is the scope of an edit**, and from the Courses tab you can never change geometry for a
course you are not in without an explicit answer.

**Definition is configuration, conduct is a record**: races are defined in the series YAML, and
what happened on an afternoon goes to `data/store/conduct/`.

**Authenticate authority, trust data.** The editor, the race screen and the writes behind them need
a login; every GET, `POST /api/join`, `POST /api/records` and the whole of `/api/dialog` stay open.
A login in front of the dialog would look exactly like a working login until race day.

---

## Conventions

- **Records for models**, compact constructors for defaults and normalisation. See how
  `JinxConfig` does it.
- **Allman braces, 4 spaces**, as in both sibling projects.
- **Comments explain why, not what**, and especially why something that looks like a mistake is
  not. Both sibling projects are dense with these and they are the most valuable thing in either
  codebase.
- **Defensive loading everywhere.** A bad course file is reported and skipped, never fatal. A club
  with a typo must not take the other six clubs' racing down with it. Same for one boat's corrupt
  record versus the whole fleet's results.
- **A handled failure logs its MESSAGE, not its stack trace.** The trace goes to `debug`. A corrupt
  file is an *expected* condition on these paths, and a parse trace tells nobody anything they can
  act on where the message carries the file, line and column. A failed *write* keeps its trace,
  because that is not expected.
- **Unknown YAML/JSON properties are ignored**, so a newer file loads on an older build; the same
  rule on the wire is what lets an installed client talk to an updated server.
- **A problem is printed, never summarised.** One sentence per problem, naming the thing and the
  fix.
- **No coordinates are asserted anywhere in `data/`.** Every position is `null` until somebody
  supplies a survey. Test fixtures invent their own and say so.
- **When changing code, do a full compile and run the tests** — `mvn test` runs both the Java and
  the JavaScript, and `tools/editor-drive/run.sh` drives the pages.

---

## Open questions

None of these should be answered by asserting a number in code.

1. **Confirmation count N.** The 3-and-3 default needs tuning against real logged tracks from the
   intended waters, where multipath off the rig and nearby structures clusters. Sustained multipath
   could produce consecutive bad fixes, arguing for a higher N or a harder kinematic gate.
2. **Accuracy band.** Fixed declared width versus per-fix stated accuracy. Both are implemented;
   `accuracyBandM: null` selects per-fix.
3. **Is the end-of-line warning loud enough** on a phone in glare? The mechanism is settled and
   built — one-metre resolution, a hard edge, and `projectCog()` behind the ring that turns amber
   inside the margin and red past the end. Whether it carries is a question for somebody on the
   water.
4. **Asynchronous window width.** How far apart in time boats can sail the same loop before
   differing wind and tide mean they are not racing the same course.
5. **Distance-factor conversion.** The *mechanism* is settled; the conversion from a TCF to a length
   delta is not, and interacts with leg geometry and wind angle. Also open: how the handicap distance
   is shared when a course designates several adjustable lines.
6. **QC thresholds as configuration.** Kinematic ceiling, minimum satellites, accuracy limit — all
   currently defaults asserted against no data.
7. **Coordinate supply.** How marks are surveyed and by whom. Everything is `null` today.
8. **Impersonation, and one tier of officer.** Boats are unauthenticated by design, so any device can
   claim any sail number — dialog §13, deferred on purpose. And any account the provider vouches for
   may use the officer's screens; *some may abandon a race and others only watch* is a sensible thing
   to want that nothing enforces.
9. **Capacitor.** Not yet present. Background-geolocation behaviour, iOS Safari suspending the
   Geolocation API in the browser fallback, and plugin versions all shift; verify at build time rather
   than trusting the brief's §7.
10. **The fleet's own trust**, which is the same question one level out. `fleet` carries what boats
    said about themselves, and the race screen draws it — so a boat that misreports puts a wrong
    position on everybody's screen. The honest position today is that the fleet feed is a view rather
    than evidence.
11. **Which gate side a boat took** is recorded by the client and in the record, and nothing
    downstream uses it. On the Mark screen it shows: each side carries its own next-leg bearing.

---

## Not built yet

Of the three screens in brief §3, the **Mark** screen is built — all three states, all four
orientations, the plot and the readouts — with a **course overview** behind it standing in for the
Course screen. Both run on a real phone's GNSS at `boat.html`. **Live place** does not exist at all.

- **The Capacitor wrapper and an offline tile cache.** On the phone a background is a live fetch,
  and the browser may suspend the watch in the background.
- **Nothing is cached across a reload**, so a refresh is a fresh join and no orientation is
  remembered. On a phone that is the sharper cost: a browser reloading a backgrounded tab throws
  away a joined race mid-afternoon. `sessionStorage` is where the boat's identity already lives.
- **Re-posting the record with its track.** `RaceClient.record()` builds a thin record and the
  device sends it over the dialog when the course completes, with the *interpolated* instants.
  `record({track: true})` builds the fat one and the store supersedes rather than accumulates — but
  nothing yet waits for wifi and re-posts it.
- **The handicap is carried, not applied** (open question 5).
- **The WebSocket, `ask`, `window` and muting** — see [dialog §14.10](wiki/client-server-dialog.md).
