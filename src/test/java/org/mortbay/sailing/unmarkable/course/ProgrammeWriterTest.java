package org.mortbay.sailing.unmarkable.course;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mortbay.sailing.unmarkable.model.Course;
import org.mortbay.sailing.unmarkable.model.CourseStep;
import org.mortbay.sailing.unmarkable.model.Direction;
import org.mortbay.sailing.unmarkable.model.Line;
import org.mortbay.sailing.unmarkable.model.LineEnd;
import org.mortbay.sailing.unmarkable.model.NamedPoint;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The splice is the dangerous part of autosave. A programme file is documentation as
 * much as data, and a writer that quietly ate the comments would not be noticed until
 * somebody went looking for the explanation of what a port end is. These tests exist to
 * make that failure loud.
 */
public class ProgrammeWriterTest
{
    /** A file shaped like the real ones: banner comments around each top-level block. */
    private static final String FILE = """
        # clubs/myc.org.au/2026-example.yaml
        # The path is the identity.

        name: Manly Cove circuit (example)
        datum: WGS84

        defaults:
          confirmFixes: 3

        # ---------------------------------------------------------------
        # Points. Surveyed once, referred to by id.
        # ---------------------------------------------------------------
        points:

          sow-and-pigs:
            name: Sow and Pigs reef
            latitude: null
            longitude: null
            notes: Shared fixed end.

        # ---------------------------------------------------------------
        # Lines. FORWARD leaves the port end to port.
        # ---------------------------------------------------------------
        lines:

          manly-cove:
            port:      { at: manly-cove-e }
            starboard: { at: manly-cove-w }

        courses:
          circuit:
            sequence:
              - { line: manly-cove, cross: forward }
        """;

    private static Map<String, NamedPoint> points()
    {
        Map<String, NamedPoint> points = new LinkedHashMap<>();
        points.put("sow-and-pigs",
            new NamedPoint("sow-and-pigs", "Sow and Pigs reef", -33.812345, 151.284321, "Shared fixed end."));
        points.put("shark-island",
            new NamedPoint("shark-island", null, null, null, null));
        return points;
    }

    @Test
    public void theCommentsAroundTheBlockSurvive() throws Exception
    {
        String out = ProgrammeWriter.splice(FILE, "points", ProgrammeWriter.emit(points()));

        assertThat("the file's own header", out, containsString("# The path is the identity."));
        assertThat("the banner introducing points", out, containsString("# Points. Surveyed once, referred to by id."));
        // The one that a naive end-of-block scan eats: a comment block sitting between
        // the last point and the next key belongs to the NEXT key.
        assertThat("the banner introducing lines", out, containsString("# Lines. FORWARD leaves the port end to port."));
    }

    @Test
    public void everyOtherBlockIsUntouched() throws Exception
    {
        String out = ProgrammeWriter.splice(FILE, "points", ProgrammeWriter.emit(points()));
        assertThat(out, containsString("name: Manly Cove circuit (example)"));
        assertThat(out, containsString("datum: WGS84"));
        assertThat(out, containsString("confirmFixes: 3"));
        assertThat(out, containsString("port:      { at: manly-cove-e }"));
        assertThat(out, containsString("- { line: manly-cove, cross: forward }"));
    }

    @Test
    public void thePointsThemselvesAreReplaced() throws Exception
    {
        String out = ProgrammeWriter.splice(FILE, "points", ProgrammeWriter.emit(points()));
        assertThat("the new position is written", out, containsString("latitude: -33.812345"));
        assertThat("a new point appears", out, containsString("shark-island:"));
        assertThat("the old null is gone", out, not(containsString("    latitude: null\n    longitude: null\n    notes: Shared")));
        assertThat("exactly one points block", out.split("(?m)^points:").length, is(2));
    }

    @Test
    public void anUnplacedPointStaysNull()
    {
        assertThat(ProgrammeWriter.emit(points()), containsString("  shark-island:\n    latitude: null\n    longitude: null\n"));
    }

