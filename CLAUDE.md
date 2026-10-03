# unmarked

**Sail racing around virtual marks.** Every mark is a line to be crossed via GPS rather than a
point to be rounded.

`README.md` is the outside view and [`wiki/overview.md`](wiki/overview.md) is how the whole
system works, with a map of the wiki and a glossary. This file is the working one: what must not
regress, where things live, and how to work on it. It does not repeat the wiki; for most questions
the file named is the answer, and the code's comments — which explain *why*, not *what* — are the
detail.

---

## Three things that must not regress

**1. A boat's own rounding and timing are computed entirely on the device and never wait on a
server.** Crossing detection, fix quality control and latching run in JavaScript on the boat, from
raw GNSS, with no network. The server hands out courses beforehand, relays the committee's side of
a race during it, and collects records afterwards — and can be switched off in between without a
boat's crossings or times changing. If you find yourself adding an endpoint a client must call
before it can score a mark, or moving the crossing tests into Java so the server can "check" a
rounding, stop: that is the regression this architecture exists to prevent.

**2. RRS 18 (mark-room) never applies at a virtual mark.** No zone, no overlap to adjudicate. A
deliberate safety choice that shapes the rules and the geometry both.

**3. The boat is trusted entirely.** Every position and instant comes from it and nothing checks
whether it told the truth; the QC gates defend against a bad receiver, never a dishonest sailor.
That works because a clock offset cancels in an elapsed time. The server does not score, call OCS,
or infer an outcome. See [dialog §1](wiki/client-server-dialog.md#1-what-is-trusted-and-what-does-not-move).

---

## Technology and commands

Java 21 · Jetty 12 embedded (`jetty-ee10-servlet`) · Jackson for YAML and JSON · Maven · plain
HTML + JavaScript ES modules, no framework, no npm build · JSON files on disk, no database ·
Capacitor planned, not present. The one outbound HTTP call is OpenID discovery at start-up when a
login is configured.

Conventions follow [`sail-jinx`](../sail-jinx) and [`sailing-pf`](../sailing-pf), which sit beside
this repository; when a convention here is unclear, look at what those do rather than inventing
one. Port **8083** (8081 is sailing-pf, 8082 is sail-jinx, 8888 is sailing-pf's admin connector).

```bash
mvn exec:java                              # serves http://localhost:8083/ from ./data
mvn exec:java -Dunmarked-data=/path/to/data
mvn test                                   # Java tests + every client/www/*-test.js spec
node tools/run-js-tests.mjs                # just the JavaScript specs
tools/editor-drive/run.sh                  # every page driven headlessly against a live server
                                           # (port 8084, on a throwaway copy of data/config)
```

**When changing code, compile and run `mvn test`, and `tools/editor-drive/run.sh` for anything a
page does.** A spec for new client logic goes in the matching `*-test.js` and is picked up by
`run-js-tests.mjs` if it exports a `run*` function; a new spec file is added to its `SPECS` list.

---

## Layout

```txt
unmarked/
  README.md, CLAUDE.md
  wiki/                                 the documents — start at overview.md
  data/config/config.yaml               site, listener, and the one boat-display setting
  data/config/auth.yaml                 the login (GITIGNORED — holds a client secret);
                                        auth.yaml.example beside it shows the shape
  data/config/clubs/<club>/<series>.yaml points, lines, courses and races — one file per series
  data/store/                           GITIGNORED — real people's data:
    records/  courses/  ledger/  conduct/  journal/
  etc/sail-unmarked.service, install.sh systemd unit and installer for the Pi
  client/www/                           THE CLIENT, packaged by Maven as /static/
    crossing.js                         >>> the crossing detector: sense, extent, QC, latch
    handicap.js                         a boat's own lines on a course handicapped by distance
    raceclient.js                       what a boat holds while sailing: the live step, the
                                        screen rule, the record
    device.js / device.css              >>> the boat's UI: join, screens, selectors. ONE copy,
                                        imported by both boat.html and client.html
    boat.html / boat.js, receiver.js    the real client, fed by the phone's GNSS
    client.html / client.js, boatsim.js the test rig: a simulated boat and a receiver that lies
    markscreen.js                       the Mark screen and the course overview
    screens.js                          the start row, the channel, Place, the alerts
    dialog.js                           >>> the boat's half of the client–server conversation
    schema.js / schemas/*.v1.json       the wire's schemas, and a validator small enough to ship
    coursedraw.js                       course drawing, shared by editor, boat and race screen
    geo.js                              Web Mercator, tiles, pan/zoom
    editor.html / editor.js             the course editor
    race.html / race.js                 running a race: the committee's screen
    results.html / results.js           what the boats sent in
    index.html / home.js                the front page, and its display of the public courses
    whoami.js, style.css                the signed-in account, shared style
    *-test.js / *-test.html             executable specs, in a browser and in mvn test
  tools/run-js-tests.mjs                the JS specs in the Maven build
  tools/editor-drive/                   the pages driven headlessly: dom.mjs is the DOM stub,
                                        serve.sh the throwaway server, drive-*.mjs the drivers
  src/main/java/org/mortbay/sailing/unmarked/
    model/                              records: Position, NamedPoint, LineEnd, Line, Direction,
                                        CourseStep, CourseVariant, Course, Race, Programme,
                                        CourseSnapshot, CourseRecord, CrossingEvent, Fix,
                                        FixVerdict, JoinMode, Ids, Geo, Handicap
    course/ProgrammeLibrary.java        loads and validates the series files; creates, renames
    course/ProgrammeWriter.java         splices YAML rather than serialising it
    store/JsonStore.java                records, archived geometry, conduct; atomic, journalled
    store/CourseLedger.java             snapshots taken and publications live, one document per club
    dialog/                             Dialog (sessions, rooms, standings), Envelope, Schemas
    server/                             UnmarkedServer, ApiServlet (REST), DialogServlet (the
                                        conversation), StaticResourceServlet, and the login:
                                        UnmarkedSecurityHandler, AuthFilter, SignedIn
    config/                             UnmarkedConfig, AuthConfig
  src/test/                             JUnit tests, and a fixture series under resources/testdata
```

The Java package stays `org.mortbay.sailing.unmarked`; only the **deployed** names — the unit, the
service user, `/opt/sail-unmarked`, `/var/lib/sail-unmarked` — carry the `sail-` prefix.

---

## Invariants a change has to respect

- **The logic that decides a race lives in `client/www/crossing.js`**, because that is where it
  runs, and there is deliberately **no Java implementation** of crossing detection — `Geo` does
  distance and midpoint for course measurement and nothing else. Its spec, `crossing-test.js`, runs
  in the browser and in `mvn test` from one file; logic that decides a result and is not in the
  build rots. → [crossing-detection.md](wiki/crossing-detection.md)
- **One metre, everywhere.** `Geo.RESOLUTION_M` and `crossing.js`'s `RESOLUTION_M` are the same
  number written twice and must stay that way.
- **One client, not two.** `device.js` is imported by both `boat.html` and `client.html`; the only
  thing crossing into it on either page is a GPS fix, and each receiver's spec pins the key set of
  a fix. → [boat-client.md](wiki/boat-client.md)
- **One drawing of a course.** `coursedraw.js` serves the editor, the boat's overview and the race
  screen.
- **One schema per message, in `client/www/schemas/`,** read by the Java side off the classpath and
  by the client over HTTP, and held to the subset both validators cover. → [dialog §10](wiki/client-server-dialog.md#10-schemas)
- **The wire and the files only ever gain fields.** Unknown YAML/JSON properties and unknown
  message types are ignored, so a newer file loads on an older build and an installed client goes on
  talking to an updated server.
- **Anything added to the programme file has to be added in FOUR places**: the model, the editor's
  payload, `ProgrammeWriter` — and the change guard in `editor.js`'s `endEdit()`, with `snapshot()`
  and `takeUndo()` beside it. The fourth fails silently: everything works on screen and nothing
  reaches the disk.
- **The programme file is documentation.** `ProgrammeWriter` splices the blocks it changes and
  copies every other byte through; never round-trip a file through Jackson.
- **The tab is the scope of an edit**, and from the Courses tab you can never change geometry for a
  course you are not in without an explicit answer. → [course-model.md](wiki/course-model.md#the-tab-is-the-scope-of-the-edit)
- **A snapshot never changes, and a boat is handed only what was published.** Editing a mark
  changes nothing on the water until somebody publishes. Snapshots outlive everything that made
  them.
- **Definition is configuration, conduct is a record**: races are defined in the series YAML, and
  what happened on an afternoon goes to `data/store/conduct/`.
- **Authenticate authority, trust data.** The editor, the race screen and the non-GET writes on
  `/api/programmes`, `/api/lifecycle` and `/api/conduct` need a login; every GET, `POST /api/join`,
  `POST /api/records` and the whole of `/api/dialog` stay open. A login in front of the dialog would
  look exactly like a working login until race day. → [deployment.md](wiki/deployment.md)
- **Nothing is scored here.** Results are computed on read from the records and ordered by elapsed
  time; places, penalties and protests belong to the club's software.

---

## Conventions

- **Records for models**, compact constructors for defaults and normalisation (see sail-jinx's
  `JinxConfig`).
- **Allman braces, 4 spaces** in Java, as in both sibling projects.
- **Comments explain why, not what**, and especially why something that looks like a mistake is
  not. They describe the code as it is: **no history** in comments or documents — not what it used
  to do, not how a bug was found. A test may say what it guards against.
- **Defensive loading everywhere.** A bad course file is reported and skipped, never fatal; one
  boat's corrupt record must not empty the fleet's results.
- **A handled failure logs its MESSAGE, not its stack trace**; the trace goes to `debug`. A corrupt
  file is an expected condition on these paths. A failed *write* keeps its trace.
- **A problem is printed, never summarised.** One sentence per problem, naming the thing and the
  fix.
- **An id is a key, not a label**: lowercase kebab-case (`model/Ids.java`, mirrored by `slug()` in
  `editor.js`). Reported by the server, corrected by the editor, refused only where it becomes a new
  path.
- **Nothing in `data/` is a survey.** The sample series carry positions placed by eye on a chart; a
  position nobody supplied is `null` and reported. Test fixtures invent their own and say so.
- **Section references** like `§8.2` in code are to `wiki/client-server-dialog.md`, whose numbering
  is stable; `brief §5` is `wiki/unmarked-racing-brief.html`; open questions are numbered in
  `wiki/open-questions.md`.

---

## What is not built, and what is not decided

Not built: the Capacitor wrapper and an offline tile cache; the brief's Live place picture; caching
a joined race across a reload; the boat switching to a course change or to the next race's course;
re-posting a record with its track; the WebSocket, `ask` and muting; a club entering its
fleet's TCFs in advance, rather than each boat declaring its own at the join. The dialog's list,
with reasons, is [dialog §14](wiki/client-server-dialog.md#14-where-it-lives-how-it-is-tested-and-what-is-not-built).

Not decided: [`wiki/open-questions.md`](wiki/open-questions.md). None of those should be answered
by asserting a number in code.
