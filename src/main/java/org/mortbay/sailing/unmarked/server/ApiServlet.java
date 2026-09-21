package org.mortbay.sailing.unmarked.server;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalLong;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.mortbay.sailing.unmarked.config.AuthConfig;
import org.mortbay.sailing.unmarked.config.UnmarkedConfig;
import org.mortbay.sailing.unmarked.course.ProgrammeLibrary;
import org.mortbay.sailing.unmarked.course.ProgrammeWriter;
import org.mortbay.sailing.unmarked.dialog.Dialog;
import org.mortbay.sailing.unmarked.dialog.Envelope;
import org.mortbay.sailing.unmarked.model.Course;
import org.mortbay.sailing.unmarked.model.CourseVariant;
import org.mortbay.sailing.unmarked.model.Line;
import org.mortbay.sailing.unmarked.model.NamedPoint;
import org.mortbay.sailing.unmarked.model.Programme;
import org.mortbay.sailing.unmarked.model.Race;
import org.mortbay.sailing.unmarked.model.CourseRecord;
import org.mortbay.sailing.unmarked.model.CourseSnapshot;
import org.mortbay.sailing.unmarked.store.CourseLedger;
import org.mortbay.sailing.unmarked.store.JsonStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The API boats and browsers talk to.
 *
 * <h2>Endpoints</h2>
 * <pre>
 *   GET  /api/config                                     version, site, store health
 *   GET  /api/programmes                                 every club/series, with problems
 *   GET  /api/templates                                  every template, wherever it lives
 *   GET  /api/public                                     public courses, and what each offers
 *   GET  /api/log                                        every change to that, newest first
 *   GET  /api/programmes/{club}/{series}                 points, lines, courses, defaults
 *   GET  /api/programmes/{club}/{series}/courses/{id}    every variant, with leg lengths
 *   PUT  /api/programmes/{club}/{series}                 the editor saves the whole programme
 *   POST /api/programmes                                 create a series, empty or cloned
 *   POST /api/programmes/{club}/{series}/rename          rename a series (ledger and all), or retitle it
 *   DEL  /api/programmes/{club}/{series}                 retire a series; snapshots stay
 *
 *   GET  /api/lifecycle/{club}/{series}                  every variant's state and snapshots
 *   POST /api/lifecycle/{club}/{series}/snapshots        capture one variant, immutably
 *   POST /api/lifecycle/{club}/{series}/publications     move pointers, all of them or none
 *   DEL  /api/lifecycle/{club}/{series}/snapshots/{rev}  forget one; its geometry is kept
 *
 *   POST /api/join/{club}/{series}/{course}              a boat takes a course to sail
 *   GET  /api/courses/{revision}                         the geometry somebody sailed
 *   POST /api/records                                    a boat posts what it did
 *   GET  /api/records/{club}/{course}/{date}             a day's runs at a course
 *   GET  /api/best/{club}/{course}                       record attempts, quickest first
 *
 *   GET  /api/results/{club}/{series}                    what there is to read: races, variants
 *   GET  /api/results/{club}/{series}/race/{race}        one race, as a finishing order
 *   GET  /api/results/{club}/{series}/variant/{c}/{v}    record attempts, by revision
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
 * <p><b>The officer's writes are behind a login; the boat's are deliberately not.</b> The
 * programme PUT rewrites a course file on disk and the publications POST decides what a whole
 * fleet is handed, so both need a signed-in officer ({@link UnmarkedSecurityHandler}) as well as
 * {@code server.configWrites}. The record POST stays open, because a boat's own account of its
 * race is trusted by construction and a login there would name a claim nothing can check. See
 * {@code wiki/deployment.md}.
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

    private final UnmarkedConfig config;
    private final ProgrammeLibrary programmes;
    private final JsonStore store;
    private final CourseLedger ledger;
    private final Dialog dialog;
    private final AuthConfig auth;
    private final String version;

    public ApiServlet(UnmarkedConfig config, ProgrammeLibrary programmes,
        JsonStore store, CourseLedger ledger, Dialog dialog, AuthConfig auth, String version)
    {
        this.auth = auth;
        this.config = config;
        this.programmes = programmes;
        this.store = store;
        this.ledger = ledger;
        this.dialog = dialog;
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
                // WHO IS SIGNED IN RIDES ON THE CONFIG a page already fetches, rather than on an
                // endpoint of its own: it is one more fact about this server as this browser
                // sees it, and a second round trip to learn a name nobody is deciding anything
                // from would be a second thing to keep in step.
                SignedIn who = SignedIn.of(req, auth);
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("version", version);
                body.put("site", config.site());
                // What a BOAT reads off this endpoint: how close its approach plot may zoom.
                // Served here rather than with the course, because it is a property of the
                // fleet's phones rather than of the club's water — and defaulted on the client,
                // since the Mark screen has to draw whether or not this server was ever reached.
                body.put("display", config.display());
                body.put("programmeErrors", programmes.loadErrors());
                body.put("storeErrors", store.loadErrors());
                body.put("auth", Map.of(
                    "required", auth != null && auth.enabled(),
                    "signedIn", who.isSignedIn(),
                    "email", who.email() == null ? "" : who.email(),
                    "name", who.name() == null ? "" : who.name(),
                    "logout", AuthFilter.LOGOUT_PATH));
                send(resp, body);
                return;
            }
            if (path.length == 1 && path[0].equals("programmes"))
            {
                send(resp, programmeIndex());
                return;
            }
            if (path.length == 1 && path[0].equals("templates"))
            {
                send(resp, templateIndex());
                return;
            }
            if (path.length == 1 && path[0].equals("public"))
            {
                send(resp, publicIndex());
                return;
            }
            if (path.length == 1 && path[0].equals("log"))
            {
                send(resp, publicLog(limit(req, 200)));
                return;
            }
            // WHAT IS HAPPENING IN ONE RACE: the fleet table, the channel, the start states and
            // the acknowledgement coverage. Read by the race screen, which is a laptop on a desk
            // polling a page — see Dialog.Room.conduct for why that is not the dialog itself.
            if (path.length == 4 && path[0].equals("conduct"))
            {
                Dialog.Room room = dialog.room(path[1], path[2], path[3]).orElse(null);
                if (room == null)
                {
                    resp.sendError(404, "No such race");
                    return;
                }
                send(resp, room.conduct());
                return;
            }
            if (path.length == 3 && path[0].equals("races"))
            {
                Programme programme = programmes.programme(path[1], path[2]).orElse(null);
                if (programme == null)
                {
                    resp.sendError(404, "No such programme");
                    return;
                }
                send(resp, programme.races());
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
            if (path.length == 3 && path[0].equals("lifecycle"))
            {
                Programme programme = programmes.programme(path[1], path[2]).orElse(null);
                if (programme == null)
                {
                    resp.sendError(404, "No such programme");
                    return;
                }
                send(resp, lifecycle(programme));
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
            if (path.length == 3 && path[0].equals("results"))
            {
                results(resp, path[1], path[2]);
                return;
            }
            if (path.length == 5 && path[0].equals("results") && path[3].equals("race"))
            {
                raceResults(resp, path[1], path[2], path[4]);
                return;
            }
            if (path.length == 6 && path[0].equals("results") && path[3].equals("variant"))
            {
                variantResults(resp, path[1], path[2], path[4], path[5]);
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
        // Which courses were public BEFORE this write, so the flip can be seen. Read here
        // rather than after: once saved, there is nothing left to compare against.
        Map<String, Boolean> wasPublic = programmes.programme(path[1], path[2])
            .map(p -> p.courses().values().stream()
                .collect(java.util.stream.Collectors.toMap(Course::id, Course::isPublic)))
            .orElse(Map.of());
        try
        {
            programmes.save(path[1], path[2], update.points(), update.lines(), update.courses(),
                update.races(), update.forWriter());
        }
        catch (IOException e)
        {
            // The programme is looked up rather than path-built, so an unknown club or
            // series lands here rather than writing a new file somewhere.
            resp.sendError(404, e.getMessage());
            return;
        }
        Programme saved = programmes.programme(path[1], path[2]).orElse(null);
        exposure(path[1], path[2], wasPublic, saved);
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
            join(resp, path[1], path[2], path[3], req.getParameter("variant"));
            return;
        }
        if (path.length == 1 && path[0].equals("programmes"))
        {
            createProgramme(req, resp);
            return;
        }
        if (path.length == 4 && path[0].equals("programmes") && path[3].equals("rename"))
        {
            renameProgramme(req, resp, path[1], path[2]);
            return;
        }
        if (path.length == 4 && path[0].equals("lifecycle") && path[3].equals("snapshots"))
        {
            snapshot(req, resp, path[1], path[2]);
            return;
        }
        if (path.length == 4 && path[0].equals("lifecycle") && path[3].equals("publications"))
        {
            publish(req, resp, path[1], path[2]);
            return;
        }
        if (path.length == 4 && path[0].equals("conduct"))
        {
            conduct(req, resp, path[1], path[2], path[3]);
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
            store.save(record, programmes.zone(record.club(), record.series()));
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
     * Retire a series.
     *
     * <p>Refused with 409 while any of its courses is still published, unless
     * {@code ?force=true}: deleting a programme boats can still join is a decision, not a
     * keystroke, and the refusal names what is on offer so the editor can ask about it. Its
     * <b>snapshots are kept either way</b> — a record names a revision, and a record whose
     * geometry cannot be read is a time with no course attached.
     */
    @Override
    protected void doDelete(HttpServletRequest req, HttpServletResponse resp) throws IOException
    {
        String[] path = split(req.getPathInfo());
        if (!config.server().configWrites())
        {
            resp.sendError(403, "Config writes are disabled (server.configWrites)");
            return;
        }
        if (path.length == 5 && path[0].equals("lifecycle") && path[3].equals("snapshots"))
        {
            forgetSnapshot(req, resp, path[1], path[2], path[4]);
            return;
        }
        if (path.length != 3 || !path[0].equals("programmes"))
        {
            resp.sendError(404);
            return;
        }
        List<String> live = ledger.read(path[1]).published().keySet().stream()
            .filter(k -> k.startsWith(path[2] + "/"))
            .toList();
        if (!live.isEmpty() && !"true".equals(req.getParameter("force")))
        {
            // A structured body rather than sendError's HTML page: the editor has to name
            // the courses boats can still join in the dialog it asks with, and a sentence
            // it would have to parse back out is not that.
            resp.setStatus(409);
            send(resp, Map.of(
                "deleted", false,
                "published", live,
                "message", "still published — boats can join these. Delete anyway with "
                    + "force=true; the snapshots are kept either way."));
            return;
        }
        try
        {
            programmes.delete(path[1], path[2]);
        }
        catch (IOException e)
        {
            resp.sendError(404, e.getMessage());
            return;
        }
        send(resp, Map.of("deleted", true, "wasPublished", live));
    }

    /**
     * Take a snapshot out of the list.
     *
     * <p>Its archived geometry is deliberately kept — see {@link CourseLedger#forget}. A
     * record names a revision, and deleting what a result stands on would leave a time with
     * no course attached.
     */
    private void forgetSnapshot(HttpServletRequest req, HttpServletResponse resp, String club,
        String series, String revision) throws IOException
    {
        String course = req.getParameter("course");
        String variant = req.getParameter("variant");
        if (course == null || variant == null)
        {
            resp.sendError(400, "say which course and variant the snapshot belongs to");
            return;
        }
        try
        {
            ledger.forget(club, series, course, variant, revision);
            send(resp, Map.of("forgotten", revision, "geometryKept", true));
        }
        catch (IllegalArgumentException e)
        {
            resp.setStatus(409);
            send(resp, Map.of("forgotten", false, "message", e.getMessage()));
        }
    }

    /**
     * Create a series, empty or as a byte copy of another.
     *
     * <p>This is the one write that turns a user-supplied string into a <b>new path</b>, so
     * it is the one place an id is refused rather than reported —
     * {@link ProgrammeLibrary#resolve} validates and then checks the resolved path is still
     * inside the config tree, and throws for the servlet to turn into a 400.
     */
    private void createProgramme(HttpServletRequest req, HttpServletResponse resp) throws IOException
    {
        if (!config.server().configWrites())
        {
            resp.sendError(403, "Config writes are disabled (server.configWrites)");
            return;
        }
        Map<String, String> body;
        try
        {
            body = MAPPER.readValue(req.getInputStream(), new TypeReference<>() {});
        }
        catch (Exception e)
        {
            resp.sendError(400, "Unreadable request: " + e.getMessage());
            return;
        }
        try
        {
            Programme made = programmes.create(body.get("club"), body.get("series"),
                body.get("name"), body.get("cloneFrom"));
            LOG.info("Created {}/{}", made.club(), made.series());
            send(resp, Map.of("club", made.club(), "series", made.series(),
                "name", made.name() == null ? made.series() : made.name(),
                "problems", made.problems()));
        }
        catch (IllegalArgumentException e)
        {
            resp.sendError(400, e.getMessage());
        }
        catch (IOException e)
        {
            resp.sendError(409, e.getMessage());
        }
    }

    /**
     * Rename a series, and follow it into the ledger.
     *
     * <p>The file move and the ledger migration are two writes and cannot be one, so the
     * order matters: the file moves first, because a ledger pointing at a series that does
     * not exist yet is recoverable by renaming the file, while a file whose publications
     * were remapped to a name it does not have is not.
     */
    private void renameProgramme(HttpServletRequest req, HttpServletResponse resp,
        String club, String series) throws IOException
    {
        if (!config.server().configWrites())
        {
            resp.sendError(403, "Config writes are disabled (server.configWrites)");
            return;
        }
        Map<String, String> body;
        try
        {
            body = MAPPER.readValue(req.getInputStream(), new TypeReference<>() {});
        }
        catch (Exception e)
        {
            resp.sendError(400, "Unreadable request: " + e.getMessage());
            return;
        }
        String to = body.get("series");
        try
        {
            if (body.get("name") != null)
                programmes.setName(club, series, body.get("name"));
            if (to != null && !to.isBlank() && !to.equals(series))
            {
                programmes.rename(club, series, to);
                ledger.renameSeries(club, series, to);
            }
            else
            {
                to = series;
            }
            send(resp, Map.of("club", club, "series", to));
        }
        catch (IllegalArgumentException e)
        {
            resp.sendError(400, e.getMessage());
        }
        catch (IOException e)
        {
            resp.sendError(409, e.getMessage());
        }
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
     * THE COMMITTEE PUBLISHES: a start, a flag, a course, a message, an outcome.
     *
     * <p>One endpoint taking one envelope, because they are one act as far as the protocol is
     * concerned — a thing that becomes a division's state and writes its receipt into the
     * channel (§9.4). The screen decides which of them to offer and confirms it; what arrives
     * here is already a decision somebody made.
     *
     * <p><b>There is no GO here, and there cannot be</b> (§1.2, §12.3). The server keeps no
     * clock, so a start is not triggered but SCHEDULED as an absolute instant — and the
     * arithmetic that turned "in five minutes" into that instant was done in the operator's
     * browser against the operator's own clock.
     *
     * <p>TODO: gated by {@code configWrites} like the other writes, and that is not the answer.
     * Abandoning a race is the most consequential act in this system and the one that most
     * obviously wants a name attached to it — which is §7.1's "authenticate authority, trust
     * data", and open question 8.
     */
    private void conduct(HttpServletRequest req, HttpServletResponse resp, String club,
        String series, String raceId) throws IOException
    {
        if (!config.server().configWrites())
        {
            resp.sendError(403, "Config writes are disabled (server.configWrites)");
            return;
        }
        Dialog.Room room = dialog.room(club, series, raceId).orElse(null);
        if (room == null)
        {
            resp.sendError(404, "No such race");
            return;
        }
        Envelope message;
        try
        {
            message = MAPPER.readValue(req.getInputStream(), Envelope.class);
        }
        catch (Exception e)
        {
            resp.sendError(400, "Unreadable message: " + e.getMessage());
            return;
        }
        if (message.type() == null || message.type().isBlank())
        {
            resp.sendError(400, "A message with no type is not a message");
            return;
        }
        Envelope sent = dialog.publish(room, message);
        LOG.info("{} published {} to {} boat(s) of {}/{}/{}", club, sent.type(),
            room.boats().size(), club, series, raceId);
        send(resp, Map.of("published", true, "id", sent.id(), "at", sent.at()));
    }

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
    private void join(HttpServletResponse resp, String club, String series, String courseId,
        String variantId) throws IOException
    {
        Programme programme = programmes.programme(club, series).orElse(null);
        Course course = programme == null ? null : programme.courses().get(courseId);
        if (course == null)
        {
            resp.sendError(404, "No such course");
            return;
        }
        String variant = (variantId == null || variantId.isBlank())
            ? soleVariant(course) : variantId;
        if (variant == null)
        {
            // Several variants and none named. Asked rather than guessed: handing a boat the
            // wrong variant's course is worse than making it say which it wants.
            resp.sendError(400, "This course has variants — say which: "
                + String.join(", ", course.variants().keySet()));
            return;
        }
        String revision = ledger.read(club).publishedRevision(series, courseId, variant)
            .orElse(null);
        if (revision == null)
        {
            resp.sendError(404, "Nothing published for " + courseId + "/" + variant);
            return;
        }
        // What was PUBLISHED, not what the editor currently holds. A boat is handed the
        // design somebody deliberately released; the live variant may have been dragged
        // about since, and half the point of the model is that doing so changes nothing for
        // a boat until it is published again.
        CourseSnapshot published = store.course(revision).orElse(null);
        if (published == null)
        {
            resp.sendError(500, "Published revision " + revision + " is missing from the store");
            return;
        }
        send(resp, published);
    }

    /** The one variant a boat can be given without being asked, or null if there is a choice. */
    private static String soleVariant(Course course)
    {
        List<String> joinable = course.variants().entrySet().stream()
            .filter(e -> !e.getValue().template())
            .map(Map.Entry::getKey)
            .toList();
        return joinable.size() == 1 ? joinable.get(0) : null;
    }

    /**
     * Capture one variant as an immutable snapshot.
     *
     * <p>This is where a design starts existing independently of the editor: the geometry is
     * resolved and fully inlined, hashed, and archived under that hash. It is <b>not</b>
     * published by doing this — see {@link #publish}. Snapshot and publish are two steps so
     * a course can be prepared on Thursday and released on Saturday, and so a bad release
     * can be undone by pointing back at the previous snapshot rather than by re-editing
     * anything.
     */
    private void snapshot(HttpServletRequest req, HttpServletResponse resp, String club,
        String series) throws IOException
    {
        if (!config.server().configWrites())
        {
            resp.sendError(403, "Config writes are disabled (server.configWrites)");
            return;
        }
        Programme programme = programmes.programme(club, series).orElse(null);
        if (programme == null)
        {
            resp.sendError(404, "No such programme");
            return;
        }
        Map<String, String> body;
        try
        {
            body = MAPPER.readValue(req.getInputStream(), new TypeReference<>() {});
        }
        catch (Exception e)
        {
            resp.sendError(400, "Unreadable request: " + e.getMessage());
            return;
        }
        Course course = programme.courses().get(body.get("course"));
        String variantId = body.getOrDefault("variant", CourseVariant.MAIN);
        CourseVariant variant = course == null ? null : course.variant(variantId);
        if (variant == null)
        {
            resp.sendError(404, "No such course variant");
            return;
        }
        // The one restriction a template carries, and every other consequence follows from
        // it: no snapshot means no publication, which means no boat can ever join it.
        if (variant.template())
        {
            resp.sendError(409, "'" + variantId + "' is a template — clone it into a variant "
                + "before taking a snapshot");
            return;
        }
        List<String> problems = variant.problems(course.where(variantId),
            programme.lines(), programme.points());
        if (!problems.isEmpty())
        {
            resp.sendError(409, "Incomplete: " + String.join("; ", problems));
            return;
        }

        CourseSnapshot taken = CourseSnapshot.of(programme, course, variantId)
            .taken(java.time.Instant.now());
        store.archive(taken);
        CourseLedger.Taken entry = ledger.take(club, series, course.id(), variantId,
            taken.revision(), taken.label(), taken.archivedAt());
        LOG.info("Snapshot {} of {}/{} — {}", taken.revision(), club, taken.label(),
            entry.fresh() ? "new" : "already held");
        send(resp, Map.of(
            "snapshot", taken,
            // False when this exact geometry was already captured. The revision is the
            // geometry, so a second capture of an unchanged variant is the same snapshot,
            // and saying so is more useful than pretending something happened.
            "fresh", entry.fresh(),
            "label", entry.entry().label()));
    }

    /**
     * Record the OTHER way a course becomes visible: the tickbox, not the publish button.
     *
     * <p>Visibility has two switches and either one turns it on — publish to a public
     * course, or make a published course public — so a log that watched only the publish
     * endpoint would miss half the moments a course became joinable, and the half it missed
     * is the surprising one: nothing was published, nobody pressed anything that says
     * "release", and a fleet can suddenly see three snapshots.
     *
     * <p>Only courses that actually <b>have</b> published snapshots produce an event.
     * Ticking public on an empty course exposes nothing, and an entry saying otherwise would
     * make the trail noise rather than evidence. Failure here is logged and swallowed: the
     * programme has already been written, and refusing the save afterwards would leave the
     * file and the response disagreeing about what happened.
     */
    private void exposure(String club, String series, Map<String, Boolean> wasPublic,
        Programme saved)
    {
        if (saved == null)
            return;
        CourseLedger.Ledger held = ledger.read(club);
        java.time.Instant now = java.time.Instant.now();
        List<CourseLedger.Event> events = new ArrayList<>();
        for (Course course : saved.courses().values())
        {
            boolean before = Boolean.TRUE.equals(wasPublic.get(course.id()));
            if (before == course.isPublic())
                continue;
            String what = course.isPublic()
                ? CourseLedger.Event.OPENED : CourseLedger.Event.CLOSED;
            for (String variantId : course.variants().keySet())
            {
                String revision = held.publishedRevision(series, course.id(), variantId)
                    .orElse(null);
                if (revision == null)
                    continue;
                events.add(new CourseLedger.Event(now, what, series, course.id(), variantId,
                    revision, held.of(series, course.id(), variantId).stream()
                        .filter(e -> e.revision().equals(revision))
                        .map(CourseLedger.Entry::label).findFirst().orElse(null)));
            }
        }
        if (events.isEmpty())
            return;
        try
        {
            ledger.record(club, events);
            LOG.info("{} public visibility event(s) for {}/{}", events.size(), club, series);
        }
        catch (IOException e)
        {
            LOG.error("Could not record visibility events for {}/{}", club, series, e);
        }
    }

    /**
     * Move publication pointers, all of them or none.
     *
     * <p>One variant and several variants are the same operation at different scope. The
     * wide case is not a nicety: a line common to three variants moved on race morning has
     * to change all three together, or those fleets are racing to inconsistent
     * instructions.
     */
    private void publish(HttpServletRequest req, HttpServletResponse resp, String club,
        String series) throws IOException
    {
        if (!config.server().configWrites())
        {
            resp.sendError(403, "Config writes are disabled (server.configWrites)");
            return;
        }
        Programme programme = programmes.programme(club, series).orElse(null);
        if (programme == null)
        {
            resp.sendError(404, "No such programme");
            return;
        }
        PublishRequest request;
        try
        {
            request = MAPPER.readValue(req.getInputStream(), PublishRequest.class);
        }
        catch (Exception e)
        {
            resp.sendError(400, "Unreadable request: " + e.getMessage());
            return;
        }
        CourseLedger.Ledger held = ledger.read(club);
        List<CourseLedger.Publication> publications = new ArrayList<>();
        for (PublishRequest.Target target : request.publish())
        {
            String variant = target.variantOrMain();
            String revision = target.revision();
            if (revision == null || revision.isBlank())
            {
                // No revision named means "whatever was last captured", which is what the
                // race-morning flow wants: snapshot the dirty variants, then publish them.
                revision = held.latest(series, target.course(), variant)
                    .map(CourseLedger.Entry::revision).orElse(null);
            }
            if (revision == null)
            {
                resp.sendError(409, "No snapshot to publish for " + target.course() + "/" + variant);
                return;
            }
            publications.add(new CourseLedger.Publication(series, target.course(), variant, revision));
        }
        List<CourseLedger.Publication> withdrawals = request.withdraw().stream()
            .map(t -> new CourseLedger.Publication(series, t.course(), t.variantOrMain(), null))
            .toList();
        // What the PUBLIC can now see, recorded in the same write that moves the pointers.
        // Only public courses: a publication to a private course changes nothing anybody
        // outside the club can observe, and logging it as a public event would make the
        // trail say something untrue.
        java.time.Instant now = java.time.Instant.now();
        List<CourseLedger.Event> events = new ArrayList<>();
        for (CourseLedger.Publication p : publications)
        {
            Course c = programme.courses().get(p.course());
            if (c == null || !c.isPublic())
                continue;
            events.add(new CourseLedger.Event(now, CourseLedger.Event.PUBLISHED, series,
                p.course(), p.variant(), p.revision(),
                held.of(series, p.course(), p.variant()).stream()
                    .filter(e -> e.revision().equals(p.revision()))
                    .map(CourseLedger.Entry::label).findFirst().orElse(null)));
        }
        for (CourseLedger.Publication p : withdrawals)
        {
            Course c = programme.courses().get(p.course());
            // Only when something was actually being offered: withdrawing a publication
            // that is not there changes nothing and should not read as though it did.
            if (c == null || !c.isPublic()
                || held.publishedRevision(series, p.course(), p.variant()).isEmpty())
                continue;
            events.add(new CourseLedger.Event(now, CourseLedger.Event.WITHDRAWN, series,
                p.course(), p.variant(), null, null));
        }
        try
        {
            CourseLedger.Ledger updated = ledger.publish(club, publications, withdrawals, events);
            LOG.info("Published {} and withdrew {} for {} — {} public event(s)",
                publications.size(), withdrawals.size(), club, events.size());
            send(resp, Map.of("published", updated.published(), "logged", events.size()));
        }
        catch (IllegalArgumentException e)
        {
            resp.sendError(409, e.getMessage());
        }
    }

    /** What to publish and what to withdraw, applied together or not at all. */
    public record PublishRequest(
        @JsonProperty("publish") List<Target> publish,
        @JsonProperty("withdraw") List<Target> withdraw)
    {
        public PublishRequest
        {
            publish = (publish == null) ? List.of() : List.copyOf(publish);
            withdraw = (withdraw == null) ? List.of() : List.copyOf(withdraw);
        }

        public record Target(
            @JsonProperty("course") String course,
            @JsonProperty("variant") String variant,
            @JsonProperty("revision") String revision)
        {
            String variantOrMain()
            {
                return (variant == null || variant.isBlank()) ? CourseVariant.MAIN : variant;
            }
        }
    }

    /**
     * Every variant's state, its snapshots, and what is published — the whole of what the
     * editor needs to show dirty courses and to publish them.
     *
     * <p><b>State is derived here, never stored.</b> Resolve the variant, hash it, compare
     * with the latest snapshot's revision. No dirty flag is written anywhere, so none can go
     * stale, be missed by an edit path, or survive an undo it should not have.
     */
    private Map<String, Object> lifecycle(Programme programme)
    {
        CourseLedger.Ledger held = ledger.read(programme.club());
        Map<String, Object> courses = new LinkedHashMap<>();
        programme.courses().forEach((courseId, course) ->
        {
            Map<String, Object> variants = new LinkedHashMap<>();
            course.variants().forEach((variantId, variant) ->
            {
                List<String> problems = variant.problems(course.where(variantId),
                    programme.lines(), programme.points());
                CourseSnapshot now = problems.isEmpty()
                    ? CourseSnapshot.of(programme, course, variantId) : null;
                CourseLedger.Entry latest = held.latest(programme.series(), courseId, variantId)
                    .orElse(null);
                String publishedRevision = held
                    .publishedRevision(programme.series(), courseId, variantId).orElse(null);
                double nm = variant.lengthNm(programme.lines(), programme.points());

                Map<String, Object> row = new LinkedHashMap<>();
                row.put("name", variant.name());
                row.put("template", variant.template());
                row.put("closed", variant.closed());
                row.put("adhocPoints", variant.points().keySet());
                row.put("adhocLines", variant.lines().keySet());
                row.put("revision", now == null ? null : now.revision());
                row.put("lengthNm", Double.isNaN(nm) ? null : nm);
                row.put("state", state(variant.template(), problems, now, latest));
                row.put("latest", latest);
                row.put("published", publishedRevision);
                // Whether what boats are being handed is the newest capture. A variant can
                // be `current` — designed and captured — while an older snapshot is still
                // the one on offer, and that difference is the whole reason publish is a
                // separate step.
                row.put("publishedIsLatest", publishedRevision != null && latest != null
                    && publishedRevision.equals(latest.revision()));
                row.put("snapshots", held.of(programme.series(), courseId, variantId));
                row.put("problems", problems);
                variants.put(variantId, row);
            });
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("name", course.name());
            row.put("notes", course.notes());
            row.put("flat", course.flat());
            row.put("variants", variants);
            courses.put(courseId, row);
        });
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("club", programme.club());
        body.put("series", programme.series());
        body.put("courses", courses);
        return body;
    }

    /**
     * The four states, plus template.
     *
     * <p>A template is called out first because it can never reach any of the others: it
     * cannot be snapshotted, so it is permanently unpublished and never dirty, and showing
     * it as "unpublished" alongside real work waiting to be released would put it in a
     * queue it can never leave.
     */
    private static String state(boolean template, List<String> problems, CourseSnapshot now,
        CourseLedger.Entry latest)
    {
        if (template)
            return "template";
        if (!problems.isEmpty() || now == null)
            return "incomplete";
        if (latest == null)
            return "unpublished";
        return now.revision().equals(latest.revision()) ? "current" : "dirty";
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

    /**
     * Every template in the library, wherever it lives.
     *
     * <p>The editor holds one programme at a time, so without this it can only see the
     * templates of the series it happens to be looking at — and a template's whole purpose
     * is to be the start of courses elsewhere. A club's own W/L shape is the commonest
     * case, so the current series is in here too rather than excluded as "other".
     *
     * <p>An index only. Expanding one means reading the source programme, which the editor
     * already has an endpoint for; giving this one the geometry as well would be a second
     * way to ask the same question.
     */
    private List<Map<String, Object>> templateIndex()
    {
        List<Map<String, Object>> index = new ArrayList<>();
        programmes.programmes().values().stream()
            .sorted(Comparator.comparing(Programme::club).thenComparing(Programme::series))
            .forEach(p -> p.courses().forEach((courseId, course) ->
                course.variants().forEach((variantId, variant) ->
                {
                    if (!variant.template())
                        return;
                    double nm = variant.lengthNm(p.lines(), p.points());
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("club", p.club());
                    row.put("series", p.series());
                    row.put("course", courseId);
                    row.put("variant", variantId);
                    row.put("name", variant.name());
                    row.put("closed", variant.closed());
                    // Sequence positions, the same thing CourseSnapshot calls steps — NOT
                    // legs (n-1 of those on an open course, n on a cycle) and not crossings
                    // (a gate step holds two). The picker labels them "marks", which is what
                    // a sailor calls the lettered things a course is a list of.
                    row.put("steps", variant.sequence().size());
                    row.put("lengthNm", Double.isNaN(nm) ? null : nm);
                    index.add(row);
                })));
        return index;
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
        Map<String, Object> variants = new LinkedHashMap<>();
        course.variants().forEach((variantId, variant) ->
        {
            double[] legs = variant.legLengthsNm(programme.lines(), programme.points());
            List<Map<String, Object>> steps = new ArrayList<>();
            for (int i = 0; i < variant.sequence().size(); i++)
            {
                Map<String, Object> step = new LinkedHashMap<>();
                step.put("letter", variant.sequenceLetter(i));
                step.put("step", variant.sequence().get(i));
                step.put("legNm", Double.isNaN(legs[i]) ? null : legs[i]);
                steps.add(step);
            }
            double length = variant.lengthNm(programme.lines(), programme.points());
            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("variant", variant);
            detail.put("steps", steps);
            detail.put("lengthNm", Double.isNaN(length) ? null : length);
            detail.put("problems",
                variant.problems(course.where(variantId), programme.lines(), programme.points()));
            variants.put(variantId, detail);
        });
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("course", course);
        detail.put("variants", variants);
        detail.put("defaults", programme.defaults());
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
        @JsonProperty("races") Map<String, Race> races,
        @JsonProperty("renames") List<Rename> renames)
    {
        public PointsUpdate
        {
            courses = (courses == null) ? null : new LinkedHashMap<>(courses);
            races = (races == null) ? null : new LinkedHashMap<>(races);
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

    /**
     * Every variant's length in nautical miles, keyed course then variant, null where it
     * cannot be measured. Computed here so the midpoint-to-midpoint rule has one
     * implementation rather than two that drift.
     */
    /**
     * What anybody may see: the public courses, and what is published under each.
     *
     * <p><b>Two gates, both required.</b> The course must be public, and the variant must
     * have a live publication. A public course with nothing published appears with nothing
     * under it, which is honest — it is a course nobody can join yet — and an unpublished
     * variant of a public course does not appear at all, because what a client joins and is
     * pushed is a <em>snapshot</em>, and a variant with none has nothing to push.
     *
     * <p>Templates cannot reach here by construction rather than by a filter: a template can
     * never be snapshotted, so it can never be published, so it can never have a live
     * revision. The one flag does all of it.
     */
    private List<Map<String, Object>> publicIndex()
    {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Programme programme : programmes.programmes().values())
        {
            CourseLedger.Ledger held = ledger.read(programme.club());
            for (Course course : programme.courses().values())
            {
                if (!course.isPublic())
                    continue;
                List<Map<String, Object>> offers = new ArrayList<>();
                course.variants().forEach((variantId, variant) ->
                {
                    String revision = held
                        .publishedRevision(programme.series(), course.id(), variantId)
                        .orElse(null);
                    if (revision == null)
                        return;
                    Map<String, Object> offer = new LinkedHashMap<>();
                    offer.put("variant", variantId);
                    offer.put("name", variant.name());
                    offer.put("closed", variant.closed());
                    offer.put("revision", revision);
                    held.of(programme.series(), course.id(), variantId).stream()
                        .filter(e -> e.revision().equals(revision))
                        .findFirst()
                        .ifPresent(e ->
                        {
                            offer.put("label", e.label());
                            offer.put("publishedFrom", e.takenAt());
                        });
                    // Read off the archived snapshot, not recomputed from the file: this is
                    // the length of what boats were HANDED, and the file has moved on.
                    store.course(revision).ifPresent(snap ->
                    {
                        offer.put("lengthNm", snap.lengthNm());
                        offer.put("steps", snap.steps().size());
                    });
                    offers.add(offer);
                });
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("club", programme.club());
                row.put("series", programme.series());
                row.put("course", course.id());
                row.put("name", course.name());
                row.put("notes", course.notes());
                row.put("published", offers);
                out.add(row);
            }
        }
        return out;
    }

    /**
     * Every moment the public view changed, newest first, across every club.
     *
     * <p>Open to everybody, deliberately and by the same reasoning that keeps the other
     * reads open: a club publishes its racing. What a fleet was handed and when is exactly
     * the thing a competitor may need to check afterwards, and a record of it that only the
     * club can read is not an audit trail, it is a note to self.
     */
    private List<Map<String, Object>> publicLog(int limit)
    {
        List<Map<String, Object>> out = new ArrayList<>();
        for (String club : programmes.programmes().values().stream()
            .map(Programme::club).distinct().toList())
        {
            for (CourseLedger.Event event : ledger.read(club).log())
            {
                Map<String, Object> row =
                    MAPPER.convertValue(event, new TypeReference<LinkedHashMap<String, Object>>() {});
                row.put("club", club);
                out.add(row);
            }
        }
        out.sort((a, b) -> String.valueOf(b.get("at")).compareTo(String.valueOf(a.get("at"))));
        return out.size() > limit ? out.subList(0, limit) : out;
    }

    /** A capped, defensive {@code ?limit=}: a bad one is the default, never a 400. */
    private static int limit(HttpServletRequest req, int fallback)
    {
        try
        {
            int n = Integer.parseInt(req.getParameter("limit"));
            return (n > 0 && n <= 1000) ? n : fallback;
        }
        catch (RuntimeException e)
        {
            return fallback;
        }
    }

    private static Map<String, Object> lengths(Programme programme)
    {
        Map<String, Object> out = new LinkedHashMap<>();
        programme.courses().forEach((id, course) ->
        {
            Map<String, Object> byVariant = new LinkedHashMap<>();
            course.variants().forEach((variantId, variant) ->
            {
                double nm = variant.lengthNm(programme.lines(), programme.points());
                byVariant.put(variantId, Double.isNaN(nm) ? null : nm);
            });
            out.put(id, byVariant);
        });
        return out;
    }

    private static String[] split(String pathInfo)
    {
        if (pathInfo == null || pathInfo.isBlank() || pathInfo.equals("/"))
            return new String[0];
        return pathInfo.substring(1).split("/");
    }

    /**
     * WHAT THERE IS TO READ: this series' races, and the designs anybody has raced against.
     *
     * <p>Two lists because there are two kinds of result, and they are ranked on different
     * things. A RACE is a fleet sailing together on one afternoon, so its results are that
     * afternoon's and are read as a finishing order. A RECORD ATTEMPT stands against every
     * other attempt at the same geometry, whenever it was made, which is why those are grouped
     * by variant and then by revision — the store will not rank across an edit, because a
     * course edited between two attempts is two courses.
     *
     * <p>Counts only. The rows themselves are a click away, because a club with a season of
     * racing behind it would otherwise be sending its whole store to draw an index.
     */
    private void results(HttpServletResponse resp, String club, String series) throws IOException
    {
        Programme programme = programmes.programme(club, series).orElse(null);
        if (programme == null)
        {
            resp.sendError(404, "No such series");
            return;
        }
        List<Map<String, Object>> races = new ArrayList<>();
        programme.races().forEach((id, race) ->
        {
            List<CourseRecord> sailed = recordsFor(programme, club, race, id);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("race", id);
            row.put("name", race.name());
            row.put("date", race.date() == null ? null : race.date().toString());
            row.put("format", race.format());
            row.put("divisions", race.divisions().keySet());
            row.put("records", sailed.size());
            row.put("finished", sailed.stream().filter(r -> r.elapsedSeconds().isPresent()).count());
            races.add(row);
        });
        // Newest first: what somebody wants from a season of racing is last Saturday.
        races.sort(Comparator.comparing((Map<String, Object> r) ->
            String.valueOf(r.get("date"))).reversed());

        List<Map<String, Object>> variants = new ArrayList<>();
        // Shadowing the field would be a bug waiting to happen: `ledger` is the store.
        CourseLedger.Ledger taken = ledger.read(club);
        programme.courses().forEach((courseId, course) -> course.variants().forEach((variantId, variant) ->
        {
            List<Map<String, Object>> revisions = new ArrayList<>();
            for (CourseLedger.Entry entry : taken.of(series, courseId, variantId))
            {
                long attempts = store.best(club, courseId, entry.revision()).size();
                if (attempts == 0)
                    continue;
                Map<String, Object> rev = new LinkedHashMap<>();
                rev.put("revision", entry.revision());
                rev.put("label", entry.label());
                rev.put("takenAt", entry.takenAt());
                rev.put("attempts", attempts);
                revisions.add(rev);
            }
            if (revisions.isEmpty())
                return;
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("course", courseId);
            row.put("courseName", course.name());
            row.put("variant", variantId);
            row.put("variantName", variant.name());
            row.put("revisions", revisions);
            variants.add(row);
        }));

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("club", club);
        body.put("series", series);
        body.put("races", races);
        body.put("variants", variants);
        send(resp, body);
    }

    /**
     * One race, as a finishing order.
     *
     * <p><b>Ordered by elapsed time, and corrected time is offered beside it rather than
     * instead of it.</b> This server does not score (see the class header): it has no rules for
     * a drop race, a penalty or a protest, and a club's own software does. What it can say
     * without pretending otherwise is what each boat's own clock recorded, which is the one
     * thing it is uniquely able to be right about — so the elapsed times are the result here
     * and the TCF arithmetic is shown for what it is, a multiplication anybody can check.
     */
    private void raceResults(HttpServletResponse resp, String club, String series, String raceId)
        throws IOException
    {
        Programme programme = programmes.programme(club, series).orElse(null);
        Race race = programme == null ? null : programme.races().get(raceId);
        if (race == null)
        {
            resp.sendError(404, "No such race");
            return;
        }
        List<Map<String, Object>> rows = new ArrayList<>();
        for (CourseRecord record : recordsFor(programme, club, race, raceId))
            rows.add(resultRow(record));
        rows.sort(finishOrder());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("race", raceId);
        body.put("name", race.name());
        body.put("date", race.date() == null ? null : race.date().toString());
        body.put("format", race.format());
        body.put("results", rows);
        send(resp, body);
    }

    /**
     * Record attempts at one variant, by revision, quickest first within each.
     *
     * <p>Grouped by revision rather than ranked across them, because that is the rule the store
     * already enforces and it is the right one: two boats that sailed the same variant either
     * side of a mark being moved did not sail the same course, and a table that put them in one
     * column would be a table nobody could argue in front of a protest committee.
     */
    private void variantResults(HttpServletResponse resp, String club, String series,
        String course, String variant) throws IOException
    {
        List<Map<String, Object>> groups = new ArrayList<>();
        for (CourseLedger.Entry entry : ledger.read(club).of(series, course, variant))
        {
            List<Map<String, Object>> rows = new ArrayList<>();
            for (CourseRecord record : store.best(club, course, entry.revision()))
                rows.add(resultRow(record));
            if (rows.isEmpty())
                continue;
            Map<String, Object> group = new LinkedHashMap<>();
            group.put("revision", entry.revision());
            group.put("label", entry.label());
            group.put("takenAt", entry.takenAt());
            group.put("results", rows);
            groups.add(group);
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("course", course);
        body.put("variant", variant);
        body.put("revisions", groups);
        send(resp, body);
    }

    /**
     * The records a race was sailed under.
     *
     * <p>Found by the DAY and the COURSES the race names, and then filtered on the race the
     * server stamped onto each record as it arrived. Records are filed by club, course and day
     * with no race in the path — deliberately, because a record is a run at a course and a race
     * is a thing that sometimes happens on one — so this is the join, and it is a small one: a
     * race has a date and a handful of divisions.
     */
    private List<CourseRecord> recordsFor(Programme programme, String club, Race race, String raceId)
    {
        if (race.date() == null)
            return List.of();
        List<CourseRecord> found = new ArrayList<>();
        java.util.Set<String> seen = new java.util.LinkedHashSet<>();
        for (Race.Division division : race.divisions().values())
        {
            if (division.course() == null || !seen.add(division.course()))
                continue;
            for (CourseRecord record : store.day(club, division.course(), race.date()))
            {
                if (raceId.equals(record.race()) && record.join().published())
                    found.add(record);
            }
        }
        return found;
    }

    /** One line of a results table: who, how long, and whether the track came with it. */
    private Map<String, Object> resultRow(CourseRecord record)
    {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("boatId", record.boatId());
        row.put("boatName", record.boatName());
        row.put("sailNumber", record.sailNumber());
        row.put("division", record.division());
        row.put("tcf", record.tcf());
        row.put("lengthM", record.lengthM());
        row.put("join", record.join());
        row.put("course", record.course());
        row.put("revision", record.courseRevision());
        row.put("startTime", record.startTime());
        row.put("finishTime", record.finishTime());
        row.put("crossings", record.crossings().size());
        // WHETHER THE TRACK CAME WITH IT, because that is the difference between a time
        // somebody can examine and a time they can only believe. See `CourseRecord.auditable`.
        row.put("auditable", record.auditable());
        OptionalLong elapsed = record.elapsedSeconds();
        row.put("elapsedSeconds", elapsed.isPresent() ? elapsed.getAsLong() : null);
        row.put("correctedSeconds", elapsed.isPresent() && record.tcf() != null
            ? Math.round(elapsed.getAsLong() * record.tcf()) : null);
        return row;
    }

    /** Finishers first and quickest first; anybody still out, or retired, after them. */
    private Comparator<Map<String, Object>> finishOrder()
    {
        return Comparator.comparingLong(row ->
        {
            Object elapsed = row.get("elapsedSeconds");
            return elapsed instanceof Number n ? n.longValue() : Long.MAX_VALUE;
        });
    }

    private void send(HttpServletResponse resp, Object value) throws IOException
    {
        resp.setContentType("application/json");
        resp.setCharacterEncoding(StandardCharsets.UTF_8.name());
        resp.getOutputStream().write(MAPPER.writeValueAsBytes(value));
    }
}
