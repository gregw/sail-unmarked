# Crossing detection

**How a boat decides, from raw GNSS and with no network, that it crossed a line, which way,
and at what instant.** This is the part of the system that decides a race, and it runs on the
boat.

| | |
|---|---|
| `client/www/crossing.js` | the detector and the quality gates — the heart of it |
| `client/www/raceclient.js` | `RaceClient.accept`: one fix through the whole pipeline, and which step is live |
| `client/www/crossing-test.js` | the executable spec, run in a browser and in `mvn test` from one file |

There is **no Java implementation** of any of this, deliberately. The server stores what the
boat decided and never re-runs it; a copy on the server would invite it to start adjudicating
roundings, which is the one thing the architecture says it must not do. `Geo.java` does
distance and midpoint for course measurement and nothing else.

The comments in `crossing.js` are the specification. This page is the map.

---

## A mark is a line, and deciding a crossing is two tests

A line has two ends, `port` and `starboard`, each of which may be **infinite**. A **forward**
crossing leaves the port end to port and the starboard end to starboard; **reverse** is the
opposite. An infinite end is a *bearing, not a place*: the line runs out through the given point
and keeps going. (See [course-model.md](course-model.md) for why lines and not points.)

| Test | Question | Involves the ends? |
|---|---|---|
| **Sense** | Which way did the boat cross? | No — a sign test on the port→starboard vector |
| **Extent** | Did it cross the line, or its extension past a finite end? | Only finite ends |

Keeping them apart is what makes infinite ends behave: an infinite end is always on the side its
name says, so **only a finite end can be missed**. The Mark screen's three states are exactly the
combinations — *approaching* (neither settled), *crossed* (both passed), *missed* (sense passed,
extent failed).

**Detection is segment intersection, not proximity.** The segment between two successive good
fixes either cuts the line or it does not (`intersect`). Proximity misreads a fast crossing of a
thin line and cannot give a clean crossing instant at all.

---

## One fix, through the pipeline

Everything below happens in `RaceClient.accept(fix)`, once per fix, in this order.

```
fix ──► quality control ──► relocation watch ──► project to local metres ──► live step's detectors ──► advance
         (qualityCheck)      (RelocationWatch)     (toLocal, one origin)       (CrossingDetector)
```

### 1. Quality control — reject cleanly, never smooth

A single out-of-position fix is more dangerous to a line test than to almost anything else: a
**flyer** landing on the far side makes the segment out *and* the segment back both cut the line,
manufacturing a matched pair of crossings the boat never made. So fixes are gated, outermost
first (`qualityCheck`):

| Gate | Rejects | Notes |
|---|---|---|
| **Metadata** | too few satellites, stated accuracy worse than `maxAccuracyM` | necessary, not sufficient — a wrong fix often still claims a good accuracy. A missing satellite count (every phone browser) is *no evidence either way* |
| **Kinematic** | a fix further from the last good one than `kinematicBudgetM` allows | the primary defence. The budget is what the boat could have travelled at `maxSpeedKn` **plus** what the receiver could have made up (3σ of the two stated accuracies, in quadrature), so a high fix rate does not make the gate reject honest noise |

Nothing is smoothed. A filter aggressive enough to reject outliers also lags true position and
biases the crossing instant — the one quantity a score depends on. Rejected fixes are kept with
their reasons, for the record.

### 2. Relocation — a jump the boat really made

The kinematic gate has no way out of its own judgement: `lastGood` only advances on an accepted
fix, so after a real jump — a dropout below decks, under a bridge, a phone asleep in a pocket —
every fix is measured against a place the boat has left. `RelocationWatch` tells the two apart:
**a flyer disagrees with its neighbours; a relocation agrees with itself.** N consecutive
kinematically-rejected fixes that are each plausible from the one before are accepted as the
boat's new position.

A relocation **must never become a crossing.** The segment from where the boat was believed to
be to where it is may sweep across any number of lines, so the detectors are re-armed and the
trail thrown away. The live step is *not* advanced: a crossing made during the blackout was not
seen and has to be made again. Only a *kinematic* refusal can relocate — a run of two-satellite
fixes is not evidence about anything.

### 3. One origin for the whole course

Every line of a course is projected into one local tangent plane (metres east and north), fixed
at join time from the first surveyed end (`originOf`, `toLocal`). A perpendicular distance
computed against one origin and compared against another would be quietly wrong by however far
apart the origins are.

### 4. The detector — the N-and-N latch