    @Test
    public void coordinatesAreWrittenToSixPlaces()
    {
        Map<String, NamedPoint> one = new LinkedHashMap<>();
        one.put("p", new NamedPoint("p", null, -33.8123456789, 151.2843219999, null));
        String out = ProgrammeWriter.emit(one);
        // Six places is finer than the one-metre resolution, so nothing is lost; the
        // seventeen digits a raw double would print claim a precision nobody has.
        assertThat(out, containsString("latitude: -33.812346"));
        assertThat(out, containsString("longitude: 151.284322"));
    }

    @Test
    public void aNameThatWouldBreakYamlIsQuoted()
    {
        Map<String, NamedPoint> awkward = new LinkedHashMap<>();
        awkward.put("p", new NamedPoint("p", "Pin end: the west one", null, null, null));
        assertThat(ProgrammeWriter.emit(awkward), containsString("name: \"Pin end: the west one\""));

        Map<String, NamedPoint> ordinary = new LinkedHashMap<>();
        ordinary.put("p", new NamedPoint("p", "Sow and Pigs reef", null, null, null));
        assertThat(ProgrammeWriter.emit(ordinary), containsString("name: Sow and Pigs reef\n"));
    }

    @Test
    public void aNameEqualToTheIdIsNotWritten()
    {
        // The loader defaults name to the id, so writing it back would add a line to the
        // file on every save until somebody asked why.
        Map<String, NamedPoint> same = new LinkedHashMap<>();
        same.put("p", new NamedPoint("p", "p", null, null, null));
        assertThat(ProgrammeWriter.emit(same), not(containsString("name:")));
    }

    @Test
    public void notesBecomeAFoldedScalar()
    {
        Map<String, NamedPoint> noted = new LinkedHashMap<>();
        noted.put("p", new NamedPoint("p", null, null, null, "Sets the 090 bearing: nothing else.\nPlace it where the fleet crosses."));
        String out = ProgrammeWriter.emit(noted);
        assertThat("folded, so a note needs no quoting rules", out, containsString("    notes: >\n"));
        assertThat(out, containsString("      Sets the 090 bearing: nothing else.\n"));
        assertThat(out, containsString("      Place it where the fleet crosses.\n"));
    }

    @Test
    public void aFileWithoutAPointsBlockIsRefused()
    {
        // Refused rather than appended to: a file we do not understand is one to leave
        // alone, not one to guess at.
        assertThrows(java.io.IOException.class,
            () -> ProgrammeWriter.splice("name: nothing\nlines:\n  a: {}\n", "points", "points:\n"));
    }

    @Test
    public void aPointsBlockAtTheEndOfFileWorks() throws Exception
    {
        String out = ProgrammeWriter.splice("name: x\n\npoints:\n  old:\n    latitude: null\n",
            "points", ProgrammeWriter.emit(points()));
        assertThat(out, containsString("name: x"));
        assertThat(out, containsString("sow-and-pigs:"));
        assertThat(out, not(containsString("old:")));
    }

    @Test
    public void theWriteIsAtomicAndRoundTrips(@TempDir Path dir) throws Exception
    {
        Path file = dir.resolve("fixture.yaml");
        Files.writeString(file, FILE);
        ProgrammeWriter.writePoints(file, points());

        String out = Files.readString(file);
        assertThat(out, containsString("latitude: -33.812345"));
        assertThat(out, containsString("# Lines. FORWARD leaves the port end to port."));
        try (var stream = Files.list(dir))
        {
            assertTrue(stream.noneMatch(f -> f.getFileName().toString().endsWith(".tmp")),
                "the temporary file is moved into place, not left behind");
        }
    }

    @Test
    public void savingTwiceIsStable(@TempDir Path dir) throws Exception
    {
        // Idempotence matters more here than usual: the editor saves on every blur, so a
        // writer that drifted by a line per save would grow the file all afternoon.
        Path file = dir.resolve("fixture.yaml");
        Files.writeString(file, FILE);
        ProgrammeWriter.writePoints(file, points());
        String once = Files.readString(file);
        ProgrammeWriter.writePoints(file, points());
        assertThat(Files.readString(file), is(once));
    }

