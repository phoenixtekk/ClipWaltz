// Types for worker/image/job.mjs (used by the verification script).
export function runImageJob(
  ctx: {
    sql: unknown;
    putBytes: (key: string, body: Buffer, type: string) => Promise<unknown>;
    setStatus: (id: string, fields: Record<string, unknown>) => Promise<void>;
    wasCancelled: (id: string) => Promise<boolean>;
  },
  job: Record<string, unknown>,
): Promise<{ key: string; png: Buffer; seed: number } | null>;
export function afterImageJobFailure(sql: unknown, id: string): Promise<void>;
