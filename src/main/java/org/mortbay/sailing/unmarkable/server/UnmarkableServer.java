package org.mortbay.sailing.unmarkable.server;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Path;
import java.util.EnumSet;
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
import jakarta.servlet.DispatcherType;
import org.eclipse.jetty.client.HttpClient;
import org.eclipse.jetty.client.WWWAuthenticationProtocolHandler;
import org.eclipse.jetty.ee10.servlet.FilterHolder;
import org.eclipse.jetty.ee10.servlet.SessionHandler;
import org.eclipse.jetty.security.SecurityHandler;
import org.eclipse.jetty.security.openid.OpenIdAuthenticator;
import org.eclipse.jetty.security.openid.OpenIdConfiguration;
import org.eclipse.jetty.security.openid.OpenIdLoginService;
import org.mortbay.sailing.unmarkable.config.AuthConfig;
import org.mortbay.sailing.unmarkable.config.UnmarkableConfig;
import org.mortbay.sailing.unmarkable.course.ProgrammeLibrary;
import org.mortbay.sailing.unmarkable.dialog.Dialog;
import org.mortbay.sailing.unmarkable.dialog.Schemas;
import org.mortbay.sailing.unmarkable.store.CourseLedger;
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
        CourseLedger ledger = new CourseLedger(dataRoot);
        ledger.start();

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

        // THE CONVERSATION (dialog document §3). One service, and for now one transport: the
        // polling one, because the document's promise is that the WebSocket carries the same
        // envelopes and building the socket first would have meant designing the fallback twice.
        Schemas schemas = new Schemas();
        if (!schemas.missing().isEmpty())
            LOG.error("Message schemas missing from the build: {}", schemas.missing());
        Dialog dialog = new Dialog(programmes, ledger, store);

        AuthConfig auth = AuthConfig.load(configDir);

        ServletContextHandler context = new ServletContextHandler("/");
        if (auth.enabled())
            secure(context, auth, server);
        context.addServlet(new ServletHolder(new DialogServlet(dialog, schemas)), "/api/dialog/*");
        context.addServlet(new ServletHolder(
            new ApiServlet(config, programmes, store, ledger, dialog, auth, version)), "/api/*");
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

    /**
     * Put the officer's screens behind an OpenID Connect login.
     *
     * <p>The issuer is all that is configured: the authorisation and token endpoints and the
     * signing keys are discovered from it at start-up. That discovery is the one outbound call
     * this server makes, and it is why a server with authentication on needs the network to
     * start — which is worth knowing before switching it on for a Pi on a committee boat.
     *
     * <p>Sessions come with it. They are in memory and go when the process does, so a restart
     * signs the officer out; nothing a boat is doing is affected, because no boat has a session
     * here at all.
     */
    private static void secure(ServletContextHandler context, AuthConfig auth, Server server)
    {
        OpenIdConfiguration oidc = new OpenIdConfiguration.Builder()
            .issuer(auth.issuer())
            .clientId(auth.clientId())
            .clientSecret(auth.clientSecret())
            // The address and the hosted domain come back in these, and without them there is
            // nothing to check a club domain against. "openid" is not listed: the configuration
            // already asks for it, and naming it again puts it in the request twice.
            .scopes("email", "profile")
            .httpClient(tokenExchangeClient())
            .build();
        server.addBean(oidc);

        // The third argument is the ERROR PAGE, not a post-logout path. Get the two the wrong
        // way round and the error page is null, which is Jetty's signal to answer a failed
        // callback with a bare 403 and no explanation — the one response in this flow that
        // somebody setting a club up has to be able to read.
        OpenIdAuthenticator authenticator =
            new OpenIdAuthenticator(oidc, auth.redirectPath(), AuthFilter.ERROR_PATH, null);
        SecurityHandler security = new UnmarkableSecurityHandler(auth);
        security.setAuthenticator(authenticator);
        security.setLoginService(new OpenIdLoginService(oidc));

        context.setSessionHandler(new SessionHandler());
        context.setSecurityHandler(security);
        // After the security handler, so the sign-in has happened and there are claims to read.
        context.addFilter(new FilterHolder(new AuthFilter(auth)), "/*",
            EnumSet.of(DispatcherType.REQUEST));
    }

    /**
     * The client that redeems the authorisation code, with one handler taken out.
     *
     * <p>Copied from sail-jinx, where it was earned: when the client id and secret do not match,
     * Google's token endpoint answers <b>401 with a JSON body naming the problem</b> and no
     * {@code WWW-Authenticate} header, because it is reporting a refusal rather than offering a
     * challenge. Jetty's {@code WWWAuthenticationProtocolHandler} sees a 401, looks for the
     * header it implies, and fails the exchange with a protocol violation — discarding the body
     * that says which end was wrong. So the one misconfiguration most likely to happen while
     * registering a club's OAuth client reports itself as a transport fault.
     *
     * <p>Removing the handler loses nothing: this client talks to exactly one endpoint, which
     * authenticates by form parameters and never challenges.
     */
    private static HttpClient tokenExchangeClient()
    {
        return new HttpClient()
        {
            @Override
            protected void doStart() throws Exception
            {
                super.doStart();
                // After super.doStart(), not in the constructor: the client installs its default
                // protocol handlers as it starts, so one removed earlier comes back.
                getProtocolHandlers().remove(WWWAuthenticationProtocolHandler.NAME);
            }
        };
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
