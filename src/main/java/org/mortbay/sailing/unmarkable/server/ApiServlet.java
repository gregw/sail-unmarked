package org.mortbay.sailing.unmarkable.server;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.mortbay.sailing.unmarkable.config.UnmarkableConfig;
import org.mortbay.sailing.unmarkable.course.ProgrammeLibrary;
import org.mortbay.sailing.unmarkable.course.ProgrammeWriter;
import org.mortbay.sailing.unmarkable.model.Course;
import org.mortbay.sailing.unmarkable.model.Line;
import org.mortbay.sailing.unmarkable.model.NamedPoint;
import org.mortbay.sailing.unmarkable.model.Programme;
import org.mortbay.sailing.unmarkable.model.CourseRecord;
import org.mortbay.sailing.unmarkable.model.CourseSnapshot;
import org.mortbay.sailing.unmarkable.store.JsonStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The API boats and browsers talk to.
 *
 * <h2>Endpoints</h2>
 * <pre>
 *   GET  /api/config                                     version, site, store health
 *   GET  /api/programmes                                 every club/series, with problems
 *   GET  /api/programmes/{club}/{series}                 points, lines, courses, defaults
 *   GET  /api/programmes/{club}/{series}/courses/{id}    one course, with leg lengths
 *   PUT  /api/programmes/{club}/{series}                 the editor saves points and lines
 *
 *   POST /api/join/{club}/{series}/{course}              a boat takes a course to sail
 *   GET  /api/courses/{revision}                         the geometry somebody sailed
 *   POST /api/records                                    a boat posts what it did
 *   GET  /api/records/{club}/{course}/{date}             a day's runs at a course
 *   GET  /api/best/{club}/{course}                       record attempts, quickest first
 * </pre>
 *
 * <h2>The shape of this API is the architecture</h2>
 * Note what is absent. There is <b>no race</b>, no entrant list, no start sheet, no
 * scoring. This system publishes courses and collects what boats did on them; places,
 * OCS, corrected times and series scoring belong to the club's own software, which
 * already has rules for all of it.
 *
 * <p>There is also no endpoint that decides a crossing, none that a boat must call before
 * it can score a mark, and none that returns a boat its own elapsed time — the boat knows,
 * because it computed it. A boat joins a course before the start and caches it; it posts
 * what it did afterwards. Between those two moments the server can be switched off without
 * a boat on the water noticing.
 *
 * <p>Everything readable is readable by anybody. A club publishes its results, and results
 * only people with accounts can read are results nobody reads — the same judgement
 * sail-jinx makes.
 *
 * <p><b>The two writes have no authentication and that is a known hole.</b> The POST is
 * somebody's race result; the PUT rewrites a course file on disk. The PUT is at least
 * gated by {@code server.configWrites}, which the deployment can turn off; the POST is
 * not gated at all. Both need a login before this is reachable from anywhere but a desk
 * — sail-jinx has a working Jetty OpenID setup to copy. See CLAUDE.md.
 */
public class ApiServlet extends HttpServlet
{
    private static final Logger LOG = LoggerFactory.getLogger(ApiServlet.class);

    private static final JsonMapper MAPPER = JsonMapper.builder()
        .addModule(new JavaTimeModule())
        .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
        .enable(SerializationFeature.INDENT_OUTPUT)
        .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
        .build();

    private final UnmarkableConfig config;
    private final ProgrammeLibrary programmes;
    private final JsonStore store;
    private final String version;

