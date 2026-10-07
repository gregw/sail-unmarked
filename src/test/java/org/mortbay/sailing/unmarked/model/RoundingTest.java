package org.mortbay.sailing.unmarked.model;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.closeTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.startsWith;

/**
 * A step that rounds a point: where the line it is crossed as goes, what the snapshot carries, how
 * the legs either side are measured, and what is refused.
 *
 * <p>The positions are invented for the test, placed in metres east and north of an origin in
 * Sydney Harbour's latitude, and are nobody's survey.
 */
public class RoundingTest
{
    private static final double LAT = -33.8;
    private static final double LON = 151.25;
    private static final double M_PER_DEG_LAT = 111320;
    private static final double M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos(Math.toRadians(LAT));

    private final Map<String, Line> lines = new LinkedHashMap<>();
    private final Map<String, NamedPoint> points = new LinkedHashMap<>();

    private static Position place(double east, double north)
    {
        return new Position(LAT + north / M_PER_DEG_LAT, LON + east / M_PER_DEG_LON);
    }

    private static double east(Position p)
    {
        return (p.longitude() - LON) * M_PER_DEG_LON;
    }

    private static double north(Position p)
    {
        return (p.latitude() - LAT) * M_PER_DEG_LAT;
    }

    private RoundingTest line(String id, double pe, double pn, double se, double sn)
    {
        Position p = place(pe, pn);
        Position s = place(se, sn);
        lines.put(id, new Line(id, null, new LineEnd(null, p.latitude(), p.longitude(), false, null),
            new LineEnd(null, s.latitude(), s.longitude(), false, null), null));
        return this;
    }

    private RoundingTest point(String id, double east, double north)
    {
        Position p = place(east, north);
        points.put(id, new NamedPoint(id, null, p.latitude(), p.longitude(), null));
        return this;
    }

    private static CourseStep cross(String line)
    {
        return new CourseStep(line, Direction.FORWARD, null, null, false, null);
    }

    private static CourseStep round(String point, Direction sense)
    {
        return new CourseStep(null, sense, null, null, false, null, point);
    }

    private static CourseVariant open(CourseStep... steps)
    {
        return new CourseVariant("v", null, false, false, null, null, List.of(steps), null);
    }

    private CourseSnapshot snapshot(CourseVariant variant)
    {
        Map<String, CourseVariant> variants = new LinkedHashMap<>();
        variants.put(CourseVariant.MAIN, variant);
        Course course = new Course("c", "C", null, false, variants);
        Programme programme = new Programme("test.example", "fixture", null, null, null, null,
            points, lines, Map.of("c", course), null, null);
        return CourseSnapshot.of(programme, course, CourseVariant.MAIN);
    }

    /** A start south of a mark, a turn to the west round it, and a finish to the west. */
    private CourseVariant leftTurn(Direction sense)
    {
        line("start", -50, 0, 50, 0).line("finish", -1000, 950, -1000, 1050).point("mark", 0, 1000);
        return open(cross("start"), round("mark", sense), cross("finish"));
    }

    @Test
    void aPortRoundingIsALineFromTheMarkOutOfTheTurn()
    {
        CourseSnapshot.Crossing rounding = snapshot(leftTurn(Direction.FORWARD)).steps().get(1).crossings().get(0);
        assertThat("it says it is a rounding", rounding.point(), is(true));
        assertThat("it is named for the mark", rounding.line(), is("mark"));
        assertThat("the port end is the mark, finite",
            east(new Position(rounding.port().latitude(), rounding.port().longitude())), closeTo(0, 0.01));
        assertThat(rounding.port().infinite(), is(false));
        assertThat("the line runs on past its other end", rounding.starboard().infinite(), is(true));

        // In from the south, out to the west: the outside of that turn is to the north-east, and the
        // line's other end is ten metres out that way.
        Position arm = new Position(rounding.starboard().latitude(), rounding.starboard().longitude());
        assertThat("out of the turn, to the east", east(arm), closeTo(10 / Math.sqrt(2), 0.1));
        assertThat("...and the north", north(arm) - 1000, closeTo(10 / Math.sqrt(2), 0.1));
        assertThat("a port rounding is a forward crossing", rounding.cross(), is(Direction.FORWARD));
    }

