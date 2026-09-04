package org.mortbay.sailing.unmarkable.model;

import java.util.Map;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * A virtual mark: two ends, named {@code port} and {@code starboard}, either of which may
 * be infinite. There is no radius and no point of contest — a line is crossed, not
 * rounded, which is what keeps RRS 18 out of it.
 *
 * <p>Lines live in their own section rather than inside a course, because one line serves
 * several: a club's start line is the same line in every course it appears in, and moving
 * it should be one edit. A course refers to lines by id.
 *
 * <p>Everything on the water is one of these. What differs is which ends are infinite and
 * what the course asks of it:
 *
 * <ul>
 *   <li><b>Start/finish</b> — both ends finite, as a boat and a pin.</li>
 *   <li><b>Contested rounding</b> — both ends finite, square across the approaching leg,
 *       so the fleet crosses it the way it crosses a start line.</li>
 *   <li><b>Light rounding</b> — one end finite where a real mark would be, the other
 *       infinite, running away along the approach so it cannot be missed outboard.</li>
 *   <li><b>Passing mark</b> — parallel to the leg, off to one side.</li>
 *   <li><b>Gate</b> — two lines and a choice; see {@link CourseStep}.</li>
 *   <li><b>Island</b> — half-infinite, finite end on the shore.</li>
 * </ul>
 *
 * <p>Putting a finite end on shore is the ordinary way to take a near-end dispute off the
 * table without making the line infinite. No boat sails there, so the end costs nothing.
 */
public record Line(
    @JsonProperty("id") String id,
    @JsonProperty("name") String name,
    @JsonProperty("port") LineEnd port,
    @JsonProperty("starboard") LineEnd starboard,
    @JsonProperty("notes") String notes)
{
    public Line
    {
        if (name == null || name.isBlank())
            name = id;
    }

    /** True when neither end stops, so the line divides the world in two. */
    public boolean fullyInfinite()
    {
        return port != null && starboard != null && port.infinite() && starboard.infinite();
    }

    /** True when exactly one end runs on — the ordinary light-rounding shape. */
    public boolean halfInfinite()
    {
        return port != null && starboard != null && port.infinite() != starboard.infinite();
    }

    /**
     * Where this line counts as being, for measuring the legs either side of it: the
     * midpoint of its two defined points. Null only while those points are unsupplied.
     *
     * <p>One rule, no special cases, and for an infinite end that is deliberate. The point
     * given for such an end sets a bearing and nothing else — sliding it along the line
     * leaves the line geometrically identical — so it is <b>free to be used as the control
     * handle for where this line is measured to</b>. Put it where the fleet actually
     * crosses and the legs either side come out right; a course-design UI can draw the leg
     * straight to this midpoint and let somebody drag the far point until it looks like
     * the course they meant.
     *
     * <p>That is why the arbitrariness is not a defect here. The alternative rule — take
     * the finite end of a half-infinite line, since it cannot move without the line moving
     * — is more stable and gives up the handle, leaving the only way to adjust a leg an
     * explicit override with no picture attached to it.
     *
     * <p>{@code lengthNm} on a course step still overrides the measurement outright, for
     * a leg whose length is a matter of record rather than of geometry.
     */
    public Position referencePoint(Map<String, NamedPoint> points)
    {
        Position p = resolve(port, points);
        Position s = resolve(starboard, points);
        if (p == null || s == null)
            return null;
        return Geo.midpoint(p, s);
    }

    /** An end's position, whether it names a point or carries one inline. */
    public static Position resolve(LineEnd end, Map<String, NamedPoint> points)
    {
        if (end == null)
            return null;
        Position inline = end.inlinePosition();
        if (inline != null)
            return inline;
        if (end.at() == null || points == null)
            return null;
        NamedPoint named = points.get(end.at());
        return named == null ? null : named.position();
    }
}
