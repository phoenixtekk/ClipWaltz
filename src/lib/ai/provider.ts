// AI video generation provider abstraction (doc 01 §11, doc 04 §20, Guide §11/§23).
// ClipWaltz talks to models through this interface, never to ComfyUI node graphs.
// The concrete AISERVER/ComfyUI implementation lives in ./comfyui-provider.ts.

/** Logical generation inputs — a small, controlled parameter set (doc 04 §15). */
export type GenerationInputs = {
  prompt?: string;
  /** Filename of a source image already staged in the AISERVER input dir (image-to-video). */
  sourceImage?: string | null;
  width?: number;
  height?: number;
  /** Seconds. */
  duration?: number;
  /** Frame count (Wan needs 4n+1); computed from duration by the caller if set. */
  length?: number;
  /** Logical motion level, e.g. "subtle" | "balanced" | "dynamic". */
  motion?: string;
  /** null → provider randomises; set → reproducible. */
  seed?: number | null;
};

export type ProviderSubmitResult = {
  /** The provider's own job id (AISERVER wrapper job id). */
  jobId: string;
  status: string;
};

export type ProviderOutput = {
  filename: string | null;
  subfolder?: string;
  path?: string | null;
  type?: string;
  format?: string;
};

export type ProviderJob = {
  jobId: string;
  status: string; // queued | running | completed | failed | cancelled (provider-side)
  outputs: ProviderOutput[];
  error?: string | null;
};

export type ProviderHealth = {
  status: string; // healthy | degraded
  comfyui: string; // online | offline
  gpuCount: number;
  activeJobs: number;
  diskFreeGb: number;
  /** One entry per ComfyUI instance / GPU (ADR-0008). */
  backends?: { url: string; online: boolean; activeJobs: number }[];
};

/** The stable contract every AI video provider implements. */
export interface AIVideoProvider {
  /** Submit a logical job for a named workflow; returns the provider job id. */
  submitJob(workflow: string, inputs: GenerationInputs): Promise<ProviderSubmitResult>;
  /** Poll a provider job's status + outputs. */
  getJob(jobId: string): Promise<ProviderJob>;
  /** Best-effort cancel. */
  cancelJob(jobId: string): Promise<void>;
  /** Available workflow ids the provider can run. */
  getModels(): Promise<string[]>;
  /** Liveness + capacity. */
  healthCheck(): Promise<ProviderHealth>;
}
