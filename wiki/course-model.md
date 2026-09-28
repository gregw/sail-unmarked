# The course model

**What a course is made of, how it is identified, and how a design becomes something a boat
can be handed.** The Java records in `model/` carry the detail in their comments; the files under
`data/config/clubs/` are working examples of the format. The reasoning behind the lifecycle half
is in [`course-lifecycle.html`](course-lifecycle.html); what is here are the rules a change has to
respect. How a line is actually *crossed* is [crossing-detection.md](crossing-detection.md).

---

## Lines, not marks

A virtual mark is a **line**, defined by **two points**, each with an `infinite` flag. Never a
point with a radius — that is what keeps RRS 18 out of it and what keeps GPS error from deciding
whether somebody clipped a rounding circle.

Lines live in their own section, **not inside a course**, because they are reused: a club's start
line is the same line in every course it appears in. Courses may eventually mix real marks with
virtual lines, which is the other reason the word is "line".

### Ends are named `port` and `starboard`

- **`forward`** — leave the port end to port and the starboard end to starboard.
- **`reverse`** — leave the port end to starboard and the starboard end to port.

The required sense is then legible off the line itself, with no convention to memorise. The names
are defined *relative to a forward crossing*, so a line crossed both ways — the leeward line that
is start, mark 2 and finish — is forward once and reverse twice.

### Sense and extent are two different tests

Keep them apart. Conflating them is what makes infinite ends sound paradoxical.

| Test | Question | Involves the ends? |
|---|---|---|
| **Sense** | Which way did the boat cross? | No. A sign test on the port→starboard orientation. |
| **Extent** | Did it cross the line, or its extension past a finite end? | Only finite ends. |

> **An infinite end is a bearing, not a place.** The lat/long given for it is a point the line
> runs *through*, not where it stops.

So the rule needs no exception: *a forward crossing leaves the port end to port and the starboard
end to starboard; an infinite end is out along the line without limit, so it is always on the side
its name says — **only a finite end can be missed***.

The Mark screen's three states are exactly the combinations: **approaching** is neither settled,
**crossed** is both passed, **missed** is sense passed and extent failed.

### Gates are element-agnostic

A step either names a `line` and a `cross`, or holds a `gate` of alternatives, **each of which is
an ordinary step**. That is what lets a gate have a virtual line one side and a real buoy the other
once marks exist. The leg into a gate is measured to the midpoint between its alternatives, so
course length does not depend on which side a boat took — a length that varied per boat would make
the live-place axis mean different things for different boats.

---

## Roles and letters are positional

**The first step of a course is the start and the last is the finish.** There is no `role:` field
and there never should be — a stored role can disagree with the order. For the same reason the
sequence letters (S, 1, 2, … F) are *derived* from position, never written down. The two-lap
windward/leeward gets S, 2 and F onto one line for free, because that line simply appears three
times.

A consequence: neither the first nor the last step may be a gate, and once real marks exist,
neither may be a mark. You cannot start or finish on a point.

**A cycle is numbered from ZERO** (`sequenceLetter`, mirrored by `variantLetter` in `editor.js`).
It has no start and no finish of its own — a boat begins and ends wherever it joined — so S and F
would claim something untrue about it. **A leg is named by the step it runs INTO**, so numbering
from zero keeps the leg into step 1 called leg 1 on a cycle exactly as on an open course.

### Entry points: where a lap may begin, and therefore where it ends

`entry` marks a step a boat may begin a lap at. It means nothing on an open course, which has one
start and one finish by position.

**The line crossed to begin a lap must be crossed again, in the same sense, to end it.** So an
entry point is a start and a finish at once, and a lap is bounded by the same crossing twice rather
than by two different ones. That puts the burden on course design — a cycle wants lines a boat
passes once per lap — and takes it off the scoring, which would otherwise have to decide which of
several crossings closed the loop.

