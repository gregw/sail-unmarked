# The boat client

**What a boat holds while it is sailing: the seam it sits behind, the screens it offers, and the
rules those screens obey.** The detail — every threshold, every derivation and why each was chosen —
is in the comments of the files named here, which are the specification. This is what no single file
owns.

---

## Two pages, one client, and the seam under both

**There are TWO pages and exactly ONE client.** `boat.html` is what a boat opens: one panel, the
phone's own GNSS behind it, nothing else on the page. `client.html` is the test rig — a chart, a boat
that sails where it is clicked, the knobs that decide what its receiver reports, and the same client
sitting on top of it as a phone on a desk.

**Exactly one thing crosses into the client on either page, and it is a GPS fix** — a position, a
time, a stated accuracy, a satellite count, SOG and COG, which is all a real receiver hands over
either.

| | |
|---|---|
| `device.js` + `device.css` | **the client**: the join screen, the screen-switching, the Mark screen, the overview, the selectors, and `feed(fix)`. Imported by both pages |
| `receiver.js` | `navigator.geolocation` as a fix. What ships |
| `boatsim.js` | a simulated boat and a receiver that lies. The rig only |

**A second copy of the device is the one thing that must not happen.** Two clients drift, the one that
fell behind is whichever was edited second, and the difference is discovered on the water by the only
person who can do nothing about it. So each page contributes only what the other has no use for,
through a handful of hooks — `note()`/`wireNote()`, `blocked()`, `extras()`/`wireExtras()`,
`onJoin`/`onLeave`. **Neither page can tell the device which receiver is behind it**, and
`drive-boat.mjs` asserts that against the *import lists* rather than the prose.

What is **not** shared is the panel's size: on the rig the device is phone-*shaped* (9:19.5, capped by
the window) because it is a prototype of a phone sitting on a chart; on `boat.html` it is `100dvh`
tall and capped at 440px wide. `dvh` rather than `vh`, because on a phone `vh` is the viewport with
the browser chrome hidden, so a panel sized in it puts its own bottom row out of reach. The type
inside is in `cqi` either way.

The seam is *asserted*, twice over: the two receivers' specs pin the key set of a fix, and
`drive-client.mjs` **takes the network away between joining and finishing** — `fetch` is replaced with
something that throws — and sails the whole course with it gone.

---

## The real receiver, and the two things the web API does not give

**Satellite count: nothing, and nothing invented.** The Geolocation API does not report one, so the fix
says `null` and the screens print an em dash. A plausible number would be a lie in the one place a
sailor looks to decide whether to trust the rest of the screen. The QC gate treats a missing count as
*no evidence either way*, so a phone is judged on its stated accuracy alone.

**Speed and heading: DERIVED, in the receiver, and only when they can be.** `coords.speed` and
`coords.heading` are null on a laptop, on a phone positioned by wifi, and on most devices while
stationary. Deriving them from consecutive positions is what a plotter does, and it belongs in
`receiver.js` rather than in the client: a receiver is the thing allowed to know how its own numbers
were arrived at. Two refusals, both where the derivation would be making things up:

- **Movement inside the stated accuracy is not movement.** Below the accuracy the speed reads zero and
  the heading is held — which is both what a plotter shows and what is true: we cannot see it moving.
- **A long gap derives nothing** (`MAX_GAP_S`). The average across half a minute is not a speed
  anybody is making.

> **A stated zero is a reading, not an absence.** iOS reports `speed: 0` with a null heading while
> stationary and a position that still wanders. Deriving a course out of that displacement would be
> arguing with the receiver about whether the boat is moving, and losing.

`receiver-test.js` pins all of it, including the assertion that matters most: **a fix from
`receiver.js` has exactly the key set of a fix from `boatsim.js`**. The two are interchangeable only
while that holds, and it is the kind of thing that decays one convenient field at a time.

## Three things a real phone needs that a desk does not

- **The permission is asked for by a gesture, never on load.** A prompt that appears before anything on
  screen has said why is a prompt people refuse — and a refusal is sticky in a way that takes somebody
  into browser settings to undo. `drive-boat.mjs` asserts that the page asks the browser for nothing
  until it is pressed.
- **A course is not taken until the phone has proved it can see the sky.** The join screen is the one
  moment somebody is standing still with both hands free. A refusal is reported and the watch is **not**
  torn down: a position lost under a bridge comes back on the other side.
