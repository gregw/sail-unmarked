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

[`wiki/course-lifecycle.html`](wiki/course-lifecycle.html) is its companion and is
**settled**: course / variant / snapshot, named versus ad-hoc geometry, the tab as the
scope of an edit, derived dirty state, snapshot versus publish, and templates. The brief
says what a virtual mark is; that says how a set of them gets published and kept honest.
Summarised under "The course lifecycle" below — read the document for the reasoning.

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
mvn test                                   # 109 Java tests + 570 JS assertions
node tools/run-js-tests.mjs                # just the JavaScript specs
tools/editor-drive/run.sh                  # the editor and the client, driven against a
                                           # live server (217)
```

---

## Layout

```txt
unmarkable/
  wiki/                                 the brief, the lifecycle note and their SVGs
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
    client.html / client.js             THE PROTOTYPE CLIENT, and the rig that drives it
    raceclient.js                       what a boat holds while sailing: live step, screen
    markscreen.js                       the Mark screen and the course overview, per brief §5
    boatsim.js                          a simulated boat and a receiver that lies (TEST RIG)
    *-test.js / *-test.html             executable specs, in a browser
  tools/run-js-tests.mjs                the same specs, in the Maven build
  tools/editor-drive/                   the editor, driven headlessly against a live server
  src/main/java/org/mortbay/sailing/unmarkable/
    model/                              records: Position, NamedPoint, LineEnd, Line,
                                        CourseStep, CourseVariant, Course, Programme, Fix,
                                        CrossingEvent, CourseRecord, CourseSnapshot, Geo
    course/ProgrammeLibrary.java        loads and validates the club/series files
    store/JsonStore.java                atomic writes, journal, defensive load
    store/CourseLedger.java             snapshots taken and publications live, one JSON
                                        document per club — see the lifecycle below
    model/Ids.java                      what may be used as an id, in one place
    server/                             UnmarkableServer, ApiServlet, StaticResourceServlet
    config/UnmarkableConfig.java
```

### Where the logic that decides a race lives

**In JavaScript, in `client/www/crossing.js`** — because that is where it runs. Its
executable spec is `crossing-test.js`, run two ways from one file: `crossing-test.html`
renders it in a browser, and `tools/run-js-tests.mjs` runs it in `mvn test`. Both
*import* it rather than copying it, so a check added once runs in both. This is
sail-jinx's `scoring.js` / `scoring-test.html` convention, for the same reason: logic
that decides a result and is not in the build rots.

There is deliberately **no Java implementation of crossing detection**. `Geo` does
distance and midpoint for course measurement and nothing else.

### The course editor, and the network boundary

`editor.html` authors points, lines and courses against a chart and writes them straight
back into the programme file. It exists because the decisions it supports are **visual and
cannot survive an interchange format**: an infinite end's second point is a handle whose only
job is to put the line's midpoint where the fleet actually crosses, and which end is
`port` follows from the sense you intend to cross. GPX carries neither. Hence the split —
**points may come from anywhere** (a GPX import is a reasonable future addition),
**lines and courses are authored here**, because their semantics don't round-trip.

It **saves as you go** — every completed edit (form blur, drag end, click-place) is
written straight back through `PUT /api/programmes/{club}/{series}` — points, lines and
courses in one body, because one gesture can change two of them. **Undo holds
exactly one edit**, in memory, until reload or a programme change; the file's longer
history is git's job, not this page's.

**The pane is a drill-down, and every command lives on its level's row.**

```txt
▸ myc.org.au/2026-example                  series   — breadcrumb + ⧉ ✕
    (the series list opens HERE, above the tabs)
[ Points | Lines | Courses ]               the tab strip, at the SERIES level
▸ manly-to-shark        ●dirty    + ⧉ ✕    course
    (the course list opens here)
▸ div-1                 ●current  + ⧉ ⚐ ✕  variant
    (the variant list opens here)
  Snapshot   Publish latest                variant lifecycle
▸ div-1/2027-06-06      ●published  ⧉ ↑ ✕  snapshot
    (the snapshot list opens here)
  …message…
──────────────────────────────────────
  one level's fields
```

**A level's list opens directly under that level's own row**, not in one slot at the bottom
of them all. That slot was wrong in two visible ways: the series list opened *below* the tab
strip it is choosing for, and the variant list opened below the course it belongs to and
above that course's own fields. The slot is not emitted at all when nothing is open, rather
than emitted and hidden, so no empty box is left behind.

**An open row names the level; a closed one names the selection.** Open, the selected item
is right below in the list and highlighted, so putting it in the row as well read like two
entries. Closed, the row *is* the selection, with its state chip, so a dirty course stays
visible from the top of the pane.

**Choosing from a list does not close it, and several may be open at once.** The chevron is
the only thing that opens or closes (`isOpen()`: an explicit answer if there is one, else
open while that level has nothing chosen). A list that shut itself the instant it was used
made choosing again — comparing two variants, say — cost two clicks. Each open level gets
its **own** container (`#list_series`, `#list_course`, …), because one shared slot would
have them overwrite each other.

**Which level the form shows is tracked, not derived** (`state.focus`). With several lists
open there is no longer a single "level you are pointing at". Focus follows what was
actually reached: picking a single-design course lands on its *design*, not on the course's
three fields, and adding a course lands on the empty sequence it exists to be given.

**Lists are a fixed height and can be dragged.** A list that grew and shrank as things were
selected moved everything below it on every click, so the button you were about to press was
never where you last saw it. `resize: vertical` puts a grip in the corner; the height is
kept in `state.listHeight` and re-applied, because the rows are re-rendered and the inline
height the browser wrote would otherwise be lost on the next pan.

Each level collapses to a breadcrumb once chosen, and **exactly one list is expanded** —
whichever level a chevron opened, or else the deepest one with nothing chosen yet
(`openLevel()`, derived, so there is no state to fall out of step with the selection).
Reopening a level does not clear the selections below it. With a variant chosen there is
nothing left to list, so `#listWrap` hides and the form takes the height — which is the
whole point, since vertical space is what a 495px pane is short of.

**The tabs sit at the series level, as siblings of Courses.** Points and lines belong to the
programme file, not to a course, and the Points/Lines tabs edit them *club-wide on purpose*
— that is the scope rule the model rests on. Putting them under a course would say "this
course's points", and a newly surveyed point that no course uses yet would have no course
to reach it through.

**A course with one design opens straight onto it**; one with several leaves the variant
unchosen, which opens the variant list. So nobody editing an ordinary club course has to
learn the word "variant", and nobody editing a course that has several can forget to say
which one.

**A level's fields sit under that level's list, not at the bottom of the pane.** The series
and course forms render inline (`#seriesForm`, `#courseForm`), so the variant list sits below
the course's fields and closing the course chevron puts the list and the fields away
together — there is one thing there, not two. Only the deepest thing (a point, a line, a
variant) uses the bottom region.

**The row markup is re-assigned only when it changes.** It now contains form fields, and
rewriting it on every pan would take the caret out of whatever somebody was typing. Two
consequences to respect, both of which have already bitten:

- **Every command handler resolves the course and variant at click time**, never from the
  enclosing render's closure. Selecting a different variant does not change the row markup
  while its list is open, so a captured one would go stale and the commands would act on the
  wrong design.
- **Each container re-wires its own buttons, beside the assignment that destroyed them**
  (`wireRow`). `#rowSeries` and `#rows` are rebuilt on independent conditions; wiring the
  series chevron under the guard that watches `#rows` left it dead on every render that
  rebuilt one and not the other — which is why a series could not be changed after editing a
  course.

> The stub in `tools/editor-drive/` **forgets an element when the innerHTML holding it is
> reassigned**, because a stub that kept answering for a replaced node could not see that
> class of bug at all — and did not, until it was taught to.

**The form holds fields only.** Every command that acts on a level is on that level's row at
the top; buttons that edit a *field* — add a step, flip a crossing sense — stay beside the
field they act on. Before this, Add and Delete for a course were at the top while Snapshot,
Publish and Delete variant were at the bottom, with a scrolling sequence editor between
them: two conventions in one pane, and half the commands below the fold.

**A rename saves itself, and does not wait for the blur that would normally do it.** The form
saves on blur, which is right for every field except the id: a rename re-renders, and the
re-render destroys the very input the browser is in the middle of leaving, so the `blur` that
would call `endEdit()` lands on a detached node or never fires. The edit then lived in memory
only — the editor showed the new id while the file kept the old one, which surfaces as a
variant with **no length** (lengths come back from the server keyed by the id it knows) and a
**404 on the next snapshot**. All four renames — point, line, course, variant — now call
`endEdit()` themselves before rendering; a later blur is a no-op, because `endEdit` clears the
edit it saved. `drive-rename.mjs` fires `change` with **no blur behind it**, which is the real
sequence once the node is gone.

**The race-morning pair sits with the public tickbox, where the scope is the COURSE.** A line
moved at eight in the morning dirties every variant that stands on it, and the editor made you
do those one at a time — walking the list and hoping none was missed, on the morning there is
least time to walk a list. **Snapshot dirty** captures every variant of the course that
has changed or was never captured, and says how many are waiting; **Publish latest** hands the
fleet the newest capture of each. The per-variant *Publish latest* is gone; per-variant
**Snapshot** stays, because capturing one design is still a thing worth doing on its own.

