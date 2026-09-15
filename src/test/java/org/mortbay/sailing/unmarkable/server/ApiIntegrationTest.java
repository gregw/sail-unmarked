package org.mortbay.sailing.unmarkable.server;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.nio.file.Paths;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.json.JsonMapper;
import org.eclipse.jetty.server.Server;
import org.eclipse.jetty.server.ServerConnector;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.notNullValue;

public class ApiIntegrationTest
{
    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    private Server server;
    private String base;
    private final HttpClient client = HttpClient.newHttpClient();

    @BeforeEach
    public void start(@TempDir Path store) throws Exception
    {
        // Config and programmes from the test fixtures; the store somewhere disposable.
        Path data = Paths.get("src/test/resources/testdata");
        server = UnmarkableServer.start(new SplitRoot(data, store).root(), 0);
        base = "http://localhost:"
            + ((ServerConnector)server.getConnectors()[0]).getLocalPort();
    }

    @AfterEach
    public void stop() throws Exception
    {
        if (server != null)
            server.stop();
    }

    private JsonNode get(String path) throws Exception
    {
        HttpResponse<String> response = client.send(
            HttpRequest.newBuilder(URI.create(base + path)).build(),
            HttpResponse.BodyHandlers.ofString());
        assertThat(path + " -> " + response.statusCode(), response.statusCode(), is(200));
        return MAPPER.readTree(response.body());
    }

    @Test
    public void configAnswers() throws Exception
    {
        assertThat(get("/api/config").get("version"), is(notNullValue()));
    }

    @Test
    public void theProgrammeIndexListsTheFixture() throws Exception
    {
        JsonNode programmes = get("/api/programmes");
        assertThat(programmes.size(), greaterThan(0));
        assertThat(programmes.get(0).get("club").asText(), is("test.example"));
    }

    @Test
    public void aCourseCarriesItsDerivedLettersAndLegs() throws Exception
    {
        // Letters and leg lengths are derived here, not stored, so no two clients can
        // show different figures for the same course.
        JsonNode main = get("/api/programmes/test.example/fixture/courses/up-and-back")
            .get("variants").get("main");
        assertThat(main.get("steps").get(0).get("letter").asText(), is("S"));
        assertThat(main.get("steps").get(2).get("letter").asText(), is("F"));
        assertThat(main.get("lengthNm").asDouble(), greaterThan(2.0));
    }

    @Test
    public void aSnapshotResolvesEveryEndAndCanBeReadBackByRevision() throws Exception
    {
        JsonNode snapshot = MAPPER.readTree(snapshot("up-and-back")).get("snapshot");
        String revision = snapshot.get("revision").asText();
        assertThat("it names the geometry", revision.length(), is(12));
        assertThat("the tool names it, not the user",
            snapshot.get("label").asText().startsWith("up-and-back/"), is(true));
        assertThat("with every end resolved to a position",
            snapshot.get("steps").get(0).get("crossings").get(0).get("port").get("latitude").isNumber(), is(true));

        // ...and it can be read back by that revision long after the course has moved on.
        assertThat(get("/api/courses/" + revision).get("course").asText(), is("up-and-back"));
    }

    @Test
    public void theRevisionFollowsTheGeometryAndNotTheName() throws Exception
    {
        String first = MAPPER.readTree(snapshot("up-and-back")).get("snapshot").get("revision").asText();
        JsonNode again = MAPPER.readTree(snapshot("up-and-back"));
        assertThat("an unchanged variant keeps its revision",
            again.get("snapshot").get("revision").asText(), is(first));
        assertThat("so capturing it a second time captures nothing new",
            again.get("fresh").asBoolean(), is(false));

        String other = MAPPER.readTree(snapshot("overridden")).get("snapshot").get("revision").asText();
        assertThat("a different course is a different revision", other, is(not(first)));
    }