- **The screen is kept awake, and says so when it cannot be.** Best effort by necessity — the Wake Lock
  API is missing on some browsers and *dropped* every time the page is hidden, so it is re-taken on
  `visibilitychange`. Shown as a button because it is a promise the page cannot always keep.

**The back gesture is guarded, because leaving costs the race.** Nothing is cached across a reload, so a
boat that backs out mid-afternoon comes back to the join screen with the course, the crossings and the
clock gone — and on a phone the gesture is an edge swipe away from everything else. Two mechanisms,
because one gesture is not the only way out: `beforeunload` for a reload or a closed tab, and a sentinel
history entry pushed on joining so the back gesture arrives as a `popstate` that can be answered in the
page's own words. Armed by `onJoin` and disarmed by `onLeave`, like the wake lock: on the join screen
there is nothing to lose, and a page that argued about being left would be one people close for good.

**And a HEARTBEAT**, because the one state a screen cannot be prompted into reporting is the absence of
fixes. The device redraws on every fix; when they stop, the most important thing on the screen changes,
so `boat.js` redraws once a second regardless. It is also what counts the elapsed clock up between
fixes.

---

## Which screen, and who decides

**The sailor never asks for the Mark screen.** On a boat the hands are busy, and which screen matters
right now is a decision the application is better placed to make than the person steering. So the screen
follows the situation (`RaceClient.view`), and the rule is the **OR of a radius and a time** — 100 m, or
30 seconds at the speed being made. A fixed radius hands a drifting boat the Mark screen four minutes out
and a skiff thirty seconds out for the same metres; a pure time-to-line is meaningless the moment a boat
slows or points away. Each covers the other's blind spot.

Three details around it, each of which was a bug first and each of which a change must preserve:

- **The screen is given back at 160 m, not 100.** Without the gap a boat holding station near a start line
  flips between screens on GPS noise alone. The gap moves with the threshold rather than staying fixed.
- **The hysteresis resets on every advance.** A new mark is a new approach.
- **The dwell does not prime the hysteresis.** Holding the Mark screen for six seconds after a latch is
  its own reason to be there, and must not also count as "the boat is near this mark".

**The distance it reads is to the part of the line the boat would CROSS** (`approachM`), not to the line's
infinite extension. The two are the same number for a line the fleet meets square; a line running *along*
the leg — the shape a gate's half-infinite sides take — breaks it. Nothing about scoring changes: the
extent test still runs out without limit.

**The selector is on EVERY screen**, because any one of them may be the one you want to leave. The Mark
screen and the overview emit it themselves; Chat and Place have no chart and no orientation of their own,
so the device passes it in — leaving it off made those two screens a trap with no way off but a reload,
which on the water costs the joined race.

**The sailor can also overrule it** (`VIEWS`, `RaceClient.setViewMode`). AUTO is the default and is the
design, but *never has to* is not *cannot*. **Forcing does not switch the rule off** — the hysteresis goes
on tracking underneath, so AUTO resumes with the answer for where the boat is *now*. It lives on the
`RaceClient` rather than on the page, because `view()` is the single answer to "which screen". Anything
other than the known modes reads as AUTO, so a stale value cannot strand somebody on a screen with no way
back.

**Only the live step sees fixes.** A course is a sequence and the sequence is the model: on a two-lap
windward/leeward the leeward line is the start, mark 2 and the finish — one line, three steps, each with
its own detector — so a boat crossing it on the way to the first windward mark cannot latch a finish
twenty minutes early. Both sides of a **gate** get a detector and both see every fix; the first to latch
is the side the boat took, and which it was is recorded because the next leg's bearing depends on it.

**A cycle's start is a CHOICE, and `live()` answers with it.** Before the start the live "step" is not a
step at all but every entry line at once (`startChoice`), which is what puts them all on the plot as
alternatives, all of them lit on the overview (`isLive`), and each with its own next-leg arrow — the
candidates lead down different legs, so `next()` is asked per crossing exactly as it is for a gate. The
first to latch is where the lap begins: that step becomes the boat's `entryIndex`, the clock runs from
that interpolated instant, and the sequence is walked from there as a ring. Coming back to it is the
**finish** (`atFinish`) — lettered F, with nothing beyond it — and crossing it completes the run. One
lap, bounded by one line crossed twice; a second lap is a second join.

---

