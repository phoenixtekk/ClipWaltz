import Link from "next/link";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Connect a network — setup guide",
  description: "Step-by-step instructions for connecting each social network to ClipWaltz Publish.",
};

type Guide = { id: string; name: string; how: "One click" | "Paste details" | "Both"; need: string; steps: string[]; notes?: string[] };

// Public guide (plan §4.4). Adapted from Social Publishing's setup guide for ClipWaltz: every connection is made on
// Publish → Networks, by a workspace owner or admin, and counts toward the plan's channel limit (Plus 10 / Pro 25).
const GUIDES: Guide[] = [
  {
    id: "facebook", name: "Facebook Pages", how: "One click", need: "Admin access to the Page.",
    steps: ["Publish → Networks → Facebook → Connect.", "Log in to Facebook and approve every permission ClipWaltz asks for.", "Every Page you manage is added as its own channel. A Page's linked Instagram business account is added too."],
  },
  {
    id: "instagram", name: "Instagram", how: "Both", need: "A Business or Creator account linked to a Facebook Page.",
    steps: ["In Instagram, switch to a professional account (Settings → Account type and tools).", "Link the Instagram account to your Facebook Page in Meta's business settings.", "Connect Facebook (above): the linked Instagram account is added automatically.", "Or choose Paste credentials and enter the Instagram business account id and a token."],
    notes: ["Instagram has no publishing API for personal accounts.", "Every Instagram post needs an image or a video."],
  },
  {
    id: "threads", name: "Threads", how: "One click", need: "A Threads profile.",
    steps: ["Publish → Networks → Threads → Connect, then approve."],
  },
  {
    id: "linkedin", name: "LinkedIn Company Pages", how: "One click", need: "Admin of the Company Page.",
    steps: ["Publish → Networks → LinkedIn → Connect, then approve."],
    notes: ["Posting to Company Pages needs LinkedIn to approve ClipWaltz's app. Until then the Connect button may not be available."],
  },
  {
    id: "youtube", name: "YouTube", how: "Both", need: "A YouTube channel.",
    steps: ["Publish → Networks → YouTube → Connect, then choose the channel and approve.", "Each post needs one video. Short vertical videos can appear as Shorts."],
    notes: ["Until Google audits the app, uploads may be private. Check the video's visibility in YouTube Studio."],
  },
  {
    id: "tiktok", name: "TikTok", how: "Both", need: "A TikTok account.",
    steps: ["Publish → Networks → TikTok → Connect, then approve.", "Each post needs one video."],
    notes: ["Until TikTok audits the app, videos arrive as drafts or private posts. Finish them in the TikTok app."],
  },
  {
    id: "x", name: "X (Twitter)", how: "Both", need: "An X account.",
    steps: ["Publish → Networks → X → Connect, then authorise.", "Text is trimmed to fit X's limit; a link is always kept whole."],
  },
  {
    id: "pinterest", name: "Pinterest", how: "One click", need: "A Pinterest account with at least one board.",
    steps: ["Publish → Networks → Pinterest → Connect, then approve every permission.", "If you have more than one board, ClipWaltz asks which board your Pins go to. Change it any time with the Board button."],
    notes: ["Every Pin needs an image."],
  },
  { id: "tumblr", name: "Tumblr", how: "One click", need: "A Tumblr blog.", steps: ["Publish → Networks → Tumblr → Connect, then approve."] },
  {
    id: "mastodon", name: "Mastodon", how: "One click", need: "An account on any Mastodon server.",
    steps: ["Publish → Networks → Mastodon → Connect.", "Type your server's domain only (for example mastodon.social), then approve on your server. ClipWaltz registers its own app there."],
  },
  {
    id: "bluesky", name: "Bluesky", how: "Paste details", need: "Your handle and an app password.",
    steps: ["In Bluesky: Settings → Privacy and Security → App Passwords → add one and copy it (it is shown once).", "Publish → Networks → Bluesky → Connect, and paste your handle and the app password."],
    notes: ["Use the app password, never your login password. You can revoke it on its own any time."],
  },
  {
    id: "telegram", name: "Telegram", how: "Paste details", need: "A channel you own and a bot.",
    steps: ["In Telegram, message @BotFather, send /newbot and follow the two prompts. Copy the bot token.", "Open your channel → Manage → Administrators → Add Administrator → add your bot.", "Publish → Networks → Telegram → Connect. Paste the token and the channel's @username (or its -100… id for a private channel)."],
    notes: ["“Bot is not a member of the channel chat” means the id points at a different channel. Use the username from the channel's t.me link, not its display name."],
  },
  {
    id: "discord", name: "Discord", how: "Paste details", need: "Manage Webhooks permission on the server.",
    steps: ["Channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.", "Publish → Networks → Discord → Connect, and paste the URL."],
  },
  {
    id: "slack", name: "Slack", how: "Paste details", need: "Permission to install apps in the workspace.",
    steps: ["api.slack.com/apps → Create New App → From scratch. Add the chat:write bot scope and install it.", "Copy the Bot User OAuth Token (it starts with xoxb-).", "In the Slack channel, run /invite @YourAppName.", "Publish → Networks → Slack → Connect, and paste the token and channel."],
  },
  {
    id: "teams", name: "Microsoft Teams", how: "Paste details", need: "Permission to add workflows to the channel.",
    steps: ["In the channel: Workflows → “Post to a channel when a webhook request is received”. Finish it and copy the URL.", "Publish → Networks → Microsoft Teams → Connect, and paste the URL."],
    notes: ["Old Office 365 connectors were retired by Microsoft; use the Workflows template."],
  },
  {
    id: "reddit", name: "Reddit", how: "Paste details", need: "A Reddit account and a script app.",
    steps: ["reddit.com/prefs/apps → create a “script” app. Note its id and secret.", "Publish → Networks → Reddit → Connect with the id, secret, your username and password, and the subreddit."],
    notes: ["The post's first line becomes the title."],
  },
  {
    id: "medium", name: "Medium", how: "Paste details", need: "A Medium integration token.",
    steps: ["Medium: Settings → Security and apps → Integration tokens. Create one and copy it.", "Publish → Networks → Medium → Connect, and paste it."],
    notes: ["The first line becomes the article title."],
  },
  {
    id: "devto", name: "DEV (dev.to)", how: "Paste details", need: "A DEV API key.",
    steps: ["dev.to: Settings → Extensions → DEV Community API Keys. Generate one and copy it.", "Publish → Networks → DEV → Connect. Add tags if you like, and type draft to file posts as drafts."],
  },
  {
    id: "discourse", name: "Discourse forums", how: "Paste details", need: "Admin of the forum.",
    steps: ["Forum Admin → API → New API Key, scoped to one user (a bot account works well).", "Read the category's slug from its URL.", "Publish → Networks → Discourse → Connect with the forum address, key, username and category."],
    notes: ["The first line becomes the topic title and must be at least 15 characters."],
  },
  {
    id: "facebook_group", name: "Facebook Groups", how: "Paste details", need: "The group's address.",
    steps: ["Publish → Networks → Facebook Group → Connect, and paste the group's address.", "Posts aimed at the group wait under Publish → Post by hand. Copy the text, post it in the group, then mark it posted."],
    notes: ["Meta removed the Groups API in April 2026, so no app can post to a group for you."],
  },
  {
    id: "email", name: "Email", how: "Paste details", need: "A ClipWaltz administrator account.",
    steps: ["Publish → Networks → Email → Connect, and enter up to 25 recipient addresses."],
    notes: ["Email destinations send through ClipWaltz's own mail service, so only ClipWaltz administrators can add them."],
  },
];

