package org.mortbay.sailing.unmarked.config;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Server configuration, loaded from {@code data/config/config.yaml} at startup.
 *
 * <p>Small on purpose. Everything that describes the <em>racing</em> — points, lines,
 * courses, detection tuning — lives in the club/series programme files, because that is
 * what changes and what a club owns. What is left here is the listener and who is running
 * it.
 *
 * <p>Unknown properties are ignored, so a config file from a later version still loads on
 * an older build.
 */
public record UnmarkedConfig(
    @JsonProperty("site") Site site,
    @JsonProperty("server") Server server)
{
    private static final Logger LOG = LoggerFactory.getLogger(UnmarkedConfig.class);

    private static final JsonMapper YAML_MAPPER = JsonMapper.builder(new YAMLFactory())
        .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
        .build();

    public UnmarkedConfig
    {
        if (site == null)
            site = new Site(null, null);
        if (server == null)
            server = new Server(0, false, null, null);
    }

    public static UnmarkedConfig load(Path configFile) throws IOException
    {
        if (!Files.exists(configFile))
            throw new IOException("Config file not found: " + configFile.toAbsolutePath());
        LOG.info("Loading config from {}", configFile.toAbsolutePath());
        return YAML_MAPPER.readValue(Files.readAllBytes(configFile), UnmarkedConfig.class);
    }

    /** Who is running this instance, for the front page and for the record. */
    public record Site(
        @JsonProperty("name") String name,
        @JsonProperty("contact") String contact)
    {
        public Site
        {
            if (name == null || name.isBlank())
                name = "Unmarked Racing";
        }
    }

    /**
     * The listener.
     *
     * <p>{@code forwardedHeaders} makes Jetty reconstruct the externally-visible URL from
     * {@code X-Forwarded-*} headers. Turn it on when — and only when — something else
     * terminates the connection, such as the reverse proxy in front of
     * {@code unmarked.mortbay.org}. It must stay off for a directly-exposed server:
     * those headers are whatever the client sent, so trusting them lets a client decide
     * what the server thinks its own address is.
     *
     * <p>{@code requestLog} writes one line per request to the ordinary log — the journal,
     * under systemd. On by default, for the same reason as in sail-jinx: it is what tells
     * you whether a request reached this server at all, which is the first question
     * whenever something in front of it is misbehaving. It matters more here, because the
     * clients are phones on marginal connections and "did the record arrive" is the
     * question that will actually be asked.
     */
    public record Server(
        @JsonProperty("port") int port,
        @JsonProperty("forwardedHeaders") boolean forwardedHeaders,
        @JsonProperty("requestLog") Boolean requestLog,
        @JsonProperty("configWrites") Boolean configWrites)
    {
        public Server
        {
            if (port <= 0)
                port = 8083;
            // The course editor saves as you type, so this is on by default or the
            // editor simply does not work. It is a real exposure and not a small one:
            // with it on, ANYTHING THAT CAN REACH THIS PORT CAN REWRITE THE COURSE
            // FILES, because there is no authentication on writes yet. Correct for a
            // laptop on a desk; turn it off — or put a login in front of it — before
            // this is reachable from anywhere else. The server says so at startup.
            if (configWrites == null)
                configWrites = Boolean.TRUE;
            // Boolean rather than boolean, and defaulted here: an absent YAML key
            // deserialises a primitive to false, which would make "say nothing" the
            // default for the one setting whose whole purpose is to say something.
            if (requestLog == null)
                requestLog = Boolean.TRUE;
        }
    }
}
