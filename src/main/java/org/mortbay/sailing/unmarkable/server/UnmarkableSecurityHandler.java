package org.mortbay.sailing.unmarkable.server;

import java.net.InetSocketAddress;
import java.net.SocketAddress;

import org.eclipse.jetty.security.Constraint;
import org.eclipse.jetty.security.SecurityHandler;
import org.eclipse.jetty.server.Request;
import org.mortbay.sailing.unmarkable.config.AuthConfig;

/**
 * WHAT NEEDS A LOGIN, IN ONE PLACE — and it is the officer's half of the system and nothing
 * else.
 *
 * <p><b>Authenticate authority, trust data</b> (dialog document §7.1). Publishing a course,
 * scheduling a start and abandoning a race are decisions imposed on a fleet, and <em>who did
 * this</em> has an answer that matters; a boat's positions and instants are trusted by design,
 * so a login there would put a name to a claim nothing can check. The list below is that
 * sentence made mechanical, and the two things NOT on it matter as much as the things that are:
 *
 * <ul>
 * <li><b>{@code /api/dialog/*} is never constrained.</b> That is the boats' conversation, and
 *     boats are never authenticated — not yet, but never. Putting a login in front of it would
 *     stop a fleet racing to protect data that is trusted anyway.
 * <li><b>Every GET stays open.</b> A club publishes its racing: the courses, the log of what
 *     was handed to whom, the results. A read behind a login is a club publishing to itself.
 * </ul>
 *
 * <p><b>It is a CONSTRAINT rather than a check in a servlet</b>, which is what makes the login
 * happen by itself: asking for {@code editor.html} while signed out sends the browser through
 * the provider and back to the editor. A servlet that returned 403 would need a sign-in button
 * somebody had to find, and an API call that got one would have nowhere to send them.
 */
public class UnmarkableSecurityHandler extends SecurityHandler
{
    /**
     * The screens an officer uses. Both are pages a person opens, and both act on a fleet.
     *
     * <p>{@code race.html} is the sharper of the two — it can tell a fleet to stop — but the
     * editor is the one that decides what everybody sails, so neither is the lesser.
     */
    private static final String[] SCREENS = {"/editor.html", "/race.html"};

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

    public UnmarkableSecurityHandler(AuthConfig auth)
    {
        this.auth = auth;
    }

    @Override
    protected Constraint getConstraint(String pathInContext, Request request)
    {
        /*
         * THE LOOPBACK BYPASS, and it lives here because it is an exemption from a constraint
         * rather than an identity: a request from this machine is treated as being from
         * somebody with their hands on the server.
         *
         * OPT-IN, and that is not caution for its own sake. BEHIND A REVERSE PROXY EVERY
         * REQUEST IN THE WORLD ARRIVES FROM 127.0.0.1 — so a bypass that were on by default
         * would hand the editor to the internet on the first club that put nginx in front of
         * this, and would do it silently. sail-jinx learned that one the same way.
         */
        if (auth.allowLoopback() && isLoopback(request))
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
     * Is this request from this machine?
     *
     * <p>Read off the connection rather than off a header, deliberately: {@code X-Forwarded-For}
     * is whatever the client said it was, and a bypass that believed it would be no bypass at
     * all. When the forwarded customizer is on, a proxied request still arrives on a loopback
     * socket — which is exactly why the bypass is opt-in.
     */
    private static boolean isLoopback(Request request)
    {
        SocketAddress remote = request.getConnectionMetaData().getRemoteSocketAddress();
        if (remote instanceof InetSocketAddress inet && inet.getAddress() != null)
            return inet.getAddress().isLoopbackAddress();
        return false;
    }
}