    @Test
    public void aRenameIsFollowedIntoTheLinesBlock() throws Exception
    {
        String out = ProgrammeWriter.renameReference(FILE, "at", "manly-cove-e", "cove-east");
        assertThat("the line end now names the new id", out, containsString("port:      { at: cove-east }"));
        assertThat("the other end is untouched", out, containsString("starboard: { at: manly-cove-w }"));
    }

    @Test
    public void aRenameDoesNotHitPartialMatches()
    {
        String yaml = """
            lines:
              a:
                port:      { at: shark }
                starboard: { at: shark-south, infinite: true }
              b:
                port: { at: shark }
            notes: the shark is not a point reference
            """;
        String out = ProgrammeWriter.renameReference(yaml, "at", "shark", "reef");

        assertThat("both whole-token uses are renamed", out, containsString("{ at: reef }"));
        assertThat("a longer id starting with it is NOT", out, containsString("{ at: shark-south, infinite: true }"));
        assertThat("prose mentioning it is NOT", out, containsString("the shark is not a point reference"));
        assertThat("every use was caught", out.split("at: reef").length, is(3));
    }

    @Test
    public void aRenameSurvivesTheWholeWrite(@TempDir Path dir) throws Exception
    {
        Path file = dir.resolve("fixture.yaml");
        Files.writeString(file, FILE);

        Map<String, NamedPoint> renamed = new LinkedHashMap<>();
        renamed.put("cove-east", new NamedPoint("cove-east", null, -33.8, 151.2, null));
        ProgrammeWriter.writePoints(file, renamed,
            java.util.List.of(new ProgrammeWriter.Rename("point", "manly-cove-e", "cove-east")));

        String out = Files.readString(file);
        assertThat("the point is written under its new id", out, containsString("  cove-east:"));
        assertThat("and the line that used it followed", out, containsString("port:      { at: cove-east }"));
        assertThat("the comments still survive", out, containsString("# Lines. FORWARD leaves the port end to port."));
    }

    private static Map<String, Line> lines()
    {
        Map<String, Line> lines = new LinkedHashMap<>();
        lines.put("manly-cove", new Line("manly-cove", "Manly Cove start/finish line",
            new LineEnd("manly-cove-e", null, null, false, null),
            new LineEnd("manly-cove-w", null, null, false, null),
            "Both ends on shore."));
        lines.put("sowpigs-east", new Line("sowpigs-east", null,
            new LineEnd("sow-and-pigs", null, null, false, null),
            new LineEnd("sowpigs-east-handle", null, null, true, null),
            null));
        return lines;
    }

    @Test
    public void aLineEndIsWrittenAsAnInlineMap()
    {
        String out = ProgrammeWriter.emitLines(lines());
        assertThat(out, containsString("    port:      {at: manly-cove-e}\n"));
        assertThat(out, containsString("    starboard: {at: manly-cove-w}\n"));
    }

    @Test
    public void onlyAnInfiniteEndSaysSo()
    {
        // An end is finite unless something says otherwise, so writing infinite: false on
        // every end would be noise in a file people read.
        String out = ProgrammeWriter.emitLines(lines());
        assertThat(out, containsString("{at: sowpigs-east-handle, infinite: true}"));
        assertThat(out, not(containsString("infinite: false")));
    }

    @Test
    public void anEndWithNoNamedPointCarriesItsOwnPosition()
    {
        Map<String, Line> inline = new LinkedHashMap<>();
        inline.put("l", new Line("l", null,
            new LineEnd(null, -33.812345, 151.284321, false, null),
            new LineEnd(null, -33.9, 151.3, true, null), null));
        String out = ProgrammeWriter.emitLines(inline);
        assertThat(out, containsString("{latitude: -33.812345, longitude: 151.284321}"));
        assertThat(out, containsString("{latitude: -33.900000, longitude: 151.300000, infinite: true}"));
    }

    @Test
    public void aLineRenameIsFollowedIntoTheCourses()
    {
        // Courses name lines with `line:`, exactly as line ends name points with `at:`.
        String out = ProgrammeWriter.renameReference(FILE, "line", "manly-cove", "cove-line");
        assertThat("the course step follows", out, containsString("- { line: cove-line, cross: forward }"));
        assertThat("the line's own key is left to the block emitter", out, containsString("  manly-cove:\n"));
    }

