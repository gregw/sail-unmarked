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

    /** A handicap track: a line with a width, whose every step places each boat's own line. */
    private HandicapTest track(String id, double widthM, double pe, double pn, double se, double sn)
    {
        lines.put(id, new Line(id, null, at(pe, pn, false), at(se, sn, false), null, widthM));
        return this;
    }

    private static CourseStep step(String line)
    {
        return new CourseStep(line, Direction.FORWARD, null, null, false, null);
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

    /** Start line across the origin; a 60 m track running up the axis 1000 to 1200 m north. */
    private HandicapTest hairpin()
    {
        return line("start", -50, 0, 50, 0).track("top", 60, 0, 1200, 0, 1000);
    }

    @Test
    public void aHairpinTakesTheTcfsItsTrackCanReach()
    {
        // The 1.000 boat rounds 1100 m up, so the course is 2200 m — 2198 on the sphere — and
        // the near end takes 200 m off it and the far end adds 200 m: 0.90901 to 1.09099,
        // rounded INWARD to the third place so every TCF the range admits can be placed.
        CourseVariant variant = hairpin().variant(step("start"), step("top"), step("start"));
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
        CourseVariant variant = hairpin().variant(step("start"), step("top"), step("start"));
        CourseSnapshot snapshot = snapshot(variant);
        assertThat(snapshot.steps().get(1).handicapWidthM(), is(60.0));
        assertThat(snapshot.steps().get(1).handicapNear(), is("starboard"));
        assertThat(snapshot.steps().get(0).handicapWidthM(), is(nullValue()));
        assertThat(snapshot.tcfMin(), closeTo(0.910, 1e-9));

        // Width is geometry: it changes what a boat must cross, so it changes the revision.
        track("top", 80, 0, 1200, 0, 1000);
        CourseVariant wider = open(step("start"), step("top"), step("start"));
        assertThat(snapshot(wider).revision(), not(is(snapshot.revision())));
    }

    @Test
    public void aMidpointTcfCentresTheRangeOnIt()
    {
        // The same hairpin about 1.400: the track still stretches the course by ±200/2200, now of
        // 1.4, so an offshore fleet fits without the bottom of the range reaching towards zero.
        List<CourseStep> sequence = List.of(step("start"), step("top"), step("start"));
        hairpin();
        CourseVariant offshore = new CourseVariant("v", null, false, false, null, null, sequence, null, 1.4);
        assertThat(problems(offshore), is(empty()));
        Handicap.Plan plan = Handicap.plan(offshore, lines, Map.of());
        assertThat(plan.range().tcfMin(), closeTo(1.273, 1e-9));
        assertThat(plan.range().tcfMax(), closeTo(1.527, 1e-9));
        CourseSnapshot snapshot = snapshot(offshore);
        assertThat(snapshot.tcfMid(), is(1.4));
        // It moves every boat's line but the midpoint boat's, so it is in the revision.
        assertThat(snapshot.revision(), not(is(snapshot(open(step("start"), step("top"), step("start"))).revision())));
        // And a course at 1.000 says nothing, so it keeps the snapshot it always had.
        assertThat(snapshot(open(step("start"), step("top"), step("start"))).tcfMid(), is(nullValue()));
    }

    @Test
    public void aMidpointTcfMustBePositive()
    {
        hairpin();
        CourseVariant zero = new CourseVariant("v", null, false, false, null, null,
            List.of(step("start"), step("top"), step("start")), null, 0.0);
        assertThat(problems(zero), hasItem(containsString("midpoint TCF")));
    }

    @Test
    public void aCourseNobodyHandicappedCarriesNoHandicap()
    {
        line("start", -50, 0, 50, 0).line("top", 0, 1200, 0, 1000);
        CourseSnapshot plain = snapshot(open(step("start"), step("top"), step("start")));
        assertThat(plain.tcfMin(), is(nullValue()));
        assertThat(plain.steps().get(1).handicapWidthM(), is(nullValue()));
        assertThat(plain.steps().get(1).handicapNear(), is(nullValue()));
    }

    @Test
    public void aStartOrFinishLineCannotBeHandicappedAnywhereInTheCourse()
    {
        // A track is never crossed as itself, so it cannot be where anybody starts.
        track("start", 60, -50, 0, 50, 0).line("top", 0, 1200, 0, 1000);
        CourseVariant variant = open(step("start"), step("top"), step("start"),
            step("top"), step("start"));
        assertThat(problems(variant), hasItem(containsString("a start or finish must be a line crossed as itself")));
    }

    @Test
    public void aTrackMustStopAtBothEnds()
    {
        hairpin();
        lines.put("top", new Line("top", null, at(0, 1200, true), at(0, 1000, false), null, 60.0));
        CourseVariant variant = open(step("start"), step("top"), step("start"));
        assertThat(problems(variant), hasItem(containsString("must stop at both ends")));
    }

    @Test
    public void aGentleTurnIsRefused()
    {
        // Start to the south-west, finish due east, the track at the corner between them and
        // drawn out along the bisector: the legs either side are 135° apart, which is more a
        // passage than a turn.
        line("start", -1050, -1000, -950, -1000).line("finish", 1000, -50, 1000, 50)
            .track("mid", 60, -40, 100, 40, -100);
        CourseVariant variant = open(step("start"), step("mid"), step("finish"));
        assertThat(problems(variant), hasItem(containsString("90° apart or less")));
    }

    @Test
    public void aTrackThatShortensALegIsRefused()
    {
        // Drawn nearly across the axis, so sliding it from its near end towards the far one
        // brings it closer to the start before taking it further away.
        line("start", -50, 0, 50, 0).track("top", 60, -200, 1100, 100, 1110);
        CourseVariant variant = open(step("start"), step("top"), step("start"));
        assertThat(problems(variant), hasItem(containsString("gets shorter as the handicap line")));
    }

    @Test
    public void aTrackPassedTwiceIsHandicappedBothTimes()
    {
        // A windward/leeward twice round: the windward track is passed twice, and the width
        // being the line's, both passings have it without anybody having to say so.
        line("start", -50, 0, 50, 0).track("top", 60, 0, 1200, 0, 1000).line("bottom", 0, 300, 0, 200);
        CourseVariant twice = open(step("start"), step("top"), step("bottom"), step("top"), step("start"));
        assertThat(problems(twice), is(empty()));
        CourseSnapshot snapshot = snapshot(twice);
        assertThat(snapshot.steps().get(1).handicapWidthM(), is(60.0));
        assertThat(snapshot.steps().get(3).handicapWidthM(), is(60.0));
        assertThat(snapshot.steps().get(2).handicapWidthM(), is(nullValue()));
    }

    @Test
    public void aTrackCannotBeASideOfAGate()
    {
        line("start", -50, 0, 50, 0).track("top", 60, 0, 1200, 0, 1000).line("other", 100, 1200, 100, 1000);
        CourseStep gate = new CourseStep(null, null, List.of(step("top"), step("other")), null, false, null);
        assertThat(problems(open(step("start"), gate, step("start"))),
            hasItem(containsString("a handicap line can only be a step of its own")));
    }

    @Test
    public void aHandicappedLegCannotHaveAFixedLength()
    {
        hairpin();
        CourseVariant variant = open(step("start"), step("top"),
            new CourseStep("start", Direction.FORWARD, null, 1.2, false, null));
        assertThat(problems(variant), hasItem(containsString("cannot have a fixed lengthNm")));
    }

    @Test
    public void aJoinOutsideTheRangeOrWithoutATcfIsRefused()
    {
        CourseSnapshot snapshot = snapshot(hairpin().variant(step("start"), step("top"), step("start")));
        assertThat(Handicap.refusal(snapshot, null), containsString("needs your TCF"));
        assertThat(Handicap.refusal(snapshot, 1.2), containsString("outside it"));
        assertThat(Handicap.refusal(snapshot, 0.95), is(nullValue()));
        assertThat(Handicap.refusal(snapshot, snapshot.tcfMin()), is(nullValue()));

        // The same course with the track made a line crossed as itself: nothing to place, so no
        // TCF is asked for.
        line("top", 0, 1200, 0, 1000);
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
