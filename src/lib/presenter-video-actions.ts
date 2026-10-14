"use server";
import { randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { toResult, type ActionResult, unwrap } from "./action-result";
import { createProject } from "./project-actions";
import { estimateScriptSeconds } from "./talking-photo";
import { CLONE_PREFIX, PRESENTER_VIDEO_STYLES, type PresenterVideoStyle } from "./presenters";
import type { DeckBrief } from "./deck/types";

// Waltz Avatar Phase 2 — presenter video templates ("Make a video"): a script + a presenter → a ready WaltzDeck project
// (spec §2.2). The script is split into scenes of up to ~30 words; each scene is a presenter scene in the chosen style,
// with the deck's voiceover set to the presenter's own cloned voice (when ready) or its default voice.

const MAX_SCRIPT = 3000;
const MAX_SCENES = 14;
const SCENE_WORDS = 30;

/** Sentences grouped into scenes of at most SCENE_WORDS words (a long sentence is its own scene). */
function scenesOf(script: string): string[] {
  const sentences = script.replace(/\s+/g, " ").match(/[^.!?]+[.!?]*["')\]]*\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    const next = cur ? `${cur} ${s}` : s;
    if (cur && next.split(" ").length > SCENE_WORDS) {
      out.push(cur);
      cur = s;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out.slice(0, MAX_SCENES);
}

/** A short on-screen title for a scene's line: its first clause, at most 7 words. */
function titleOf(line: string): string {
  const clause = line.split(/[,;:.!?—–-]/)[0]?.trim() ?? line;
  const words = clause.split(" ");
  return words.slice(0, 7).join(" ") + (words.length > 7 ? "…" : "");
}

export async function createPresenterVideo(input: {
  presenterId: string; script: string; style: PresenterVideoStyle; aspect: "9:16" | "16:9" | "1:1"; title?: string;
}): Promise<ActionResult<string>> {
  return toResult(async () => {
    const userId = await requireUserId();
    const [p] = await db.select().from(schema.presenters).where(eq(schema.presenters.id, input.presenterId));
    if (!p || !((p.userId === userId && p.kind === "twin") || p.library)) throw new Error("Presenter not found");
    if (p.status !== "ready") throw new Error("That presenter isn't ready yet");
    const script = String(input.script ?? "").trim().slice(0, MAX_SCRIPT);
    const lines = scenesOf(script);
    if (!lines.length) throw new Error("Paste or write the script first");
    const style = PRESENTER_VIDEO_STYLES.find((s) => s.key === input.style) ?? PRESENTER_VIDEO_STYLES[0];
    const aspect = ["9:16", "16:9", "1:1"].includes(input.aspect) ? input.aspect : "9:16";
    const title = (input.title?.trim() || `${p.name} — ${titleOf(lines[0])}`).slice(0, 100);
    const projectId = unwrap(await createProject("surprise", aspect, undefined, { title, deckMode: aspect === "16:9" ? "presentation" : "ad" }));

    const ownVoice = p.userId === userId && p.kind === "twin" && p.voiceStatus === "ready";
    const sceneSec = (line: string) => Math.round(Math.max(2, estimateScriptSeconds(line, 1) + 0.4) * 10) / 10;
    // The brief's target length = the script's length (else it keeps the mode default, e.g. 90 s for a 15 s script),
    // within the editor slider's range.
    const total = lines.reduce((n, l) => n + sceneSec(l), 0);
    const lengthSec = Math.min(aspect === "16:9" ? 180 : 60, Math.max(6, Math.ceil(total)));
    const patch: Partial<DeckBrief> = {
      lengthSec,
      prompt: script.slice(0, 2000),
      voice: { mode: "manual", voiceId: ownVoice ? `${CLONE_PREFIX}${p.id}` : p.voice, speed: 1 },
      captions: { enabled: true },
      presenter: { id: p.id, name: p.name },
      textMode: style.text ? "manual" : "off",
    };
    await db.update(schema.projects).set({
      deck: sql`jsonb_set(coalesce(${schema.projects.deck}, '{}'::jsonb), '{brief}', coalesce(${schema.projects.deck}->'brief', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)`,
      updatedAt: new Date(),
    }).where(and(eq(schema.projects.id, projectId), eq(schema.projects.ownerId, userId)));

    const rows = lines.map((line, i) => ({
      id: randomUUID(), projectId, orderIndex: i,
      role: i === 0 ? "hook" : i === lines.length - 1 ? "cta" : "content",
      layout: style.layout,
      durationSec: sceneSec(line),
      textMode: style.text ? "manual" : "none",
      text: style.text ? { headline: titleOf(line) } : null,
      voice: line.slice(0, 400),
      locked: true,
    }));
    await db.insert(schema.deckScenes).values(rows);
    return projectId;
  });
}
