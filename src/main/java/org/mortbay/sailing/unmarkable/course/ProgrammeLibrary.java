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
    private final Map<String, Race> races = new LinkedHashMap<>();
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

    /** Key under which a race is addressed: {@code <club>/<raceId>}. */
    public static String raceKey(String club, String raceId)
    {
        return club + "/" + raceId;
    }

    public void load() throws IOException
    {
        programmes.clear();
        files.clear();
        races.clear();
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
                .forEach(file ->
                {
                    // clubs/<club>/races/<raceId>.yaml is a race; anything else directly
                    // under clubs/<club>/ is a programme.
                    if (file.getParent().getFileName().toString().equals("races"))
                        loadRace(file);
                    else
                        loadOne(file);
                });
        }
        LOG.info("Loaded {} programme(s) and {} race(s) from {}",
            programmes.size(), races.size(), clubsDir.toAbsolutePath());
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
                raw.defaults(), raw.points(), raw.lines(), raw.courses(), raw.notes());
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

    private void loadRace(Path file)
    {
        String raceId = file.getFileName().toString().replaceFirst("\\.yaml$", "");
        String club = file.getParent().getParent().getFileName().toString();
        try
        {
            Race raw = YAML_MAPPER.readValue(Files.readAllBytes(file), Race.class);
            Race race = new Race(raceId, club, raw.series(), raw.name(), raw.course(),
                raw.format(), raw.windowOpen(), raw.windowClose(), raw.parameters(),
                raw.entrants(), raw.notes());
            races.put(raceKey(club, raceId), race);
        }
        catch (Exception e)
        {
            String message = file + ": " + e.getMessage();
            loadErrors.add(message);
            LOG.error("Could not load race {}", message);
        }
    }

    public Optional<Race> race(String club, String raceId)
    {
        return Optional.ofNullable(races.get(raceKey(club, raceId)));
    }

    public Map<String, Race> races()
    {
        return Collections.unmodifiableMap(races);
    }

    public Optional<Programme> programme(String club, String series)
    {
        return Optional.ofNullable(programmes.get(key(club, series)));
    }

    /**
     * Replace one programme's points on disk, then reload.
     *
     * <p>The file is found by looking the programme up rather than by building a path
     * from the club and series, and that is the access control: the club and series come
     * off a URL, so a constructed path would be a request to write wherever the caller
     * liked. A programme that is not already loaded cannot be written, which means this
     * can neither create a file nor escape the config tree.
     *
     * <p>Reloading afterwards is not a nicety. The library is the read model for every
     * GET, so skipping it would leave the server serving the previous points until the
     * next restart — and the editor would appear to save and then show stale data.
     */
    public void save(String club, String series, Map<String, NamedPoint> points,
        Map<String, Line> lines, Map<String, Course> courses,
        List<ProgrammeWriter.Rename> renames) throws IOException
    {
        Path file = files.get(key(club, series));
        if (file == null)
            throw new IOException("No such programme: " + key(club, series));
        ProgrammeWriter.write(file, points, lines, courses, renames);
        LOG.info("Wrote {} point(s), {} line(s) and {} course(s) to {}",
            points == null ? "no" : points.size(), lines == null ? "no" : lines.size(),
            courses == null ? "no" : courses.size(), file);
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
