import { NewProjectWizard } from "@/components/new-project-wizard";
import { listAiTemplates } from "@/lib/template-actions";

export const metadata = { title: "New project" };

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ ws?: string }> }) {
  const { ws } = await searchParams;
  const aiTemplates = await listAiTemplates();
  return <NewProjectWizard workspaceId={ws || undefined} aiTemplates={aiTemplates} />;
}
