# Remembered sign-in and automatic SSO

Merge the coordinated frontend PRs in GToTree, TaxonSleuth, FeGenie, breseq and BASIL. Existing Amplify automatic deployments apply these changes. **No CloudShell deployment, worker restart or new AWS resources are required** when the shared MAB account setup is already active.

## Expected behavior

- An existing app session is restored when reopening the app in another tab or after closing/reopening the browser. Existing tab-only sessions are migrated automatically.
- Expired access tokens are refreshed before opening the workspace. Tokens also renew in the background; focusing the app or reconnecting after being offline checks the saved session again. A routine refresh keeps the workspace/report mounted.
- An app with no saved session automatically checks the shared Cognito browser session. With a valid Cognito session, users return to the app without clicking Sign in or entering credentials again. The brief top-level redirect avoids depending on third-party cookies inside a hidden iframe.
- When Cognito has no session, managed login returns to the **Create free account / Sign in** screen. The callback is validated by the OIDC library, and the check does not repeat in a redirect loop.
- GToTree waits for the origin-checked genome handoff to finish and saves its selection before navigating to Cognito. Result query parameters and FeGenie hash routes survive sign-in too.
- Signing out clears that app's remembered session, clears its legacy tab session and updates its other open tabs. The current tab does not automatically sign itself back in after logout. Other apps have their own refresh-token sessions.

## How long users stay signed in

The app uses the existing Cognito client's refresh-token lifetime. Cognito's default is **30 days**, but the actual value is whatever is configured for that client. This change does not lengthen or replace previously issued refresh tokens. Logout, browser storage deletion, revocation or an expired refresh token can require another sign-in. Temporary network errors do not erase the saved account.

AWS fixes the shared managed-login/hosted-UI cookie at **one hour**. Refreshing an app's tokens does not extend that cookie. Consequently, a user's first visit to a different app after that hour can still require credentials even while their previously used apps remain signed in. Once the new app has its own saved session, returning to it uses its refresh token. This is automatic Cognito SSO plus remembered app sessions; it is not an unlimited central account session across unrelated domains.

`prompt=none` is supported by Cognito's managed login (branding version 2). With classic hosted UI, this parameter is not supported; Cognito can show its own login page when there is no valid cookie. The existing-session redirect still reuses the Cognito session where available.

For a strict requirement that **every app, including one never opened before, opens without credentials for the full 30 days**, a durable central account session is needed. Shared custom domains alone do not extend Cognito's cookie. That is a separate architecture change, typically a central account service with a secure HttpOnly session and a server-side refresh token.

Sources: [AWS refresh-token behavior](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-refresh-token.html) and [authorization endpoint / prompt](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html).

## Storage and access

The OIDC user/refresh-token session now uses first-party browser localStorage so it survives tabs and browser restarts. OAuth transaction state and PKCE verifiers remain in sessionStorage, and logout removes the remembered credentials. If persistent storage is blocked, the existing tab session is used instead. Tokens are never added to app-to-app links or sent in the genome-selection messages. Report HTML remains isolated from application storage.

This does not alter the required registration fields, result-code access rules, private backend checks, app-specific client IDs or callback allow-lists. A browser may need to sign in once if its old session has already been lost.

## Verify after Amplify deploys

1. Sign in to TaxonSleuth, select genomes and open GToTree. Confirm the selection arrives without another Sign in click.
2. Open another app while the Cognito browser session is active. It should return directly to its workspace.
3. Close/reopen an already-used app in a new tab, then close/reopen the browser. Its saved session should restore.
4. Leave a report open across an access-token refresh; the report and chosen tab should remain mounted.
5. Sign out and confirm the account screen remains signed out. Test a fresh anonymous browser separately; it should settle on the free-account/sign-in screen rather than looping.
