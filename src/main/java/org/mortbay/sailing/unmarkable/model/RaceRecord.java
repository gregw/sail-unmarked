package org.mortbay.sailing.unmarkable.model;

import java.time.Instant;
import java.util.List;
import java.util.OptionalLong;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * What one boat did in one race, as the boat computed it, posted when signal allowed.
 *
 * <p>This is a <b>report, not a request</b>. The crossings and the elapsed time in it were
 * decided on the boat, from raw GNSS, with no network. The server stores it and aggregates
 * it; it does not adjudicate it. That division is the architecture, and it is the thing to
 * defend: if you find yourself moving crossing detection to the server so it can "check" a
 * rounding, stop.
 *
 * <p>{@code fixes} is optional and large. A boat can post the crossings immediately over a
 * phone connection and the full track later over wifi — a record with crossings and no
 * fixes is complete enough to score and not complete enough to audit.
 *
 * <p>{@code tcf} travels with the record because a handicap is a property of a boat
 * <em>in a given race</em> and not of the boat, which is the same reasoning sail-jinx
 * applies to its entrants. In the distance-factor format it has already been spent on the
 * course length and the elapsed time is the result, so it is carried to show the working
 * and must not be applied a second time.
 */
public record RaceRecord(
    @JsonProperty("raceId") String raceId,
    @JsonProperty("club") String club,
    @JsonProperty("series") String series,
    @JsonProperty("course") String course,
    @JsonProperty("format") RaceFormat format,
    @JsonProperty("boatId") String boatId,
    @JsonProperty("boatName") String boatName,
    @JsonProperty("sailNumber") String sailNumber,
    @JsonProperty("tcf") Double tcf,
    @JsonProperty("startTime") Instant startTime,
    @JsonProperty("finishTime") Instant finishTime,
    @JsonProperty("submittedAt") Instant submittedAt,
    @JsonProperty("appVersion") String appVersion,
    @JsonProperty("crossings") List<CrossingEvent> crossings,
    @JsonProperty("fixes") List<Fix> fixes)
{
    public RaceRecord
    {
        crossings = (crossings == null) ? List.of() : List.copyOf(crossings);
        fixes = (fixes == null) ? List.of() : List.copyOf(fixes);
    }

    /** Elapsed seconds on the boat's own clock, or empty until it has finished. */
    public OptionalLong elapsedSeconds()
    {
        if (startTime == null || finishTime == null)
            return OptionalLong.empty();
        return OptionalLong.of(finishTime.getEpochSecond() - startTime.getEpochSecond());
    }

    /** True when the full track came with it, so a contested crossing can be examined. */
    public boolean auditable()
    {
        return !fixes.isEmpty();
    }
}
