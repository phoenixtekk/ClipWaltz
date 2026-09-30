// BullMQ job queue for AI video generation (ADR-0002). Redis lives on linuxg1
// (127.0.0.1:6379, localhost-only). Connections are created lazily so `next build`
// and the assembler code paths never open a Redis socket unless generation is used.
import { Queue, type JobsOptions } from "bullmq";
import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

/** Queue name shared by the app (producer) and the generation worker (consumer). */
// Overridable for local dev (e.g. GENERATION_QUEUE=clipwaltz-generation-dev) so dev jobs never land on prod's queues.
export const GENERATION_QUEUE = process.env.GENERATION_QUEUE || "clipwaltz-generation";
/** Export queue: transcode a chosen generation version to a final deliverable. */
export const EXPORT_QUEUE = process.env.EXPORT_QUEUE || "clipwaltz-export";
/** Enhance queue: ffmpeg post-process (interpolate/upscale) a version → a new enhanced version. */
export const ENHANCE_QUEUE = process.env.ENHANCE_QUEUE || "clipwaltz-enhance";

/** The payload we enqueue: just the DB job id. The worker loads the row for details. */
export type GenerationJobData = { generationJobId: string };
export type ExportJobData = { exportJobId: string };

let _connection: IORedis | null = null;
/** Shared ioredis connection (lazy). `maxRetriesPerRequest: null` is required by BullMQ. */
export function redis(): IORedis {
  if (!_connection) {
    _connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  }
  return _connection;
}

let _genQueue: Queue<GenerationJobData> | null = null;
/** The generation queue (lazy). */
export function generationQueue(): Queue<GenerationJobData> {
  if (!_genQueue) {
    _genQueue = new Queue<GenerationJobData>(GENERATION_QUEUE, { connection: redis() });
  }
  return _genQueue;
}

/** Enqueue a generation job. `jobId` doubles as the BullMQ job id for idempotency. */
export async function enqueueGeneration(
  generationJobId: string,
  opts: JobsOptions = {},
): Promise<void> {
  await generationQueue().add(
    "generate",
    { generationJobId },
    {
      jobId: generationJobId, // idempotent: re-enqueuing the same id is a no-op
      attempts: 2,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
      ...opts,
    },
  );
}

let _exportQueue: Queue<ExportJobData> | null = null;
export function exportQueue(): Queue<ExportJobData> {
  if (!_exportQueue) {
    _exportQueue = new Queue<ExportJobData>(EXPORT_QUEUE, { connection: redis() });
  }
  return _exportQueue;
}

/** Enqueue an export (transcode) job. */
export async function enqueueExport(exportJobId: string, opts: JobsOptions = {}): Promise<void> {
  await exportQueue().add(
    "export",
    { exportJobId },
    {
      jobId: exportJobId,
      attempts: 2,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
      ...opts,
    },
  );
}

let _enhanceQueue: Queue<GenerationJobData> | null = null;
export function enhanceQueue(): Queue<GenerationJobData> {
  if (!_enhanceQueue) {
    _enhanceQueue = new Queue<GenerationJobData>(ENHANCE_QUEUE, { connection: redis() });
  }
  return _enhanceQueue;
}

/** Enqueue an enhancement job (an `enhancement`-type generation_job that yields a new version). */
export async function enqueueEnhance(generationJobId: string, opts: JobsOptions = {}): Promise<void> {
  await enhanceQueue().add(
    "enhance",
    { generationJobId },
    {
      jobId: generationJobId,
      attempts: 2,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
      ...opts,
    },
  );
}

/** WaltzDeck queue: media descriptions, storyboard planning, scene rewrites, imports (worker/deck/jobs.mjs). */
// Override for local dev (its own queue + dev worker, worker/deck/dev-worker.mjs) — never share prod's.
export const DECK_QUEUE = process.env.DECK_QUEUE || "clipwaltz-deck";
export type DeckJob =
  | { name: "describe"; data: { assetId: string } }
  | { name: "plan"; data: { projectId: string } }
  | { name: "scene"; data: { sceneId: string; instruction: string } }
  | { name: "campaign_hooks"; data: { campaignId: string } }
  | { name: "brand_from_site"; data: { projectId: string; url: string } }
  | { name: "translate"; data: { projectId: string } }
  | { name: "campaign_render"; data: { campaignId: string } }
  | { name: "import"; data: { projectId: string; source: "pptx" | "pdf" | "url"; key?: string; url?: string; name: string; userId: string } };

let _deckQueue: Queue | null = null;
export function deckQueue(): Queue {
  if (!_deckQueue) _deckQueue = new Queue(DECK_QUEUE, { connection: redis() });
  return _deckQueue;
}

/** Enqueue a WaltzDeck job. `jobId` de-duplicates (e.g. one pending plan per project). */
export async function enqueueDeck(job: DeckJob, jobId?: string): Promise<void> {
  await deckQueue().add(job.name, job.data, {
    ...(jobId ? { jobId } : {}),
    attempts: 1,
    removeOnComplete: 500,
    removeOnFail: 1000,
  });
}
