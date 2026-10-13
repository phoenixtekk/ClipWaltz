import { redirect } from "next/navigation";
import { getAuthUserId } from "@/lib/auth";
import { getMyAiModels } from "@/lib/llm-actions";
import { AiModelSettings } from "@/components/ai-model-settings";

export const metadata = { title: "AI models" };

export default async function AiModelsPage() {
  const userId = await getAuthUserId();
  if (!userId) redirect("/sign-in?redirect=%2Faccount%2Fai");
  const data = await getMyAiModels();
  if (!data.ok) throw new Error(data.error);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="cw-gradient-text text-2xl font-semibold tracking-tight">AI models</h1>
        <p className="text-sm text-muted-foreground">
          Choose which AI writes your scripts and plans — ClipWaltz&apos;s built-in model, or Claude, ChatGPT, DeepSeek or
          Gemini when they&apos;re offered on your plan.
        </p>
      </div>
      <AiModelSettings data={data.data} />
    </div>
  );
}
