package org.mortbay.sailing.unmarkable.dialog;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.mortbay.sailing.unmarkable.model.Race;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The envelope, the schemas, and what a race definition complains about.
 *
 * <p>{@code drive-race.mjs} drives the whole conversation against a live server, which is where
 * the sequence is proved. What is here is the part a driver cannot reach cheaply: that the
 * schemas shipped in the build are all present and readable, and that the Java validator agrees
 * with the JavaScript one about the subset — because the document's rule is that BOTH sides
 * validate, and two validators that disagree are worse than one.
 */
class DialogTest
{
    @Test
    void everySchemaIsInTheBuild()
    {
        Schemas schemas = new Schemas();
        // A missing schema file is a message type nothing validates, which is the failure this
        // check exists for: it would look exactly like a message type that happened to be sound.
        assertEquals(List.of(), schemas.missing(), "schema files missing from /static/schemas");
        assertTrue(schemas.types().size() >= 20);
    }

    @Test
    void anEnvelopeFillsInWhatTheSenderDidNotSay()
    {
        Envelope made = Envelope.of("say", Map.of("text", "hello"));
        assertEquals(Envelope.V1, made.v());
        assertNotNull(made.id(), "an id is what makes a resend recognisable");
        assertNotNull(made.at(), "the sender says when it sent this");
        assertEquals(List.of(), made.tags(), "no tags means everybody");
    }

    @Test
    void anUntaggedMessageIsForEverybody()
    {
        Envelope all = Envelope.of("say", Map.of("text", "x"));
        assertTrue(all.addressedTo(List.of()));
        assertTrue(all.addressedTo(List.of("division:1")));

        Envelope one = Envelope.of("say", List.of("division:1"), Map.of("text", "x"));
        assertTrue(one.addressedTo(List.of("division:1")));
        assertFalse(one.addressedTo(List.of("division:2")));
        assertFalse(one.addressedTo(List.of()));
    }

    @Test
    void theSchemaSubsetIsTheSubsetTheDocumentPromises()
    {
        Schemas schemas = new Schemas();

        // A sound timer.
        assertNull(schemas.check(Envelope.of("timer", Map.of(
            "startAt", "2026-09-17T08:00:00Z", "warningSeconds", 300, "text", "start"))));

        // TEXT IS REQUIRED ON EVERY STATE MESSAGE (§9.4): a flag with no words on it is a flag
        // only the software can read, and it is also what reaches a client too old to act on
        // the rest of the fields.
        String noText = schemas.check(Envelope.of("timer", Map.of("startAt", "2026-09-17T08:00:00Z")));
        assertNotNull(noText);
        assertTrue(noText.contains("text"), noText);

        // Every instant on this wire carries a timezone.
        assertNotNull(schemas.check(Envelope.of("timer", Map.of(
            "startAt", "2026-09-17T08:00:00", "text", "start"))));

        // An enum is an enum.
        assertNotNull(schemas.check(Envelope.of("flag", Map.of("flag", "maybe", "text", "x"))));
        assertNull(schemas.check(Envelope.of("flag", Map.of("flag", "postponed", "text", "x"))));

        // §5 RULE 2: unknown fields are ignored, on both sides, because that is what lets an
        // installed client and an updated server go on talking.
        assertNull(schemas.check(Envelope.of("flag", Map.of(
            "flag", "postponed", "text", "x", "somethingNew", 42))));

        // §5 RULE 3: an unknown message TYPE is accepted and counted elsewhere, never refused —
        // an old server meeting a new message must carry on.
        assertNull(schemas.check(Envelope.of("somethingFromTheFuture", Map.of())));

        // And a version this build does not speak is refused rather than guessed at.
        assertNotNull(schemas.check(new Envelope(99, "say", null, null, List.of(),
            Map.of("text", "x"))));
    }

    @Test
    void aRaceSaysWhatIsWrongWithIt()
    {
        Race empty = new Race("r1", "Race one", null, "fleet", Map.of(), null, null);
        List<String> problems = empty.problems(Map.of());
        assertTrue(problems.stream().anyMatch(p -> p.contains("no date")), problems.toString());
        // A race with no divisions can hand no boat a course, which is the one thing a race is
        // for — so it is worth saying out loud rather than discovering on a start line.
        assertTrue(problems.stream().anyMatch(p -> p.contains("no divisions")), problems.toString());

        Race unknown = new Race("r2", null, LocalDate.of(2026, 9, 17), "fleet",
            Map.of("open", new Race.Division("open", "nowhere", null, null)), null, null);
        assertTrue(unknown.problems(Map.of()).stream()
            .anyMatch(p -> p.contains("unknown course")), "an unknown course must be reported");
    }

    @Test
    void theDivisionTagIsSpeltInOnePlace()
    {
        // The map key is the division's plain id and the tag is derived from it, because a YAML
        // key with a colon in it has to be quoted — and an unquoted one does not produce a bad
        // id, it produces a broken file on the next autosave.
        assertEquals("division:div-1", Race.tagFor("div-1"));
        assertEquals("div-1", Race.divisionOf("division:div-1"));
        assertNull(Race.divisionOf("fleet:a"), "only a division's tag names a division");
    }
}