    @Test
    public void bothBlocksCanBeWrittenAtOnce(@TempDir Path dir) throws Exception
    {
        // Placing a line end on open water creates a point and attaches it in one gesture,
        // so saving half of that would leave the file naming a point that does not exist.
        Path file = dir.resolve("fixture.yaml");
        Files.writeString(file, FILE);
        ProgrammeWriter.write(file, points(), lines(), java.util.List.of());

        String out = Files.readString(file);
        assertThat(out, containsString("  shark-island:"));
        assertThat(out, containsString("{at: sowpigs-east-handle, infinite: true}"));
        assertThat("the banner between them survives", out,
            containsString("# Lines. FORWARD leaves the port end to port."));
        assertThat("and so does the block after them", out, containsString("courses:"));
    }

    @Test
    public void aNullBlockIsLeftAlone(@TempDir Path dir) throws Exception
    {
        Path file = dir.resolve("fixture.yaml");
        Files.writeString(file, FILE);
        ProgrammeWriter.write(file, points(), null, java.util.List.of());
        // Null means "do not touch", which is not the same as an empty map meaning
        // "this programme now has none".
        assertThat(Files.readString(file), containsString("port:      { at: manly-cove-e }"));
    }

    @Test
    public void writingBothBlocksTwiceIsStable(@TempDir Path dir) throws Exception
    {
        Path file = dir.resolve("fixture.yaml");
        Files.writeString(file, FILE);
        ProgrammeWriter.write(file, points(), lines(), java.util.List.of());
        String once = Files.readString(file);
        ProgrammeWriter.write(file, points(), lines(), java.util.List.of());
        assertThat(Files.readString(file), is(once));
    }

    @Test
    public void aLongNoteIsWrappedRatherThanRunOn()
    {
        // A folded scalar JOINS ITS LINES WITH SPACES when read, so a note written across
        // three wrapped rows comes back as one long string. Writing that straight out
        // again would put a two-hundred-column line into a file people read and diff.
        String long_ = "Runs 090/270 between two shore points, spanning the cove. Crossed southbound "
            + "to start and northbound to finish. Both ends on shore, so there is no near-end "
            + "crossing to dispute.";
        Map<String, NamedPoint> one = new LinkedHashMap<>();
        one.put("p", new NamedPoint("p", null, null, null, long_));
        String out = ProgrammeWriter.emit(one);

        for (String row : out.split("\n"))
            assertThat("no row runs away: " + row, row.length() <= 92, is(true));
        assertThat("it did wrap", out.split("\n").length > 4, is(true));
    }

    @Test
    public void wrappingNeverBreaksAWord()
    {
        Map<String, NamedPoint> one = new LinkedHashMap<>();
        one.put("p", new NamedPoint("p", null, null, null,
            "supercalifragilisticexpialidocious ".repeat(6)));
        String out = ProgrammeWriter.emit(one);
        for (String row : out.split("\n"))
        {
            String text = row.strip();
            if (text.startsWith("supercalifragilistic"))
                assertThat("words stay whole", text.matches("(supercalifragilisticexpialidocious ?)+"), is(true));
        }
    }

    @Test
    public void foldingIsLosslessThroughAWrap()
    {
        // fold -> unfold -> fold must give the same text back, which is what makes an
        // autosave that touches a file twice leave it alone the second time.
        String text = "One two three four five six seven eight nine ten eleven twelve thirteen "
            + "fourteen fifteen sixteen seventeen eighteen nineteen twenty.";
        Map<String, NamedPoint> one = new LinkedHashMap<>();
        one.put("p", new NamedPoint("p", null, null, null, text));

        String first = ProgrammeWriter.emit(one);
        // Read it back the way YAML would: rows joined with single spaces.
        StringBuilder joined = new StringBuilder();
        for (String row : first.split("\n"))
        {
            String r = row.strip();
            if (r.isEmpty() || r.endsWith(":") || r.startsWith("notes:") || r.contains("latitude") || r.contains("longitude")) continue;
            if (joined.length() > 0) joined.append(' ');
            joined.append(r);
        }
        Map<String, NamedPoint> again = new LinkedHashMap<>();
        again.put("p", new NamedPoint("p", null, null, null, joined.toString()));
        assertThat(ProgrammeWriter.emit(again), is(first));
    }

