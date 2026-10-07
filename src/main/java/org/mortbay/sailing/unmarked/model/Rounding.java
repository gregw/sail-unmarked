package org.mortbay.sailing.unmarked.model;

/**
 * THE LINE A ROUNDING STANDS FOR. A step may round a point rather than cross a line: forward is a
 * port rounding, the mark left to port, and reverse a starboard one. On the water it is crossed as
 * a half-infinite line from the mark, out of the turn — away from the bisector of the leg in and
 * the leg out — so a boat going round the mark on the side its sense names crosses it, and the
 * boat detects it with the same tests as any other line.
 *
 * <p>The mark is the line's PORT end, finite, and the line runs out through a point {@link #ARM_M}
 * along that direction, infinite. So a forward crossing leaves the mark to port, which is a port
 * rounding, and a reverse one leaves it to starboard — the sense needs no translating.
 *
 * <p>Resolved when a snapshot is taken, from the legs either side as they stand then, and so inside
 * the revision like every other resolved end. The legs are measured to the mark itself.
 *
 * <p>A virtual rounding is no help to a boat rounding a real buoy short of it: the line is where the
 * mark is said to be, and a boat that rounds somewhere else has not crossed it.
 */
public final class Rounding
{
    /** How far out from the mark the line's defining point is placed. Past it the line runs on. */
    public static final double ARM_M = 10.0;

    private static final double M_PER_DEG_LAT = 111320;

    private Rounding()
    {
    }

    /**
     * The point the rounding's line runs out through, or null where a leg either side is not
     * placed or has no length.
     *
     * <p>Out of the turn, which is the side a boat sailing round the mark passes. Where the legs
     * run straight through the mark there is no turn to be outside of, and the line goes square to
     * the leg on the side the boat passes: to starboard of the boat's course for a port rounding,
     * which leaves the mark to port.
     */
    public static Position arm(Position mark, Position before, Position after, Direction sense)
    {
        if (mark == null || before == null || after == null)
            return null;
        double[] in = unit(local(mark, before));
        double[] out = unit(local(mark, after));
        if (in == null || out == null)
            return null;
        double[] bisector = {in[0] + out[0], in[1] + out[1]};
        double[] away;
        if (Math.hypot(bisector[0], bisector[1]) < 1e-6)
        {
            // East and north: clockwise of the course is starboard.
            away = sense == Direction.REVERSE
                ? new double[]{-out[1], out[0]}
                : new double[]{out[1], -out[0]};
        }
        else
        {
            away = unit(new double[]{-bisector[0], -bisector[1]});
        }
        double mPerDegLon = M_PER_DEG_LAT * Math.cos(Math.toRadians(mark.latitude()));
        return new Position(mark.latitude() + away[1] * ARM_M / M_PER_DEG_LAT,
            mark.longitude() + away[0] * ARM_M / mPerDegLon);
    }

    /** Metres east and north of {@code origin}, in the plane tangent there. */
    private static double[] local(Position origin, Position p)
    {
        double mPerDegLon = M_PER_DEG_LAT * Math.cos(Math.toRadians(origin.latitude()));
        return new double[]{(p.longitude() - origin.longitude()) * mPerDegLon,
            (p.latitude() - origin.latitude()) * M_PER_DEG_LAT};
    }

    private static double[] unit(double[] v)
    {
        double length = Math.hypot(v[0], v[1]);
        return length < 1e-9 ? null : new double[]{v[0] / length, v[1] / length};
    }
}
