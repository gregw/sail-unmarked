package org.mortbay.sailing.unmarkable.course;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Stream;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.mortbay.sailing.unmarkable.model.Course;
import org.mortbay.sailing.unmarkable.model.Ids;
import org.mortbay.sailing.unmarkable.model.Line;
import org.mortbay.sailing.unmarkable.model.NamedPoint;
import org.mortbay.sailing.unmarkable.model.Programme;
import org.mortbay.sailing.unmarkable.model.Race;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Every club/series programme found under {@code data/config/clubs/}, loaded at startup
 * and served to boats.
 *
 * <p>One file per club and series, and the path is the identity:
 *
 * <pre>
 *   data/config/clubs/&lt;club domain&gt;/&lt;series&gt;.yaml
 *   data/config/clubs/myc.org.au/2026-summer.yaml
 * </pre>
 *
 * <p>The club and series are taken from the path and written into the loaded programme, so
 * a file cannot disagree with where it is filed. A file that names them anyway is checked
 * against the path and complained about rather than silently believed.
 *
 * <p><b>Defensive loading, like the store.</b> A programme that will not parse is reported
 * through {@link #loadErrors()} and skipped; it never stops the server starting. A course
 * file with a typo in it on a Thursday evening must not take the other six clubs' racing
 * down with it. The same applies to a programme that parses but does not make sense — its
 * {@link Programme#problems()} are logged and served, not thrown.
 */
public class ProgrammeLibrary
{
    private static final Logger LOG = LoggerFactory.getLogger(ProgrammeLibrary.class);

    private static final JsonMapper YAML_MAPPER = JsonMapper.builder(new YAMLFactory())
        // Race files carry window times as ISO instants. Programme files carry none, so
        // this module's absence went unnoticed until races arrived.
        .addModule(new JavaTimeModule())
        .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
        .build();

    private final Path clubsDir;
    private final Map<String, Programme> programmes = new LinkedHashMap<>();
    private final Map<String, Path> files = new LinkedHashMap<>();
    private final List<String> loadErrors = new ArrayList<>();

    public ProgrammeLibrary(Path configDir)
    {
        this.clubsDir = configDir.resolve("clubs");
    }

    /** Key under which a programme is addressed: {@code <club>/<series>}. */
    public static String key(String club, String series)
    {
        return club + "/" + series;
    }

    public void load() throws IOException
    {
        programmes.clear();
        files.clear();
        loadErrors.clear();
        if (!Files.isDirectory(clubsDir))
        {
            LOG.warn("No club programmes at {} — serving none", clubsDir.toAbsolutePath());
            return;
        }
        try (Stream<Path> files = Files.walk(clubsDir))
        {
            files.filter(Files::isRegularFile)
                .filter(p -> p.getFileName().toString().endsWith(".yaml"))
                .sorted()
                .forEach(this::loadOne);
        }
        LOG.info("Loaded {} programme(s) from {}", programmes.size(), clubsDir.toAbsolutePath());
        for (Programme programme : programmes.values())
        {
            for (String problem : programme.problems())
                LOG.warn("{}: {}", key(programme.club(), programme.series()), problem);
        }
    }

    private void loadOne(Path file)
    {
        // The path is the identity: .../clubs/<club>/<series>.yaml
        String series = file.getFileName().toString().replaceFirst("\\.yaml$", "");
        String club = file.getParent().getFileName().toString();
        try
        {
            Programme raw = YAML_MAPPER.readValue(Files.readAllBytes(file), Programme.class);
            if (raw.club() != null && !raw.club().isBlank() && !raw.club().equals(club))
                loadErrors.add(file + ": says club '" + raw.club() + "' but is filed under '"
                    + club + "' — the path wins");
            if (raw.series() != null && !raw.series().isBlank() && !raw.series().equals(series))
                loadErrors.add(file + ": says series '" + raw.series() + "' but is filed as '"
                    + series + "' — the path wins");
            Programme programme = new Programme(club, series, raw.name(), raw.datum(),
                raw.timezone(), raw.defaults(), raw.points(), raw.lines(), raw.courses(),
                raw.races(), raw.notes());
            programmes.put(key(club, series), programme);
            files.put(key(club, series), file);
        }
        catch (Exception e)
        {
            // Skipped, never fatal. One unreadable file must not take the rest with it.
            String message = file + ": " + e.getMessage();
            loadErrors.add(message);
            LOG.error("Could not load programme {}", message);
        }
    }







    public Optional<Programme> programme(String club, String series)
    {
        return Optional.ofNullable(programmes.get(key(club, series)));
    }

    /**
     * Replace one programme's blocks on disk, then reload.
     *
     * <p>The file is found by <b>looking the programme up</b> rather than by building a
     * path from the club and series, and that is deliberate: the club and series come off
     * a URL, so a constructed path would be a request to write wherever the caller liked.
     * A programme that is not already loaded cannot be written by this method.
     *
     * <p>That used to be the whole of the access control here. {@link #create} now does
     * build a path, because creating a file cannot do otherwise — so the guard has moved
     * rather than gone: see {@link #resolve}, which validates the ids through
     * {@link Ids} and then checks the resolved path is inside the config tree anyway.
     *
     * <p>Reloading afterwards is not a nicety. The library is the read model for every
     * GET, so skipping it would leave the server serving the previous points until the
     * next restart — and the editor would appear to save and then show stale data.
     */
    public void save(String club, String series, Map<String, NamedPoint> points,
        Map<String, Line> lines, Map<String, Course> courses,
        List<ProgrammeWriter.Rename> renames) throws IOException
    {
        save(club, series, points, lines, courses, null, renames);
    }

    public void save(String club, String series, Map<String, NamedPoint> points,
        Map<String, Line> lines, Map<String, Course> courses, Map<String, Race> races,
        List<ProgrammeWriter.Rename> renames) throws IOException
    {
        Path file = files.get(key(club, series));
        if (file == null)
            throw new IOException("No such programme: " + key(club, series));
        ProgrammeWriter.write(file, points, lines, courses, races, renames);
        LOG.info("Wrote {} point(s), {} line(s), {} course(s) and {} race(s) to {}",
            points == null ? "no" : points.size(), lines == null ? "no" : lines.size(),
            courses == null ? "no" : courses.size(), races == null ? "no" : races.size(), file);
        load();
    }

    /* ------------------------------------------------------ the series itself */

    /**
     * Where a programme file goes, having checked that it may go there.
     *
     * <p>This is the one place a user-supplied string becomes a new path, so it is the one
     * place an id is <b>refused</b> rather than reported. Two guards, because the second
     * does not depend on the first being perfect:
     *
     * <ol>
     *   <li>{@link Ids} admits no {@code /}, no {@code ..}, no leading {@code .} and no
     *       separator of any kind in a series, and only dots between tokens in a club —
     *       which is exactly the set that could climb out of the tree.</li>
     *   <li>The resolved path is normalised and checked to still be under
     *       {@code clubs/}. Cheap, and it catches whatever the first guard did not.</li>
     * </ol>
     *
     * @throws IllegalArgumentException with a sentence for the caller to show, which the
     *         servlet turns into a 400
     */
    Path resolve(String club, String series)
    {
        String bad = Ids.problem("club", club, Ids.DOMAIN);
        if (bad == null)
            bad = Ids.problem("series", series, Ids.PLAIN);
        if (bad != null)
            throw new IllegalArgumentException(bad);

        Path root = clubsDir.toAbsolutePath().normalize();
        Path file = root.resolve(club).resolve(series + ".yaml").normalize();
        if (!file.startsWith(root))
            throw new IllegalArgumentException("'" + club + "/" + series + "' is outside the config tree");
        return file;
    }

    /**
     * Create a programme, empty or as a copy of another.
     *
     * <p><b>A clone is a byte copy.</b> That is the whole point of it: a club starting next
     * summer from last summer's file wants its banner comments, its folded notes and its
     * explanation of what a port end is, and reading the source into a {@link Programme}
     * and writing it out again would throw away every one of them — comments are not data.
     * Only the {@code name:} line is rewritten, textually, so the copy is not called what
     * its source was.
     */
    public Programme create(String club, String series, String name, String cloneFrom)
        throws IOException
    {
        Path file = resolve(club, series);
        if (Files.exists(file))
            throw new IOException("'" + key(club, series) + "' already exists");

        String content;
        if (cloneFrom == null || cloneFrom.isBlank())
        {
            content = ProgrammeWriter.skeleton(
                (name == null || name.isBlank()) ? series : name, club, series);
        }
        else
        {
            // The SOURCE is looked up, not path-built — a clone may only copy a programme
            // the server already has, which is the guard `save` relies on too.
            Path source = files.get(cloneFrom);
            if (source == null)
                throw new IOException("No such programme to clone: " + cloneFrom);
            content = ProgrammeWriter.rename(Files.readString(source, java.nio.charset.StandardCharsets.UTF_8), name);
        }

        Files.createDirectories(file.getParent());
        Files.writeString(file, content, java.nio.charset.StandardCharsets.UTF_8);
        LOG.info("Created programme {} ({})", key(club, series),
            cloneFrom == null ? "empty" : "cloned from " + cloneFrom);
        load();
        return programmes.get(key(club, series));
    }

    /**
     * Rename a series, which is renaming its file.
     *
     * <p>Only the series: a <b>club is a domain and does not change</b>, and if one really
     * did it would be a migration across every record path and the ledger's own filename,
     * not a button in an editor.
     *
     * <p>The caller must migrate the ledger, whose publication keys embed the series. This
     * method returns only when the file has moved, so the ledger write can follow it.
     */
    public void rename(String club, String series, String newSeries) throws IOException
    {
        Path file = files.get(key(club, series));
        if (file == null)
            throw new IOException("No such programme: " + key(club, series));
        if (newSeries.equals(series))
            return;
        Path target = resolve(club, newSeries);
        if (Files.exists(target))
            throw new IOException("'" + key(club, newSeries) + "' already exists");
        Files.move(file, target);
        LOG.info("Renamed programme {} to {}", key(club, series), key(club, newSeries));
        load();
    }

    /**
     * Change a programme's display name, which is one line of its file.
     *
     * <p>A targeted substitution, for the reason every write here is one: the file is
     * documentation, and reading it into a {@link Programme} to change a name would throw
     * away every comment in it.
     */
    public void setName(String club, String series, String name) throws IOException
    {
        Path file = files.get(key(club, series));
        if (file == null)
            throw new IOException("No such programme: " + key(club, series));
        String yaml = Files.readString(file, java.nio.charset.StandardCharsets.UTF_8);
        Files.writeString(file, ProgrammeWriter.rename(yaml, name),
            java.nio.charset.StandardCharsets.UTF_8);
        load();
    }

    /**
     * Delete a programme file.
     *
     * <p>Its <b>snapshots are not deleted</b>, here or anywhere: a record names a revision,
     * and a record whose geometry cannot be retrieved is a time with no course attached.
     * Retiring a series is not a reason to make last season's results unreadable. The
     * ledger's entries simply stop being compared against anything.
     */
    public void delete(String club, String series) throws IOException
    {
        Path file = files.get(key(club, series));
        if (file == null)
            throw new IOException("No such programme: " + key(club, series));
        Files.delete(file);
        LOG.info("Deleted programme {} — its snapshots are kept", key(club, series));
        load();
    }

    public Map<String, Programme> programmes()
    {
        return Collections.unmodifiableMap(programmes);
    }

    /** Files that could not be read, and files filed somewhere other than they claim. */
    public List<String> loadErrors()
    {
        return Collections.unmodifiableList(loadErrors);
    }
}
