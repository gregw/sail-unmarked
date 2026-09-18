# Signing in, and installing on the Pi

**Who has to be authenticated, who must never be, and how this gets onto a committee boat.**
Implemented in `config/AuthConfig`, `server/SignedIn`, `server/AuthFilter`,
`server/UnmarkedSecurityHandler` and Jetty's OpenID Connect; installed by `etc/install.sh` and
`etc/sail-unmarked.service`.

Lifted from [`sail-jinx`](../../sail-jinx), which has this working, and narrowed to what this system
asks of it. The shape of `auth.yaml` is deliberately the same, so a club running both registers one
OAuth client and learns one file.

---

## What is behind it, and what must never be

**AUTHENTICATE AUTHORITY, TRUST DATA** — [dialog §7.1](client-server-dialog.md), made mechanical in
`UnmarkedSecurityHandler.getConstraint`:

| | |
|---|---|
| **Needs a sign-in** | `editor.html`, `race.html`, and every non-GET on `/api/programmes`, `/api/lifecycle`, `/api/conduct` |
| **Open to everybody** | every GET, `POST /api/join`, `POST /api/records`, and the whole of `/api/dialog` |

**The second row is the one to be careful with.** A login that keeps the wrong people out is easy to
write and easy to check; a login that also quietly keeps a FLEET out — by sitting in front of the
dialog — would look exactly like a working login until a race day, when every boat meets an HTML
sign-in page where it expected its envelopes. `AuthIntegrationTest` asserts the open half as
deliberately as the closed one.

**Boats are never authenticated, and that is not a stage on the way to authenticating them.** A boat's
positions and instants are trusted by construction, so a login there would put a name to a claim
nothing can check; an officer's acts are decisions imposed on a fleet, and *who did this* has an answer
that matters.

**Reads stay open**, because a club publishes its racing. A read behind a login is a club publishing to
itself.

**`server.configWrites` stays as the second lock**: a club that has not set a login up can still turn
the config writes off entirely.

## A constraint, not a check in a servlet

The login happens **by itself**: asking for `editor.html` while signed out sends the browser through
the provider and back to the editor. A servlet that returned 403 would need a sign-in button somebody
had to find, and an API call that got one would have nowhere to send them.

The same choice is why the constraint is by **method as well as path**. The same prefix serves reads
and writes, so a URL pattern alone cannot say *unless it is a GET*.

## The loopback bypass, and why it is off by default

`allowLoopback: true` treats a request from this machine as an officer's, which is what a laptop you
are sitting at wants. **It is opt-in, and that is the important half: behind a reverse proxy every
request in the world arrives from 127.0.0.1.** A bypass left on would hand the editor to the internet
on the first club that put nginx in front of this, silently.

It is read off the **connection**, never off `X-Forwarded-For`, which is whatever the client said it
was — a bypass that believed a header would be no bypass at all.

## What a login needs that the login cannot provide

Three things, each in `AuthFilter`:

- **An error page.** With none, Jetty answers a failed callback with a bare 403, and every way the
  dance can fail looks identical from the browser — a stale client secret, an expired code, a session
  lost to a restart, a tab left open over lunch. The reason is in the query; this renders it and logs
  it, because whoever can fix it is reading the journal on the Pi.
- **A way out.** Signing out has to work for an account that is **not** allowed in: the ordinary cause
  of a refusal is a browser with two accounts that picked the wrong one.
- **The domain check.** Jetty's authenticator establishes that the provider knows who you are — *any*
  account of theirs. `allowedDomain` narrows that to a club, checked against the `hd` claim that came
  back rather than the hint on the request, which is only a hint to an account chooser.

> **`allowedDomain` is blank by default, and that is a real setting rather than a placeholder.** Any
> account the provider will vouch for may use the editor, which is what a prototype being tested by a
> handful of people wants.

> **A second tier is deliberately absent.** *Some accounts may abandon a race and others only watch* is
> a sensible thing to want, and a field that nothing enforces reads as a promise. sail-jinx has an
> `admins` list because it has two tiers to separate; this has one.

## Offline, and tested that way

`AuthIntegrationTest` starts a **stub issuer** — a discovery document and an unsigned id token — and
completes a whole sign-in with no network and no real secret: Jetty's `JwtDecoder` base64-decodes the
token and checks the issuer, audience and expiry, never a signature. That is what makes the constraint
testable rather than merely asserted.

> **A stub has to tell the truth about the thing under test.** The first one minted `hd: myc.org.au`
> for every account, so the domain check passed for an `example.com` address and the test proved
> nothing. The `hd` claim follows the address now.

**Sessions are in memory** and go when the process does, so a restart signs the officer out. Nothing a
boat is doing is affected, because no boat has a session here at all.

**Discovery is the one outbound call this server makes**, at start-up, to find the provider's endpoints
and keys. A server with authentication on therefore **needs the network to start** — worth knowing
before switching it on for a Pi on a committee boat.

---

## Installing it

`etc/install.sh` is sail-jinx's, step for step, because a club running both should not have to learn two
deployments: same system user, same `/opt` and `/var/lib` split, same seed-but-never-overwrite rule,
same restart-only-if-it-was-running. `git pull && sudo etc/install.sh` is the upgrade.

The deployed names are **`sail-unmarked`** throughout — the unit, the service user, `/opt/sail-unmarked`
and `/var/lib/sail-unmarked` — matching the repository and sitting alongside `sail-jinx` on the same
machine. The Java package and the `unmarked-data` property keep the plain name.

**The login adds three things, each of which exists because of how this goes wrong:**

- **`auth.yaml.example` is seeded; `auth.yaml` never is.** A file that turned the login on with somebody
  else's client id would be worse than no file — the club would be locked out of its own editor by a
  stranger's OAuth registration.
- **`auth.yaml` is forced to mode 600 on every run**, because it holds a client secret and an upgrade
  must not quietly loosen a mode somebody set by hand.
- **The last thing printed is the thing not done.** With no `auth.yaml` the script ends by saying the
  editor and the race screen are open to anything that can reach the Pi, and gives the four commands to
  fix it — including the two that are easy to get wrong: the server needs a route at *start-up* once a
  login is configured, and `allowLoopback` must stay false behind a reverse proxy. An install that ends
  with "complete" and says nothing else invites somebody to believe it is ready for a club night.

The unit starts `After=network-online.target` for the same discovery reason, and confines the process to
`/var/lib/sail-unmarked`: the store holds boats' own accounts of their races, which is the evidence
behind every result.
