package org.mortbay.sailing.unmarked.config;

import java.io.IOException;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Who may run a club's racing from this server, loaded from {@code data/config/auth.yaml}.
 *
 * <p>Narrowed to what this system asks of a login: one OpenID Connect client, registered once
 * with the provider, and optionally one domain whose accounts may sign in.
 *
 * <p><b>AUTHENTICATE AUTHORITY, TRUST DATA</b> — dialog §7.1, and the whole of why
 * this is asymmetric. A boat's positions and instants are trusted by design, so a login on a
 * boat would only put a name to a claim nothing can check. Publishing a course, scheduling a
 * start, abandoning a race: those are decisions imposed on a fleet, and <em>who did this</em>
 * has an answer that matters. So the officer's screens are behind a login and nothing a boat
 * does is, and that asymmetry is the design rather than a stage on the way to authenticating
 * everybody.
 *
 * <p><b>Kept in its own file because it holds a client secret.</b> {@code config.yaml} is
 * committed; this is in {@code .gitignore} and must stay there. {@code auth.yaml.example}
 * beside it shows the shape without the secret.
 *
 * <p><b>Absent means off.</b> No file, or {@code enabled: false}, and the editor, the race
 * screen and the writes behind them are open to anything that can reach the port — which is
 * right for the machine on a desk and wrong for anything with a network around it.
 */