Only the **live step** sees fixes. On a two-lap windward/leeward the leeward line is the start,
mark 2 and the finish — one line, three steps, each with its own detector — so a boat crossing it
on the way to the windward mark cannot latch the finish early. Both sides of a **gate** get a
detector and see every fix; the first to latch is the side taken. Before a **cycle** starts, every
entry line is live at once, the same way.

`CrossingDetector.accept` then requires, for a crossing to be valid:

1. at least **N consecutive fixes confirming one side** (N is `confirmFixes`, default 3),
2. a **segment that cuts the line**, then
3. at least **N consecutive fixes confirming the other side**.

A single flyer cannot produce N confirmed fixes on the far side, so it fails; a boat that dips over
and comes back logs *far side not confirmed*. When the far side is confirmed the candidate is
settled (`settle`), sense first:

| Outcome | Recorded as |
|---|---|
| wrong sense | rejected, *wrong sense* — logged, not scored, not a miss |
| right sense, outside the extent | rejected, *side change was past the port/starboard end* — the **missed** state |
| right sense, within the extent | **latched** |

**A latch is monotone.** Once a required-sense crossing is confirmed it stands, and nothing later
can un-make it or move its time — so no late bad fix can corrupt a running parity. (The
taut-string winding test used for point marks is not used: it is undefined for a line.)

### 5. The instant is interpolated

**Validity and timing are separate jobs.** Confirmation decides *whether*; the instant decides
*when*, and it is never the time of any fix. It is the time at which the segment between the two
fixes either side cuts the line, interpolated along that segment. Taking it from a confirming fix
would bias it early (last near-side fix) or late (first far-side fix) by up to a fix interval.

Elapsed time runs **from the interpolated start crossing** to the interpolated finish — never from
when the app was opened, and never from a gun. Both instants come from the boat's own clock, so a
clock offset cancels (see [the trust model](client-server-dialog.md#11-the-boat-is-trusted-entirely)).

---

## Two bands: which side a fix is ON, and which side it CONFIRMS

| | Band | Used by |
|---|---|---|
| `side()` | half the system's one-metre resolution (`SIDE_BAND_M`) | the screens: colouring each fix on the plot |
| `confirmedSide()` | `accuracyBandM`, or the fix's own stated accuracy when that is null | the latch: what counts as evidence |

A fix two metres from the line under a two-metre sky is on a side, but it is not *evidence* of
being on that side — the error alone could account for it. The stricter band is what stops a boat
sitting on a line assembling a crossing out of noise. The screens use the narrow one so that the
picture of a crossing is not a run of grey dots through the moment being explained.

---

## One metre, a hard edge, and a warning

**The resolution of the whole system is one metre** — `RESOLUTION_M` in `crossing.js` and
`Geo.RESOLUTION_M` in Java, which must agree. Every distance computed, displayed or scored against
passes through `resolve()`. GNSS on a phone does not honestly resolve better, and a scoring edge
that moved with the twelfth decimal place of a float is one nobody could argue in front of a
protest committee.

So **a finite end is a hard edge: if you miss, you miss.** There is no band of doubt at an end;
the only band is about the line itself. What the system owes the sailor instead is **warning**:
`projectCog()` projects the boat's COG onto the line and reports the margin from that cut to the
nearer finite end, flagging `near-end` (inside 50 m) or `beyond-end`. The Mark screen turns that
into the ring that goes amber and then red, and colours the time-to-line red when the present
course scores nothing. An infinite end raises no warning, because it is not a hazard.

---

## Tuning

The numbers are properties of the water and the devices on it, so they live in each series file
(`defaults:` → `Programme.Detection`), travel inside every snapshot, and are read by the boat:

```yaml
defaults:
  confirmFixes: 3          # N in the N-and-N latch
  accuracyBandM: null      # fixed half-width, or null for each fix's stated accuracy
  qc:
    minSatellites: 4       # metadata pre-filter
    maxAccuracyM: 25
    maxSpeedKn: 40         # the kinematic gate
```

Every one of them is a default set against no data. See [open questions](open-questions.md) 1, 2
and 6.

---

## What reaches the record

`RaceClient.record()` builds the `CourseRecord`: each latched crossing as a `CrossingEvent` with
its interpolated instant, position and confirmation counts, and each QC refusal or relocation as
a `CrossingEvent` with `counted: false` and a `note` giving the reason (*REJECTED_KINEMATIC:
implied ground speed 63 kn*). Candidates a detector refused are drawn on the Mark screen but are
not yet in the record.
