package org.mortbay.sailing.unmarked.server;

import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.SocketAddress;
import java.util.Set;

import org.eclipse.jetty.ee10.servlet.ServletContextRequest;
import org.eclipse.jetty.security.Constraint;
import org.eclipse.jetty.security.SecurityHandler;
import org.eclipse.jetty.server.Request;
import org.mortbay.sailing.unmarked.config.AuthConfig;

/**
 * WHAT NEEDS A LOGIN, IN ONE PLACE — and it is the officer's half of the system and nothing
 * else.
 *
 * <p><b>Authenticate authority, trust data</b> (dialog §7.1). Publishing a course,
 * scheduling a start and abandoning a race are decisions imposed on a fleet, and <em>who did
 * this</em> has an answer that matters; a boat's positions and instants are trusted by design,
 * so a login there would put a name to a claim nothing can check. The list below is that
 * sentence made mechanical, and the two things NOT on it matter as much as the things that are:
 *
 * <ul>
 * <li><b>{@code /api/dialog/*} is never constrained</b>, and nor are {@code POST /api/join}
 *     and {@code POST /api/records}. That is the boats' side, and boats are never
 *     authenticated. A login in front of it would look exactly like a working login until
 *     race day, and then stop a fleet racing to protect data that is trusted anyway.
 *     {@code AuthIntegrationTest} asserts the open half as deliberately as the closed one.
 * <li><b>Every GET stays open.</b> A club publishes its racing: the courses, the log of what
 *     was handed to whom, the results. A read behind a login is a club publishing to itself.
 * </ul>
 *
 * <p><b>It is a CONSTRAINT rather than a check in a servlet</b>, which is what makes the login
 * happen by itself: asking for {@code editor.html} while signed out sends the browser through
 * the provider and back to the editor. A servlet that returned 403 would need a sign-in button
 * somebody had to find, and an API call that got one would have nowhere to send them.
 */
public class UnmarkedSecurityHandler extends SecurityHandler
{
    /**
     * The screens an officer uses. Both are pages a person opens, and both act on a fleet.
     *
     * <p>{@code race.html} is the sharper of the two — it can tell a fleet to stop — but the
     * editor is the one that decides what everybody sails, so neither is the lesser.
     */
    private static final String[] SCREENS = {"/editor.html", "/race.html", AuthFilter.LOGIN_PATH};

    /**
     * The writes behind those screens, which are constrained by METHOD as well as by path.
     *
     * <p>The same prefix serves reads and writes — {@code GET /api/programmes/...} is how any
     * client learns what a club races, and {@code PUT} to the same path rewrites the file — so
     * the constraint cannot be per path alone. That is also why this is here rather than in a
     * URL pattern: a pattern cannot say "unless it is a GET".
     */
    private static final String[] WRITES = {"/api/programmes", "/api/lifecycle", "/api/conduct"};

    private final AuthConfig auth;

    public UnmarkedSecurityHandler(AuthConfig auth)
    {
        this.auth = auth;
        this.bypass = auth.bypass();
    }

    /** The addresses let past the login as administrators — `AuthConfig.bypass`. */
    private final Set<InetAddress> bypass;

    @Override
    protected Constraint getConstraint(String pathInContext, Request request)
    {
        /*
         * THE ADDRESS BYPASS, and it lives here because it is an exemption from a constraint
         * rather than an identity: a request from a listed address — `allowIP`, and this machine's
         * own with `allowLoopback` — is treated as being from an administrator.
         *
         * OPT-IN, and empty by default, because an address is only as good as what stands in front
         * of it: behind anything that terminates the connection — a reverse proxy on this machine,
         * a router doing the TLS — every request arrives from that one address, and listing it
         * would hand the editor to everybody who comes through it, silently.
         *
         * NOT THE SIGN-IN ITSELF: an administrator by address may still choose to sign in, to put
         * a name to what they do, and a sign-in the bypass let straight through would come back
         * signed in as nobody.
         */
        if (!bypass.isEmpty() && !pathInContext.equals(AuthFilter.LOGIN_PATH)
            && bypass.contains(remote(request)))
            return Constraint.ALLOWED;

        for (String screen : SCREENS)
        {
            if (pathInContext.equals(screen))
                return Constraint.ANY_USER;
        }
        // Reads are open; everything else on these paths is an act on somebody's racing.
        String method = request.getMethod();
        if ("GET".equals(method) || "HEAD".equals(method))
            return Constraint.ALLOWED;
        for (String write : WRITES)
        {
            if (pathInContext.startsWith(write))
                return Constraint.ANY_USER;
        }
        return Constraint.ALLOWED;
    }

    /**
     * The address this request's connection came from, or null.
     *
     * <p>Read off the connection rather than off a header, deliberately: {@code X-Forwarded-For}
     * is whatever the client said it was, and a bypass that believed it would be no bypass at
     * all. With the forwarded customizer on, a request through a proxy or a router still arrives
     * on a connection from THAT — which is exactly why no address is let past unless listed.
     */
    private static InetAddress remote(Request request)
    {
        SocketAddress remote = request.getConnectionMetaData().getRemoteSocketAddress();
        return remote instanceof InetSocketAddress inet ? inet.getAddress() : null;
    }

    /**
     * Whether a servlet's request came from an address let past the login — the same test, off
     * the same connection, for the servlet that has to decide which clubs such a request may
     * change.
     */
    public static boolean bypassed(jakarta.servlet.http.HttpServletRequest req, Set<InetAddress> bypass)
    {
        if (bypass.isEmpty())
            return false;
        ServletContextRequest request = ServletContextRequest.getServletContextRequest(req);
        return request != null && bypass.contains(remote(request));
    }
}