> **Anything on a form that depends on state moving underneath must be SYNCED, not baked into
> the markup.** Both forms are guarded on identity — `renderCourseFields` returns early while the
> same course is selected — because the guard exists to keep the caret in whatever somebody is
> typing. That caught the race-morning buttons: their disabled state was computed from the
> lifecycle when the course was first drawn, so a variant going dirty under them updated the
> row's chip, which is rebuilt, and left the button that acts on it greyed out. The state was
> right everywhere except on the control for it. `syncCourseForm` now owns both, and is called
> after every render rather than only from the paths that reach the end of a form.

> **Publishing several variants is ONE request, and that is the whole point.** The pointers
> commit in a single atomic write, so three variants change together or not at all — fleets
> sailing to inconsistent instructions is a thing nobody on the water can detect. Snapshotting,
> by contrast, loops deliberately: a capture is private until something is published, so a run
> that got half way through has simply captured half of them and can be pressed again. No
> revision is named on the publish, which the endpoint reads as "whatever was last captured" —
> exactly the race-morning intent, and why the two buttons pair.

**Deletion is refused rather than cascaded**: a point a line still uses, or a line a course
still uses, names what is holding it instead of quietly breaking the file — which matters
more than usual here, because the save is immediate and the damage would be on disk before
it was visible.

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
up the same beat: unreadable. Each segment now carries a **colour**, its direction as an
**arrow** at the midpoint, and the letter of the step it leads to as a **label** — on
*every* arrow, the branches of a gate included, since one lettered and one bare said the
two halves of a split were different kinds of thing.

**Legs are coloured by what they are FOR, not by sequence position** (`ROLE_COLOUR`). A
leg that leaves a step a lap may begin at is **green**, one that arrives at a step a lap
may end at is **red**, everything between is one neutral **blue**. Sequence position was
the wrong quantity: on a cycle there is no sequence to be far through, and even on an open
course the useful question is not "how far along" but "does a lap start here". A leg that
is *both* — which a cycle's entry point always is — draws as an SVG **gradient** from green
to red along its own length.

**A cycle's track closes.** `track(steps, {closed})` adds a leg from the last mark back to
the first; drawing a loop open leaves the one gap a boat never sails.

**Turns have a radius.** A boat leaving a triangle's apex is still on the crossing
heading — that is what the apex means — so it cannot be on the next leg's heading the
instant it clears the line. Every leg therefore arcs out of the apex, runs straight, and
arcs back in so it is on the next crossing's heading before it reaches that base. An
instant corner would say the boat pivots on the spot. `tangentPath` builds all three parts
and iterates three times, because the departure arc has to aim at where the arrival arc
begins and vice versa; the radius shrinks on a short leg rather than the arc overshooting
the mark it is turning around. Arrows are placed on the **straight** portion, since an
arrow on a curve points wrong.

**A gate's alternatives are seated in OPPOSITE orders along their lines.** A proper gate
has its two lines mirrored, so seating them the same way puts each rounding's two triangles
at opposite ends and their midpoint collapses onto the centre between the lines — every
rounding of that gate then splits from the same half-pixel and the paths draw on top of
each other. Reversing one line pulls them apart: measured on the real gated course, two
roundings that split 0.5px apart now split 21px apart.

**A gate splits AT the gate but joins well down the leg**, and the asymmetry is the point.
The split junction is the mean of the alternatives' bases, so the trunk runs to the gate as
one line and the sides part where the choice is actually made — splitting halfway along the
leg instead threw two long diagonals across open water that crossed everything else. The
**join** sits `MERGE_FRACTION` (0.85) of the way along the *next* leg, measured to the next
crossing or to the midpoint of the next gate. Converging the instant the gate is cleared
drew boats rejoining at the mark they had just left, which is not what happens: having
taken different sides they sail their own line and only come together near the mark ahead.
A choice is made at the gate and paid for over the leg that follows, and drawing it
symmetrically hid that.

Both sides of a gate are the same tangent path as anything else — out of an apex on the
crossing heading, onto the trunk heading at the junction, and the mirror coming back — so
there is one cornering mechanism in the file rather than two.

**Course lengths are computed by the server** and returned on both GET and PUT, so the
midpoint-to-midpoint rule has one implementation rather than two that drift. A new step
seeds itself with a line *different from the previous step's*, because repeating one makes
a zero-length leg, which the model treats as an error rather than a short leg.

**Selecting a line frames it to a fifth of the chart** (`FRAME_FRACTION`), not four
fifths. Filling the view with the line leaves it floating on featureless water; what a
line *means* is where it sits relative to the shore and the marks around it.

The bar directly above the chart carries what acts **on the chart** — background, undo and
save state — and nothing else. **The programme selector is not there**: choosing a club and
series is choosing a *scope*, not a chart control, so it sits at the head of the pane's
hierarchy instead. The editor **opens on the Courses tab**.

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
**base**, so a grown triangle stays on its line instead of lifting off it.

**A hover lights the whole STEP, not the one shape under the pointer.** Every course mark
carries `data-group="step-N"`, keyed by the step a leg *leads to* — so the leg's trunk,
both branches where it is a gate, and every triangle those branches reach light together.
They all carry the same letter, and lighting one and not the others invites the reader to
wonder which of them the letter belonged to. The whole group is re-appended so it clears
everything drawn after it, with the hovered shape moved last so it is topmost of its own
group as well.

**Every list is sorted by id** (`byId`), the pane's as well as the dropdowns'. File order
was the order somebody authored things in and was worth keeping while the lists were short;
they are not short any more, and a list you have to read all of is not one you can find
anything in. **The file keeps its own order regardless** — the writer emits the map it is
given, and nothing in the editor reorders what is on disk.

**Hide unused** (courses tab only) draws just the lines the selected course uses and the
points that are their ends. A club's water carries every line it ever races, and reading
one course off a chart with all of them on it is the problem this solves. With no course
selected it shows everything rather than nothing — a filter that emptied the chart would
read as a bug.

**The sequence folds, and folded it still answers for itself.** It is the longest thing in
the pane and the one most often already known — somebody who came back to move a mark is not
re-reading the course — so its heading is a chevron. Closed it shows **how many lines and how
far**, which are the two questions worth asking from outside it, and takes the Add buttons
with it, since adding a step you cannot see is not something to offer. The count is of
**rows, not steps**: a gate is one step and two lines to cross, and a count that disagreed
with what unfolding shows would be worse than none. It folds through `isOpen`/`toggle` like
every list in the pane, even though it is a field group rather than a level, so there is one
mechanism rather than two — and **the fold is part of the form's render key**, because the
key exists to stop needless rewrites taking the caret out of what somebody is typing, and one
that did not know about the fold would call the folded form identical and never redraw it.

**Explanation lives in hover popups, not in the pane.** A paragraph telling you how the
pane works is read once and then permanently in the way of the list it sits above.

**An id sits beside its long name, 40:60.** They are the same thing said twice — the key
and the label — and stacking them cost two label rows and two field rows near the top of
every form, four rows of the one thing a 495px pane is short of. 40:60 because an id is
kebab-case and short by rule while a long name is prose. All five forms that have the pair
use `.idname`: point, line, series, course and variant.

**The pane is ONE scrolling surface**, not a column of regions that each scroll. The rows
and the form were two flex children with a bar apiece, which split 495px into two short
windows — so reaching a field could mean scrolling the wrong one, and the two bars asserted
that the halves were separate things when they are one drill-down: the level, and that
level's fields. The rule above the form is a separator now, not the top of a second region,
and it needs no height floor because it no longer competes with the rows for height. The one
box that still scrolls inside it is a **list slot**, which is a fixed-height resizable box
on purpose.

**Starboard is offered before port, and adding a line arms the chart.** A forward crossing
leaves the starboard end to starboard, so placing that end first fixes which way the line is
crossed and the port end follows from it. Adding a line arms the starboard pick immediately
and chains to port the moment starboard lands, so **a new line is two clicks on the chart
and nothing else** — stopping between the two halves of one gesture only to press an arm
button again is a click nobody meant to make.

**A line end is either NAMED or INLINE**, and the distinction is the same one the course
model draws one level up: naming is identity, not sharing. A named end is a point from the
club's list, so two lines that share a mark share the *point* and a later correction moves
both. An inline end is a position belonging to this line alone — the right answer for the
handle that only exists to give an infinite end its bearing, or a corner nobody will ever
refer to.

So **clicking open water names nothing**; it gives the end an inline position. It used to
manufacture a point (`manly-cove-starboard`, and so on), which filled the club's list with
names nobody had chosen and nobody referred to. **Clicking near an existing point still
reuses it** — that is the one case a click names something, and it has to, or two lines that
meet at a mark would drift apart on the next correction.

An end is set four ways, because four moments want different things: choose an existing
point from the list; **pick on chart** and click a point when you can see it and would
rather not read ids; **pick on chart** and click open water for a position of its own; or
press **inline** on an end that names a point, which copies that point's coordinates in and
lets go of the name — so the line does not move as it detaches. The reverse needs no second
button: choosing a point from the selector puts the end back to named, and neither shape is
a trap.

**Every drag handle is drawn last** (`HANDLES`, filled by `renderLines` and emitted after
everything else). The next line in the loop, the course's legs and triangles, the points and
the bearings all draw over the lines, and a handle buried under any of them is one you
cannot hit. The midpoint grip is twice the size of the plain midpoint dot — 20px to hit,
6px to see — because it is a *target* sitting in the middle of the course rather than a
marker.

