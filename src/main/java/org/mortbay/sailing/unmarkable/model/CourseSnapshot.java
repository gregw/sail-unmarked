package org.mortbay.sailing.unmarkable.model;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * A course as one boat actually sailed it: every line resolved to coordinates, every
 * crossing to a sense, with a revision that identifies exactly this geometry.
 *
 * <h2>Why a snapshot exists at all</h2>
 * Courses are edited live. A boat practising on Tuesday and a boat racing on Thursday can
 * sail different geometry under the same course id, and a record naming only that id would
 * be comparing two different courses without saying so. So a boat does not race "the
 * Manly Cove circuit" — it races <em>revision a3f19c of</em> the Manly Cove circuit, and
 * its record says which.
 *
 * <h2>What the revision covers, and what it does not</h2>
 * The hash is over the GEOMETRY AND THE ORDER — the resolved positions, the infinite
 * flags, the crossing senses, the entry marks, whether the course closes. It is not over
 * names or notes: renaming a mark changes nothing about where a boat had to sail, and
 * bumping the revision for it would split one course into two that cannot be compared.
 *
 * <p>The snapshot itself keeps the names and notes anyway, because it is also what gets
 * shown when somebody asks what a boat sailed months later.
 *
 * <h2>Always inlined, immediately</h2>
 * Every named reference is resolved to coordinates when the snapshot is taken, and the
 * snapshot keeps no names. Lazy inlining — keeping the names so that moving a shared mark
 * could be seen to affect published courses — was seriously considered and rejected on two
 * counts that reinforce each other. <b>The revision is a hash over resolved coordinates</b>,
 * so a snapshot that resolved names later would have an identifier that could silently stop
 * describing its own contents; and <b>the variant a snapshot was taken from remains</b>,
 * still holding its named references, so the impact question is answered there, where the
 * answer is current, rather than here, where it would be a question about the past.
 *
 * <p>What follows is the safety property the whole lifecycle is arranged around: editing
 * named geometry can never modify a snapshot, and therefore never changes anything a boat
 * has already been handed. A published course changes only when somebody publishes.
 */
