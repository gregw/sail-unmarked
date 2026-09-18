package org.mortbay.sailing.unmarked.store;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Which snapshots a club has taken, and which of them boats are being given.
 *
 * <p>One JSON document per club, under {@code <root>/store/ledger/{club}.json}, holding two
 * things: an ordered list of the snapshots taken, and a map from course/variant to the
 * revision currently published for it. The snapshot bodies themselves live in
 * {@link JsonStore}, addressed by revision; this is the index over them.
 *
 * <h2>Why one document, and why per club</h2>
 * Publishing has to work at two scopes: one variant on its own, and several variants
 * <b>atomically</b> — a line common to three variants is moved on race morning, and either
 * all three change or those fleets are racing to inconsistent instructions. The atomicity
 * is the constraint with teeth, because it means the pointers being moved have to commit
 * together, and a document written atomically is the cheapest way to get that without a
 * database.
 *
 * <p>Club-scoped rather than per-course or per-series, because the thing that forces a
 * multi-variant publish is a <em>shared named line</em>, and a shared line can dirty
 * variants across different courses and different series. Anything narrower would leave the
 * one case atomicity exists for spanning two documents.
 *
 * <h2>Nothing is ever quietly removed</h2>
 * A snapshot that has been replaced by a newer publication is kept, and so is one whose
 * variant or course has since been deleted. A record names a revision, and a record whose
 * geometry cannot be retrieved is a time with no course attached — unscoreable,
 * unprotestable and comparable with nothing. Retiring a course is not a reason to make last
 * season's results meaningless. Snapshots go only when somebody explicitly deletes one.
 */
public class CourseLedger
{
    private static final Logger LOG = LoggerFactory.getLogger(CourseLedger.class);

    private static final JsonMapper MAPPER = JsonMapper.builder()
        .addModule(new JavaTimeModule())
        .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
        .enable(SerializationFeature.INDENT_OUTPUT)
        .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
        .build();

    private final Path ledgerDir;
    private final List<String> loadErrors = new ArrayList<>();

    public CourseLedger(Path dataRoot)
    {
        this.ledgerDir = dataRoot.resolve("store").resolve("ledger");
    }

    public void start() throws IOException
    {
        Files.createDirectories(ledgerDir);
    }

    /**
     * How a variant is addressed in the publications map: {@code series/course/variant}.
     *
     * <p>The series is in the key rather than in the filename because the document is
     * club-wide — see the class note on why atomicity puts it there.
     */
    public static String key(String series, String course, String variant)
    {
        return series + "/" + course + "/" + variant;
    }

    /** One club's ledger, or an empty one. Never throws: a bad file reads as empty and says so. */
    public Ledger read(String club)
    {
        Path file = file(club);
        if (!Files.isRegularFile(file))
            return new Ledger(club, List.of(), Map.of(), List.of());
        try
        {
            return MAPPER.readValue(Files.readAllBytes(file), Ledger.class);
        }
        catch (IOException e)
        {
            // Defensive, like every other read here. A club whose ledger will not parse
            // loses its publication pointers until somebody looks, which is bad; taking the
            // server down so nobody can look at all is worse.
            loadErrors.add(file + ": " + e.getMessage());
            LOG.error("Could not read ledger {}", file, e);
            return new Ledger(club, List.of(), Map.of(), List.of());
        }
    }

    /**
     * Add a snapshot to the index, unless the same revision is already recorded for the
     * same variant.
     *
     * <p>Taking a second snapshot of an unchanged variant is a no-op rather than a duplicate
     * row: the revision is the geometry, so two entries would be two names for one thing and
     * the "is this dirty?" comparison would start depending on which of them was found
     * first.
     */
    public synchronized Taken take(String club, String series, String course, String variant,
        String revision, String label, Instant at) throws IOException
    {
        Ledger ledger = read(club);
        Optional<Entry> existing = ledger.snapshots().stream()
            .filter(e -> e.matches(series, course, variant) && e.revision().equals(revision))
            .findFirst();
        if (existing.isPresent())
            return new Taken(existing.get(), false);

        Entry entry = new Entry(series, course, variant, revision, label, at);
        List<Entry> snapshots = new ArrayList<>(ledger.snapshots());
        snapshots.add(entry);
        write(new Ledger(club, snapshots, ledger.published(), ledger.log()));
        return new Taken(entry, true);
    }

