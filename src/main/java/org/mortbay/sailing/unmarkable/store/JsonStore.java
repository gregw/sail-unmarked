package org.mortbay.sailing.unmarkable.store;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Stream;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.mortbay.sailing.unmarkable.model.CourseRecord;
import org.mortbay.sailing.unmarkable.model.CourseSnapshot;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * On-disk JSON persistence for race records. One file per boat per race, no database,
 * following sail-jinx and sailing-pf.
 *
 * <p>Layout under {@code <root>/store/}:
 * <pre>
 *   records/{club}/{course}/{date}/{boatId}-{HHmmss}.json  — one boat's run at a course
 *   courses/{revision}.json                                — a course design somebody sailed
 *   journal/{yyyy-MM}.jsonl                                — append-only, every accepted post
 * </pre>
 *
 * <p>One file per run, because the writers are independent: forty phones post whenever
 * their own signal comes back, and a shared file would make every one of those a
 * read-modify-write of a document the others are also writing. Filed by course and day,
 * because without races that is what an evening's sailing has in common; the start time
 * in the name is what lets one boat sail the same course twice in a day.
 *
 * <p><b>Course designs are archived by revision, and only once a boat has joined one.</b>
 * There is no value in keeping every geometry the editor ever produced — most were typed
 * over a second later — but a design somebody actually sailed has to survive being edited
 * afterwards, or its records become uninterpretable.
 *
 * <p>Three properties are not optional here, for the same reason as in sail-jinx, and one
 * more that is particular to this application:
 * <ul>
 *   <li><b>Atomic writes.</b> Written to a sibling {@code .tmp} and moved into place, so a
 *       crash or a full disk can never leave a half-written record where a good one was.</li>
 *   <li><b>A journal.</b> Every accepted post also appends one self-describing line, which
 *       is the recovery path for what atomic writes cannot cover.</li>
 *   <li><b>Defensive loading.</b> A corrupt file is reported through {@link #loadErrors()}
 *       and skipped, never allowed to stop the server starting.</li>
 *   <li><b>Records are never edited.</b> A boat's record is evidence, not a document. A
 *       resubmission supersedes rather than mutates — see {@link #save}.</li>
 * </ul>
 */
public class JsonStore
{
    private static final Logger LOG = LoggerFactory.getLogger(JsonStore.class);

    private static final JsonMapper MAPPER = JsonMapper.builder()
        .addModule(new JavaTimeModule())
        .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
        .enable(SerializationFeature.INDENT_OUTPUT)
        .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
        .build();

    /** Journal lines are one per line, so they must not be pretty-printed. */
    private static final JsonMapper JOURNAL_MAPPER = JsonMapper.builder()
        .addModule(new JavaTimeModule())
        .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
        .build();

    private static final DateTimeFormatter JOURNAL_MONTH =
        DateTimeFormatter.ofPattern("yyyy-MM").withZone(ZoneOffset.UTC);

    /** The start time in a record's filename, so two runs in a day do not collide. */
    private static final DateTimeFormatter STAMP = DateTimeFormatter.ofPattern("HHmmss");

    private final Path recordsDir;
    private final Path coursesDir;
    private final Path journalDir;
    private final List<String> loadErrors = new ArrayList<>();

    public JsonStore(Path dataRoot)
    {
        Path storeDir = dataRoot.resolve("store");
        this.recordsDir = storeDir.resolve("records");
        this.coursesDir = storeDir.resolve("courses");
        this.journalDir = storeDir.resolve("journal");
    }

    public void start() throws IOException
    {
        Files.createDirectories(recordsDir);
        Files.createDirectories(coursesDir);
        Files.createDirectories(journalDir);
        LOG.info("Store at {}", recordsDir.toAbsolutePath());
    }

    /**
     * Store a boat's record, superseding any earlier one for the same boat and race.
     *
     * <p>Superseding rather than merging is the deliberate part. The ordinary reason for a
     * second post is the same record arriving again with its fixes attached, and the boat
     * is the authority on its own race — the server has no basis on which to prefer half
     * of one version and half of another. The journal keeps what was replaced, so a
     * resubmission that quietly dropped a crossing is still visible afterwards.
     */
    public void save(CourseRecord record) throws IOException
    {
        Path file = recordFile(record);
        Files.createDirectories(file.getParent());
        writeAtomic(file, MAPPER.writeValueAsBytes(record));
        journal("record", record);
    }

    /**
     * Archive a course design under its revision, if it is not already there.
     *
     * <p>Written once and never rewritten: a revision names one geometry, so a second
     * snapshot with the same revision is the same course and re-writing it would only risk
     * replacing a good file with a worse one.
     */
    public void archive(CourseSnapshot snapshot) throws IOException
    {
        Path file = coursesDir.resolve(safe(snapshot.revision()) + ".json");
        if (Files.exists(file))
            return;
        Files.createDirectories(coursesDir);
        writeAtomic(file, MAPPER.writeValueAsBytes(snapshot));
        journal("course", snapshot);
    }

    /** The archived design a record names, so a track can still be read months later. */
    public Optional<CourseSnapshot> course(String revision)
    {
        Path file = coursesDir.resolve(safe(revision) + ".json");
        if (!Files.isRegularFile(file))
            return Optional.empty();
        try
        {
            return Optional.of(MAPPER.readValue(Files.readAllBytes(file), CourseSnapshot.class));
        }
        catch (IOException e)
        {
            loadErrors.add(file + ": " + e.getMessage());
            LOG.error("Could not read course {}", file, e);
            return Optional.empty();
        }
    }

    /** Every run at a course on one day, skipping any file that will not read. */
    public List<CourseRecord> day(String club, String course, LocalDate date)
    {
        return readAll(recordsDir.resolve(safe(club)).resolve(safe(course)).resolve(date.toString()));
    }

    /**
     * Every ranked run at one course geometry, quickest first.
     *
     * <p>Only {@link org.mortbay.sailing.unmarkable.model.JoinMode#RECORD} runs, and only
     * against the SAME revision: a course edited between two attempts is two courses, and
     * ranking across the edit would be comparing different water.
     */
    public List<CourseRecord> best(String club, String course, String revision)
    {
        Path dir = recordsDir.resolve(safe(club)).resolve(safe(course));
        if (!Files.isDirectory(dir))
            return List.of();
        List<CourseRecord> ranked = new ArrayList<>();
        try (Stream<Path> days = Files.list(dir))
        {
            days.filter(Files::isDirectory).sorted().forEach(day -> readAll(day).stream()
                .filter(CourseRecord::ranked)
                .filter(r -> revision == null || revision.equals(r.courseRevision()))
                .forEach(ranked::add));
        }
        catch (IOException e)
        {
            loadErrors.add(dir + ": " + e.getMessage());
        }
        ranked.sort(Comparator.comparingLong(r -> r.elapsedSeconds().orElse(Long.MAX_VALUE)));
        return ranked;
    }

    private List<CourseRecord> readAll(Path dir)
    {
        if (!Files.isDirectory(dir))
            return List.of();
        List<CourseRecord> records = new ArrayList<>();
        try (Stream<Path> files = Files.list(dir))
        {
            files.filter(f -> f.getFileName().toString().endsWith(".json")).sorted().forEach(f ->
            {
                try
                {
                    records.add(MAPPER.readValue(Files.readAllBytes(f), CourseRecord.class));
                }
                catch (IOException e)
                {
                    // Skipped and reported. One boat's bad file must not empty the results
                    // for everyone who sailed that evening.
                    loadErrors.add(f + ": " + e.getMessage());
                    LOG.error("Could not read record {}", f, e);
                }
            });
        }
        catch (IOException e)
        {
            loadErrors.add(dir + ": " + e.getMessage());
        }
        return records;
    }

    /**
     * Where a run is filed.
     *
     * <p>The start time is in the NAME rather than only in the file, so a boat may sail the
     * same course twice in a day and so a resubmission of the same run — the ordinary case,
     * when the full track arrives later over wifi — lands on the same file and supersedes
     * it rather than accumulating.
     */
    private Path recordFile(CourseRecord record)
    {
        Instant at = record.startTime() != null ? record.startTime() : Instant.now();
        ZonedDateTime local = at.atZone(ZoneOffset.UTC);
        return recordsDir.resolve(safe(record.club()))
            .resolve(safe(record.course()))
            .resolve(local.toLocalDate().toString())
            .resolve(safe(record.boatId()) + "-" + STAMP.format(local) + ".json");
    }

    public List<String> loadErrors()
    {
        return Collections.unmodifiableList(loadErrors);
    }

    private Path recordFile(String club, String series, String raceId, String boatId)
    {
        return recordsDir.resolve(safe(club)).resolve(safe(series))
            .resolve(safe(raceId)).resolve(safe(boatId) + ".json");
    }

    /**
     * Path segments come off the wire, so they are constrained rather than trusted. A boat
     * id of {@code ../../../etc} would otherwise be a request to write outside the store.
     */
    static String safe(String segment)
    {
        if (segment == null || segment.isBlank())
            throw new IllegalArgumentException("empty path segment");
        String cleaned = segment.trim().replaceAll("[^A-Za-z0-9._-]", "_");
        // A dot has to stay legal — club ids are domains, "myc.org.au" — so neutralising
        // the separators is not enough on its own: ".." has to go too, wherever it falls.
        if (cleaned.startsWith(".") || cleaned.contains(".."))
            throw new IllegalArgumentException("unusable path segment: " + segment);
        return cleaned;
    }

    private void writeAtomic(Path file, byte[] bytes) throws IOException
    {
        Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
        Files.write(tmp, bytes);
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

    private void journal(String what, Object value)
    {
        Path file = journalDir.resolve(JOURNAL_MONTH.format(Instant.now()) + ".jsonl");
        try
        {
            String line = JOURNAL_MAPPER.writeValueAsString(
                Map.of("at", Instant.now().toString(), "what", what, "value", value));
            Files.writeString(file, line + "\n", StandardCharsets.UTF_8,
                StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        }
        catch (IOException e)
        {
            // The record itself is already safely on disk. Losing a journal line is worth
            // a loud log and nothing more; failing the boat's post because the journal is
            // full would throw away the thing we actually wanted to keep.
            LOG.error("Could not journal {}", what, e);
        }
    }
}