public record AuthConfig(
    @JsonProperty("enabled") boolean enabled,
    @JsonProperty("issuer") String issuer,
    @JsonProperty("clientId") String clientId,
    @JsonProperty("clientSecret") String clientSecret,
    @JsonProperty("redirectPath") String redirectPath,
    @JsonProperty("allowedDomain") String allowedDomain,
    @JsonProperty("allowLoopback") boolean allowLoopback,
    @JsonProperty("allowIP") String allowIP)
{
    private static final Logger LOG = LoggerFactory.getLogger(AuthConfig.class);

    private static final JsonMapper YAML_MAPPER = JsonMapper.builder(new YAMLFactory())
        .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
        .build();

    /** Google's OpenID Connect issuer. Everything else is discovered from it. */
    public static final String GOOGLE = "https://accounts.google.com";

    public AuthConfig
    {
        if (issuer == null || issuer.isBlank())
            issuer = GOOGLE;
        if (redirectPath == null || redirectPath.isBlank())
            redirectPath = "/auth/callback";
        // A WHOLE URL IS TAKEN FOR ITS PATH. The provider's console asks for the whole redirect
        // URI, so that is what gets pasted here too — and prefixed with a slash it became
        // "/https://host/auth/callback", which Jetty put after the host again and the provider
        // refused as a mismatch nothing on screen could explain. The scheme and host are
        // Jetty's to supply, from the request (and the forwarded headers behind a proxy).
        redirectPath = pathOf(redirectPath.trim());
        if (!redirectPath.startsWith("/"))
            redirectPath = "/" + redirectPath;
    }

    /** A login with no addresses let past it. */
    public AuthConfig(boolean enabled, String issuer, String clientId, String clientSecret,
        String redirectPath, String allowedDomain, boolean allowLoopback)
    {
        this(enabled, issuer, clientId, clientSecret, redirectPath, allowedDomain, allowLoopback, null);
    }

    /** An IP address literal, IPv4 dotted or IPv6 with colons — never a name to be looked up. */
    private static final Pattern LITERAL =
        Pattern.compile("\\d{1,3}(\\.\\d{1,3}){3}|[0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*");

    /**
     * THE ADDRESSES LET PAST THE LOGIN, as administrators: every address in {@code allowIP}, and
     * with {@code allowLoopback} the machine's own, {@code 127.0.0.1} and {@code ::1}.
     *
     * <p>Matched against the CONNECTION, never against a header — see
     * {@code UnmarkedSecurityHandler}. So behind a router or proxy that terminates the
     * connection, the address seen is the router's, and listing it would let past everybody who
     * comes through it.
     *
     * <p>Literals only. A host name would be looked up, and a bypass that followed DNS would be
     * whoever controlled the name. An entry that is not an address is left out and said so, which
     * is the safe way to be wrong: one fewer way past the login, not one more.
     */
    public Set<InetAddress> bypass()
    {
        List<String> entries = new ArrayList<>();
        if (allowLoopback)
            entries.addAll(List.of("127.0.0.1", "::1"));
        if (allowIP != null)
        {
            for (String entry : allowIP.split(","))
            {
                if (!entry.isBlank())
                    entries.add(entry.trim());
            }
        }
        Set<InetAddress> out = new LinkedHashSet<>();
        for (String entry : entries)
        {
            try
            {
                if (!LITERAL.matcher(entry).matches())
                    throw new UnknownHostException("not an IP address");
                out.add(InetAddress.getByName(entry));
            }
            catch (UnknownHostException e)
            {
                LOG.error("auth.yaml allowIP: '{}' is not an IP address and is ignored — list "
                    + "addresses, not names", entry);
            }
        }
        return out;
    }

    /** The path of a URL, or the value itself when it is not one. */
    static String pathOf(String value)
    {
        int scheme = value.indexOf("://");
        if (scheme < 0)
            return value;
        int path = value.indexOf('/', scheme + 3);
        return path < 0 ? "/" : value.substring(path);
    }

    /** The off switch, for when there is no file at all. */
    public static AuthConfig disabled()
    {
        return new AuthConfig(false, null, null, null, null, null, false);
    }

    /**
     * Load {@code auth.yaml} from the config directory, or {@link #disabled()} if it is absent.
     *
     * <p>A file that is present but unreadable is <em>not</em> treated as "off". Failing open on
     * a broken security config is how a server ends up unprotected for a week without anybody
     * noticing, so this throws and the server does not start.
     */
    public static AuthConfig load(Path configDir) throws IOException
    {
        Path file = configDir.resolve("auth.yaml");
        if (!Files.isRegularFile(file))
        {
            LOG.info("No {} — the editor and the race screen are OPEN to anyone who can reach "
                + "this port", file);
            return disabled();
        }
        AuthConfig auth = YAML_MAPPER.readValue(file.toFile(), AuthConfig.class);
        if (!auth.enabled())
        {
            LOG.warn("{} says enabled: false — the editor and the race screen are OPEN", file);
            return auth;
        }
        auth.requireUsable(file);
        Set<InetAddress> bypass = auth.bypass();
        LOG.info("Sign-in required for the editor and the race screen: {} accounts via {}{}",
            auth.allowedDomain() == null ? "any" : auth.allowedDomain(), auth.issuer(),
            bypass.isEmpty() ? "" : ", and these addresses treated as administrators without one: "
                + bypass.stream().map(InetAddress::getHostAddress).toList());
        return auth;
    }

    /** Refuse to start half-configured rather than start unprotected. */
    private void requireUsable(Path file)
    {
        if (clientId == null || clientId.isBlank())
            throw new IllegalStateException(file + ": clientId is required when enabled");
        if (clientSecret == null || clientSecret.isBlank())
            throw new IllegalStateException(file + ": clientSecret is required when enabled");
    }

    /**
     * Whether this signed-in account may use the officer's screens.
     *
     * <p><b>Any authenticated account, unless a domain is named.</b> A club that has not said
     * who its officers are has not said it, and inventing a list here would be pretending to a
     * policy nobody set.
     * Naming {@code allowedDomain} narrows it to a club's own Workspace.
     *
     * <p>Checked against the {@code hd} claim — the domain Google itself asserts — falling back
     * to the address. The {@code hd} parameter on the <em>request</em> is only a hint to the
     * account chooser and is not a control; the check has to happen here, on what came back.
     *
     * <p>A second tier — some accounts may abandon a race, others only watch — is where it would
     * go, and it is deliberately not here: nothing enforces one today, and a field nothing
     * enforces reads as a promise.
     */
    public boolean permits(String email, String hostedDomain)
    {
        if (email == null || email.isBlank())
            return false;
        if (allowedDomain == null || allowedDomain.isBlank())
            return true;
        String want = allowedDomain.trim().toLowerCase(Locale.ENGLISH);
        if (hostedDomain != null && want.equalsIgnoreCase(hostedDomain.trim()))
            return true;
        return email.trim().toLowerCase(Locale.ENGLISH).endsWith("@" + want);
    }
}
