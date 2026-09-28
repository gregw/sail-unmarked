package org.mortbay.sailing.unmarked.model;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Distance-corrected handicapping: what makes a course correctable, and the range of TCFs it
 * can correct.
 *
 * <h2>The model</h2>
 * A line with a {@code handicapWidthM} is a <b>track</b>, and a step naming it does not ask a
 * boat to cross it. Each boat's own line is centred on the track: the midpoint is where a 1.000
 * boat's line sits, the <b>near</b> end — the one that makes the legs either side shortest — is
 * the lowest TCF the course can take, and the far end the highest. Each boat's line is
 * {@code handicapWidthM} wide and square to the track, so together they sweep a rectangle that
 * belongs to the line, which the designer sees on the line itself and checks once. The width is
 * the line's, not a step's, because a line is never suitable for both: every step naming a track
 * is handicapped, and a track that is somewhere a start or a finish is refused.
 *
 * <p><b>One slide for the whole course.</b> Every handicapped step is placed at the same
 * fraction {@code u} of its track, −1 at the near end, 0 at the midpoint and +1 at the far end.
 * A boat of TCF {@code t} is given the {@code u} at which the course is {@code t} times its
 * nominal length. One number rather than a share per line is what makes a line passed twice,
 * and two handicapped steps in a row, need no special case: every leg is between two points
 * moving in straight lines, so the course length is a convex function of {@code u} and one
 * bisection finds it.
 *
 * <h2>Where it is computed</h2>
 * Here, only what a server has to say before a boat joins: whether the course is correctable
 * at all, which end of each track is near, and the range of TCFs it can take — so a join
 * outside it can be refused. Placing a boat's line is done on the boat, by
 * {@code client/www/handicap.js}, from the snapshot, with no network; nothing here decides a
 * crossing. The two work in the same local plane as {@code crossing.js} and measure the
 * handicapped legs as differences from the nominal length, so a metre of disagreement
 * between the two spheres cancels.
 */
public final class Handicap
{
    /** Metres per degree of latitude — the tangent plane {@code crossing.js} uses. */
    private static final double M_PER_DEG_LAT = 111320;

    /** The TCFs a course can take, to the three places a TCF is written to. */
    public record Range(double tcfMin, double tcfMax)
    {
    }

    /**
     * A course's handicapped steps worked out: which end of each track is near, and the
     * range. {@code near} is indexed by step, null where the step is not handicapped.
     */
    public record Plan(String[] near, Range range)
    {
    }

    private Handicap()
    {
    }

    /**
     * Why a boat declaring {@code tcf} cannot be handed this snapshot, or null when it can.
     *
     * <p>A boat with no TCF is refused rather than sailed as 1.000: a handicapped course with
     * nobody's handicap in it is a scratch race over a course nobody meant, and the boat
     * would find out afterwards.
     */
    public static String refusal(CourseSnapshot snapshot, Double tcf)
    {
        if (snapshot.tcfMin() == null || snapshot.tcfMax() == null)
            return null;
        String range = String.format(java.util.Locale.ROOT, "%.3f to %.3f",
            snapshot.tcfMin(), snapshot.tcfMax());
        if (tcf == null || tcf <= 0)
            return "This course is handicapped by distance and needs your TCF; it takes " + range + ".";
        if (tcf < snapshot.tcfMin() - 1e-9 || tcf > snapshot.tcfMax() + 1e-9)
            return String.format(java.util.Locale.ROOT, "This course can place a line for a TCF"
                + " from %s; %.3f is outside it, so it cannot be sailed at that handicap.", range, tcf);
        return null;
    }

    /** True when some step of this variant, or a side of a gate in it, names a handicap track. */
    public static boolean correctable(CourseVariant variant, Map<String, Line> lines)
    {
        return variant.sequence().stream()
            .flatMap(step -> step.alternatives().stream())
            .anyMatch(alt -> track(alt, lines) != null);
    }

