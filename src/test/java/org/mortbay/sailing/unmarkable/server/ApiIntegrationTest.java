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
import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.is;
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
        JsonNode detail = get("/api/programmes/test.example/fixture/courses/up-and-back");
        assertThat(detail.get("steps").get(0).get("letter").asText(), is("S"));
        assertThat(detail.get("steps").get(2).get("letter").asText(), is("F"));
        assertThat(detail.get("lengthNm").asDouble(), greaterThan(2.0));
    }

    @Test
    public void aRecordCanBePostedAndReadBack() throws Exception
    {
        String body = """
            {"raceId":"race-1","club":"test.example","series":"fixture",
             "course":"up-and-back","boatId":"boat-1","boatName":"Currawong",
             "startTime":"2026-01-01T07:00:00Z","finishTime":"2026-01-01T08:00:00Z",
             "crossings":[{"step":0,"line":"leeward","cross":"forward","counted":true}]}
            """;
        HttpResponse<String> posted = client.send(
            HttpRequest.newBuilder(URI.create(base + "/api/records"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build(),
            HttpResponse.BodyHandlers.ofString());
        assertThat(posted.body(), posted.statusCode(), is(200));
        assertThat(MAPPER.readTree(posted.body()).get("stored").asBoolean(), is(true));

        JsonNode race = get("/api/races/test.example/fixture/race-1");
        assertThat(race.size(), is(1));
        assertThat(race.get(0).get("boatName").asText(), is("Currawong"));
    }

    @Test
    public void aRecordWithNowhereToBeFiledIsRefused() throws Exception
    {
        HttpResponse<String> posted = client.send(
            HttpRequest.newBuilder(URI.create(base + "/api/records"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"raceId\":\"race-1\"}")).build(),
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
