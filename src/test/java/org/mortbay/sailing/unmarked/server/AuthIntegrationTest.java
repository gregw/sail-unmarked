package org.mortbay.sailing.unmarked.server;

import java.net.CookieManager;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;

import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.eclipse.jetty.ee10.servlet.ServletContextHandler;
import org.eclipse.jetty.ee10.servlet.ServletHolder;
import org.eclipse.jetty.server.Server;
import org.eclipse.jetty.server.ServerConnector;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.oneOf;

/**
 * THE LOGIN, END TO END AND OFFLINE.
 *
 * <p>A stub issuer stands in for Google: it serves the discovery document and mints an unsigned
 * id token, which is enough to complete a sign-in without a network or a real client secret —
 * Jetty's {@code JwtDecoder} base64-decodes the token and {@code OpenIdCredentials} checks the
 * issuer, audience and expiry, never a signature. The pattern is sail-jinx's, along with the
 * rest of this; what is being tested is that the constraint is genuinely in front of the right
 * things, not that Google works.
 *
 * <p>The assertions worth reading first are the ones about what is NOT protected. A login that
 * keeps the wrong people out is easy to write and easy to check; a login that quietly also
 * keeps a FLEET out — by sitting in front of {@code /api/dialog} — would look exactly like a
 * working login until a race day.
 */
class AuthIntegrationTest
{
    private Server issuer;
    private Server unmarked;

    /** Who the stub issuer will say signed in, or null to refuse the client. */
    private volatile String signingInAs;

    @AfterEach
    void stop() throws Exception
    {
        if (unmarked != null)
            unmarked.stop();
        if (issuer != null)
            issuer.stop();
    }

    /* ------------------------------------------------------------ with the login on */

    @Test
    void theOfficersScreensNeedASignInAndTheBoatsNeverDo(@TempDir Path root) throws Exception
    {
        start(root, false);

        // THE SCREENS. Asking for one signed out is answered with the provider's own redirect,
        // not with a 403: the sign-in happens by itself, which is the point of doing this with a
        // constraint rather than a check in a servlet.
        assertThat("the editor asks you to sign in", status("/editor.html"), is(303));
        assertThat("and so does the race screen", status("/race.html"), is(303));

        // THE WRITES BEHIND THEM.
        assertThat("publishing a course needs a sign-in",
            status("POST", "/api/lifecycle/myc.org.au/test-series/publications", "{}"), is(303));
        assertThat("so does conducting a race",
            status("POST", "/api/conduct/myc.org.au/test-series/r1", "{}"), is(303));
        assertThat("so does rewriting a programme file",
            status("PUT", "/api/programmes/myc.org.au/test-series", "{}"), is(303));

        /*
         * AND NOTHING A BOAT DOES. This is the half that would be silent if it were wrong: a
         * login in front of the dialog would stop a fleet racing to protect data that is
         * trusted by construction anyway (§7.1). A 303 here would mean a boat's client meets an
         * HTML sign-in page where it expected its envelopes.
         */
        assertThat("a boat's conversation is never behind the login",
            status("POST", "/api/dialog", "{\"envelopes\":[]}"), not(303));
        assertThat("nor is joining a course",
            status("POST", "/api/join/myc.org.au/test-series/nothing", ""), not(303));
        assertThat("nor is posting a record", status("POST", "/api/records", "{}"), not(303));

        // AND EVERY READ STAYS OPEN, because a club publishes its racing. A read behind a login
        // is a club publishing to itself.
        assertThat("the public course list is open", status("/api/public"), is(200));
        assertThat("the publication log is open", status("/api/log"), is(200));
        assertThat("the programmes are open to read", status("/api/programmes"), is(200));
        assertThat("and so is the boat's own client", status("/boat.html"), is(200));
    }

    @Test
    void signingInOpensTheEditor(@TempDir Path root) throws Exception
    {
        start(root, false);
        HttpClient browser = browser();

        assertThat(status(browser, "/editor.html"), is(303));
        signIn(browser, "officer@myc.org.au");
        assertThat("once signed in, the editor is served", status(browser, "/editor.html"), is(200));
        assertThat("and the race screen with it", status(browser, "/race.html"), is(200));

        // The page learns who it is talking to from the config it already fetches, rather than
        // from an endpoint of its own.
        String config = body(browser, "/api/config");
        assertThat(config, containsString("officer@myc.org.au"));
        assertThat(config, containsString("\"required\" : true"));
    }

