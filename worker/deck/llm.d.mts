// Types for worker/deck/llm.mjs (imported by the app for the AI models settings and their Test buttons).
export type LlmProviderId = "anthropic" | "openai" | "deepseek" | "gemini";
export const LLM_PROVIDERS: Record<LlmProviderId, { label: string; vendor: string; model: string; baseURL?: string; keyHint: string }>;
export const LLM_IDS: LlmProviderId[];
export const TIERS: ("free" | "plus" | "pro")[];
export const LLM_SETTINGS_KEY: string;
export type LlmTarget = { provider: LlmProviderId; apiKey: string; model?: string };
export function decryptSecret(stored: string | null | undefined): string | null;
export function llmText(
  target: LlmTarget,
  prompt: string,
  images?: string[],
  opts?: { maxTokens?: number; timeoutMs?: number; temperature?: number; numCtx?: number },
): Promise<string>;
export function testLlm(target: LlmTarget): Promise<number>;
export function llmErrorText(e: unknown, apiKey?: string): string;
export const DEFAULT_DAILY_LIMIT: number;
export const CONNECTOR_ID: "connector";