    public ApiServlet(UnmarkableConfig config, ProgrammeLibrary programmes,
        JsonStore store, String version)
    {
        this.config = config;
        this.programmes = programmes;
        this.store = store;
        this.version = version;
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException
    {
        String[] path = split(req.getPathInfo());
        try
        {
            if (path.length == 1 && path[0].equals("config"))
            {
                send(resp, Map.of(
                    "version", version,
                    "site", config.site(),
                    "programmeErrors", programmes.loadErrors(),
                    "storeErrors", store.loadErrors()));
                return;
            }
            if (path.length == 1 && path[0].equals("programmes"))
            {
                send(resp, programmeIndex());
                return;
            }
            if (path.length == 3 && path[0].equals("programmes"))
            {
                Optional<Programme> programme = programmes.programme(path[1], path[2]);
                if (programme.isEmpty())
                {
                    resp.sendError(404, "No such programme");
                    return;
                }
                // The programme as it is on disk, plus what is DERIVED from it. Course
                // lengths are computed here rather than in the editor so that one rule
                // — midpoint to midpoint, overrides honoured — has one implementation.
                Map<String, Object> body =
                    MAPPER.convertValue(programme.get(), new TypeReference<LinkedHashMap<String, Object>>() {});
                body.put("lengths", lengths(programme.get()));
                body.put("problems", programme.get().problems());
                send(resp, body);
                return;
            }
            if (path.length == 5 && path[0].equals("programmes") && path[3].equals("courses"))
            {
                Optional<Programme> programme = programmes.programme(path[1], path[2]);
                Course course = programme.map(p -> p.courses().get(path[4])).orElse(null);
                if (course == null)
                {
                    resp.sendError(404, "No such course");
                    return;
                }
                send(resp, courseDetail(programme.get(), course));
                return;
            }
            if (path.length == 2 && path[0].equals("courses"))
            {
                // The geometry somebody sailed, by revision. A record names one of these,
                // and the course it came from may have been edited a dozen times since.
                CourseSnapshot archived = store.course(path[1]).orElse(null);
                if (archived == null)
                {
                    resp.sendError(404, "No such course revision");
                    return;
                }
                send(resp, archived);
                return;
            }
            if (path.length == 4 && path[0].equals("records"))
            {
                List<CourseRecord> day = store.day(path[1], path[2], java.time.LocalDate.parse(path[3]));
                // Practice is kept for the boat and published to nobody, so it does not
                // appear in what a club reads.
                send(resp, day.stream().filter(r -> r.join().published()).toList());
                return;
            }
            if (path.length == 3 && path[0].equals("best"))
            {
                send(resp, store.best(path[1], path[2], req.getParameter("revision")));
                return;
            }
            resp.sendError(404);
        }
        catch (IllegalArgumentException e)
        {
            resp.sendError(400, e.getMessage());
        }
    }

    @Override
    protected void doPut(HttpServletRequest req, HttpServletResponse resp) throws IOException
    {
        String[] path = split(req.getPathInfo());
        if (path.length != 3 || !path[0].equals("programmes"))
        {
            resp.sendError(404);
            return;
        }
        if (!config.server().configWrites())
        {
            resp.sendError(403, "Config writes are disabled (server.configWrites)");
            return;
        }
        PointsUpdate update;
        try
        {
            update = MAPPER.readValue(req.getInputStream(), PointsUpdate.class);
        }
        catch (Exception e)
        {
            resp.sendError(400, "Unreadable points: " + e.getMessage());
            return;
        }
        try
        {
            programmes.save(path[1], path[2], update.points(), update.lines(), update.courses(), update.forWriter());
        }
        catch (IOException e)
        {
            // The programme is looked up rather than path-built, so an unknown club or
            // series lands here rather than writing a new file somewhere.
            resp.sendError(404, e.getMessage());
            return;
        }
        Programme saved = programmes.programme(path[1], path[2]).orElse(null);
        send(resp, Map.of(
            "saved", true,
            "points", saved == null ? 0 : saved.points().size(),
            "lines", saved == null ? 0 : saved.lines().size(),
            // Lengths come back from the server so there is one authority on the rule —
            // midpoint to midpoint, overrides honoured — rather than two that can drift.
            "lengths", saved == null ? Map.of() : lengths(saved),
            // Returned rather than merely logged: the editor can then show a course that
            // no longer makes sense the moment it stops making sense, which is the point
            // of editing against a chart at all.
            "problems", saved == null ? List.of() : saved.problems()));
    }

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp) throws IOException
    {
        String[] path = split(req.getPathInfo());
        if (path.length == 4 && path[0].equals("join"))
        {
            join(resp, path[1], path[2], path[3]);
            return;
        }
        if (path.length != 1 || !path[0].equals("records"))
        {
            resp.sendError(404);
            return;
        }
        CourseRecord record;
        try
        {
            record = MAPPER.readValue(req.getInputStream(), CourseRecord.class);
        }
        catch (Exception e)
        {
            resp.sendError(400, "Unreadable record: " + e.getMessage());
            return;
        }
        List<String> complaints = complaints(record);
        if (!complaints.isEmpty())
        {
            resp.sendError(400, String.join("; ", complaints));
            return;
        }
        try
        {
            store.save(record);
        }
        catch (IllegalArgumentException e)
        {
            resp.sendError(400, e.getMessage());
            return;
        }
        LOG.info("Record from {} ({}) on {}/{} rev {} [{}] — {} crossing(s), {} fix(es)",
            record.boatName(), record.sailNumber(), record.club(), record.course(),
            record.courseRevision(), record.join(), record.crossings().size(), record.fixes().size());
        send(resp, Map.of(
            "stored", true,
            "published", record.join().published(),
            "ranked", record.ranked(),
            "auditable", record.auditable(),
            "crossings", record.crossings().size()));
    }

    /**
     * What a record must carry to be filed at all.
     *
     * <p>Deliberately thin, and it checks identity rather than plausibility. The server
     * has no standing to reject a boat's account of its own race — it did not see the
     * race, and the boat did. What it can insist on is knowing where to file the thing and
     * who it belongs to, and refusing a record it cannot place is better than inventing a
     * location for it.
     */
    /**
     * A boat takes a course to sail.
     *
     * <p>This is the one write a boat makes before the start, and it exists so that the
     * geometry it sailed can still be read afterwards: the snapshot is ARCHIVED under its
     * revision here, not when the course is edited. Nothing is kept for a design nobody
     * took, which is most of what an editing session produces.
     *
     * <p>Nothing about the boat is recorded by joining. Who sailed, and why, arrives with
     * the record afterwards — a boat that joins and never sails leaves no trace beyond a
     * design that was worth keeping anyway.
     */
    private void join(HttpServletResponse resp, String club, String series, String courseId)
        throws IOException
    {
        Programme programme = programmes.programme(club, series).orElse(null);
        Course course = programme == null ? null : programme.courses().get(courseId);
        if (course == null)
        {
            resp.sendError(404, "No such course");
            return;
        }
        CourseSnapshot snapshot = CourseSnapshot.of(programme, course);
        store.archive(snapshot);
        send(resp, snapshot);
    }

