// BullMQ job queue for AI video generation (ADR-0002). Redis lives on linuxg1
// (127.0.0.1:6379, localhost-only). Connections are created lazily so `next build`
// and the assembler code paths never open a Redis socket unless generation is used.
import { Queue, type JobsOptions } from "bullmq";
import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

/** Queue name shared by the app (producer) and the generation worker (consumer). */
export const GENERATION_QUEUE = "clipwaltz-generation";

/** The payload we enqueue: just the DB job id. The worker loads the row for details. */
export type GenerationJobData = { generationJobId: string };

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
