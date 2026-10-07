/**
 * WHO IS SIGNED IN — on the two screens that require it, and on the front page, which is where
 * somebody goes to sign in or to change account.
 *
 * <b>It renders nothing at all where there is no login</b>, which is the whole of its
 * judgement: a server with no `auth.yaml` is a machine on a desk, and showing it an empty
 * account slot would be showing it a feature it has not got. Where there IS a login, being
 * able to sign out matters more than the name — the ordinary failure is a browser with two
 * accounts that picked the wrong one, and an officer's screen with no way out of that is a
 * phone call to whoever runs the Pi.
 *
 * Read off `/api/config`, which every page fetches anyway; a second endpoint to learn a name
 * nobody decides anything from would be a second thing to keep in step.
 */
export async function showWhoami(id = 'whoami') {
  const into = document.getElementById(id);
  if (!into) return null;
  try {
    const config = await (await fetch('/api/config')).json();
    const auth = config.auth ?? {};
    if (!auth.required) return null;
    // SIGNED OUT, a way in, which comes back to this page. The provider is asked to show its
    // account chooser, so a browser holding two accounts is asked which rather than guessed for.
    if (!auth.signedIn) {
      const back = encodeURIComponent(location.pathname + location.search);
      into.innerHTML = `<a href="${esc(auth.login ?? '/auth/login')}?to=${back}">sign in</a>`;
      return auth;
    }
    const who = auth.name || auth.email || 'signed in';
    into.innerHTML = `${esc(who)} &middot; <a href="${esc(auth.logout ?? '/auth/logout')}">sign out</a>`;
    return auth;
  } catch {
    // The page works without knowing. It is a name in a corner, not a control.
    return null;
  }
}

/**
 * THE CLUBS THIS ACCOUNT MAY CHANGE, from what `showWhoami` returned: a set of club ids, or null
 * for every club — no login, a super-admin, or a server that names no officers. The officer's
 * screens offer only these; the server checks every write again, so this is a convenience and
 * never the control.
 */
export function editableClubs(auth) {
  return auth?.allClubs === false ? new Set(auth.clubs ?? []) : null;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (value) => String(value ?? '').replace(/[&<>"]/g, (c) => ESC[c]);
