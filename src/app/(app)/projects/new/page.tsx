import { NewProjectWizard } from "@/components/new-project-wizard";
import { listAiTemplates } from "@/lib/template-actions";
import { ProductPack } from "@/components/product-pack";

export const metadata = { title: "New project" };

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ ws?: string }> }) {
  const { ws } = await searchParams;
  const aiTemplates = await listAiTemplates();
  return (
    <>
      {/* G3: product page → image ads + a WaltzDeck brief, in the active workspace. */}
      {ws ? null : <ProductPack />}
      <NewProjectWizard workspaceId={ws || undefined} aiTemplates={aiTemplates} />
    </>
  );
}
