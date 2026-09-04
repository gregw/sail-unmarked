# unmarkable

**Sail racing around virtual marks.** Every mark is a line to be crossed via GPS rather
than a point to be rounded.

## Read this first

[`wiki/unmarkable-racing-brief.html`](wiki/unmarkable-racing-brief.html) is the design
brief and the source of truth for *what this is*. Open it in a browser — it carries the
diagrams, and the SVGs beside it are referenced from it:

| Group | Files | What they show |
|---|---|---|
| Courses | `course-2lap-wl.svg`, `course-tss.svg`, `course-triple-sausage.svg` | The line-and-triangle notation: a triangle's base on the line, apex the way you must cross, sequence letter inside |
| Mark screen | `screen-mark-approach.svg`, `screen-mark-crossed.svg`, `screen-mark-missed.svg` | One screen, three states — the approach, the latch, the miss |
| Orientation | `orient-legup-a/b.svg`, `orient-northup.svg`, `orient-lineperp-a/b.svg` | The three display orientations and what turns on a cross |
| Next leg | `nextleg-approach.svg`, `nextleg-crossed.svg`, `nextleg-missed.svg` | The top arrow, which carries the state in its colour |
| Live place | `screen-live-place.svg` | The corrected-time ladder behind the circuit format |

The brief is **provisional by its own declaration** and parts of it are explicitly marked
unverified. Where this file and the brief disagree, this file is later — the YAML schema
in brief §6 in particular has been superseded, see below.

`README.md` is the outside view. This file is the working one.

---

## The one thing to know

**A boat's own rounding and timing are computed entirely on the device and never wait on
a server.**

Everything follows from that. Crossing detection, fix quality control, and latching run
in JavaScript on the boat, from raw GNSS, with no network. The server distributes course
definitions beforehand and aggregates records afterwards. Between those two moments it
can be switched off without a boat on the water noticing.

So: if you find yourself adding an endpoint a client must call before it can score a
mark, or moving the crossing tests into Java so the server can "check" a rounding, stop —
that is the regression this architecture exists to prevent. Live circuit rankings are the
one thing boats want promptly from the server, and they are *specified* to degrade to
last-known standings for exactly this reason.

The second thing, which shapes the rules and the geometry both: **RRS 18 (mark-room)
never applies at a virtual mark.** There is no zone to reach and no inside/outside overlap
to adjudicate. That is a deliberate safety choice, not a side effect.

---

## Technology

Matches [`sail-jinx`](../sail-jinx) and [`sailing-pf`](../sailing-pf) — both symlinked at
the repo root. When a convention here is unclear, look at what those do rather than
inventing one.

| Concern | Choice |
|---|---|
| Language | Java 21 |
| HTTP server | Jetty 12 (embedded), `jetty-ee10-servlet` |
| Front end | Plain HTML + JavaScript, ES modules, no framework |
| Configuration | YAML via Jackson |
| Persistence | JSON files on disk via Jackson |
| Build | Maven |
| Client wrapper | Capacitor (planned — not yet present) |

