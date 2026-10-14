// Types for the parts of worker/deck/clone-voice.mjs the app uses (render pricing: which cloned-voice lines are cached).
export type VoiceLineRequest = { text: string; language: string; pronunciations: unknown[] };
export function voiceLineRequest(line: string | null | undefined, language: string | null | undefined, pronunciations: unknown): VoiceLineRequest;
export function voiceCacheBase(presenter: { id: string; user_id: string }, request: VoiceLineRequest): string;
