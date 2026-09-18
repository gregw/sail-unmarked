package org.mortbay.sailing.unmarked.model;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.is;

/**
 * How a sequence is lettered, which is derived from position and never stored.
 *
 * <p>The rule lives twice — here and in {@code variantLetter} in {@code editor.js} — for the
 * same reason {@code RESOLUTION_M} does: the editor draws the letters and the server writes
 * them into its complaints, and the two must agree or a message names a mark nobody can find
 * on the chart in front of them.
 */
public class CourseVariantTest
{
    private static CourseVariant of(boolean closed, int steps)
    {
        // The lines need not exist: lettering is positional and looks at nothing else,
        // which is the property worth pinning.
        List<CourseStep> sequence = new java.util.ArrayList<>();
        for (int i = 0; i < steps; i++)
        {
            // A cycle's first step is marked as an entry point, which is what an author does:
            // a cycle with none cannot be joined and says so in `problems`. Everything else
            // here is about lettering and legs, so the flag is set where it costs nothing.
            boolean entry = closed && i == 0;
            sequence.add(new CourseStep("line-" + i, Direction.FORWARD, null, null, entry, null));
        }
        return new CourseVariant("v", null, false, closed, null, null, sequence, null);
    }

    private static List<String> letters(CourseVariant variant)
    {
        List<String> out = new java.util.ArrayList<>();
        for (int i = 0; i < variant.sequence().size(); i++)
            out.add(variant.sequenceLetter(i));
        return out;
    }

    @Test
    public void anOpenCourseStartsAndFinishes()
    {
        // The first step IS the start and the last IS the finish, positionally — there is no
        // role field, and there never should be, because a stored role can disagree with the
        // order somebody just dragged a step into.
        assertThat(letters(of(false, 5)), contains("S", "1", "2", "3", "F"));
    }

    @Test
    public void aCycleIsNumberedFromZero()
    {
        // A closed course has no start and no finish of its own — a boat begins and ends
        // wherever it joined — so S and F would claim something untrue about it.
        assertThat(letters(of(true, 5)), contains("0", "1", "2", "3", "4"));
    }

    @Test
    public void aCycleAndAnOpenCourseAgreeAboutWHICH_LEG_IS_LEG_ONE()
    {
        // The point of numbering from zero rather than one. A leg is named by the step it
        // runs INTO, so the first leg is "leg into <letter of step 1>" either way. Numbering
        // a cycle from one made that "leg 2", which is a different answer to the same
        // question depending only on a tickbox — and the first numbered mark is 1 in both.
        assertThat(of(true, 5).sequenceLetter(1), is(of(false, 5).sequenceLetter(1)));
        assertThat(of(true, 5).sequenceLetter(1), is("1"));
    }

    @Test
    public void tickingCycleRenamesOnlyTheFirstStep()
    {
        // S becomes 0 and nothing else moves, which is what makes the change safe to make on
        // a course somebody is already reading: every other mark keeps the number it had.
        List<String> open = letters(of(false, 4));
        List<String> closed = letters(of(true, 4));
        assertThat(open.subList(1, 3), is(closed.subList(1, 3)));
        assertThat(open.get(0) + " -> " + closed.get(0), is("S -> 0"));
        // Except the last, which stops being a finish because a cycle has none.
        assertThat(open.get(3) + " -> " + closed.get(3), is("F -> 3"));
    }

    /* --------------------------------------------------------- measuring the legs */

    /**
     * Four lines on the corners of a square about a tenth of a degree on a side.
     *
     * <p>Invented coordinates, stated as such — nothing in {@code data/} asserts a position,
     * and a test that needs one makes its own. Each line is a short east-west segment, so its
     * midpoint is the corner named.
     */
    private static Map<String, Line> square()
    {
        double[][] corner = {{-33.80, 151.20}, {-33.80, 151.30}, {-33.90, 151.30}, {-33.90, 151.20}};
        Map<String, Line> lines = new java.util.LinkedHashMap<>();
        for (int i = 0; i < corner.length; i++)
        {
            double lat = corner[i][0];
            double lon = corner[i][1];
            lines.put("line-" + i, new Line("line-" + i, null,
                new LineEnd(null, lat, lon - 0.001, false, null),
                new LineEnd(null, lat, lon + 0.001, false, null), null));
        }
        return lines;
    }

    @Test
    public void anOpenCourseHasNoLegIntoItsStart()
    {
        double[] legs = of(false, 4).legLengthsNm(square(), Map.of());
        assertThat("nothing runs into the start", Double.isNaN(legs[0]), is(true));
        for (int i = 1; i < 4; i++)
            assertThat("leg " + i + " measures", Double.isNaN(legs[i]), is(false));
    }

