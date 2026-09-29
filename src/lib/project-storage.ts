import "server-only";
import { eq, inArray, like, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { deleteObject, listObjectKeys } from "./storage";

// Storage cleanup for a deleted project. Deleting the projects row cascades assets / renders /
// generation_versions / export_jobs in the DB, but their MinIO objects and the library `media` rows
// uploaded into the project are left behind. The plan is collected BEFORE the row is deleted; the
// objects are deleted AFTER, in the background, and only when no remaining row still points at them
// (the media library shares one object between projects — same rule as retention's objectsKeptShared).
// Anything this misses (a crash mid-purge, a worker writing into a just-deleted project) is found by
// scripts/storage-orphans.mjs.

/** The per-project prefixes every writer uses: uploads, renders, AI versions, exports. */
export function projectPrefixes(projectId: string): string[] {
  return ["projects", "renders", "generations", "exports"].map((p) => `${p}/${projectId}/`);
}

export type ProjectStoragePlan = { projectId: string; keys: string[]; mediaIds: string[] };

export type ProjectPurgeReport = {
  projectId: string;
  mediaDeleted: number;
  mediaKept: number;
  objectsDeleted: number;
  objectsKeptShared: number;
  objectsFailed: number;
};

const nn = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x);

/** Collect every object key + library media row the project owns. Call before deleting the row. */
export async function collectProjectStorage(projectId: string): Promise<ProjectStoragePlan> {
  const [assets, renders, versions, exports, deckExports] = await Promise.all([
    db.select({ key: schema.assets.storageKey, convertedKey: schema.assets.convertedKey, mediaId: schema.assets.mediaId })
      .from(schema.assets).where(eq(schema.assets.projectId, projectId)),
    db.select({ key: schema.renders.outputKey }).from(schema.renders).where(eq(schema.renders.projectId, projectId)),
    db.select({ key: schema.generationVersions.outputKey, cleanKey: schema.generationVersions.cleanKey, thumb: schema.generationVersions.thumbnailKey })
      .from(schema.generationVersions).where(eq(schema.generationVersions.projectId, projectId)),
    db.select({ key: schema.exportJobs.outputKey }).from(schema.exportJobs).where(eq(schema.exportJobs.projectId, projectId)),
    db.select({ key: schema.deckExports.outputKey }).from(schema.deckExports).where(eq(schema.deckExports.projectId, projectId)),
  ]);
  // Library rows used by the project's clips, plus any uploaded into it that no clip points at any more.
  const mediaIds = new Set(nn(assets.map((a) => a.mediaId)));
  const uploaded = await db.select({ id: schema.media.id }).from(schema.media)
    .where(like(schema.media.storageKey, `projects/${projectId}/%`));
  for (const m of uploaded) mediaIds.add(m.id);

  const keys = new Set(nn([
    ...assets.flatMap((a) => [a.key, a.convertedKey]),
    ...renders.map((r) => r.key),
    ...versions.flatMap((v) => [v.key, v.cleanKey, v.thumb]),
    ...exports.map((e) => e.key),
    ...deckExports.map((e) => e.key),
  ]));
  return { projectId, keys: [...keys], mediaIds: [...mediaIds] };
}

/** The subset of `keys` some row in the DB still references (anywhere, in any project). */
export async function referencedKeys(keys: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < keys.length; i += 500) {
    const k = keys.slice(i, i + 500);
    const rows = await Promise.all([
      db.select({ a: schema.assets.storageKey, b: schema.assets.convertedKey }).from(schema.assets)
        .where(or(inArray(schema.assets.storageKey, k), inArray(schema.assets.convertedKey, k))),
      db.select({ a: schema.media.storageKey, b: schema.media.convertedKey }).from(schema.media)
        .where(or(inArray(schema.media.storageKey, k), inArray(schema.media.convertedKey, k))),
      db.select({ a: schema.renders.outputKey }).from(schema.renders).where(inArray(schema.renders.outputKey, k)),
      db.select({ a: schema.generationVersions.outputKey, b: schema.generationVersions.cleanKey, c: schema.generationVersions.thumbnailKey })
        .from(schema.generationVersions).where(or(
          inArray(schema.generationVersions.outputKey, k), inArray(schema.generationVersions.cleanKey, k),
          inArray(schema.generationVersions.thumbnailKey, k))),
      db.select({ a: schema.exportJobs.outputKey }).from(schema.exportJobs).where(inArray(schema.exportJobs.outputKey, k)),
      db.select({ a: schema.deckExports.outputKey }).from(schema.deckExports).where(inArray(schema.deckExports.outputKey, k)),
      db.select({ a: schema.musicTracks.storageKey }).from(schema.musicTracks).where(inArray(schema.musicTracks.storageKey, k)),
      db.select({ a: schema.templates.thumbnailKey }).from(schema.templates).where(inArray(schema.templates.thumbnailKey, k)),
    ]);
    const want = new Set(k);
    for (const r of rows.flat()) for (const v of Object.values(r)) if (typeof v === "string" && want.has(v)) out.add(v);
  }
  return out;
}

/**
 * Run after the project row is deleted. Drops library media rows no other project's clip uses, then
 * deletes every collected key and everything under the project's prefixes that nothing references.
 * Best-effort: failures are counted and logged, never thrown.
 */
export async function purgeProjectStorage(plan: ProjectStoragePlan): Promise<ProjectPurgeReport> {
  const r: ProjectPurgeReport = {
    projectId: plan.projectId, mediaDeleted: 0, mediaKept: 0, objectsDeleted: 0, objectsKeptShared: 0, objectsFailed: 0,
  };
  const keys = new Set(plan.keys);

  // 1) Library rows: keep one another project's clip still uses (the cascade already removed ours).
  if (plan.mediaIds.length) {
    const used = new Set((await db.select({ id: schema.assets.mediaId }).from(schema.assets)
      .where(inArray(schema.assets.mediaId, plan.mediaIds))).map((a) => a.id));
    const orphan = plan.mediaIds.filter((id) => !used.has(id));
    r.mediaKept = plan.mediaIds.length - orphan.length;
    if (orphan.length) {
      const gone = await db.delete(schema.media).where(inArray(schema.media.id, orphan))
        .returning({ key: schema.media.storageKey, convertedKey: schema.media.convertedKey });
      r.mediaDeleted = gone.length;
      for (const k of nn(gone.flatMap((m) => [m.key, m.convertedKey]))) keys.add(k);
    }
  }

  // 2) Also sweep the project's prefixes — catches objects no row ever recorded (failed jobs etc.).
  for (const prefix of projectPrefixes(plan.projectId)) {
    try {
      for (const k of await listObjectKeys(prefix)) keys.add(k);
    } catch (e) {
      console.error(`[project-purge] ${plan.projectId}: list ${prefix} failed:`, (e as Error).message);
    }
  }

  // 3) Delete what nothing references any more.
  const all = [...keys];
  const shared = await referencedKeys(all);
  r.objectsKeptShared = shared.size;
  const doomed = all.filter((k) => !shared.has(k));
  for (let i = 0; i < doomed.length; i += 8) {
    await Promise.all(doomed.slice(i, i + 8).map(async (k) => {
      try {
        await deleteObject(k);
        r.objectsDeleted++;
      } catch (e) {
        r.objectsFailed++;
        console.error(`[project-purge] ${plan.projectId}: delete ${k} failed:`, (e as Error).message);
      }
    }));
  }
  console.log(`[project-purge] ${JSON.stringify(r)}`);
  return r;
}