## The Mark screen (`markscreen.js`)

Built to brief §5, in three states, with a course overview behind it. The file's own comments carry the
derivations; these are the rules that outlive any of them.

- **The approach plot HOLDS STILL and the boat moves across it** (`PlotView`, `HOLD`). Re-fitting every
  frame centres the picture on something that moves with the boat, so whether you are actually closing the
  line — the one question the approach view exists to answer — is the one thing it then cannot say. It
  closes in in **steps**, and the frame is given up for exactly two reasons: one of the fitted things is
  about to leave it, or the view could usefully be a sixth closer in. The second test is one-directional.
- **What must stay in view is a precise list**, and nothing else decides the fit: the boat, the capped COG
  cut, the line's midpoint, the nearer end, the triangle, the next-leg arrow and the last three fixes. Each
  is there for a reason a change must not forget — the midpoint is the *mark* and is what stops the zoom
  running away as boat and seat converge; the nearer end is what answers *can I fetch this end*; the COG
  cut is capped because a boat nearly parallel to a line cuts it kilometres away.
- **Nothing that matters is drawn near the border** (`FIT_FRACTION`, `HOLD.edgeFraction`). The two are a
  pair: the fit decides where things start, the hold decides how close they ever get.
- **The boat and the line are drawn at their REAL SIZE**, which is how the plot shows closing. A glyph of
  fixed pixel size says nothing about range. Both are clamped, and **the line's bounds are derived from the
  boat's** by the ratio of their lengths, so the clamp cannot put the pair out of proportion.
- **The boat is a HULL SEEN FROM ABOVE, not an arrow** (`boatArt`) — an arrow reads as a cursor or a
  bearing marker. **No boom**: a boom is drawn at an angle, and an angle is a claim about where the wind is.
  **One path, one routine, three charts**, drawn to scale on the plot and at fixed size on the overview and
  the rig.
- **The line carries a triangle** — the editor's own notation, base on the line, apex the way you must cross
  — because the required sense is the one thing about a virtual mark that cannot be guessed from looking at
  it. `forwardNormal` is reused from `coursedraw` rather than re-derived. Just beyond its apex, a grey arrow
  along the next leg: *cross here, going that way, then head there*. **The F marks the one place with
  nothing beyond it**, keyed off "there is no next leg", never off "the next mark is the finish".
- **On a latch the scale deliberately does not move**; the arrow goes green and grows. Re-scaling at the
  moment of a crossing throws away the picture somebody is looking at for the one reason they are looking at
  it. The client holds `crossed` and the screen stays on the line it crossed for the dwell.
- **Both sides of a gate are drawn, one in focus**, and both get a perpendicular distance and a next-leg
  arrow, because those are the two things the choice is made on. The other side is deliberately **not in the
  fit**, so it never costs zoom from the side the boat is sailing at. Each side's distance comes from **its
  own detector**. Which side is in focus is decided by where the boat's *course* takes it, with hysteresis
  — not by perpendicular distance, which on a parallel gate is nearly equal all the way up the leg.
- **An infinite end is as substantial as the line itself.** It is the part that cannot be missed; drawn as a
  fading hairline it read as a boundary to stay inside.
- **TIME TO LINE COUNTS DOWN TO THE LATCH, NOT TO THE WATER** (`confirmSeconds`). A crossing is latched when
  it has been *proved*, so between the bow cutting the line and the screen saying CROSSED there is a real
  gap. The estimate is the *measured* fix interval times the detector's own count, and it over-estimates by
  up to one interval — which is the right way round.
- **Its colour is the warning**: green means the present course crosses the line, red means thirty seconds'
  warning that the boat is about to sail past the end having scored nothing. That warning is what the
  one-metre hard edge obliges this screen to give.
- **The smoothing is on the INPUTS, and the defence against a wild reading is physics** (`MAX_ACCEL_MS2`)
  rather than statistics. Smoothing a quotient lags a number that is counting down, and an exponential
  smoother still takes a third of a wild reading.
- **Figures sit on the lines that measure them**, with no labels — the figure on the dashes *is* the label.
  No two figures are ever drawn over one another; where they would collide the COG's gives way, because
  square on and close in the two distances are the same number to the metre. `labelBox`/`boxesClash` are used
  by the drawing *and* by its spec, so the two cannot disagree about what "on top of each other" means.