    @Test
    void aStarboardRoundingIsTheSameLineCrossedTheOtherWay()
    {
        CourseSnapshot.Crossing port = snapshot(leftTurn(Direction.FORWARD)).steps().get(1).crossings().get(0);
        lines.clear();
        points.clear();
        CourseSnapshot.Crossing starboard = snapshot(leftTurn(Direction.REVERSE)).steps().get(1).crossings().get(0);
        assertThat(starboard.cross(), is(Direction.REVERSE));
        assertThat(starboard.starboard().latitude(), closeTo(port.starboard().latitude(), 1e-9));
        assertThat(starboard.starboard().longitude(), closeTo(port.starboard().longitude(), 1e-9));
    }

    @Test
    void aMarkPassedStraightIsCrossedSquareToTheLegOnTheSideTheBoatPasses()
    {
        line("start", -50, 0, 50, 0).line("finish", -50, 2000, 50, 2000).point("mark", 0, 1000);
        CourseSnapshot.Crossing port = snapshot(open(cross("start"), round("mark", Direction.FORWARD),
            cross("finish"))).steps().get(1).crossings().get(0);
        // Northbound, leaving the mark to port: the boat passes to its east, so the line goes east.
        assertThat(east(new Position(port.starboard().latitude(), port.starboard().longitude())), closeTo(10, 0.1));
        CourseSnapshot.Crossing starboard = snapshot(open(cross("start"), round("mark", Direction.REVERSE),
            cross("finish"))).steps().get(1).crossings().get(0);
        assertThat(east(new Position(starboard.starboard().latitude(), starboard.starboard().longitude())), closeTo(-10, 0.1));
    }

    @Test
    void theLegsAreMeasuredToTheMarkItself()
    {
        CourseVariant variant = leftTurn(Direction.FORWARD);
        double[] legs = variant.legLengthsNm(lines, points);
        assertThat("start to mark", legs[1] * 1852, closeTo(1000, 1));
        assertThat("mark to finish", legs[2] * 1852, closeTo(1000, 1));
    }

    @Test
    void theRoundingIsInTheRevision()
    {
        String port = snapshot(leftTurn(Direction.FORWARD)).revision();
        lines.clear();
        points.clear();
        assertThat("which way round is geometry", snapshot(leftTurn(Direction.REVERSE)).revision(), is(not(port)));
    }

    @Test
    void aRoundingCannotStartOrFinishOrBeAGatesSide()
    {
        line("start", -50, 0, 50, 0).line("finish", -1000, 950, -1000, 1050).point("mark", 0, 1000);
        assertThat(open(round("mark", Direction.FORWARD), cross("finish")).problems("c", lines, points),
            hasItem(startsWith("c step S rounds point 'mark'; a start must be a line")));
        assertThat(open(cross("start"), round("mark", Direction.FORWARD)).problems("c", lines, points),
            hasItem(startsWith("c step F rounds point 'mark'; a finish must be a line")));
        CourseStep gate = new CourseStep(null, null, List.of(cross("finish"), round("mark", Direction.FORWARD)),
            null, false, null);
        assertThat(open(cross("start"), gate, cross("finish")).problems("c", lines, points),
            hasItem(startsWith("c step 1 is a gate with point 'mark' as a side")));
        assertThat(open(cross("start"), round("nowhere", Direction.FORWARD), cross("finish")).problems("c", lines, points),
            hasItem(startsWith("c step 1 rounds unknown point 'nowhere'")));
        assertThat("a course that rounds a mark properly has nothing to say about it",
            leftTurn(Direction.FORWARD).problems("c", lines, points).isEmpty(), is(true));
    }
}