    @Test
    public void aVariantIsUnpublishedThenCurrentThenPublished() throws Exception
    {
        // State is DERIVED, never stored: resolve the variant, hash it, compare with the
        // latest snapshot. Nothing writes a dirty flag, so nothing can leave one stale.
        assertThat(state("up-and-back"), is("unpublished"));
        snapshot("up-and-back");
        assertThat(state("up-and-back"), is("current"));
        assertThat("a snapshot is not a publication",
            lifecycle("up-and-back").get("published").isNull(), is(true));

        publish("{\"publish\":[{\"course\":\"up-and-back\"}]}");
        assertThat(lifecycle("up-and-back").get("publishedIsLatest").asBoolean(), is(true));
    }

    @Test
    public void aBoatIsHandedWhatWasPublishedAndNothingBefore() throws Exception
    {
        // Nothing published means nothing to join. A course only becomes joinable when
        // somebody deliberately releases a snapshot of it.
        assertThat(joinStatus("up-and-back"), is(404));
        snapshot("up-and-back");
        assertThat("a snapshot alone is still not joinable", joinStatus("up-and-back"), is(404));
        publish("{\"publish\":[{\"course\":\"up-and-back\"}]}");
        assertThat(joinStatus("up-and-back"), is(200));
        assertThat(MAPPER.readTree(join("up-and-back")).get("course").asText(), is("up-and-back"));
    }

    @Test
    public void publishingRefusesARevisionNobodyCaptured() throws Exception
    {
        // All or none: the check runs over every entry before anything moves, so a bad
        // revision in the last one cannot leave the first three published.
        snapshot("up-and-back");
        HttpResponse<String> refused = publish(
            "{\"publish\":[{\"course\":\"up-and-back\"},{\"course\":\"overridden\",\"revision\":\"deadbeef0000\"}]}");
        assertThat(refused.statusCode(), is(409));
        assertThat("and up-and-back was not published either",
            lifecycle("up-and-back").get("published").isNull(), is(true));
    }

    /* ------------------------------------------------- public, and the audit trail */

    @Test
    public void aCourseIsPrivateUntilSomebodySaysOtherwise() throws Exception
    {
        // The safe default for "who can see this": nobody. A club's file is full of
        // half-built shapes and last season's leftovers.
        snapshot("up-and-back");
        publish("{\"publish\":[{\"course\":\"up-and-back\"}]}");
        assertThat("published, but not public", get("/api/public").size(), is(0));
        assertThat("and nothing publicly visible has happened", get("/api/log").size(), is(0));
    }

    @Test
    public void publishingToAPublicCourseIsListedAndLogged() throws Exception
    {
        makePublic("up-and-back", true);
        // Made public with nothing published: it appears, with nothing under it, and logs
        // nothing — being seen and being joinable are two different things.
        JsonNode empty = get("/api/public");
        assertThat(empty.size(), is(1));
        assertThat(empty.get(0).get("published").size(), is(0));
        assertThat(get("/api/log").size(), is(0));

        String revision = MAPPER.readTree(snapshot("up-and-back")).get("snapshot").get("revision").asText();
        publish("{\"publish\":[{\"course\":\"up-and-back\"}]}");

        JsonNode offered = get("/api/public").get(0).get("published");
        assertThat(offered.size(), is(1));
        assertThat(offered.get(0).get("revision").asText(), is(revision));
        // The length comes off the ARCHIVED snapshot, not the file, because that is the
        // course boats were handed and the file has been free to move on since.
        assertThat(offered.get(0).get("lengthNm").isNumber(), is(true));

        JsonNode log = get("/api/log");
        assertThat(log.size(), is(1));
        assertThat(log.get(0).get("what").asText(), is("published"));
        assertThat(log.get(0).get("course").asText(), is("up-and-back"));
        assertThat(log.get(0).get("revision").asText(), is(revision));
        assertThat(log.get(0).get("club").asText(), is("test.example"));
    }

