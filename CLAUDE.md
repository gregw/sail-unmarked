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

[`wiki/client-server-dialog.md`](wiki/client-server-dialog.md) is the third, and is
**provisional**: what a boat and the server say to each other once there is a live race to run.
For the formats that need one the server acts *in part* as the race committee — start sequences,
postponement, divisions, a fleet feed — while never scoring and never recording: it keeps no
clock, publishes an absolute start time, and every countdown, elapsed time and crossing instant
is run and stamped by the boat. **Which is the other thing that document says out loud: the boat
is trusted entirely.** Every position and every instant comes from it and nothing anywhere checks
whether it told the truth; the QC gates defend against a bad receiver, never against a dishonest
sailor, and the server will not call OCS on a boat that says it started fairly. That is workable
because **a clock offset cancels in an elapsed time** — the quantity racing is decided on is a
difference between two instants from the same clock — and it is *absolute* comparison, against a
gun or between two boats, that the trust model does not support.

Read it before adding anything to the wire. It also carries the rules that let an *installed*
client and an updated server go on talking, and in §12 the race-management screens: a fourth
`Races` tab in the editor for *defining* a race, and a separate page for *running* one, because
there is no undo for telling a fleet to stop.

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
mvn test                                   # 109 Java tests + 673 JS assertions
node tools/run-js-tests.mjs                # just the JavaScript specs
tools/editor-drive/run.sh                  # the editor and both clients, driven against
                                           # a live server
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
    device.js / device.css              >>> THE CLIENT: join, screens, selectors. ONE copy,
                                        imported by both pages below
    boat.html / boat.js                 THE REAL CLIENT — the device, fed by this phone
    receiver.js                         navigator.geolocation as a fix. What ships
    client.html / client.js             THE TEST RIG, with the device sitting on its chart
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

**The pane is a drill-down, and every level is a SELECTOR: a label, the current value, and
that level's commands.**

```txt
  Club     [ myc.org.au            v ]
  Series   [ 2026-summer           v ]  + ⧉ ✕
  ▸ Series details
  [ Points | Lines | Courses ]              the tab strip, at the SERIES level
  Course   [ manly-to-shark — public v ]  + ⧉ ✕      (? explains what a course is)
  ▾ Course details                    ●dirty
      id / long name, public, Snapshot dirty · Publish latest, notes
  Variant  [ div-1                  v ]  + ⧉ ⚐ ✕
  ▾ Variant details                   ●current
      id / long name, cycle, template, ▾ Sequence …, Add line · Add alternative, Snapshot
  Snapshot [ div-1/2027-06-06 · a1b2c3d4e5f6 — published v ]  ⧉ ↑ ✕
      (the capture's read-only details, when one is chosen)
──────────────────────────────────────────  pinned, never scrolled away
  ☑ show track   ☐ hide unused   ☐ move/turn
```

**It was breadcrumbs that opened fixed-height lists, and several could be open at once.** The
pane became a stack of little windows, each with its own scrollbar and resize grip, and the
thing you wanted was in one of four places depending on what happened to be open — so the pane
had to be read before it could be used. A selector says what is chosen *while it is shut*, takes
one line rather than a hundred and fifty pixels, and is a control nobody has to be taught.