    private List<String> complaints(CourseRecord record)
    {
        List<String> complaints = new ArrayList<>();
        if (record.club() == null || record.club().isBlank())
            complaints.add("no club");
        if (record.course() == null || record.course().isBlank())
            complaints.add("no course");
        if (record.boatId() == null || record.boatId().isBlank())
            complaints.add("no boatId");
        // Which GEOMETRY was sailed, not merely which course. Without it a record cannot
        // be compared with another, and cannot be read once the course has been edited.
        if (record.courseRevision() == null || record.courseRevision().isBlank())
            complaints.add("no courseRevision — join the course to get one");
        return complaints;
    }

    private List<Map<String, Object>> programmeIndex()
    {
        List<Map<String, Object>> index = new ArrayList<>();
        programmes.programmes().values().stream()
            .sorted(Comparator.comparing(Programme::club).thenComparing(Programme::series))
            .forEach(p ->
            {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("club", p.club());
                row.put("series", p.series());
                row.put("name", p.name());
                row.put("courses", p.courses().keySet());
                row.put("problems", p.problems());
                index.add(row);
            });
        return index;
    }

    /**
     * A course with what is derived from it rather than stored in it: the sequence letters
     * and the leg lengths. Derived here so that the file cannot disagree with itself and
     * every client shows the same figures.
     */
    private Map<String, Object> courseDetail(Programme programme, Course course)
    {
        double[] legs = course.legLengthsNm(programme.lines(), programme.points());
        List<Map<String, Object>> steps = new ArrayList<>();
        for (int i = 0; i < course.sequence().size(); i++)
        {
            Map<String, Object> step = new LinkedHashMap<>();
            step.put("letter", course.sequenceLetter(i));
            step.put("step", course.sequence().get(i));
            step.put("legNm", Double.isNaN(legs[i]) ? null : legs[i]);
            steps.add(step);
        }
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("course", course);
        detail.put("steps", steps);
        double length = course.lengthNm(programme.lines(), programme.points());
        detail.put("lengthNm", Double.isNaN(length) ? null : length);
        detail.put("defaults", programme.defaults());
        detail.put("problems", course.problems(programme.lines(), programme.points()));
        return detail;
    }

    /**
     * What the editor sends when it saves.
     *
     * <p>{@code renames} travels with the points because a point's id is not a label:
     * line ends refer to it, and the {@code lines:} block is text the server has to
     * follow the rename into. Sending the new points alone would leave those references
     * pointing at an id that no longer exists.
     */
    public record PointsUpdate(
        @JsonProperty("points") Map<String, NamedPoint> points,
        @JsonProperty("lines") Map<String, Line> lines,
        @JsonProperty("courses") Map<String, Course> courses,
        @JsonProperty("renames") List<Rename> renames)
    {
        public PointsUpdate
        {
            courses = (courses == null) ? null : new LinkedHashMap<>(courses);
            // Null means "leave that block alone", which is different from an empty map
            // meaning "this programme now has none". The editor sends both blocks when a
            // line edit created a point, and one when it did not.
            points = (points == null) ? null : new LinkedHashMap<>(points);
            lines = (lines == null) ? null : new LinkedHashMap<>(lines);
            renames = (renames == null) ? List.of() : List.copyOf(renames);
        }

        /** Named apart from the {@code renames} component, whose accessor this is not. */
        List<ProgrammeWriter.Rename> forWriter()
        {
            return renames.stream()
                .filter(r -> r.from() != null && r.to() != null && !r.from().equals(r.to()))
                .map(r -> new ProgrammeWriter.Rename(r.kind(), r.from(), r.to()))
                .toList();
        }

        /** {@code kind} decides which key the rename is followed through: point or line. */
        public record Rename(
            @JsonProperty("kind") String kind,
            @JsonProperty("from") String from,
            @JsonProperty("to") String to)
        {
        }
    }

    /** Every course's length in nautical miles, null where it cannot be measured. */
    private static Map<String, Object> lengths(Programme programme)
    {
        Map<String, Object> out = new LinkedHashMap<>();
        programme.courses().forEach((id, course) ->
        {
            double nm = course.lengthNm(programme.lines(), programme.points());
            out.put(id, Double.isNaN(nm) ? null : nm);
        });
        return out;
    }

    private static String[] split(String pathInfo)
    {
        if (pathInfo == null || pathInfo.isBlank() || pathInfo.equals("/"))
            return new String[0];
        return pathInfo.substring(1).split("/");
    }

    private void send(HttpServletResponse resp, Object value) throws IOException
    {
        resp.setContentType("application/json");
        resp.setCharacterEncoding(StandardCharsets.UTF_8.name());
        resp.getOutputStream().write(MAPPER.writeValueAsBytes(value));
    }
}