    @Test
    public void makingAPublishedCourseVisibleIsLoggedToo() throws Exception
    {
        // The OTHER switch, and the one a log watching only the publish endpoint misses:
        // nothing was published, nobody pressed anything that says "release", and a fleet
        // can suddenly see a course.
        snapshot("up-and-back");
        publish("{\"publish\":[{\"course\":\"up-and-back\"}]}");
        assertThat("private, so nothing was logged", get("/api/log").size(), is(0));

        makePublic("up-and-back", true);
        JsonNode log = get("/api/log");
        assertThat(log.size(), is(1));
        assertThat(log.get(0).get("what").asText(), is("opened"));
        assertThat(log.get(0).get("revision").isNull(), is(false));

        // And the inverse, because a trail that records only what appeared cannot answer
        // "why can I no longer join the course I joined on Tuesday?".
        makePublic("up-and-back", false);
        assertThat(get("/api/public").size(), is(0));
        assertThat(get("/api/log").get(0).get("what").asText(), is("closed"));
        assertThat("newest first", get("/api/log").size(), is(2));
    }

    @Test
    public void withdrawingFromAPublicCourseIsLogged() throws Exception
    {
        makePublic("up-and-back", true);
        snapshot("up-and-back");
        publish("{\"publish\":[{\"course\":\"up-and-back\"}]}");
        publish("{\"withdraw\":[{\"course\":\"up-and-back\"}]}");

        assertThat(get("/api/public").get(0).get("published").size(), is(0));
        assertThat(get("/api/log").get(0).get("what").asText(), is("withdrawn"));

        // Withdrawing again changes nothing, and says nothing: an audit trail that records
        // no-ops is noise, and noise is what stops anybody reading it.
        publish("{\"withdraw\":[{\"course\":\"up-and-back\"}]}");
        assertThat(get("/api/log").size(), is(2));
    }

    @Test
    public void thePublicFlagSurvivesTheFile() throws Exception
    {
        makePublic("up-and-back", true);
        assertThat(get("/api/programmes/test.example/fixture")
            .get("courses").get("up-and-back").get("public").asBoolean(), is(true));
        makePublic("up-and-back", false);
        assertThat(get("/api/programmes/test.example/fixture")
            .get("courses").get("up-and-back").get("public").asBoolean(), is(false));
    }

    /** Tick or untick public on one course, through the same PUT the editor uses. */
    private void makePublic(String course, boolean isPublic) throws Exception
    {
        JsonNode programme = get("/api/programmes/test.example/fixture");
        com.fasterxml.jackson.databind.node.ObjectNode body = MAPPER.createObjectNode();
        body.set("points", programme.get("points"));
        body.set("lines", programme.get("lines"));
        com.fasterxml.jackson.databind.node.ObjectNode courses =
            (com.fasterxml.jackson.databind.node.ObjectNode)programme.get("courses").deepCopy();
        ((com.fasterxml.jackson.databind.node.ObjectNode)courses.get(course))
            .put("public", isPublic);
        body.set("courses", courses);
        HttpResponse<String> saved = client.send(
            HttpRequest.newBuilder(URI.create(base + "/api/programmes/test.example/fixture"))
                .header("Content-Type", "application/json")
                .PUT(HttpRequest.BodyPublishers.ofString(body.toString())).build(),
            HttpResponse.BodyHandlers.ofString());
        assertThat(saved.body(), saved.statusCode(), is(200));
    }

    private JsonNode lifecycle(String course) throws Exception
    {
        return get("/api/lifecycle/test.example/fixture")
            .get("courses").get(course).get("variants").get("main");
    }

    private String state(String course) throws Exception
    {
        return lifecycle(course).get("state").asText();
    }

    private String snapshot(String course) throws Exception
    {
        HttpResponse<String> taken = post("/api/lifecycle/test.example/fixture/snapshots",
            "{\"course\":\"" + course + "\"}");
        assertThat(taken.body(), taken.statusCode(), is(200));
        snapshotBody = taken.body();
        return taken.body();
    }

    private HttpResponse<String> publish(String body) throws Exception
    {
        return post("/api/lifecycle/test.example/fixture/publications", body);
    }

    private HttpResponse<String> post(String path, String body) throws Exception
    {
        return client.send(
            HttpRequest.newBuilder(URI.create(base + path))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build(),
            HttpResponse.BodyHandlers.ofString());
    }

    private int joinStatus(String course) throws Exception
    {
        return client.send(
            HttpRequest.newBuilder(URI.create(base + "/api/join/test.example/fixture/" + course))
                .POST(HttpRequest.BodyPublishers.noBody()).build(),
            HttpResponse.BodyHandlers.ofString()).statusCode();
    }