export default function SetupGuidePage() {
  return (
    <div className="min-h-full bg-background">
      <header className="border-b border-border/60">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-6">
          <Link href="/" className="flex items-center gap-2" aria-label="ClipWaltz home">
            <Image src="/logo-2.png" alt="" width={273} height={263} className="size-7" />
            <span className="cw-gradient-text text-lg font-bold tracking-tight">ClipWaltz</span>
          </Link>
          <Link href="/publish/networks" className="ml-auto text-sm font-medium text-muted-foreground hover:text-foreground">Open Networks</Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <div className="space-y-2">
          <h1 className="cw-gradient-text text-3xl font-semibold tracking-tight">Connect a network</h1>
          <p className="text-muted-foreground">
            How to connect each social network to ClipWaltz Publish. Connections are made on <strong>Publish → Networks</strong> by a workspace
            owner or admin. Each one counts toward your plan&apos;s channels (Plus 10, Pro 25). Publishing costs no credits.
          </p>
          <nav aria-label="Networks" className="flex flex-wrap gap-1.5 pt-2">
            {GUIDES.map((g) => (
              <a key={g.id} href={`#${g.id}`} className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground">{g.name}</a>
            ))}
          </nav>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {GUIDES.map((g) => (
            <Card key={g.id} id={g.id} className="scroll-mt-6">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {g.name} <Badge variant="secondary">{g.how}</Badge>
                </CardTitle>
                <CardDescription>You need: {g.need}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <ol className="list-decimal space-y-1 pl-5">
                  {g.steps.map((s) => <li key={s}>{s}</li>)}
                </ol>
                {g.notes?.length ? (
                  <ul className="space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
                    {g.notes.map((n) => <li key={n}>{n}</li>)}
                  </ul>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          More help: the <Link href="/help" className="underline underline-offset-2">Help Center</Link> explains every Publish screen.
        </p>
      </main>
    </div>
  );
}
