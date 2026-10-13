// Types for worker/video/cloud.mjs (the app uses only the free key check and the error text helper).
export function testVideoKey(provider: "kling" | "runway" | "minimax", apiKey: string): Promise<true>;
export function videoErrorText(e: unknown, apiKey?: string): string;