    /**
     * Move publication pointers, all of them or none.
     *
     * <p>One variant and several variants are the same operation at different scope, which
     * is why there is no separate single-variant call: making the narrow case its own method
     * would give the wide case a second code path to disagree with.
     *
     * <p>A publish <b>replaces</b> the previous publication for that variant rather than
     * appending to it. A course has one live design per variant; offering a fleet a choice
     * of vintages would be a way to start a race with two different courses on the water.
     * The snapshot that was replaced stays in the index.
     *
     * <p><b>The audit events land in the same write as the pointers.</b> That is the whole
     * reason they live in this document rather than a log file beside it: an event written
     * separately can be lost by a crash between the two, and an audit trail that is missing
     * the entry for something a fleet was handed is worse than no audit trail, because it
     * reads as proof that the thing never happened. The caller decides which of the pointer
     * moves are publicly visible — this class does not know which courses are public, since
     * that lives in the programme file — and passes the events it wants recorded.
     */
    public synchronized Ledger publish(String club, List<Publication> publications,
        List<Publication> withdrawals, List<Event> events) throws IOException
    {
        Ledger ledger = read(club);
        Map<String, String> published = new LinkedHashMap<>(ledger.published());
        // Checked before anything is changed, so a bad revision in the fourth entry cannot
        // leave the first three published. All or none has to mean all or none.
        for (Publication p : publications)
        {
            boolean known = ledger.snapshots().stream()
                .anyMatch(e -> e.matches(p.series(), p.course(), p.variant())
                    && e.revision().equals(p.revision()));
            if (!known)
                throw new IllegalArgumentException("no snapshot " + p.revision() + " for "
                    + key(p.series(), p.course(), p.variant()) + " — take one first");
        }
        for (Publication p : withdrawals)
            published.remove(key(p.series(), p.course(), p.variant()));
        for (Publication p : publications)
            published.put(key(p.series(), p.course(), p.variant()), p.revision());
        Ledger updated = new Ledger(club, ledger.snapshots(), published, appended(ledger, events));
        write(updated);
        return updated;
    }

    /**
     * Take a snapshot out of the index.
     *
     * <p><b>The archived geometry is not touched.</b> A record names a revision, and a
     * record whose geometry cannot be retrieved is a time with no course attached —
     * unscoreable and comparable with nothing. So this is a deletion from the <em>list</em>:
     * the snapshot stops being offered, stops being what "dirty" is measured against, and
     * stays readable through {@code GET /api/courses/{revision}} for as long as anything
     * points at it. A few kilobytes is a cheap price for never orphaning a result.
     *
     * <p>Refused while it is the published one. Withdraw or replace the publication first —
     * deleting what a fleet is currently being handed is not something to do by accident.
     */
    public synchronized Ledger forget(String club, String series, String course, String variant,
        String revision) throws IOException
    {
        Ledger ledger = read(club);
        if (revision.equals(ledger.publishedRevision(series, course, variant).orElse(null)))
            throw new IllegalArgumentException(
                "that snapshot is the published one — publish another or withdraw it first");
        List<Entry> kept = ledger.snapshots().stream()
            .filter(e -> !(e.matches(series, course, variant) && e.revision().equals(revision)))
            .toList();
        if (kept.size() == ledger.snapshots().size())
            throw new IllegalArgumentException("no such snapshot: " + revision);
        Ledger updated = new Ledger(club, kept, ledger.published(), ledger.log());
        write(updated);
        LOG.info("Forgot snapshot {} of {}/{} — its geometry is kept", revision, club,
            key(series, course, variant));
        return updated;
    }

    /**
     * Follow a series rename through the ledger.
     *
     * <p>The series is embedded in both the publication keys ({@code series/course/variant})
     * and every snapshot entry, so a file rename alone would orphan every publication a
     * club had made — the courses would still be there and nothing would be joinable.
     *
     * <p>Done in the <b>same atomic document write</b> that backs multi-variant publish, so
     * a crash mid-rename leaves the ledger as it was rather than half-remapped. Records need
     * no migration at all: they are filed {@code records/club/course/date/…}, with no series
     * in the path.
     */
    public synchronized Ledger renameSeries(String club, String from, String to) throws IOException
    {
        Ledger ledger = read(club);
        if (from.equals(to))
            return ledger;
        List<Entry> snapshots = ledger.snapshots().stream()
            .map(e -> e.series().equals(from)
                ? new Entry(to, e.course(), e.variant(), e.revision(), e.label(), e.takenAt())
                : e)
            .toList();
        Map<String, String> published = new LinkedHashMap<>();
        ledger.published().forEach((key, revision) ->
        {
            // Only the first segment, and only when it is the whole segment: a series
            // called `winter` must not rewrite a course called `winter`.
            published.put(key.startsWith(from + "/") ? to + key.substring(from.length()) : key,
                revision);
        });
        Ledger updated = new Ledger(club, snapshots, published, renamedLog(ledger, from, to));
        write(updated);
        LOG.info("Ledger for {} follows series rename {} -> {}", club, from, to);
        return updated;
    }

    /**
     * Append events without moving any pointer.
     *
     * <p>For the second way a course becomes visible: somebody ticks <b>public</b> on a
     * course that already has published snapshots, and those snapshots become readable by
     * anybody without a single publication having been made.
     */
    public synchronized Ledger record(String club, List<Event> events) throws IOException
    {
        Ledger ledger = read(club);
        if (events.isEmpty())
            return ledger;
        Ledger updated = new Ledger(club, ledger.snapshots(), ledger.published(),
            appended(ledger, events));
        write(updated);
        return updated;
    }

    private static List<Event> appended(Ledger ledger, List<Event> events)
    {
        if (events == null || events.isEmpty())
            return ledger.log();
        List<Event> log = new ArrayList<>(ledger.log());
        log.addAll(events);
        return log;
    }

