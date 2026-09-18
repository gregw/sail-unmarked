package org.mortbay.sailing.unmarked.model;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * One editable design belonging to exactly one {@link Course}: Div 1, the short course, or
 * simply <em>the</em> variant where a course has only one.
 *
 * <p>See {@code wiki/course-lifecycle.html}. A variant is the thing an editor edits and the
 * thing a snapshot is taken <em>of</em>; it is mutable right up to the warning gun, because
 * nothing a boat has sailed depends on it staying still — what a boat sailed is a
 * {@link CourseSnapshot}, and those are immutable.
 *
 * <p><b>A variant belongs to one course, and that is what makes the dangerous question
 * answerable.</b> "Whose racing did I just change?" has an answer only if the edge from
 * geometry to racing runs one way through a structure with no shortcuts. A variant shared
 * between two courses would need its own name, its own publication and its own dirty state,
 * which is to say it would be a course. Shape that really is common between two courses is
 * shared one level down, as a named line.
 *
 * <h2>Ad-hoc geometry</h2>
 * {@code points} and {@code lines} here are <b>ad-hoc</b>: they have no id in the club's
 * list and exist only inside this variant, so moving one affects exactly one variant by
 * construction. They are what the Courses tab creates when somebody drags a shared mark and
 * declines to move it for everybody. Everything else the sequence names is <b>named</b>
 * geometry from the programme, and naming is identity rather than sharing — a mark is named
 * because people refer to it, not because several courses happen to.
 *
 * <p>Resolution is a merge with the variant's own on top, so an ad-hoc copy may take the
 * name of the club point it was detached from without the two being confused: within this
 * variant the local one wins, and everywhere else the club's is untouched.
 *
 * <h2>Templates</h2>
 * A template is a variant marked as such, and <b>the one thing it cannot do is be
 * snapshotted</b>. Everything else follows without a second rule: no snapshot means no
 * publication, which means no boat can join it, which means it is permanently unpublished
 * and never dirty. To race one, clone it — which clears the flag, or the copy could not be
 * snapshotted either.
 */
