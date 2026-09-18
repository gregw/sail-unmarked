# The course editor

**Shore-side authoring: points, lines, courses, variants, races and the file they are written back
to.** `editor.html` / `editor.js`, with the geometry in `coursedraw.js` and the file handling in
`ProgrammeWriter.java`. Those files' comments carry the detail; this is the shape and the rules.

---

## Why there is an editor at all, and where the network boundary is

The decisions it supports are **visual and cannot survive an interchange format**: an infinite end's
second point is a handle whose only job is to put the line's midpoint where the fleet actually
crosses, and which end is `port` follows from the sense you intend to cross. GPX carries neither.

Hence the split — **points may come from anywhere** (a GPX import is a reasonable future addition),
**lines and courses are authored here**, because their semantics don't round-trip.

> **Tiles are a network dependency, and the editor is a shore-side desk activity.** That is fine
> here. It must never leak into the Mark screen, which is offline-first and non-negotiable.

**It saves as you go** — every completed edit (form blur, drag end, click-place) is written straight
back through `PUT /api/programmes/{club}/{series}`: points, lines and courses in one body, because one
gesture can change two of them. **Undo holds exactly one edit**, in memory, until reload or a
programme change; the file's longer history is git's job.

---

## The pane is a drill-down, and every level is a SELECTOR

A label, the current value, and that level's commands.

```txt
  Club     [ myc.org.au            v ]
  Series   [ 2026-summer           v ]  + ⧉ ✕
  ▸ Series details
  [ Points | Lines | Courses | Races ]      the tab strip, at the SERIES level
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

A selector says what is chosen *while it is shut*, takes one line rather than a hundred and fifty
pixels, and is a control nobody has to be taught. The rules that hold it together:

- **The club and the series are two questions.** A club has several series and a series belongs to one
  club, so choosing is naturally two steps. **The club carries no commands**: a club is a domain — not
  created, renamed or deleted here, since a rename would be a migration across every record path and
  the ledger's own filename.
- **A level's fields sit inline under that level's own selector**, and the chevron is on the FORMS
  rather than on the selectors: what is worth getting out of the way is the long half. Fields start
  **open**, because they are what you came to the level for; the series' own fields are the exception,
  being an id and a title nobody edits twice.
- **An empty option is offered only while nothing is chosen, and it carries no value**, so a selector
  cannot be a way to un-choose a course and land the pane in a state whose only content is an apology.
  A level with nothing to offer is **disabled** and says why in the empty option — *no variants* is a
  different fact from *none chosen*.
- **The SNAPSHOT level is the exception** (`keepEmpty`): *nothing chosen* is that level's ordinary and
  useful state, meaning you are editing the design. So its empty option stays, worded as the action
  **← back to the design**. A `<select>` fires no `change` for the option already selected, so a
  toggle back would be unreachable.
- **Opening the variant selector and landing back on the same variant also lets the capture go.** Going
  to that selector is an act of attention on the design level. `change` cannot see it, so it is the
  **pointer that opened the list and the blur that closed it** — gated on the pointer, because a blur
  alone would drop the capture for somebody merely tabbing through the pane.
- **The form holds fields only.** Every command that acts on a level is on that level's row; buttons
  that edit a *field* stay beside the field they act on. **`Snapshot` sits with the design it
  captures**, at the end of the variant's form, not among the commands that create and delete variants.
- **The three view tickboxes are PINNED to the foot of the pane.** They are settings for the chart, not
  a level of the drill-down. Only on the Courses tab.
- **The pane is ONE scrolling surface**, not a column of regions that each scroll. The one box that
  scrolls inside it is a **list slot**, which is a fixed-height resizable box on purpose.
- **The pane is two surfaces, the fields lighter than the pane they sit on**, so a form reads as
  something to type in.
- **`public` is said in the course selector's own option text** (`manly-to-shark — public`). An option
  cannot carry a chip, and *which of these is the fleet being offered* is a question about the list.
- **Explanation lives in hover popups**, hung on the level selector. A paragraph telling you how the
  pane works is read once and then permanently in the way.
- **An id sits beside its long name, 40:60** (`.idname`, used by all five forms that have the pair).
  They are the same thing said twice — the key and the label.
- **Every list is sorted by id** (`byId`). **The file keeps its own order regardless**: the writer emits
  the map it is given, and nothing in the editor reorders what is on disk.
- **The sequence folds, and folded it still answers for itself** — how many lines and how far, the two
  questions worth asking from outside it. The count is of **rows, not steps**: a gate is one step and
  two lines to cross. The fold is part of the form's render key.

### Three traps in the rendering, each of which was a bug

- **`formsChanged()` clears every form's guard, and that is why it exists as one call.** The guards stop
  a form being rewritten while somebody is typing in it; a caller that cleared one and forgot another is
  a form that silently stops updating.
- **Anything on a form that depends on state moving underneath must be SYNCED, not baked into the
  markup.** Both forms return early while the same thing is selected — the guard exists to keep the
  caret — so state computed at first draw goes stale. `syncCourseForm` owns it and runs after every
  render.
- **The message line lives OUTSIDE `#rows`.** That container is rebuilt whenever the pane changes, and
  a message written into it is wiped by the very render that follows the thing being reported.

