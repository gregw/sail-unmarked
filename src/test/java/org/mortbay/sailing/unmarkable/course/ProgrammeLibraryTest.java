package org.mortbay.sailing.unmarkable.course;

import java.nio.file.Path;
import java.nio.file.Paths;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mortbay.sailing.unmarkable.model.Course;
import org.mortbay.sailing.unmarkable.model.Line;
import org.mortbay.sailing.unmarkable.model.Position;
import org.mortbay.sailing.unmarkable.model.Programme;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.closeTo;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class ProgrammeLibraryTest
{
    private ProgrammeLibrary library;
    private Programme fixture;

    @BeforeEach
    public void load() throws Exception
    {
        Path config = Paths.get("src/test/resources/testdata/config");
        library = new ProgrammeLibrary(config);
        library.load();
        fixture = library.programme("test.example", "fixture").orElseThrow();
    }

    @Test
    public void clubAndSeriesComeFromThePath()
    {
        // The path is the identity, so a file cannot disagree with where it is filed.
        assertThat(fixture.club(), is("test.example"));
        assertThat(fixture.series(), is("fixture"));
    }

    @Test
    public void idsAreBackfilledFromTheMapKeys()
    {
        // The id is stated once, as the key, so it cannot disagree with an id: field.
        assertThat(fixture.lines().get("leeward").id(), is("leeward"));
        assertThat(fixture.points().get("leeward-w").id(), is("leeward-w"));
        assertThat(fixture.courses().get("up-and-back").id(), is("up-and-back"));
    }

    @Test
    public void endsMayNameAPointOrCarryOneInline()
    {
        Line leeward = fixture.lines().get("leeward");
        Position port = Line.resolve(leeward.port(), fixture.points());
        assertThat(port, is(notNullValue()));
        assertThat(port.longitude(), closeTo(-0.005, 1e-9));
    }

    @Test
    public void sequenceLettersAreDerivedFromPosition()
    {
        // No roles are written down: the first step is the start and the last the finish.
        Course course = fixture.courses().get("up-and-back");
        assertThat(course.sequenceLetter(0), is("S"));
        assertThat(course.sequenceLetter(1), is("1"));
        assertThat(course.sequenceLetter(2), is("F"));
    }

    @Test
    public void aLineIsMeasuredToTheMidpointOfItsTwoPoints()
    {
        // Both fixture lines run symmetrically about longitude 0, so the midpoints sit
        // on the same meridian and the leg is the north-south separation: 0.018 degrees
        // of latitude, which is 0.018 * 60 = 1.08 nautical miles.
        double[] legs = fixture.courses().get("up-and-back")
            .legLengthsNm(fixture.lines(), fixture.points());
        assertTrue(Double.isNaN(legs[0]), "nothing precedes the start");
        assertThat(legs[1], closeTo(1.08, 0.01));
        assertThat(legs[2], closeTo(1.08, 0.01));
    }

    @Test
    public void courseLengthIsTheSumOfItsLegs()
    {
        assertThat(fixture.courses().get("up-and-back")
            .lengthNm(fixture.lines(), fixture.points()), closeTo(2.16, 0.02));
    }

    @Test
    public void aDeclaredLegLengthWins()
    {
        // lengthNm overrides the leg INTO the step that carries it, and only that one.
        double[] legs = fixture.courses().get("overridden")
            .legLengthsNm(fixture.lines(), fixture.points());
        assertThat(legs[1], is(5.0));
        assertThat(legs[2], closeTo(1.08, 0.01));
    }

    @Test
    public void anInfiniteEndStillContributesItsPointToTheMidpoint()
    {
        // The point on an infinite end sets a bearing and nothing else geometrically,
        // which is exactly what frees it to be the handle for where the line is
        // measured to. It must therefore still count towards the midpoint.
        Line half = fixture.lines().get("half-infinite");
        assertTrue(half.halfInfinite());
        assertThat(half.referencePoint(fixture.points()), is(notNullValue()));
    }

    @Test
    public void anUnknownLineIsReportedRatherThanThrown()
    {
        // A course with a typo must not stop the server, or take the other clubs'
        // racing down with it.
        assertThat(fixture.courses().get("broken").problems(fixture.lines(), fixture.points()),
            hasItem("course 'broken' step 1 names unknown line 'nowhere'"));
    }

    @Test
    public void everyProgrammeInTheTreeIsLoaded()
    {
        assertThat(library.programmes().keySet(), contains("test.example/fixture"));
        assertThat(library.loadErrors(), hasSize(0));
    }



    @Test
    public void unsurveyedPointsAreProblemsNotFailures()
    {
        // The shipped programmes carry no coordinates at all, and must still load.
        assertThat(fixture.problems().stream()
            .filter(p -> p.contains("has no position")).count(), is(0L));
    }

    @Test
    public void aMissingProgrammeIsEmptyNotAnError()
    {
        assertThat(library.programme("nobody.example", "nothing").orElse(null), is(nullValue()));
    }
}