    /** The handicap track a step or a gate's side names, or null. */
    static Line track(CourseStep step, Map<String, Line> lines)
    {
        Line line = step.line() == null || lines == null ? null : lines.get(step.line());
        return line != null && line.handicapped() ? line : null;
    }

    /** The width a boat's line at this step is given, or null where the step is not handicapped. */
    public static Double widthAt(CourseStep step, Map<String, Line> lines)
    {
        Line line = step.isGate() ? null : track(step, lines);
        return line == null ? null : line.handicapWidthM();
    }

    /**
     * The handicapped steps of a variant worked out, or null when it has none or cannot be
     * measured yet — a course with problems is reported by {@link #problems}, not planned.
     */
    public static Plan plan(CourseVariant variant, Map<String, Line> lines,
        Map<String, NamedPoint> points)
    {
        if (!correctable(variant, lines) || !problems(variant, "", lines, points).isEmpty())
            return null;
        double lengthNm = variant.lengthNm(lines, points);
        Geometry g = Geometry.of(variant, lines, points);
        if (g == null || Double.isNaN(lengthNm) || lengthNm <= 0)
            return null;
        double nominalM = lengthNm * Geo.METRES_PER_NM;
        double min = 1 + g.delta(-1) / nominalM;
        double max = 1 + g.delta(1) / nominalM;
        // Inward to the third place, so every TCF the range admits can be given a line.
        Range range = new Range(Math.ceil(min * 1000 - 1e-9) / 1000, Math.floor(max * 1000 + 1e-9) / 1000);
        return new Plan(g.near, range);
    }

