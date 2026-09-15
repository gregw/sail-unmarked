package org.mortbay.sailing.unmarkable.model;

import org.junit.jupiter.api.Test;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.nullValue;

/**
 * An id is a key, not a label, and it ends up in filesystem paths, URL segments, composite
 * keys and YAML mapping keys. These pin what may therefore be in one.
 */
public class IdsTest
{
    @Test
    public void theOrdinaryKebabCaseIdIsLegalEverywhere()
    {
        assertThat(Ids.plain("manly-to-shark"), is(true));
        assertThat(Ids.plain("div1"), is(true));
        assertThat(Ids.plain("a"), is(true));
        assertThat(Ids.plain("sow_and_pigs"), is(true));
    }

    @Test
    public void aSeparatorAtEitherEndIsNotAnId()
    {
        // It reads as a typo, and it is the shape a naive slug produces from " div 1 ".
        assertThat(Ids.plain("-div"), is(false));
        assertThat(Ids.plain("div-"), is(false));
        assertThat(Ids.plain("_div"), is(false));
    }

    @Test
    public void whatWouldBreakAPathOrAKeyIsRefused()
    {
        assertThat("a slash escapes the store tree and splits a URL", Ids.plain("a/b"), is(false));
        assertThat("..  climbs out of it", Ids.plain(".."), is(false));
        assertThat("a space is silently mangled into _ by the store", Ids.plain("div 1"), is(false));
        assertThat("a colon breaks the YAML key it is written as", Ids.plain("div:1"), is(false));
        assertThat("capitals are one id on Linux and another on macOS", Ids.plain("Div1"), is(false));
    }

    @Test
    public void onlyPointsAndLinesMayBeScoped()
    {
        // They are the only ids that never reach a path, a URL segment or a snapshot label.
        assertThat(Ids.scoped("manly-to-shark/windward"), is(true));
        assertThat(Ids.plain("manly-to-shark/windward"), is(false));
        assertThat("but still not a climb", Ids.scoped("a/../b"), is(false));
    }

    @Test
    public void onlyAClubIsADomain()
    {
        assertThat(Ids.domain("myc.org.au"), is(true));
        assertThat(Ids.plain("myc.org.au"), is(false));
        assertThat(Ids.domain("myc..org"), is(false));
        assertThat(Ids.domain(".myc.org"), is(false));
    }

    @Test
    public void aComplaintSaysWhatToDoAboutIt()
    {
        // "invalid identifier" sends somebody looking for a schema; this does not.
        assertThat(Ids.problem("variant", "div 1", Ids.PLAIN),
            containsString("may not contain spaces"));
        assertThat(Ids.problem("variant", "div 1", Ids.PLAIN), containsString("div-1"));
        assertThat(Ids.problem("course", "Manly", Ids.PLAIN),
            containsString("may not contain capitals"));
        assertThat(Ids.problem("course", "manly-to-shark", Ids.PLAIN), is(nullValue()));
    }

    @Test
    public void theSlugIsTheNearestLegalId()
    {
        assertThat(Ids.slug("Div 1", Ids.PLAIN), is("div-1"));
        assertThat(Ids.slug("  Sow & Pigs  ", Ids.PLAIN), is("sow-pigs"));
        assertThat(Ids.slug("div--1", Ids.PLAIN), is("div-1"));
        assertThat(Ids.slug("manly to shark/wind ward", Ids.SCOPED), is("manly-to-shark/wind-ward"));
        assertThat(Ids.slug("MYC.Org.AU", Ids.DOMAIN), is("myc.org.au"));
    }

    @Test
    public void whatSlugsToNothingStaysAsItWas()
    {
        // Renaming somebody's course to "x" because they typed punctuation would be worse
        // than refusing the keystroke; an empty result is the caller's signal to keep the
        // id it had.
        assertThat(Ids.slug("!!!", Ids.PLAIN), is(""));
        assertThat(Ids.slug("", Ids.PLAIN), is(""));
    }

    @Test
    public void everySlugIsItselfLegal()
    {
        // The property that matters: whatever comes out of slug() must pass the rule it was
        // slugged to, or the editor would correct an id into another bad one.
        for (String raw : new String[] {"Div 1", "  a  ", "--x--", "a..b", "A/B/C", "___",
            "réf", "x".repeat(200), "1", "-", "a-", ".hidden", "a b:c#d"})
        {
            String plain = Ids.slug(raw, Ids.PLAIN);
            assertThat(raw + " -> '" + plain + "'", plain.isEmpty() || Ids.plain(plain), is(true));
            String scoped = Ids.slug(raw, Ids.SCOPED);
            assertThat(raw + " -> '" + scoped + "'", scoped.isEmpty() || Ids.scoped(scoped), is(true));
            String domain = Ids.slug(raw, Ids.DOMAIN);
            assertThat(raw + " -> '" + domain + "'", domain.isEmpty() || Ids.domain(domain), is(true));
        }
    }
}