**An inline end is dragged on the chart, and a line loose at both ends moves bodily.** A
named end needs no handle — its point is already draggable, and two handles on one place
would be two ways to do one thing. An inline end has no point standing for it, so without a
grip the only way to move one would be to type coordinates. When *both* ends are inline the
line belongs to nothing else, so its midpoint moves the whole thing — by the drag, not to
the cursor, or taking hold anywhere but dead centre would jump it further than the gesture
asked for. Neither grip appears on the Points tab: the tab is the scope, and a line is not
what is being edited there.

Dragging a shared line's end from the Courses tab asks the same question a shared point
does (`moveLine`), and `detachLine` is the answer's ad-hoc branch. It is simpler than
detaching a point because the sequence names a line directly — no second level of reference
to follow — and the copy's ENDS come across as they are, so a named end stays named and
still moves when the club moves that mark. Only the thing actually detached is detached.

**The cursor says what the chart will do.** An arrow over open water, a hand over a handle,
a closed hand while something is moving, a crosshair while a click is armed to place
something. It used to be an open hand everywhere, which said "all of this is draggable" —
true of the pan, and misleading about everything else.

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

> **A VARIANT IS NOT A DIVISION.** A division is one *reason* to have a variant; a short
> course, a big-sea course and a big-fleet course are others, and the model knows about none of
> them — it knows about variants. So the word in the UI, in the code and in these notes is
> **variant**, and "division" appears only as an example of one, never as a synonym. Divisions
> get the word back when something actually supports them.

### An id is a key, not a label

`model/Ids.java` holds the rule, and `slug()` in `editor.js` mirrors it. **Lowercase
kebab-case, letters or digits at both ends**, 64 characters:

| Id | Rule |
|---|---|
| course, variant, series | `[a-z0-9]([a-z0-9_-]*[a-z0-9])?` |
| point, line | the same, plus `/` as a scope separator — `manly-to-shark/windward` |
| club | the same, plus `.` — it is a domain |
| boat | unconstrained; it comes off the wire from a boat we do not control |

