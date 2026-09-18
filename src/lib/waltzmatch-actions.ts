"use server";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { getObjectBytes } from "./storage";
import { getMusicTracks } from "./music";
import {
  heuristicProfile,
  recommend,
  visionLabel,
  type MediaProfile,
  type Recommendation,
} from "./waltzmatch";

const OLLAMA_URL = (process.env.OLLAMA_URL ?? "").replace(/\/$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5vl:7b";
const MOODS = new Set(["happy", "warm", "energetic", "calm", "epic"]);

async function analyzePhoto(bytes: Uint8Array): Promise<{ occasion: string | null; mood: string; energy: number } | null> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 20000);
  try {
    const b64 = Buffer.from(bytes).toString("base64");
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt:
          "Analyze this photo to pick a music-video soundtrack. Respond ONLY as JSON: " +
          '{"occasion": one of "vacation"|"party"|"wedding"|"birthday"|"everyday"|"nature"|"sports"|"other", ' +
          '"mood": one of "happy"|"warm"|"energetic"|"calm"|"epic", "energy": number 0..1}.',
        images: [b64],
        stream: false,
        format: "json",
        options: { num_predict: 256, temperature: 0 },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { response?: string };
    const p = JSON.parse(j.response || "{}") as { occasion?: string; mood?: string; energy?: number };
    const mood = MOODS.has(String(p.mood)) ? String(p.mood) : "happy";
    const energy = Number.isFinite(p.energy) ? Math.max(0, Math.min(1, Number(p.energy))) : 0.5;
    const occasion = p.occasion && p.occasion !== "other" ? String(p.occasion) : null;
    return { occasion, mood, energy };
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

function mode<T>(xs: T[]): T | null {
  const counts = new Map<T, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best: T | null = null;
  let n = -1;
  for (const [k, c] of counts) if (c > n) [best, n] = [k, c];
  return best;
}

/**
 * WaltzMatch: analyze the project's media (best-effort vision on photos, media-mix fallback)
 * and return ranked soundtrack recommendations. Owner-checked.
 */
export async function getWaltzRecommendations(
  projectId: string,
): Promise<{ label: string; source: MediaProfile["source"]; recs: Recommendation[] }> {
  const userId = await requireUserId();
  const rows = await db
    .select({ kind: schema.assets.kind, storageKey: schema.assets.storageKey })
    .from(schema.assets)
    .innerJoin(schema.projects, eq(schema.assets.projectId, schema.projects.id))
    .where(
      and(
        eq(schema.assets.projectId, projectId),
        eq(schema.projects.ownerId, userId),
        eq(schema.assets.uploadState, "uploaded"),
      ),
    )
    .orderBy(asc(schema.assets.orderIndex));

  const photos = rows.filter((r) => r.kind === "photo");
  const videos = rows.filter((r) => r.kind === "video");
  const tracks = await getMusicTracks();

  let profile: MediaProfile = heuristicProfile(photos.length, videos.length);

  // Best-effort vision analysis of up to 3 evenly-spread photos.
  if (OLLAMA_URL && photos.length > 0) {
    const pick = [photos[0], photos[Math.floor(photos.length / 2)], photos[photos.length - 1]]
      .filter((p, i, a) => a.indexOf(p) === i)
      .slice(0, 3);
    const results = [];
    for (const p of pick) {
      try {
        const bytes = await getObjectBytes(p.storageKey);
        const r = await analyzePhoto(bytes);
        if (r) results.push(r);
      } catch {
        /* skip this photo */
      }
    }
    if (results.length > 0) {
      const mood = mode(results.map((r) => r.mood)) ?? "happy";
      const occasion = mode(results.map((r) => r.occasion).filter(Boolean) as string[]);
      let energy = results.reduce((s, r) => s + r.energy, 0) / results.length;
      if (videos.length > photos.length) energy = Math.min(1, energy + 0.1); // lots of video → livelier
      profile = { mood, energy, occasion, label: visionLabel(occasion, mood, energy), source: "vision" };
    }
  }

  return { label: profile.label, source: profile.source, recs: recommend(profile, tracks) };
}