### A rename saves itself

The form saves on blur, which is right for every field except the id: a rename re-renders, and the
re-render destroys the input the browser is in the middle of leaving, so the `blur` that would call
`endEdit()` lands on a detached node or never fires. All four renames — point, line, course, variant —
call `endEdit()` themselves before rendering; a later blur is a no-op.

---

## The chart

- **The bar directly above the chart carries what acts on the chart** — background, undo and save state
  — and nothing else. Choosing a club and series is choosing a *scope*, so the programme selector sits at
  the head of the pane instead. The editor **opens on the Courses tab**.
- **The cursor says what the chart will do**: an arrow over open water, a hand over a handle, a closed
  hand while something is moving, a crosshair while a click is armed.
- **The wheel zooms by how far it moved, not by how many events arrived** (`wheelZoomStep`). A mouse
  notch and a trackpad flick are wildly different amounts of intent. Deltas are normalised from all three
  `deltaMode` units to pixels and clamped per event.
- **Selecting a line frames it to a fifth of the chart** (`FRAME_FRACTION`), not four fifths: what a line
  *means* is where it sits relative to the shore and the marks around it.
- **A point holds selection only on its own tab.** It stays draggable from the Lines and Courses tabs,
  but dragging it there must not leave it selected — otherwise every later click teleports it.
- **Every drag handle is drawn last** (`HANDLES`). A handle buried under a leg or a triangle is one you
  cannot hit. The midpoint grip is twice the size of the plain midpoint dot, because it is a *target*.
- **Four chart backgrounds** — `none`, `OSM`, `chart`, `sea` — from `BASEMAPS`, least ink first. `chart`
  and `sea` share one Esri Ocean base; **sea** stacks OpenSeaMap's seamark layer, which is invaluable
  while placing a line against the real marks and a great deal of ink once they are placed. **They are
  named for what they draw, not for how they were built.** An unknown name draws nothing rather than
  erroring.
- `geo.js` is lifted from `nemesis-delta` — Web Mercator in world-[0,1] coordinates, tiles as plain SVG
  `<image>`, no mapping library. **Keep it that way**: a mapping library would bring a second geometry
  model to disagree with `crossing.js`. What is new here is `MapView.toPosition()`, the inverse
  projection — which is the whole difference between a viewer and an editor.

### Lines

- **Starboard is offered before port, and adding a line arms the chart.** A forward crossing leaves the
  starboard end to starboard, so placing that end first fixes which way the line is crossed. Adding a
  line arms the starboard pick and chains to port the moment starboard lands, so **a new line is two
  clicks on the chart and nothing else**.
- **A line end is either NAMED or INLINE**, the same distinction the course model draws one level up.
  So **clicking open water names nothing** — it gives the end an inline position — and **clicking near an
  existing point still reuses it**, which is the one case a click names something, and it has to, or two
  lines that meet at a mark would drift apart on the next correction.
- Four ways to set an end, because four moments want different things: choose an existing point; pick on
  chart and click a point; pick on chart and click open water; or press **inline**, which copies the
  point's coordinates in and lets go of the name, so the line does not move as it detaches. The reverse
  needs no second button.
- **An inline end is dragged on the chart, and a line loose at both ends moves bodily** — by the drag,
  not to the cursor. A named end needs no handle, its point being draggable already. Neither grip appears
  on the Points tab: the tab is the scope.
- Dragging a shared line's end from the Courses tab asks the same question a shared point does
  (`moveLine`); `detachLine` is the answer's ad-hoc branch, and the copy's **ends come across as they
  are**, so a named end stays named. Only the thing actually detached is detached.

### Moving or turning a whole course

