package org.mortbay.sailing.unmarkable.store;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mortbay.sailing.unmarkable.model.CrossingEvent;
import org.mortbay.sailing.unmarkable.model.Direction;
import org.mortbay.sailing.unmarkable.model.RaceFormat;
import org.mortbay.sailing.unmarkable.model.RaceRecord;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class JsonStoreTest
{
    private RaceRecord record(String boatId, String note)
    {
        return new RaceRecord("race-1", "test.example", "fixture", "up-and-back",
            RaceFormat.ROLLING_START, boatId, "Bombora", "AUS1234", 1.02,
            Instant.parse("2026-01-01T07:00:00Z"), Instant.parse("2026-01-01T08:00:00Z"),
            Instant.now(), "0.1.0",
            List.of(new CrossingEvent(0, "leeward", Direction.FORWARD,
                Instant.parse("2026-01-01T07:00:00Z"), null, 3, 3, true, note)),
            List.of());
    }

    @Test
    public void aRecordRoundTrips(@TempDir Path root) throws Exception
    {
        JsonStore store = new JsonStore(root);
        store.start();
        store.save(record("boat-1", "start"));

        RaceRecord back = store.record("test.example", "fixture", "race-1", "boat-1").orElseThrow();
        assertThat(back.boatName(), is("Bombora"));
        assertThat(back.elapsedSeconds().orElse(-1), is(3600L));
        assertThat(back.crossings(), hasSize(1));
    }

    @Test
    public void resubmissionSupersedesRatherThanDuplicating(@TempDir Path root) throws Exception
    {
        // The ordinary reason for a second post is the same record arriving again with
        // its track attached. The boat is the authority on its own race, so the later
        // version replaces the earlier one outright.
        JsonStore store = new JsonStore(root);
        store.start();
        store.save(record("boat-1", "first"));
        store.save(record("boat-1", "second"));

        assertThat(store.race("test.example", "fixture", "race-1"), hasSize(1));
        assertThat(store.record("test.example", "fixture", "race-1", "boat-1")
            .orElseThrow().crossings().get(0).note(), is("second"));
    }

    @Test
    public void aRaceGathersEveryBoat(@TempDir Path root) throws Exception
    {
        JsonStore store = new JsonStore(root);
        store.start();
        store.save(record("boat-1", "a"));
        store.save(record("boat-2", "b"));
        assertThat(store.race("test.example", "fixture", "race-1"), hasSize(2));
    }

    @Test
    public void oneBadFileDoesNotEmptyTheFleet(@TempDir Path root) throws Exception
    {
        // Losing one boat's record is recoverable; returning no results for the race
        // because of it is how a Thursday evening gets ruined.
        JsonStore store = new JsonStore(root);
        store.start();
        store.save(record("boat-1", "good"));
        Files.writeString(root.resolve("store/records/test.example/fixture/race-1/boat-2.json"),
            "{ this is not json");

        assertThat(store.race("test.example", "fixture", "race-1"), hasSize(1));
        assertThat(store.loadErrors(), hasSize(1));
    }

    @Test
    public void everyWriteIsJournalled(@TempDir Path root) throws Exception
    {
        JsonStore store = new JsonStore(root);
        store.start();
        store.save(record("boat-1", "start"));
        try (var files = Files.list(root.resolve("store/journal")))
        {
            assertTrue(files.anyMatch(f -> f.getFileName().toString().endsWith(".jsonl")));
        }
    }

    @Test
    public void pathSegmentsFromTheWireAreConstrained()
    {
        // A boatId is whatever a client sent. Left alone it would be a request to write
        // wherever it liked.
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