    @Test
    void aDomainCanBeNamedAndThenItIsEnforced(@TempDir Path root) throws Exception
    {
        start(root, false, "myc.org.au");
        HttpClient browser = browser();
        signIn(browser, "somebody@example.com");
        // The sign-in SUCCEEDED — the provider vouched for them — and the refusal is ours, on
        // the claim that came back. An account chooser hint on the request is not a control.
        assertThat("an account outside the club's domain is refused",
            status(browser, "/editor.html"), is(403));
        assertThat("...and told how to get out of it, because the usual cause is two accounts "
            + "and a browser that picked the wrong one", body(browser, "/editor.html"),
            containsString("/auth/logout"));
    }

    /* ------------------------------------------------------------- the loopback bypass */

    @Test
    void theLoopbackBypassIsOffUnlessAskedFor(@TempDir Path root) throws Exception
    {
        // Every request in this test arrives from 127.0.0.1, which is exactly the point: a
        // bypass that were on by default would make this test pass while the editor was open
        // to the internet behind any reverse proxy.
        start(root, false);
        assertThat("loopback is not exempt by default", status("/editor.html"), is(303));

        // Only the server, not the stub issuer: the second start discovers against the same
        // one, and stopping it here would leave nothing to discover.
        unmarked.stop();
        start(root, true);
        assertThat("and is when the club asks for it", status("/editor.html"), is(200));
        assertThat("...including for the writes behind the screens",
            status("PUT", "/api/programmes/myc.org.au/test-series", "{}"), not(303));
    }

    /* ---------------------------------------------------------------- with it off */

    @Test
    void withNoAuthFileNothingIsBehindALogin(@TempDir Path root) throws Exception
    {
        startWithoutAuth(root);
        assertThat("the editor is open", status("/editor.html"), is(200));
        assertThat("the race screen is open", status("/race.html"), is(200));
        assertThat("and the config says a login is not required",
            body(browser(), "/api/config"), containsString("\"required\" : false"));
    }

    /* ========================================================================= plumbing */

    private final HttpClient plain = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .followRedirects(HttpClient.Redirect.NEVER)
        .build();

