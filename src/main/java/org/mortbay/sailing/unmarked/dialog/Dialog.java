package org.mortbay.sailing.unmarked.dialog;

import java.io.IOException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

import org.mortbay.sailing.unmarked.course.ProgrammeLibrary;
import org.mortbay.sailing.unmarked.model.Course;
import org.mortbay.sailing.unmarked.model.CourseRecord;
import org.mortbay.sailing.unmarked.model.CourseSnapshot;
import org.mortbay.sailing.unmarked.model.Programme;
import org.mortbay.sailing.unmarked.model.Race;
import org.mortbay.sailing.unmarked.store.CourseLedger;
import org.mortbay.sailing.unmarked.store.JsonStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * THE CONVERSATION. The dialog document, §§3–8, on the server side.
 *
 * <p>Everything a boat and the server say to each other passes through {@link #exchange}, and
 * everything a committee does passes through {@link #publish}. What this class is NOT is the
 * thing that decides a race: it collates and redistributes (§1.2) and measures nothing. There is
 * no clock in here to start a race by, no arithmetic over anybody's position, and no outcome
 * inferred from a boat going quiet — a boat is DNF because a person typed it.
 *
 * <p><b>THE SERVER CAN BE SWITCHED OFF WITHOUT A BOAT ON THE WATER NOTICING</b>, which is the
 * architecture this has to leave intact. Nothing here is on the path from a fix to a latch;
 * every message in both directions is either a thing the boat is telling the fleet or a thing
 * the committee is telling the boat, and a boat that hears none of it still rounds its marks and
 * times them. That is why the whole of this file can be read as optional.
 *
 * <p><b>State is the events applied as they arrive</b> (§4). There is no ordinal and no replay:
 * a start is published, an {@code AP} voids it, a new start supersedes the {@code AP}, and the
 * last message to arrive for a tag is that tag's state. {@link Standing} is that reduction, held
 * per tag, and it is also exactly what a reconnecting boat is re-stated from (§4.1).
 *
 * <h2>What is not built yet, deliberately</h2>
 * <ul>
 * <li><b>The WebSocket.</b> Only the polling transport is wired (§3). The envelopes, the
 *     ordering rules and the schemas are the ones the socket will carry — the document's
 *     promise is that the fallback is the same conversation, so the socket is a pipe to add
 *     rather than a protocol to design. What it will need beyond this file is a ticker, because
 *     {@code fleet} is currently enqueued when a boat polls (see {@link #fleetDue}).
 * <li><b>{@code ask}.</b> Every join answers itself today; a question is a gap in what the
 *     server knows, and with the division taken from the course there is no gap yet.
 * <li><b>Rate capping and muting.</b> §13, deferred on purpose.
 * </ul>
 */
public class Dialog
{
    private static final Logger LOG = LoggerFactory.getLogger(Dialog.class);

    /**
     * How often a boat is sent the fleet, and it is deliberately slow (§8.4).
     *
     * <p>Not the fix rate. At nine knots a boat moves twenty-three metres in five seconds, which
     * on a screen showing a whole course is nothing — and the alternative scales badly for no
     * benefit: sixty boats at 1 Hz is sixty fan-outs a second to say what a fleet screen cannot
     * draw the difference of. One message carries every boat, so the cost is per boat rather
     * than per pair.
     */
    public static final int FLEET_SECONDS = 5;

    /** What a boat is asked to report at, when there is a fleet to report to. */
    public static final int FIX_SECONDS = 2;

    /** How often a polling client comes back. The socket will make this moot. */
    public static final int POLL_MS = 1000;

    /**
     * A cap on message LENGTH, which costs nothing and is worth having regardless (§13).
     *
     * <p>A radio channel where somebody can paste an essay is its own problem, and unlike a rate
     * cap this one needs no identity to enforce: it is a property of the message, not of who
     * sent it.
     */
    public static final int MAX_SAY = 400;

    /** How much of a race's channel is kept in memory and written back. A race is not long. */
    private static final int CHANNEL_LIMIT = 2000;

    private final ProgrammeLibrary programmes;
    private final CourseLedger ledger;
    private final JsonStore store;

    /**
     * For reading a record off the wire, which needs the time module: every instant in a
     * `CourseRecord` is an {@link Instant}, and a mapper without it fails on the first one.
     */
    private static final com.fasterxml.jackson.databind.json.JsonMapper RECORDS =
        com.fasterxml.jackson.databind.json.JsonMapper.builder()
            .addModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule())
            .disable(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .build();

    private final Map<String, Session> sessions = new ConcurrentHashMap<>();
    private final Map<String, Room> rooms = new ConcurrentHashMap<>();
    private final AtomicLong counter = new AtomicLong();

    public Dialog(ProgrammeLibrary programmes, CourseLedger ledger, JsonStore store)
    {
        this.programmes = programmes;
        this.ledger = ledger;
        this.store = store;
    }

    /* ==================================================================== the boat's side */

    /**
     * ONE EXCHANGE: what the boat said, and what it is told back.
     *
     * <p>This is the whole of the transport's contract, and it is written this way so that the
     * WebSocket can use it unchanged: a socket frame is an exchange of one message with an empty
     * reply, and a poll is an exchange of several with whatever is queued. A protocol with two
     * dialects has two sets of bugs (§3).
     */
    public List<Envelope> exchange(String sessionId, List<Envelope> incoming)
    {
        List<Envelope> out = new ArrayList<>();
        Session session = sessionId == null ? null : sessions.get(sessionId);

        for (Envelope message : incoming == null ? List.<Envelope>of() : incoming)
        {
            if (message == null || message.type() == null)
                continue;
            // The session may be named in the body as well as in the path — the catalogue says
            // every C→S message carries it — and either will do. A socket knows its own session
            // and has no path to put it in. Guarded, because `hello` and `join` name none and a
            // concurrent map refuses a null key with an exception rather than a miss.
            String said = message.text("session");
            Session named = said == null ? null : sessions.get(said);
            Session on = named != null ? named : session;
            try
            {
                Session became = handle(on, message, out);
                if (became != null)
                    session = became;
            }
            catch (Exception e)
            {
                LOG.warn("Could not handle {}", message.type(), e);
                out.add(Envelope.of("rejected", Map.of(
                    "code", "internal", "text", "The server could not handle that message.")));
            }
        }

        if (session != null)
        {
            session.lastSeen = Instant.now();
            Room room = session.room;
            if (room != null && fleetDue(session))
                session.queue.add(room.fleet());
            for (Envelope queued = session.queue.poll(); queued != null; queued = session.queue.poll())
                out.add(queued);
        }
        return out;
    }

    private Session handle(Session session, Envelope message, List<Envelope> out) throws IOException
    {
        switch (message.type())
        {
            case "hello" ->
            {
                // THE CLIENT PROPOSES, THE SERVER DISPOSES (§5.1). The server knows what the
                // fleet is running; the client knows only itself.
                List<?> versions = message.body().get("versions") instanceof List<?> l ? l : List.of();
                boolean speaks = versions.isEmpty() || versions.stream()
                    .anyMatch(v -> String.valueOf(v).equals(String.valueOf(Envelope.V1)));
                if (!speaks)
                {
                    out.add(Envelope.of("rejected", Map.of(
                        "code", "version",
                        "text", "This server speaks protocol v" + Envelope.V1
                            + " and your client does not offer it. Update the app.")));
                    return null;
                }
                // NO TIME IN THE REPLY. The server is not a clock to set yours by (§1.2), and
                // the one field somebody would reach for here is the one that would make it one.
                out.add(Envelope.of("hello.ok", Map.of(
                    "v", Envelope.V1,
                    "poll", POLL_MS,
                    "features", List.of("channel", "fleet", "timer", "flag", "course", "outcome"))));
            }
            case "join" -> { return join(message, out); }
            case "leave" ->
            {
                if (session != null)
                {
                    session.leave();
                    sessions.remove(session.id);
                    out.add(Envelope.of("left", Map.of("session", session.id)));
                }
            }
            case "fix" ->
            {
                if (session == null)
                    break;
                session.position = message.body().get("position");
                session.cogDeg = message.number("cogDeg");
                session.sogKn = message.number("sogKn");
                session.revision = message.text("revision");
                session.fixAt = message.at();
                // NOT persisted and never replayed. A fix is a statement about now; a stale one
                // is not a smaller truth, it is a wrong one (§4.1).
            }
            case "crossing" ->
            {
                if (session == null)
                    break;
                session.step = message.number("step") == null ? null : message.number("step").intValue();
                session.lap = message.number("lap") == null ? 1 : message.number("lap").intValue();
                session.line = message.text("line");
                if (session.startedAt == null)
                    session.startedAt = message.text("instant");
                session.lastCrossingAt = message.text("instant");
                session.crossings++;
                if (Boolean.TRUE.equals(message.body().get("finish")))
                    finish(session, message.text("instant"));
                session.touch();
            }
            case "record" ->
            {
                /*
                 * THE LIVE CROSSINGS WERE ADVISORY; THIS IS THE ARTEFACT (§8.3).
                 *
                 * Filed through the SAME store the REST endpoint writes to, because it is the
                 * same thing arriving by another road — which also means the same superseding
                 * rule applies: a second post of one run replaces the first rather than
                 * accumulating, and the ordinary reason for a second post is the full track
                 * arriving later over wifi.
                 *
                 * A record that cannot be filed is REFUSED with a sentence, because a boat that
                 * has finished and been told nothing will assume its race was recorded.
                 */
                if (session == null)
                    break;
                try
                {
                    CourseRecord record = RECORDS.convertValue(
                        message.body().get("record"), CourseRecord.class);
                    // Filed under the CLUB's race day, which is what the club's timezone is
                    // for — not the boat's, so a visitor on another zone lands on the same day
                    // as everybody who sailed with them.
                    store.save(record, programmes.zone(record.club(), record.series()));
                    session.recorded = true;
                    LOG.info("Record from {} ({}) on {} rev {} — {} crossing(s)",
                        record.boatName(), record.sailNumber(), record.course(),
                        record.courseRevision(), record.crossings().size());
                }
                catch (Exception e)
                {
                    LOG.warn("Could not file a record from {}", session.boatId, e);
                    out.add(Envelope.of("rejected", Map.of(
                        "code", "record",
                        "text", "That record could not be filed: " + e.getMessage()
                            + ". Your crossings are still on the phone — try again later.")));
                }
            }
            case "retire" ->
            {
                if (session == null)
                    break;
                session.outcome = "retired";
                session.outcomeReason = message.text("reason");
                say(session.room, session.sailNo, (session.sailNo == null ? "A boat" : session.sailNo)
                    + " has retired" + reason(message.text("reason")), List.of());
                // A RETIREMENT IS STILL AN ENTRY TO THE NEXT RACE (§12.6): retiring from race
                // one is a statement about race one, and a sailor who has had enough of the day
                // says so by leaving.
                chain(session, out);
                session.touch();
            }
            case "say" ->
            {
                if (session == null || session.room == null)
                    break;
                String text = message.text("text");
                if (text == null || text.isBlank())
                    break;
                say(session.room, session.sailNo == null ? "boat" : session.sailNo,
                    text.length() > MAX_SAY ? text.substring(0, MAX_SAY) : text, List.of());
            }
            case "ack" ->
            {
                if (session == null || session.room == null)
                    break;
                String of = message.text("ackOf");
                if (of != null)
                {
                    session.room.acks.computeIfAbsent(of, k -> new LinkedHashSet<>()).add(session.boatId);
                    session.room.dirty = true;
                }
            }
            case "channel.since" ->
            {
                // THE CHANNEL IS THE ONE THING THAT IS REPLAYED, because a channel IS a history
                // and what was said cannot be summarised into a current value (§4.1). The gap
                // arrives as the ORIGINAL envelopes, ids and all — which is what makes it
                // idempotent, and why a client that has already acknowledged one of them shows
                // the entry again without raising the alert again.
                if (session == null || session.room == null)
                    break;
                out.addAll(session.room.since(message.text("after"), session.tags));
            }
            default ->
            {
                // UNKNOWN TYPES ARE IGNORED AND COUNTED (§5 rule 3). An old client meeting a new
                // message must carry on; so must a new server meeting an old one's.
                unknown.incrementAndGet();
                LOG.debug("Ignoring unknown message type {}", message.type());
            }
        }
        return null;
    }

    private final AtomicLong unknown = new AtomicLong();

    /** How many messages of types this build does not know have arrived. §5 rule 3. */
    public long unknownMessages()
    {
        return unknown.get();
    }

    /* =========================================================================== joining */

    /**
     * A boat takes a course, and whether there is a RACE behind it decides everything else.
     *
     * <p>§8.2: a join with no race behind it gets no channel — there is nobody to communicate
     * with — and from that the rest follows without a second decision: no fixes, no fleet, no
     * timers and no flags. What is left is the join, the crossings and the record, which is
     * exactly what the record needs and nothing more.
     *
     * <p>The race is FOUND rather than asked for. A boat drills club → series → course →
     * variant, which is what a sailor holds; the race is whichever one today maps a division to
     * that course and variant. So the same join message serves both cases and the client does
     * not have to know which it is in.
     */
    private Session join(Envelope message, List<Envelope> out) throws IOException
    {
        String club = message.text("club");
        String series = message.text("series");
        String courseId = message.text("course");
        String variantId = message.text("variant");
        Programme programme = programmes.programme(club, series).orElse(null);
        Course course = programme == null ? null : programme.courses().get(courseId);
        if (course == null)
        {
            out.add(reject("course", "No such course: " + courseId));
            return null;
        }
        String variant = variantId == null || variantId.isBlank() ? soleVariant(course) : variantId;
        if (variant == null)
        {
            out.add(reject("variant", "This course has variants — say which: "
                + String.join(", ", course.variants().keySet())));
            return null;
        }
        String revision = ledger.read(club).publishedRevision(series, courseId, variant).orElse(null);
        CourseSnapshot snapshot = revision == null ? null : store.course(revision).orElse(null);
        if (snapshot == null)
        {
            out.add(reject("unpublished", "Nothing is published for " + courseId + "/" + variant
                + ", so there is nothing to hand you."));
            return null;
        }

        Race race = raceFor(programme, message.text("race"), courseId, variant);
        /*
         * THE BOAT'S OWN ANSWER FIRST, and the guess only where it did not give one.
         *
         * A client that names its division has settled the question that {@code ask} exists for
         * (§8.2), and it is the only thing that can settle it once two divisions sail one
         * course: matching by course works while the mapping is one-to-one and quietly picks
         * the first where it is not. A name that is not a division of this race is ignored
         * rather than obeyed — it is a boat describing a race it is not in.
         */
        String named = message.text("division");
        String division = race == null ? null
            : (named != null && race.divisions().containsKey(named)
                ? named : divisionFor(race, courseId, variant));

        Session session = new Session("s" + Long.toHexString(counter.incrementAndGet()));
        session.sailNo = message.text("sailNo");
        session.name = message.text("name");
        session.boatId = session.sailNo == null || session.sailNo.isBlank()
            ? session.id : session.sailNo;
        session.tcf = message.number("tcf");
        session.revision = revision;
        session.club = club;
        session.series = series;
        session.tags = division == null ? List.of() : List.of(Race.tagFor(division));
        if (race != null)
            session.room = room(programme, race);
        sessions.put(session.id, session);
        if (session.room != null)
            session.room.enter(session);

        Map<String, Object> body = Envelope.fields();
        body.put("session", session.id);
        body.put("boatId", session.boatId);
        body.put("race", race == null ? null : race.id());
        body.put("raceName", race == null ? null : race.name());
        body.put("tags", session.tags);
        body.put("revision", revision);
        // JOINED CARRIES THE COURSE, NOT A REFERENCE TO IT (§8.2). A boat that has to fetch
        // before it can sail is a boat that cannot join on a flaky connection.
        body.put("course", snapshot);
        // FIXES STOP WHEN THERE IS NO FLEET, and this absence is how the boat is told. On a
        // phone in a bracket for four hours, reporting to nobody is battery and data spent for
        // nothing (§8.2).
        if (race != null)
            body.put("fixSeconds", FIX_SECONDS);
        out.add(Envelope.of("joined", session.tags, body));

        if (session.room != null)
        {
            // The afternoon so far, in place, then what is true NOW. In that order, because the
            // backlog is a log being caught up and the state is not (§4.1).
            out.addAll(session.room.since(null, session.tags));
            out.addAll(session.room.restate(session.tags));
            say(session.room, "committee", (session.sailNo == null ? "A boat" : session.sailNo)
                + " joined" + (division == null ? "" : " in division " + division), List.of());
        }
        return session;
    }

    private static Envelope reject(String code, String text)
    {
        // BOTH a code and a sentence (§8.1): a code cannot be shown to somebody and a sentence
        // cannot be acted on.
        return Envelope.of("rejected", Map.of("code", code, "text", text));
    }

    private static String soleVariant(Course course)
    {
        List<String> joinable = course.variants().entrySet().stream()
            .filter(e -> !e.getValue().template())
            .map(Map.Entry::getKey)
            .toList();
        return joinable.size() == 1 ? joinable.get(0) : null;
    }

    /** The race a course and variant are being sailed as today, or null — which is §8.2's case. */
    private Race raceFor(Programme programme, String named, String courseId, String variant)
    {
        if (named != null && !named.isBlank())
            return programme.races().get(named);
        LocalDate today = LocalDate.now(ZoneId.of(programme.timezone()));
        for (Race race : programme.races().values())
        {
            if (race.on(today) && divisionFor(race, courseId, variant) != null)
                return race;
        }
        return null;
    }

    /**
     * Which division of this race sails that course and variant.
     *
     * <p><b>This is the whole of how a boat gets a division today, and it is enough for one
     * division per course and WRONG the moment two share one.</b> Two divisions sailing the
     * same variant — a handicap split over one course, which is an ordinary thing to want —
     * would both match here and the first would win. The fix is {@code ask} (§8.2): a question
     * is a gap in what the server knows, and that is exactly what this would be. Until then a
     * race wanting two divisions on one shape needs two variants, which is a real design of a
     * course either way.
     */
    private static String divisionFor(Race race, String courseId, String variant)
    {
        for (Map.Entry<String, Race.Division> e : race.divisions().entrySet())
        {
            Race.Division division = e.getValue();
            if (!courseId.equals(division.course()))
                continue;
            if (division.variant() == null || division.variant().isBlank()
                || division.variant().equals(variant))
                return e.getKey();
        }
        return null;
    }

    /**
     * A boat that has stopped racing is entered for the next race of the day (§12.6).
     *
     * <p><b>A division the next race does not have breaks the chain, and that is the safe way
     * round.</b> Entering a boat with a tag that maps to no course would put it on the fleet list
     * with nothing to sail and no moment at which anybody found out; breaking the chain means the
     * sailor discovers it when they look, which is before the start rather than after it.
     */
    private void chain(Session session, List<Envelope> out)
    {
        Room room = session.room;
        if (room == null || room.race.next() == null)
            return;
        Programme programme = programmes.programme(room.club, room.series).orElse(null);
        Race next = programme == null ? null : programme.races().get(room.race.next());
        if (next == null || !next.on(room.race.date()))
            return;                      // not the same day: a weekly series is not a regatta
        String division = session.tags.stream()
            .map(Race::divisionOf).filter(java.util.Objects::nonNull).findFirst().orElse(null);
        Race.Division into = division == null ? null : next.divisions().get(division);
        if (into == null)
            return;                      // the chain does not fire, and says nothing false
        String revision = ledger.read(room.club)
            .publishedRevision(room.series, into.course(), into.variant()).orElse(null);
        CourseSnapshot snapshot = revision == null ? null : store.course(revision).orElse(null);
        if (snapshot == null)
            return;

        Room to = room(programme, next);
        room.leave(session);
        session.room = to;
        session.revision = revision;
        session.reset();
        to.enter(session);

        Map<String, Object> body = Envelope.fields();
        body.put("session", session.id);
        body.put("boatId", session.boatId);
        body.put("race", next.id());
        body.put("raceName", next.name());
        body.put("tags", session.tags);
        body.put("revision", revision);
        body.put("course", snapshot);
        body.put("fixSeconds", FIX_SECONDS);
        body.put("reason", "the next race of the day");
        // THE SAME MESSAGE, UNASKED (§8.2). The client has nothing special to do beyond
        // noticing that the race it is in has changed.
        out.add(Envelope.of("joined", session.tags, body));
        out.addAll(to.restate(session.tags));
    }

    private void finish(Session session, String instant)
    {
        session.finishedAt = instant;
        if (session.outcome == null)
            session.outcome = "finished";
    }

    private static String reason(String reason)
    {
        return reason == null || reason.isBlank() ? "." : ": " + reason;
    }

    private boolean fleetDue(Session session)
    {
        Instant now = Instant.now();
        if (session.fleetAt != null && session.fleetAt.plusSeconds(FLEET_SECONDS).isAfter(now))
            return false;
        session.fleetAt = now;
        return true;
    }

    /* ================================================================ the committee's side */

    /** The room for one race, created on first use and restored from the store. */
    public Room room(Programme programme, Race race)
    {
        String key = programme.club() + "/" + programme.series() + "/" + race.id();
        return rooms.computeIfAbsent(key, k ->
        {
            Room room = new Room(programme.club(), programme.series(), race);
            room.restore(store.conduct(programme.club(), programme.series(), race.id()).orElse(null));
            return room;
        });
    }

    public Optional<Room> room(String club, String series, String raceId)
    {
        Programme programme = programmes.programme(club, series).orElse(null);
        Race race = programme == null ? null : programme.races().get(raceId);
        return race == null ? Optional.empty() : Optional.of(room(programme, race));
    }

    /**
     * The committee publishes: a start, a flag, a course, a message, an outcome.
     *
     * <p><b>Every one of these is STATE, not an event</b> (§9.4), and that is why publishing is
     * this shape: the standing per tag is replaced, a receipt is written into the channel, and
     * the message is queued for every boat the tag addresses. A boat that missed it and comes
     * back is re-stated rather than caught up.
     *
     * <p>There is no GO button anywhere near this, and that follows from §1.2: the server keeps
     * no clock, so a start cannot be triggered. It is scheduled as an absolute instant, and the
     * arithmetic that turned "in five minutes" into that instant happened in the operator's
     * browser against the operator's clock.
     */
    public Envelope publish(Room room, Envelope message)
    {
        Envelope sent = new Envelope(Envelope.V1, message.type(), null, null,
            message.tags(), message.body());
        switch (message.type())
        {
            case "timer", "window" ->
            {
                // PUBLISHING A START SUPERSEDES BOTH the previous start and any postponement on
                // that tag (§8.4). That is the whole of the cycle: publish → AP → edit →
                // publish, with the last message to arrive being the state.
                for (String tag : room.tagsOf(sent))
                {
                    Standing standing = room.standing(tag);
                    standing.timer = sent;
                    standing.flag = null;
                }
            }
            case "flag" ->
            {
                for (String tag : room.tagsOf(sent))
                {
                    Standing standing = room.standing(tag);
                    standing.flag = sent;
                    if ("postponed".equals(sent.text("flag")))
                        standing.timer = null;   // AP voids the start; it does not reschedule it
                }
            }
            case "course" ->
            {
                for (String tag : room.tagsOf(sent))
                    room.standing(tag).course = sent;
            }
            case "outcome" ->
            {
                String boatId = sent.text("boatId");
                for (Session session : room.boats())
                {
                    if (boatId != null && boatId.equals(session.boatId))
                    {
                        session.outcome = sent.text("outcome");
                        session.outcomeReason = sent.text("reason");
                    }
                }
            }
            default ->
            {
                // `say` and anything else: a channel entry and nothing more.
            }
        }
        room.append(sent);
        room.send(sent);
        persist(room);
        return sent;
    }

    /** A line in the channel from the committee or from a boat. */
    public Envelope say(Room room, String from, String text, List<String> tags)
    {
        if (room == null)
            return null;
        Map<String, Object> body = Envelope.fields();
        body.put("from", from);
        body.put("text", text);
        Envelope sent = Envelope.of("say", tags, body);
        room.append(sent);
        room.send(sent);
        persist(room);
        return sent;
    }

    private void persist(Room room)
    {
        try
        {
            store.saveConduct(room.club, room.series, room.race.id(), room.document());
            room.dirty = false;
        }
        catch (IOException e)
        {
            // Not fatal: the conversation goes on in memory and the fleet notices nothing. A
            // race that cannot be written down is still a race being run.
            LOG.warn("Could not write conduct for {}", room.race.id(), e);
        }
    }

    /* ===================================================================== what a room is */

    /**
     * One race, live: who is in it, what has been said, and what state each division is in.
     *
     * <p>The channel belongs to the race, and that is what bounds it (§8.4): a race's log is as
     * long as a race, a joining boat is sent that race's messages and no others, and a day of
     * chained races is a series of separate conversations rather than one that grows all
     * afternoon.
     */
    public class Room
    {
        public final String club;
        public final String series;
        public final Race race;
        final List<Envelope> channel = new ArrayList<>();
        final Map<String, Standing> standings = new LinkedHashMap<>();
        final Map<String, Set<String>> acks = new LinkedHashMap<>();
        final Map<String, Session> boats = new LinkedHashMap<>();
        volatile boolean dirty;

        Room(String club, String series, Race race)
        {
            this.club = club;
            this.series = series;
            this.race = race;
        }

        Standing standing(String tag)
        {
            return standings.computeIfAbsent(tag, k -> new Standing());
        }

        /**
         * Which tags a message applies to.
         *
         * <p>An untagged message is for everybody, which for a STANDING means every division
         * this race has — a fleet-wide abandonment has to become each division's state, or a
         * division would go on believing it was racing.
         */
        List<String> tagsOf(Envelope message)
        {
            if (!message.tags().isEmpty())
                return message.tags();
            List<String> all = new ArrayList<>();
            for (String division : race.divisions().keySet())
                all.add(Race.tagFor(division));
            return all.isEmpty() ? List.of("") : all;
        }

        void enter(Session session)
        {
            boats.put(session.boatId, session);
            dirty = true;
        }

        void leave(Session session)
        {
            boats.remove(session.boatId, session);
        }

        public Collection<Session> boats()
        {
            return boats.values();
        }

        void append(Envelope entry)
        {
            channel.add(entry);
            while (channel.size() > CHANNEL_LIMIT)
                channel.remove(0);
            dirty = true;
        }

        /** Queue a message for every boat it is addressed to. */
        void send(Envelope message)
        {
            for (Session session : boats.values())
            {
                if (message.addressedTo(session.tags))
                    session.queue.add(message);
            }
        }

        /** The channel after an id — the gap a reconnecting boat asks for (§4.1). */
        List<Envelope> since(String after, List<String> tags)
        {
            List<Envelope> out = new ArrayList<>();
            boolean take = after == null || after.isBlank();
            for (Envelope entry : channel)
            {
                if (!take)
                {
                    if (entry.id().equals(after))
                        take = true;
                    continue;
                }
                if (entry.addressedTo(tags))
                    out.add(entry);
            }
            return out;
        }

        /**
         * WHAT IS TRUE NOW, as ordinary messages (§4.1).
         *
         * <p>A boat that was away for two minutes does not want the two minutes. It wants which
         * course it is sailing, whether its division is postponed, and when it starts — so the
         * current standing is re-sent as the same {@code course}, {@code timer} and {@code flag}
         * messages it would have had at the time. They are not marked as a catch-up, because the
         * entry says *this is the course you are on* and that is true whenever it arrives.
         */
        List<Envelope> restate(List<String> tags)
        {
            List<Envelope> out = new ArrayList<>();
            for (Map.Entry<String, Standing> e : standings.entrySet())
            {
                if (!tags.isEmpty() && !tags.contains(e.getKey()) && !e.getKey().isEmpty())
                    continue;
                Standing standing = e.getValue();
                for (Envelope current : List.of(
                    standing.course == null ? NONE : standing.course,
                    standing.timer == null ? NONE : standing.timer,
                    standing.flag == null ? NONE : standing.flag))
                {
                    if (current != NONE)
                        out.add(current);
                }
            }
            return out;
        }

        /** Every boat in the race, as one message (§8.4). */
        Envelope fleet()
        {
            List<Map<String, Object>> boatList = new ArrayList<>();
            for (Session session : boats.values())
                boatList.add(session.asFleetEntry());
            Map<String, Object> body = Envelope.fields();
            body.put("boats", boatList);
            body.put("race", race.id());
            return Envelope.of("fleet", body);
        }

        /**
         * What the race screen reads: the fleet table, the channel, the states, the acks.
         *
         * <p>Over REST rather than through the dialog, for now. The committee IS a participant
         * (§12.3) and its messages go into the same channel — this is a laptop on a desk polling
         * a page, not a second facility. TODO: give the screen a session of its own so it is one
         * party in the conversation rather than a reader of it.
         */
        public Map<String, Object> conduct()
        {
            Map<String, Object> out = Envelope.fields();
            out.put("club", club);
            out.put("series", series);
            out.put("race", race);
            List<Map<String, Object>> boatList = new ArrayList<>();
            for (Session session : boats.values())
            {
                Map<String, Object> entry = session.asFleetEntry();
                entry.put("session", session.id);
                entry.put("fixAgeMs", session.fixAgeMs());
                entry.put("crossings", session.crossings);
                entry.put("outcome", session.outcome);
                entry.put("outcomeReason", session.outcomeReason);
                entry.put("seen", acksOf(session));
                boatList.add(entry);
            }
            out.put("boats", boatList);
            out.put("channel", channel);
            out.put("acks", acks);
            Map<String, Object> states = Envelope.fields();
            standings.forEach((tag, standing) -> states.put(tag, standing.describe(this)));
            out.put("states", states);
            return out;
        }

        /**
         * Which of the things that MUST be seen this boat has acknowledged.
         *
         * <p>That is the whole reason acknowledgements are in the protocol (§12.4): the question
         * a committee genuinely has before starting is *have all boats seen the new course?*, and
         * without somewhere to read the answer the acks are bookkeeping nobody looks at.
         */
        Map<String, Object> acksOf(Session session)
        {
            Map<String, Object> seen = Envelope.fields();
            for (Standing standing : standings.values())
            {
                if (standing.course != null)
                    seen.put("course", acked(standing.course.id(), session.boatId));
                if (standing.flag != null)
                    seen.put("flag", acked(standing.flag.id(), session.boatId));
            }
            return seen;
        }

        boolean acked(String id, String boatId)
        {
            Set<String> who = acks.get(id);
            return who != null && who.contains(boatId);
        }

        /** The conduct document, as it is written to the store. */
        Map<String, Object> document()
        {
            Map<String, Object> out = Envelope.fields();
            out.put("club", club);
            out.put("series", series);
            out.put("race", race.id());
            out.put("channel", channel);
            out.put("acks", acks);
            Map<String, Object> standing = Envelope.fields();
            standings.forEach((tag, value) -> standing.put(tag, value.document()));
            out.put("standings", standing);
            List<Map<String, Object>> entries = new ArrayList<>();
            for (Session session : boats.values())
            {
                Map<String, Object> entry = Envelope.fields();
                entry.put("boatId", session.boatId);
                entry.put("sailNo", session.sailNo);
                entry.put("name", session.name);
                entry.put("tags", session.tags);
                entry.put("tcf", session.tcf);
                entry.put("startedAt", session.startedAt);
                entry.put("finishedAt", session.finishedAt);
                entry.put("outcome", session.outcome);
                entry.put("recorded", session.recorded);
                entries.add(entry);
            }
            out.put("entries", entries);
            return out;
        }

        /**
         * Come back to a race that was already being run.
         *
         * <p>What is restored is the CHANNEL and the STANDINGS — what the fleet was told — and
         * not the sessions: a session is a live connection, and a boat that was talking to a
         * server that restarted has to join again. That is the honest division, and it is why a
         * re-join re-states rather than resumes.
         */
        @SuppressWarnings("unchecked")
        void restore(Map<String, Object> document)
        {
            if (document == null)
                return;
            try
            {
                if (document.get("channel") instanceof List<?> held)
                {
                    for (Object raw : held)
                    {
                        if (raw instanceof Map<?, ?> map)
                            channel.add(envelope((Map<String, Object>)map));
                    }
                }
                if (document.get("acks") instanceof Map<?, ?> held)
                {
                    held.forEach((id, who) ->
                    {
                        if (who instanceof Collection<?> list)
                        {
                            Set<String> set = new LinkedHashSet<>();
                            list.forEach(v -> set.add(String.valueOf(v)));
                            acks.put(String.valueOf(id), set);
                        }
                    });
                }
                if (document.get("standings") instanceof Map<?, ?> held)
                {
                    held.forEach((tag, value) ->
                    {
                        if (value instanceof Map<?, ?> map)
                            standings.put(String.valueOf(tag),
                                Standing.from((Map<String, Object>)map));
                    });
                }
            }
            catch (Exception e)
            {
                LOG.warn("Could not restore conduct for {}", race.id(), e);
            }
        }
    }

    /** A placeholder for "nothing published", so the re-statement can skip it in one place. */
    private static final Envelope NONE = Envelope.of("none", Map.of());

    @SuppressWarnings("unchecked")
    static Envelope envelope(Map<String, Object> map)
    {
        Object tags = map.get("tags");
        List<String> tagList = new ArrayList<>();
        if (tags instanceof Collection<?> list)
            list.forEach(v -> tagList.add(String.valueOf(v)));
        Object body = map.get("body");
        return new Envelope(
            map.get("v") instanceof Number n ? n.intValue() : Envelope.V1,
            String.valueOf(map.get("type")),
            map.get("id") == null ? null : String.valueOf(map.get("id")),
            map.get("at") == null ? null : String.valueOf(map.get("at")),
            tagList,
            body instanceof Map<?, ?> m ? (Map<String, Object>)m : Map.of());
    }

    /**
     * ONE DIVISION'S STATE, which is the reduction of everything published to its tag.
     *
     * <p>Three fields, because there are three kinds of thing that are state rather than event: a
     * course, a start, and a flag. Nobody has to be TOLD what state a division is in — it follows
     * from what has been published (§8.5), which is what makes the same little machine run the
     * same way on the server, on the race screen and on every boat.
     */
    public static class Standing
    {
        public Envelope timer;
        public Envelope flag;
        public Envelope course;

        Map<String, Object> document()
        {
            Map<String, Object> out = Envelope.fields();
            out.put("timer", timer);
            out.put("flag", flag);
            out.put("course", course);
            return out;
        }

        static Standing from(Map<String, Object> map)
        {
            Standing standing = new Standing();
            if (map.get("timer") instanceof Map<?, ?> m)
                standing.timer = envelope(cast(m));
            if (map.get("flag") instanceof Map<?, ?> m)
                standing.flag = envelope(cast(m));
            if (map.get("course") instanceof Map<?, ?> m)
                standing.course = envelope(cast(m));
            return standing;
        }

        @SuppressWarnings("unchecked")
        private static Map<String, Object> cast(Map<?, ?> map)
        {
            return (Map<String, Object>)map;
        }

        /**
         * The state machine of §8.5, run here for the race screen's benefit.
         *
         * <p><b>The server is not the authority on this and does not need to be</b>: every party
         * runs the same machine over the same events and arrives at the same answer, which is
         * the point of state being the events applied as they arrive. The one term that needs a
         * clock — has the start passed — is answered against each reader's own clock, so this
         * answer is the server's own reading and nothing turns on it (§1.2).
         */
        Map<String, Object> describe(Dialog.Room room)
        {
            Map<String, Object> out = Envelope.fields();
            String state = "none";
            if (flag != null && "abandoned".equals(flag.text("flag")))
                state = "abandoned";
            else if (flag != null && "postponed".equals(flag.text("flag")))
                state = "postponed";
            else if (timer != null)
            {
                String startAt = timer.text("startAt");
                boolean gone = false;
                try
                {
                    gone = startAt != null && Instant.parse(startAt).isBefore(Instant.now());
                }
                catch (Exception e)
                {
                    gone = false;
                }
                state = gone ? "racing" : "scheduled";
            }
            if ("racing".equals(state) && !room.boats().isEmpty()
                && room.boats().stream().allMatch(b -> b.outcome != null))
                state = "finished";
            out.put("state", state);
            out.put("timer", timer);
            out.put("flag", flag);
            out.put("course", course);
            return out;
        }
    }

    /**
     * One boat's live connection.
     *
     * <p>Everything on it came from the boat, and nothing here is computed about it beyond
     * arithmetic on what it said: elapsed is the difference between two of its own instants, and
     * its place on a ladder is the order of those differences. §1.1 is the rule and this is what
     * keeping it looks like in a field list.
     */
    public class Session
    {
        public final String id;
        public String boatId;
        public String sailNo;
        public String name;
        public String club;
        public String series;
        public List<String> tags = List.of();
        public Double tcf;
        public String revision;
        Room room;
        final Deque<Envelope> queue = new ArrayDeque<>();
        Instant lastSeen = Instant.now();
        Instant fleetAt;

        Object position;
        Double cogDeg;
        Double sogKn;
        String fixAt;
        Integer step;
        int lap = 1;
        String line;
        int crossings;
        String startedAt;
        String lastCrossingAt;
        String finishedAt;
        public String outcome;
        String outcomeReason;
        boolean recorded;

        Session(String id)
        {
            this.id = id;
        }

        void touch()
        {
            if (room != null)
                room.dirty = true;
        }

        void reset()
        {
            step = null;
            lap = 1;
            line = null;
            crossings = 0;
            startedAt = null;
            lastCrossingAt = null;
            finishedAt = null;
            outcome = null;
            outcomeReason = null;
        }

        void leave()
        {
            if (room != null)
                room.leave(this);
        }

        Long fixAgeMs()
        {
            if (fixAt == null)
                return null;
            try
            {
                return Math.max(0, Instant.now().toEpochMilli() - Instant.parse(fixAt).toEpochMilli());
            }
            catch (Exception e)
            {
                return null;
            }
        }

        /** Elapsed, from the boat's own two instants. Nothing else could be honest (§1.1). */
        Long elapsedMs()
        {
            if (startedAt == null)
                return null;
            try
            {
                String to = finishedAt != null ? finishedAt : lastCrossingAt;
                if (to == null)
                    return null;
                return Instant.parse(to).toEpochMilli() - Instant.parse(startedAt).toEpochMilli();
            }
            catch (Exception e)
            {
                return null;
            }
        }

        Map<String, Object> asFleetEntry()
        {
            Map<String, Object> entry = Envelope.fields();
            entry.put("boatId", boatId);
            entry.put("sailNo", sailNo);
            entry.put("name", name);
            entry.put("tags", tags);
            entry.put("position", position);
            entry.put("cogDeg", cogDeg);
            entry.put("sogKn", sogKn);
            entry.put("revision", revision);
            entry.put("step", step);
            entry.put("lap", lap);
            entry.put("line", line);
            entry.put("startedAt", startedAt);
            entry.put("finishedAt", finishedAt);
            entry.put("elapsedMs", elapsedMs());
            entry.put("tcf", tcf);
            entry.put("outcome", outcome);
            entry.put("at", fixAt);
            return entry;
        }
    }
}
