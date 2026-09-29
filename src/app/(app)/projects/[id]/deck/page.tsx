import { notFound, redirect } from "next/navigation";
import { getProject } from "@/lib/projects";
import { getDeck } from "@/lib/deck-actions";
import { getBrandKit } from "@/lib/brand-actions";
import { getLatestRender, listRenders } from "@/lib/render";
import { DeckEditor } from "@/components/deck/deck-editor";
import { RenderPanel } from "@/components/render-panel";
import { RenderHistory } from "@/components/render-history";

export const metadata = { title: "WaltzDeck" };

export default async function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();
  if (project.kind !== "deck") redirect(`/projects/${id}/edit`);
  const [data, latestRender, renders, brand] = await Promise.all([getDeck(id), getLatestRender(id), listRenders(id), getBrandKit(id)]);
  const canEdit = project.role !== "viewer";
  return (
    <DeckEditor
      initial={data}
      initialBrand={brand}
      canEdit={canEdit}
      renderSlot={
        <div className="space-y-4">
          <RenderPanel projectId={id} initial={latestRender} canRender={canEdit && data.scenes.length > 0} title={project.title} />
          {renders.length ? <RenderHistory renders={renders} /> : null}
        </div>
      }
    />
  );
}
