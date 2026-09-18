package org.mortbay.sailing.unmarkable.store;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.ZoneId;
import java.time.LocalDate;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mortbay.sailing.unmarkable.model.CourseRecord;
import org.mortbay.sailing.unmarkable.model.CourseSnapshot;
import org.mortbay.sailing.unmarkable.model.CrossingEvent;
import org.mortbay.sailing.unmarkable.model.Direction;
import org.mortbay.sailing.unmarkable.model.JoinMode;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class JsonStoreTest
{
    private static final LocalDate DAY = LocalDate.parse("2026-01-01");

    private CourseRecord record(String boatId, JoinMode join, String startedAt, long elapsed)
    {
        Instant start = Instant.parse(startedAt);
        return new CourseRecord("test.example", "fixture", "up-and-back", "a3f19c", join,
            boatId, "Bombora", "AUS1234", 1.02, start, start.plusSeconds(elapsed),
            Instant.now(), "0.1.0",
            List.of(new CrossingEvent(0, "leeward", Direction.FORWARD, start, null, 3, 3, true, null)),
            List.of());
    }

    /**
     * A RACE DAY IS THE CLUB'S LOCAL DAY, and this is the case that used to be filed wrong.
     *
     * <p>07:00 UTC on 1 January is 18:00 the same day in Sydney, so both agree — which is why
     * every other test here passed while the rule was wrong. 19:25 UTC on 17 September is 05:25
     * on the EIGHTEENTH in Sydney, and that is the one that matters: a race sailed on Friday
     * morning must not be filed under Thursday.
     */
    @Test
    public void aRecordIsFiledUnderTheClubsOwnDay(@TempDir Path root) throws Exception
    {
        JsonStore store = new JsonStore(root);
        store.start();
        ZoneId sydney = ZoneId.of("Australia/Sydney");
        store.save(record("boat-1", JoinMode.RACE, "2026-09-17T19:25:00Z", 3600), sydney);

        assertThat("filed under the Sydney day, not the UTC one",
            store.day("test.example", "up-and-back", LocalDate.parse("2026-09-18")), hasSize(1));
        assertThat("and NOT under the UTC day",
            store.day("test.example", "up-and-back", LocalDate.parse("2026-09-17")), hasSize(0));
    }

    /**
     * An evening race west of Greenwich, which is the other half of the same fault.
     *
     * <p>20:00 on Thursday in New York is 00:00 on FRIDAY in UTC, so a whole club's Thursday
     * series used to file under Friday — every week, invisibly.
     */
    @Test
    public void anEveningRaceWestOfGreenwichStaysOnItsOwnDay(@TempDir Path root) throws Exception
    {
        JsonStore store = new JsonStore(root);
        store.start();
        store.save(record("boat-1", JoinMode.RACE, "2026-09-18T00:00:00Z", 3600),
            ZoneId.of("America/New_York"));

        assertThat(store.day("test.example", "up-and-back", LocalDate.parse("2026-09-17")),
            hasSize(1));
    }

    /**
     * The FILENAME carries the offset, so a file says what it means without its directory.
     *
     * <p>A date segment with an offset on it was considered and rejected: it is neither an
     * instant nor a day, cannot be compared, and two offsets for one race day would be two
     * directories. The offset belongs on the instant, which is the only thing that has one.
     */
    @Test
    public void theFilenameCarriesTheOffset(@TempDir Path root) throws Exception
    {
        JsonStore store = new JsonStore(root);
        store.start();
        store.save(record("boat-1", JoinMode.RACE, "2026-09-17T19:25:00Z", 3600),
            ZoneId.of("Australia/Sydney"));

        Path day = root.resolve("store/records/test.example/up-and-back/2026-09-18");
        List<String> names;
        try (java.util.stream.Stream<Path> files = java.nio.file.Files.list(day))
        {
            names = files.map(f -> f.getFileName().toString()).toList();
        }
        assertThat(names, contains("boat-1-052500+1000.json"));
    }

    /**
     * And a resubmission still supersedes, which is what putting the start time in the name is
     * for — the ordinary second post being the same run with its full track attached.
     */
    @Test
    public void aResubmissionStillSupersedesAcrossTheChange(@TempDir Path root) throws Exception
    {
        JsonStore store = new JsonStore(root);
        store.start();
        ZoneId sydney = ZoneId.of("Australia/Sydney");
        store.save(record("boat-1", JoinMode.RACE, "2026-09-17T19:25:00Z", 3600), sydney);
        store.save(record("boat-1", JoinMode.RACE, "2026-09-17T19:25:00Z", 3599), sydney);

        List<CourseRecord> day = store.day("test.example", "up-and-back",
            LocalDate.parse("2026-09-18"));
        assertThat(day, hasSize(1));
        assertThat(day.get(0).elapsedSeconds().orElse(-1), is(3599L));
    }

    @Test
    public void aRecordRoundTrips(@TempDir Path root) throws Exception
    {
        JsonStore store = new JsonStore(root);
        store.start();
        store.save(record("boat-1", JoinMode.RACE, "2026-01-01T07:00:00Z", 3600));

        CourseRecord back = store.day("test.example", "up-and-back", DAY).get(0);
        assertThat(back.boatName(), is("Bombora"));
        assertThat(back.elapsedSeconds().orElse(-1), is(3600L));
        assertThat("the geometry it sailed travels with it", back.courseRevision(), is("a3f19c"));
    }

    @Test
    public void aDayGathersEveryBoat(@TempDir Path root) throws Exception
    {
        JsonStore store = new JsonStore(root);
        store.start();
        store.save(record("boat-1", JoinMode.RACE, "2026-01-01T07:00:00Z", 3600));
        store.save(record("boat-2", JoinMode.RACE, "2026-01-01T07:02:00Z", 3500));
        assertThat(store.day("test.example", "up-and-back", DAY), hasSize(2));
    }

    @Test
    public void oneBoatMaySailTheSameCourseTwiceInADay(@TempDir Path root) throws Exception
    {
        // Which is why the start time is in the filename and not only in the file.
        JsonStore store = new JsonStore(root);
        store.start();
        store.save(record("boat-1", JoinMode.ANONYMOUS, "2026-01-01T02:00:00Z", 3600));
        store.save(record("boat-1", JoinMode.ANONYMOUS, "2026-01-01T07:00:00Z", 3400));
        assertThat(store.day("test.example", "up-and-back", DAY), hasSize(2));
    }

    @Test
    public void resubmittingTheSameRunSupersedesIt(@TempDir Path root) throws Exception
    {
        // The ordinary reason for a second post is the same run arriving again with its
        // full track attached, so it must land on the same file rather than accumulate.
        JsonStore store = new JsonStore(root);
        store.start();
        store.save(record("boat-1", JoinMode.RACE, "2026-01-01T07:00:00Z", 3600));
        store.save(record("boat-1", JoinMode.RACE, "2026-01-01T07:00:00Z", 3599));
        List<CourseRecord> day = store.day("test.example", "up-and-back", DAY);
        assertThat(day, hasSize(1));
        assertThat(day.get(0).elapsedSeconds().orElse(-1), is(3599L));
    }

    @Test
    public void onlyRecordAttemptsAreRanked(@TempDir Path root) throws Exception
    {
        JsonStore store = new JsonStore(root);
        store.start();
        store.save(record("racing", JoinMode.RACE, "2026-01-01T07:00:00Z", 3000));
        store.save(record("practising", JoinMode.ANONYMOUS, "2026-01-01T07:01:00Z", 2000));
        store.save(record("attempting", JoinMode.RECORD, "2026-01-01T07:02:00Z", 3600));

        // A racing boat is not attempting the record, and a practising boat is not being
        // watched at all — neither belongs on a leaderboard it did not enter.
        assertThat(store.best("test.example", "up-and-back", null).stream()
            .map(CourseRecord::boatId).toList(), contains("attempting"));
    }

    @Test
    public void theBestAreQuickestFirst(@TempDir Path root) throws Exception
    {
        JsonStore store = new JsonStore(root);
        store.start();
        store.save(record("slow", JoinMode.RECORD, "2026-01-01T07:00:00Z", 3600));
        store.save(record("quick", JoinMode.RECORD, "2026-01-01T07:01:00Z", 2400));
        store.save(record("middling", JoinMode.RECORD, "2026-01-01T07:02:00Z", 3000));
        assertThat(store.best("test.example", "up-and-back", null).stream()
            .map(CourseRecord::boatId).toList(), contains("quick", "middling", "slow"));
    }

    @Test
    public void rankingIsPerGeometry(@TempDir Path root) throws Exception
    {
        // A course edited between two attempts is two courses. Ranking across the edit
        // would be comparing runs over different water.
        JsonStore store = new JsonStore(root);
        store.start();
        store.save(record("before", JoinMode.RECORD, "2026-01-01T07:00:00Z", 3600));
        CourseRecord after = new CourseRecord("test.example", "fixture", "up-and-back",
            "beefed0", JoinMode.RECORD, "after", "Currawong", "AUS2", null,
            Instant.parse("2026-01-01T08:00:00Z"), Instant.parse("2026-01-01T08:30:00Z"),
            Instant.now(), "0.1.0", List.of(), List.of());
        store.save(after);

        assertThat(store.best("test.example", "up-and-back", "a3f19c").stream()
            .map(CourseRecord::boatId).toList(), contains("before"));
        assertThat(store.best("test.example", "up-and-back", "beefed0").stream()
            .map(CourseRecord::boatId).toList(), contains("after"));
        assertThat("and everything together when no geometry is named",
            store.best("test.example", "up-and-back", null), hasSize(2));
    }

    @Test
    public void anUnfinishedRunIsNotRanked(@TempDir Path root) throws Exception
    {
        JsonStore store = new JsonStore(root);
        store.start();
        store.save(new CourseRecord("test.example", "fixture", "up-and-back", "a3f19c",
            JoinMode.RECORD, "still-out", "Bombora", "AUS1", null,
            Instant.parse("2026-01-01T07:00:00Z"), null, Instant.now(), "0.1.0",
            List.of(), List.of()));
        assertThat(store.best("test.example", "up-and-back", null), hasSize(0));
    }

    @Test
    public void aCourseIsArchivedOnceAndKept(@TempDir Path root) throws Exception
    {
        // A revision names one geometry, so a second snapshot of it is the same course;
        // rewriting would only risk replacing a good file with a worse one.
        JsonStore store = new JsonStore(root);
        store.start();
        CourseSnapshot snapshot = new CourseSnapshot("a3f19c", "test.example", "fixture",
            "up-and-back", "main", "up-and-back/2026-01-01T07:00:00", "Up and back", false,
            List.of(), 2.16, null, Instant.now());
        store.archive(snapshot);
        Path file = root.resolve("store/courses/a3f19c.json");
        long written = Files.getLastModifiedTime(file).toMillis();
        store.archive(snapshot);
        assertThat(Files.getLastModifiedTime(file).toMillis(), is(written));

        assertThat(store.course("a3f19c").orElseThrow().course(), is("up-and-back"));
        assertThat(store.course("nothing").isPresent(), is(false));
    }

    @Test
    public void oneBadFileDoesNotEmptyTheFleet(@TempDir Path root) throws Exception
    {
        JsonStore store = new JsonStore(root);
        store.start();
        store.save(record("boat-1", JoinMode.RACE, "2026-01-01T07:00:00Z", 3600));
        Files.writeString(root.resolve("store/records/test.example/up-and-back/2026-01-01/bad.json"),
            "{ this is not json");

        assertThat(store.day("test.example", "up-and-back", DAY), hasSize(1));
        assertThat(store.loadErrors(), hasSize(1));
    }

    @Test
    public void everyWriteIsJournalled(@TempDir Path root) throws Exception
    {
        JsonStore store = new JsonStore(root);
        store.start();
        store.save(record("boat-1", JoinMode.RACE, "2026-01-01T07:00:00Z", 3600));
        try (var files = Files.list(root.resolve("store/journal")))
        {
            assertTrue(files.anyMatch(f -> f.getFileName().toString().endsWith(".jsonl")));
        }
    }

    @Test
    public void pathSegmentsFromTheWireAreConstrained()
    {
        // A dot must stay legal, because a club id is a domain.
        assertThat(JsonStore.safe("myc.org.au"), is("myc.org.au"));
        assertThat(JsonStore.safe("Race 1"), is("Race_1"));
        // Which is why neutralising the separators is not enough by itself.
        assertThrows(IllegalArgumentException.class, () -> JsonStore.safe("a/../../b"));
        assertThrows(IllegalArgumentException.class, () -> JsonStore.safe(".."));
        assertThrows(IllegalArgumentException.class, () -> JsonStore.safe(".hidden"));
        assertThrows(IllegalArgumentException.class, () -> JsonStore.safe(" "));
    }
}
