// Types for the parts of worker/deck/presenter.mjs the app uses (render pricing: which presenter lines are cached).
export type NarrationRequest = { text: string; voiceId: string | undefined; speed: number | undefined; pronunciations: unknown[] };
export function clipCacheBase(presenter: { id: string; user_id: string }, request: NarrationRequest): string;
export function narrationRequest(line: string | null | undefined, voice: { voiceId?: string; speed?: number } | null | undefined, pronunciations: unknown): NarrationRequest;
export const PRESENTER_SECONDS_PER_CREDIT: number;
export function presenterCredits(seconds: number): number;
export function isPresenterLayout(l: unknown): boolean;
