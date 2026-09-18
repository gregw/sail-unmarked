package org.mortbay.sailing.unmarkable.config;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Who may run a club's racing from this server, loaded from {@code data/config/auth.yaml}.
 *
 * <p>Lifted from sail-jinx, which has this working, and narrowed to what this system asks of
 * it. The shape is deliberately the same so a club running both does not have two different
 * ideas of how to register an OAuth client.
 *
 * <p><b>AUTHENTICATE AUTHORITY, TRUST DATA</b> — the dialog document §7.1, and the whole of why
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
 * <p><b>Absent means off.</b> No file, or {@code enabled: false}, and the server behaves
 * exactly as it did before there was a login — which is right for the machine on a desk and
 * wrong for anything with a network around it.
 */
public record AuthConfig(
    @JsonProperty("enabled") boolean enabled,
    @JsonProperty("issuer") String issuer,
    @JsonProperty("clientId") String clientId,
    @JsonProperty("clientSecret") String clientSecret,
    @JsonProperty("redirectPath") String redirectPath,
    @JsonProperty("allowedDomain") String allowedDomain,
    @JsonProperty("allowLoopback") boolean allowLoopback)
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
        if (!redirectPath.startsWith("/"))
            redirectPath = "/" + redirectPath;
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
        LOG.info("Sign-in required for the editor and the race screen: {} accounts via {}{}",
            auth.allowedDomain() == null ? "any" : auth.allowedDomain(), auth.issuer(),
            auth.allowLoopback() ? ", loopback exempt" : "");
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
     * <p><b>Any authenticated account, unless a domain is named.</b> That is the setting this
     * was asked for and it is the honest one for now: a club that has not said who its officers
     * are has not said it, and inventing a list here would be pretending to a policy nobody set.
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
