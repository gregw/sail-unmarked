package org.mortbay.sailing.unmarkable.model;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * A course: an ordered sequence of {@link CourseStep}s over lines defined elsewhere in the
 * same file.
 *
 * <p>Served to boats before the start and cached. Once a boat holds it, nothing about that
 * boat's rounding or timing needs the server again.
 *
 * <p>{@code closed} marks a loop that can be joined anywhere and left where it was joined
 * — the circuit format. It is one absolute course in one place, not a shape relocated per
 * club: what makes it work across clubs is that boats join on their own evening at their
 * own point, not that the geometry moves. So a circuit is an ordinary course whose
 * sequence happens to close, and this flag is the only thing that distinguishes it.
 */
public record Course(
    @JsonProperty("id") String id,
    @JsonProperty("name") String name,
    @JsonProperty("closed") boolean closed,
    @JsonProperty("sequence") List<CourseStep> sequence,
    @JsonProperty("notes") String notes)
{
    public Course
    {
        if (name == null || name.isBlank())
            name = id;
        sequence = (sequence == null) ? List.of() : List.copyOf(sequence);
    }

    /**
     * The letter drawn inside the triangle for the step at {@code index}: {@code S} for
     * the start, {@code F} for the finish, and the ordinal in between. Derived, never
     * stored — see {@link CourseStep}.
     */
    public String sequenceLetter(int index)
    {
        // A closed course has no start and no finish of its own — a boat begins and ends
        // wherever it joined — so S and F would be claiming something untrue about it.
        // Every step is simply numbered, and which of them may be joined at is marked.
        if (closed)
            return Integer.toString(index + 1);
        if (index == 0)
            return "S";
        if (index == sequence.size() - 1)
            return "F";
        return Integer.toString(index);
    }

    /** The steps a boat may begin and end a lap at. Empty on an open course. */
    @JsonIgnore
    public List<CourseStep> entryPoints()
    {
        return closed ? sequence.stream().filter(CourseStep::entry).toList() : List.of();
    }

    /**
     * True when some line on this course can carry a per-boat sub-line, which is what a
     * distance-corrected race needs.
     *
     * <p>A half-infinite line is the shape that works: its finite end is the knob, so
     * pushing that end out along the bearing makes a boat sail further before there is any
     * line to cross. A finite line has no such freedom.
     */
    @JsonIgnore
    public boolean hasAdjustableLine(Map<String, Line> lines)
    {
        return sequence.stream()
            .flatMap(step -> step.alternatives().stream())
            .map(step -> lines.get(step.line()))
            .anyMatch(line -> line != null && line.halfInfinite());
    }

    /**
     * The length of each leg in nautical miles, one per step; the first is
     * {@link Double#NaN} because nothing precedes the start. A leg the course could not
     * measure and did not override is also NaN, and is reported by {@link #problems}.
     */
    @JsonIgnore
    public double[] legLengthsNm(Map<String, Line> lines, Map<String, NamedPoint> points)
    {
        double[] legs = new double[sequence.size()];
        Position previous = null;
        for (int i = 0; i < sequence.size(); i++)
        {
            CourseStep step = sequence.get(i);
            Position here = step.referencePoint(lines, points);
            if (i == 0)
                legs[i] = Double.NaN;
            else if (step.lengthNm() != null)
                legs[i] = step.lengthNm();
            else if (previous != null && here != null)
                legs[i] = Geo.distanceNm(previous, here);
            else
                legs[i] = Double.NaN;
            previous = (here != null) ? here : previous;
        }
        return legs;
    }

    /** The sum of the leg lengths, or NaN while any leg is unmeasurable. */
    @JsonIgnore
    public double lengthNm(Map<String, Line> lines, Map<String, NamedPoint> points)
    {
        double total = 0;
        double[] legs = legLengthsNm(lines, points);
        for (int i = 1; i < legs.length; i++)
        {
            if (Double.isNaN(legs[i]))
                return Double.NaN;
            total += legs[i];
        }
        return total;
    }

    /**
     * Complaints about this course, as human-readable sentences; empty when it is
     * coherent.
     *
     * <p>Reported rather than thrown. A course with a typo in it should be visible in the
     * start-up log and on the courses endpoint, not a reason the server will not start —
     * the same trade the store makes about a file somebody edited badly.
     */
    @JsonIgnore
    public List<String> problems(Map<String, Line> lines, Map<String, NamedPoint> points)
    {
        List<String> problems = new ArrayList<>();
        if (sequence.size() < 2)
            problems.add("course '" + id + "' needs at least a start and a finish");

        for (int i = 0; i < sequence.size(); i++)
        {
            CourseStep step = sequence.get(i);
            String where = "course '" + id + "' step " + sequenceLetter(i);
            if (!step.isGate() && step.line() == null)
                problems.add(where + " names neither a line nor a gate");
            if ((i == 0 || i == sequence.size() - 1) && step.isGate())
                problems.add(where + " is a gate; the start and the finish must be a single line");
            for (CourseStep alt : step.alternatives())
            {
                if (alt.line() != null && !lines.containsKey(alt.line()))
                    problems.add(where + " names unknown line '" + alt.line() + "'");
            }
        }

        double[] legs = legLengthsNm(lines, points);
        for (int i = 1; i < legs.length; i++)
        {
            String where = "course '" + id + "' leg into " + sequenceLetter(i);
            if (Double.isNaN(legs[i]))
                problems.add(where + " cannot be measured — supply lengthNm");
            else if (legs[i] <= 0)
                problems.add(where + " measures zero; two steps share a reference point");
        }
        return problems;
    }
}
