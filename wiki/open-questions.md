# Open questions

**What is not decided, and why none of it should be decided by asserting a number in code.**
The numbering is stable — code and other documents refer to these by number.

1. **Confirmation count N.** The 3-and-3 default needs tuning against real logged tracks from the
   intended waters, where multipath off the rig and nearby structures clusters. Sustained
   multipath could produce consecutive bad fixes, arguing for a higher N or a harder kinematic
   gate. See [crossing-detection.md](crossing-detection.md).

2. **Accuracy band.** A fixed declared width versus each fix's stated accuracy. Both are
   implemented; `accuracyBandM: null` selects per-fix, which is more honest and makes the
   effective line width vary with the sky.

3. **Is the end-of-line warning loud enough** on a phone in glare? The mechanism is settled and
   built — one-metre resolution, a hard edge, and `projectCog()` behind the ring that turns amber
   inside the margin and red past the end. Whether it carries is a question for somebody on the
   water.

4. **Asynchronous window width.** How far apart in time boats can sail the same loop before
   differing wind and tide mean they are not racing the same course.

5. **Distance-factor conversion.** *Decided and built:* a TCF of *t* sails *t* times the nominal
   length, shared between a course's tracks by sliding them all the same fraction along — see
   [course-model.md](course-model.md#distance-corrected-handicap-each-boats-own-line). What stays
   open is whether a linear rule is fair across leg geometry and wind angle, which wants results
   from the water. The TCF is declared by the boat at the join; a club entering its fleet's TCFs
   in advance is not built.

6. **The QC threshold values.** Kinematic ceiling, minimum satellites, accuracy limit — all
   configurable per series (`defaults.qc`), and all currently defaults asserted against no data.

7. **Coordinate supply.** How marks are surveyed and by whom. Nothing in this repository is a
   survey: the sample programmes carry positions placed by eye on a chart.

8. **Impersonation, and one tier of officer.** Boats are unauthenticated by design, so any device
   can claim any sail number — [dialog §13](client-server-dialog.md#13-what-is-deferred), deferred
   on purpose. And any account the login admits may use every officer's screen; *some may abandon
   a race and others only watch* is a sensible thing to want that nothing enforces.

9. **Capacitor.** Not yet present. Background-geolocation behaviour, iOS Safari suspending the
   Geolocation API in the browser fallback, and plugin versions all shift; verify at build time
   rather than trusting [brief §8](unmarked-racing-brief.html).

10. **The fleet's own trust**, which is the same question one level out. `fleet` carries what boats
    said about themselves, and the race screen draws it — so a boat that misreports puts a wrong
    position on everybody's screen. The honest position today is that the fleet feed is a view
    rather than evidence.

11. **Which gate side a boat took** is in the record — the crossing names the line taken — and
    nothing downstream uses it. On the Mark screen it shows: each side carries its own next-leg
    bearing.
