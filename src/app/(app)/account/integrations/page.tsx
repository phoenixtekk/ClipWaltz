import { redirect } from "next/navigation";
import { getAuthUserId } from "@/lib/auth";
import { activeWorkspaceId } from "@/lib/active-workspace";
import { listCatalogProducts, listStores } from "@/lib/commerce/sync";
import { getWorkspaceRole, roleAtLeast } from "@/lib/workspace";
import { StoreCatalogs } from "@/components/store-catalogs";

export const metadata = { title: "Store catalogs" };
export const dynamic = "force-dynamic";

// G10: connect Shopify / WooCommerce / Wix, sync the catalog, make an ad / video pack from any product (G3).
export default async function IntegrationsPage() {
  const userId = await getAuthUserId();
  if (!userId) redirect("/sign-in?redirect=/account/integrations");
  const workspaceId = await activeWorkspaceId(userId);
  const role = await getWorkspaceRole(userId, workspaceId);
  const stores = await listStores(workspaceId);
  const products = await listCatalogProducts(workspaceId, stores.map((s) => s.id));
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Store catalogs</h1>
        <p className="text-sm text-muted-foreground">
          Connect your shop, bring in its products, and make image ads and a video ad from any product in one click.
        </p>
      </div>
      <StoreCatalogs
        canManage={roleAtLeast(role, "admin")}
        canEdit={roleAtLeast(role, "editor")}
        stores={stores.map((s) => ({ ...s, lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null }))}
        products={products}
      />
    </div>
  );
}