public record CourseSnapshot(
    @JsonProperty("revision") String revision,
    @JsonProperty("club") String club,
    @JsonProperty("series") String series,
    @JsonProperty("course") String course,
    @JsonProperty("variant") String variant,
    @JsonProperty("label") String label,
    @JsonProperty("name") String name,
    @JsonProperty("closed") boolean closed,
    @JsonProperty("steps") List<Step> steps,
    @JsonProperty("lengthNm") Double lengthNm,
    @JsonProperty("defaults") Programme.Detection defaults,
    @JsonProperty("archivedAt") Instant archivedAt)
{
    public CourseSnapshot
    {
        steps = (steps == null) ? List.of() : List.copyOf(steps);
        if (variant == null || variant.isBlank())
            variant = CourseVariant.MAIN;
    }

    /** One step: its drawn letter, whether a lap may begin here, and what must be crossed. */
    public record Step(
        @JsonProperty("letter") String letter,
        @JsonProperty("entry") boolean entry,
        @JsonProperty("legNm") Double legNm,
        @JsonProperty("crossings") List<Crossing> crossings)
    {
        public Step
        {
            crossings = (crossings == null) ? List.of() : List.copyOf(crossings);
        }
    }

    /** One line to cross, resolved. More than one on a step means a gate. */
    public record Crossing(
        @JsonProperty("line") String line,
        @JsonProperty("cross") Direction cross,
        @JsonProperty("port") End port,
        @JsonProperty("starboard") End starboard)
    {
    }

    /** An end, as a place and whether the line runs on past it. */
    public record End(
        @JsonProperty("latitude") Double latitude,
        @JsonProperty("longitude") Double longitude,
        @JsonProperty("infinite") boolean infinite)
    {
    }

    /**
     * Resolve one variant of one course, without archiving it.
     *
     * <p>The {@code revision} on what comes back is the hash of the geometry as it stands
     * right now, which is what makes the dirty test a comparison rather than a stored flag:
     * resolve the variant, hash it, and see whether it matches the latest snapshot. Nothing
     * is written, so this is also what the editor asks for on every read.
     *
     * <p>Resolved here rather than on the boat: a line end that names a point has to be
     * looked up, and doing that on the device would mean shipping the points too and
     * hoping both sides resolved them the same way.
     */
    public static CourseSnapshot of(Programme programme, Course course, String variantId)
    {
        CourseVariant variant = course.variant(variantId);
        if (variant == null)
            return null;
        Map<String, Line> lines = variant.resolveLines(programme.lines());
        Map<String, NamedPoint> points = variant.resolvePoints(programme.points());
        double[] legs = variant.legLengthsNm(programme.lines(), programme.points());

        List<Step> steps = new ArrayList<>();
        for (int i = 0; i < variant.sequence().size(); i++)
        {
            CourseStep step = variant.sequence().get(i);
            List<Crossing> crossings = new ArrayList<>();
            for (CourseStep alternative : step.alternatives())
            {
                Line line = lines.get(alternative.line());
                if (line == null)
                    continue;
                crossings.add(new Crossing(alternative.line(), alternative.cross(),
                    end(line.port(), points), end(line.starboard(), points)));
            }
            steps.add(new Step(variant.sequenceLetter(i), variant.closed() && step.entry(),
                Double.isNaN(legs[i]) ? null : legs[i], crossings));
        }

        double length = variant.lengthNm(programme.lines(), programme.points());
        CourseSnapshot unhashed = new CourseSnapshot(null, programme.club(), programme.series(),
            course.id(), variantId, null, course.name(), variant.closed(), steps,
            Double.isNaN(length) ? null : length, programme.defaults(), null);
        return unhashed.withRevision(unhashed.hash());
    }

    /**
     * The same snapshot, dated and labelled, ready to be archived.
     *
     * <p><b>The tool names it, never the user.</b> {@code course/variant/datetime} is
     * unambiguous, sorts, and cannot be typed as something else — and a namespace held
     * together by human naming discipline lasts about a season. A single-variant course
     * drops the empty middle segment rather than carrying a {@code main} nobody chose.
     */
    public CourseSnapshot taken(Instant at)
    {
        String stamp = at.truncatedTo(java.time.temporal.ChronoUnit.SECONDS).toString()
            .replace("Z", "");
        String named = CourseVariant.MAIN.equals(variant)
            ? course + "/" + stamp
            : course + "/" + variant + "/" + stamp;
        return new CourseSnapshot(revision, club, series, course, variant, named, name,
            closed, steps, lengthNm, defaults, at);
    }

    private static End end(LineEnd from, Map<String, NamedPoint> points)
    {
        Position at = Line.resolve(from, points);
        return new End(at == null ? null : at.latitude(), at == null ? null : at.longitude(),
            from != null && from.infinite());
    }

    private CourseSnapshot withRevision(String revision)
    {
        return new CourseSnapshot(revision, club, series, course, variant, label, name, closed,
            steps, lengthNm, defaults, archivedAt);
    }

    /**
     * Twelve hex characters over the geometry and the order.
     *
     * <p>Built from a canonical string rather than from serialised JSON, so the revision
     * cannot change because a field was added, reordered or renamed somewhere. Coordinates
     * go in at six decimal places, which is finer than the system's one-metre resolution
     * and therefore cannot make two identical courses hash differently.
     *
     * <p><b>The variant is deliberately not in it.</b> Two variants that came out
     * geometrically identical are the same race, and their times should be comparable;
     * hashing the variant in would split them into two ladders that nobody could compare,
     * for a difference that exists only in the editor.
     */
    public String hash()
    {
        StringBuilder canonical = new StringBuilder();
        canonical.append(club).append('|').append(series).append('|').append(course)
            .append('|').append(closed);
        for (Step step : steps)
        {
            canonical.append("|S").append(step.entry());
            for (Crossing crossing : step.crossings())
            {
                canonical.append("|C").append(crossing.line()).append(':').append(crossing.cross());
                for (End end : List.of(crossing.port(), crossing.starboard()))
                {
                    canonical.append(':')
                        .append(end.latitude() == null ? "?" : String.format(java.util.Locale.ROOT, "%.6f", end.latitude()))
                        .append(',')
                        .append(end.longitude() == null ? "?" : String.format(java.util.Locale.ROOT, "%.6f", end.longitude()))
                        .append(',').append(end.infinite());
                }
            }
        }
        try
        {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(canonical.toString().getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (int i = 0; i < 6; i++)
                hex.append(String.format("%02x", digest[i]));
            return hex.toString();
        }
        catch (NoSuchAlgorithmException e)
        {
            throw new IllegalStateException("SHA-256 is required by the platform", e);
        }
    }
}
