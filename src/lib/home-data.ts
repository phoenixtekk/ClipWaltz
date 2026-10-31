import { inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { getPublicFeed, type FeedItem } from "./feed";
import { getActiveContest } from "./contest";
import { VIDEO_PROVIDERS, VIDEO_SETTINGS_KEY } from "../../worker/video/catalog.mjs";

export type HomeData = {
  feed: FeedItem[];
  contest: { theme: string; description: string | null } | null;
  /** Outside writing models the admin has switched on (labels), e.g. ["Claude", "Gemini"]. */
  writers: string[];
  /** Cloud video model vendors the admin has switched on (labels), e.g. ["Kling"]. */
  videoVendors: string[];
  /** The ClipWaltz Connector (your own computer) is switched on for at least one plan. */
  connector: boolean;
};

// Mirrors LLM_PROVIDERS / LLM_SETTINGS_KEY / CONNECTOR_ID in worker/deck/llm.mjs — not imported, because that module
// pulls in the Anthropic and OpenAI SDKs, which the public home page has no use for.
const LLM_SETTINGS_KEY = "llm_providers";
const CONNECTOR_ID = "connector";
const LLM_LABELS: Record<string, string> = { anthropic: "Claude", openai: "ChatGPT", deepseek: "DeepSeek", gemini: "Gemini" };

type Switch = { enabled?: boolean; plans?: string[] };
const on = (s: Switch | undefined) => !!s?.enabled && (s.plans ?? []).length > 0;

/**
 * Everything the public home page shows that comes from live data: the latest public renders, the running challenge,
 * and which AI models are actually offered — so the page never names a model the admin has switched off.
 * Each part fails soft (an empty list / null) so a database hiccup can't take the home page down.
 */
export async function getHomeData(): Promise<HomeData> {
  const [feed, contest, settings] = await Promise.all([
    getPublicFeed(12).catch(() => []),
    getActiveContest().catch(() => null),
    db
      .select({ key: schema.appSettings.key, value: schema.appSettings.value })
      .from(schema.appSettings)
      .where(inArray(schema.appSettings.key, [LLM_SETTINGS_KEY, VIDEO_SETTINGS_KEY]))
      .catch(() => []),
  ]);
  const llm = (settings.find((r) => r.key === LLM_SETTINGS_KEY)?.value ?? {}) as Record<string, Switch>;
  const video = (settings.find((r) => r.key === VIDEO_SETTINGS_KEY)?.value ?? {}) as Record<string, Switch>;
  const videoLabels = VIDEO_PROVIDERS as Record<string, { label: string }>;
  return {
    feed,
    contest: contest ? { theme: contest.theme, description: contest.description ?? null } : null,
    writers: Object.keys(LLM_LABELS).filter((id) => on(llm[id])).map((id) => LLM_LABELS[id]),
    videoVendors: Object.keys(videoLabels).filter((id) => on(video[id])).map((id) => videoLabels[id].label),
    connector: on(llm[CONNECTOR_ID]),
  };
}