A dashed box round the variant's extent with two grips: move at the foot, turn at the head, on the
**outer limits** rather than in the middle — the middle of a course is where the course is.

**The grips show by default when the course owns everything it is built from** (`transformShown()`): a
variant with nothing shared was taken from a template to be raced, and no drag of it can reach another
course. A course built on the club's surveyed marks keeps them hidden until asked.

**Headings show while something is moving, and the track stands down.** A turn changes every leg's
heading, so it draws them all — heading, reciprocal and length, at each leg's midpoint, drawn **large**,
because it is the number being steered by while the hand is still on the grip. A whole-course *move*
draws none: it changes no heading.

**A turn happens in a local metric frame** (`rotateAbout` in `geo.js`). Rotating latitude and longitude
directly would *squash* the course, because a degree of longitude is shorter by cos(latitude). The pivot
is the **middle of the extent**, not the mean, which is pulled towards wherever the marks are dense.
Degrees snap to whole ones — a wind shift is spoken about in degrees, not fractions.

---

## Drawing a course (`coursedraw.js`)

Geometry, kept out of the editor so it can be tested without a chart, a DOM or a map — and used by the
boat's overview too, so the course a boat sees and the course it was designed as are one picture.

It holds the one thing most worth pinning: **which way the apex points.** A triangle pointing the wrong
way still looks like a course diagram, so the error would survive being looked at. The derivation lives
once, in `forwardNormal`. The check to re-run if ever in doubt: **a line drawn left to right has its apex
pointing up the screen.**

- **Triangles are a fixed pixel size and do not shrink with the chart** — their job is to be read.
  Several crossings on one line are seated along it in course order; when the line is too short they
  spread at a minimum legible gap and overhang the ends, because an unreadable pile says nothing.
- **Three redundant channels, because one was not enough**: a **colour**, an **arrow** at the midpoint,
  and the **letter** of the step the leg leads to — on *every* arrow, the branches of a gate included.
- **Legs are coloured by what they are FOR, not by sequence position** (`ROLE_COLOUR`): green where a lap
  may begin, red where a lap may end, neutral blue between. A leg that is both draws as a gradient. On a
  cycle there is no sequence to be far through, and the useful question is *does a lap start here*.
- **A cycle's track closes.** Drawing a loop open leaves the one gap a boat never sails.
- **Turns have a radius.** A boat leaving a triangle's apex is still on the crossing heading, so every leg
  arcs out of the apex, runs straight, and arcs back in. `tangentPath` iterates, because the departure arc
  has to aim at where the arrival arc begins and vice versa; the radius shrinks on a short leg rather than
  the arc overshooting. Arrows are placed on the **straight** portion.
- **A gate's alternatives are seated in OPPOSITE orders along their lines**, or a mirrored gate puts each
  rounding's two triangles at opposite ends and collapses their midpoints onto one another.
- **A gate splits AT the gate but joins well down the leg** (`MERGE_FRACTION`), and the asymmetry is the
  point: a choice is made at the gate and paid for over the leg that follows. Both sides use the same
  tangent path as anything else, so there is one cornering mechanism in the file rather than two.
- **A leg's marker is one thing**: a circle holding an arrowhead holding the letter. `ARROW_CENTROID`
  exists because an arrowhead's centroid is not the point it is drawn about.
- **Text inside a triangle is a darker shade of that triangle** (`darken`) — which is also why the
  triangles are filled rather than outlined. Darkening keeps the letter recessive: the shape carries the
  direction, the letter only says which step.
- **Course labels are sized to be read, and double under the pointer.** Hover sets an SVG `transform`
  directly rather than re-rendering, and scales about the label's own anchor — for a triangle its **base**,
  so a grown triangle stays on its line.
- **A hover lights the whole STEP, not the one shape under the pointer** (`data-group="step-N"`, keyed by
  the step a leg *leads to*). They all carry the same letter; lighting one and not the others invites the
  reader to wonder which of them the letter belonged to.
- **The track is a first approximation and is not a sailed track** — apex to next base, showing crossing
  sense and leg order. Nothing in it knows about beating, laylines or tide. Behind a tickbox, because on a
  busy course it is a lot of ink.
- **Hide unused** (courses tab only) draws just the lines the selected course uses. With no course
  selected it shows everything, because a filter that emptied the chart would read as a bug.