    /**
     * Why this variant's handicapped steps cannot be used, one sentence each; empty when
     * they can, or when there are none.
     */
    public static List<String> problems(CourseVariant variant, String where,
        Map<String, Line> lines, Map<String, NamedPoint> points)
    {
        List<String> problems = new ArrayList<>();
        if (!correctable(variant, lines))
            return problems;
        List<CourseStep> sequence = variant.sequence();
        int n = sequence.size();

        /*
         * A START OR FINISH IS NEVER A TRACK. A start and a finish are crossed as themselves,
         * and a track never is, so a handicap line named there is refused. On a cycle every
         * entry is a start and a finish.
         */
        Set<String> ends = new HashSet<>();
        for (int i = 0; i < n; i++)
        {
            boolean end = variant.closed() ? sequence.get(i).entry() : (i == 0 || i == n - 1);
            if (end)
                sequence.get(i).alternatives().forEach(alt -> ends.add(alt.line()));
        }

        // Said once per LINE, since it is the line's to fix, however many steps name it.
        Set<String> said = new HashSet<>();
        boolean shaped = true;
        for (int i = 0; i < n; i++)
        {
            CourseStep step = sequence.get(i);
            String at = where + " step " + variant.sequenceLetter(i);
            if (step.isGate())
            {
                for (CourseStep alt : step.gate())
                {
                    if (track(alt, lines) != null)
                    {
                        problems.add(at + " is a gate with handicap line '" + alt.line() + "' as a"
                            + " side; a handicap line can only be a step of its own");
                        shaped = false;
                    }
                }
                continue;
            }
            Line line = track(step, lines);
            if (line == null)
                continue;
            if (ends.contains(step.line()))
            {
                problems.add(at + " names handicap line '" + step.line() + "', which is a start or"
                    + " finish of this course; a start or finish must be a line crossed as itself");
                shaped = false;
            }
            if (said.add(step.line()))
            {
                if (line.handicapWidthM() <= 0)
                    problems.add(where + " handicap line '" + step.line() + "' has a width of "
                        + trim(line.handicapWidthM()) + " m; give it a positive width");
                if (line.port() == null || line.starboard() == null
                    || line.port().infinite() || line.starboard().infinite())
                {
                    problems.add(where + " handicap line '" + step.line() + "' has an infinite end;"
                        + " a handicap line must stop at both ends");
                    shaped = false;
                }
            }
            // A fixed length cannot stretch, and the whole point of the step is that its legs do.
            if (step.lengthNm() != null)
                problems.add(at + " is handicapped, so the leg into it cannot have a fixed lengthNm");
            int next = variant.closed() ? (i + 1) % n : i + 1;
            if (next < n && next != i && sequence.get(next).lengthNm() != null)
                problems.add(where + " leg into " + variant.sequenceLetter(next) + " follows handicapped"
                    + " step " + variant.sequenceLetter(i) + ", so it cannot have a fixed lengthNm");
        }
        if (!shaped)
            return problems;

        Geometry g = Geometry.of(variant, lines, points);
        if (g == null)
            return problems;   // positions still missing, which problems() already reports

        for (int i = 0; i < n; i++)
        {
            if (widthAt(sequence.get(i), lines) == null)
                continue;
            String at = where + " step " + variant.sequenceLetter(i);
            if (g.near[i] == null)
            {
                problems.add(at + " handicaps a line whose two ends are equally far round the"
                    + " course; draw it running away from the steps either side");
                continue;
            }
            /*
             * THE TURN MUST BE A RIGHT ANGLE OR SHARPER, at every boat's line and not only the
             * 1.000 boat's. Past 90° the legs are nearly a straight run: the step is a passage,
             * and a track pushed out from a passage lengthens it by next to nothing.
             */
            for (double u : new double[]{-1, 0, 1})
            {
                double[] here = g.at(i, u);
                double[] a = sub(g.at(g.prev(i), u), here);
                double[] b = sub(g.at(g.next(i), u), here);
                if (norm(a) == 0 || norm(b) == 0)
                    continue;   // a zero leg, reported by problems() already
                double degrees = Math.toDegrees(Math.acos(Math.max(-1, Math.min(1,
                    dot(a, b) / (norm(a) * norm(b))))));
                if (degrees > 90.5)
                {
                    problems.add(at + " has legs " + Math.round(degrees) + "° apart"
                        + (u == 0 ? "" : u < 0 ? " at the near end of its line" : " at the far end of its line")
                        + "; a handicapped step needs its legs 90° apart or less");
                    break;
                }
            }
        }

        /*
         * EVERY LEG MUST GROW AS THE LINES SLIDE OUT. A leg between two points moving in
         * straight lines is convex in u, so it grows over the whole range exactly when it is not
         * shrinking at the near end — which is one dot product, and one sentence a designer can
         * act on: the track has to run away from both of its neighbours.
         */
        for (int[] leg : g.legs())
        {
            int from = leg[0];
            int to = leg[1];
            if (!g.slides(from) && !g.slides(to))
                continue;
            double[] apart = sub(g.at(to, -1), g.at(from, -1));
            double[] moving = sub(g.slide[to], g.slide[from]);
            if (dot(apart, moving) < 0)
            {
                int blame = g.slides(to) ? to : from;
                problems.add(where + " leg into " + variant.sequenceLetter(to) + " gets shorter as"
                    + " the handicap line at step " + variant.sequenceLetter(blame) + " slides out;"
                    + " draw that line running away from the steps either side of it");
            }
        }
        return problems;
    }