- **A wrong-way crossing is a blue cross, not a red one.** A boat coming back across a line to set up
  properly has done the ordinary thing; a red cross would tell a sailor mid-manoeuvre they have blown the
  mark. Shape carries the fact that something was rejected, colour carries whether it matters. Red is kept
  for the one thing that IS a miss.
- **Which side a fix is ON and which side it CONFIRMS are two questions** with two bands: `side()` is
  geometric and narrow (`SIDE_BAND_M`), `confirmedSide()` is the stricter one the N-and-N latch counts.
  Sharing one band makes the picture of a crossing unreadable.

## Orientation

Four: **Leg up**, **COG up**, **North up**, **Line perp** — a property of the display, not of one screen, so
the selector is on the overview as well and sets one setting.

- **The display SWINGS rather than snapping** (`Turner`, `TURN_DEG_S`). Snapping through ninety degrees
  destroys the one thing an oriented display is for. Eased against real time, not per render. **The displayed
  bearing is not part of the frame's identity**, or a frame rebuilt on every degree of a swing would never
  hold still.
- **Leg up is the leg the boat is ON** — `legInto`, mark behind to mark ahead — which is not the leg the arrow
  points at. Mark to mark, never boat to mark, or the display would swing on every tack. **One definition,
  shared by both screens.** The exception is the dwell after a cross, where the brief is explicit and the two
  are the same leg.
- **COG up** is the one every plotter has, and its cost is that it swings on the boat rather than on the
  course; what makes it usable is that nothing here snaps. With no COG it falls back to the leg, never to
  north.
- **Line perp squares up to a GATE's axis, not to one side's own normal** (`gateOf`, `gateUp`). Collinear
  sides and parallel sides pull in different directions, and the perpendicular to the join between the two
  centres is the one bearing both shapes agree on. **The sign comes from the leg INTO the gate**, never from
  where the boat is, or it would flip through half a turn as the boat drew level — at the latch, the one
  moment the display must hold still.

## The course overview

- **Drawn with the editor's own `coursedraw`**, not a second drawing of the same geometry. The course a boat
  sees on the water and the course it was designed as must be the same picture.
- **It always says what the boat is steering for: BTW, DTW and the line's NAME.** The name, because that is
  what a course is discussed in — the sailing instructions talk about the leeward line, never about "mark 2".
  Both names at a gate.
- **DTW is to the MIDDLE of the next line and is not the perpendicular distance to it.** Perpendicular
  distance is *how close am I to crossing*, which decides when the Mark screen takes over; DTW is *how far
  have I got to sail*, which is what the published leg length measures. On a gate DTW runs to the mean of the
  alternatives' midpoints, so DTW and the course's own leg length are one quantity.
- **DTW switches units at a fifth of a mile.** Safe only because the unit is printed beside the figure every
  time. **Bearings are true throughout**, because there is no variation model anywhere in this system.
- **The live line is marked in the live triangle's own colour**, and counts as live while *any* of its
  crossings is: it is the same piece of water either way.
- **The COG runs out as far as the picture goes**, forward only. Here the question is what the boat is
  pointing at, and the answer is only legible if the line reaches it.
- **It re-fits every frame until somebody takes hold of it**, then anchors; **Fit** gives it back. The pan is
  held in screen pixels and applied in rotated space, and followed on the **document**, because the panel is
  rebuilt on every fix. Bounded to a quarter and sixteen times the fit.
- **A background never blocks.** Tiles are `<image>` elements, so nothing on the path from a fix to a drawn
  course touches the network. Dimmed hard (`BASEMAP_INK`) because every tile server draws for a white screen
  and these screens are read in glare; drawn on a square the size of the viewport's diagonal, because the
  picture turns. The default is `none`.
- **A turned chart gets a north pointer** (`northPointer`), drawn only when it is needed — which is also what
  makes it informative.

> **The Mark screen gets none of the chart furniture.** It is offline-first by a rule that is not up for
> trading, its frame is held on purpose so there is nothing to pan, and at its scale every tile server in the
> world is out of zoom levels.

## The race clock

**Elapsed runs from the CROSSING**, never from when the app was opened, because every start is self-timed.
Before the first crossing the overview shows a dash, not a zero. Both instants come off the *interpolated*
crossings — that is the entire reason the detector interpolates. On a cycle each lap restarts it, which is
what makes the number a lap time. **Final is said by the COLOUR, not by the label**: a label is text, `esc`
is right, and a label that has to carry markup is a label saying too much.

