import { KitCreator } from "@/components/kits/kit-creator";
import { RoleRequired } from "@/components/publish/role-required";
import { publishPage } from "@/lib/social/page-context";
import { kitStart } from "@/lib/kits/kits";
import { roleAtLeast } from "@/lib/workspace";

export const metadata = { title: "New post kit · Publish" };

// /publish/kits/new                 from an idea, or images / a video uploaded here
// /publish/kits/new?render=<id>     from a finished render (Post kit button on renders and campaign variants)
// /publish/kits/new?export=<id>     from a finished export
// /publish/kits/new?design=<id>     from a Waltz Image design (redrawn at each network's size)
export default async function NewKitPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sc = await publishPage();
  if (!sc) return null;
  if (!roleAtLeast(sc.role, "editor")) return <RoleRequired role={sc.role} need="editor" />;
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const q = { render: one("render"), export: one("export"), design: one("design") };
  const initial = await kitStart(sc.userId, sc.workspaceId, q);
  return <KitCreator initial={initial} query={q} />;
}