Constrained because an id ends up in four kinds of place that each have their own idea of
what a character means: **filesystem paths** (`records/{club}/{course}/…`), **URL path
segments** (the servlet splits on `/`), **composite keys and labels**
(`series/course/variant`, and a snapshot's `course/variant/datetime` name), and **YAML
mapping keys** — where a colon does not produce a bad id, it produces a *broken file*, on
the next autosave, silently. Only points and lines may carry a `/`, because they are the
only ids that reach none of the first three.

**Reported by the server, corrected by the editor.** A file with `div 1` in it still loads
and works and says so in `problems()` — the same defensive rule as everywhere else, since
one typo must not take a club's racing down. The editor slugs an id as it is typed and says
what it changed, so a bad id is fixed in front of the person who wrote it.

> **A problem is printed, never summarised.** `index.html` used to show the problem *count*
> beside a guess at the cause — "positions not yet supplied" — which was wrong the moment
> anything else went wrong, and sat under the course list so it read as an accusation
> against whichever course happened to be last. The server writes one sentence per problem
> naming the thing and the fix; the page's job is to show them.

**The one exception is creating a file**, where the id becomes a *new path*: there it is
refused. See `ProgrammeLibrary.resolve`.

`ProgrammeWriter.key()` emits a legal id bare — so no real file changes by a byte — and
quotes an illegal one, so a hand-edited oddity round-trips instead of corrupting the file.
`JsonStore.safe()` remains as a second line of defence and still *mangles* rather than
rejects, which is right for a boat id and is why club and course ids are checked earlier.

### The series is editable too

`POST /api/programmes` creates one, empty or **cloned**; `POST …/rename` renames or
retitles; `DELETE …` retires. All gated by `server.configWrites`.

**A clone is a byte copy.** That is the whole point of it: a club starting next summer from
last summer's file wants its banner comments and folded notes, and a serialise-and-emit
would throw away exactly what it was cloned for. Only the `name:` line is rewritten,
textually.

**A rename must follow into the ledger**, whose publication keys embed the series
(`CourseLedger.renameSeries`). Records need no migration — they are filed
`records/{club}/{course}/{date}/…`, with no series in the path. **Club rename is not
offered**: a domain does not change, and if one did it would be a migration across every
record path and the ledger's own filename.

**Retiring a series keeps its snapshots**, like every other delete here, and is **refused
with a 409 naming what is published** unless forced — deleting a programme boats can still
join is a decision, not a keystroke. The 409 carries a JSON body rather than an HTML error
page, because the editor has to name those courses in the dialog it asks with.

> **Writes are unauthenticated.** `PUT /api/programmes/{club}/{series}` rewrites a config
> file on disk, `POST`/`DELETE /api/programmes...` create and retire whole series, the two
> `/api/lifecycle/...` posts decide what a fleet is handed, and
> `POST /api/records` accepts anyone's race result. All but the last are gated by
> `server.configWrites` (default **true**, with a loud startup warning); the POST is not
> gated at all. All need a login before this is reachable from anywhere but a desk —
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

### The prototype client, and the seam under it

`client.html` is two panels and **the split between them is the whole point of the page**.
Left is a test rig: a chart, a boat that sails where it is clicked, and the knobs that decide
what its receiver reports. Right is the client, which is the thing that would ship. **Exactly
one thing crosses between them, and it is a GPS fix** — a position, a time, a stated accuracy,
a satellite count, SOG and COG, which is all a real receiver would hand over either.

So there is one function, `emit()` in `client.js`, whose body would be replaced by a
`navigator.geolocation` callback to put this on the water, and nothing in `raceclient.js`,
`markscreen.js` or `crossing.js` would change by a character. A test client that shared state
with the thing it tests is a demonstration, not a test — and the seam is *asserted*, twice:
`boatsim-test.js` pins the exact key set of a fix, so it cannot grow one convenient extra
field at a time, and `drive-client.mjs` **takes the network away between joining and
finishing** — `fetch` is replaced with something that throws — and sails the whole course with
it gone. The architecture's central claim was previously only in a comment, which is to say
nobody was checking it.

**GNSS error WANDERS; it does not shimmer, and modelling it as white noise is the most
misleading thing a simulator can do.** Independent draws per fix make the plotted dots hop
about the truth like nothing any receiver has produced — at 5 Hz the display is confetti. A
real receiver sits a little way off and *stays* there: the error is dominated by satellite
geometry, ionospheric delay and multipath off the rig and the shore, none of which changes
between one second and the next. So the bias is a first-order Gauss-Markov process
(`CORRELATION_S`, 45 s) — an exponentially correlated random walk with a fixed long-run spread
— plus a small genuinely white component (`WHITE_FRACTION`, 6% of the variance) for the
receiver noise that makes the dots shimmer slightly while the bias holds. At a stated 2 m that
is a cloud sitting about 2.5 m off the truth with under a metre between consecutive fixes.

> The correlation is in **time**, not in fixes, so raising the update rate does not make the
> receiver noisier — which is both correct and the thing a per-fix model gets most obviously
> wrong. It also means a boat crosses a line under a roughly *constant* offset, which is the
> case that matters: a steady offset moves the crossing **instant**, where white noise would
> merely have added spread either side of the truth and averaged out. And a long gap forgets
> the bias almost entirely, which is part of why a re-acquisition looks like a jump.

**The receiver lies, on purpose, because a perfect boat exercises none of the code that
matters.** With no noise every fix resolves cleanly, the accuracy band never does anything,
quality control accepts everything for ever, and the 3-and-3 latch confirms instantly every
time — the most important logic in the application never once touched by the thing built to
exercise it. So there are two knobs beyond speed and update rate. **Noise** scatters every fix
by a metre or twenty, which is what makes a boat sitting on a line stop resolving to a side.
**Flyers** put one fix hundreds of metres away — and that is the one that matters, because a
flyer landing on the far side makes the segment out and the segment back *both* cut the line,
manufacturing a matched pair of crossings the boat never made. A flyer still reports a small
`accuracyM`, deliberately, because real ones do: that is exactly why the metadata pre-filter
is necessary and not sufficient, and why the kinematic gate behind it is the one that earns
its keep. The generator is seeded, so a run can be repeated — a test client whose failures
cannot be reproduced is a worse instrument than none.

**The sailor never asks for the Mark screen.** On a boat the hands are busy, and which screen
matters right now is a decision the application is better placed to make than the person
steering: it knows where the line is and they are looking at the water. So the screen follows
the situation (`RaceClient.view`), and the rule is worth stating because neither obvious
quantity works alone. A **fixed radius** hands a drifting boat the Mark screen four minutes out
and a skiff thirty seconds out for the same number of metres. A **pure time-to-line** is
meaningless the moment a boat slows, stops, or points away, and would flick the screen about on
every lull. It is therefore the OR of the two — 200 m, or 45 seconds at the speed being made —
and each covers the other's blind spot: the radius is the floor that works at any speed, the
time is what gets the screen up early for a boat coming in fast.

Three details around it, each of which was a bug first:

- **The screen is given back at 320 m, not 200.** Without that gap a boat holding station near
  a start line — which is what a fleet does for the five minutes before a gun — flips between
  the two screens on GPS noise alone, several times a minute.
- **The hysteresis resets on every advance.** A new mark is a new approach. Carrying the flag
  over meant that having held the screen through one crossing, the *next* mark was judged at
  the exit threshold rather than the enter one, so a mark three hundred metres off took the
  screen the instant the last one was cleared — and on a short course it never gave it back.
- **The dwell does not prime the hysteresis.** The Mark screen is held for six seconds after a
  latch, because the interpolated instant is the one thing on it somebody wants to look at
  twice and it carries what a protest would turn on. That hold is its own reason to be there
  and must not also count as "the boat is near this mark".

**Only the live step sees fixes.** A course is a sequence and the sequence is the model: on a
two-lap windward/leeward the leeward line is the start, mark 2 and the finish — one line, three
steps, each with its own detector — so a boat crossing it on the way to the first windward mark
cannot latch a finish it will not reach for another twenty minutes. Both sides of a **gate** get
a detector and both see every fix; the first to latch is the side the boat took, the other is
abandoned, and which it was is recorded because the next leg's bearing depends on it. On a
**cycle** the detectors are rebuilt at each wrap: a detector latches once and stands, which is
right within a lap and wrong across them.

**The overview always says what the boat is steering for: BTW, DTW and the line's NAME.** The
name because that is what a course is discussed in — the sailing instructions and the club's
chart both talk about the leeward line, never about "mark 2" — so a letter alone leaves the
one identifier everybody else uses off the screen. It gets its own row rather than a readout
cell, because a scoped id like `manly-to-shark/windward` does not fit in a box built for a
number, and **both** names are shown at a gate, since until the choice is made both are the
target.

> **DTW is to the MIDDLE of the next line and is not the perpendicular distance to it.** The
> two answer different questions and the screen needs both: perpendicular distance is "how
> close am I to crossing", which is what decides when the Mark screen takes over; DTW is "how
> far have I got to sail", which is what somebody navigating a leg steers by and what the
> published leg length is measured as. Four hundred metres off to one side of a line they
> differ by two hundred metres. On a gate DTW runs to the mean of the alternatives' midpoints
> — the same point the model measures a leg into a gate to — so DTW and the course's own leg
> length are one quantity rather than two that nearly agree.

**DTW switches units at a fifth of a mile**, nautical miles above and metres below. A single
unit is wrong at one end or the other: `0.03 nm` is not a number anybody steers by in the last
hundred metres, and `1 483 m` is not how a leg is described. Switching is only safe because the
unit is printed beside the figure every time — the same readout with a bare number would be a
trap. Bearings are **true** throughout, because there is no variation model anywhere in this
system and a readout that was magnetic in one place and true in another would be worse than one
that is consistently the harder of the two to steer by.

**The overview is drawn with the editor's own `coursedraw`**, not a second drawing of the same
geometry. The course a boat sees on the water and the course it was designed as must be the
same picture, and the first time two drawings disagreed the sailor would be the one who found
out.

**The approach plot HOLDS STILL and the boat moves across it** (`PlotView`, `HOLD`). Re-fitting
every frame centres the picture on something that moves with the boat, so the boat stays in the
same pixels however fast it is sailing — and whether you are actually closing the line, which is
the one question the approach view exists to answer, is the one thing it then cannot say. Worse,
the line slides under a stationary boat, which reads as the mark moving.

**What must stay in view is a precise list, and nothing else decides the fit**: the boat, the
crossing point where the COG projection cuts, the triangle on the line, the next-leg arrow, and
the **last three** fixes behind the boat. Fitting on anything more kept the plot uselessly wide —
the line's ends, which on a quarter-mile start line are a long way from anything that matters,
and the rest of the trail, which at 5 Hz reaches back a quarter of a mile after two minutes and
says nothing an approach needs. Three dots is the fewest that shows a direction rather than a
pair of points. With that list the view closes in as the boat does, which is the whole point of
an approach screen: at thirty metres you want to see metres. Measured over a real approach, the
visible water goes from about 250 m at DTW 277 down to 36 m at DTW 39.

> **The triangle and the arrow are fixed PIXEL sizes, so they cannot be fitted as points in
> metres** — how far they reach depends on the very scale being solved for. Their *direction*
> does not: both hang off the seat along the crossing normal and then along the next leg, and
> each is settled by `up` alone. So the far tip is a known pixel offset from a known metre
> point, and the fit iterates — pick a scale, see where the tip lands in metres, fit again
> including it. `coursedraw.tangentPath` iterates for the same reason; two passes is ample when
> the correction is a fifth of a view. The spec sweeps a whole approach every five metres in
> four orientations and requires all of it to be inside the viewport, because the case that
> breaks a fit like this is always some particular geometry at some particular range.

**It closes in in STEPS, not continuously.** The frame is given up for exactly two reasons, and
both are about its having stopped being useful rather than about anything having merely changed:
one of the three is about to leave it, or the view could usefully be a sixth closer in. The
second test is deliberately **one-directional** — zooming back out on the same rule would undo
the approach on every wobble, and a boat that has genuinely gone away trips the first test
instead, which is an honest reason to rebuild rather than a number drifting. A different mark,
lap or orientation is a different picture and is never held across.

**The line carries a triangle, and the next leg an arrow in front of it.** The triangle is the
editor's own notation — base on the line, apex the way you must cross — because a plain stroke
says where to go and not which way through, and the required sense is the one thing about a
virtual mark that cannot be guessed from looking at it. It is seated at the nearest point of the
line to the boat, clamped between the ends, which is both where the boat is heading and always
inside the picture. `forwardNormal` is reused from `coursedraw` rather than re-derived: a
triangle pointing the wrong way still looks like a triangle.

Just beyond its apex, where it is pointing, a grey arrow along the next leg — *cross here, going
that way, then head there*.

**On a latch the scale deliberately does not move; the arrow goes green and grows a fifth
instead.** Re-scaling at the moment of a crossing throws away the picture somebody is looking at
for the one reason they are looking at it. That needed a fix underneath: `live()` advances the
instant a crossing latches, so the screen saying CROSSED was already drawing the *next* mark's
line, at a different scale, with the crossing ringed in a frame it did not happen in. The client
now holds `crossed` and the Mark screen stays on the line it crossed for the length of the dwell.
Growth and colour carry the state change, which is what the arrow is for.

**In Leg up and Line perp the display SWINGS onto the new leg** (`Turner`, `TURN_DEG_S` 25°/s)
rather than snapping. Snapping through ninety degrees between one frame and the next destroys
the one thing an oriented display is for — knowing without thinking which way things are. A turn
that is watched happening is a turn that is followed, and 25°/s puts the longest realistic swing
comfortably inside the dwell. Eased against real time, not per render, because the two screens
redraw at the fix rate and on the animation frame respectively; while a swing is in progress the
page drives the device from the animation frame, since at 2 Hz a 90° turn would arrive in six
visible jerks. **The displayed bearing is not part of the frame's identity** — a frame rebuilt on
every degree of a swing is a frame that never held still — so a deliberate change of orientation
reaches `PlotView` inside `subject` instead.

**All three orientations apply to the course overview as well.** They are a property of the
display, not of one screen: somebody who has chosen Leg up has chosen how they read a chart, and
having that hold for the approach and be abandoned the moment the course came back would be two
conventions on one device. The selector is therefore on both, and sets one setting.

> **Leg up is the leg the boat is ON — `legInto`, the mark behind to the mark ahead — and that
> is not the leg the arrow points at.** A boat approaching mark 2 is sailing the leg from mark 1
> to mark 2; the arrow shows where it goes *after* mark 2. Both are legs and both are wanted, and
> using one where the other belongs turns the display to a leg the boat has not started yet. The
> exception is the moment of a cross, where the brief is explicit — *"the display turns so the
> new leg is up, the this-leg arrow points straight up"* — so for the length of the dwell they
> are the same leg, which is what makes the arrow point straight up.
>
> Mark to mark, never boat to mark: a boat halfway up a beat points thirty or forty degrees off
> the rhumb line, and a display that followed the *boat* would swing back and forth on every
> tack. At the start of an open course, with nothing behind, it falls back to the bearing to the
> first mark — the only leg there is. **One definition, shared by both screens**, or the day they
> stopped agreeing the two would be turned different ways with no way to tell which was right.

The overview always re-fits, unlike the Mark screen: seeing the whole course is what an overview
is *for*, and a held frame would let a boat sail off the edge of its own course. The fit is done
in **rotated** space, or a course that is long east-west would be cropped once stood on end. And
a turned chart gets a **north pointer** (`northPointer`), because a rotated chart with no north
reference relates to nothing — not the printed chart, not a wind direction somebody called across
the water. Drawn only when it is needed, which is also what makes it informative: seeing it at
all tells you the display is turned.

**The approach screen leads with TIME TO LINE, and its colour is the warning.** It is the one
number worth a line to itself, so perpendicular distance and distance along the COG were moved
ONTO the lines of the plot that measure them, with no labels — the figure sitting on the dashes
*is* the label, where a cell elsewhere headed "Perp dist" makes a reader match a word to a
picture. COG and SOG went entirely: the boat is drawn pointing along one and the time is
computed from the other, so a third of the screen was being spent restating what it already
showed. Green means the present course crosses the line; red means it does not — a red thirty is
not a countdown, it is thirty seconds' warning that the boat is about to sail past the end
having scored nothing, which is the warning the one-metre hard edge obliges this screen to give.

> **The smoothing is on the INPUTS, and the defence against a wild reading is physics rather
> than statistics.** Time to line is distance over speed; the distance is geometry and moves
> smoothly, the speed is the noisy one. Smoothing the quotient would lag the whole readout, and
> lag is expensive in a number that is counting down. But an exponential smoother takes a fixed
> *fraction* of each reading, so a single reading four times the truth still moves it by a
> third — and a third of the way up a speed is most of the way down a time. Hence
> `MAX_ACCEL_MS2`: boats have bounded acceleration, so a hull reporting five knots to forty
> between two fixes has not accelerated, it has misreported. The same reasoning the kinematic
> gate rests on, one level up.

**The crossing triangle is sized against the LINE, not against the plot.** `coursedraw` fixes
its triangles in pixels and is right to — on the editor's chart they are a notation over a
course, and one that shrank with the chart would stop being readable at the zoom used to see a
whole course. Here the line beneath is drawn at its real width and grows as the boat closes, so a
fixed triangle becomes a chip of colour on a band eight times its size: it stops reading as a
thing *on* the line and starts reading as a blemish *in* it. Bounded at both ends, and the upper
bound is set where the triangle still stands clearly proud of the line — the first value tried
capped it at barely the line's own width close in, which is the very thing the scaling was for.

> **This adds a link to the chain the fit already had to iterate around.** The scale decides the
> line's width, which decides the triangle's height, which decides where the arrow hangs — and
> only then is the scale that must hold all of it known. Three passes now rather than two.

**The next-leg arrow is drawn about its own CENTRE, placed in line with the triangle's tip at
`ARROW.offset` of the arrow's own length away.** That is what keeps it clear of the triangle
whichever way the leg runs: the nearest it can come is `(offset − 0.5)` of its length, in every
direction — a fraction of the arrow rather than a fixed gap, so making the arrow bigger grows the
clearance with it. **The drawn extent has to match that model exactly**, and getting it wrong is
what let the arrow touch: `arrowHead` puts its point a further `size` *beyond* the place it is
given, so passing the intended tip as its anchor pushed the real point a head-length past the
clearance — invisible at most bearings and an overlap at the one that matters, a next leg
doubling straight back down the last. The spec now measures every 15° against the triangle's
actual edges.

**The F marks the one place with nothing beyond it**, which is the finish of an open course.
Crossing the *second-last* line still has a leg after it — the one to the finish — and that leg
has a bearing worth pointing at, so it gets an arrow like any other. Keyed off "there is no next
leg", never off "the next mark is the finish".

**The boat and the line are drawn at their REAL SIZE** (`REAL`: a 10 m boat, a 5 m line), which
is how the plot shows closing. A glyph of fixed pixel size says nothing about range — at four
hundred metres and at four it is the same picture. To scale they grow together, and the moment
the boat is a third the width of the line is a moment nobody has to read a number to understand.
Measured over an approach: the boat goes 13 px → 67 px and the line 3 px → 33 px between 400 m
and 15 m. Both floored, or a 10 m boat at 400 m would be ten pixels and vanish; both capped, so
neither swallows the plot. The line is drawn with **butt** ends, because a round cap extends a
stroke half its width past the point it was drawn to — invisible at three pixels, half a
boat-length at thirty, and extending it exactly where the extent test says it stops.

**An infinite end is as substantial as the line itself.** It is not a weaker part of the line, it
is the part that *cannot be missed* — if anything the safer water to cross — and drawn as a thin
fading hairline it read as the opposite: a boundary petering out, something to stay inside.

**Both sides of a gate are drawn, one in focus.** The other is shown where it falls in view and
is deliberately **not in the fit**, so it never costs zoom from the side the boat is actually
sailing at; it is drawn first, so the focused one is over it where they meet; and its triangle is
outlined rather than filled — the shape says the sense either way, the fill says which one the
screen is about. One routine (`crossingArt`) draws both, because a subdued copy written separately
is where a change to how a line is drawn would quietly fail to reach.

> **Perpendicular distance is the wrong way to pick which side of a gate a boat is on.** A proper
> gate has its two lines either side of the centreline and roughly parallel, so a boat is very
> nearly the same perpendicular distance from both for the whole leg. `watching()` therefore asks
> where the boat's *course* takes it, and failing that which *mark* is nearer — the midpoint, not
> the line — with hysteresis, because early on the two are within metres and a focus that swapped
> whenever they crossed over would flick the whole plot from one side to the other and back.

**The race clock runs from the CROSSING, and that is a commitment rather than a convenience.**
There is nothing in this system to fire a gun, so every start is self-timed: elapsed runs from
the instant the first line was crossed, never from when the app was opened. Before that the
overview shows a dash, not a zero — a number already running before the boat crossed anything is
not an elapsed time, it is how long somebody has been holding a phone. Once started it shows
**Started** and a running **Elapsed**; once the finish is behind, **Started**, **Finished** and a
total that has stopped, marked as final because it is then a result rather than a reading. Both
instants come off the *interpolated* crossings — that is the entire reason the detector
interpolates, and showing a fix time would throw the precision away at the last step. On a cycle
each lap restarts it, which is what makes the number a lap time.

**BTW and DTW have the course screen's own line, at twice the size.** They are what that screen
is *for* — which way, and how far — and they were sharing a row with two numbers that are not:
speed, which the boat can feel and which says nothing about where it is going, and elapsed,
which matters once at the end. Sharing made all four small enough to need looking at rather than
glancing at. SOG is gone from it.

**Which side a fix is ON and which side it CONFIRMS are two questions, and they used to share
one band.** `side()` is geometric and narrow — `SIDE_BAND_M`, half the system resolution — and
zero from it means only *this fix rounds onto the line*, which at one metre is the only thing
"too close to call" can mean. `confirmedSide()` is the stricter one the N-and-N latch counts: a
fix two metres out from a receiver claiming two metres is on a side but is not *evidence* of one,
and that band is what stops a boat sitting on a line assembling a run out of noise.

> Sharing them made the picture of a crossing unreadable. With the band set to the fix's own
> accuracy, a boat crossing at nine knots under a five-metre sky spends a second inside it, so
> the moment being explained came out as a run of grey dots — thirteen of them, against one now.
> **Nothing about what latches changed**: the detector asks the same question of the same band
> it always did. Only the screen stopped being held to a standard that was never meant for it.

**A wrong-way crossing is a blue cross, not a red one.** A boat that finds itself on the far
side of a line and comes back across it to set up properly has done the ordinary thing — it
happens on every start and every time somebody overstands — and the detector logs it as a
wrong-sense candidate because that is what it is, not because anything went wrong. A RED cross
there tells a sailor mid-manoeuvre that they have blown the mark, which is untrue and exactly the
wrong moment to be told it. So it is the same shape in a colour that says nothing is wrong —
shape carries the fact that something was rejected, colour carries whether it matters. It was
first tried as an orange tick, which was the right sentiment and the wrong mark: a thin stroke,
in the orange already used for one side of the line, on a dark plot, at a glance from a cockpit,
simply could not be seen. The red cross is kept for the one thing that IS a miss: a side change
past the end of the line. A candidate that never confirmed its far side is neither — the boat
dipped over and came back, or a fix wobbled — and gets a small dashed ring, because saying
nothing would hide it and either of the other two would be a claim about it that is not true.

**The chart draws its own cursor.** A system crosshair is one hairline on a chart that is
mostly dark water and mostly busy — over tiles it disappears entirely — and this is a page whose
entire interaction is *click exactly there*. So `cursor: none` and a reticle drawn in the SVG,
twice with a dark stroke underneath, because a reticle in one colour vanishes wherever it
crosses something of about that brightness, which on a sea chart is most places. It follows the
same rule the editor's chart does — **the cursor says what the chart will do**: green for a helm
order, orange for putting the boat down, two gestures that are one click apart and cannot be
undone. It carries the range and bearing from the boat, since on a steering rig the question
behind every click is "how far is that, and which way", and the chart can answer it for nothing.

**On join the boat is aimed THROUGH the first line, not at it.** Steering to the midpoint had it
arrive and stop dead on the mark, which is both the one place it must not stop — on the line is
inside the accuracy band, resolving to no side at all — and a silly first impression: press
Start and nothing ever happens.

> **Nothing here posts a record yet.** The client accumulates exactly what a `CourseRecord`
> needs — latched crossings with interpolated instants, the rejected candidates, the QC
> refusals with their reasons — and stops there. Closing that loop is the obvious next step and
> is deliberately not guessed at.

### A jump that is not a flyer

**The kinematic gate can refuse a fix and has no way out of that judgement.** `lastGood` only
advances when something is accepted, so after a real jump every fix is measured against a
position the boat has left, and the gate re-refuses each one until enough time has passed that
the *same* displacement finally implies a believable speed. A 400 m jump at a 40 kn ceiling
takes **twenty seconds** to forgive, and for all twenty the boat navigates on a position it is
not at, with SOG and DTW frozen at the last good values. This was found by driving the
simulator, not by reasoning: pause, move the boat forward, resume.

It is not a simulator-only problem. It happens whenever a receiver re-acquires after a dropout
— below decks, under a bridge, a phone asleep in a pocket, an app the OS suspended.

**The discriminator is that a flyer disagrees with its neighbours and a relocation agrees with
itself** (`RelocationWatch`). A single bad fix is out on its own and the next comes back, which
is exactly what the gate exists to catch and must go on catching. But when fix after rejected
fix lands in the same new place, each plausible boat motion from the *last rejected one*, the
only honest reading is that the boat is there and our idea of where it was is wrong. Confirmed
the same way a crossing is: N consecutive agreeing fixes, so recovery takes as long as a latch
rather than as long as the arithmetic.

> **A relocation must never become a crossing.** The segment from where we thought the boat was
> to where it turns out to be sweeps across any number of lines, and offering it to a detector
> would manufacture crossings out of a dropout — the same failure a flyer causes, at a scale no
> confirmation count could absorb. So the detectors are re-armed and the trail is thrown away.
> Losing a crossing that happened during the blackout is the honest outcome; inventing one is
> not. The step is **not** advanced: which mark is live is a fact about the course, not about
> the receiver. It is logged either way, which is what lets somebody reconstruct it afterwards.

**Only a KINEMATIC refusal can relocate.** A fix from two satellites is not evidence about
where the boat is however many of them agree, so a run of metadata refusals must never move it.

**The gate budgets for noise as well as for motion** (`kinematicBudgetM`). A speed limit alone
is the wrong test over a short interval: implied speed is distance over time, and as the
interval shrinks the distance is dominated by the noise on the two fixes rather than by
anything the boat did. Two fixes each honest to three metres can easily be twelve apart, and at
5 Hz that is an implied 117 knots — so a boat ambling along at nine knots under a clear sky had
fixes thrown away for going too fast, which is the gate's purpose applied to exactly the wrong
thing. The budget is what the boat could have travelled **plus** what the receiver could have
made up, the second term from the accuracy the receiver itself states, so a good sky narrows
the gate and a bad one widens it.

**A stale fix is not shown as if it were current** (`STALE_MS`). SOG and COG are instantaneous,
so an old one is *wrong* rather than merely old: a boat whose fixes are being refused would
otherwise show the speed and heading it had when the trouble started, which reads as "everything
is fine" at precisely the moment it is not. Both are dashed once the last accepted fix is more
than four seconds old; BTW and DTW stay, because last-known position degrades gracefully and is
still worth something. Either way the screen says how long it has been, how many fixes went in
the bin, and why the last one did — the one state where the application knows something is
wrong and the person cannot see it.

**Picking the boat up does not cancel the helm order** (`BoatSim.placeAt`). Clearing the target
made the boat stop dead wherever it was dropped, SOG zero, indistinguishable from a boat that
had arrived — so moving it forward along the course made it stop instead of carrying on. Moving
a boat says where it *is*, not where it was going; if it should be stopped there is a Pause
button. The page re-aims at the live mark when the boat lands beyond whatever it was steering
at, since otherwise it has "arrived" and would sit.

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

**A cycle is numbered from ZERO** (`sequenceLetter`, mirrored by `variantLetter` in
`editor.js` — the same rule written twice, like `RESOLUTION_M`). It has no start and no
finish of its own, since a boat begins and ends wherever it joined, so S and F would claim
something untrue about it; ticking *cycle* renames the first step **S → 0** and moves nothing
else. Numbering from one instead made a cycle's first leg "leg 2" — **a leg is named by the
step it runs INTO** — so the same question got a different answer depending only on a
tickbox. From zero, the leg into step 1 is leg 1 and the first numbered mark is 1, on a cycle
exactly as on an open course. `CourseVariantTest` pins it.

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

**A leg is named by the step it runs INTO**, which is what makes a cycle's closing leg fall
out of the numbering rather than need a rule of its own: on a cycle, step 0 has a leg into it
— from the last mark back to the first — and it is **counted in the course length**, measured
like any other, overridable by step 0's own `lengthNm`, and complained about by the same two
checks. Leaving it out made a lap measure short by one whole leg, which is a number people
navigate and handicap by, and `coursedraw` had been drawing it the whole time. On an open
course `legs[0]` stays NaN, because nothing runs into a start.

> **A zero closing leg is not the mistake the zero check exists for.** A cycle authored the
> open-course way — first mark repeated at the end, `A B C A` — has one, and it is redundant
> rather than wrong: the loop is already complete when it reaches the repeat, so the closing
> leg adds nothing and `A B C A` measures exactly what `A B C` measures. Complaining about it
> made the variant *incomplete*, which **blocked the snapshot of a perfectly sailable
> course** — found by `drive-snapshot` against real club data, not by the unit tests.
> Everywhere else a zero leg still means two steps share a reference point.

Adding a step to a cycle seeds it away from **both** neighbours — the step before it and step
0, which its closing leg runs back to — where an open course only had to avoid the one.

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

Not implemented, and now further off: with no races, a boat declares its own handicap when
it joins and the server would hand back that boat's sub-line. That removes the need for an
entrant list entirely — but how a TCF becomes a length delta is still open.

### One file per club and series

Courses are organised by club, and by series within a club (a whole summer, or one series
inside a season). Each file is **self-contained** — its own points, lines and courses,
resolving nothing from anywhere else — so it can be read, diffed and handed to another
club whole. The cost is that a shared reef is surveyed in each file that uses it.

The **path is the identity**: `clubs/myc.org.au/2026-summer.yaml` is club `myc.org.au`,
series `2026-summer`. A file that names them anyway is checked against the path and
complained about, never silently believed. Clubs are keyed by **domain**, following
sail-jinx and sailing-pf, so records about the same club line up across all three.

### There are no races

**This system publishes courses and collects what boats did on them.** Places, OCS,
corrected times, penalties, drop races and series scoring belong to the club's software,
which already has rules for all of it. Owning none of that is what lets this be right
about the one thing it is uniquely able to be right about — detecting and timing a
crossing — which is also the only thing here a protest committee could not reconstruct
from somebody's watch.

It is the same boundary the brief drew (*"the server is explicitly outside the rounding
path"*) extended one step: **outside the scoring path too**, and the boundary sail-jinx v2
drew for itself.

**The consequence is a commitment, not a gap: every start is self-timed.** A boat's clock
starts when it crosses, because there is nothing here to fire a gun. A club running a
fixed-gun race scores from its own gun and this record's crossing times.

**Three ways to join** (`JoinMode`), declared when joining rather than when submitting —
it changes how a boat sails, and a boat deciding afterwards decides with the answer in
front of it:

| | |
|---|---|
| `RACE` | goes to the club, which scores it |
| `ANONYMOUS` | practice: kept for the boat, published to nobody |
| `RECORD` | goes to the club **and** stands against every other attempt at the same geometry |

Practice is **stored and not published**, rather than withheld: a boat that never uploads
cannot compare its own laps, recover a track from a lost phone, or change its mind.

### The record is the interface

`CourseRecord` is the only artefact that leaves this system, so it has to carry everything
a scorer or a protest could need. Anything a scorer needs and cannot find here pulls race
concepts straight back into the codebase.

**A record names a course *revision*, not just a course.** Courses are edited live, so a
boat practising on Tuesday and one racing on Thursday can sail different geometry under
one id. `CourseSnapshot.hash()` is twelve hex characters over the **geometry and the
order** — resolved positions, infinite flags, crossing senses, entry marks, whether the
course closes — and deliberately *not* over names or notes: renaming a mark changes
nothing about where a boat had to sail, and bumping the revision for it would split one
course into two that cannot be compared. The hash is built from a canonical string rather
than serialised JSON, so adding a field cannot silently change every revision.

**Designs are archived on SNAPSHOT, not on edit, and a boat is handed what was
PUBLISHED.** `POST /api/lifecycle/{club}/{series}/snapshots` resolves a variant, inlines
it, and archives it under its revision; `POST .../publications` chooses which snapshot
boats get; `POST /api/join/{club}/{series}/{course}` serves that one, and 404s when nothing
is published. Nothing is kept for a design nobody deliberately released, which is most of
what an editing session produces — and a design somebody *did* sail survives being edited
afterwards, or its records become uninterpretable. `GET /api/courses/{revision}` reads one
back. See "The course lifecycle" below.

Records are filed `records/{club}/{course}/{date}/{boatId}-{HHmmss}.json`. The start time
is in the *name* so a boat may sail the same course twice in a day, and so a resubmission
of the same run — the ordinary case, when the full track arrives later over wifi —
supersedes rather than accumulates.

---

## The course lifecycle

Settled in [`wiki/course-lifecycle.html`](wiki/course-lifecycle.html), which carries the
reasoning. What follows is the summary and the rules a change has to respect.

Implemented in `CourseVariant`, `Course`, `CourseSnapshot` and `store/CourseLedger`; the
editor's Courses tab is the whole of the UI for it.

### Course, variant, snapshot

| | |
|---|---|
| **course** | what a club publishes and a boat joins. Has one or more variants, and no geometry of its own |
| **variant** | an editable design belonging to **exactly one** course — Div 1, short course, or simply *the* one |
| **snapshot** | an immutable, fully inlined capture of one variant, identified by its revision hash and named `course/variant/datetime` by the tool |

**Two shapes in the file, one model in memory.** A course with one plain variant is written
flat — a bare `sequence:`, exactly as before variants existed — and reads back as a single
variant under `main`. The `variants:` level appears only once it is being used for
something, so the ordinary single-design club course is not taxed with an empty layer of
nesting to serve the rare one. `Course.read` folds one into the other; `Course.flat()`
decides which way it is written.

A variant belongs to one course because that is what makes *whose racing did I just
change?* answerable. A variant shared between two courses would need its own name, its own
publication and its own dirty state — which is to say it would be a course. Genuinely
common shape is shared one level down, as a named line.

### Named and ad-hoc geometry

A point is **named** (an id, in the club's list) or **ad-hoc** (no id, living inside the
one variant that uses it). **Naming is identity, not sharing** — Sow and Pigs is named
because people refer to it, not because several courses do; sharing is counted, never
declared. That is why the earlier *shared*/*local* wording was dropped: it stated as
policy what is really an observation.

**A line's two ends are independent.** Moving one end does not detach the other: one may be
a surveyed feature the club knows and the other a handle dropped this morning, and forcing
them to share a fate either promotes the handle or detaches the feature. The unit of the
named/ad-hoc decision is the point.

### The tab is the scope of the edit

Answered by where you are standing, before the edit, rather than by a modal after it.
**Points/Lines tab** edits the club's named geometry — the whole club is in scope,
deliberately — and *reports* what it dirtied. Nothing is blocked and nothing is cascaded.
**Courses tab** edits one variant; dragging named geometry there asks first:

| What else uses it | What is offered |
|---|---|
| Nothing (ad-hoc), or only this variant | it just moves |
| Sibling variants of this course | move it for all of them, or make it ad-hoc here |
| Another course | make it ad-hoc here; promote a new named point (where this course has several variants); or **go to the Points tab**, which is where the club's marks are edited |

> **The invariant: from the Courses tab you can never change geometry for a course you are
> not in.** Widening scope beyond the current variant always takes an explicit answer.

The invariant says the change cannot be made *from here*, not that it is forbidden — so the
dialog **names where it can be**: taking that offer switches to the Points tab and selects
the mark, and deliberately does **not** carry the drag over. A club-wide move is made on the
tab whose scope is the club. A dead end would only teach people that the editor cannot do
something it can.

The promote option stands in for a scoping mechanism, and **the tool generates the name**
(`manly-to-shark/windward`), never the user — a namespace held together by human
discipline lasts about a season. It is offered only where it would differ from the other
two: with a single variant it *is* "make it ad-hoc", and among siblings it *is* "move it
for all".

**Detaching a point does not detach the line.** Making a point ad-hoc copies every line
that named it with *only that end* repointed at the copy; the other end still names the
club's point. A line's two ends are independent, and one of them may be the surveyed
feature that made the line worth having.

### Snapshots inline everything, immediately

Lazy inlining was considered at length and rejected. **The revision is a hash over resolved
coordinates**, so a snapshot that resolved names later would have a hash that could
silently stop describing its own contents — and the impact question does not need it,
because **the variant a snapshot was taken from remains**, still holding its named
references. Immutability and impact tracking are jobs for two different objects.

The safety property that falls out: **editing named geometry never modifies a snapshot**,
so it never changes anything a boat has been handed. A published course changes only when
somebody publishes.

### Dirty is derived, never stored

`hash(resolve(variant))` against the latest snapshot's revision gives **unpublished** /
**current** / **dirty** / **incomplete** — plus **template**, which is called out first
because it can never reach any of the others. No flag is written, so none can go stale, be
missed by an edit path, or survive an undo it should not have. A course shows dirty if any
of its variants is; selecting it shows which. Review means a **diff** — "dirty" alone only
says something changed, and what an editor needs before publishing is *what*.

### A snapshot is the fourth level, and it is read-only

Selecting one puts it in the editor **instead of** the variant. A capture is fully inlined,
which is exactly what an all-ad-hoc variant is, so `variantFromSnapshot` hands it to the
drawing code as one and every line, triangle, leg and label works unchanged. What must not
happen is editing, which `readOnly()` sees to: no point drag, no line or end grip, no
move/turn grips, no armed chart click.

**The form shows what it IS, with no inputs at all** — revision, when it was taken, its
length, its sequence — rather than a disabled editor. A greyed-out field says "you may edit
this later"; a snapshot is never editable by anybody.

The row's commands are what you can do *about* one, never *to* it:

| | |
|---|---|
| `⧉` | a new variant from it — named `<variant>-<date>`, owning all its geometry outright since a capture is already inlined |
| `↑` | hand **this** one to boats. The rollback path: a pointer move, no re-editing |
| `✕` | take it out of the list |

**Forgetting keeps the geometry** (`CourseLedger.forget`). A record names a revision, and a
result whose course cannot be read is a time with nothing attached — so this removes a
snapshot from the list, from the offer and from the dirty comparison, and leaves it readable
through `GET /api/courses/{revision}` for as long as anything points at it. A few kilobytes
is a cheap price for never orphaning a result. Forgetting the **published** one is refused
outright: publish another or withdraw it first.

### Public, and the audit trail

**`public` is a course-level flag, default false, and it is the third gate.** Snapshot
captures, publish chooses, and **public decides whether anybody outside the club may see
either**. `GET /api/public` lists public courses and, under each, the snapshot currently
published for every variant — which is what a client will join and be pushed. Both gates are
required: a public course with nothing published shows with nothing under it (honest — it is
a course nobody can join yet), and an unpublished variant of a public course does not appear
at all, because what a client is handed is a *snapshot* and a variant with none has nothing
to hand over. **Templates cannot reach it by construction**, not by a filter: no snapshot ⇒
no publication ⇒ no live revision.

On the course and not the variant, because a course is the thing a boat joins — publishing
Div 1 while hiding Div 2 would offer half a fleet a race. Default false because a club's file
is full of half-built shapes and last season's leftovers, and the safe default for "who can
see this" is nobody. **A cloned course is never public**, whatever the original was: it has
nothing published under it, and inheriting the flag would put an empty course on the front
page the moment it was made.

**Visibility has TWO switches, and the log has to watch both.** Publishing to a public
course, and making public a course that already has publications. A log that watched only the
publish endpoint would miss half the moments a course became joinable — and the half it
missed is the surprising one: nothing was published, nobody pressed anything that says
*release*, and a fleet can suddenly see three snapshots. So `PUT /api/programmes/...` compares
the public flags before and after the write and records what flipped.

Four kinds of event: **published**, **opened** (made public with publications), and their
inverses **withdrawn** and **closed**. The inverses are not decoration — a trail that records
only what appeared cannot answer *"why can I no longer join the course I joined on Tuesday?"*,
which is the question somebody actually asks. A no-op records nothing (withdrawing what was
not being offered, ticking public on an empty course), because an audit trail full of noise is
one nobody reads.

> **The events land in the SAME atomic write as the pointers** — which is why they live in
> `CourseLedger`'s document rather than a log file beside it. An event written separately can
> be lost to a crash between the two, and a trail missing the entry for something a fleet was
> handed is worse than no trail at all, because it reads as proof the thing never happened.
> `CourseLedger` does not know which courses are public — that is in the programme file — so
> the servlet decides which pointer moves are publicly visible and passes the events in.

`GET /api/log` is **open to everybody**, by the same reasoning that keeps the other reads
open: a club publishes its racing, and what a fleet was handed and when is exactly what a
competitor may need to check afterwards. A record only the club can read is not an audit
trail, it is a note to self. A series rename follows into the log, because an entry naming a
series that no longer exists cannot be matched to the course it describes; the instants are
untouched, since a rename changed nothing anybody could see.

### Snapshot and publish are two steps

Snapshot captures a design; **publish chooses which snapshot boats get**, and `join` serves
that one — a course with nothing published cannot be joined at all, so a mark dragged on
race morning changes nothing for anybody on the water until somebody publishes again. Publishing a
variant replaces that variant's previous publication — a pointer move, not an append, since
a fleet offered a choice of vintages starts with two courses on the water. Two scopes, one
operation: **one variant**, or **several atomically** (a line common to three variants
moved on race morning — all three change or those fleets have inconsistent instructions).
The atomicity is the constraint with teeth: it means the publication pointers have to
commit together, and since a shared line dirties variants across *different courses*, that
scope is club-wide: `CourseLedger` is **one JSON document per club**, holding the snapshot
index and the publication pointers, written atomically. That is where the atomicity comes
from — a crash mid-publish leaves the previous pointers, never half the new ones.

### Templates

**A template is a variant marked as such, and the one thing it cannot do is be
snapshotted.** Everything else follows without a second rule: no snapshot ⇒ no publication
⇒ no boat can join it ⇒ permanently *unpublished*, never *dirty*, never in the race-morning
list.

**A course is never labelled a template**, only a variant: a template is a property of one
design, and a course usually holds a template alongside the races cloned from it, so a
course row claiming "template" would say it is unsailable when it is not.

**A template is reached FROM the course being built, not the other way round.** The variant
row's `⚐` opens a picker of every template in the library (`GET /api/templates`) — any club,
any series, the current one included — and expands the chosen one into this course as a new
variant. The picker **drills: series → course → variant**, because that is how somebody
holds the answer ("the one we use for the Saturday series"), not as one row out of a flat
list of forty. **A stage with one answer answers itself** (`stageOf`), so a club whose
templates all live in one series never sees a question with a single button on it — which
is the whole value of a hierarchy over a flat list: it collapses to nothing when there is
nothing to choose. Back steps *over* the stages that answered themselves, since going back
into one would answer it again and go straight forward. Selecting a template and cloning it put the copy beside the original, which is
backwards: you know which course you are building, and the shape is the ingredient. It is
also the only way a template is usable outside its own course; `cloneVariant` has taken a
target since it was written and nothing in the UI ever passed one.

**A new course therefore has NO variants, and the LAST one may be deleted.** Guessing one
called `main` put a blank sequence in front of somebody whose next move is usually "start
from the windward/leeward we always use". An empty list with `+` and `⚐` on its row asks the
question instead of answering it wrong. A course with no variants is still reported as a
problem — it cannot be joined — but nothing blocks it, and refusing the last delete left
anybody who wanted to start over with nothing to do but delete the course and recreate it
under the same id.

**Empty has to survive the file, which took two fixes and is where the real enforcement
was.** `Course.read` folded the flat fields into a `main` variant whenever `variants:` was
null *or empty*, so an emptied course grew a phantom design the moment it was read back; the
rule is now that **a `variants:` key means the nested shape whatever it holds, and the flat
shape is recognised by HAVING a sequence** rather than by lacking the key. And
`ProgrammeWriter` emits `variants: {}` rather than a bare `variants:`, because a key with
nothing under it reads back as null — which is the flat shape, which manufactures the very
thing that was just deleted.

**Expanding copies, because a programme file is self-contained.** It names no other file and
resolves nothing outside itself, so a template elsewhere cannot be referred to. What comes
across keeps its shape: a mark the template *names* is made a named mark here, because
naming is identity and a course that refers to Sow and Pigs should go on referring to it.
Ad-hoc geometry stays ad-hoc.

**A line is taken across once per NAME, not once per occurrence.** A windward/leeward's
leeward line is start, mark 2 and finish — three steps, one line — and adopting per
occurrence made three copies of it sitting in the same water, indistinguishable on the chart
and three separate edits every time the mark moved afterwards. So the set of lines the
sequence names is taken across first, each exactly once, and the sequence is then rebuilt
against what was made. Points are memoised the same way, since two lines may stand on one
mark. The named path hid this — `adopt` reuses a name that already means the same place, so
a repeat happened to land on the same line — which is why `drive-reuse.mjs` **writes the
template it needs**: every template in the fixture is built on named lines, and the bug was
in the ad-hoc branch.

**A name that already means something else here gets a distinct id, and says so** (`adopt`).
Three situations, and only the third is interesting: the name is free — create it; the name
is taken by something *in the same place* — reuse it, which is the entire point of naming;
the name is taken by something **somewhere else** — neither default is safe. Reusing
silently puts the template where it is not, and overwriting is far worse, because it moves
every other course in this series standing on that mark. Lines matter more than points here:
the sequence names *lines*, and points are one level below them.

**Three counts, three different words, and they are not interchangeable.** A **step** is one
position in the sequence — one lettered mark, S through F — and a gate is one step because a
boat takes one side of it. A **crossing** is one line to cross, so a gate step holds two
(`CourseSnapshot.Step.crossings`). A **leg** is the water between two steps: n−1 of them on
an open course, n on a cycle. The template picker labels a variant by its steps and calls
them **marks**, which is the sailor's word for the lettered things a course is a list of; the
sequence fold counts **lines**, which is rows, which is crossings. Anything showing one of
these has to say which — "7 steps" told a reader choosing a shape nothing they could act on.

**What comes out of a template is called `yyyymmdd-race-n`** (`raceId`), whether it was
expanded by `⚐` or cloned by `⧉` — the same act either way. A template is a shape; what comes
out of one is a race, on a day, and usually not the only race that day. Naming it after the
template (`two-laps`, `two-laps-2`) said what it was made from rather than what it is, and a
season of them sorted into one indistinguishable run. The local date, because a race day is a
local day, and `n` counts from 1 within the course so it is the day's race numbering rather
than a uniqueness suffix. The long name carries over from the template, so `20260914-race-1`
still says "Two laps" in its form.

**Templates sort first in the variant list**, then the races, each group alphabetical. A
template is what the others were made from, so it reads as the heading of the list rather
than an entry buried in it — and the list fills with dated races over a season while the
templates stay put. A variant cloned into
*another* course keeps its own id, since that namespace is fresh, which is what lets a
course clone leave `div1` as `div1` and keep the structure of variants it was cloned for.
Anything else is `<id>-copy`. A variant may be cloned **into any
course, existing or new** — that is how two windward/leeward fleets on one day get
independently positioned courses — and a **whole course may be cloned**, which is just
cloning all its variants, because a good template usually carries the structure of variants
it existed to capture.

**Moving or turning a whole course** puts a dashed box round the variant's extent with two
grips on it: move at the foot, turn at the head. On the **outer limits** rather than in the
middle, because the middle of a course is where the course is — a grip there would sit on
the marks it was meant to be moving.

**The grips show by default when the course owns everything it is built from**
(`transformShown()`, an explicit tickbox answer if there is one, else derived). A variant
with nothing shared was taken from a template to be raced, and the next thing anybody does
with one is put it where today's wind wants it; no drag of it can reach another course, so
there is nothing to make them find a tickbox for. A course built on the club's surveyed
marks keeps them hidden until asked, because there a drag IS consequential.

> **Translate and rotate can be a bulk detach**, and `transformCourse` says how much before
> it does it: *"built on 6 marks the club shares with …"*. It offers both answers —
> **detach** those marks and move only this course, or **move them for every course** that
> shares them. Widening scope is offered here where a single mark's drag withholds it,
> because the invariant is that scope is never widened by *accident*, and on race morning
> "the whole fleet's course has shifted twenty degrees" is a real thing somebody means.

**Headings show while something is moving, and the track stands down.** A turn changes
every leg's heading, so it draws them all — heading, reciprocal and the leg's length in
nautical miles, at the midpoint of each leg, between the reference midpoints the lengths are
measured to. Drawn **large**, because it is the number being steered by while the hand is
still on the grip: read at a glance, not squinted at. Dragging one line draws
only the legs that touch it. A whole-course *move* draws none: it changes no heading, and
the course arrives at the angles it left at. The track hides while they are up, because a
course already carries its legs, arrows and letters, and bearings over the top of all that
would make the one number somebody is turning to the hardest thing on the chart to read.

**A turn happens in a local metric frame** (`rotateAbout` in `geo.js`). Rotating latitude
and longitude directly would *squash* the course, because a degree of longitude is shorter
than a degree of latitude by cos(latitude) — a course turned 90° would come out narrower
than it went in. Longitude is scaled by cos of the centre's latitude, rotated, and scaled
back. The pivot is the **middle of the extent**, not the mean: the mean is pulled towards
wherever the marks are dense, so a course with three marks at one end would turn about a
spot nobody could predict from the picture. Degrees are compass-wise, and snap to whole
ones — a wind shift is spoken about in degrees, not fractions.

The warning on first editing a template should **reassure, not caution**, because people
assume the opposite of the truth: editing a template does not affect courses already cloned
from it; it changes only what future clones start from.

### Deletion

**Snapshots outlive everything that produced them.** Deleting a variant or a course does
not delete its snapshots; a replaced publication keeps its snapshot too. They go only when
explicitly deleted. A record names a revision, and a record whose geometry cannot be
retrieved is a time with no course attached — retiring a course is not a reason to make
last season's results meaningless.

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
3. ~~**Finite line endpoints in open water.**~~ **Answered, and now consumed:** one-metre
   resolution throughout, a hard edge, and the warning the rule is only defensible with.
   See "One metre, everywhere". The prototype Mark screen reads `projectCog()` — the ring
   where the COG cuts turns amber inside the margin and red past the end, and the status
   line says how many metres outside the boat will pass on the present course. What is
   untested is whether that is *loud enough* on a phone in glare, which is a question for
   somebody on the water and not for this file.
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
8. **Authentication on the writes.** There is none on any of them, and there are more of
   them now: `POST /api/records` accepts a record for any boat; `PUT`, `POST` and `DELETE`
   on `/api/programmes` rewrite, create and retire course files on disk; and
   `POST /api/lifecycle/.../publications` decides what a fleet is handed. All but the
   record POST are gated only by `server.configWrites`. Reads should stay open — a club
   publishes its results — but a write is somebody's race result, somebody's survey, the
   course a fleet will sail, or a whole season deleted. `sail-jinx` has a working Jetty
   OpenID setup to copy. **This is the blocker for deploying to the Pi.**
9. **Capacitor.** Not yet present. Background-geolocation behaviour, iOS Safari suspending
   the Geolocation API in the browser fallback, and plugin versions all shift; verify at
   build time rather than trusting the brief's §7.
10. **Which gate side a boat took** is recorded by the client as well as the record now,
    and still nothing uses it: the Mark screen's next-leg bearing is taken to the MEAN of
    the next step's midpoints, so at a gate it points between the two sides rather than at
    the one this boat is committed to.

## Not built yet

Of the three screens in brief §3, the **Mark** screen exists as a prototype in
`client.html` — all three states, all three orientations, the plot and the readouts — with a
**course overview** behind it standing in for the Course screen. Neither is on a phone yet:
there is no Capacitor wrapper, no offline tile cache, and no `navigator.geolocation`, because
the fixes come from `boatsim.js`. **Live place** does not exist at all.

What the prototype stops short of, deliberately rather than by omission:

- **Nothing posts a `CourseRecord`.** The client holds everything one needs and closing the
  loop is the next obvious step.
- **The Course screen has no other boats on it**, which is most of what the brief asks that
  screen for. That needs a fleet feed, which needs the record POST first.
- **The handicap is carried, not applied.** The join screen collects a TCF and does nothing
  with it, because turning a TCF into a distance is open question 5.
- **No orientation is remembered** between sessions, and nothing is cached across a reload:
  a refresh is a fresh join.
