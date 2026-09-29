package org.mortbay.sailing.unmarked.server;

import org.eclipse.jetty.security.openid.OpenIdAuthenticator;
import org.eclipse.jetty.security.openid.OpenIdConfiguration;
import org.eclipse.jetty.server.Request;

/**
 * Jetty's OpenID Connect authenticator, asking the provider to LET THE PERSON CHOOSE AN ACCOUNT.
 *
 * <p>A browser signed in to Google with two accounts is sent back with whichever one Google
 * guesses, silently. When that is the wrong one — a personal account where the club's is
 * needed — signing out of this server changes nothing: the next sign-in guesses the same way,
 * and the refusal page loops. {@code prompt=select_account} is the OpenID Connect way of asking
 * the provider to show its account chooser instead of guessing, which is what makes "sign out
 * and try again" a way out.
 */
public class ChooseAccountAuthenticator extends OpenIdAuthenticator
{
    public ChooseAccountAuthenticator(OpenIdConfiguration configuration, String redirectPath,
        String errorPage)
    {
        super(configuration, redirectPath, errorPage, null);
    }

    @Override
    protected String getChallengeUri(Request request)
    {
        String uri = super.getChallengeUri(request);
        return uri + (uri.contains("?") ? "&" : "?") + "prompt=select_account";
    }
}