    /**
     * A series rename follows into the LOG as well.
     *
     * <p>Not for tidiness: the log is the answer to "what was this fleet handed, and when",
     * and an entry naming a series that no longer exists cannot be matched against the
     * course it describes. The {@code at} instants are untouched — a rename is not an event,
     * it changed nothing anybody could see.
     */
    private static List<Event> renamedLog(Ledger ledger, String from, String to)
    {
        return ledger.log().stream()
            .map(e -> from.equals(e.series())
                ? new Event(e.at(), e.what(), to, e.course(), e.variant(), e.revision(), e.label())
                : e)
            .toList();
    }

    public List<String> loadErrors()
    {
        return Collections.unmodifiableList(loadErrors);
    }

    private Path file(String club)
    {
        return ledgerDir.resolve(JsonStore.safe(club) + ".json");
    }

    /**
     * The whole document, atomically. The multi-variant publish above is atomic <em>because
     * of this</em>: a crash mid-publish leaves the previous pointers, never half of the new
     * ones.
     */
    private void write(Ledger ledger) throws IOException
    {
        Files.createDirectories(ledgerDir);
        Path file = file(ledger.club());
        Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
        Files.write(tmp, MAPPER.writeValueAsBytes(ledger));
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

    /** One club's snapshots, its live publications, and the public record of both. */
    public record Ledger(
        @JsonProperty("club") String club,
        @JsonProperty("snapshots") List<Entry> snapshots,
        @JsonProperty("published") Map<String, String> published,
        @JsonProperty("log") List<Event> log)
    {
        public Ledger
        {
            snapshots = (snapshots == null) ? List.of() : List.copyOf(snapshots);
            published = (published == null) ? Map.of()
                : Collections.unmodifiableMap(new LinkedHashMap<>(published));
            log = (log == null) ? List.of() : List.copyOf(log);
        }

        /** Every snapshot of one variant, newest last, which is the order they were taken. */
        public List<Entry> of(String series, String course, String variant)
        {
            return snapshots.stream().filter(e -> e.matches(series, course, variant)).toList();
        }

        /** The most recent snapshot of one variant, which is what "dirty" is measured against. */
        public Optional<Entry> latest(String series, String course, String variant)
        {
            List<Entry> all = of(series, course, variant);
            return all.isEmpty() ? Optional.empty() : Optional.of(all.get(all.size() - 1));
        }

        /** The revision boats are currently given for one variant. */
        public Optional<String> publishedRevision(String series, String course, String variant)
        {
            return Optional.ofNullable(published.get(key(series, course, variant)));
        }
    }

    /** One snapshot in the index: what it was of, which geometry, and when. */
    public record Entry(
        @JsonProperty("series") String series,
        @JsonProperty("course") String course,
        @JsonProperty("variant") String variant,
        @JsonProperty("revision") String revision,
        @JsonProperty("label") String label,
        @JsonProperty("takenAt") Instant takenAt)
    {
        boolean matches(String series, String course, String variant)
        {
            return this.series.equals(series) && this.course.equals(course)
                && this.variant.equals(variant);
        }
    }

    /** One pointer to move. A publish carries a list of these and applies all or none. */
    public record Publication(
        @JsonProperty("series") String series,
        @JsonProperty("course") String course,
        @JsonProperty("variant") String variant,
        @JsonProperty("revision") String revision)
    {
    }

    /** A snapshot, and whether taking it actually added anything. */
    public record Taken(Entry entry, boolean fresh)
    {
    }

    /**
     * One moment at which what the public can see changed.
     *
     * <p>Four kinds, and the two inverses are not decoration. An audit trail that records
     * only what appeared cannot answer "why can I no longer join the course I joined on
     * Tuesday?", which is the question somebody actually asks:
     *
     * <ul>
     *   <li>{@code published} — a snapshot became what boats are handed for a public course;</li>
     *   <li>{@code withdrawn} — that offer was taken away and nothing replaced it;</li>
     *   <li>{@code opened} — a course with published snapshots was made public, so those
     *       snapshots became visible without anything being published;</li>
     *   <li>{@code closed} — a public course with published snapshots was made private.</li>
     * </ul>
     *
     * <p>{@code opened} and {@code closed} exist because <b>visibility has two switches</b>
     * and either one can turn it on: publishing to a public course, or making a published
     * course public. A log that watched only the publish endpoint would miss half of the
     * moments a course became joinable, and the half it missed is the surprising one.
     */
    public record Event(
        @JsonProperty("at") Instant at,
        @JsonProperty("what") String what,
        @JsonProperty("series") String series,
        @JsonProperty("course") String course,
        @JsonProperty("variant") String variant,
        @JsonProperty("revision") String revision,
        @JsonProperty("label") String label)
    {
        public static final String PUBLISHED = "published";
        public static final String WITHDRAWN = "withdrawn";
        public static final String OPENED = "opened";
        public static final String CLOSED = "closed";
    }
}
