# Social Publishing → ClipWaltz: OAuth redirect URIs (owner action)

Add each **new** URI to the network's developer app **alongside** the old SP one. Do not remove the old
URI until cut-over (plan §5) is finished. Mastodon needs nothing (apps are registered per instance automatically).

| Network | Where (developer console) | Add this redirect URI | Old SP URI (keep for now) |
|---|---|---|---|
| Facebook + Instagram | Meta for Developers → app → Facebook Login → Settings → Valid OAuth Redirect URIs | `https://www.clipwaltz.com/api/social/oauth/facebook/callback` | `https://publish.phoenixtekk.com/api/facebook/oauth/callback` |
| Threads | Meta for Developers → Threads app → Use cases → Threads API → Settings → Redirect Callback URLs | `https://www.clipwaltz.com/api/social/oauth/threads/callback` | `https://publish.phoenixtekk.com/api/threads/callback` |
| Threads (uninstall) | same page → Uninstall Callback URL | `https://www.clipwaltz.com/api/social/webhooks/threads/deauthorize` | `https://publish.phoenixtekk.com/api/threads/deauthorize` |
| Threads (delete) | same page → Delete Callback URL | `https://www.clipwaltz.com/api/social/webhooks/threads/delete` | `https://publish.phoenixtekk.com/api/threads/delete` |
| LinkedIn | LinkedIn Developers → app → Auth → Authorized redirect URLs | `https://www.clipwaltz.com/api/social/oauth/linkedin/callback` | `https://publish.phoenixtekk.com/api/linkedin/callback` |
| Pinterest | Pinterest Developers → app → Redirect URIs | `https://www.clipwaltz.com/api/social/oauth/pinterest/callback` | `https://publish.phoenixtekk.com/api/pinterest/oauth/callback` |
| TikTok | TikTok for Developers → app → Login Kit → Redirect URI | `https://www.clipwaltz.com/api/social/oauth/tiktok/callback` | `https://publish.phoenixtekk.com/api/tiktok/oauth/callback` |
| Tumblr | tumblr.com/oauth/apps → app → Default callback URL / OAuth2 redirect URLs | `https://www.clipwaltz.com/api/social/oauth/tumblr/callback` | `https://publish.phoenixtekk.com/api/tumblr/oauth/callback` |
| X | developer.x.com → project → app → User authentication settings → Callback URI | `https://www.clipwaltz.com/api/social/oauth/x/callback` | `https://publish.phoenixtekk.com/api/x/oauth/callback` |
| YouTube | Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client → Authorized redirect URIs | `https://www.clipwaltz.com/api/social/oauth/youtube/callback` | `https://publish.phoenixtekk.com/api/youtube/oauth/callback` |

Source of the old URIs: the callback routes under `G:\VisualStudioCode\SocialPublishing\src\app\api\*\**\callback` (verified 2026-11-14).
