package org.mortbay.sailing.unmarkable.server;

import java.io.IOException;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.eclipse.jetty.security.openid.OpenIdAuthenticator;
import org.mortbay.sailing.unmarkable.config.AuthConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The three things a login needs that the login itself cannot provide: a way out, a way back,
 * and a reason when it fails.
 *
 * <p>It runs after the security handler, so by the time it sees a request the sign-in has
 * happened and the claims are on the session. Lifted from sail-jinx, where each of these was
 * added because its absence cost somebody an afternoon.
 */
public class AuthFilter implements Filter
{
    private static final Logger LOG = LoggerFactory.getLogger(AuthFilter.class);

    /**
     * Where Jetty sends a failed sign-in.
     *
     * <p>Configuring one is not cosmetic. With no error page Jetty answers a failed callback
     * with a bare 403, and every way the OIDC dance can fail looks identical from the browser —
     * a stale client secret, an expired code, a session lost to a restart, a tab left open over
     * lunch. Jetty puts the reason in the query; this renders it, and logs it, because the
     * person who can fix it is usually reading the journal on the Pi rather than looking at the
     * browser that failed.
     */
    public static final String ERROR_PATH = "/auth/error";

    /** Signing out has to work for an account that is NOT allowed in — see below. */
    public static final String LOGOUT_PATH = "/auth/logout";

    private final AuthConfig auth;

    public AuthFilter(AuthConfig auth)
    {
        this.auth = auth;
    }

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
        throws IOException, ServletException
    {
        if (!auth.enabled())
        {
            chain.doFilter(request, response);
            return;
        }
        HttpServletRequest req = (HttpServletRequest)request;
        HttpServletResponse resp = (HttpServletResponse)response;
        String path = req.getRequestURI();

        if (path.endsWith(ERROR_PATH))
        {
            signInFailed(req, resp);
            return;
        }
        /*
         * SIGNING OUT MUST WORK FOR SOMEBODY WHO IS NOT ALLOWED IN, which is why it is here and
         * not behind the constraint. The ordinary cause of a refusal is a browser with two
         * accounts signed in that picked the wrong one, and an error page with no way back
         * leaves clearing cookies by hand as the only exit.
         */
        if (path.endsWith(LOGOUT_PATH))
        {
            if (req.getSession(false) != null)
                req.getSession(false).invalidate();
            resp.sendRedirect(req.getContextPath() + "/");
            return;
        }

        SignedIn who = SignedIn.of(req, auth);
        if (who.isSignedIn() && !auth.permits(who.email(), who.domain()))
        {
            LOG.warn("Refused {} — not a {} account", who.email(), auth.allowedDomain());
            deny(req, resp, who.email());
            return;
        }
        chain.doFilter(request, response);
    }

    private void signInFailed(HttpServletRequest req, HttpServletResponse resp) throws IOException
    {
        String reason = firstOf(req.getParameter(OpenIdAuthenticator.ERROR_PARAMETER),
            req.getParameter("error_description"), req.getParameter("error"));
        if (reason == null)
            reason = "no reason given";
        LOG.warn("Sign-in failed: {}", reason);

        resp.setStatus(HttpServletResponse.SC_FORBIDDEN);
        resp.setContentType("text/html; charset=utf-8");
        resp.getWriter().write("""
            <!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
            <title>Sign-in failed &middot; Unmarkable Racing</title>
            <style>body{font:16px/1.5 system-ui,sans-serif;margin:4rem auto;max-width:34rem;
            padding:0 1rem;background:#0e1a26;color:#e6eef6}a{color:#35b5e8}
            code{background:#17293a;padding:.1em .3em;border-radius:3px}</style></head><body>
            <h1>Sign-in failed</h1>
            <p><code>%s</code></p>
            <p><a href="%s">Try again.</a> If it keeps failing, the reason above is the thing to
            fix &mdash; it is in the server log too.</p>
            </body></html>
            """.formatted(esc(reason), esc(req.getContextPath() + "/")));
    }

    private void deny(HttpServletRequest req, HttpServletResponse resp, String email)
        throws IOException
    {
        resp.setStatus(HttpServletResponse.SC_FORBIDDEN);
        resp.setContentType("text/html; charset=utf-8");
        resp.getWriter().write("""
            <!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
            <title>Wrong account &middot; Unmarkable Racing</title>
            <style>body{font:16px/1.5 system-ui,sans-serif;margin:4rem auto;max-width:34rem;
            padding:0 1rem;background:#0e1a26;color:#e6eef6}a{color:#35b5e8}</style></head><body>
            <h1>Not a club account</h1>
            <p>You are signed in as <strong>%s</strong>, which is not a <strong>%s</strong>
            account.</p>
            <p>If you have more than one account, the browser may have picked the wrong one.
            <a href="%s">Sign out and try again.</a></p>
            </body></html>
            """.formatted(esc(email), esc(auth.allowedDomain()),
            esc(req.getContextPath() + LOGOUT_PATH)));
    }

    private static String firstOf(String... values)
    {
        for (String value : values)
        {
            if (value != null && !value.isBlank())
                return value;
        }
        return null;
    }

    private static String esc(String value)
    {
        return value == null ? "" : value.replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace("\"", "&quot;");
    }
}
