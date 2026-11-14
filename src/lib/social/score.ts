import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { scoreChecks, spearman } from "@/lib/social/score-checks";
import { getSetting, setSetting } from "@/lib/social/settings";

// G8 pre-publish engagement score (plan §6 G8). An EXPLAINABLE checklist turned into a 0–100 estimate, plus an optional
// AI critique. It is guidance, labelled as an estimate everywhere it is shown. ClipWaltz has no category benchmark data,
// so nothing here claims one.
//
// The number is only shown for a workspace whose OWN history backs it: `calibrate` scores every past published post
// (with the timing check left out — the timing slots are learnt from the same posts) and measures the Spearman rank
// correlation with what those posts actually got (engagement ÷ that network's average). With fewer than
// CALIBRATION_MIN posts, or a correlation ≤ 0, the badge is hidden and only the checklist is shown (plan: "do not ship
// the badge if it is ≤ 0"). The weights are fixed, not fitted, so every post in the calibration set is held out.

export const CALIBRATION_MIN = 20;
export { scoreChecks, spearman };

export interface Calibration {
  posts: number;
  rho: number;
  at: string;
  /** Show the 0–100 badge? Only with enough posts and a positive correlation. */
  showScore: boolean;
}

/** Score every past published post (without timing) against what it actually got. */
export async function calibrate(workspaceId: string): Promise<Calibration> {
  const rows = await db
    .select({
      postId: schema.socialPosts.id,
      text: schema.socialPosts.text,
      link: schema.socialPosts.link,
      provider: schema.socialPostTargets.provider,
      metrics: schema.socialPostTargets.metrics,
    })
    .from(schema.socialPostTargets)
    .innerJoin(schema.socialPosts, eq(schema.socialPostTargets.postId, schema.socialPosts.id))
    .where(
      and(
        eq(schema.socialPosts.workspaceId, workspaceId),
        eq(schema.socialPostTargets.status, "published"),
        isNotNull(schema.socialPostTargets.metrics),
      ),
    )
    .orderBy(desc(schema.socialPosts.publishedAt))
    .limit(3000);
  const eng = (m: (typeof rows)[number]["metrics"]) => {
    if (!m) return null;
    const parts = [m.likes, m.comments, m.shares].filter((x): x is number => typeof x === "number");
    return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
  };
  // Per-network averages, so every network is judged on its own scale.
  const byProvider = new Map<string, number[]>();
  for (const r of rows) {
    const e = eng(r.metrics);
    if (e !== null) byProvider.set(r.provider, [...(byProvider.get(r.provider) ?? []), e]);
  }
  const mean = new Map([...byProvider].map(([p, v]) => [p, v.reduce((a, b) => a + b, 0) / v.length]));
  const perPost = new Map<string, { text: string; link: string | null; providers: string[]; rel: number[] }>();
  for (const r of rows) {
    const e = eng(r.metrics);
    const m = mean.get(r.provider);
    if (e === null || !m) continue;
    const p = perPost.get(r.postId) ?? { text: r.text, link: r.link, providers: [], rel: [] };
    p.providers.push(r.provider);
    p.rel.push(e / m);
    perPost.set(r.postId, p);
  }
  const ids = [...perPost.keys()];
  const media = ids.length
    ? await db
        .select({ postId: schema.socialMedia.postId, kind: schema.socialMedia.kind })
        .from(schema.socialMedia)
        .where(inArray(schema.socialMedia.postId, ids))
    : [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [id, p] of perPost) {
    const kinds = media.filter((m) => m.postId === id).map((m) => m.kind);
    const s = scoreChecks({ text: p.text, link: p.link, hasImage: kinds.includes("image"), hasVideo: kinds.includes("video"), providers: p.providers });
    const timing = s.reasons.find((r) => r.label === "Posting time")?.points ?? 0;
    xs.push(s.total - timing); // timing left out (see header)
    ys.push(p.rel.reduce((a, b) => a + b, 0) / p.rel.length);
  }
  const rho = Math.round(spearman(xs, ys) * 1000) / 1000;
  const out: Calibration = { posts: xs.length, rho, at: new Date().toISOString(), showScore: xs.length >= CALIBRATION_MIN && rho > 0 };
  await setSetting(`score-calibration:${workspaceId}`, JSON.stringify(out));
  return out;
}

/** The stored calibration (recomputed when older than a day). */
export async function getCalibration(workspaceId: string): Promise<Calibration> {
  const raw = await getSetting(`score-calibration:${workspaceId}`);
  if (raw) {
    try {
      const c = JSON.parse(raw) as Calibration;
      if (Date.now() - new Date(c.at).getTime() < 86_400_000) return c;
    } catch {
      /* recompute */
    }
  }
  return calibrate(workspaceId);
}

/** AI critique (AI Box, 0 credits): two or three concrete suggestions. An opinion, shown as one. */
export async function aiCritique(text: string, providers: string[]): Promise<string> {
  const base = (process.env.OLLAMA_URL || "http://192.168.166.182:11434").replace(/\/$/, "");
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.SOCIAL_AI_MODEL || "qwen3.8:27b",
      stream: false,
      think: false,
      options: { num_predict: 2000, num_ctx: 8192, temperature: 0.4 },
      messages: [
        {
          role: "system",
          content:
            "You review social media posts before they are published. Give two or three short, concrete suggestions that would make this post more engaging for the named networks (the hook, clarity, the call to action, hashtags, length). One line each, starting with •. Do not rewrite the whole post. Do not invent statistics or predict numbers. Plain text, no Markdown.",
        },
        { role: "user", content: `Networks: ${providers.join(", ") || "not chosen yet"}\n\nPost:\n${text.slice(0, 6000)}` },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`AI box returned HTTP ${res.status}`);
  const d = (await res.json()) as { message?: { content?: string } };
  const out = (d.message?.content ?? "").trim();
  if (!out) throw new Error("The AI critique came back empty.");
  return out.replace(/\*\*/g, "");
}
