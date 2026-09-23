#!/usr/bin/env node
// One-time backfill for ADR-0004: give every existing user a personal workspace, then attach their
// projects and assets to it. Idempotent — safe to re-run. Run with the DB env loaded:
//   node --env-file=.env.local scripts/backfill-workspaces.mjs
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set (use: node --env-file=.env.local scripts/backfill-workspaces.mjs)");
  process.exit(1);
}
const sql = postgres(url, { prepare: false });

try {
  const users = await sql`select id from "user"`;
  let createdWs = 0;
  let linkedProjects = 0;

  for (const u of users) {
    // Get-or-create the user's personal workspace.
    let [ws] = await sql`
      select id from workspaces where owner_user_id = ${u.id} and is_personal = true limit 1`;
    if (!ws) {
      const wsId = randomUUID();
      await sql`
        insert into workspaces (id, name, owner_user_id, plan, is_personal)
        values (${wsId}, 'My Workspace', ${u.id}, 'free', true)`;
      await sql`
        insert into workspace_members (id, workspace_id, user_id, role)
        values (${randomUUID()}, ${wsId}, ${u.id}, 'owner')
        on conflict (workspace_id, user_id) do nothing`;
      ws = { id: wsId };
      createdWs++;
    }
    // Attach the user's not-yet-scoped projects to their personal workspace.
    const res = await sql`
      update projects set workspace_id = ${ws.id}
      where owner_id = ${u.id} and workspace_id is null`;
    linkedProjects += res.count;
  }

  // Attach assets to their parent project's workspace.
  const assetRes = await sql`
    update assets a set workspace_id = p.workspace_id
    from projects p
    where a.project_id = p.id and a.workspace_id is null and p.workspace_id is not null`;

  console.log(
    `backfill done: users=${users.length} workspaces_created=${createdWs} ` +
      `projects_linked=${linkedProjects} assets_linked=${assetRes.count}`,
  );
} catch (e) {
  console.error("backfill failed:", e.message);
  process.exit(1);
} finally {
  await sql.end();
}
