package org.mortbay.sailing.unmarkable.course;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Locale;
import java.util.Map;

import org.mortbay.sailing.unmarkable.model.Course;
import org.mortbay.sailing.unmarkable.model.CourseStep;
import org.mortbay.sailing.unmarkable.model.Line;
import org.mortbay.sailing.unmarkable.model.LineEnd;
import org.mortbay.sailing.unmarkable.model.NamedPoint;

/**
 * Writes the {@code points:} block back into a programme file, leaving every other byte
 * of it alone.
 *
 * <h2>Why this is a splice and not a serialiser</h2>
 * The obvious implementation — deserialise the {@link org.mortbay.sailing.unmarkable.model.Programme},
 * mutate it, write it out through Jackson — is wrong here, and quietly so. <b>These files
 * are documentation.</b> They carry the explanation of what a port end is, why an infinite
 * end is a bearing rather than a place, and which crossing senses are unverified. A
 * round trip through an object model destroys all of it: comments are not data, so
 * nothing in the model holds them and nothing in the emitter can put them back. The first
 * autosave would silently strip the file down to its values, and nobody would notice
 * until they next went looking for the explanation.
 *
 * <p>So the file is edited as text. Find the {@code points:} block, replace exactly that,
 * and copy everything else through unchanged.
 *
 * <p>The one thing that <em>is</em> lost is a comment written <em>inside</em> the points
 * block, because the points themselves are regenerated. That is what a point's
 * {@code notes} field is for, and it survives, because it is data.
 */
public final class ProgrammeWriter
{
    private ProgrammeWriter()
    {
    }

    /**
     * Replace the {@code points:} block of {@code file} with {@code points}, atomically.
     *
     * <p>Written to a sibling {@code .tmp} and moved into place, for the same reason the
     * store does it: a crash or a full disk must not be able to leave a half-written
     * course file where a good one used to be. A course file is not as irreplaceable as a
     * race record, but it is the only copy of somebody's survey.
     */
    public static void writePoints(Path file, Map<String, NamedPoint> points) throws IOException
    {
        write(file, points, null, java.util.List.of());
    }

    /**
     * Replace the points, having first followed any renames through the rest of the file.
     *
     * <p>Order matters: the renames are applied to the original text, which still holds
     * the old ids, and the points block is then replaced wholesale by one already written
     * in the new names.
     */
    public static void writePoints(Path file, Map<String, NamedPoint> points,
        java.util.List<Rename> renames) throws IOException
    {
        write(file, points, null, renames);
    }

    /**
     * Rewrite whichever blocks are supplied, having first followed any renames through
     * the rest of the file. A null block is left alone entirely.
     *
     * <p>Points and lines are written together rather than one at a time because the
     * editor can change both at once: placing a line's end on open water creates a point
     * and attaches it in the same gesture, and saving half of that would leave the file
     * referring to a point that does not exist yet.
     *
     * <p>Order matters: renames go onto the original text, which still holds the old ids,
     * and the blocks are then replaced wholesale by ones already written in the new names.
     */
    public static void write(Path file, Map<String, NamedPoint> points,
        Map<String, Line> lines, java.util.List<Rename> renames) throws IOException
    {
        write(file, points, lines, null, renames);
    }

