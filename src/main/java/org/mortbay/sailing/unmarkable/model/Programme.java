package org.mortbay.sailing.unmarkable.model;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * One club's courses for one series, and everything they are built from: the points, the
 * lines over those points, and the courses over those lines.
 *
 * <p><b>One file, self-contained.</b> A programme names no other file and resolves nothing
 * from outside itself, so it can be read, diffed, mailed to another club and understood
 * on its own. The cost is that a mark several clubs race round is surveyed in each of
 * their files, and copies drift; the benefit is that nobody's course breaks because
 * somebody else edited a shared file, and there is no layering to reason about at two
 * minutes to a start.
 *
 * <p>Filed by club and series, because that is how courses are actually organised — a
 * club's whole summer, or one series inside a season. The club is identified by its
 * <b>domain</b>, following sail-jinx and sailing-pf, which key clubs the same way: a
 * domain is globally unique, readable, independent of any source system, and club names
 * are not unique nationally.
 *
 * <pre>
 *   data/config/clubs/myc.org.au/2026-summer.yaml
 *   data/config/clubs/myc.org.au/2026-winter-twilight.yaml
 * </pre>
 */
public record Programme(
    @JsonProperty("club") String club,
    @JsonProperty("series") String series,
    @JsonProperty("name") String name,
    @JsonProperty("datum") String datum,
    @JsonProperty("timezone") String timezone,
    @JsonProperty("defaults") Detection defaults,
    @JsonProperty("points") Map<String, NamedPoint> points,
    @JsonProperty("lines") Map<String, Line> lines,
    @JsonProperty("courses") Map<String, Course> courses,
    @JsonProperty("notes") String notes)
{
    public Programme
    {
        // Everything assumes WGS84 — it is what GNSS reports and what SignalK carries.
        // The field exists so a survey against something else has somewhere to say so and
        // can be refused loudly, rather than being quietly a hundred metres out.
        if (datum == null || datum.isBlank())
            datum = "WGS84";
        // Races are written as a date and a clock time, the way they are published, so
        // something has to say which clock. It belongs to the club rather than to each
        // race night: a club races in one place, and repeating the zone on every race is
        // how one of them ends up wrong after a daylight-saving change.
        if (timezone == null || timezone.isBlank())
            timezone = "Australia/Sydney";
        if (defaults == null)
            defaults = new Detection(0, null, null);
        java.time.ZoneId.of(timezone);   // fail loudly here rather than at race time
        points = keyById(points, NamedPoint::id, (p, id) ->
            new NamedPoint(id, p.name(), p.latitude(), p.longitude(), p.notes()));
        lines = keyById(lines, Line::id, (l, id) ->
            new Line(id, l.name(), l.port(), l.starboard(), l.notes()));
        courses = keyById(courses, Course::id, (c, id) ->
            new Course(id, c.name(), c.closed(), c.sequence(), c.notes()));
    }

    /**
     * The map key is the id. Each section is written as a map so that the id is stated
     * once, as the key, and cannot disagree with an {@code id:} field beside it. The id
     * is backfilled into the record here so the rest of the code can read it off the
     * object without carrying the key around.
     */
    private static <T> Map<String, T> keyById(Map<String, T> raw,
        java.util.function.Function<T, String> getId,
        java.util.function.BiFunction<T, String, T> withId)
    {
        if (raw == null)
            return Map.of();
        Map<String, T> byId = new LinkedHashMap<>();
        raw.forEach((key, value) ->
        {
            if (value == null)
                return;
            String id = getId.apply(value);
            byId.put(key, (id == null || id.isBlank()) ? withId.apply(value, key) : value);
        });
        return java.util.Collections.unmodifiableMap(byId);
    }

    /** Everything wrong with this file, as human-readable sentences; empty when it is sound. */
    @JsonIgnore
    public List<String> problems()
    {
        List<String> problems = new ArrayList<>();
        if (!"WGS84".equalsIgnoreCase(datum))
            problems.add("datum is '" + datum + "'; only WGS84 is supported");
        if (club == null || club.isBlank())
            problems.add("no club domain");

        points.forEach((id, point) ->
        {
            if (!point.surveyed())
                problems.add("point '" + id + "' has no position yet");
        });
        lines.forEach((id, line) ->
        {
            for (Map.Entry<String, LineEnd> e :
                Map.of("port", line.port(), "starboard", line.starboard()).entrySet())
            {
                LineEnd end = e.getValue();
                if (end == null || !end.located())
                {
                    problems.add("line '" + id + "' has no " + e.getKey() + " end");
                    continue;
                }
                if (end.at() != null && !points.containsKey(end.at()))
                    problems.add("line '" + id + "' " + e.getKey()
                        + " end names unknown point '" + end.at() + "'");
            }
        });
        courses.forEach((id, course) -> problems.addAll(course.problems(lines, points)));
        return problems;
    }

    /**
     * The detection tuning boats should use for this series.
     *
     * <p>It sits here rather than in the server config because these numbers are
     * properties of the <em>water</em> and the devices on it — how much multipath the rig
     * and the surrounding structures throw — and two clubs can honestly want different
     * ones. Every value is a default set against data that does not exist yet; they are
     * configuration precisely so they can be tuned against real logged tracks rather than
     * argued about.
     *
     * <p>{@code confirmFixes} is N in the 3-and-3 rule: N consecutive quality fixes on
     * the required side, a segment that cuts the line, then N on the far side. A single
     * flyer cannot produce N consecutive confirmed fixes on the far side, so it fails.
     * Sustained multipath could in principle produce consecutive bad ones, which argues
     * for a higher N or a harder kinematic gate — an open question.
     *
     * <p>{@code accuracyBandM} is the half-width of the band around a line inside which a
     * boat is resolved to <em>neither</em> side, which stops a boat sitting on the line
     * from emitting a burst of phantom crossings. Null means use each fix's own stated
     * accuracy: more honest, and it makes the effective line width vary with the sky.
     */
    public record Detection(
        @JsonProperty("confirmFixes") int confirmFixes,
        @JsonProperty("accuracyBandM") Double accuracyBandM,
        @JsonProperty("qc") Qc qc)
    {
        public Detection
        {
            if (confirmFixes <= 0)
                confirmFixes = 3;
            if (qc == null)
                qc = new Qc(0, 0, 0);
        }
    }

    /**
     * Fix quality control thresholds, layered outermost first.
     *
     * <p>{@code minSatellites} and {@code maxAccuracyM} are the receiver-metadata
     * pre-filter: necessary, and not sufficient, because a wrong fix sometimes still
     * reports an optimistic accuracy.
     *
     * <p>{@code maxSpeedKn} is the primary defence and the one that earns its keep. From
     * the last known-good position and time, a fix implying a ground speed no boat can
     * make is rejected. There is wide headroom between real boat motion and a genuine
     * flyer, so the gate has almost no false positives while catching the gross outliers
     * — the ones that would otherwise cut a line on the way out and again on the way
     * back, manufacturing a matched pair of crossings the boat never made.
     *
     * <p>Note what this is not: a smoother. A filter aggressive enough to reject outliers
     * also lags true position and biases the crossing instant, which is the one quantity
     * a score depends on. Reject cleanly, then interpolate across the good fixes.
     */
    public record Qc(
        @JsonProperty("minSatellites") int minSatellites,
        @JsonProperty("maxAccuracyM") double maxAccuracyM,
        @JsonProperty("maxSpeedKn") double maxSpeedKn)
    {
        public Qc
        {
            if (minSatellites <= 0)
                minSatellites = 4;
            if (maxAccuracyM <= 0)
                maxAccuracyM = 25.0;
            if (maxSpeedKn <= 0)
                maxSpeedKn = 40.0;
        }
    }
}
