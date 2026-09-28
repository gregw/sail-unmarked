package org.mortbay.sailing.unmarked.model;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.closeTo;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;

/**
 * What makes a course correctable by distance, and the TCFs it can take.
 *
 * <p>The positions are invented for the test, placed in metres east and north of an origin in
 * Sydney Harbour's latitude, and are nobody's survey.
 */
public class HandicapTest
{
    private static final double LAT = -33.8;
    private static final double LON = 151.25;
    private static final double M_PER_DEG_LAT = 111320;

    private final Map<String, Line> lines = new LinkedHashMap<>();

    private static LineEnd at(double east, double north, boolean infinite)
    {
        double lon = LON + east / (M_PER_DEG_LAT * Math.cos(Math.toRadians(LAT)));
        return new LineEnd(null, LAT + north / M_PER_DEG_LAT, lon, infinite, null);
    }

    private HandicapTest line(String id, double pe, double pn, double se, double sn)
    {
        lines.put(id, new Line(id, null, at(pe, pn, false), at(se, sn, false), null));
        return this;
    }

    private static CourseStep step(String line)
    {
        return new CourseStep(line, Direction.FORWARD, null, null, false, null);
    }

    private static CourseStep handicapped(String line, double widthM)
    {
        return new CourseStep(line, Direction.FORWARD, null, null, false, null, widthM);
    }

    private static CourseVariant open(CourseStep... steps)
    {
        return new CourseVariant("v", null, false, false, null, null, List.of(steps), null);
    }

    /** The same as {@link #open}, after the lines it names have been drawn. */
    private CourseVariant variant(CourseStep... steps)
    {
        return open(steps);
    }

    private List<String> problems(CourseVariant variant)
    {
        return variant.problems("c", lines, Map.of());
    }

    /** Start line across the origin; a track running up the axis 1000 to 1200 m north. */
    private HandicapTest hairpin()
    {
        return line("start", -50, 0, 50, 0).line("top", 0, 1200, 0, 1000);
    }

    @Test
    public void aHairpinTakesTheTcfsItsTrackCanReach()
    {
        // The 1.000 boat rounds 1100 m up, so the course is 2200 m — 2198 on the sphere — and
        // the near end takes 200 m off it and the far end adds 200 m: 0.90901 to 1.09099,
        // rounded INWARD to the third place so every TCF the range admits can be placed.
        CourseVariant variant = hairpin().variant(step("start"), handicapped("top", 60), step("start"));
        assertThat(problems(variant), is(empty()));
        Handicap.Plan plan = Handicap.plan(variant, lines, Map.of());
        assertThat(plan.range().tcfMin(), closeTo(0.910, 1e-9));
        assertThat(plan.range().tcfMax(), closeTo(1.090, 1e-9));
        // The starboard end is the one nearer the start, as drawn.
        assertThat(plan.near()[1], is("starboard"));
        assertThat(plan.near()[0], is(nullValue()));
    }

    @Test
    public void theSnapshotCarriesTheTrackAndTheRange()
    {
        CourseVariant variant = hairpin().variant(step("start"), handicapped("top", 60), step("start"));
        CourseSnapshot snapshot = snapshot(variant);
        assertThat(snapshot.steps().get(1).handicapWidthM(), is(60.0));
        assertThat(snapshot.steps().get(1).handicapNear(), is("starboard"));
        assertThat(snapshot.steps().get(0).handicapWidthM(), is(nullValue()));
        assertThat(snapshot.tcfMin(), closeTo(0.910, 1e-9));

        // Width is geometry: it changes what a boat must cross, so it changes the revision.
        CourseVariant wider = open(step("start"), handicapped("top", 80), step("start"));
        assertThat(snapshot(wider).revision(), not(is(snapshot.revision())));
    }

    @Test
    public void aCourseNobodyHandicappedCarriesNoHandicap()
    {
        CourseSnapshot plain = snapshot(hairpin().variant(step("start"), step("top"), step("start")));
        assertThat(plain.tcfMin(), is(nullValue()));
        assertThat(plain.steps().get(1).handicapWidthM(), is(nullValue()));
        assertThat(plain.steps().get(1).handicapNear(), is(nullValue()));
    }

