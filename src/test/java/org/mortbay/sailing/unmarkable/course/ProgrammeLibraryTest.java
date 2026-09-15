package org.mortbay.sailing.unmarkable.course;

import java.nio.file.Path;
import java.nio.file.Paths;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mortbay.sailing.unmarkable.model.Course;
import org.mortbay.sailing.unmarkable.model.CourseVariant;
import org.mortbay.sailing.unmarkable.model.Line;
import org.mortbay.sailing.unmarkable.model.Position;
import org.mortbay.sailing.unmarkable.model.Programme;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.closeTo;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class ProgrammeLibraryTest
{
    private ProgrammeLibrary library;
    private Programme fixture;

    /**
     * The only variant of a course written flat. A course written with a bare sequence:
     * reads as one variant under `main`, which is what keeps a single-design club course
     * free of a nesting level it has no use for.
     */
    private CourseVariant main(String course)
    {
        return fixture.courses().get(course).variant(CourseVariant.MAIN);
    }

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
        CourseVariant course = main("up-and-back");
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
        double[] legs = main("up-and-back").legLengthsNm(fixture.lines(), fixture.points());
        assertTrue(Double.isNaN(legs[0]), "nothing precedes the start");
        assertThat(legs[1], closeTo(1.08, 0.01));
        assertThat(legs[2], closeTo(1.08, 0.01));
    }

    @Test
    public void courseLengthIsTheSumOfItsLegs()
    {
        assertThat(main("up-and-back").lengthNm(fixture.lines(), fixture.points()),
            closeTo(2.16, 0.02));
    }

    @Test
    public void aDeclaredLegLengthWins()
    {
        // lengthNm overrides the leg INTO the step that carries it, and only that one.
        double[] legs = main("overridden").legLengthsNm(fixture.lines(), fixture.points());
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

    /* --------------------------------------------------------- series CRUD */

    /** A disposable copy of the fixture tree, since these tests write. */
    private ProgrammeLibrary disposable(Path root) throws Exception
    {
        Path from = Paths.get("src/test/resources/testdata/config");
        try (java.util.stream.Stream<Path> walk = java.nio.file.Files.walk(from))
        {
            for (Path p : walk.toList())
            {
                Path to = root.resolve(from.relativize(p).toString());
                if (java.nio.file.Files.isDirectory(p))
                    java.nio.file.Files.createDirectories(to);
                else
                    java.nio.file.Files.copy(p, to);
            }
        }
        ProgrammeLibrary library = new ProgrammeLibrary(root);
        library.load();
        return library;
    }

    @Test
    public void aSeriesIsCreatedWithEveryBlockItWillNeed(@TempDir Path root) throws Exception
    {
        ProgrammeLibrary library = disposable(root);
        Programme made = library.create("test.example", "2027-summer", "Summer", null);
        assertThat(made.name(), is("Summer"));

        // splice() replaces a block and cannot create one, so a file without all three
        // could never be given a point, a line or a course.
        String yaml = java.nio.file.Files.readString(
            root.resolve("clubs/test.example/2027-summer.yaml"));
        assertThat(yaml, containsString("\npoints:"));
        assertThat(yaml, containsString("\nlines:"));
        assertThat(yaml, containsString("\ncourses:"));
        assertThat("and the explanation that makes these files documentation",
            yaml, containsString("BEARING, NOT A PLACE"));
    }

    @Test
    public void aCloneIsAByteCopySoTheCommentsSurvive(@TempDir Path root) throws Exception
    {
        ProgrammeLibrary library = disposable(root);
        library.create("test.example", "2027-winter", null, "test.example/fixture");

        String source = java.nio.file.Files.readString(root.resolve("clubs/test.example/fixture.yaml"));
        String clone = java.nio.file.Files.readString(root.resolve("clubs/test.example/2027-winter.yaml"));
        assertThat("byte for byte, because that is the whole point of cloning",
            clone, is(source));
        assertThat(library.programme("test.example", "2027-winter").orElseThrow()
            .courses().keySet(), hasItem("up-and-back"));
    }

    @Test
    public void aCloneWithANameRewritesOnlyThatLine(@TempDir Path root) throws Exception
    {
        ProgrammeLibrary library = disposable(root);
        library.create("test.example", "2027-winter", "Winter twilight", "test.example/fixture");
        String clone = java.nio.file.Files.readString(root.resolve("clubs/test.example/2027-winter.yaml"));
        assertThat(clone, containsString("name: Winter twilight"));
        assertThat("everything else is untouched", clone, containsString("up-and-back:"));
    }

    @Test
    public void anIdThatCouldEscapeTheTreeIsRefusedRatherThanReported(@TempDir Path root) throws Exception
    {
        ProgrammeLibrary library = disposable(root);
        // Creating is the one place an id becomes a NEW path, so it is the one place an id
        // is thrown for rather than complained about.
        for (String[] bad : new String[][] {
            {"../../etc", "x"}, {"test.example", "a/b"}, {"test.example", ".."},
            {"test.example", "has space"}, {"test.example", "Caps"}})
        {
            assertThrows(IllegalArgumentException.class,
                () -> library.create(bad[0], bad[1], null, null),
                bad[0] + "/" + bad[1] + " should be refused");
        }
    }

    @Test
    public void renamingASeriesMovesItsFileAndDeletingKeepsItsSnapshots(@TempDir Path root) throws Exception
    {
        ProgrammeLibrary library = disposable(root);
        library.rename("test.example", "fixture", "2027-summer");
        assertThat(library.programme("test.example", "fixture").isPresent(), is(false));
        assertThat(library.programme("test.example", "2027-summer").isPresent(), is(true));

        library.delete("test.example", "2027-summer");
        assertThat(library.programmes().keySet(), hasSize(0));
        assertThat("the file is gone",
            java.nio.file.Files.exists(root.resolve("clubs/test.example/2027-summer.yaml")), is(false));
    }

    @Test
    public void aRenameIsFollowedIntoTheLedgerOrEveryPublicationIsOrphaned(@TempDir Path root) throws Exception
    {
        // The series is embedded in the publication keys, so a file rename alone would
        // leave a club with courses that exist and nothing joinable.
        org.mortbay.sailing.unmarkable.store.CourseLedger ledger =
            new org.mortbay.sailing.unmarkable.store.CourseLedger(root);
        ledger.start();
        ledger.take("test.example", "fixture", "up-and-back", "main", "abc123abc123",
            "up-and-back/2027-01-01T00:00:00", java.time.Instant.now());
        ledger.publish("test.example", java.util.List.of(
            new org.mortbay.sailing.unmarkable.store.CourseLedger.Publication(
                "fixture", "up-and-back", "main", "abc123abc123")), java.util.List.of(),
            java.util.List.of());

        ledger.renameSeries("test.example", "fixture", "2027-summer");

        var after = ledger.read("test.example");
        assertThat(after.publishedRevision("2027-summer", "up-and-back", "main").orElse(null),
            is("abc123abc123"));
        assertThat("and the old key is gone",
            after.publishedRevision("fixture", "up-and-back", "main").isPresent(), is(false));
        assertThat("the snapshot entry moved with it",
            after.of("2027-summer", "up-and-back", "main"), hasSize(1));
    }
}
