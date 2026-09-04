package org.mortbay.sailing.unmarkable.model;

import java.time.Instant;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * A crossing the boat detected, whether or not it counted.
 *
 * <p><b>{@code time} is interpolated and is never the time of any fix.</b> It is the
 * instant at which the segment between two successive good fixes cuts the line. Taking it
 * from a confirming fix biases it — early if from the last near-side fix, late if from
 * the first far-side one — and the crossing instant is the one quantity a score depends
 * on. Detection is the intersection of that segment with the line, not proximity to it:
 * proximity misreads a fast crossing of a thin line and cannot give a clean instant at
 * all.
 *
 * <p>Validity and timing are separate jobs and stay separate. {@code confirmBefore} and
 * {@code confirmAfter} are what made it valid — N consecutive quality fixes on the
 * required side, then N on the far side. {@code time} is what it is worth.
 *
 * <p>{@code step} is the index into the course sequence, which is also what gives the
 * crossing its drawn letter; {@code line} says which line was actually crossed, and for a
 * gate that is the alternative this boat took.
 *
 * <p>{@code counted} false with a {@code note} is the audit case: a crossing in the wrong
 * sense, or one whose side change happened out past a finite end — the Mark screen's
 * "missed", where the sense test passed and the extent test failed. Those are logged and
 * ignored. A crossing in the required sense latches and stands, which makes the whole
 * thing monotone and means no late bad fix can corrupt a running parity.
 */
public record CrossingEvent(
    @JsonProperty("step") int step,
    @JsonProperty("line") String line,
    @JsonProperty("cross") Direction cross,
    @JsonProperty("time") Instant time,
    @JsonProperty("position") Position position,
    @JsonProperty("confirmBefore") int confirmBefore,
    @JsonProperty("confirmAfter") int confirmAfter,
    @JsonProperty("counted") boolean counted,
    @JsonProperty("note") String note)
{
}
