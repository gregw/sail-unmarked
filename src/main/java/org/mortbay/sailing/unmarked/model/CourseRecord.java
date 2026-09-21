package org.mortbay.sailing.unmarked.model;

import java.time.Instant;
import java.util.List;
import java.util.OptionalLong;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * What one boat did on one course, as the boat computed it.
 *
 * <p>This is a <b>report, not a request</b>. The crossings and the elapsed time were
 * decided on the boat, from raw GNSS, with no network. The server stores it and hands it
 * on; it does not adjudicate it.
 *
 * <h2>There are no races here</h2>
 * This system publishes courses and collects what boats did on them. Places, OCS,
 * corrected times, penalties, drop races and series scoring belong to the club's own
 * scoring software, which already has rules for all of it. Owning none of that is what
 * lets this be right about the one thing it is uniquely able to be right about: detecting
 * and timing a crossing.
 *
 * <p>The consequence, and it is a commitment rather than a gap: <b>every start is
 * self-timed</b>. A boat's clock starts when it crosses, because there is nothing here to
 * fire a gun. A club running a fixed-gun race scores from its own gun and this record's
 * crossing times.
 *
 * <h2>This record is the interface</h2>
 * Since it is the only artefact that leaves this system, it has to carry everything a
 * scorer or a protest could need: who, which course <em>and which revision of it</em>,
 * when, the crossings with their interpolated instants, and the quality-control trail
 * behind them. Anything a scorer needs and cannot find here would pull race concepts back
 * into this codebase.
 */
public record CourseRecord(
    @JsonProperty("club") String club,
    @JsonProperty("series") String series,
    @JsonProperty("course") String course,
    /**
     * Which geometry was sailed. Courses are edited live, so a course id alone would let
     * two boats be compared who sailed different water.
     */
    @JsonProperty("courseRevision") String courseRevision,
    @JsonProperty("join") JoinMode join,
    @JsonProperty("boatId") String boatId,
    @JsonProperty("boatName") String boatName,
    @JsonProperty("sailNumber") String sailNumber,
    /** Declared by the boat when it joined, if it declared one. Applied by nobody here. */
    @JsonProperty("tcf") Double tcf,
    /**
     * How long the boat is, in metres, as it declared when it joined.
     *
     * <p>Asked for because the boat's own screen needs it — the approach plot draws the hull
     * to scale and zooms no closer than a few of these — and kept here because it is the first
     * thing a handicapper or a protest asks about a boat, and this is the only artefact that
     * leaves the system. Trusted like everything else a boat says about itself (§1.1).
     */
    @JsonProperty("lengthM") Double lengthM,
    /**
     * WHICH RACE THIS RUN WAS ENTERED IN, and the division it was entered as.
     *
     * <p><b>Stamped by the server from the session, never read off the boat's own message.</b>
     * Which race a boat is in is an entry the committee accepted, so it is one of the few facts
     * here the boat is not the authority on — and a boat that named a race it was not in would
     * otherwise appear in that race's results. Everything else in this record is the boat's own
     * account of itself and is trusted as such (dialog §1.1).
     *
     * <p>Null for a run with no race behind it, which is the ordinary case for a record attempt
     * and for practice: this system publishes courses, and a race is a thing that sometimes
     * happens on one.
     */
    @JsonProperty("race") String race,
    @JsonProperty("division") String division,
    @JsonProperty("startTime") Instant startTime,
    @JsonProperty("finishTime") Instant finishTime,
    @JsonProperty("submittedAt") Instant submittedAt,
    @JsonProperty("appVersion") String appVersion,
    @JsonProperty("crossings") List<CrossingEvent> crossings,
    @JsonProperty("fixes") List<Fix> fixes)
{
    public CourseRecord
    {
        if (join == null)
            join = JoinMode.ANONYMOUS;
        crossings = (crossings == null) ? List.of() : List.copyOf(crossings);
        fixes = (fixes == null) ? List.of() : List.copyOf(fixes);
    }

    /**
     * The same record, entered in a race — which only the server may say. See {@link #race}.
     *
     * <p>A copy rather than a setter because this is a record in both senses: what a boat did
     * is not edited after the fact, and the one thing added here is added by the only party
     * that knows it.
     */
    public CourseRecord enteredIn(String inRace, String inDivision)
    {
        if (inRace == null && inDivision == null)
            return this;
        return new CourseRecord(club, series, course, courseRevision, join, boatId, boatName,
            sailNumber, tcf, lengthM, inRace, inDivision, startTime, finishTime, submittedAt,
            appVersion, crossings, fixes);
    }

    /** Elapsed seconds on the boat's own clock, or empty until it has finished. */
    @JsonIgnore
    public OptionalLong elapsedSeconds()
    {
        if (startTime == null || finishTime == null)
            return OptionalLong.empty();
        return OptionalLong.of(finishTime.getEpochSecond() - startTime.getEpochSecond());
    }

    /** True when the full track came with it, so a contested crossing can be examined. */
    @JsonIgnore
    public boolean auditable()
    {
        return !fixes.isEmpty();
    }

    /** True when this record stands against others on the same course geometry. */
    @JsonIgnore
    public boolean ranked()
    {
        return join.ranked() && courseRevision != null && elapsedSeconds().isPresent();
    }
}