- **Course lengths are computed by the server** and returned on both GET and PUT, so the
  midpoint-to-midpoint rule has one implementation. A new step seeds itself with a line *different from
  the previous step's*, and on a cycle away from **both** neighbours, because a repeat makes a zero-length
  leg, which the model treats as an error.

---

## The Races tab

Edits the race *definition* — id, long name, date, format, which race this one **follows**, and one row
per division naming a course and a variant. Conduct is elsewhere; see
[`client-server-dialog.md`](client-server-dialog.md). `selectRace` also selects that race's first
division's design, so the chart shows the water the race is on.

> **THE FORM ASKS WHAT A RACE FOLLOWS; THE FILE STORES WHAT IT IS FOLLOWED BY.** That is the order races
> are actually made in: when you create race two, race three does not exist, so *followed by* is a
> question whose answer cannot be given. The model keeps `next` on the race before, because that is what
> the server reads when a boat stops racing; the form derives *follows* from it and writes it back the
> other way.
>
> Two offers are withheld and both say why: a race that **already leads into another** (choosing it would
> fork the chain and enter a boat in two races at once), and any race **this one already leads to**,
> however far down (a chain that ate its own tail would enter a boat in a loop).

**Leaving a division's variant unsaid means "the course's only sailable design"**, which the server
resolves at join time — and that is an answer only where the course has one. So the empty option says
which case the chosen course is in: it **names** the design where there is one, and says **how many there
are to pick from** where there are several. `Race.problems` reports the second case, because a division
naming no variant of a course with two hands a boat nothing.

**A race another race names as its `next` is refused deletion**, and **a clone does not copy the chain**,
because copying it would enter every boat that finished the copy into somebody else's race.

**A division is not a variant**: a variant is a design, a division is a group of boats, and `Race.Division`
is the mapping between them for one race. **The map key is the division's plain id and the tag is derived
from it** (`Race.tagFor` → `division:div-1`), because a YAML key containing a colon does not produce a bad
id but a *broken file*, on the next autosave, silently.

---

## Writing the file: `ProgrammeWriter`

**It splices, it does not serialise, and that is the important part.** These YAML files are documentation
— they carry the explanation of what a port end is and which crossing senses are unverified.
Round-tripping a `Programme` through Jackson would destroy all of it, silently, on the first autosave:
comments are not data. So the file is edited as text: find the block, replace exactly that, copy
everything else through. The subtle part is where a block *ends* — a run of blank lines and top-level
comments before the next key introduces **that** key, so it is walked back over and left alone.
`ProgrammeWriterTest` pins it.

- **A rename is followed textually** into the block that refers to it, whole-token only: a point rename
  follows `at:` into `lines:`, a line rename follows `line:` into `courses:`. An id is not a label, so a
  rename touching only its own block orphans every reference; regenerating the referring block instead
  would flatten its inline maps and comments to rewrite one word. **A rename carries a `kind`, and undo
  must preserve it.**
- **Folded notes are re-wrapped on emit**, by whole words, so fold → unfold → fold is stable — which is
  what makes a second autosave a no-op.
- `key()` emits a legal id bare, so no real file changes by a byte, and quotes an illegal one, so a
  hand-edited oddity round-trips instead of corrupting the file.
- `spliceOrAppend` exists because `races:` is the first section added since clubs had files: a *missing*
  block there means something different from what it means for points, lines and courses.

> **ANYTHING ADDED TO THE FILE HAS TO BE ADDED IN FOUR PLACES**: the model, the payload, the writer — and
> **the change guard in `endEdit()`**, with `snapshot()` and `takeUndo()` beside it. The fourth is the one
> that fails silently: everything works on screen and nothing reaches the disk.

---

## Editing the series itself

`POST /api/programmes` creates one, empty or **cloned**; `POST …/rename` renames or retitles; `DELETE …`
retires. All gated by `server.configWrites`, and the writes are behind the login — see
[`deployment.md`](deployment.md).

**A clone is a byte copy.** That is the whole point of it: a club starting next summer from last summer's
file wants its banner comments and folded notes. Only the `name:` line is rewritten, textually.

**A rename must follow into the ledger**, whose publication keys embed the series
(`CourseLedger.renameSeries`), and into the audit log. Records need no migration — they are filed with no
series in the path. **Club rename is not offered.**

**Retiring a series keeps its snapshots**, like every other delete here, and is **refused with a 409 naming
what is published** unless forced. The 409 carries a JSON body rather than an HTML error page, because the
editor has to name those courses in the dialog it asks with.
