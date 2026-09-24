import { NewProjectWizard } from "@/components/new-project-wizard";

export const metadata = { title: "New project" };

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ ws?: string }> }) {
  const { ws } = await searchParams;
  return <NewProjectWizard workspaceId={ws || undefined} />;
}