    /** Snapshot, publish, then join — which is the whole lifecycle in one line. */
    private String join(String course) throws Exception
    {
        snapshot(course);
        publish("{\"publish\":[{\"course\":\"" + course + "\"}]}");
        return client.send(
            HttpRequest.newBuilder(URI.create(base + "/api/join/test.example/fixture/" + course))
                .POST(HttpRequest.BodyPublishers.noBody()).build(),
            HttpResponse.BodyHandlers.ofString()).body();
    }

    @Test
    public void aRecordCanBePostedAndReadBack() throws Exception
    {
        String revision = MAPPER.readTree(join("up-and-back")).get("revision").asText();
        String body = """
            {"club":"test.example","series":"fixture","course":"up-and-back",
             "courseRevision":"%s","join":"race","boatId":"boat-1","boatName":"Currawong",
             "startTime":"2026-01-01T07:00:00Z","finishTime":"2026-01-01T08:00:00Z",
             "crossings":[{"step":0,"line":"leeward","cross":"forward","counted":true}]}
            """.formatted(revision);
        HttpResponse<String> posted = client.send(
            HttpRequest.newBuilder(URI.create(base + "/api/records"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build(),
            HttpResponse.BodyHandlers.ofString());
        assertThat(posted.body(), posted.statusCode(), is(200));
        assertThat(MAPPER.readTree(posted.body()).get("published").asBoolean(), is(true));

        JsonNode day = get("/api/records/test.example/up-and-back/2026-01-01");
        assertThat(day.size(), is(1));
        assertThat(day.get(0).get("boatName").asText(), is("Currawong"));
    }

    @Test
    public void practiceIsKeptForTheBoatAndPublishedToNobody() throws Exception
    {
        String revision = MAPPER.readTree(join("up-and-back")).get("revision").asText();
        String body = """
            {"club":"test.example","course":"up-and-back","courseRevision":"%s",
             "join":"anonymous","boatId":"quiet","startTime":"2026-02-02T07:00:00Z",
             "finishTime":"2026-02-02T08:00:00Z"}
            """.formatted(revision);
        HttpResponse<String> posted = client.send(
            HttpRequest.newBuilder(URI.create(base + "/api/records"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build(),
            HttpResponse.BodyHandlers.ofString());
        assertThat(posted.statusCode(), is(200));
        assertThat("it was stored", MAPPER.readTree(posted.body()).get("stored").asBoolean(), is(true));
        assertThat("and not published", MAPPER.readTree(posted.body()).get("published").asBoolean(), is(false));
        assertThat("so the club does not see it",
            get("/api/records/test.example/up-and-back/2026-02-02").size(), is(0));
    }

    @Test
    public void aRecordWithoutAGeometryIsRefused() throws Exception
    {
        // Without the revision a record cannot be compared with another, and cannot be
        // read at all once the course has been edited.
        HttpResponse<String> posted = client.send(
            HttpRequest.newBuilder(URI.create(base + "/api/records"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(
                    "{\"club\":\"test.example\",\"course\":\"up-and-back\",\"boatId\":\"b\"}")).build(),
            HttpResponse.BodyHandlers.ofString());
        assertThat(posted.statusCode(), is(400));
    }

    @Test
    public void theClientIsServed() throws Exception
    {
        HttpResponse<String> response = client.send(
            HttpRequest.newBuilder(URI.create(base + "/")).build(),
            HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode(), is(200));
        assertThat(response.body().contains("Unmarkable Racing"), is(true));
    }

    /* --------------------------------------------------------- series CRUD */

    @Test
    public void aSeriesCanBeCreatedClonedRenamedAndRetired() throws Exception
    {
        HttpResponse<String> made = post("/api/programmes",
            "{\"club\":\"test.example\",\"series\":\"2027-summer\",\"name\":\"Summer\"}");
        assertThat(made.body(), made.statusCode(), is(200));
        assertThat(get("/api/programmes/test.example/2027-summer").get("name").asText(), is("Summer"));

        // A clone is a BYTE copy, so the source's comments come with it — that is the whole
        // reason a club starts next summer from last summer's file.
        HttpResponse<String> cloned = post("/api/programmes",
            "{\"club\":\"test.example\",\"series\":\"2027-winter\",\"name\":\"Winter\","
            + "\"cloneFrom\":\"test.example/fixture\"}");
        assertThat(cloned.body(), cloned.statusCode(), is(200));
        assertThat("the courses came with it",
            get("/api/programmes/test.example/2027-winter").get("courses").has("up-and-back"), is(true));
        assertThat("and the name did not", MAPPER.readTree(cloned.body()).get("name").asText(), is("Winter"));

        HttpResponse<String> renamed = post("/api/programmes/test.example/2027-winter/rename",
            "{\"series\":\"2027-twilight\"}");
        assertThat(renamed.body(), renamed.statusCode(), is(200));
        assertThat(get("/api/programmes/test.example/2027-twilight").get("courses").size(),
            greaterThan(0));

        HttpResponse<String> gone = delete("/api/programmes/test.example/2027-twilight");
        assertThat(gone.body(), gone.statusCode(), is(200));
    }

    @Test
    public void anIdThatCouldEscapeTheConfigTreeIsRefused() throws Exception
    {
        // The one write that turns a user string into a NEW path, so the one place an id is
        // refused rather than reported.
        for (String body : new String[] {
            "{\"club\":\"../../etc\",\"series\":\"x\"}",
            "{\"club\":\"test.example\",\"series\":\"a/b\"}",
            "{\"club\":\"test.example\",\"series\":\"..\"}",
            "{\"club\":\"test.example\",\"series\":\"has space\"}",
            "{\"club\":\"test.example\",\"series\":\"Caps\"}"})
        {
            HttpResponse<String> refused = post("/api/programmes", body);
            assertThat(body + " -> " + refused.body(), refused.statusCode(), is(400));
        }
        assertThat("and nothing new was written",
            get("/api/programmes").size(), is(1));
    }

    @Test
    public void retiringAPublishedSeriesTakesAnExplicitAnswer() throws Exception
    {
        snapshot("up-and-back");
        publish("{\"publish\":[{\"course\":\"up-and-back\"}]}");

        HttpResponse<String> refused = delete("/api/programmes/test.example/fixture");
        assertThat("boats can still join it", refused.statusCode(), is(409));
        assertThat("and it names them, so the editor can ask about them",
            MAPPER.readTree(refused.body()).get("published").get(0).asText(),
            is("fixture/up-and-back/main"));

        HttpResponse<String> forced = delete("/api/programmes/test.example/fixture?force=true");
        assertThat(forced.body(), forced.statusCode(), is(200));

        // The snapshot outlives the series it came from: a record names a revision, and a
        // record whose geometry cannot be read is a time with no course attached.
        String revision = MAPPER.readTree(forced.body()).get("wasPublished").size() > 0
            ? lastRevision() : null;
        assertThat(get("/api/courses/" + revision).get("course").asText(), is("up-and-back"));
    }

    /** The revision of the snapshot taken above, read back from the archive by course. */
    private String lastRevision() throws Exception
    {
        return MAPPER.readTree(snapshotBody).get("snapshot").get("revision").asText();
    }

    private String snapshotBody;

    private HttpResponse<String> delete(String path) throws Exception
    {
        return client.send(
            HttpRequest.newBuilder(URI.create(base + path)).DELETE().build(),
            HttpResponse.BodyHandlers.ofString());
    }

    /**
     * The fixtures are read-only and checked in; the store must not be. This copies the
     * config tree into a temporary root so a test run never writes into src/.
     */
    private record SplitRoot(Path fixtures, Path temp)
    {
        Path root() throws Exception
        {
            Path config = temp.resolve("config");
            java.nio.file.Files.walk(fixtures.resolve("config")).forEach(source ->
            {
                try
                {
                    Path target = config.resolve(fixtures.resolve("config").relativize(source));
                    if (java.nio.file.Files.isDirectory(source))
                        java.nio.file.Files.createDirectories(target);
                    else
                        java.nio.file.Files.copy(source, target);
                }
                catch (Exception e)
                {
                    throw new RuntimeException(e);
                }
            });
            return temp;
        }
    }
}
