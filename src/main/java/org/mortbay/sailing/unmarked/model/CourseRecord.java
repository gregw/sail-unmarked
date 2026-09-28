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
 * <h2>There is no scoring here</h2>
 * This system publishes courses, runs the committee's side of a race where there is one,
 * and collects what boats did. Places, OCS, corrected times, penalties, drop races and
 * series scoring belong to the club's own scoring software, which already has rules for all
 * of it. Owning none of that is what lets this be right about the one thing it is uniquely
 * able to be right about: detecting and timing a crossing.
 *
 * <p>The consequence, and it is a commitment rather than a gap: <b>every elapsed time is
 * self-timed</b>. A boat's clock starts when it crosses the start line, even where a
 * committee published a start time. A club scoring from a gun scores from its own gun and
 * this record's crossing times.
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
    /**
     * Declared by the boat when it joined, if it declared one. Applied by nobody here — except
     * on a course handicapped by distance, where the boat applied it to the lines it was given
     * and {@link #handicap} says so.
     */
    @JsonProperty("tcf") Double tcf,
    /**
     * How long the boat is, in metres, as it declared when it joined.
     *
     * <p>Asked for because the boat's own screen needs it — the approach plot draws the hull
     * to scale and zooms no closer than a few of these — and kept here because it is the first
     * thing a handicapper or a protest asks about a boat, and this is the only artefact that
     * leaves the system. Trusted like everything else a boat says about itself (dialog §1.1).
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
    @JsonProperty("fixes") List<Fix> fixes,
    /**
     * THE LINES THIS BOAT WAS GIVEN, on a course handicapped by distance; null on any other.
     *
     * <p>They follow from the snapshot and the TCF, and are written down anyway: a result has
     * to be explicable from this record alone, long after the code that placed them has
     * changed. And they are what says the TCF has already been applied — in the distance — so
     * nobody multiplies the elapsed time by it a second time.
     */
    @JsonProperty("handicap") Applied handicap)
{
    /** The lines placed for a boat's TCF: how far along the tracks, and each line itself. */
    public record Applied(
        @JsonProperty("fraction") Double fraction,
        @JsonProperty("lines") List<PlacedLine> lines)
    {
        public Applied
        {
            lines = (lines == null) ? List.of() : List.copyOf(lines);
        }
    }

    /** One boat's line at one handicapped step, and the track it was placed along. */
    public record PlacedLine(
        @JsonProperty("step") int step,
        @JsonProperty("line") String line,
        @JsonProperty("track") String track,
        @JsonProperty("port") Position port,
        @JsonProperty("starboard") Position starboard)
    {
    }

    /** A record of a course nobody handicapped by distance. */
    public CourseRecord(String club, String series, String course, String courseRevision,
        JoinMode join, String boatId, String boatName, String sailNumber, Double tcf,
        Double lengthM, String race, String division, Instant startTime, Instant finishTime,
        Instant submittedAt, String appVersion, List<CrossingEvent> crossings, List<Fix> fixes)
    {
        this(club, series, course, courseRevision, join, boatId, boatName, sailNumber, tcf,
            lengthM, race, division, startTime, finishTime, submittedAt, appVersion, crossings,
            fixes, null);
    }

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
            appVersion, crossings, fixes, handicap);
    }

    /** Elapsed seconds on the boat's own clock, or empty until it has finished. */
    @JsonIgnore
    public OptionalLong elapsedSeconds()
    {
        if (startTime == null || finishTime == null)
            return OptionalLong.empty();
        return OptionalLong.of(finishTime.getEpochSecond() - startTime.getEpochSecond());
    }

    /** True when its TCF went into the distance sailed, so its elapsed time is already corrected. */
    @JsonIgnore
    public boolean distanceCorrected()
    {
        return handicap != null;
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
