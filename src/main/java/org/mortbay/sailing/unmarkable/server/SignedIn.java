package org.mortbay.sailing.unmarkable.server;

import java.util.Locale;
import java.util.Map;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.eclipse.jetty.security.openid.OpenIdAuthenticator;
import org.mortbay.sailing.unmarkable.config.AuthConfig;

/**
 * Who is making this request, as the rest of the server cares about it.
 *
 * <p>The claims come from the session, where {@code OpenIdAuthenticator} leaves them after a
 * successful login. Reading them there rather than re-parsing the id token keeps this to a map
 * lookup and means the token is verified exactly once, by Jetty.
 *
 * @param email  the account, lower-cased, or null when nobody is signed in
 * @param name   the display name the provider supplies, or null
 * @param domain the {@code hd} claim — the Workspace domain the provider asserts
 */
public record SignedIn(String email, String name, String domain)
{
    /** Authentication is off, or this is the exempt loopback: treat it as an officer. */
    public static final SignedIn OPEN = new SignedIn(null, null, null);

    /** Authentication is on and nobody is signed in. */
    public static final SignedIn NOBODY = new SignedIn(null, null, null);

    public boolean isSignedIn()
    {
        return email != null;
    }

    /**
     * Read the signed-in account off the request.
     *
     * <p>Only for DISPLAY and for the domain check — never for deciding whether a request is
     * allowed. That decision belongs to {@link UnmarkableSecurityHandler}, in one place, where
     * Jetty can act on it by sending the browser to sign in rather than by refusing it.
     */
    public static SignedIn of(HttpServletRequest req, AuthConfig auth)
    {
        if (auth == null || !auth.enabled())
            return OPEN;
        Map<String, Object> claims = claims(req);
        if (claims == null)
            return NOBODY;
        String email = str(claims.get("email"));
        return new SignedIn(email == null ? null : email.toLowerCase(Locale.ENGLISH),
            str(claims.get("name")), str(claims.get("hd")));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> claims(HttpServletRequest req)
    {
        HttpSession session = req.getSession(false);
        if (session == null)
            return null;
        Object claims = session.getAttribute(OpenIdAuthenticator.CLAIMS);
        return claims instanceof Map ? (Map<String, Object>)claims : null;
    }

    private static String str(Object value)
    {
        return value == null ? null : String.valueOf(value);
    }
}
