package org.mortbay.sailing.unmarkable.model;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * One step of a course: cross this line, in this sense. Or, for a gate, satisfy any one
 * of these.
 *
 * <p>A step is a <b>tagged shape</b> so that the sequence stays a flat list while gaining
 * new kinds of element without a migration. Today a step names a {@code line} and a
 * {@code cross} sense, or holds a {@code gate} of alternatives. A course that mixes real
 * marks with virtual lines adds {@code mark} and a rounding sense beside them, and every
 * existing file keeps loading.
 *
 * <p><b>A gate's alternatives are ordinary steps</b>, which is what makes them
 * element-agnostic: the two sides of a gate need not be the same kind of thing, so a gate
 * with a virtual line one side and a real buoy the other is expressible without a special
 * case. A boat satisfies the step by satisfying any one alternative, and the record says
 * which.
 *
 * <h2>Roles are positional</h2>
 * There is no {@code role: start} field. <b>The first step of a course is the start and
 * the last is the finish</b>, which is also why neither may be a mark — you cannot start
 * or finish on a point. The sequence letters drawn on the course diagram (S, 1, 2, … F)
 * are derived from position for the same reason: writing them down would let the letters
 * and the order disagree. The two-lap windward/leeward gets S, 2 and F onto one line for
 * free, because that line simply appears three times.
 *
 * <h2>Entry points, on a closed course</h2>
 * {@code entry} marks a step a boat may join a cycle at. It means nothing on an open
 * course, which has one start and one finish by position.
 *
 * <p>The rule that makes it work is a deliberate simplification: <b>a line crossed to
 * begin a lap must be crossed again, in the same sense, to end it.</b> So an entry point
 * is a start and a finish at once, and a boat's lap is bounded by the same crossing twice
 * rather than by two different ones. That puts the burden on course design — a cycle wants
 * lines that a boat passes once per lap — and takes it off the scoring, which would
 * otherwise have to decide which of several crossings closed the loop.
 *
 * <h2>Leg length</h2>
 * {@code lengthNm} overrides the length of the leg <em>into</em> this step. Left out, the
 * leg is measured between the reference points of this step and the one before it — see
 * {@link Line#referencePoint}. A measured leg of zero is an error, not a short leg: it
 * means the same reference point twice running, which no course means.
 */
public record CourseStep(
    @JsonProperty("line") String line,
    @JsonProperty("cross") Direction cross,
    @JsonProperty("gate") List<CourseStep> gate,
    @JsonProperty("lengthNm") Double lengthNm,
    @JsonProperty("entry") boolean entry,
    @JsonProperty("notes") String notes)
{
    public CourseStep
    {
        gate = (gate == null) ? List.of() : List.copyOf(gate);
        if (cross == null && line != null)
            cross = Direction.FORWARD;
    }

    /** True when this step offers a choice rather than naming one line. */
    @JsonIgnore
    public boolean isGate()
    {
        return !gate.isEmpty();
    }

    /** This step as a flat list of the lines that can satisfy it. */
    @JsonIgnore
    public List<CourseStep> alternatives()
    {
        return isGate() ? gate : List.of(this);
    }

    /**
     * Where this step counts as being, for measuring the legs either side.
     *
     * <p>A gate is measured to the midpoint between its alternatives, which is both the
     * obvious answer and the one that does not depend on which side a given boat took —
     * a course length that varied with a boat's choice would make the live-place axis
     * mean different things for different boats.
     */
    public Position referencePoint(Map<String, Line> lines, Map<String, NamedPoint> points)
    {
        if (!isGate())
        {
            Line l = lines.get(line);
            return l == null ? null : l.referencePoint(points);
        }
        Position sum = null;
        int n = 0;
        for (CourseStep alt : gate)
        {
            Position p = alt.referencePoint(lines, points);
            if (p == null)
                return null;
            sum = (sum == null) ? p : Geo.midpoint(sum, p);
            n++;
        }
        // Successive midpoints are only the true centroid for n == 2, which every real
        // gate is. Beyond that this is a reasonable point on the right patch of water and
        // the course should say what it means with an override.
        return n == 0 ? null : sum;
    }
}
