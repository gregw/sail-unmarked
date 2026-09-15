package org.mortbay.sailing.unmarkable.model;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * What a club publishes and a boat joins: a name, and one or more {@link CourseVariant}s.
 *
 * <h2>Public is a course-level decision, and a deliberate one</h2>
 * {@code public: true} is what puts a course on the front page and makes its published
 * snapshots visible to anybody who asks. It defaults to <b>false</b>, so a course is private
 * until somebody says otherwise — a club's file is full of half-built shapes and last
 * season's leftovers, and the safe default for "who can see this" is nobody.
 *
 * <p>It sits on the COURSE and not on a variant because a course is the thing a boat joins:
 * a variant is one design of one course, and publishing one while hiding another would offer
 * half a fleet a race. Nor is it on the series, which is a file, not an offer.
 *
 * <p>Public and published are independent and both are required for anything to be visible.
 * Public says "this course may be seen"; a publication says "this exact geometry is what
 * boats get". A public course with nothing published shows with nothing under it, which is
 * honest — it is a course nobody can join yet.
 *
 * <p><b>A course has no geometry of its own.</b> Everything sailable lives on a variant —
 * Div 1, Div 2, the short course — and a course with a single variant is the ordinary case
 * where nobody ever thinks about the word. See {@code wiki/course-lifecycle.html}.
 *
 * <h2>Two shapes in the file, one model in memory</h2>
 * A course with one plain variant is written flat, exactly as courses were written before
 * variants existed:
 *
 * <pre>
 *   manly-to-shark:
 *     name: Manly Cove to Shark Island
 *     sequence: [...]
 * </pre>
 *
 * and one with several writes the level out:
 *
 * <pre>
 *   saturday-pointscore:
 *     variants:
 *       div1: {sequence: [...]}
 *       div2: {sequence: [...]}
 * </pre>
 *
 * <p>The flat form reads as a single variant under {@link CourseVariant#MAIN} and is written
 * back the same way, so the level appears in a file only once it is being used for
 * something. That is worth the small asymmetry here: most club courses have exactly one
 * design, and making every one of them carry an empty layer of nesting would be a tax on
 * the common case to serve the rare one.
 */
public record Course(
    @JsonProperty("id") String id,
    @JsonProperty("name") String name,
    @JsonProperty("notes") String notes,
    @JsonProperty("public") boolean isPublic,
    @JsonProperty("variants") Map<String, CourseVariant> variants)
{
    public Course
    {
        if (name == null || name.isBlank())
            name = id;
        variants = (variants == null) ? Map.of() : java.util.Collections.unmodifiableMap(
            new LinkedHashMap<>(variants));
    }

    /**
     * Read a course in either shape.
     *
     * <p>An explicit creator rather than extra record components, so the flat fields exist
     * on the way in and nowhere else: a {@code closed} or {@code sequence} left hanging on
     * the record would be a second place for the truth to live, and the two would disagree
     * the first time somebody edited one variant of a two-variant course.
     */
    @JsonCreator
    static Course read(
        @JsonProperty("id") String id,
        @JsonProperty("name") String name,
        @JsonProperty("notes") String notes,
        @JsonProperty("public") boolean isPublic,
        @JsonProperty("template") boolean template,
        @JsonProperty("closed") boolean closed,
        @JsonProperty("points") Map<String, NamedPoint> points,
        @JsonProperty("lines") Map<String, Line> lines,
        @JsonProperty("sequence") List<CourseStep> sequence,
        @JsonProperty("variants") Map<String, CourseVariant> variants)
    {
        Map<String, CourseVariant> keyed = new LinkedHashMap<>();
        // A `variants:` key means the nested shape, WHATEVER it holds — an empty one is a
        // course with no design, which is an ordinary state: a course exists before its
        // first variant does, and its last variant can be deleted. Treating empty as "fold
        // the flat fields in" put a phantom `main` back on such a course the moment it was
        // read, which is what made deleting the last variant pointless.
        if (variants != null)
        {
            variants.forEach((key, variant) ->
            {
                if (variant == null)
                    return;
                // The map key is the id, stated once, so it cannot disagree with an `id:`
                // field beside it — the same rule the points, lines and courses maps follow.
                keyed.put(key, variant.id() == null || variant.id().isBlank()
                    ? new CourseVariant(key, variant.name(), variant.template(),
                        variant.closed(), variant.points(), variant.lines(),
                        variant.sequence(), variant.notes())
                    : variant);
            });
        }
        // The flat shape is recognised by HAVING a design, not by lacking a `variants:` key.
        else if (sequence != null || points != null || lines != null)
        {
            keyed.put(CourseVariant.MAIN, new CourseVariant(CourseVariant.MAIN, null,
                template, closed, points, lines, sequence, null));
        }
        return new Course(id, name, notes, isPublic, keyed);
    }

    /** The variant under {@code id}, or null. */
    public CourseVariant variant(String id)
    {
        return variants.get(id);
    }

    /** True when this course is written flat, and can be written back that way. */
    @JsonIgnore
    public boolean flat()
    {
        if (variants.size() != 1)
            return false;
        CourseVariant only = variants.get(CourseVariant.MAIN);
        return only != null && !only.template();
    }

    /** Complaints about every variant of this course; empty when they are all coherent. */
    public List<String> problems(Map<String, Line> lines, Map<String, NamedPoint> points)
    {
        List<String> problems = new ArrayList<>();
        if (variants.isEmpty())
            problems.add("course '" + id + "' has no variants");
        variants.forEach((variantId, variant) ->
        {
            String bad = Ids.problem("variant", variantId, Ids.PLAIN);
            if (bad != null)
                problems.add("course '" + id + "' " + bad);
            problems.addAll(variant.problems(where(variantId), lines, points));
        });
        return problems;
    }

    /** How a variant is named in a complaint, and in a snapshot's label. */
    public String where(String variantId)
    {
        return flat() ? "course '" + id + "'" : "course '" + id + "/" + variantId + "'";
    }
}