    private static Map<String, Course> courses()
    {
        Map<String, Course> courses = new LinkedHashMap<>();
        courses.put("two-lap", new Course("two-lap", "Two-lap windward/leeward", false,
            java.util.List.of(
                new CourseStep("leeward", Direction.FORWARD, null, null, false, null),
                new CourseStep(null, null, java.util.List.of(
                    new CourseStep("gate-left", Direction.FORWARD, null, null, false, null),
                    new CourseStep("gate-right", Direction.FORWARD, null, null, false, null)),
                    null, false, "Either side."),
                new CourseStep("leeward", Direction.REVERSE, null, null, false, "Finish. Northbound.")),
            "The base case."));
        return courses;
    }

    @Test
    public void aPlainStepIsInlineAndANotedOneIsNot()
    {
        String out = ProgrammeWriter.emitCourses(courses());
        assertThat("no note, so inline", out, containsString("      - {line: leeward, cross: forward}\n"));
        // A folded scalar cannot live inside { }, and a note squeezed in as a quoted
        // string is one comma away from breaking the file.
        assertThat("a note forces block form", out, containsString("      - line: leeward\n        cross: reverse\n        notes: >\n"));
        assertThat(out, containsString("          Finish. Northbound.\n"));
    }

    @Test
    public void aGateIsAListOfAlternatives()
    {
        String out = ProgrammeWriter.emitCourses(courses());
        assertThat(out, containsString("      - gate:\n"));
        assertThat(out, containsString("          - {line: gate-left, cross: forward}\n"));
        assertThat(out, containsString("          - {line: gate-right, cross: forward}\n"));
        assertThat("a gate may still carry a note", out, containsString("        notes: >\n          Either side.\n"));
    }

    @Test
    public void noLetterOrRoleIsEverWritten()
    {
        // Both are positional. Storing them would let the letters and the order disagree.
        String out = ProgrammeWriter.emitCourses(courses());
        assertThat(out, not(containsString("role:")));
        assertThat(out, not(containsString("seq:")));
    }

    @Test
    public void closedIsWrittenOnlyWhenTrue()
    {
        assertThat(ProgrammeWriter.emitCourses(courses()), not(containsString("closed:")));
        Map<String, Course> loop = new LinkedHashMap<>();
        loop.put("c", new Course("c", null, true,
            java.util.List.of(new CourseStep("a", Direction.FORWARD, null, null, false, null)), null));
        assertThat(ProgrammeWriter.emitCourses(loop), containsString("    closed: true\n"));
    }

    @Test
    public void allThreeBlocksSurviveTogether(@TempDir Path dir) throws Exception
    {
        Path file = dir.resolve("fixture.yaml");
        Files.writeString(file, FILE);
        ProgrammeWriter.write(file, points(), lines(), courses(), java.util.List.of());

        String out = Files.readString(file);
        assertThat(out, containsString("  shark-island:"));
        assertThat(out, containsString("{at: sowpigs-east-handle, infinite: true}"));
        assertThat(out, containsString("      - gate:"));
        assertThat("the banner between points and lines survives", out,
            containsString("# Lines. FORWARD leaves the port end to port."));
        assertThat("nothing after courses was eaten", out, containsString("datum: WGS84"));
    }

    @Test
    public void writingAllThreeTwiceIsStable(@TempDir Path dir) throws Exception
    {
        Path file = dir.resolve("fixture.yaml");
        Files.writeString(file, FILE);
        ProgrammeWriter.write(file, points(), lines(), courses(), java.util.List.of());
        String once = Files.readString(file);
        ProgrammeWriter.write(file, points(), lines(), courses(), java.util.List.of());
        assertThat(Files.readString(file), is(once));
    }
}