    /** A browser that keeps its session cookie, which the OIDC dance requires. */
    private HttpClient browser()
    {
        return HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NEVER)
            .cookieHandler(new CookieManager())
            .build();
    }

    /** Drive the whole sign-in, as a browser does, and leave the session signed in. */
    private void signIn(HttpClient browser, String email) throws Exception
    {
        signingInAs = email;
        String base = "http://localhost:" + port(unmarked);
        HttpResponse<String> challenge = browser.send(HttpRequest.newBuilder()
            .uri(URI.create(base + "/editor.html")).GET().build(),
            HttpResponse.BodyHandlers.ofString());
        assertThat(challenge.statusCode(), is(303));
        String state = challenge.headers().firstValue("location").orElseThrow()
            .replaceAll(".*[?&]state=([^&]*).*", "$1");
        HttpResponse<String> callback = browser.send(HttpRequest.newBuilder()
            .uri(URI.create(base + "/auth/callback?state=" + state + "&code=a-code"))
            .GET().build(), HttpResponse.BodyHandlers.ofString());
        assertThat("the callback completes the sign-in and sends the browser on",
            callback.statusCode(), is(oneOf(302, 303)));
    }

    private String idToken(String email)
    {
        // The `hd` claim FOLLOWS THE ADDRESS, because that is what a provider asserts: it is
        // the Workspace domain the account actually belongs to. A stub that always claimed the
        // club's domain would make the domain check pass for everybody, which is a test of
        // nothing — and is how it read the first time this ran.
        String claims = """
            {"iss":"%s","aud":"test-client","exp":%d,"iat":%d,
             "email":"%s","name":"A Race Officer","hd":"%s"}"""
            .formatted("http://localhost:" + port(issuer),
                Instant.now().plusSeconds(600).getEpochSecond(),
                Instant.now().getEpochSecond(), email,
                email.substring(email.indexOf('@') + 1));
        Base64.Encoder b64 = Base64.getUrlEncoder().withoutPadding();
        return b64.encodeToString("{\"alg\":\"none\"}".getBytes(StandardCharsets.UTF_8))
            + "." + b64.encodeToString(claims.getBytes(StandardCharsets.UTF_8))
            // A non-empty third section: JwtDecoder splits on "." and String.split drops a
            // trailing empty field, so "header.payload." arrives as two sections.
            + ".not-a-signature";
    }

    /** Just enough of an OpenID provider to start against. */
    private String startStubIssuer() throws Exception
    {
        issuer = new Server(0);
        ServletContextHandler ctx = new ServletContextHandler("/");
        ctx.addServlet(new ServletHolder(new HttpServlet()
        {
            @Override
            protected void doGet(HttpServletRequest req, HttpServletResponse resp)
                throws java.io.IOException
            {
                String base = "http://localhost:" + port(issuer);
                resp.setContentType("application/json");
                resp.getWriter().write("""
                    {"issuer":"%s",
                     "authorization_endpoint":"%s/authorize",
                     "token_endpoint":"%s/token",
                     "jwks_uri":"%s/jwks",
                     "end_session_endpoint":"%s/logout"}
                    """.formatted(base, base, base, base, base));
            }
        }), "/.well-known/openid-configuration");
        ctx.addServlet(new ServletHolder(new HttpServlet()
        {
            @Override
            protected void doPost(HttpServletRequest req, HttpServletResponse resp)
                throws java.io.IOException
            {
                resp.setContentType("application/json");
                if (signingInAs == null)
                {
                    resp.setStatus(401);
                    resp.getWriter().write(
                        "{\"error\":\"invalid_client\",\"error_description\":\"Unauthorized\"}");
                    return;
                }
                resp.getWriter().write("""
                    {"access_token":"an-access-token","token_type":"Bearer","id_token":"%s"}"""
                    .formatted(idToken(signingInAs)));
            }
        }), "/token");
        issuer.setHandler(ctx);
        issuer.start();
        return "http://localhost:" + port(issuer);
    }

    private void start(Path root, boolean allowLoopback) throws Exception
    {
        start(root, allowLoopback, null);
    }

    private void start(Path root, boolean allowLoopback, String domain) throws Exception
    {
        String issuerUrl = issuer == null ? startStubIssuer() : "http://localhost:" + port(issuer);
        Path data = fixture(root);
        // Rewritten each time: the loopback test starts twice against one fixture, and the
        // second start is the one that says allowLoopback: true.
        Files.writeString(data.resolve("config/auth.yaml"), """
            enabled: true
            issuer: "%s"
            clientId: "test-client"
            clientSecret: "test-secret"
            allowLoopback: %s
            %s
            """.formatted(issuerUrl, allowLoopback,
            domain == null ? "" : "allowedDomain: \"" + domain + "\""));
        unmarked = UnmarkedServer.start(data, 0);
    }

    private void startWithoutAuth(Path root) throws Exception
    {
        unmarked = UnmarkedServer.start(fixture(root), 0);
    }

    /** The test fixture's config, copied somewhere an auth.yaml can be dropped beside it. */
    private Path fixture(Path root) throws Exception
    {
        Path data = root.resolve("data");
        Path config = data.resolve("config");
        if (!Files.isDirectory(config))
        {
            Files.createDirectories(config);
            Path from = Path.of("src/test/resources/testdata/config");
            try (var walk = Files.walk(from))
            {
                for (Path file : walk.toList())
                {
                    Path to = config.resolve(from.relativize(file).toString());
                    if (Files.isDirectory(file))
                        Files.createDirectories(to);
                    else
                        Files.copy(file, to);
                }
            }
        }
        return data;
    }

    private static int port(Server server)
    {
        return ((ServerConnector)server.getConnectors()[0]).getLocalPort();
    }

    private int status(String path) throws Exception
    {
        return status(plain, path);
    }

    private int status(HttpClient client, String path) throws Exception
    {
        return client.send(HttpRequest.newBuilder()
            .uri(URI.create("http://localhost:" + port(unmarked) + path)).GET().build(),
            HttpResponse.BodyHandlers.ofString()).statusCode();
    }

    private String body(HttpClient client, String path) throws Exception
    {
        return client.send(HttpRequest.newBuilder()
            .uri(URI.create("http://localhost:" + port(unmarked) + path)).GET().build(),
            HttpResponse.BodyHandlers.ofString()).body();
    }

    private int status(String method, String path, String body) throws Exception
    {
        return plain.send(HttpRequest.newBuilder()
            .uri(URI.create("http://localhost:" + port(unmarked) + path))
            .header("Content-Type", "application/json")
            .method(method, HttpRequest.BodyPublishers.ofString(body)).build(),
            HttpResponse.BodyHandlers.ofString()).statusCode();
    }
}