    /**
     * Every step's reference point in a local plane, and how it slides: {@code at(i, u)} is
     * {@code base[i] + u * slide[i]}, and {@code slide} is zero on a step that is not
     * handicapped.
     */
    private record Geometry(boolean closed, double[][] base, double[][] slide, String[] near)
    {
        static Geometry of(CourseVariant variant, Map<String, Line> lines,
            Map<String, NamedPoint> points)
        {
            List<CourseStep> sequence = variant.sequence();
            int n = sequence.size();
            Position origin = null;
            for (CourseStep step : sequence)
            {
                Position p = step.referencePoint(lines, points);
                if (p == null)
                    return null;
                if (origin == null)
                    origin = p;
            }
            if (origin == null)
                return null;

            double[][] base = new double[n][];
            double[][] ports = new double[n][];
            double[][] starboards = new double[n][];
            for (int i = 0; i < n; i++)
            {
                CourseStep step = sequence.get(i);
                if (widthAt(step, lines) != null)
                {
                    Line line = lines.get(step.line());
                    Position p = Line.resolve(line.port(), points);
                    Position s = Line.resolve(line.starboard(), points);
                    if (p == null || s == null)
                        return null;
                    ports[i] = local(origin, p);
                    starboards[i] = local(origin, s);
                    // The plane midpoint, not the great-circle one, so that u = 0 is exactly
                    // halfway between the two ends the boat's lines slide between.
                    base[i] = scale(add(ports[i], starboards[i]), 0.5);
                }
                else
                {
                    base[i] = local(origin, step.referencePoint(lines, points));
                }
            }

            // Near is decided against the NOMINAL neighbours, so the choice at one step does
            // not depend on the choice at the next.
            Geometry nominal = new Geometry(variant.closed(), base, new double[n][2], new String[n]);
            String[] near = new String[n];
            double[][] slide = new double[n][2];
            for (int i = 0; i < n; i++)
            {
                if (widthAt(sequence.get(i), lines) == null)
                    continue;
                double[] prev = base[nominal.prev(i)];
                double[] next = base[nominal.next(i)];
                double viaPort = norm(sub(ports[i], prev)) + norm(sub(next, ports[i]));
                double viaStarboard = norm(sub(starboards[i], prev)) + norm(sub(next, starboards[i]));
                if (Math.abs(viaPort - viaStarboard) < Geo.RESOLUTION_M)
                    continue;
                boolean portNear = viaPort < viaStarboard;
                near[i] = portNear ? "port" : "starboard";
                double[] nearEnd = portNear ? ports[i] : starboards[i];
                double[] farEnd = portNear ? starboards[i] : ports[i];
                slide[i] = scale(sub(farEnd, nearEnd), 0.5);
            }
            return new Geometry(variant.closed(), base, slide, near);
        }

        double[] at(int i, double u)
        {
            return add(base[i], scale(slide[i], u));
        }

        boolean slides(int i)
        {
            return slide[i][0] != 0 || slide[i][1] != 0;
        }

        int prev(int i)
        {
            return i > 0 ? i - 1 : closed ? base.length - 1 : i;
        }

        int next(int i)
        {
            return i < base.length - 1 ? i + 1 : closed ? 0 : i;
        }

        /** Each leg as {from, to}: into every step after the first, and round on a cycle. */
        List<int[]> legs()
        {
            List<int[]> legs = new ArrayList<>();
            for (int i = 1; i < base.length; i++)
                legs.add(new int[]{i - 1, i});
            if (closed && base.length > 1)
                legs.add(new int[]{base.length - 1, 0});
            return legs;
        }

        /** How much longer than nominal the course is with every line at {@code u}, in metres. */
        double delta(double u)
        {
            double total = 0;
            for (int[] leg : legs())
            {
                if (!slides(leg[0]) && !slides(leg[1]))
                    continue;
                total += norm(sub(at(leg[1], u), at(leg[0], u)))
                    - norm(sub(base[leg[1]], base[leg[0]]));
            }
            return total;
        }
    }

    private static double[] local(Position origin, Position p)
    {
        double mPerDegLon = M_PER_DEG_LAT * Math.cos(Math.toRadians(origin.latitude()));
        return new double[]{(p.longitude() - origin.longitude()) * mPerDegLon,
            (p.latitude() - origin.latitude()) * M_PER_DEG_LAT};
    }

    private static double[] add(double[] a, double[] b)
    {
        return new double[]{a[0] + b[0], a[1] + b[1]};
    }

    private static double[] sub(double[] a, double[] b)
    {
        return new double[]{a[0] - b[0], a[1] - b[1]};
    }

    private static double[] scale(double[] a, double k)
    {
        return new double[]{a[0] * k, a[1] * k};
    }

    private static double dot(double[] a, double[] b)
    {
        return a[0] * b[0] + a[1] * b[1];
    }

    private static double norm(double[] a)
    {
        return Math.hypot(a[0], a[1]);
    }

    private static String trim(double value)
    {
        return value == Math.rint(value) ? Long.toString((long) value) : Double.toString(value);
    }
}
