import "server-only";

// Waltz Avatar — users' AI presenters must be fictional. A description that names or points to a real, identifiable
// person (a celebrity, politician, influencer, or a named private individual) is refused before any face is generated.
// The local LLM on the AI Box (OLLAMA_URL) classifies it; if it can't be reached the request is refused (fail closed) —
// a deepfake of a real person is the harm this guards against.

const OLLAMA_URL = (process.env.OLLAMA_URL ?? "").replace(/\/$/, "");
const MODEL = process.env.PERSONA_CHECK_MODEL ?? "qwen2.5:14b";

export class PersonaCheckUnavailable extends Error {}

/** True when the text names or unmistakably points to a real, identifiable person. */
export async function describesRealPerson(text: string): Promise<boolean> {
  if (!OLLAMA_URL) throw new PersonaCheckUnavailable("We couldn't check the description right now — try again in a minute");
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt:
          "You screen requests to generate a FICTIONAL person's face for an AI video presenter. Decide whether the request " +
          "names, or unmistakably points to, a specific real person: a celebrity, actor, musician, athlete, politician, " +
          "influencer, business leader, historical figure, or any named private individual (e.g. 'my boss John Smith', " +
          "'looks exactly like Taylor Swift', 'the current US president'). A plain first name used as the presenter's " +
          "name (e.g. 'Name: Maya') does NOT count on its own. Generic looks (age, hair, clothes, ethnicity, style) do not count.\n" +
          'Respond ONLY as JSON: {"real_person": true|false}.\n\nRequest: ' + JSON.stringify(text.slice(0, 500)),
        stream: false,
        format: "json",
        options: { num_predict: 64, temperature: 0 },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`ollama ${res.status}`);
    const j = (await res.json()) as { response?: string };
    const v = (JSON.parse(j.response || "{}") as { real_person?: unknown }).real_person;
    if (typeof v !== "boolean") throw new Error("no verdict");
    return v;
  } catch (e) {
    console.error("[persona-check]", (e as Error).message);
    throw new PersonaCheckUnavailable("We couldn't check the description right now — try again in a minute");
  } finally {
    clearTimeout(to);
  }
}