No database, no framework, no outbound HTTP client. Port **8083** (8081 is sailing-pf,
8082 is sail-jinx, 8888 is sailing-pf's admin connector).

```bash
mvn exec:java                              # serves http://localhost:8083/ from ./data
mvn exec:java -Dunmarkable-data=/path/to/data
mvn test                                   # 57 Java tests + 212 JS assertions
node tools/run-js-tests.mjs                # just the JavaScript specs
```

---

## Layout

```txt
unmarkable/
  wiki/                                 the brief and its SVGs — the design source
  data/config/config.yaml               site + listener. Small on purpose.
  data/config/clubs/<club>/<series>.yaml points, lines and courses. See below.
  data/store/                           race records (GITIGNORED — real people's tracks)
  etc/unmarkable.service                systemd unit for the Pi
  etc/install.sh                        installs it; safe to re-run for an upgrade
  client/www/                           THE CLIENT. Capacitor webDir, and packaged as
                                        /static/ so the browser fallback is the same build
    crossing.js                         >>> the crossing detector: sense, extent, QC, latch
    geo.js                              Web Mercator, tiles, pan/zoom — for the chart
    editor.html / editor.js             the course editor (shore-side)
    *-test.js / *-test.html             executable specs, in a browser
  tools/run-js-tests.mjs                the same specs, in the Maven build
  src/main/java/org/mortbay/sailing/unmarkable/
    model/                              records: Position, NamedPoint, LineEnd, Line,
                                        CourseStep, Course, Programme, Fix, CrossingEvent,
                                        RaceRecord, Geo
    course/ProgrammeLibrary.java        loads and validates the club/series files
    store/JsonStore.java                atomic writes, journal, defensive load
    server/                             UnmarkableServer, ApiServlet, StaticResourceServlet
    config/UnmarkableConfig.java
```

### Where the logic that decides a race lives

**In JavaScript, in `client/www/crossing.js`** — because that is where it runs. Its
executable spec is `crossing-test.js`, run two ways from one file: `crossing-test.html`
renders it in a browser, and `tools/run-crossing-test.mjs` runs it in `mvn test`. Both
*import* it rather than copying it, so a check added once runs in both. This is
sail-jinx's `scoring.js` / `scoring-test.html` convention, for the same reason: logic
that decides a result and is not in the build rots.

There is deliberately **no Java implementation of crossing detection**. `Geo` does
distance and midpoint for course measurement and nothing else.

### The course editor, and the network boundary

`editor.html` places points on a chart and exports a `points:` block to paste into a
programme file. It exists because the decisions it supports are **visual and cannot
survive an interchange format**: an infinite end's second point is a handle whose only
job is to put the line's midpoint where the fleet actually crosses, and which end is
`port` follows from the sense you intend to cross. GPX carries neither. Hence the split —
**points may come from anywhere** (a GPX import is a reasonable future addition),
**lines and courses are authored here**, because their semantics don't round-trip.

It **saves as you go** — every completed edit (form blur, drag end, click-place) is
written straight back through `PUT /api/programmes/{club}/{series}/points`. **Undo holds
exactly one edit**, in memory, until reload or a programme change; the file's longer
history is git's job, not this page's.

The pane is **tabbed: Points | Lines | Courses** over a shared chart. Each tab has
**Add**, each form has **Delete**, and **deletion is refused rather
than cascaded**: a point a line still uses, or a line a course still uses, names what is
holding it instead of quietly breaking the file — which matters more than usual here,
because the save is immediate and the damage would be on disk before it was visible.

### Drawing a course

`coursedraw.js` is geometry, kept out of the editor so it can be tested without a chart,
a DOM or a map. It holds the one thing most worth pinning: **which way the apex points.**
A triangle pointing the wrong way still looks like a course diagram, so the error would
survive being looked at. The derivation, once, in `forwardNormal`: a forward crossing puts
the boat where `cross(portToStarboard, v)` is positive with y NORTH, and screen y runs the
other way, so for a screen-space port→starboard vector `(dx, dy)` the forward side is
`(dy, -dx)`. The check to re-run if ever in doubt: a line drawn left to right has its apex
pointing **up** the screen.

**Triangles are a fixed pixel size and do not shrink with the chart** — their job is to be
read. Several crossings on one line (the leeward line is start, mark 2 and finish) are
seated along it in course order. When the line is too short on screen to seat them all,
they spread at a minimum legible gap about its midpoint and overhang the ends: an
unreadable pile says nothing, an overhang still says *these crossings, in this order,
belong to this line*.

**The track is a first approximation and is not a sailed track.** It runs from the apex a
boat leaves by to the base it arrives at next, which shows the crossing sense and the leg
order. Nothing in it knows about beating, laylines, tide or which end of a long line a
boat would really choose, so a windward leg draws as a straight line no boat sails. Behind
a tickbox, because on a busy course it is a lot of ink.

**Three redundant channels, because one was not enough.** The first version drew every leg
in one colour with no direction, and a two-lap windward/leeward put four near-parallel legs
up the same beat: unreadable. Each segment now carries its position in the course as
**colour** (a green→orange→red ramp whose ends are the same green and red as the start and
finish triangles), its direction as an **arrow** at the midpoint, and the letter of the
step it leads to as a **label**. Losing any one channel still leaves the drawing readable,
which also means it survives a reader who cannot separate green from red.

**Turns have a radius.** A boat leaving a triangle's apex is still on the crossing
heading — that is what the apex means — so it cannot be on the next leg's heading the
instant it clears the line. Every leg therefore arcs out of the apex, runs straight, and
arcs back in so it is on the next crossing's heading before it reaches that base. An
instant corner would say the boat pivots on the spot. `tangentPath` builds all three parts
and iterates three times, because the departure arc has to aim at where the arrival arc
begins and vice versa; the radius shrinks on a short leg rather than the arc overshooting
the mark it is turning around. Arrows are placed on the **straight** portion, since an
arrow on a curve points wrong.

**A gate splits AT the gate**, not halfway to it: the junction is the mean of the
alternatives' bases going in and of their apexes coming out, so the trunk runs to the gate
as one line and the sides part where the choice is actually made. Splitting halfway along
the leg instead threw two long diagonals across open water that crossed each other and
everything else, which was most of why the first version could not be read. Both sides of
a gate are the same tangent path as anything else — out of an apex on the crossing
heading, onto the trunk heading at the junction, and the mirror coming back — so there is
one cornering mechanism in the file rather than two.

**Course lengths are computed by the server** and returned on both GET and PUT, so the
midpoint-to-midpoint rule has one implementation rather than two that drift. A new step
seeds itself with a line *different from the previous step's*, because repeating one makes
a zero-length leg, which the model treats as an error rather than a short leg.

**Selecting a line frames it to a fifth of the chart** (`FRAME_FRACTION`), not four
fifths. Filling the view with the line leaves it floating on featureless water; what a
line *means* is where it sits relative to the shore and the marks around it.

The global controls — **programme, chart background, undo and save state** — sit on one
bar directly above the chart they act on, rather than in a page header away from it. The
editor **opens on the Courses tab**.

**A point holds selection only on its own tab.** It stays draggable from the Lines and
Courses tabs, which is useful while laying something out, but dragging it there must not
leave it selected — otherwise every later click on the chart teleports it. Selection
belongs to the tab that edits the thing.

**The wheel zooms by how far it moved, not by how many events arrived** (`wheelZoomStep`).
A fixed step per event is what made the chart uncontrollable: a mouse notch and a trackpad
flick are wildly different amounts of intent, and a trackpad sends dozens of tiny events
per gesture, so a gentle nudge leapt several zoom levels. Deltas are normalised from all
three `deltaMode` units to pixels, scaled at 1/600 of a zoom level per pixel — about six
mouse notches to a zoom level — and clamped per event so a device reporting an enormous
delta cannot cross the world in one go.

**The pane is three surfaces, getting lighter as they get more interactive**: the pane
itself, the list of things on it, and the fields that edit one. Before that the list and
the pane were the same shade and the boundary had to be inferred from a row hover. The
lists are **one line per entry** — what a thing *is* belongs in the form below, and a
second line per row halved how many could be seen at once — except a course's length,
which the tab is required to show always and which moves onto the same line.

**A leg's marker is one thing**: a circle holding an arrowhead holding the letter of the
step it leads to. It was a circled arrow with a lettered circle beside it, which said two
things where there is one — *this leg, going that way, to there*. `ARROW_CENTROID` exists
because an arrowhead's centroid is not the point it is drawn about, so anything centring
one inside a circle has to correct for it rather than assume the two agree.

**Text inside a triangle is a darker shade of that triangle** (`darken`). A letter in the
triangle's own colour disappears wherever the two touch. That is also why the crossing
triangles are now *filled* rather than outlined: a darker letter needs something bright to
sit on. Darkening rather than lightening keeps the letter recessive — the shape carries
the direction, the letter only says which step.

**Course labels are sized to be read, and double under the pointer.** A course drawn small
enough to see whole has labels too small to read; rather than choose, the drawing does
both. Hover sets an SVG `transform` attribute directly rather than re-rendering (hover
fires constantly) and scales about the label's own anchor — for a triangle that is its
**base**, so a grown triangle stays on its line instead of lifting off it. The hovered
group is re-appended so it is not hidden behind whatever was drawn after it.

**Explanation lives in hover popups, not in the pane.** A paragraph telling you how the
pane works is read once and then permanently in the way of the list it sits above. The
pane is a flex column of three regions — tabs, list, form — each scrolling only when it
actually overflows, rather than a fixed `max-height` that put a scrollbar on a nine-row
list with room to spare.

A
line end is set three ways, because three moments want different things: choose an
existing point from the list when the mark is already surveyed; **pick on chart** and
click a point when you can see it and would rather not read ids; or click open water,
which **creates a point there and attaches it in one gesture**. That third one is how a
course gets built from nothing. Clicking near an existing point reuses it rather than
making a duplicate — two lines that share a mark must share the *point*, or a later
correction moves one line and leaves the other behind.

**`ProgrammeWriter` splices, it does not serialise, and that is the important part.**
These YAML files are documentation — they carry the explanation of what a port end is and
which crossing senses are unverified. Round-tripping a `Programme` through Jackson would
destroy all of it, silently, on the first autosave: comments are not data, so nothing in
the model holds them and nothing in the emitter can put them back. So the file is edited
as text: find the `points:` block, replace exactly that, copy everything else through.
The subtle part is where the block *ends* — a run of blank lines and top-level comments
before the next key introduces **that** key, so it is walked back over and left alone.
`ProgrammeWriterTest` pins all of this.

A **rename is followed textually** into the block that refers to it, whole-token only: a
point rename follows `at:` into `lines:`, a line rename follows `line:` into `courses:`.
An id is not a label — something else names it — so a rename touching only its own block
orphans every reference. Regenerating the referring block instead would flatten its inline
maps and comments to rewrite one word. **A rename carries a `kind`, and undo must preserve
it**: inverting a line rename as a point rename follows the wrong key and silently fixes
nothing.

**Folded notes are re-wrapped on emit.** A folded scalar joins its lines with spaces when
read, so a note written across three rows returns as one long string; writing that back
verbatim would put a 200-column line into a file people diff. Wrapping is by whole words,
so fold → unfold → fold is stable, which is what makes a second autosave a no-op.

> **Writes are unauthenticated.** `PUT .../points` rewrites a config file on disk and
> `POST /api/records` accepts anyone's race result. The PUT is at least gated by
> `server.configWrites` (default **true**, with a loud startup warning); the POST is not
> gated at all. Both need a login before this is reachable from anywhere but a desk —
> sail-jinx has a working Jetty OpenID setup to copy.

**Four chart backgrounds** (default **Sea simple**), offered by a selector built from `BASEMAPS` so the labels and
order live in one place. The two sea options share one Esri Ocean base (bathymetry,
coastline, shelf shading); **Sea chart** stacks OpenSeaMap's seamark layer on top and
**Sea simple** leaves it off. That layer is every light, beacon and buoy — invaluable
while placing a line against the real marks, and a great deal of ink once they are placed
and a course is being drawn over the top. **Plain** fetches nothing, and is what the
on-water screens use.

`geo.js` is lifted from the Geo panel of `nemesis-delta` — Web Mercator in world-[0,1]
coordinates, tiles as plain SVG `<image>` elements, no mapping library. Keep it that way:
a mapping library would bring a second geometry model to disagree with `crossing.js`.
What is new here is `MapView.toPosition()`, the inverse projection — nemesis-delta only
projects forward because it only displays, and that inverse is the whole difference
between a viewer and an editor.

> **Tiles are a network dependency, and the editor is a shore-side desk activity.**
> That is fine there. It must never leak into the Mark screen, which is offline-first and
> non-negotiable: on the water, lines are drawn on empty water or on pre-cached tiles,
> never a live fetch. The `plain` basemap fetches nothing and is what the on-water
> screens use.

---

## The course model

This supersedes the YAML sketch in brief §6, which was wrong in ways worth recording so
nobody reintroduces them.

### Lines, not marks

A virtual mark is a **line**, defined by **two points**, each with an `infinite` flag.
Never a point with a radius — that is what keeps RRS 18 out of it and what keeps GPS
error from deciding whether somebody clipped a rounding circle.

Lines live in their own section, **not inside a course**, because they are reused: a
club's start line is the same line in every course it appears in. Courses may eventually
mix real marks with virtual lines, which is the other reason the word is "line".

### Ends are named `port` and `starboard`

- **`forward`** — leave the port end to port and the starboard end to starboard.
- **`reverse`** — leave the port end to starboard and the starboard end to port.

So the required sense is legible off the line itself and there is no convention to
memorise. The names are defined *relative to a forward crossing*, so a line crossed both
ways — the leeward line that is start, mark 2 and finish — is forward once and reverse
twice.

### Sense and extent are two different tests

Keep them apart. Conflating them is what makes infinite ends sound paradoxical.

| Test | Question | Involves the ends? |
|---|---|---|
| **Sense** | Which way did the boat cross? | No. A sign test on the port→starboard orientation. |
| **Extent** | Did it cross the line, or its extension past a finite end? | Only finite ends. |

> **An infinite end is a bearing, not a place.** The lat/long you give it is a point the
> line runs *through*, not where it stops.

So the rule needs no exception: *a forward crossing leaves the port end to port and the
starboard end to starboard; an infinite end is out along the line without limit, so it is
always on the side its name says — **only a finite end can be missed***.

The Mark screen's three states are exactly the combinations: **approaching** is neither
settled, **crossed** is both passed, **missed** is sense passed and extent failed.

### Roles and letters are positional

**The first step of a course is the start and the last is the finish.** There is no
`role:` field, and there never should be — a stored role can disagree with the order. For
the same reason the sequence letters (S, 1, 2, … F) drawn on a course diagram are
*derived* from position, never written down. The two-lap windward/leeward gets S, 2 and F
onto one line for free, because that line simply appears three times.

A consequence: neither the first nor the last step may be a gate, and once real marks
exist, neither may be a mark. You cannot start or finish on a point.

### Coordinates are SignalK's

`latitude` / `longitude`, spelled out, **signed decimal degrees**, WGS84. This is not a
preference — it is `schemas/definitions.json` in the SignalK specification, where the
`deg` unit is documented as *"latitude or longitude in decimal degrees"* and
`navigation.position` is `{latitude, longitude, altitude}`. A position off a SignalK
stream therefore drops straight in with no conversion, and a conversion is where a
hemisphere gets inverted.

Degrees-and-decimal-minutes (`33 48.072 S`) is what a chart and a plotter show, so it
belongs **on screen, in both directions** — where a bad transcription can be seen by the
person who made it — and never in a file.

### Leg length, and the handle

A leg is measured **between the midpoints of consecutive lines' two defined points**.
Course length is the sum of the legs. A measured leg of zero is an error, not a short leg:
it means two steps share a reference point. `lengthNm` on a step overrides the leg *into*
that step.

The subtle part, and it is deliberate: on an infinite end the point's *distance* along the
bearing is arbitrary — sliding it leaves the line geometrically identical — so **that
point is the control handle for where the line is measured to**. Place it where the fleet
actually crosses. A course-design UI draws the leg straight to the midpoint and lets
somebody drag the handle until the course looks like the one they meant.

(The alternative rule — use the finite end of a half-infinite line, since it cannot move
without the line moving — is more stable and gives up the handle. It was considered and
rejected for that reason.)

### One metre, everywhere

**The resolution of the whole system is one metre.** Declared twice, in
`Geo.RESOLUTION_M` and `crossing.js`'s `RESOLUTION_M`, and the two must agree. Every
distance computed, displayed or scored against is rounded to the nearest metre. GNSS on a
phone does not honestly resolve better, and a scoring edge that moves with the twelfth
decimal place of a float is one nobody can argue in front of a protest committee.

The consequence is deliberate and blunt: **a finite end is a hard edge. If you miss, you
miss.** There is no unresolved state at an endpoint and no band of doubt to fall into —
that treatment is reserved for the accuracy band about the line itself, which exists to
stop a boat sitting on the line emitting phantom crossings.

What the application owes the sailor instead is **warning**. `projectCog()` reports the
margin from the COG projection's cut to the nearer finite end and flags `near-end` or
`beyond-end`, so the Mark screen can say loudly that the present course is running out
past the pin long before the boat gets there. An infinite end raises no warning, because
it is not a hazard.

### Gates are element-agnostic

A step either names a `line` and a `cross`, or holds a `gate` of alternatives, **each of
which is an ordinary step**. That is what lets a gate have a virtual line one side and a
real buoy the other once marks exist. The leg into a gate is measured to the midpoint
between its alternatives, so course length does not depend on which side a boat took — a
length that varied per boat would make the live-place axis mean different things for
different boats.

### Distance factor: sub-lines, slid along themselves

A course designates certain lines as **handicap-adjustable**, and a boat is assigned its
own **sub-line** on one. Typically a half-infinite line running along the leg direction
from a finite end, so that **the finite end is the knob**: the line exists only from that
end outward, so pushing it further out forces the boat to sail further before there is any
line there to cross. A distance-factor line is therefore something you sail *around the end
of* — closer to the brief's island rounding than to its passing mark.

**The server** computes each boat's sub-line by sliding that line's defined points *along
the line* until the resulting midpoint makes the leg before plus the leg after come to
that boat's required distance. Because both points slide together, the geometry and the
measurement move consistently: the boat really does sail further, and the course length
says so. A course may designate several such lines, in which case the handicap distance is
shared between them.

Note what this reuses. The midpoint of a line's two points is already the measurement
point, and the point on an infinite end is already a free handle that changes no geometry
— so the handicap knob is a mechanism the model already had. The server is in the
*geometry*, and still not in the *rounding*: a boat is served its own course before the
start, caches it, and detects and times its own crossings from raw GNSS exactly as before.

Not implemented. `RaceFormat.DISTANCE_FACTOR` exists and nothing computes an offset,
because how a TCF becomes a length delta is still open — see the questions below.

### One file per club and series

Courses are organised by club, and by series within a club (a whole summer, or one series
inside a season). Each file is **self-contained** — its own points, lines and courses,
resolving nothing from anywhere else — so it can be read, diffed and handed to another
club whole. The cost is that a shared reef is surveyed in each file that uses it.

The **path is the identity**: `clubs/myc.org.au/2026-summer.yaml` is club `myc.org.au`,
series `2026-summer`. A file that names them anyway is checked against the path and
complained about, never silently believed. Clubs are keyed by **domain**, following
sail-jinx and sailing-pf, so records about the same club line up across all three.

### Races are their own files

`clubs/<club>/races/<raceId>.yaml` — one night: a course chosen from the programme, the
format, that format's parameters, and the entry list. Separate from the programme because
the programme holds what is reusable all season, and filing them together would mean
opening the file with the surveyed coordinates in it every time somebody enters a boat.
A file directly under a club is a programme; one under `races/` is a race.

**The race schema is TBD** and is a placeholder that loads rather than a settled shape.
`parameters` is a free map on purpose, so a format's settings can be written down and
round-tripped before anybody has decided what they are called.

### YAML is camelCase, and the enum parsers know it

The house style is camelCase (sail-jinx and sailing-pf both), and enum constants are
`SCREAMING_SNAKE`. Every `@JsonCreator` here therefore matches **on the letters alone**,
as `JinxConfig.PenaltyScaling` does — so `format: rollingStart` finds `ROLLING_START`.
Without it the natural thing to write fails to parse, which is how it was caught.

### What the sketch in brief §6 got wrong

Recorded so it does not come back:

- **`type: finite | half_infinite`** contradicted the model. The end type belongs to each
  *end*, and a line-level `type` forced two incompatible schemas — `end_a`/`end_b` for one
  kind, `fixed_end`+`bearing_deg` for the other.
- **`cross: S`** collided with itself: `S` meant "southbound" while `S` was also the
  sequence letter for the start, one line apart in the same file.
- **Compass senses** are ambiguous for a line near-parallel to the heading, and silently
  wrong when the line is edited. `forward`/`reverse` moves with the line.
- **`marks:`** re-imported the word the whole design exists to remove.
- **`TBD`** in a float field is a parse error, not a placeholder. Unsupplied positions are
  `null`, and are reported as problems.
- **snake_case** is not the house style; sail-jinx and sailing-pf are camelCase throughout.

---

## Conventions

- **Records for models**, compact constructors for defaults and normalisation. See how
  `JinxConfig` does it.
- **Allman braces, 4 spaces**, as in both sibling projects.
- **Comments explain why, not what**, and especially why something that looks like a
  mistake is not. Both sibling projects are dense with these and they are the most
  valuable thing in either codebase.
- **Defensive loading everywhere.** A bad course file is reported and skipped, never fatal.
  A club with a typo must not take the other six clubs' racing down with it. Same for one
  boat's corrupt record versus the whole fleet's results.
- **Unknown YAML/JSON properties are ignored**, so a newer file loads on an older build.
- **No coordinates are asserted anywhere in `data/`.** Every position is `null` until
  somebody supplies a survey. Test fixtures invent their own and say so.
- **When changing code, do a full compile and run the tests** — `mvn test` runs both the
  Java and the JavaScript.

---

## Open questions

From brief §8, plus what the schema work since has raised. None of these should be
answered by asserting a number in code.

1. **Confirmation count N.** The 3-and-3 default needs tuning against real logged tracks
   from the intended waters, where multipath off the rig and nearby structures clusters.
   Sustained multipath could produce consecutive bad fixes, arguing for a higher N or a
   harder kinematic gate.
2. **Accuracy band.** Fixed declared width versus per-fix stated accuracy. Per-fix is more
   honest and gives a time-varying effective line width. Both are implemented;
   `accuracyBandM: null` selects per-fix.
3. ~~**Finite line endpoints in open water.**~~ **Answered:** one-metre resolution
   throughout, a hard edge, and loud UI warning. See "One metre, everywhere". What remains
   is making the Mark screen actually shout — `projectCog()` supplies the data, no screen
   consumes it yet.
4. **Asynchronous window width.** How far apart in time boats can sail the same loop
   before differing wind and tide mean they are not racing the same course.
5. **Distance-factor conversion.** The *mechanism* is settled — the server slides a
   designated line's points along itself until the midpoint gives the required leg
   lengths. The *conversion* from a TCF to that length delta is not: it interacts with leg
   geometry and wind angle. Also open: how the handicap distance is shared when a course
   designates several adjustable lines.
6. **QC thresholds as configuration.** Kinematic ceiling, minimum satellites, accuracy
   limit — all currently defaults asserted against no data.
7. **Coordinate supply.** How marks are surveyed and by whom. Everything is `null` today.
8. **Authentication on the two writes.** There is none on either. `POST /api/records`
   accepts a record for any boat; `PUT .../points` rewrites a course file on disk, gated
   only by `server.configWrites`. Reads should stay open — a club publishes its results —
   but a write is somebody's race result or somebody's survey. `sail-jinx` has a working
   Jetty OpenID setup to copy. **This is the blocker for deploying to the Pi.**
9. **Capacitor.** Not yet present. Background-geolocation behaviour, iOS Safari suspending
   the Geolocation API in the browser fallback, and plugin versions all shift; verify at
   build time rather than trusting the brief's §7.
10. **Which gate side a boat took** is recorded, but nothing yet uses it for the next
    leg's bearing on the Mark screen.

## Not built yet

The three screens in brief §3 — **Mark**, **Course** and **Live place** — do not exist.
`client/www/index.html` is a scaffold that proves the server serves the client and the
programme endpoints answer. The crossing detector underneath them *is* built and
specified.
