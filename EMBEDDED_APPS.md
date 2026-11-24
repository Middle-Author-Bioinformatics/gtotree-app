# Embedded and full-page MAB apps

The apps support both iframe embeds such as `midauthorbio.com/#fegenie` and their existing standalone URLs. Cognito's sign-in pages cannot be displayed inside an iframe: the browser blocks their `frame-ancestors 'none'` policy. Do not weaken that policy.

## Embedded behavior

- An existing saved account restores inside the embedded app. Refresh-token renewal uses the token endpoint, not a Cognito login iframe.
- When no saved embedded session exists, **Sign in** opens a small top-level window. Cognito can reuse the shared MAB sign-in cookie there. **Create free account** uses the same popup flow and opens registration.
- The popup returns to the existing registered app callback URL. `oidc-client-ts` relays that response to the opening app; the opener validates its transaction state/PKCE, exchanges the code and loads the account. The iframe stays on the original website/result route.
- Automatic redirects and automatic sign-in popups are suppressed in an unsigned embedded app. Browsers require a user action to open a popup, so the first embedded sign-in can require one click even if the user has signed in to another MAB app. An active Cognito cookie can avoid asking for credentials again; Cognito's one-hour cookie limit still applies.
- **Open full page** is available on the account entry and in the signed-in header controls. It opens the same app/result route in a new tab and strips OAuth callback parameters from the link. This is also the fallback when a browser blocks or isolates the sign-in window.
- Sign-out uses a first-party app window, clears its saved credentials, visits Cognito's normal logout endpoint, and closes after returning. The embedded workspace never navigates to Cognito. If the window is blocked, the embedded session still clears and a **Finish signing out** link completes the browser sign-out.

Some browsers partition the embedded app's storage from its standalone storage. The popup response is processed and stored by the original iframe, so it does not depend on those two storage partitions being shared. If all embedded storage is blocked, the current window can use an in-memory session; a later reload may require another sign-in.

## Full-page behavior

Direct app URLs retain the existing automatic Cognito SSO check, remembered sessions, background refresh and ordinary full-page login/logout flow. Users can choose either view. The same MAB profile, app clients and backend authorization apply in both modes.

## Deploy

Merge the coordinated GToTree, TaxonSleuth, FeGenie, breseq and BASIL PRs. Amplify's existing automatic main deployments apply the fix. Then refresh the website page so its iframe loads the new app build.

No changes to Cognito callback/sign-out allow-lists, Lambda, CloudShell or The Belly are required. The popup uses each app's already-registered root callback and sign-out URLs. The public website's existing embeds can remain unchanged.

If an embed has a `sandbox` attribute, its owner must allow scripts, same-origin storage and popups, including allowing popups to escape the sandbox so Cognito can load normally. The observed FeGenie embed on midauthorbio.com currently has no sandbox attribute. Embedded app responses must also remain permitted by the website's own iframe policies.

## Verify after deployment

1. Open `midauthorbio.com/#fegenie` in a fresh browser session. It should show the app's account screen without a blocked Cognito frame.
2. Select Sign in. Complete sign-in in the new window; it should close and the original embedded app should show the workspace/profile form.
3. Repeat with Create free account and a test registration. The required profile fields remain unchanged.
4. While the shared Cognito browser session is active, sign in to a second embedded MAB app. The popup should return without requiring credentials again.
5. Reopen an already-used embedded app and check its saved session, refresh behavior, result links and reports.
6. Test Open full page, then test both embedded and standalone sign-out. If popups are blocked, check the full-page/finish-sign-out links.

The code tests model independent popup/opener storage, actual OIDC popup callbacks, blocked storage/windows and embedded UI state. Live credentials and browser-specific popup/cookie behavior still require the post-deployment checks above.