    public static void write(Path file, Map<String, NamedPoint> points,
        Map<String, Line> lines, Map<String, Course> courses,
        java.util.List<Rename> renames) throws IOException
    {
        String original = Files.readString(file, StandardCharsets.UTF_8);
        for (Rename rename : renames)
            original = renameReference(original, referenceKey(rename.kind()), rename.from(), rename.to());
        String updated = original;
        if (points != null)
            updated = splice(updated, "points", emit(points));
        if (lines != null)
            updated = splice(updated, "lines", emitLines(lines));
        if (courses != null)
            updated = splice(updated, "courses", emitCourses(courses));

        Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
        Files.writeString(tmp, updated, StandardCharsets.UTF_8);
        try
        {
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING,
                StandardCopyOption.ATOMIC_MOVE);
        }
        catch (java.nio.file.AtomicMoveNotSupportedException e)
        {
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    /**
     * Substitute {@code block} for the existing {@code points:} block in {@code yaml}.
     *
     * <p>The subtle part is where the block <em>ends</em>. A run of blank lines and
     * top-level comments before the next key introduces that key rather than trailing the
     * previous one — the banner comment explaining the lines section sits there — so it is
     * walked back over and left in place. Get this wrong and every autosave eats the
     * heading of whatever section follows.
     */
    static String splice(String yaml, String name, String block) throws IOException
    {
        String[] lines = yaml.split("\n", -1);

        int start = -1;
        for (int i = 0; i < lines.length; i++)
        {
            if (lines[i].startsWith(name + ":"))
            {
                start = i;
                break;
            }
        }
        if (start < 0)
            throw new IOException("no top-level '" + name + ":' block to replace");

        // The next top-level key, or the end of the file.
        int end = lines.length;
        for (int i = start + 1; i < lines.length; i++)
        {
            String line = lines[i];
            if (line.isBlank() || line.startsWith(" ") || line.startsWith("\t")
                || line.stripLeading().startsWith("#"))
                continue;
            end = i;
            break;
        }
        // Give back the blank lines and comments that belong to that next key.
        while (end > start + 1)
        {
            String previous = lines[end - 1];
            if (previous.isBlank() || previous.stripLeading().startsWith("#"))
                end--;
            else
                break;
        }

        StringBuilder out = new StringBuilder();
        for (int i = 0; i < start; i++)
            out.append(lines[i]).append('\n');
        out.append(block);
        for (int i = end; i < lines.length; i++)
        {
            out.append(lines[i]);
            if (i < lines.length - 1)
                out.append('\n');
        }
        return out.toString();
    }

    /**
     * Follow a point rename through the rest of the file.
     *
     * <p>A point's id is not a label — line ends name it with {@code at:} — so renaming
     * one in the points block alone would leave every line that used it pointing at a
     * point that no longer exists. The server would then report an unknown point, long
     * after anybody remembered doing it.
     *
     * <p>Done as a targeted text substitution rather than by regenerating the
     * {@code lines:} block, for the same reason the points block is spliced rather than
     * serialised: that block carries inline maps, folded notes and banner comments, and
     * an emitter would flatten all of them to rewrite one word.
     */
    static String renameReference(String yaml, String key, String from, String to)
    {
        // Only after the naming key, and only as a whole token, so renaming a point
        // called `shark` cannot rewrite `shark-south` or prose that mentions it.
        return yaml.replaceAll(
            "(?m)(\\b" + key + ":[ \\t]*)" + java.util.regex.Pattern.quote(from)
                + "(?=[ \\t]*(?:[,}#]|$))",
            "$1" + java.util.regex.Matcher.quoteReplacement(to));
    }

    /**
     * The key that refers to a thing of this kind from elsewhere in the file.
     *
     * <p>A point is named by a line end's {@code at:}; a line is named by a course step's
     * {@code line:}. Renaming either has to follow that key, or the reference is orphaned.
     */
    public static String referenceKey(String kind)
    {
        return "line".equals(kind) ? "line" : "at";
    }

    /** One id change to follow through the file. {@code kind} is {@code point} or {@code line}. */
    public record Rename(String kind, String from, String to)
    {
    }

    /**
     * The {@code lines:} block, in the house style.
     *
     * <p>Ends are written as inline maps, which is how they are written by hand: a line
     * end is two or three short values and putting each on its own row buries the shape of
     * the thing. As with points, a comment written <em>inside</em> this block does not
     * survive — that is what a line's {@code notes} field is for.
     */
    static String emitLines(Map<String, Line> lines)
    {
        StringBuilder out = new StringBuilder("lines:\n");
        lines.forEach((id, line) ->
        {
            out.append("  ").append(id).append(":\n");
            if (line.name() != null && !line.name().equals(id))
                out.append("    name: ").append(scalar(line.name())).append('\n');
            out.append("    port:      ").append(end(line.port())).append('\n');
            out.append("    starboard: ").append(end(line.starboard())).append('\n');
            notes(out, line.notes(), 4);
        });
        return out.toString();
    }

    /**
     * The {@code courses:} block.
     *
     * <p>A step is written as an inline map when it has no note, and in block form when
     * it does: a folded scalar cannot live inside {@code { }}, and a note squeezed into an
     * inline map as a quoted string is one comma away from breaking the file.
     *
     * <p>Nothing here writes a sequence letter or a role. Both are positional — the first
     * step is the start, the last is the finish — and storing them would let the letters
     * and the order disagree.
     */
    static String emitCourses(Map<String, Course> courses)
    {
        StringBuilder out = new StringBuilder("courses:\n");
        courses.forEach((id, course) ->
        {
            out.append("  ").append(id).append(":\n");
            if (course.name() != null && !course.name().equals(id))
                out.append("    name: ").append(scalar(course.name())).append('\n');
            // Only when true: a loop is the exception, and `closed: false` on every other
            // course is noise.
            if (course.closed())
                out.append("    closed: true\n");
            notes(out, course.notes(), 4);
            out.append("    sequence:\n");
            for (CourseStep step : course.sequence())
            {
                if (step.isGate())
                {
                    out.append("      - gate:\n");
                    for (CourseStep alternative : step.gate())
                        out.append("          - ").append(stepInline(alternative)).append('\n');
                    if (step.lengthNm() != null)
                        out.append("        lengthNm: ").append(trim(step.lengthNm())).append('\n');
                    if (step.entry())
                        out.append("        entry: true\n");
                    notes(out, step.notes(), 8);
                }
                else if (step.notes() != null && !step.notes().isBlank())
                {
                    out.append("      - line: ").append(step.line()).append('\n');
                    out.append("        cross: ").append(sense(step)).append('\n');
                    if (step.lengthNm() != null)
                        out.append("        lengthNm: ").append(trim(step.lengthNm())).append('\n');
                    if (step.entry())
                        out.append("        entry: true\n");
                    notes(out, step.notes(), 8);
                }
                else
                {
                    out.append("      - ").append(stepInline(step)).append('\n');
                }
            }
        });
        return out.toString();
    }

    private static String stepInline(CourseStep step)
    {
        StringBuilder out = new StringBuilder("{line: ").append(step.line())
            .append(", cross: ").append(sense(step));
        if (step.lengthNm() != null)
            out.append(", lengthNm: ").append(trim(step.lengthNm()));
        // Only when true, and only meaningful on a closed course: a boat may begin and end
        // a lap at this crossing.
        if (step.entry())
            out.append(", entry: true");
        return out.append('}').toString();
    }

    private static String sense(CourseStep step)
    {
        return step.cross() == null ? "forward" : step.cross().name().toLowerCase(Locale.ROOT);
    }

    /** A length without trailing zeros, so 1.5 stays 1.5 and 2.0 becomes 2. */
    private static String trim(double value)
    {
        String out = String.format(Locale.ROOT, "%.3f", value);
        return out.contains(".") ? out.replaceAll("0+$", "").replaceAll("\\.$", "") : out;
    }

    /** One line end: a named point where there is one, otherwise a bare position. */
    private static String end(LineEnd end)
    {
        if (end == null)
            return "{}";
        StringBuilder out = new StringBuilder("{");
        if (end.at() != null && !end.at().isBlank())
            out.append("at: ").append(end.at());
        else
            out.append("latitude: ").append(number(end.latitude()))
                .append(", longitude: ").append(number(end.longitude()));
        // Only written when true. An end is finite unless something says otherwise, and
        // `infinite: false` on every end is noise in a file people read.
        if (end.infinite())
            out.append(", infinite: true");
        return out.append('}').toString();
    }

    /** The {@code points:} block, in the house style. Always ends with a newline. */
    static String emit(Map<String, NamedPoint> points)
    {
        StringBuilder out = new StringBuilder("points:\n");
        points.forEach((id, point) ->
        {
            out.append("  ").append(id).append(":\n");
            if (point.name() != null && !point.name().equals(id))
                out.append("    name: ").append(scalar(point.name())).append('\n');
            out.append("    latitude: ").append(number(point.latitude())).append('\n');
            out.append("    longitude: ").append(number(point.longitude())).append('\n');
            notes(out, point.notes(), 4);
        });
        return out.toString();
    }

    /**
     * A {@code notes:} value as a wrapped folded scalar.
     *
     * <p>A folded scalar takes arbitrary text without quoting rules and ends only on a
     * dedent, so a note may say whatever it likes. It also <em>joins its lines with
     * spaces</em> when read, which is the detail that matters here: a note written across
     * three wrapped lines comes back as one long string, and writing that straight out
     * again would put a two-hundred-column line into a file people read and diff. So it is
     * re-wrapped on the way out.
     *
     * <p>Wrapping is by words and never mid-word, so the round trip is lossless: fold,
     * unfold and fold again gives the same text, even if not the same line breaks as
     * whoever typed it first.
     */
    static void notes(StringBuilder out, String notes, int indent)
    {
        if (notes == null || notes.isBlank())
            return;
        String pad = " ".repeat(indent);
        String body = " ".repeat(indent + 2);
        out.append(pad).append("notes: >\n");
        for (String paragraph : notes.strip().split("\n"))
        {
            String text = paragraph.strip();
            if (text.isEmpty())
            {
                // A blank line is a paragraph break in a folded scalar, so it is kept.
                out.append('\n');
                continue;
            }
            StringBuilder row = new StringBuilder();
            for (String word : text.split("\\s+"))
            {
                if (row.length() > 0 && body.length() + row.length() + 1 + word.length() > WRAP)
                {
                    out.append(body).append(row).append('\n');
                    row.setLength(0);
                }
                if (row.length() > 0)
                    row.append(' ');
                row.append(word);
            }
            if (row.length() > 0)
                out.append(body).append(row).append('\n');
        }
    }

    /** Where a folded note wraps. */
    static final int WRAP = 92;

    /**
     * Six decimal places, or {@code null}.
     *
     * <p>Six places is about 0.1 m, which is finer than the system's one-metre resolution
     * and therefore loses nothing. Writing the full double instead would put seventeen
     * digits in a file a person reads and claim a precision nobody has.
     */
    static String number(Double value)
    {
        return value == null ? "null" : String.format(Locale.ROOT, "%.6f", value);
    }

    /** Quote only when the value would otherwise not survive the YAML round trip. */
    static String scalar(String value)
    {
        String trimmed = value.strip();
        boolean safe = !trimmed.isEmpty()
            && trimmed.equals(value)
            && trimmed.indexOf(':') < 0
            && trimmed.indexOf('#') < 0
            && "-?:,[]{}#&*!|>'\"%@`".indexOf(trimmed.charAt(0)) < 0;
        return safe ? trimmed : '"' + value.replace("\\", "\\\\").replace("\"", "\\\"") + '"';
    }
}
