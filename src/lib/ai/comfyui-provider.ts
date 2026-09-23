// ComfyUIAIServerProvider — the AISERVER-backed implementation of AIVideoProvider (doc 04 §20).
// It calls the authenticated FastAPI wrapper on AISERVER (never ComfyUI directly, never from the
// browser). The wrapper translates logical jobs into ComfyUI graphs; ComfyUI stays localhost-only.
//
// Env (server-only — never NEXT_PUBLIC):
//   AISERVER_API_URL    e.g. http://192.168.166.158:8189   (the wrapper, LAN-reachable from linuxg1)
//   AISERVER_API_TOKEN  shared-secret bearer token (matches /opt/clipwaltz-ai/config/wrapper.env)
import type {
  AIVideoProvider,
  GenerationInputs,
  ProviderHealth,
  ProviderJob,
  ProviderSubmitResult,
} from "./provider";

const BASE = (process.env.AISERVER_API_URL ?? "http://192.168.166.158:8189").replace(/\/$/, "");
const TOKEN = process.env.AISERVER_API_TOKEN ?? "";

function authHeaders(): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (!TOKEN) throw new Error("AISERVER_API_TOKEN is not configured");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
    // The wrapper is on the LAN; keep a bounded timeout so a hung node doesn't wedge a request.
    signal: init?.signal ?? AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AISERVER ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export class ComfyUIAIServerProvider implements AIVideoProvider {
  async submitJob(workflow: string, inputs: GenerationInputs): Promise<ProviderSubmitResult> {
    // Map camelCase logical fields → the wrapper's JobInputs shape (doc 04 §15).
    const body = {
      workflow,
      inputs: {
        prompt: inputs.prompt ?? "",
        source_image: inputs.sourceImage ?? null,
        width: inputs.width ?? 768,
        height: inputs.height ?? 512,
        duration: inputs.duration ?? 5,
        motion: inputs.motion ?? "balanced",
        seed: inputs.seed ?? null,
      },
    };
    const out = await call<{ job_id: string; status: string }>("/jobs", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { jobId: out.job_id, status: out.status };
  }

  async getJob(jobId: string): Promise<ProviderJob> {
    const out = await call<{
      job_id: string;
      status: string;
      outputs?: Array<{ filename: string | null; subfolder?: string; path?: string | null; type?: string; format?: string }>;
      error?: string | null;
    }>(`/jobs/${encodeURIComponent(jobId)}`);
    return {
      jobId: out.job_id,
      status: out.status,
      outputs: out.outputs ?? [],
      error: out.error ?? null,
    };
  }

  async cancelJob(jobId: string): Promise<void> {
    await call(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
  }

  async getModels(): Promise<string[]> {
    const out = await call<{ workflows: string[] }>("/models");
    return out.workflows ?? [];
  }

  async healthCheck(): Promise<ProviderHealth> {
    const out = await call<{
      status: string;
      comfyui: string;
      gpu_count: number;
      active_jobs: number;
      disk_free_gb: number;
    }>("/health");
    return {
      status: out.status,
      comfyui: out.comfyui,
      gpuCount: out.gpu_count,
      activeJobs: out.active_jobs,
      diskFreeGb: out.disk_free_gb,
    };
  }
}

/** Default provider instance (AISERVER/ComfyUI). Swap here when more providers land. */
export const aiProvider: AIVideoProvider = new ComfyUIAIServerProvider();
