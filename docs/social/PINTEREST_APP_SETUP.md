# Pinterest — set up the ClipWaltz app

Sources, read 2026-11-14: Pinterest's "Connect app" guide
(https://developers.pinterest.com/docs/getting-started/set-up-app/) and "Understanding our access tiers"
(https://developers.pinterest.com/docs/key-concepts/access-tiers/). ClipWaltz's addresses below were checked live
on 2026-11-14. Pinterest renames dashboard labels from time to time, so a label may read slightly differently.

This is a **new, separate** app for ClipWaltz. publish.phoenixtekk.com keeps its own Pinterest app. Don't change that one.

## 1. Account requirements
1. Sign in to Pinterest with a **business account**. This account owns and administers the app. You can create one at
   https://help.pinterest.com/business/article/create-an-advertiser-account.
2. Make sure the account's **email address is verified**.
3. Go to **My apps** (https://developers.pinterest.com/apps/) and accept the **Developer Terms of Service**.

## 2. Request the app (Trial access)
1. On **My apps**, click **Connect app** and fill in the request form.

| Field | Value |
|---|---|
| App name | `ClipWaltz`. It must have at least 3 Latin letters or digits and can't contain the word "Pinterest" |
| Website / company URL | `https://www.clipwaltz.com` |
| Privacy policy URL | `https://www.clipwaltz.com/privacy` |
| Description | Give a full description. Pinterest denies vague or incomplete ones. Suggested wording: *"ClipWaltz is a video and image creation app. Users connect their own Pinterest account with OAuth, choose one of their boards, and publish or schedule Pins (image or video with title, description and link) from content they made in ClipWaltz. We read the user's boards so they can pick one, and the username to label the connection. We don't store Pinterest passwords or cookies."* |

2. Submit the request. Pinterest reviews it and emails you whether it was approved or denied.

## 3. Set the redirect URI (after approval)
1. Go to **My apps** and click **Manage** on the ClipWaltz app.
2. On the **Configure** tab, scroll to **Redirect URIs** and enter this URI exactly:
   `https://www.clipwaltz.com/api/social/oauth/pinterest/callback`
   Pinterest requires an exact match, so no trailing slash.
3. Click **Add**.

ClipWaltz requests these five scopes when you connect: `boards:read`, `boards:write`, `pins:read`, `pins:write` and
`user_accounts:read`. You don't need to tick any scopes in the dashboard.

## 4. Send me the keys
On the app's page in **My apps**, copy the **App ID** and **App secret key**. Put them in
`G:\VisualStudioCode\_keys\clipwaltz.txt` as `PINTEREST_APP_ID=` and `PINTEREST_APP_SECRET=`. Don't paste them into
the chat. Then tell me they're there.

I put them in ClipWaltz's production settings and restart the app. Today ClipWaltz is still using the Pinterest keys
copied from publish.phoenixtekk.com.

Then connect: ClipWaltz → **Publish → Networks → Pinterest → Connect**.

## 5. Trial limits — upgrade to Standard before relying on it
With **Trial** access, Pins and boards the app creates are **visible only to their creator**, as sandbox items. Trial
access also has daily rate limits. Real, public Pins need **Standard** access:

1. Record a screen video in ClipWaltz showing the full flow:
   - Publish → Networks → Pinterest → Connect;
   - the Pinterest consent screen;
   - back in ClipWaltz, choose a board;
   - publish a Pin, then show it on Pinterest.

   The video must show the OAuth sign-in and the live Pinterest integration. Pinterest denies requests without them.
2. Go to **My apps**, click **Upgrade** on the app card, check the details, upload the video and submit.
3. Pinterest emails you the decision. To appeal a denial, open a ticket at https://help.pinterest.com/contact/.

Pinterest's access-tier page also says that apps registered on or after 2026-09-14 may get a `403 PINNER_DATA_ACCESS_DENIED`
error when they request a board or Pin for **non-business** users without Pinterest's authorization. If that happens,
send me the error and I'll look into it.
