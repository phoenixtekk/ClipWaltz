# Threads — set up the ClipWaltz app in your new Meta Developer account

Source: Meta's "Get started with the Threads API" (updated 2026-06-30) and "Customize the Threads API use case"
(updated 2025-09-09), both read 2026-11-14. Meta renames dashboard labels from time to time, so a label may read
slightly differently. ClipWaltz's addresses below were checked live on 2026-11-14.

This is a **new, separate** app for ClipWaltz. publish.phoenixtekk.com keeps its own Threads app in the old
account. Don't change that one.

## 1. Create the app
1. Go to https://developers.facebook.com/apps and click **Create app**.
2. App name: `ClipWaltz`. App contact email: your choice.
3. Use case: choose **Access the Threads API**.
4. Business portfolio: you can skip this for now. You only need it later for App Review and business verification.
5. Finish creating the app.

## 2. Permissions
In the left menu, open **Use cases** → **Access the Threads API** → **Customize**. Click **Add** next to each of these:

| Permission | What ClipWaltz uses it for |
|---|---|
| `threads_basic` | Required. Already added, can't be removed |
| `threads_content_publish` | Publishing posts |
| `threads_manage_replies` | Replying from the Comments inbox |
| `threads_read_replies` | Reading replies into the Comments inbox |
| `threads_manage_insights` | Analytics (views, likes, replies, reposts) |

ClipWaltz asks for exactly these five when you connect (as of 2026-11-14).

## 3. Settings (inside the Threads use case)
Open **Settings** in the use case's left menu.

1. Copy the **Threads app ID** and **Threads app secret**. The app also has a separate Meta app ID and secret.
   Don't use those: Meta's docs say to use the Threads ones.
2. Enter these values:

| Field | Value |
|---|---|
| Client OAuth Settings → Valid OAuth Redirect URIs | `https://www.clipwaltz.com/api/social/oauth/threads/callback` |
| Deauthorize callback URL | `https://www.clipwaltz.com/api/social/webhooks/threads/deauthorize` |
| Data Deletion Requests URL | `https://www.clipwaltz.com/api/social/webhooks/threads/delete` |

3. Click **Save**.

## 4. Add yourself as a Threads Tester
1. Open **App roles** → **Roles** → **Add People** → **Threads Tester**, then enter your Threads username.
2. In Threads, accept the invite at https://www.threads.com/settings/account → **Website permissions** → **Invites**.

Until the app passes App Review (step 7), only people with a role on the app can connect Threads.

## 5. App details (App settings → Basic)
| Field | Value |
|---|---|
| App icon (512–1024 px, under 5 MB) | Download https://www.clipwaltz.com/icons/icon-512.png and upload it |
| Privacy Policy URL | `https://www.clipwaltz.com/privacy` |
| Terms of Service URL | `https://www.clipwaltz.com/terms` |
| User data deletion | Data deletion callback URL: `https://www.clipwaltz.com/api/social/webhooks/threads/delete` |
| Category | Your choice |

## 6. Send me the keys
Put the **Threads app ID** and **Threads app secret** in `G:\VisualStudioCode\_keys\clipwaltz.txt` as
`THREADS_CLIENT_ID=` and `THREADS_CLIENT_SECRET=`. Don't paste them into the chat. Then tell me they're there.

I put them in ClipWaltz's production settings and restart the app. Today ClipWaltz is still using the Threads
keys copied from publish.phoenixtekk.com's old app.

Then connect: ClipWaltz → **Publish → Networks → Threads → Connect**.

## 7. Opening Threads to all ClipWaltz users (later)
Your own customers can only connect after these steps:
- each permission above passes **App Review**;
- the app is **published** (**Publish** in the left menu);
- business verification is done, if Meta asks for it.

Meta's docs also say that a grant from a user with a public profile lasts 90 days, and that each token refresh extends it.
ClipWaltz refreshes tokens automatically.