A cycle may name **several**, and a boat begins at whichever it crosses first: before the start
they are all live, as alternatives in the same sense a gate's sides are. What the boat did with
that choice needs no field in the record — **roles are positional there too**: the first crossing
began the run and the last ended it, and on a cycle they name the same step.

> **A cycle with NO entry point is reported as a problem** and cannot be snapshotted, so it can
> never be published or joined. There is otherwise nothing to start the clock on and nothing to
> finish against — a boat would be handed a ring of marks and no way to say it had sailed it.

---

## Leg length, and the handle

A leg is measured **between the midpoints of consecutive lines' two defined points**; course length
is the sum of the legs. A measured leg of zero is an error, not a short leg: it means two steps
share a reference point. `lengthNm` on a step overrides the leg *into* that step.

On a cycle, step 0 has a leg into it — from the last mark back to the first — and it is counted,
measured and overridable like any other. On an open course `legs[0]` is NaN, because nothing runs
into a start.

> A cycle authored the open-course way — first mark repeated at the end, `A B C A` — has a **zero
> closing leg**, which is redundant rather than wrong, and must not be reported as the error a zero
> leg otherwise is. Complaining about it blocks the snapshot of a perfectly sailable course.

The subtle part, and it is deliberate: on an infinite end the point's *distance* along the bearing
is arbitrary — sliding it leaves the line geometrically identical — so **that point is the control
handle for where the line is measured to**. Place it where the fleet actually crosses.

Measuring to the finite end of a half-infinite line instead would be more stable, and would give up
the handle — leaving an explicit `lengthNm` with no picture attached as the only way to adjust a
leg.

---

## One metre, everywhere