**The club and the series are two questions.** They were one selector showing
`myc.org.au/2026-summer` — the widest thing on the pane, saying less than either half would on
its own. A club has several series and a series belongs to one club, so choosing is naturally
two steps. **The club carries no commands**: a club is a domain, not created here, not renamed
here (that would be a migration across every record path and the ledger's own filename), and not
deleted here. Three disabled buttons would say those are things that might one day work from
that row.

**The chevron moved from the lists to the FORMS.** What is worth getting out of the way is the
long half — a course's fields and a variant's sequence — not the one-line selector above it. A
level's fields start **open**, because they are what you came to the level for and a pane that
opened with everything shut would make choosing a course a two-click job to see the course; the
series' own fields are the exception, being an id and a title nobody edits twice.

**A level's fields sit inline under that level's own selector.** They were in one form region at
the foot of the pane, which put the snapshot selector *above* the variant's sequence — the pane
read course, variant, snapshot, and then the variant's fields, out of order and a scroll away
from the thing they belonged to. The bottom region is now the Points and Lines tabs' alone.

**`Snapshot` sits with the design it captures**, at the end of the variant's own form. It was on
the variant's row among the commands that create and delete variants, which put *capture this
design* one button from *delete this design*.

**The three view tickboxes are PINNED to the foot of the pane.** They are settings for the
chart, not a level of the drill-down, and they were at the bottom of the variant form — under
the sequence, which is the longest thing in the pane — so reaching them meant scrolling past a
course to get at a control that decides how that course is drawn. Only on the Courses tab, since
all three are about how a course is drawn.

**`public` is said in the course selector's own option text** (`manly-to-shark — public`). An
option cannot carry a chip, and the flag has to be visible without choosing the course first:
*which of these is the fleet being offered* is a question about the list, not about one entry.

**An empty option is offered only while nothing is chosen, and it carries no value**, so it
cannot be picked back to. Once a level has an answer the question is gone from the list, which
is what stops a selector being a way to un-choose a course and land the pane in a state whose
only content is an apology. A level with nothing to offer is **disabled** and says why in the
empty option — *no variants* is a different fact from *none chosen*, and a reader can act on the
first.

**The SNAPSHOT level is the exception (`keepEmpty`), and choosing a capture was a dead end
without it.** Un-choosing a course or a variant empties the pane, which is the whole reason the
question disappears once it is answered; a snapshot is not like that, because *nothing chosen*
is that level's ordinary and useful state — it means you are editing the design. So the empty
option stays, re-worded from the placeholder *none chosen* to the action **← back to the
design**, since chosen it is the one entry on the level that is a command rather than a
selection.

> **What made this invisible was the stub.** The way back used to be a toggle — choosing the
> capture that was already chosen put the design back — which was right while the level was a
> list of rows and became **unreachable the moment it was a selector**, because a `<select>`
> fires no `change` for the option already selected. `drive-snapshot.mjs` asserted that way
> back and **passed**, because `choose()` in the stub fired `change` unconditionally: it
> modelled a browser behaviour that does not exist. The stub now refuses to fire when the value
> is unchanged, which is both what a browser does and what turns that assertion into a test.

**Opening the variant selector and landing back on the same variant also lets the capture go.**
Going to that selector is an act of attention on the design level — somebody went to choose a
design — so whichever one they come back with, including the one they had, the capture they were
looking at is not what they asked for. `change` cannot see it, so it is the **pointer that
opened the list and the blur that closed it**; gated on the pointer deliberately, because a blur
alone would drop the capture for somebody merely tabbing through the pane, which is not a
decision about the design at all. A keyboard user who genuinely changes variant is served by
`change` like anybody else.

> **`formsChanged()` clears every form's guard, and that is why it exists as one call.** The
> guards stop a form being rewritten while somebody is typing in it, which is worth having — but
> there is more than one of them now, and a caller that cleared one and forgot another is a form
> that silently stops updating. That is exactly what happened when the variant's fields moved
> inline and got a key of their own: `Add line` went on clearing the *course's* key, the variant
> form was recognised as unchanged, and the step it had just added never appeared.

> **The message line lives OUTSIDE `#rows`.** That container is rebuilt whenever the pane
> changes, and a message written into it is wiped by the next render — which is usually the very
> render that follows the thing being reported.

**Explanation still lives in hover popups**, now hung on the level selector rather than on a row
of its own: `?` beside Course, beside Point or Line, and beside Snapshot.

> The stub in `tools/editor-drive/` **forgets an element when the innerHTML holding it is
> reassigned**, because a stub that kept answering for a replaced node could not see that
> class of bug at all — and did not, until it was taught to. It also understands
> **`[data-x]` attribute selectors**, which the client page uses to wire its two selectors: it
> used to fall through to the tag branch, where `[data-view]` is a *character class* and
> `<[data-view]…>` matches `<div>`, so handlers were wired to nodes standing for divs and a
> driver could see the buttons in the markup but never press one.

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

**The pane is two surfaces, the fields lighter than the pane they sit on**, so a form reads as
something to type in rather than as more of the same. It used to be three, the middle one being
the list of things to choose from; a selector needs no surface of its own, which is one fewer
boundary to infer. **A course's length is not in the selector** — the tab is required to show it
always, so it lives in the chart bar's status where folding a form cannot take it away.

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
pane works is read once and then permanently in the way of the thing it sits above.

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

**Four chart backgrounds — `none`, `OSM`, `chart`, `sea` — offered by a selector built from
`BASEMAPS` so the labels and order live in one place**, least ink first. `chart` and `sea` share
one Esri Ocean base (bathymetry, coastline, shelf shading); **sea** stacks OpenSeaMap's seamark
layer on top and **chart** leaves it off. That layer is every light, beacon and buoy —
invaluable while placing a line against the real marks, and a great deal of ink once they are
placed and a course is being drawn over the top. **`none`** fetches nothing, and is what the
on-water screens default to.

> **They are named for what they draw, not for how they were built.** They were `seaSimple`
> ("Sea simple") and `plain` ("Plain"), which described the implementation — the simpler of the
> two sea layers, the one with no layers at all — where a reader wants to know what will appear.
> An unknown name draws nothing rather than erroring, which is also what a stale one stored by
> an older build becomes.

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

### Two pages, one client, and the seam under both

**There are TWO pages and exactly ONE client.** `boat.html` is what a boat opens: one panel,
the phone's own GNSS behind it, nothing else on the page at all. `client.html` is the test rig
— a chart, a boat that sails where it is clicked, the knobs that decide what its receiver
reports, and the same client sitting on top of it as a phone on a desk. **Exactly one thing
crosses into the client on either page, and it is a GPS fix** — a position, a time, a stated
accuracy, a satellite count, SOG and COG, which is all a real receiver hands over either.

So the two pages have two receivers and share everything else:

| | |
|---|---|
| `device.js` + `device.css` | **the client**: the join screen, the screen-switching, the Mark screen, the overview, the selectors, and `feed(fix)`. Imported by both pages |
| `receiver.js` | `navigator.geolocation` as a fix. What ships |
| `boatsim.js` | a simulated boat and a receiver that lies. The rig only |

**Putting the client on a real phone took a receiver and a page, and changed nothing in
`crossing.js`, `raceclient.js`, `markscreen.js` or `device.js`** — the four files that decide a
race. That is what the seam was for, and it is the first time it has been cashed in.

**A second copy of the device would be the one thing that must not happen**, which is why the
extraction came before the page. Two clients drift, the one that fell behind is whichever was
edited second, and the difference is discovered on the water by the only person who can do
nothing about it. So `device.js` holds the screens and `device.css` holds their type, spacing
and colour; each page contributes only what the other has no use for, through a handful of
hooks — `note()`/`wireNote()` for what has to be said before a join, `blocked()` for something
the page is still waiting for, `extras()`/`wireExtras()` for a button under the screens, and
`onJoin`/`onLeave`. The rig passes *Restart lap* and *place the boat behind the start*; the
phone passes the location permission and the wake lock. **Neither page can tell the device
which receiver is behind it**, and `drive-boat.mjs` asserts that against the *import lists*
rather than the prose — both files discuss both receivers in their comments and should.

> **What is NOT shared is the panel's size**, and that is the whole of the difference in the
> CSS. On the rig the device is phone-*shaped* (9:19.5, capped by the window) because it is a
> prototype of a phone sitting on a chart; on `boat.html` it is `100dvh` tall and capped at
> 440px wide, centred, with the space beside it left empty on a laptop. `dvh` rather than `vh`
> because on a phone `vh` is the viewport with the browser chrome hidden, so a panel sized in
> it puts its own bottom row out of reach until something scrolls. The type inside is in `cqi`
> either way, so it follows whichever width it turns out to have.

#### The real receiver, and the two things the web API does not give

**Satellite count: nothing, and nothing invented.** The Geolocation API does not report one, so
the fix says `null` and the screens print an em dash. A plausible number would be a lie in the
one place a sailor looks to decide whether to trust the rest of the screen. The QC gate already
treats a missing count as *no evidence either way* rather than as a failure, so a phone is
judged on its stated accuracy alone.

**Speed and heading: DERIVED, in the receiver, and only when they can be.** `coords.speed` and
`coords.heading` are populated by a phone's GNSS while it is moving and are `null` on a laptop,
on a phone positioned by wifi, and on most devices while stationary. TTL is distance over speed
and the hull is drawn pointing along its course, so a client with neither has no approach screen
worth the name. Deriving them from consecutive positions is what a plotter does, and it belongs
in `receiver.js` rather than in the client: this is the receiver, and a receiver is the thing
allowed to know how its own numbers were arrived at. Two refusals, both where the derivation
would be making things up:

- **Movement inside the stated accuracy is not movement.** Two fixes five metres apart from a
  receiver claiming five metres are one position reported twice, and dividing that by a second
  gives ten knots for a boat on a mooring — which would run the countdown on nothing at all.
  Below the accuracy the speed reads **zero** and the heading is **held**, which is both what a
  plotter shows and what is true: we cannot see it moving. The same reasoning the kinematic gate
  rests on one level up — what the boat could have done plus what the receiver could have made
  up.
- **A long gap derives nothing** (`MAX_GAP_S`, 10 s). A phone that was in a pocket for half a
  minute and comes back two hundred metres away may have sailed there or may have sat still for
  twenty-five seconds and then moved; the average across the gap is not a speed anybody is
  making. The relocation watch is what handles the *position* side of that, and it is better
  served by an honest zero.

> **A stated zero is a reading, not an absence**, and it settles the heading too: iOS reports
> `speed: 0` with a null heading while stationary and a position that still wanders a little.
> Deriving a course out of that displacement would be arguing with the receiver about whether
> the boat is moving, and losing.

`receiver-test.js` pins all of it, including the assertion that matters most: **a fix from
`receiver.js` has exactly the key set of a fix from `boatsim.js`**. The two are interchangeable
only while that holds, and it is the kind of thing that decays one convenient field at a time —
so each receiver's spec asserts the same list.

#### Three things a real phone needs that a desk does not

**The permission is asked for by a gesture, never on load.** A prompt that appears before
anything on screen has said why is a prompt people refuse — and a refusal is sticky in a way
that takes somebody into browser settings to undo. So the join screen carries a panel saying
what a position is *for*, with the button that asks under it, and `drive-boat.mjs` asserts that
the page asks the browser for nothing until it is pressed.

**A course is not taken until the phone has proved it can see the sky.** The join screen is the
one moment somebody is standing still with both hands free; finding out on the start line that
location was refused is the same problem an hour later with nothing to be done about it. Named
in the button — *Allow location first*, *Waiting for the first fix* — by the same rule the rest
of that form follows, and named **ahead of** any unanswered level, because it is a precondition
for all of them rather than another field. A refusal is reported and the watch is **not** torn
down: a position lost under a bridge comes back on the other side, and only a refused permission
is the end of it.

**The screen is kept awake, and says so when it cannot be.** A phone that dims and sleeps is not
a navigation instrument and nobody is going to keep tapping it on a beat. Best effort by
necessity — the Screen Wake Lock API is missing on some browsers, refused when the page is
hidden, and *dropped* every time the page is hidden, so it is re-taken on `visibilitychange`
rather than assumed to have survived. It is shown as a button because it is a promise the page
cannot always keep: a screen that quietly slept would read as the application crashing.

**And a HEARTBEAT, because the one state a screen cannot be prompted into reporting is the
absence of fixes.** The device redraws on every fix, which is right — nothing changes between
them. But when they stop, the most important thing on the screen changes: the readouts go dashed
and the signal line has to say how long it has been and how many went in the bin. A page that
only redrew on a fix could never say that, so `boat.js` redraws once a second regardless. It is
also what counts the elapsed clock up between fixes.

> **Nothing on `boat.html` posts a record yet**, exactly as on the rig. The client accumulates
> what a `CourseRecord` needs and stops there; closing that loop is the next obvious step and is
> deliberately not guessed at.

### The rig

`emit()` in `client.js` reads a fix off the simulator and calls `device.feed(fix)`; `onFix()` in
`boat.js` makes the same call with a `navigator.geolocation` reading. Nothing else crosses on
either page. A test client that shared state with the thing it tests is a demonstration, not a
test — and the seam is *asserted*, twice over: the two receivers' specs pin the key set of a fix,
and `drive-client.mjs` **takes the network away between joining and finishing** — `fetch` is
replaced with something that throws — and sails the whole course with it gone. The
architecture's central claim was previously only in a comment, which is to say nobody was
checking it.

**HIDE COURSE is the one control on the rig that is not a knob on the receiver.** Ticking it
draws no course on the rig's chart — no lines, no end dots, no letters — which takes away the
*operator's* own knowledge of where the marks are and leaves the device beside it as the only
thing saying where to steer. That is the application's central claim, and nothing on this page
could otherwise test it: an operator who can see the line on their own chart will steer by that
without noticing, and the screen under test is never actually relied upon.

What it hides is exactly the geometry. The true track, the accepted fixes, the helm order and the
boat are all still drawn, because they are what the operator steers *with* and none of them says
where a mark is; the tiles are untouched, because a chart with no marks on it is still the water,
and taking that away would be testing something nobody is claiming. It sits beside the basemap
selector, since both decide what the chart SHOWS where Start and Place boat decide what the boat
does, and it lights up when it is on — a rig with the course hidden otherwise looks like a rig
with no course loaded.

> One leak worth knowing about: joining aims the boat *through* the first line, so the helm
> target is course-derived and betrays roughly where that first mark is. Pressing **Place boat**
> replaces it with one of your own. Suppressing the initial aim instead would leave the boat
> stopped on the line, which is the thing `aimAtMark` exists to avoid.

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
every lull. It is therefore the OR of the two — **100 m, or 30 seconds** at the speed being made — and each
covers the other's blind spot: the radius is the floor that works at any speed, the time is what
gets the screen up early for a boat coming in fast.

> **And the distance it reads is to the part of the line the boat would CROSS, not to the
> line's infinite extension** (`approachM`, not `perpDistM`). The two are the same number for
> a line the fleet meets square, which is why the difference went unnoticed. A line running
> *along* the leg — which is exactly the shape a gate's half-infinite sides take, a mark with
> a line running back down the leg from it — breaks it: a boat four kilometres down that leg
> is still only the gate's half-width from both lines' extensions, so the Mark screen took
> over on the start line and never gave it back. The boat is measured to the nearest point of
> the line **between its two defined points**, infinite ends included, which sounds like it
> contradicts *an infinite end is a bearing, not a place* and does not — the point given for
> an infinite end is the handle that says where the fleet actually crosses, so it is precisely
> the right bound for this question. **Nothing about scoring changes**: the extent test still
> runs out without limit, and a crossing out there still counts. It is also the point the plot
> seats its triangle on, so the screen comes up about the part of the line the picture is
> already about.

Three details around it, each of which was a bug first:

- **The screen is given back at 160 m, not 100.** Without that gap a boat holding station near
  a start line — which is what a fleet does for the five minutes before a gun — flips between
  the two screens on GPS noise alone, several times a minute. The gap moved with the threshold
  rather than staying at its old 320 m: what it has to beat is metres of GPS noise, and a band
  three times the trigger would have made the Line screen sticky in a way nobody asked for.
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

**The line's NAME is set at twice the size it was**, and the letter with it. The name is what a
course is discussed in, and at 12.5 px the one identifier everybody else uses was the smallest
thing on the screen. The letter goes up too: a 25 px name beside a 19 px letter reads as a heading
with a footnote, where the two are one fact said twice, short and long. Still `nowrap` and still
ellipsised — a scoped id does not fit at this size, and a name that wrapped would push the plot
down the panel every time the boat reached a mark with a long id. It truncates at the tail, which
keeps the club's prefix; that is the part that is the same on every line, so it is the part worth
losing, and the trade is worth revisiting once anything real is in the field.

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
crossing point where the COG projection cuts, **the line's own midpoint**, the triangle on the
line, the next-leg arrow, and the **last three** fixes behind the boat. Fitting on anything more kept the plot uselessly wide —
the line's ends, which on a quarter-mile start line are a long way from anything that matters,
and the rest of the trail, which at 5 Hz reaches back a quarter of a mile after two minutes and
says nothing an approach needs. Three dots is the fewest that shows a direction rather than a
pair of points. With that list the view closes in as the boat does, which is the whole point of
an approach screen: at thirty metres you want to see metres. Measured over a real approach, the
visible water goes from about 250 m at DTW 277 down to 36 m at DTW 39.

**The COG cut is CAPPED for the purposes of the view, and drawn where it really falls**
(`COG_FIT_CAP`, two line lengths). The cut is one of the things the frame is fitted around, and a
boat sailing nearly parallel to a line cuts it a very long way away — at exactly parallel, never
at all. Honouring its position there zoomed the plot out until the boat was a dot: measured at 88°
off a 300 m line, the visible water was **three kilometres** across, for a crossing point nobody
is steering at. What the picture needs from the projection at that angle is its *direction*, which
a point a bounded distance along it carries just as well; two line lengths because that is the
scale on which a line is approached. The same capped point goes into the **hold** list as well as
the fit, or a far cut would trip "leaving the view" on every frame and the plot would never hold
still. What is **drawn** is never capped — the ring stays where the cut is and the figure reads the
true distance, because capping either would move the warning, which is the one thing on this screen
that must not move. The figure is clipped into the picture instead, like the other side of a gate's.

**The LINE'S MIDPOINT is what bounds the zoom, and without it the plot closed in too far.** The
other point on the line in the fit is the *seat* — the nearest point of the line to the boat — so
as a boat closes, boat and seat converge, and a fit built on those two alone zooms in without
limit, onto a patch of water that no longer contains the mark. It is invisible sailing straight at
the middle, where the seat **is** the midpoint, and plain the moment a boat comes in off-centre:
measured on a 300 m line approached at the pin end, the midpoint left the plot a hundred metres
out and was **419 px off a 400 px picture** by twenty. The midpoint rather than the ends, because
the midpoint is the *mark* — what the leg length is measured to, what DTW counts down to, and on
an infinite end the handle somebody deliberately placed where the fleet crosses. The ends stay
out: on a quarter-mile start line they are a long way from anything that matters. It is in the
**hold** list too, or a frame held while the boat closed would lose the mark between rebuilds.

**And ONE END OR THE OTHER, whichever is nearer.** The midpoint says where the mark is and
nothing about how much line there is: a stroke running off both edges of the picture could be a
fifty-metre line or a quarter-mile one, and the question a boat on an approach is actually asking
— can I fetch the end I am heading for, or am I running out of line — cannot be read off it at
all. The *nearer* end, because "one or the other" is satisfied either way and the nearer one costs
the least zoom and is the one a boat near that part of the line risks running past. When the boat
is already beyond an end it asks for nothing new, the seat being clamped to the extent.

> **What it costs, measured at 20 m out.** On a 92 m gate side, nothing at all: 75 m of visible
> water either way. On the club's 174 m windward line, 75 m → 103 m; on its 199 m leeward line,
> 75 m → 118 m; on a 300 m line, 75 m → 177 m. So the approach still closes in by four to six
> times over a whole approach, just not to the last 75 m — and the boat, drawn to scale, ends at
> 28–32 px instead of 44 px on the club's real lines. The tightest view is now roughly half the
> line's length, which is the honest consequence of being asked to hold an end.
>
> A side effect worth having: the frame no longer depends on *where along the line* a boat comes
> in. Centred and at-the-pin approaches used to close to 75 m and 165 m respectively on a 300 m
> line; both are 177 m now, because the picture holds the same three things either way.

> A centred approach is **unchanged at every range** — the two points coincide, so the plot goes
> on closing in exactly as it did. Only the off-centre approach is held back, and only as far as
> the mark: at the pin end the visible water stops shrinking at about 165 m instead of closing to
> 75 m around the boat. The spec sweeps both, in all three orientations.

> **The triangle and the arrow are fixed PIXEL sizes, so they cannot be fitted as points in
> metres** — how far they reach depends on the very scale being solved for. Their *direction*
> does not: both hang off the seat along the crossing normal and then along the next leg, and
> each is settled by `up` alone. So the far tip is a known pixel offset from a known metre
> point, and the fit iterates — pick a scale, see where the tip lands in metres, fit again
> including it. `coursedraw.tangentPath` iterates for the same reason; two passes is ample when
> the correction is a fifth of a view. The spec sweeps a whole approach every five metres in
> four orientations and requires all of it to be inside the viewport, because the case that
> breaks a fit like this is always some particular geometry at some particular range.

**Nothing that matters is drawn near the border** (`FIT_FRACTION` 0.7, `HOLD.edgeFraction`
0.1). The fit puts everything that must be seen inside 70% of each axis, and the frame is given
up once anything has drifted to within a tenth of the edge — the two are a pair, because the fit
only decides where things *start* and the hold decides how close they ever actually get, so
widening one without the other buys a better first frame and lets it drift back. An element a few
pixels off the boundary reads as on its way out of the picture, and on a phone in a bracket the
outermost pixels are the ones a thumb, a bezel reflection and a rounded corner take first.
Measured over four whole approaches, the closest anything came to the border went from 25 px to
45 px of a 330 px axis, and the sweep now asserts that buffer rather than mere containment.

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

**Line perp squares up to a GATE's axis, not to one side's own normal** (`gateOf`, `gateUp`).
The two shapes a gate takes pull in different directions. Where the sides are **collinear** — two
lines end to end with a gap — each side's crossing normal already points the way the fleet comes
through. Where they are **parallel**, either side of a centreline, the normals point *outward in
opposite directions*: squaring up to the side a boat happens to be watching turns the display
ninety degrees off the approach, and the other way round the moment it changes its mind, so the
same gate reads two different ways depending only on which side the boat has committed to. The
perpendicular to the join between the two **centres** is the one bearing both shapes agree on —
the normal itself when they are collinear, the approach when they are parallel — so there is one
rule and no special case. **The sign comes from the leg INTO the gate**, never from where the boat
is: a join has two perpendiculars and the geometry cannot choose, and taking the one pointing from
the boat towards the gate would flip through half a turn as the boat drew level, which is the
latch and the one moment the display must hold still.

**There is a fourth orientation, COG up**, which is the one every plotter has: the boat's own
heading straight up, so what is ahead on the screen is what is ahead over the bow. It sits beside
Leg up because the two are the course-referenced pair, and the difference between them is worth
stating — it is the difference between where the boat is *going* and where it is *meant to be*
going. On a beat, Leg up holds the rhumb line up and the boat points thirty or forty degrees off
it, which is what shows the tack; COG up holds the boat up and swings the world on every tack
instead. That swing is the cost, and the reason the brief left it out: a COG is noisy and a
display following it wanders. What makes it usable is that nothing here snaps — `Turner` eases the
displayed bearing at `TURN_DEG_S`, which low-passes the jitter into a slow drift rather than a
shake. With no COG to hand it falls back to the leg, never to north, because snapping the world to
north the moment a receiver hiccups is the opposite of what somebody choosing this asked for.

**The sailor can also overrule the screen choice** (`VIEWS`, `RaceClient.setViewMode`). AUTO is
the default and is the design — the sailor never has to *ask* for the Mark screen — but never has
to is not cannot: somebody setting up, checking the next leg on a long beat, or simply disagreeing
with the rule has every right to pick, and a display that refused would be insisting it knows
better about what somebody wants to look at, which is not a thing it can know. Three states,
**Course / Line / Auto**, on both screens, because either may be the one you want to leave.

> **Forcing does not switch the rule off.** The hysteresis goes on tracking underneath, so AUTO
> resumes with the answer for where the boat is *now* rather than for where it was when a button
> was pressed. It lives on the `RaceClient` rather than on the page, because `view()` is the
> single answer to "which screen" and a page holding its own copy would be a second rule to keep
> in agreement with the first. A complete course still answers *overview* whatever is forced —
> there is no mark to force. And anything other than the three reads as AUTO, so a stale value
> cannot strand somebody on a screen with no way back.

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

**The overview marks the line the boat is heading for, in the live triangle's own colour.** The
live crossing's triangle has always been green while every other was blue or grey — and the line
under it was the same blue as all the rest, so the one thing on the picture worth finding was
marked on a shape a few pixels across and not on the hundred-metre stroke it sits on. A line may
carry several crossings, and it counts as live while **any** of them is: it is the same piece of
water either way.

**And it runs the COG out as far as the picture goes.** On the approach screen the projection
stops where it cuts the line, because there the question is where on *that* line it lands. Here
the question is the other one — what is the boat pointing at — and the answer is only legible if
the line reaches whatever it is pointing at: the next mark, the far end of a gate, the shore. Run
to the viewport's diagonal so it leaves the picture whichever way it runs, and clipped by the
viewBox rather than by arithmetic. **Forward only**: a line drawn *through* the boat would show a
back bearing nobody asked for, and on a course where the boat has just turned it would point at
the mark behind.

**The overview can be zoomed and panned, and has a background** (`OverviewView`, `chartBar`,
`basemapArt`). Three things about it:

- **It re-fits every frame until somebody takes hold of it.** Seeing the whole course is what the
  screen is for and a held frame would let a boat sail off the edge of its own course — but a
  picture that re-fits while you are dragging it is a picture you cannot drag. So the first zoom
  or pan **anchors** the fit as it was at that moment and the hand controls work from there;
  **Fit** gives it back, and is dead while there is nothing to reset. Bounded to a quarter and
  sixteen times the fit: these are for looking *into* the picture and back out a little, not for
  replacing it.
- **The pan is held in screen pixels, applied in rotated space.** A drag should follow the finger
  by the distance the finger moved, whatever the display is turned to; moving the picture right
  by P pixels is moving the centre left by P/scale in the rotated frame, which is the same
  there-and-back the extent's centre already does. Followed on the **document**, not the chart:
  the panel is rebuilt on every fix, so a `pointermove` wired to the element the drag started on
  stops arriving halfway through and the chart follows the finger and then sticks.
- **A background never blocks.** Tiles are `<image>` elements, so the browser fetches them on its
  own and nothing on the path from a fix to a drawn course touches the network — no await, no
  `fetch`. `drive-client` holds it to that: it renders the overview with the sea chart selected
  while `fetch` is replaced by a thrower, mid-blackout, and the unit spec does the same. The
  default is `none`, because a screen whose whole claim is that it works with the server switched
  off does not open by asking a tile server for anything.

> **Dimmed hard** (`BASEMAP_INK`, 0.32), and that is not a nicety. Every tile server worth using
> draws for a white screen, and these screens are dark because they are read in glare and at
> dusk; laid on at full strength the background becomes the brightest thing on the plot and the
> course is a thin cyan line over a bright page. Drawn on a **square the size of the viewport's
> diagonal** and rotated by `-up`, because the picture turns and a viewport-sized patch of tiles
> would leave the corners bare at every angle but north-up.

> **The Mark screen gets none of this.** It is offline-first by a rule that is not up for
> trading, its frame is held on purpose so there is nothing to pan, and at its scale — a couple
> of pixels to the metre — every tile server in the world is out of zoom levels and would hand
> back a blur to sail by.

The overview otherwise always re-fits, unlike the Mark screen: seeing the whole course is what an
overview is *for*, and a held frame would let a boat sail off the edge of its own course. The fit is done
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

**TIME TO LINE COUNTS DOWN TO THE LATCH, NOT TO THE WATER** (`confirmSeconds`). A crossing is not
latched when it happens, it is latched when it has been *proved*: the detector wants
`confirmFixes` consecutive fixes resolved to the far side before it will call it, which is what
stops a boat sitting on a line assembling a crossing out of noise. So between the bow cutting the
line and the screen saying CROSSED there is a real gap — at one fix a second with the default of
three, about three seconds — and a countdown that ignored it reached zero and then sat at zero
while nothing happened, which reads as the application having missed it.

The estimate is **the fix interval times the count**, and both halves are honest: the count is the
detector's own, and the interval is measured from the fixes actually arriving rather than from
what the receiver was asked for, so a receiver reporting half as often is twice as long to be
sure. It over-estimates by up to one interval — the first confirming fix may land immediately
after the crossing, so the true delay is between `(N-1)` and `N` intervals — and that is the right
way round: a countdown that reaches zero a moment early has told the truth late, where one that
reaches zero a moment late says the boat has crossed when it has not. `timeToLine()` returns the
parts as well as the total (`reachSeconds`, `confirmSeconds`), so a screen can show the split
without re-deriving it.

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

**The boat is a HULL SEEN FROM ABOVE, not an arrow** (`BOAT`, drawn by `boatArt`). An arrow says
which way something is pointing and nothing else — and on a chart it reads as a cursor or a
bearing marker, the two things this is not. What a sailor should recognise without deciding to is
*a boat on the water, heading that way*, and a plan view gives that for the same pixels: a pointed
bow, the beam carried aft of midships, and a transom that squares off the stern, which is what
makes the forward end unmistakable from the after one at thirteen pixels. The mast is the disc,
and it is what says *sailing* boat.

**No boom, deliberately.** A boom is drawn at an angle, and an angle is a claim about where the
wind is and which tack the boat is on — neither of which anything here knows. A spar drawn at a
guess would be the one part of the picture that was made up.

**One path, one routine, three charts.** The approach plot draws it to scale (its real size is the
point there), and the course overview and the rig's chart each draw it at a fixed size — an
overview is re-fitted to a whole course and the rig is panned and zoomed at will, so on both of
those a boat to scale would be a pixel on a passage leg and a monster on a short
windward/leeward. Three copies of the path would be three things to keep in agreement, and the
one that fell behind would be whichever was edited second. `northPointer` keeps its arrow, which
is the one thing on these screens that really is a direction and not a boat.

> **The beam moved, and with it an invariant.** The dart was 0.67 of its length across; a hull is
> **0.42** (measured off the path with `getBBox`: 27.000 by 11.340). So the boat's beam against the
> line's thickness went from 2.2× to **1.4×** — still wider than the line at every range, which is
> the rule, and the length is still over three times it. Beamier than a 10 m yacht really is
> (about 0.32), because a hull drawn honestly narrow is a sliver at thirteen pixels; narrower than
> the dart, because a dart is not a hull. The spec asserts the surviving invariant rather than the
> old number.

**The boat and the line are drawn at their REAL SIZE** (`REAL`: a 10 m boat, a 3 m line), which
is how the plot shows closing. A glyph of fixed pixel size says nothing about range — at four
hundred metres and at four it is the same picture. To scale they grow together, and the moment
the boat is several times the width of the line is a moment nobody has to read a number to
understand. Measured over an approach: the boat goes 13 px → 50 px and the line 3.9 px → 15 px
between 400 m and 15 m. The line is drawn with **butt** ends, because a round cap extends a
stroke half its width past the point it was drawn to — invisible at three pixels, half a
boat-length at thirty, and extending it exactly where the extent test says it stops.

> **The line is 3 m, not 5, and ONE CLAMP governs both — the two together are why the picture
> looked wrong.** The glyph's beam is two thirds of its length, so a 10 m boat is drawn 6.7 m
> across; against a 5 m line that is a third wider than the line is thick, and a narrow dart a
> third wider than a bright band running the whole width of the plot does not read as the bigger
> object. Three metres is also what that width honestly is — it is the accuracy band, and a
> receiver reporting two or three metres gives you two or three. At 3 m the beam is over twice
> the line's thickness at **every** range.
>
> The second half is the clamp. Both bounds are floored (at four hundred metres a 10 m boat is
> ten pixels and would vanish) and capped (neither should swallow the plot), but the line's
> bounds are now **derived** from the boat's by the ratio of their lengths, so the clamp cannot
> put the pair out of proportion. Asserting them independently is what broke it: the boat sat
> frozen on a 13 px floor from about 130 m out while the line went on scaling down to 3 px, so
> over the part of an approach that takes longest the line visibly thickened and the boat did not
> move at all — the ratio drifted from 4.3:1 at four hundred metres to 2.4:1 at a hundred and
> seventy-five. Derived, it is exactly `boatM / lineM` at every scale, and the spec checks that
> at eight ranges rather than one. Inside the floor the pair are frozen *together*, which is
> honest — an honest 10 m boat out there is four pixels — and growth begins for both at the same
> moment.

**An infinite end is as substantial as the line itself.** It is not a weaker part of the line, it
is the part that *cannot be missed* — if anything the safer water to cross — and drawn as a thin
fading hairline it read as the opposite: a boundary petering out, something to stay inside.

**Both sides of a gate are drawn, one in focus.** The other is shown where it falls in view and
is deliberately **not in the fit**, so it never costs zoom from the side the boat is actually
sailing at; it is drawn first, so the focused one is over it where they meet; and its triangle is
outlined rather than filled — the shape says the sense either way, the fill says which one the
screen is about. One routine (`crossingArt`) draws both, because a subdued copy written separately
is where a change to how a line is drawn would quietly fail to reach.

**Both sides get a PERPENDICULAR DISTANCE and both get a NEXT-LEG ARROW**, because those are the
two things the choice is actually made on and they differ between the sides. One distance said the
sides were the same distance away — nearly true on a parallel gate and not true at all on a
collinear one — and one arrow said the other side had no leg out of it. Each side's distance comes
from **its own detector** rather than being measured by the drawing (how far off a line a boat is
is the detector's question, and two sides answered by two routines would put two different
quantities on one screen drawn the same way), and each arrow runs from **that side's own
midpoint**, so the pair say what taking each side costs on the leg that follows. Subdued and drawn
before the focused pair — half the label size, less ink, the same relation its triangle already
has — so the comparison is *offered*, not asserted: what the readouts, the clock and the fit
belong to is never in doubt.

> **The other side's figure comes to the viewport, the viewport never goes to it.** Its line is
> not in the fit, so its perpendicular foot is routinely outside the picture — measured on a real
> gate, the midpoint of those dashes landed at x=711 in a 400 px plot. So the figure is placed on
> the part of its own dashes that can be seen (`clipToView`), which keeps the rule that the figure
> sitting on the dashes *is* the label.

**The perpendicular distance is written in the LINE's colour, and the two figures go to opposite
sides of their dashes.** They were `--muted` and `--cog` — two cool greys a shade apart, which at
a glance from a cockpit is one colour, so nothing said which figure was the distance to the line
and which was the distance along the COG. The perpendicular is about the line, so it takes the
line's own cyan; the dashes stay muted, because they are a construction line and cyan there would
put a second line on the water. And both figures run from the boat to somewhere on the line, so a
boat pointed square at the line had them within a pixel of each other — the perpendicular foot and
the COG's cut are the same place.

> **And no two figures are ever drawn over one another: the COG's gives way.** Opposite sides
> and different fractions along the dashes separate them over almost the whole approach, but not
> in the last thirty metres square on, where the segment is too short to pull them apart along it
> — they overlapped into "30 3m0 m". The geometry that squeezes them is exactly the geometry that
> makes the second figure redundant: square on and close in, the distance along the COG *is* the
> perpendicular distance, to the metre. So the perpendicular keeps its figure and the COG's does
> without, which costs nothing, since the dashes and the ring still say where the present course
> cuts. `labelBox` estimates where a figure lands and `boxesClash` says whether two would
> collide — one routine, used by the drawing *and* by its spec, so the two cannot disagree about
> what "on top of each other" means. Measured over 65 frames of a five-range, thirteen-heading
> sweep, the COG's figure gives way in **3**.

> **Opposite sides was not enough, and a screenshot said so.** Half a figure's height each way is
> 36 px between two readings 70 px wide: they overlapped into "61 0m m". Nor is widening the
> offset the answer on its own — the two segments share the boat and diverge by only a few
> degrees, so both offsets point much the same way and widening moves the pair together. What
> separates them is sitting at different **fractions along their own dashes**, a fifth and four
> fifths, which pulls them apart where the segments actually diverge. Measured over every heading
> that still cuts the line ahead, at 150 m and at 60 m: the closest the two boxes come is 16 px of
> clear space, against 27 px of overlap before. The spec sweeps five ranges and thirteen headings
> and guards the anchors, since a text box needs a DOM and these specs run in `node`.

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
total that has stopped, marked as final because it is then a result rather than a reading.

> **Final is said by the COLOUR, not by the label.** The label read "Elapsed — final", written
> with an `&mdash;` and then put through `esc` like every other label — which escaped the
> ampersand and printed the entity, so the screen said `ELAPSED &MDASH; FINAL`. The fix is not to
> escape it less: a label is text, `esc` is right, and a label that has to carry markup is a label
> saying too much. `.readout.done` already turns the row green when the clock has stopped, which
> says *result* at a glance and in the place somebody is already looking — the number itself. Both
instants come off the *interpolated* crossings — that is the entire reason the detector
interpolates, and showing a fix time would throw the precision away at the last step. On a cycle
each lap restarts it, which is what makes the number a lap time.

**BTW and DTW have the course screen's own line, at twice the size.** They are what that screen
is *for* — which way, and how far — and they were sharing a row with two numbers that are not:
speed, which the boat can feel and which says nothing about where it is going, and elapsed,
which matters once at the end. Sharing made all four small enough to need looking at rather than
glancing at. SOG is gone from it.

**BTW, DTW, Started and Elapsed FILL the panel's width, and the ceilings are measured rather
than chosen.** Each row lays its cells out as equal columns across the whole width
(`grid-auto-flow: column` with `1fr` tracks, so the count follows the markup and the finished
state's third cell needs no second rule), and the figures are sized in **`cqi`** — a fraction of
this panel — so they go on filling it when the panel narrows. Three things about the numbers,
each of which was wrong first:

- **Sized against the SYSTEM font, not Barlow Condensed.** There is no webfont link on the page,
  by the same rule that keeps tiles off the Mark screen, so the condensed face is only there if
  somebody has it installed — and sizing to a face that may not load is how a number ends up
  clipped on somebody else's machine.
- **The binding string is not the obvious one.** At a 400 px panel `360°` would take 97 px of
  type but `12.34 nm` only 58.7 px, and a passage race really does show a DTW over ten miles.
  Started is 44.9 px across two cells and 28.7 px across three. So DTW sets the steering row and
  Started sets the timing row; measured, not guessed.
- **The paddings and the gap are in `cqi` too, and that is what makes one figure per row safe at
  every width.** Fixed at 12 px they eat proportionally more of a narrow panel, so a size that
  just fitted at 400 px overflowed at 230 px — which is the width this panel takes on a short
  window. Scaled, a cell is 45.5% of the panel whatever the panel is, and the ceiling is a pure
  ratio.

> **A bearing's degree sign is part of the NUMBER, not a unit beside it.** Units are set small,
> and a small ring shares its baseline with the digits — beside a 54 px figure it sits in the
> bottom third and reads as a decimal point, which turns a bearing into a fraction. At the
> digits' own size it lands where the type designer put it. `nm` and `m` stay units, because
> that is what they are.

**The RIG is always full height, and the device's constraint must never reach it.** The rig is
the chart the boat is sailed on and the knobs that lie to it — it is the desk, not the device, and
every pixel of it is worth having. Two things had to be right for that:

- **`align-self` on the device, never `align-items` on the split.** Putting it on the grid stopped
  the rig stretching as well, which left it at its content height and collapsed the chart — a
  flex child free to shrink — to a thin strip.
- **One definite grid row (`grid-template-rows: 100%`).** An implicit `auto` row is sized by its
  tallest content, so anything inside that wants to be taller than the window grows the row
  instead of being clamped by it, and `height: 100%` on a child then resolves against the grown
  row, which is circular and lets content win. The chart is an SVG, and an SVG with a viewBox has
  an intrinsic ratio it will happily impose at that width. With the row definite the rig stretches
  to exactly the window and the chart shrinks inside it (`min-height: 0`, with `overflow: hidden`
  as the backstop). Measured at 1000, 700 and 500 px of window: the rig is the full height at each,
  and it gets *wider* as the window shortens, since the desk keeps the space the phone gives up.

**The device panel is NOT REBUILT while somebody is choosing a background.** It is rebuilt from
scratch on every fix, and rebuilding it destroys the elements in it — including a `<select>`
whose popup is open, which the browser then closes. At a fix a second that made the background
unpickable: the list appeared, the next fix arrived, and it vanished before the pointer reached an
option, which reads as the menu closing when you move the mouse over it. So the render is held
while that control has focus — the same rule the editor follows for a field somebody is typing in,
for the same reason. Held on **focus** rather than on a flag of our own, so it cannot stick: the
moment focus goes anywhere else the panel resumes, and nothing has to remember to release it. The
`change` handler blurs first, or the hold would freeze the panel on the very render meant to show
what was just chosen.

**THE DEVICE IS A PHONE ON THE DESK, not a column beside it.** It was the right-hand half of a
two-column grid, which made it a panel of the page — and a panel is not what is being
prototyped. What ships is a phone in a bracket, and a phone sits ON the chart the way it sits on
a cockpit bulkhead: over the water, in the way of some of it, movable when it is in the way of
the wrong part. Giving the rig the whole window also gives it back the quarter of the screen it
was paying for a column that is now a floating object. There is a case round the screen — an
earpiece slit, a lens, a home indicator — because the shape alone did not say *phone*, and a
rounded box over a chart says *dialog*.

> **It is dragged by the CASE and never by the screen, which is the whole reason there is a case
> rather than a border.** The screen's own chart pans on a drag; a phone that also moved on one
> would be two gestures fighting over a single pointer, and whichever won the other would be a
> control that sometimes does nothing. The case settles it the way the real object does — you
> pick a phone up by its edges — so a press that started anywhere inside the screen is not a
> drag. Followed on the **document** like the chart's own pan, because a pointer leaves the case
> the moment the phone is behind the finger rather than under it.
>
> **Clamped by its edges, not by its corner**: a strip of the case is always in the window on
> every side, because a phone dragged just past the edge and released is a phone nobody can get
> back and this page has no command to fetch it. It starts clear of the rig's own bar, which is
> the one strip that must never be under it — those are the controls for the chart it is
> sitting on.

**The device panel is phone-SHAPED, not merely phone-wide** (9:19.5, written once as an
`aspect-ratio`). It was 400 px against the full window height, which on a desktop monitor is
1:2.5 — a panel that shape has room for things a phone has not, so anything laid out until it
"fits" fits nothing. The *height* is what is capped, by the window or by what 400 px of width
implies, and the width follows from the ratio, so the two can never disagree; on a short window
the panel narrows instead of being cropped, which is the whole reason the type is in `cqi`. It
carries a bottom border, because without one the panel's shape is invisible — the page behind is
the same colour — so limiting it would change nothing anybody could see and the empty water below
the last row would read as a layout fault.

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

**The join screen asks the course question one level at a time, and remembers the boat.** Series,
course and variant start **empty** and populate only as the level above them is answered; the
button under them names what is still missing rather than sitting greyed out in silence. It used
to default every level to the first thing in its list, so the screen opened with a complete course
already selected — which reads as a suggestion, and a suggestion nobody made is how a boat ends up
sailing yesterday's course on a race morning. Worse, "the first thing" is whatever the map
happened to iterate first: not the club's main race, not the nearest, not the most recent.

> **The club is the exception, and is remembered rather than defaulted.** A sail number, a boat
> name and a club are facts about whoever is holding the phone, and asking for them again on every
> join is asking somebody to re-type what has not changed; the series, course and variant are the
> decision being made. `sessionStorage` for now — it lasts a session, which is what "the same boat
> all afternoon" needs, and it does not quietly become a permanent setting on a shared phone. The
> real home is whatever the Capacitor build uses, which is not built yet. Wrapped in a try, because
> storage is not always there to be had and a join screen that threw rather than opening would be
> the worst possible trade for remembering a sail number. A remembered club that is no longer on
> offer falls back to unchosen, since a `<select>` whose value matches no option shows blank.

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

**The REVISION is shown wherever a snapshot is named** (`snapshotName`): in the list, in the
breadcrumb, in the message after a capture, as well as in the form. The label is for reading and
the hash is for checking, and only one of them is what a boat was handed — a label is
`div-1/2027-06-06`, the design and the day, which is how somebody talks about a capture; the
revision is the twelve hex characters a record carries, that `GET /api/courses/{revision}`
answers to, and that the client prints in its own top bar. Comparing what a fleet is sailing
against what the editor is showing means comparing *those*, and a list of labels made the one
question somebody actually asks — *is that the one they have?* — unanswerable without clicking
through to a form. Set smaller and dimmer than the label, because it is there to be held up
against another one rather than read.

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
   See "One metre, everywhere". The Mark screen reads `projectCog()` — the ring
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

   > **Narrowed, in [the dialog document](wiki/client-server-dialog.md) §7.1, to the half that can
   > be solved: AUTHENTICATE AUTHORITY, TRUST DATA.** OpenID for race officers, and nothing at all
   > for boats — because a boat's positions and instants are trusted by design, so a login would
   > only put a name to an unverifiable claim, while publishing a course or abandoning a race is an
   > act imposed on a fleet and *who did this* has an answer that matters. What that leaves
   > unsolved and named rather than hidden is **impersonation**: any device can claim any sail
   > number, and §1.1 trusts a boat about *itself*, not a third party about a boat.
9. **Capacitor.** Not yet present. Background-geolocation behaviour, iOS Safari suspending
   the Geolocation API in the browser fallback, and plugin versions all shift; verify at
   build time rather than trusting the brief's §7.
10. **Which gate side a boat took** is recorded by the client as well as the record, and
    still nothing downstream uses it. On the Mark screen it now shows: each side of a gate
    carries its own next-leg bearing, measured from **that side's** midpoint to the mean of
    the next step's, so the two arrows say what the choice costs. What is still taken to the
    mean is **DTW** on the course screen, which is deliberate — a leg into a gate is measured
    to the point between its sides, so DTW and the published leg length stay one quantity.

## Not built yet

Of the three screens in brief §3, the **Mark** screen is built — all three states, all four
orientations, the plot and the readouts — with a **course overview** behind it standing in for
the Course screen. Both run on a real phone's GNSS at `boat.html`; what is still missing there
is the **Capacitor wrapper** and an **offline tile cache**, so a background is a live fetch and
the browser may suspend the watch in the background. **Live place** does not exist at all.

What the client stops short of, deliberately rather than by omission:

- **Nothing posts a `CourseRecord`**, on either page. The client holds everything one needs and
  closing the loop is the next obvious step.
- **The Course screen has no other boats on it**, which is most of what the brief asks that
  screen for. That needs a fleet feed, which needs the dialog in
  [`wiki/client-server-dialog.md`](wiki/client-server-dialog.md) — where the three screens still
  missing are specified: **Race progress** (the brief's Live place), the **channel** (one inbox
  for chat, course changes and flags, acknowledged by envelope id), and **alerts**, which never
  open over an approach and show as a banner until it ends.
- **The handicap is carried, not applied.** The join screen collects a TCF and does nothing
  with it, because turning a TCF into a distance is open question 5.
- **No orientation is remembered** between sessions, and nothing is cached across a reload:
  a refresh is a fresh join. On a phone that is the sharper cost, since a browser reloading a
  backgrounded tab throws away a joined course mid-race; the snapshot and the crossings so far
  are what a real client would have to keep, and `sessionStorage` is where the boat's identity
  already lives.