**BTW, DTW, Started and Elapsed fill the panel's width**, sized in `cqi` against the **system** font — there
is no webfont link on the page, by the same rule that keeps tiles off the Mark screen, and sizing to a face
that may not load is how a number ends up clipped on somebody else's machine. The paddings and the gap are in
`cqi` too, or a size that just fitted at 400 px overflows at 230 px. **A bearing's degree sign is part of the
NUMBER, not a unit beside it**, or beside a large figure it reads as a decimal point.

---

## Quality control, and a jump that is not a flyer

`crossing.js` holds the detector and the gates; `crossing-test.js` is its executable spec, run in a browser
and in `mvn test` from one file.

- **The gate budgets for noise as well as for motion** (`kinematicBudgetM`). A speed limit alone is the wrong
  test over a short interval: as the interval shrinks the distance is dominated by the noise on the two fixes
  rather than by anything the boat did. The budget is what the boat could have travelled **plus** what the
  receiver could have made up, the second term from the accuracy the receiver states — so a good sky narrows
  the gate and a bad one widens it.
- **The kinematic gate has no way out of its own judgement.** `lastGood` only advances when something is
  accepted, so after a real relocation — a dropout below decks, under a bridge, a phone asleep in a pocket —
  every fix is measured against a position the boat has left.
- **The discriminator is that a flyer disagrees with its neighbours and a relocation agrees with itself**
  (`RelocationWatch`). Confirmed the same way a crossing is: N consecutive agreeing fixes.
- **A relocation must never become a crossing.** The segment from where we thought the boat was to where it
  turns out to be sweeps across any number of lines. The detectors are re-armed and the trail thrown away;
  losing a crossing that happened during the blackout is the honest outcome, inventing one is not. The step is
  **not** advanced — which mark is live is a fact about the course, not about the receiver.
- **Only a KINEMATIC refusal can relocate.** A fix from two satellites is not evidence about where the boat
  is, however many of them agree.
- **A stale fix is not shown as if it were current** (`STALE_MS`). SOG and COG are instantaneous, so an old
  one is *wrong* rather than merely old, and a frozen speed reads as "everything is fine" at precisely the
  moment it is not. BTW and DTW stay, because last-known position degrades gracefully. Either way the screen
  says how long it has been, how many fixes went in the bin, and why the last one did.

---

## The rig (`client.html`, `boatsim.js`)

A test client that shared state with the thing it tests is a demonstration, not a test.

**GNSS error WANDERS; it does not shimmer.** Independent draws per fix make the plotted dots hop about the
truth like nothing any receiver has produced. A real receiver sits a little way off and *stays* there, so the
bias is a first-order Gauss-Markov process (`CORRELATION_S`) plus a small white component (`WHITE_FRACTION`).
The correlation is in **time**, not in fixes, so raising the update rate does not make the receiver noisier —
and a boat crosses a line under a roughly constant offset, which is the case that matters: a steady offset
moves the crossing **instant**, where white noise would merely have added spread.

**The receiver lies, on purpose, because a perfect boat exercises none of the code that matters.** **Noise**
is what makes a boat sitting on a line stop resolving to a side. **Flyers** are the one that matters: a flyer
landing on the far side makes the segment out and the segment back *both* cut the line, manufacturing a
matched pair of crossings the boat never made. A flyer still reports a small `accuracyM`, deliberately,
because real ones do — which is why the metadata pre-filter is necessary and not sufficient. The generator is
seeded: a test client whose failures cannot be reproduced is a worse instrument than none.

**HIDE COURSE is the one control that is not a knob on the receiver.** It takes away the *operator's* own
knowledge of where the marks are and leaves the device beside it as the only thing saying where to steer —
which is the application's central claim, and nothing else on the page could test it. It hides exactly the
geometry: the true track, the accepted fixes, the helm order, the boat and the tiles all stay.

> One leak worth knowing about: joining aims the boat *through* the first line, so the helm target betrays
> roughly where that first mark is. **Place boat** replaces it.

**THE DEVICE IS A PHONE ON THE DESK, not a column beside it.** What ships is a phone in a bracket, and a phone
sits ON the chart. It is **dragged by the case and never by the screen** — the screen's own chart pans on a
drag, and two gestures fighting over one pointer means whichever loses is a control that sometimes does
nothing. Clamped by its edges so a strip is always in the window, because this page has no command to fetch it
back.

