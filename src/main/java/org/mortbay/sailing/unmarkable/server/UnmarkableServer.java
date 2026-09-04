package org.mortbay.sailing.unmarkable.server;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Path;
import java.util.Properties;

import org.eclipse.jetty.ee10.servlet.ServletContextHandler;
import org.eclipse.jetty.ee10.servlet.ServletHolder;
import org.eclipse.jetty.server.CustomRequestLog;
import org.eclipse.jetty.server.ForwardedRequestCustomizer;
import org.eclipse.jetty.server.HttpConfiguration;
import org.eclipse.jetty.server.HttpConnectionFactory;
import org.eclipse.jetty.server.Server;
import org.eclipse.jetty.server.ServerConnector;
import org.eclipse.jetty.server.Slf4jRequestLogWriter;
import org.mortbay.sailing.unmarkable.config.UnmarkableConfig;
import org.mortbay.sailing.unmarkable.course.ProgrammeLibrary;
import org.mortbay.sailing.unmarkable.store.JsonStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * unmarkable server entry point. Wires the {@link ProgrammeLibrary}, the {@link JsonStore}
 * and the servlets, then serves them over Jetty.
 *
 * <p>The single argument, when supplied, is the data root; it defaults to {@code ./data}.
 *
 * <h2>What this server is not</h2>
 * <b>It is outside the rounding path.</b> It distributes course and format definitions and
 * it aggregates the records boats send it. It does not detect a crossing, does not time
 * one, and does not adjudicate one — all of that happened on the boat, from raw GNSS, with
 * no network, and a boat's own rounding and timing never wait on this process.
 *
 * <p>That is the architectural line to defend. Live circuit rankings are the one thing
 * here boats actually want promptly, and they are explicitly allowed to degrade to
 * last-known standings, precisely so that nothing on the water depends on this being up.
 * If you find yourself adding a call the client must complete before it can score a mark,
 * that is the regression.
 */
public class UnmarkableServer
{
    private static final Logger LOG = LoggerFactory.getLogger(UnmarkableServer.class);

    /**
     * The logger the request log writes to. Its own name, under the application's, so it
     * inherits the app's level by default and can still be silenced on its own from
     * {@code jetty-logging.properties}.
     */
    public static final String REQUEST_LOG_NAME = "org.mortbay.sailing.unmarkable.requests";

    /**
     * One line per request: who asked, what for, what they got, how long it took. NCSA's
     * fields without NCSA's timestamp, which journald and the logging implementation have
     * both already supplied.
     */
    private static final String REQUEST_LOG_FORMAT = "%{client}a \"%r\" %s %O %{ms}Tms";

    public static void main(String[] args) throws Exception
    {
        Path dataRoot = (args.length > 0) ? Path.of(args[0]) : Path.of("data");
        Server server = start(dataRoot, -1);

        Runtime.getRuntime().addShutdownHook(new Thread(() ->
        {
            LOG.info("Shutting down");
            try
            {
                server.stop();
            }
            catch (Exception e)
            {
                LOG.error("Error during shutdown", e);
            }
        }));

        server.join();
    }

    /**
     * Build and start a server against the given data root.
     *
     * @param dataRoot directory holding {@code config/} and {@code store/}
     * @param port     port to bind, or negative to use the configured one. Tests pass 0
     *                 for an ephemeral port.
     * @return the started server; the caller owns stopping it
     */
    public static Server start(Path dataRoot, int port) throws Exception
    {
        Path configDir = dataRoot.resolve("config");
        UnmarkableConfig config = UnmarkableConfig.load(configDir.resolve("config.yaml"));

        ProgrammeLibrary programmes = new ProgrammeLibrary(configDir);
        programmes.load();

        JsonStore store = new JsonStore(dataRoot);
        store.start();

        String version = version();

        Server server = new Server();
        HttpConfiguration http = new HttpConfiguration();
        if (config.server().forwardedHeaders())
        {
            http.addCustomizer(new ForwardedRequestCustomizer());
            LOG.info("Trusting X-Forwarded-* headers — only correct behind a proxy");
        }
        if (config.server().requestLog())
        {
            Slf4jRequestLogWriter writer = new Slf4jRequestLogWriter();
            writer.setLoggerName(REQUEST_LOG_NAME);
            server.setRequestLog(new CustomRequestLog(writer, REQUEST_LOG_FORMAT));
        }
        ServerConnector connector = new ServerConnector(server, new HttpConnectionFactory(http));
        connector.setPort(port >= 0 ? port : config.server().port());
        server.addConnector(connector);

        ServletContextHandler context = new ServletContextHandler("/");
        context.addServlet(new ServletHolder(
            new ApiServlet(config, programmes, store, version)), "/api/*");
        context.addServlet(new ServletHolder(new StaticResourceServlet()), "/*");
        server.setHandler(context);
        server.start();

        LOG.info("unmarkable {} started on http://localhost:{}/ — data root {}",
            version, connector.getLocalPort(), dataRoot.toAbsolutePath());
        if (config.server().configWrites())
        {
            // Loud, because it is easy to forget and the failure is silent: a course
            // file rewritten by anybody who found the port.
            LOG.warn("Course editing is ON and UNAUTHENTICATED — anything that can reach "
                + "this port can rewrite the course files. Correct on a desk; set "
                + "server.configWrites: false before exposing this.");
        }
        if (!programmes.loadErrors().isEmpty())
            LOG.error("{} programme file(s) had problems — see errors above",
                programmes.loadErrors().size());
        return server;
    }

    /** Build version, from the Maven-filtered {@code unmarkable.properties}. */
    static String version()
    {
        try (InputStream in = UnmarkableServer.class.getResourceAsStream("/unmarkable.properties"))
        {
            if (in == null)
                return "unknown";
            Properties props = new Properties();
            props.load(in);
            return props.getProperty("version", "unknown");
        }
        catch (IOException e)
        {
            return "unknown";
        }
    }
}