public record CourseVariant(
    @JsonProperty("id") String id,
    @JsonProperty("name") String name,
    @JsonProperty("template") boolean template,
    @JsonProperty("closed") boolean closed,
    @JsonProperty("points") Map<String, NamedPoint> points,
    @JsonProperty("lines") Map<String, Line> lines,
    @JsonProperty("sequence") List<CourseStep> sequence,
    @JsonProperty("notes") String notes)
{
    /**
     * The id of the variant a course has when nobody has thought about variants.
     *
     * <p>A course written with a bare {@code sequence:} and no {@code variants:} block reads
     * as one variant under this id, and is written back the same way. The level appears in
     * the file only when it is actually being used for something.
     */
    public static final String MAIN = "main";

    public CourseVariant
    {
        if (name == null || name.isBlank())
            name = id;
        points = (points == null) ? Map.of() : Map.copyOf(points);
        lines = (lines == null) ? Map.of() : Map.copyOf(lines);
        sequence = (sequence == null) ? List.of() : List.copyOf(sequence);
    }

    /** True when this variant is nothing but a copy of the club's named geometry. */
    @JsonIgnore
    public boolean allNamed()
    {
        return points.isEmpty() && lines.isEmpty();
    }

    /** The club's points with this variant's ad-hoc ones on top. */
    public Map<String, NamedPoint> resolvePoints(Map<String, NamedPoint> club)
    {
        if (points.isEmpty())
            return club == null ? Map.of() : club;
        Map<String, NamedPoint> merged = new LinkedHashMap<>(club == null ? Map.of() : club);
        merged.putAll(points);
        return merged;
    }

    /** The club's lines with this variant's ad-hoc ones on top. */
    public Map<String, Line> resolveLines(Map<String, Line> club)
    {
        if (lines.isEmpty())
            return club == null ? Map.of() : club;
        Map<String, Line> merged = new LinkedHashMap<>(club == null ? Map.of() : club);
        merged.putAll(lines);
        return merged;
    }

    /**
     * The letter drawn inside the triangle for the step at {@code index}: {@code S} for the
     * start, {@code F} for the finish, and the ordinal in between. Derived, never stored —
     * see {@link CourseStep}.
     */
    public String sequenceLetter(int index)
    {
        // A closed course has no start and no finish of its own — a boat begins and ends
        // wherever it joined — so S and F would be claiming something untrue about it.
        // Every step is simply numbered, and which of them may be joined at is marked.
        //
        // From ZERO, so the numbering lines up with the open course rather than running one
        // ahead of it: the leg into step 1 is leg 1 either way, and the first numbered mark
        // is 1 either way. Numbering a cycle from 1 made its first leg "leg 2", which is a
        // different answer to the same question depending only on a tickbox.
        if (closed)
            return Integer.toString(index);
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
     * True when some line on this variant can carry a per-boat sub-line, which is what a
     * distance-corrected race needs.
     *
     * <p>A half-infinite line is the shape that works: its finite end is the knob, so
     * pushing that end out along the bearing makes a boat sail further before there is any
     * line to cross. A finite line has no such freedom.
     */
    public boolean hasAdjustableLine(Map<String, Line> club)
    {
        Map<String, Line> all = resolveLines(club);
        return sequence.stream()
            .flatMap(step -> step.alternatives().stream())
            .map(step -> all.get(step.line()))
            .anyMatch(line -> line != null && line.halfInfinite());
    }

    /**
     * The length of each leg in nautical miles, one per step; the first is
     * {@link Double#NaN} because nothing precedes the start. A leg the course could not
     * measure and did not override is also NaN, and is reported by {@link #problems}.
     */
    public double[] legLengthsNm(Map<String, Line> club, Map<String, NamedPoint> clubPoints)
    {
        Map<String, Line> all = resolveLines(club);
        Map<String, NamedPoint> allPoints = resolvePoints(clubPoints);
        double[] legs = new double[sequence.size()];
        Position previous = null;
        for (int i = 0; i < sequence.size(); i++)
        {
            CourseStep step = sequence.get(i);
            Position here = step.referencePoint(all, allPoints);
            if (i == 0)
                legs[i] = Double.NaN;   // no leg runs into it yet; a cycle's does, below
            else if (step.lengthNm() != null)
                legs[i] = step.lengthNm();
            else if (previous != null && here != null)
                legs[i] = Geo.distanceNm(previous, here);
            else
                legs[i] = Double.NaN;
            previous = (here != null) ? here : previous;
        }

        // THE CLOSING LEG. A cycle's last mark runs back to its first, and that water is as
        // much of the course as any other — a boat sails it every lap. Leaving it out made a
        // lap measure short by one leg, which is a length people navigate and handicap by.
        // It is the leg INTO step 0, which is exactly what the numbering already says, so
        // step 0's lengthNm overrides it like any other step's overrides its own.
        // `previous` is the last placed reference point, which is where it runs from.
        if (closed && sequence.size() > 1)
        {
            CourseStep entry = sequence.get(0);
            Position here = entry.referencePoint(all, allPoints);
            if (entry.lengthNm() != null)
                legs[0] = entry.lengthNm();
            else if (previous != null && here != null)
                legs[0] = Geo.distanceNm(previous, here);
        }
        return legs;
    }

    /** The sum of the leg lengths, or NaN while any leg is unmeasurable. */
    public double lengthNm(Map<String, Line> club, Map<String, NamedPoint> clubPoints)
    {
        double total = 0;
        double[] legs = legLengthsNm(club, clubPoints);
        // From 0 on a cycle, because legs[0] is its closing leg; from 1 on an open course,
        // where nothing runs into the start and legs[0] is NaN by construction.
        for (int i = closed ? 0 : 1; i < legs.length; i++)
        {
            if (Double.isNaN(legs[i]))
                return Double.NaN;
            total += legs[i];
        }
        return total;
    }

    /**
     * Complaints about this variant, as human-readable sentences; empty when it is
     * coherent. {@code where} names it in the message, since a variant on its own is not
     * enough to find.
     *
     * <p>Reported rather than thrown. A course with a typo in it should be visible in the
     * start-up log and on the courses endpoint, not a reason the server will not start.
     */
    public List<String> problems(String where, Map<String, Line> club,
        Map<String, NamedPoint> clubPoints)
    {
        Map<String, Line> all = resolveLines(club);
        Map<String, NamedPoint> allPoints = resolvePoints(clubPoints);
        List<String> problems = new ArrayList<>();
        if (sequence.size() < 2)
            problems.add(where + " needs at least a start and a finish");

        /*
         * A CYCLE WITH NO ENTRY POINT CANNOT BE JOINED, and saying so here is what stops it
         * being discovered on the water. An open course has a start and a finish by position;
         * a cycle has neither of its own, so the only thing that says where a lap may begin —
         * and therefore where it ends, the same line being crossed twice — is this flag. With
         * none set there is no line to start the clock on and nothing to finish against, so
         * the variant is incomplete in exactly the sense the lifecycle means: it will not
         * snapshot, and nothing can be published from it.
         */
        if (closed && entryPoints().isEmpty())
        {
            problems.add(where + " is a cycle with no entry point: mark at least one line"
                + " a boat may begin and end a lap at");
        }

        // Ad-hoc geometry gets the same checks the club's does. It is not surveyed by
        // anybody and is the more likely of the two to be half-finished.
        points.forEach((id, point) ->
        {
            if (!point.surveyed())
                problems.add(where + " ad-hoc point '" + id + "' has no position");
        });
        lines.forEach((id, line) ->
        {
            for (Map.Entry<String, LineEnd> e :
                Map.of("port", line.port(), "starboard", line.starboard()).entrySet())
            {
                LineEnd end = e.getValue();
                if (end == null || !end.located())
                    problems.add(where + " ad-hoc line '" + id + "' has no " + e.getKey() + " end");
                else if (end.at() != null && !allPoints.containsKey(end.at()))
                    problems.add(where + " ad-hoc line '" + id + "' " + e.getKey()
                        + " end names unknown point '" + end.at() + "'");
            }
        });

        for (int i = 0; i < sequence.size(); i++)
        {
            CourseStep step = sequence.get(i);
            String at = where + " step " + sequenceLetter(i);
            if (!step.isGate() && step.line() == null)
                problems.add(at + " names neither a line nor a gate");
            if ((i == 0 || i == sequence.size() - 1) && step.isGate())
                problems.add(at + " is a gate; the start and the finish must be a single line");
            for (CourseStep alt : step.alternatives())
            {
                if (alt.line() != null && !all.containsKey(alt.line()))
                    problems.add(at + " names unknown line '" + alt.line() + "'");
            }
        }

        double[] legs = legLengthsNm(club, clubPoints);
        for (int i = closed ? 0 : 1; i < legs.length; i++)
        {
            String at = where + " leg into " + sequenceLetter(i);
            if (Double.isNaN(legs[i]))
                problems.add(at + " cannot be measured — supply lengthNm");
            // A zero CLOSING leg is not the mistake the zero check exists for. It means the
            // last mark is the first mark — a cycle written the open-course way, `A B C A`,
            // with the return spelled out instead of implied. That is redundant, not wrong:
            // the loop is already complete when it reaches the repeat, so the closing leg
            // adds nothing and the length comes out the same as `A B C`. Everywhere else a
            // zero leg still means two steps share a reference point, which no course means.
            else if (legs[i] <= 0 && !(closed && i == 0))
                problems.add(at + " measures zero; two steps share a reference point");
        }
        return problems;
    }
}