**The resolution of the whole system is one metre**, declared twice — `Geo.RESOLUTION_M` and
`crossing.js`'s `RESOLUTION_M` — and the two must agree. Course lengths are measured at it, and so is
every crossing. **A finite end is a hard edge: if you miss, you miss**, and what the sailor is owed
instead is warning. See [crossing-detection.md](crossing-detection.md#one-metre-a-hard-edge-and-a-warning).

---

## Coordinates are SignalK's

`latitude` / `longitude`, spelled out, **signed decimal degrees**, WGS84. Not a preference — it is
`schemas/definitions.json` in the SignalK specification, so a position off a SignalK stream drops
straight in with no conversion, and a conversion is where a hemisphere gets inverted.

Degrees-and-decimal-minutes (`33 48.072 S`) is what a chart and a plotter show, so it belongs **on
screen, in both directions** — where a bad transcription can be seen by the person who made it —
and never in a file.

---

## An id is a key, not a label

`model/Ids.java` holds the rule and `slug()` in `editor.js` mirrors it: **lowercase kebab-case,
letters or digits at both ends**, 64 characters.

| Id | Rule |
|---|---|
| course, variant, series | `[a-z0-9]([a-z0-9_-]*[a-z0-9])?` |
| point, line | the same, plus `/` as a scope separator — `manly-to-shark/windward` |
| club | the same, plus `.` — it is a domain |
| boat | unconstrained; it comes off the wire from a boat we do not control |

Constrained because an id ends up in filesystem paths, URL path segments, composite keys and **YAML
mapping keys** — where a colon does not produce a bad id, it produces a *broken file*, on the next
autosave, silently. Only points and lines may carry a `/`, because they are the only ids that reach
none of the first three.

**Reported by the server, corrected by the editor.** A file with `div 1` in it still loads and works
and says so in `problems()` — one typo must not take a club's racing down. The editor slugs an id as
it is typed and says what it changed. **The one exception is creating a file**, where the id becomes
a *new path* and is refused (`ProgrammeLibrary.resolve`).

> A problem is **printed, never summarised**. The server writes one sentence per problem naming the
> thing and the fix; a page's job is to show them, not to count them and guess at a cause.

---

## One file per club and series

Courses are organised by club, and by series within a club. Each file is **self-contained** — its
own points, lines and courses, resolving nothing from anywhere else — so it can be read, diffed and
handed to another club whole. The cost is that a shared reef is surveyed in each file that uses it.

The **path is the identity**: `clubs/myc.org.au/2026-summer.yaml` is club `myc.org.au`, series
`2026-summer`. A file that names them anyway is checked against the path and complained about, never
silently believed. Clubs are keyed by **domain**, following sail-jinx and sailing-pf, so records
about the same club line up across all three.

---

## There is no scoring

**This system publishes courses, runs the committee's side of a race where there is one, and
collects what boats did.** Places, OCS, corrected times, penalties, drop races and series scoring
belong to the club's software, which already has rules for all of it. Owning none of that is what
lets this be right about the one thing it is uniquely able to be right about — detecting and timing
a crossing — which is also the only thing here a protest committee could not reconstruct from
somebody's watch.

Same boundary the brief drew (*"the server is explicitly outside the rounding path"*), extended one
step: **outside the scoring path too**.

**Races exist, as a definition and as conduct.** A race is defined in the series file — a date, a
format, and a course and variant per division (`Race`) — and what happened on the afternoon is a
conduct record in the store. The committee's side of it is
[the client–server dialog](client-server-dialog.md). None of that is scoring.

**Every elapsed time is self-timed.** A boat's clock starts when it crosses the start line, even
where a committee published a start time: that crossing is the instant the boat can defend. A club
scoring from a gun scores from its own gun and this record's crossing times.

### Three ways to sail

`JoinMode`, chosen on the join screen — it changes how a boat sails, and a boat deciding afterwards
decides with the answer in front of it — and carried on the record:

| | |
|---|---|
| `RACE` | goes to the club, which scores it |
| `ANONYMOUS` | practice: kept for the boat, published to nobody. The only mode that may step through the marks without sailing them |
| `RECORD` | goes to the club **and** stands against every other attempt at the same geometry |

Practice is **stored and not published**, rather than withheld: a boat that never uploads cannot
compare its own laps, recover a track from a lost phone, or change its mind.

---

## The record is the interface

`CourseRecord` is the only artefact that leaves this system, so it carries everything a scorer or a
protest could need. Anything a scorer needs and cannot find here pulls race concepts back into the
codebase.

**A record names a course *revision*, not just a course.** `CourseSnapshot.hash()` is twelve hex
characters over the **geometry and the order** — resolved positions, infinite flags, crossing senses,
entry marks, whether the course closes — and deliberately *not* over names or notes: renaming a mark
changes nothing about where a boat had to sail, and bumping the revision for it would split one
course into two that cannot be compared. Built from a canonical string rather than serialised JSON,
so adding a field cannot silently change every revision.

**A record also names the RACE it was entered in, where there was one** — and that field is the
one thing in a record the boat is not the authority on. It is stamped by the server from the
session when the record arrives over the dialog, never read off the boat's own message: everything
else here is a boat's account of itself and is trusted as such (dialog §1.1), but being in a race
is an entry a committee accepted, and a boat that could name its own race could put itself in a
results table nobody can check. Null for a record attempt or for practice. (A record posted over
REST has no session, and is not yet stripped of a `race` it carries — dialog §14.)

Records are filed `records/{club}/{course}/{date}/{boatId}-{HHmmss}{±hhmm}.json`. The start time is
in the *name* so a boat may sail the same course twice in a day, and so a resubmission of the same
run — the ordinary case, when the full track arrives later over wifi — supersedes rather than
accumulates.

**The date is the CLUB's local day**, from `ProgrammeLibrary.zone(club, series)`, falling back to any
series of the same club because `CourseRecord.series` is nullable. A race day belongs to the club
running it, so a visitor whose phone is on another zone still files under the day everybody else
sailed; taking the day from the boat would let one race day land in two directories.
`JsonStore.save` **requires** the zone — there is no overload that omits it.

> **The offset belongs on the instant, not on the day.** `2026-09-18+1000` is neither an instant nor
> a day: two offsets for one race day would make two directories, and a season crossing daylight
> saving would alternate the directory's shape. Zero offset writes `+0000` rather than `Z`, so every
> name is the same width.
>
> And Jackson's `ADJUST_DATES_TO_CONTEXT_TIME_ZONE` would throw an offset away silently — an
> `OffsetDateTime` field reading `…T00:23:12+10:00` comes back as the same instant on the wrong day,
> with no error. Not needed here, because the club's zone and an `Instant` give the day between them.

---

## Reading results back

**Nothing about a result is persisted; results are computed on read.** There is no results file,
no index and no cache — what is on disk is what the boats sent, and the pages are a query over it.
A stored result would be a second copy of the truth, free to disagree with the records it came
from.

| | |
|---|---|
| `GET /api/results/{club}/{series}` | the index: races with what was sent in for each, and the variants anybody has attempted |
| `GET /api/results/{club}/{series}/race/{race}` | one race, as a finishing order |
| `GET /api/results/{club}/{series}/variant/{course}/{variant}` | record attempts, grouped by revision |
| `results.html` / `results.js` | the pages, open to everybody like every other read |

**Two kinds of result, ranked on different things.** A **race** is a fleet sailing together on one
afternoon, so it reads as a finishing order and its records are found by the race's own date and
the courses its divisions name, filtered on the stamped race id — records are filed with no race
in the path, deliberately, because a record is a run at a course and a race is something that
sometimes happens on one. A **record attempt** stands against every other attempt at the same
geometry whenever it was made, so those are grouped by variant and then by **revision**, which is
the rule `JsonStore.best` already enforces: a course edited between two attempts is two courses,
and ranking across the edit would compare different water.

**The pages score nothing.** They order by elapsed time, print corrected time beside it where a
boat declared a TCF — a multiplication anybody can check — and give no place to a boat that did
not finish while still listing it, because a table that dropped the boats it could not rank is one
nobody can reconcile against the fleet that started. Places, penalties, drops and protests belong
to the club's software, which has rules for all four.

---

## Distance-corrected handicap: each boat's own line

A course can take the handicap out of the time and put it into the distance: every boat starts
together, sails a course whose length is its TCF times the nominal one, and the first boat home
wins on handicap. Implemented in `model/Handicap.java` (what makes a course correctable, and the
TCFs it can take) and `client/www/handicap.js` (where one boat's lines go).

**It is a property of the line.** A line with `handicapWidthM` is a **track**, and a step naming it
does not ask a boat to cross it: each boat's own line is centred on it. The midpoint is where a 1.000
boat's line sits, the **near** end — the one that makes the legs either side shortest — is the lowest
TCF the course can take, and the far end is the highest. Each boat's line is `handicapWidthM` wide and
**square to the track**, crossed forward going out along it from the near end, so together they sweep
a rectangle that belongs to the line and is drawn on it in the editor. A line is never suitable as
both a track and a line to cross, so the width is the line's and every step naming it is handicapped;
whether a course can use it — the legs either side — is checked per course.

```yaml
lines:
  windward-track:
    port:      {latitude: -33.816300, longitude: 151.273680}
    starboard: {latitude: -33.818000, longitude: 151.273680}
    handicapWidthM: 80
```

**A TCF becomes a distance linearly.** A boat of TCF *t* sails *t* × *D*, where *D* is the nominal
length — the course as drawn, which is what a 1.000 boat sails.

**One slide for the whole course.** Every handicapped step is placed at the same fraction *u* of its
track, −1 at the near end, 0 at the midpoint and +1 at the far end, and a boat is given the *u* at
which the course comes to *t* × *D*. That shares the correction between several tracks in proportion
to their length, and it makes a track passed twice — the windward mark of a two-lap course — and two
handicapped steps in a row need no special case: every leg runs between two points moving in
straight lines, so the length is convex in *u* and one bisection finds it. The course's range is
*L*(−1)/*D* to *L*(+1)/*D*, rounded **inward** to three places so every TCF it admits can be placed.

**What the server refuses** (`Handicap.problems`, so the variant cannot be snapshotted):

| Problem | Why |
|---|---|
| a track named as a start, finish or cycle entry | a start and a finish are crossed as themselves, and a track never is |
| a track as a side of a gate | a boat's line is one line |
| a track with an infinite end | a finite track is what lets the designer see every line a boat could be given — nobody has to check to infinity that none of them is on an island |
| a `lengthNm` on a leg into or out of a handicapped step | a fixed length cannot stretch |
| legs more than 90° apart, at either end of the track or its middle | past a right angle the step is a passage, not a turn, and pushing a track out from a passage lengthens it by next to nothing |
| a leg that gets shorter as the tracks slide out | the track has to run away from both of its neighbours |

**Who works out what.** The server says which TCFs a course takes — `tcfMin`, `tcfMax` on the
snapshot, the line's width and `handicapNear` on each handicapped step — and refuses a join without a TCF or outside
the range. **The boat places its own lines**, from the snapshot, with no network: which line it
must cross is part of deciding its race. The record carries the lines it was given
(`CourseRecord.handicap`), which is also what tells the results pages its elapsed time is already
corrected, so nobody multiplies by the TCF a second time.

---

## The lifecycle, as built

Reasoning in [`course-lifecycle.html`](course-lifecycle.html). Implemented in `CourseVariant`,
`Course`, `CourseSnapshot` and `store/CourseLedger`; the editor's Courses tab is the whole of the UI.

### Course, variant, snapshot

| | |
|---|---|
| **course** | what a club publishes and a boat joins. Has one or more variants, and no geometry of its own |
| **variant** | an editable design belonging to **exactly one** course — Div 1, short course, or simply *the* one |
| **snapshot** | an immutable, fully inlined capture of one variant, identified by its revision hash and named `course/variant/datetime` |

**Two shapes in the file, one model in memory.** A course with one plain variant is written flat — a
bare `sequence:` — and reads back as a single variant under `main`; the `variants:` level appears only
once it is used. `Course.read` folds one into the other and `Course.flat()` decides which way it is
written. **A `variants:` key means the nested shape whatever it holds**, and the flat shape is
recognised by HAVING a sequence — otherwise an emptied course grows a phantom design on the next read.
`ProgrammeWriter` emits `variants: {}` rather than a bare `variants:` for the same reason.

A variant belongs to one course because that is what makes *whose racing did I just change?*
answerable. A variant shared between two courses would need its own name, publication and dirty state
— which is to say it would be a course. Genuinely common shape is shared one level down, as a named
line.

> **A VARIANT IS NOT A DIVISION.** A division is one *reason* to have a variant; a short course, a big-sea
> course and a big-fleet course are others. The word in the UI, in the code and in these notes is
> **variant**, and "division" appears only as an example of one.

### Named and ad-hoc geometry

A point is **named** (an id, in the club's list) or **ad-hoc** (no id, living inside the one variant
that uses it). **Naming is identity, not sharing** — Sow and Pigs is named because people refer to it,
not because several courses do; sharing is counted, never declared.

**A line's two ends are independent.** One may be a surveyed feature the club knows and the other a
handle dropped this morning, so the unit of the named/ad-hoc decision is the point. Detaching a point
copies every line that named it with *only that end* repointed at the copy.

### The tab is the scope of the edit

Answered by where you are standing, before the edit, rather than by a modal after it. The
**Points/Lines tabs** edit the club's named geometry — the whole club is in scope, deliberately — and
*report* what they dirtied. The **Courses tab** edits one variant; dragging named geometry there asks
first, offering: move it for sibling variants, make it ad-hoc here, promote a new named point, or go
to the Points tab.

> **The invariant: from the Courses tab you can never change geometry for a course you are not in.**
> Widening scope beyond the current variant always takes an explicit answer. The dialog names where a
> club-wide change *can* be made rather than being a dead end — a dead end teaches people the editor
> cannot do something it can.
>
> The exception that proves it: **translating or rotating a whole course** offers both answers,
> including moving shared marks for every course that uses them, because there the wider scope is a
> thing somebody genuinely means on race morning. The invariant is that scope is never widened by
> *accident*.

The promote option stands in for a scoping mechanism, and **the tool generates the name**
(`manly-to-shark/windward`), never the user — a namespace held together by human discipline lasts
about a season.

### Snapshots inline everything, immediately

Not lazily: **the revision is a hash over resolved coordinates**, so a snapshot that resolved names
later would have a hash that could silently stop describing its own contents. The impact question does not need it, because **the variant a snapshot was taken from
remains**, still holding its named references. Immutability and impact tracking are jobs for two
different objects.

The safety property that falls out: **editing named geometry never modifies a snapshot**, so it never
changes anything a boat has been handed. A published course changes only when somebody publishes.

### Dirty is derived, never stored

`hash(resolve(variant))` against the latest snapshot's revision gives **unpublished** / **current** /
**dirty** / **incomplete** — plus **template**, which can never reach any of the others. No flag is
written, so none can go stale, be missed by an edit path, or survive an undo it should not have. A
course shows dirty if any of its variants is. Review should mean a **diff**: "dirty" alone only says
something changed, and what an editor needs before publishing is *what*. The diff is not built; the
editor shows which variants are dirty.

### Snapshot and publish are two steps

Snapshot captures a design; **publish chooses which snapshot boats get**, and `join` serves that one —
a course with nothing published cannot be joined at all, so a mark dragged on race morning changes
nothing for anybody on the water until somebody publishes again. Publishing a variant replaces that
variant's previous publication: a pointer move, not an append, since a fleet offered a choice of
vintages starts with two courses on the water.

Two scopes, one operation: **one variant**, or **several atomically**. The atomicity is the constraint
with teeth — a line common to three variants moved on race morning means all three change or those
fleets have inconsistent instructions, which is a thing nobody on the water can detect. Since a shared
line dirties variants across *different courses*, that scope is club-wide: `CourseLedger` is **one JSON
document per club**, written atomically, so a crash mid-publish leaves the previous pointers rather
than half the new ones.

Snapshotting, by contrast, loops deliberately: a capture is private until something is published, so a
run that got half way through has captured half of them and can be pressed again.

### A snapshot is read-only, and what you can do *about* one

Selecting a snapshot puts it in the editor **instead of** the variant. A capture is fully inlined,
which is exactly what an all-ad-hoc variant is, so the drawing code takes it unchanged; `readOnly()`
sees to it that nothing can be edited. The form shows what it **is** — revision, when it was taken, its
length, its sequence — rather than a disabled editor, because a greyed-out field says "you may edit
this later" and a snapshot is never editable by anybody.

**The REVISION is shown wherever a snapshot is named** (`snapshotName`). The label is for reading and
the hash is for checking, and only one of them is what a boat was handed: comparing what a fleet is
sailing against what the editor is showing means comparing revisions.

| | |
|---|---|
| `⧉` | a new variant from it — named `<variant>-<date>`, owning all its geometry outright |
| `↑` | hand **this** one to boats. The rollback path: a pointer move, no re-editing |
| `✕` | take it out of the list |

**Forgetting keeps the geometry** (`CourseLedger.forget`). A record names a revision, and a result whose
course cannot be read is a time with nothing attached — so this removes a snapshot from the list, the
offer and the dirty comparison, and leaves it readable through `GET /api/courses/{revision}`. Forgetting
the **published** one is refused: publish another or withdraw it first.

### Public, and the audit trail

**`public` is a course-level flag, default false, and it is the third gate.** Snapshot captures, publish
chooses, and public decides whether anybody outside the club may see either. `GET /api/public` lists
public courses and, under each, the snapshot currently published for every variant. Both gates are
required: a public course with nothing published shows with nothing under it, and an unpublished variant
does not appear at all. **Templates cannot reach it by construction** — no snapshot ⇒ no publication ⇒
no live revision.

On the course and not the variant, because a course is the thing a boat joins — publishing Div 1 while
hiding Div 2 would offer half a fleet a race. Default false because a club's file is full of half-built
shapes. **A cloned course is never public**, whatever the original was.

**Visibility has TWO switches and the log watches both**: publishing to a public course, and making
public a course that already has publications. The second is the surprising one — nobody pressed
anything that says *release* and a fleet can suddenly see three snapshots. Four kinds of event:
**published**, **opened**, and their inverses **withdrawn** and **closed**, because a trail that records
only what appeared cannot answer *"why can I no longer join the course I joined on Tuesday?"*. A no-op
records nothing.

> **The events land in the SAME atomic write as the pointers**, which is why they live in
> `CourseLedger`'s document rather than a log file beside it. A trail missing the entry for something a
> fleet was handed is worse than no trail, because it reads as proof the thing never happened.

`GET /api/log` is **open to everybody**: what a fleet was handed and when is exactly what a competitor
may need to check afterwards, and a record only the club can read is not an audit trail.

### Templates

**A template is a variant marked as such, and the one thing it cannot do is be snapshotted.** Everything
else follows: no snapshot ⇒ no publication ⇒ no boat can join it ⇒ permanently *unpublished*, never
*dirty*, never in the race-morning list. **A course is never labelled a template**, only a variant,
because a course usually holds a template alongside the races cloned from it.

**A template is reached FROM the course being built**: the variant row's `⚐` opens a picker of every
template in the library (`GET /api/templates`) and expands the chosen one into this course as a new
variant. The picker **drills series → course → variant**, and **a stage with one answer answers itself**
(`stageOf`) — which is the whole value of a hierarchy over a flat list.

**A new course therefore has NO variants, and the LAST one may be deleted.** Guessing one called `main`
puts a blank sequence in front of somebody whose next move is usually "start from the windward/leeward
we always use". A course with no variants is reported as a problem — it cannot be joined — but nothing
blocks it.

**Expanding copies, because a programme file is self-contained.** What comes across keeps its shape: a
mark the template *names* is made a named mark here, because naming is identity; ad-hoc geometry stays
ad-hoc. **A line is taken across once per NAME, not once per occurrence** — a windward/leeward's leeward
line is three steps and one line — and points are memoised the same way. **A name that already means
something else here gets a distinct id and says so** (`adopt`): reusing silently puts the template where
it is not, and overwriting moves every other course standing on that mark.

**What comes out of a template is called `yyyymmdd-race-n`** (`raceId`), whether expanded by `⚐` or
cloned by `⧉`. A template is a shape; what comes out of one is a race, on a day, and usually not the only
race that day. `n` counts from 1 within the course, so it is the day's race numbering rather than a
uniqueness suffix. Templates sort first in the variant list, then the races, each group alphabetical.

**Three counts, three different words.** A **step** is one position in the sequence — one lettered mark,
and a gate is one step because a boat takes one side of it. A **crossing** is one line to cross, so a gate
step holds two. A **leg** is the water between two steps: n−1 on an open course, n on a cycle. Anything
showing one of these has to say which.

### Deletion

**Refused rather than cascaded**: a point a line still uses, or a line a course still uses, names what is
holding it instead of quietly breaking the file — which matters more than usual here, because the save is
immediate and the damage would be on disk before it was visible.

**Snapshots outlive everything that produced them.** Deleting a variant or a course does not delete its
snapshots, and a replaced publication keeps its snapshot too; they go only when explicitly forgotten. A
record names a revision, and a record whose geometry cannot be retrieved is a time with no course
attached — retiring a course is not a reason to make last season's results meaningless.