    @Test
    public void aCyclesClosingLegIsMeasuredAndCounted()
    {
        // The leg from the last mark back to the first is water a boat sails every lap, and
        // leaving it out made a lap measure short by one whole leg — a number people
        // navigate and handicap by. It is the leg INTO step 0, which is exactly what the
        // numbering says, and `coursedraw` has always drawn it.
        CourseVariant cycle = of(true, 4);
        double[] legs = cycle.legLengthsNm(square(), Map.of());
        assertThat("the closing leg measures", Double.isNaN(legs[0]), is(false));

        // Four equal-ish sides, so the total is four legs and not three.
        double open = 0;
        for (int i = 1; i < 4; i++)
            open += legs[i];
        assertThat(cycle.lengthNm(square(), Map.of()) > open, is(true));
        assertThat(cycle.lengthNm(square(), Map.of()), is(open + legs[0]));
    }

    @Test
    public void theClosingLegCanBeOverriddenLikeAnyOther()
    {
        // `lengthNm` on a step overrides the leg INTO that step. On a cycle step 0 has one,
        // so the same rule reaches the closing leg with no second mechanism.
        List<CourseStep> sequence = new java.util.ArrayList<>(of(true, 4).sequence());
        sequence.set(0, new CourseStep("line-0", Direction.FORWARD, null, 9.5, true, null));
        CourseVariant fixed = new CourseVariant("v", null, false, true, null, null, sequence, null);
        assertThat(fixed.legLengthsNm(square(), Map.of())[0], is(9.5));
    }

    @Test
    public void aCycleWrittenTheOpenCourseWayIsNotComplainedAbout()
    {
        // `A B C A` — the return spelled out rather than implied — makes a closing leg of
        // zero, which is redundant and not wrong: the loop is complete when it reaches the
        // repeat, so the length comes out the same either way. Complaining blocked the
        // snapshot of a course that was perfectly sailable.
        List<CourseStep> sequence = new java.util.ArrayList<>(of(true, 4).sequence());
        sequence.set(3, new CourseStep("line-0", Direction.FORWARD, null, null, false, null));
        CourseVariant spelt = new CourseVariant("v", null, false, true, null, null, sequence, null);

        assertThat(spelt.legLengthsNm(square(), Map.of())[0], is(0.0));
        assertThat(spelt.problems("course 'c'", square(), Map.of()), is(List.of()));
        // And it measures exactly what the same loop written without the repeat measures:
        // `A B C A` and `A B C` are the same water, and now come out as the same number.
        assertThat(spelt.lengthNm(square(), Map.of()),
            is(of(true, 3).lengthNm(square(), Map.of())));
    }

    @Test
    public void aZeroLegAnywhereELSEIsStillAnError()
    {
        // The check earns its keep in the middle of a sequence, where two steps sharing a
        // reference point is something no course means.
        List<CourseStep> sequence = new java.util.ArrayList<>(of(true, 4).sequence());
        sequence.set(2, new CourseStep("line-1", Direction.FORWARD, null, null, false, null));
        CourseVariant doubled = new CourseVariant("v", null, false, true, null, null, sequence, null);
        assertThat(doubled.problems("course 'c'", square(), Map.of()),
            org.hamcrest.Matchers.hasItem(
                "course 'c' leg into 2 measures zero; two steps share a reference point"));
    }

    @Test
    public void aCycleWithNoEntryPointCannotBeJoinedAndSaysSo()
    {
        // The only thing that says where a lap may BEGIN on a cycle is this flag — and because
        // the line that begins a lap is the line that ends it, with none set there is nothing
        // to start the clock on and nothing to finish against. Reported rather than thrown,
        // like every other problem, and enough to keep the variant out of a snapshot.
        List<CourseStep> sequence = new java.util.ArrayList<>();
        for (int i = 0; i < 3; i++)
            sequence.add(new CourseStep("line-" + i, Direction.FORWARD, null, null, false, null));
        CourseVariant nowhere = new CourseVariant("v", null, false, true, null, null, sequence, null);

        assertThat(nowhere.problems("course 'c'", square(), Map.of()),
            org.hamcrest.Matchers.hasItem("course 'c' is a cycle with no entry point:"
                + " mark at least one line a boat may begin and end a lap at"));

        // An OPEN course has a start and a finish by position, so the flag means nothing there
        // and its absence is not a problem.
        CourseVariant open = new CourseVariant("v", null, false, false, null, null, sequence, null);
        assertThat(open.problems("course 'c'", square(), Map.of()), is(List.of()));
    }

    @Test
    public void anUnmeasurableClosingLegIsReported()
    {
        // And it is reported under the name the chart draws, so the complaint names a mark
        // somebody can find: "leg into 0".
        CourseVariant cycle = of(true, 4);
        assertThat(cycle.problems("course 'c'", Map.of(), Map.of()),
            org.hamcrest.Matchers.hasItem(
                "course 'c' leg into 0 cannot be measured — supply lengthNm"));
    }
}
