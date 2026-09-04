package org.mortbay.sailing.unmarkable.store;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Stream;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.mortbay.sailing.unmarkable.model.RaceRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * On-disk JSON persistence for race records. One file per boat per race, no database,
 * following sail-jinx and sailing-pf.
 *
 * <p>Layout under {@code <root>/store/}:
 * <pre>
 *   records/{club}/{series}/{raceId}/{boatId}.json  — one boat's race record
 *   journal/{yyyy-MM}.jsonl                         — append-only, every accepted post
 * </pre>
 *
 * <p>One file per boat, rather than one per race, because the writers are independent:
 * forty phones post whenever their own signal comes back, and a race-shaped file would
 * make every one of those a read-modify-write of a document the others are also writing.
 * A boat's record is also the natural unit of everything else — it is what gets resubmitted
 * with the full track later, and what a protest looks at.
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

    private final Path recordsDir;
    private final Path journalDir;
    private final List<String> loadErrors = new ArrayList<>();

    public JsonStore(Path dataRoot)
    {
        Path storeDir = dataRoot.resolve("store");
        this.recordsDir = storeDir.resolve("records");
        this.journalDir = storeDir.resolve("journal");
    }

    public void start() throws IOException
    {
        Files.createDirectories(recordsDir);
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
    public void save(RaceRecord record) throws IOException
    {
        Path file = recordFile(record.club(), record.series(), record.raceId(), record.boatId());
        Files.createDirectories(file.getParent());
        writeAtomic(file, MAPPER.writeValueAsBytes(record));
        journal("record", record);
    }

    public Optional<RaceRecord> record(String club, String series, String raceId, String boatId)
    {
        Path file = recordFile(club, series, raceId, boatId);
        if (!Files.isRegularFile(file))
            return Optional.empty();
        try
        {
            return Optional.of(MAPPER.readValue(Files.readAllBytes(file), RaceRecord.class));
        }
        catch (IOException e)
        {
            loadErrors.add(file + ": " + e.getMessage());
            LOG.error("Could not read record {}", file, e);
            return Optional.empty();
        }
    }

    /** Every boat's record for one race, skipping any that will not read. */
    public List<RaceRecord> race(String club, String series, String raceId)
    {
        Path dir = recordsDir.resolve(club).resolve(series).resolve(raceId);
        if (!Files.isDirectory(dir))
            return List.of();
        List<RaceRecord> records = new ArrayList<>();
        try (Stream<Path> files = Files.list(dir))
        {
            files.filter(f -> f.getFileName().toString().endsWith(".json"))
                .sorted()
                .forEach(f ->
                {
                    try
                    {
                        records.add(MAPPER.readValue(Files.readAllBytes(f), RaceRecord.class));
                    }
                    catch (IOException e)
                    {
                        // Skipped and reported. One boat's bad file must not empty the
                        // results for the whole fleet.
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
