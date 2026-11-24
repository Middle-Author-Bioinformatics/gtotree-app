# Embedded and full-page MAB apps

Both iframe embeds on midauthorbio.com and direct app URLs are supported. Cognito sign-in pages cannot be framed. They can also disconnect their popup from the opening iframe: the popup then has no opener and its old WindowProxy can appear closed. Shared storage/BroadcastChannel cannot be assumed across first-party and embedded storage partitions.

## Embedded sign-in

1. The user clicks Sign in or Create free account. A popup opens immediately, before network requests.
2. The original iframe registers a ten-minute callback ticket with the shared account API. The read and write capabilities are independent 256-bit random secrets; the service stores only their SHA-256 hashes.
3. The authorization request carries a separator-safe opaque state containing the ticket ID, write capability and original OIDC state. The PKCE verifier and read capability remain in the original iframe.
4. After Cognito returns to the app's existing root callback, that page sends only the authorization code or OAuth error to the ticket. It does not exchange tokens or open a separate signed-in workspace.
5. The original iframe polls with its read capability. A conditional DynamoDB delete delivers a completed response to one reader only. The original OIDC state is restored, and oidc-client-ts validates the transaction and completes the PKCE exchange in the iframe.

This flow does not require window.opener, postMessage, BroadcastChannel, shared first-party storage or a usable WindowProxy.closed value. Cancel and a ten-minute timeout stop polling; expired records are rejected even before DynamoDB TTL cleanup. Popups may close themselves, or show a short return-to-original-tab message if closing is blocked.

The service permits these narrow pre-login routes only for configured app origins. Secrets stay in POST bodies except for the write capability carried in OAuth state. Responses use no-store. It does not relay access tokens, refresh tokens, passwords, profiles or PKCE verifiers. All existing profile, upload, result and administrator routes still require the same verified Cognito authentication and profile checks. No browser isolation or Cognito framing protections are weakened.

Saved embedded sessions continue to restore and renew through the token endpoint. Where embedded storage is blocked completely, an in-memory session works until reload. An anonymous embed does not automatically open login windows. A first embedded visit may require one Sign in click; an active shared Cognito cookie can avoid another password prompt. Cognito's existing cookie and refresh-token lifetimes still apply.

## Full-page access

Direct URLs keep the existing redirect-based Cognito flow, saved sessions and refresh behavior. Open full page remains available in embedded account screens and header controls. The website embeds and root Cognito callback/logout URLs do not need to change. Existing embedded sign-out uses a first-party sign-out window and a full-page fallback.

## Deploy this update

Merge the coordinated frontend PRs, including the shared-service changes in gtotree-app. Let Amplify deploy all five frontends. Then, in AWS CloudShell, from your gtotree-app checkout:

```bash
git pull --ff-only
bash accounts/update-popup-relay.sh
```

The update script reads the currently deployed mab-accounts stack parameters and preserves its app clients, origin allow-list, bucket settings and app configuration. It deploys the new code, a TTL-enabled popup table, and table-scoped IAM permissions. It does not rerun client setup, private-bucket cutover or frontend configuration. An old account service cannot handle the new tickets, so embedded sign-in will not complete until this update finishes; full-page sign-in remains available meanwhile.

No changes on The Belly are needed. No new Cognito callback URLs are needed. Refresh the website once both frontend and shared-service deployments finish.

## Verify after deployment

- Open midauthorbio.com/#taxonsleuth. Select Sign in, finish Cognito login, and verify that the original iframe shows the workspace. A separate signed-in full-page window is not the success criterion.
- Repeat with FeGenie and a second app, and check free account creation with the required profile fields.
- Verify saved sessions, result links, the TaxonSleuth-to-GToTree handoff, Cancel, Open full page and sign-out.
- Test in Chrome and Safari with default privacy settings. A live account sign-in after deployment is still needed; automated tests simulate severed opener references and independent storage.