**The chart draws its own cursor.** A system crosshair is one hairline on a chart that is mostly dark water,
and this is a page whose entire interaction is *click exactly there*. Drawn twice, with a dark stroke
underneath, because a reticle in one colour vanishes wherever it crosses something of about that brightness.
**The cursor says what the chart will do** — green for a helm order, orange for putting the boat down, two
gestures that are one click apart and cannot be undone.

**Picking the boat up does not cancel the helm order** (`BoatSim.placeAt`). Moving a boat says where it *is*,
not where it was going; if it should be stopped there is a Pause button.

**The device panel is not rebuilt while somebody is choosing a background.** It is rebuilt on every fix, and
rebuilding destroys a `<select>` whose popup is open. Held on **focus** rather than on a flag of our own, so
it cannot stick.

**The RIG is always full height, and the device's constraint must never reach it**: `align-self` on the
device, never `align-items` on the split, and one definite grid row — an implicit `auto` row is sized by its
tallest content, and an SVG with a viewBox will happily impose its intrinsic ratio.

---

## The join screen

**The course question is asked one level at a time**: club → series → race → division, with the course
following from the division rather than being picked again. A boat does not choose the geometry it was entered
for. Levels start **empty** and populate as the level above is answered, and the button names what is still
missing rather than sitting greyed out in silence — a default is a suggestion, and a suggestion nobody made is
how a boat ends up sailing yesterday's course on a race morning.

**A level with ONE answer answers itself; a level with several asks.** The two rules are
different and the difference is the point: defaulting to the first of several reads as a
suggestion, and "first" is whatever the map iterated — not the club's main race, not the
nearest. One answer is not a question at all, so a club with a single series, a series running a
single race today, a race with one division or a course with one published design settles
itself, and the button under it never says *Choose a series* about a series nobody could choose
differently. It is the editor's `stageOf` rule, which is the value of a hierarchy over a flat
list: it collapses to nothing when there is nothing to choose. Settled into `this.boat` rather
than into the markup, because the join reads its course from there. **`NO_RACE` does not make a
single race into two answers** — it is opting out of the question, not another race.

**The club is the exception, and is remembered rather than defaulted.** A sail number, a boat name and a club
are facts about whoever is holding the phone; the series, course and variant are the decision being made.
`sessionStorage` for now, wrapped in a try — storage is not always there to be had, and a join screen that
threw rather than opening would be the worst possible trade for remembering a sail number.

**Only TODAY's races are offered.** Where a series has races but none today the screen says so, since *no
races* and *no races today* are different facts and only the second is worth acting on.

**"No race — just sail a course" is an ANSWER, not an absent one**, and carries a value where every other
placeholder carries none. What follows from it needed no second decision: no channel, no fleet, and **no
fixes** — on a phone in a bracket for four hours, reporting to nobody is battery and data spent on nobody.

**And if there is no conversation to be had at all, the boat sails anyway**: `Device.join` falls back to the
REST `/api/join`. The message stays on the screen, because a boat sailing without a committee should know that
is what it is doing.

**PRACTICE MAY STEP THROUGH THE COURSE; A RACE MAY NOT** (`RaceClient.resolveSkip`). Practising
is sailing one mark over and over and then the next one, and without a skip the only way to put
mark 4 live is to round three marks first. Two buttons on the deck name the mark they land on,
because the reason for pressing one is to arrive at a particular mark, and they are absent
rather than disabled at the ends of the sequence. The refusal lives in the client, not in a
button the screen happens not to draw: this is the object that decides a race, and a race whose
marks could be stepped past would produce a record saying a boat rounded what it did not.

A skip moves the pointer and touches nothing else — not the clock, not the crossings, not which
entry line a lap is measured from — so a practice record says exactly what was crossed. Two ends
are worth naming: **a cycle's start choice is position −1**, so skipping back to it brings the
offer of every entry line back, and skipping forward off it leaves no `entryIndex`, which is
honest because no lap is being timed; and **a finished run is one past the end**, so back resumes
it and takes the finish time with it, a result that stood while the boat went on sailing being a
result about nothing.

**The handicap is carried, not applied**: the join screen collects a TCF and does nothing with it, because
turning a TCF into a distance is open question 5.