    @Test
    public void aStartOrFinishLineCannotBeHandicappedAnywhereInTheCourse()
    {
        // The start line is also rounded in the middle here, and one line has one width.
        line("start", -50, 0, 50, 0).line("top", 0, 1200, 0, 1000);
        CourseVariant variant = open(step("start"), step("top"), handicapped("start", 60),
            step("top"), step("start"));
        assertThat(problems(variant), hasItem(containsString("start or finish line cannot be handicapped")));
    }

    @Test
    public void aTrackMustStopAtBothEnds()
    {
        hairpin();
        lines.put("top", new Line("top", null, at(0, 1200, true), at(0, 1000, false), null));
        CourseVariant variant = open(step("start"), handicapped("top", 60), step("start"));
        assertThat(problems(variant), hasItem(containsString("must stop at both ends")));
    }

    @Test
    public void aGentleTurnIsRefused()
    {
        // Start to the south-west, finish due east, the track at the corner between them and
        // drawn out along the bisector: the legs either side are 135° apart, which is more a
        // passage than a turn.
        line("start", -1050, -1000, -950, -1000).line("finish", 1000, -50, 1000, 50)
            .line("mid", -40, 100, 40, -100);
        CourseVariant variant = open(step("start"), handicapped("mid", 60), step("finish"));
        assertThat(problems(variant), hasItem(containsString("90° apart or less")));
    }

    @Test
    public void aTrackThatShortensALegIsRefused()
    {
        // Drawn nearly across the axis, so sliding it from its near end towards the far one
        // brings it closer to the start before taking it further away.
        line("start", -50, 0, 50, 0).line("top", -200, 1100, 100, 1110);
        CourseVariant variant = open(step("start"), handicapped("top", 60), step("start"));
        assertThat(problems(variant), hasItem(containsString("gets shorter as the handicap line")));
    }

    @Test
    public void oneLineHasOneWidth()
    {
        // A windward/leeward twice round: the windward track is passed twice.
        line("start", -50, 0, 50, 0).line("top", 0, 1200, 0, 1000).line("bottom", 0, 300, 0, 200);
        CourseVariant same = open(step("start"), handicapped("top", 60), step("bottom"),
            handicapped("top", 60), step("start"));
        assertThat(problems(same), is(empty()));
        CourseVariant differ = open(step("start"), handicapped("top", 60), step("bottom"),
            handicapped("top", 80), step("start"));
        assertThat(problems(differ), hasItem(containsString("one line has one width")));
    }

    @Test
    public void aHandicappedLegCannotHaveAFixedLength()
    {
        hairpin();
        CourseVariant variant = open(step("start"), handicapped("top", 60),
            new CourseStep("start", Direction.FORWARD, null, 1.2, false, null));
        assertThat(problems(variant), hasItem(containsString("cannot have a fixed lengthNm")));
    }

    @Test
    public void aJoinOutsideTheRangeOrWithoutATcfIsRefused()
    {
        CourseSnapshot snapshot = snapshot(hairpin().variant(step("start"), handicapped("top", 60), step("start")));
        assertThat(Handicap.refusal(snapshot, null), containsString("needs your TCF"));
        assertThat(Handicap.refusal(snapshot, 1.2), containsString("outside it"));
        assertThat(Handicap.refusal(snapshot, 0.95), is(nullValue()));
        assertThat(Handicap.refusal(snapshot, snapshot.tcfMin()), is(nullValue()));

        CourseSnapshot plain = snapshot(open(step("start"), step("top"), step("start")));
        assertThat(Handicap.refusal(plain, null), is(nullValue()));
    }

    private CourseSnapshot snapshot(CourseVariant variant)
    {
        Map<String, CourseVariant> variants = new LinkedHashMap<>();
        variants.put(CourseVariant.MAIN, variant);
        Course course = new Course("c", "C", null, false, variants);
        Programme programme = new Programme("test.example", "fixture", null, null, null, null,
            Map.of(), lines, Map.of("c", course), null, null);
        return CourseSnapshot.of(programme, course, CourseVariant.MAIN);
    }
}
