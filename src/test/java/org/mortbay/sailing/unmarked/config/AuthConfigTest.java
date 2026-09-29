package org.mortbay.sailing.unmarked.config;

import org.junit.jupiter.api.Test;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.is;

/**
 * What {@code auth.yaml} is read as.
 */
public class AuthConfigTest
{
    private static AuthConfig with(String redirectPath)
    {
        return new AuthConfig(true, null, "id", "secret", redirectPath, null, false);
    }

    @Test
    public void theCallbackIsAPath()
    {
        assertThat(with(null).redirectPath(), is("/auth/callback"));
        assertThat(with("/auth/callback").redirectPath(), is("/auth/callback"));
        assertThat(with("auth/callback").redirectPath(), is("/auth/callback"));
    }

    @Test
    public void aWholeUrlIsTakenForItsPath()
    {
        // The provider's console asks for the whole redirect URI, so that is what gets pasted
        // here too. Prefixed with a slash it became "/https://host/auth/callback", which Jetty put
        // after the host again: a redirect_uri_mismatch nothing on screen could explain.
        assertThat(with("https://unmarked.mortbay.org/auth/callback").redirectPath(), is("/auth/callback"));
        assertThat(with(" http://localhost:8083/auth/callback ").redirectPath(), is("/auth/callback"));
        assertThat(with("https://unmarked.mortbay.org").redirectPath(), is("/"));
    }

    private static java.util.List<String> bypassed(boolean loopback, String allowIP)
    {
        return new AuthConfig(true, null, "id", "secret", null, null, loopback, allowIP).bypass()
            .stream().map(java.net.InetAddress::getHostAddress).toList();
    }

    @Test
    public void allowIPIsAListOfAddressesLetPastTheLogin()
    {
        assertThat("none by default", bypassed(false, null).isEmpty(), is(true));
        assertThat(bypassed(false, "192.168.1.20, 192.168.1.21"),
            is(java.util.List.of("192.168.1.20", "192.168.1.21")));
        assertThat("an IPv6 address is an address too", bypassed(false, "fe80::1").size(), is(1));
    }

    @Test
    public void allowLoopbackIsThisMachinesOwnAddresses()
    {
        // Both, or whether "localhost" worked would depend on which the browser resolved it to.
        assertThat(bypassed(true, null), is(java.util.List.of("127.0.0.1", "0:0:0:0:0:0:0:1")));
        assertThat("...added to the list, not instead of it", bypassed(true, "10.0.0.5").size(), is(3));
    }

    @Test
    public void aNameIsNotAnAddressAndIsLeftOut()
    {
        // A host name would be looked up, and a bypass that followed DNS would be whoever
        // controlled the name. Left out, so being wrong costs a way past the login, never adds one.
        assertThat(bypassed(false, "officer-laptop, cafe, 10.0.0.9"), is(java.util.List.of("10.0.0.9")));
    }
}
