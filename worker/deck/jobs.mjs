// WaltzDeck background jobs on the "clipwaltz-deck" BullMQ queue (consumed by the generation worker).
//   describe {assetId}              — vision description of one photo/video, cached on assets.ai_description
//   plan     {projectId}            — describe what's missing, then (re)plan the storyboard around locked scenes
//   scene    {sceneId, instruction} — rewrite one scene's on-screen text
//   import   {projectId, source, key|url, name, userId} — PPTX / PDF / web page → brief + scenes (phase 3)
//   campaign_hooks  {campaignId} — AI hook + CTA options for a draft campaign pack (phase 4)
//   campaign_render {campaignId} — every combination → a queued render with its own storyboard snapshot
// Progress and results live in the DB (projects.deck.plan, deck_scenes) so the editor just polls.
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import IORedis from "ioredis";
import { Worker } from "bullmq";
import { describeMedia, planStoryboard, rewriteScene, writeHooks, chatJson, VISION_MODEL, TEXT_MODEL, DESCRIBE_VERSION } from "./planner.mjs";
import { buildVariant, combinations, variantCode, snapshotLength, MAX_VARIANTS } from "./variants.mjs";
import { parsePptx, parsePdf, fetchPublic, readPage, sceneFromSlide, summarizeBrief, fallbackBrief } from "./importer.mjs";

// DECK_QUEUE override: local dev uses its own queue so the prod worker never sees dev-DB jobs.
export const DECK_QUEUE = process.env.DECK_QUEUE || "clipwaltz-deck";

export function startDeckWorker({ sql, getBytes, putBytes, deleteKey, run, redisUrl }) {
  // Frames for the vision model: 4 across a video (12/37/62/87 % — each becomes a captioned moment), 1 for a
  // photo; 512 px wide JPEGs. Returns { frames, times }.
  async function framesOf(asset) {
    const dir = mkdtempSync(join(tmpdir(), "cw-deck-"));
    try {
      const src = join(dir, "src");
      writeFileSync(src, await getBytes(asset.converted_key ?? asset.storage_key));
      const ats = asset.kind === "video" ? [0.12, 0.37, 0.62, 0.87].map((f) => f * (asset.duration_sec || 3)) : [0];
      const out = [];
      const times = [];
      for (const [i, at] of ats.entries()) {
        const f = join(dir, `f${i}.jpg`);
        try {
          await run("ffmpeg", ["-v", "error", "-y", "-ss", at.toFixed(2), "-i", src, "-frames:v", "1", "-vf", "scale=512:-2", "-q:v", "4", f]);
          out.push(readFileSync(f).toString("base64"));
          times.push(at);
        } catch { /* skip an unreadable frame */ }
      }
      return { frames: out, times };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async function describe(assetId) {
    const [a] = await sql`select id, kind, storage_key, converted_key, duration_sec, note, ai_description from assets where id = ${assetId}`;
    if (!a) return null;
    if (isCurrent(a.ai_description)) return a.ai_description;
    const { frames, times } = await framesOf(a);
    if (!frames.length) throw new Error("could not read any frame from this file");
    const desc = { ...(await describeMedia(frames, { kind: a.kind, note: a.note, durationSec: a.duration_sec, times })), at: new Date().toISOString() };
    await sql`update assets set ai_description = ${sql.json(desc)} where id = ${assetId}`;
    return desc;
  }

  const isCurrent = (d) => d?.model === VISION_MODEL && !!d?.summary && d?.v === DESCRIBE_VERSION;

  const setPlan = (projectId, plan) =>
    sql`update projects set deck = jsonb_set(coalesce(deck, '{}'::jsonb), '{plan}', ${sql.json(plan)}), updated_at = now() where id = ${projectId}`;

  async function loadMedia(projectId) {
    return sql`select id, kind, original_name, duration_sec, note, ai_description from assets
      where project_id = ${projectId} and upload_state = 'uploaded' and not hidden
        and (source_format is null or conversion_state = 'ready')
      order by order_index asc, created_at asc`;
  }

  async function plan(projectId) {
    const [p] = await sql`select id, deck from projects where id = ${projectId} and kind = 'deck'`;
    if (!p) return;
    const brief = p.deck?.brief ?? {};
    const started = new Date().toISOString();
    try {
      const assets = await loadMedia(projectId);
      if (!assets.length) throw new Error("Add some photos or videos first.");
      const todo = assets.filter((a) => !isCurrent(a.ai_description));
      for (const [i, a] of todo.entries()) {
        await setPlan(projectId, { status: "describing", done: i, total: todo.length, startedAt: started });
        try {
          a.ai_description = await describe(a.id);
        } catch (e) {
          console.error(`[deck] describe ${a.id} failed: ${e.message}`); // planned without a description
        }
      }
      await setPlan(projectId, { status: "planning", startedAt: started });
      const locked = await sql`select * from deck_scenes where project_id = ${projectId} and locked order by order_index`;
      const media = assets.map((a) => ({ id: a.id, kind: a.kind, durationSec: a.duration_sec, note: a.note, desc: a.ai_description }));
      const result = await planStoryboard(
        brief,
        media,
        locked.map((l) => ({ orderIndex: l.order_index, role: l.role, assetId: l.asset_id, durationSec: l.duration_sec, text: l.text })),
      );
      // New scenes fill the slots around the locked ones; locked scenes keep their position. Locked rows are
      // re-read inside the transaction: the model call takes minutes and the user may lock a scene meanwhile.
      let order = [];
      await sql.begin(async (tx) => {
        const lockedNow = await tx`select * from deck_scenes where project_id = ${projectId} and locked order by order_index for update`;
        order = result.scenes.map((s) => ({ ...s, locked: false }));
        for (const l of lockedNow) order.splice(Math.min(l.order_index, order.length), 0, { lockedRow: l });
        await tx`delete from deck_scenes where project_id = ${projectId} and not locked`;
        for (const [i, s] of order.entries()) {
          if (s.lockedRow) {
            await tx`update deck_scenes set order_index = ${i}, updated_at = now() where id = ${s.lockedRow.id}`;
            continue;
          }
          const textMode = brief.textMode === "off" && s.role !== "cta" ? "none" : "auto";
          await tx`insert into deck_scenes ${tx({
            id: randomUUID(), project_id: projectId, order_index: i, role: s.role, asset_id: s.assetId,
            duration_sec: s.durationSec, in_sec: s.inSec ?? null, text_mode: textMode, text: tx.json(s.text), layout: s.layout, voice: s.voice || null,
            why: s.flags?.length ? `${s.why} (Removed ${s.flags.includes("removed-unverified-claim") ? "a claim" : "a number"} that wasn't in your brief.)`.trim() : s.why,
          })}`;
        }
      });
      const used = new Set(result.scenes.map((s) => s.assetId).filter(Boolean));
      for (const o of order) if (o.lockedRow?.asset_id) used.add(o.lockedRow.asset_id);
      await setPlan(projectId, {
        status: "ready", title: result.title, startedAt: started, finishedAt: new Date().toISOString(),
        unusedAssetIds: assets.filter((a) => !used.has(a.id)).map((a) => a.id), stats: result.stats,
      });
      console.log(`[deck] planned ${projectId}: ${order.length} scenes (${order.filter((o) => o.lockedRow).length} locked) in ${result.stats.ms} ms`);
    } catch (e) {
      console.error(`[deck] plan ${projectId} failed: ${e.message}`);
      const msg = e?.name === "AbortError" || /aborted/i.test(String(e?.message))
        ? "The AI took too long (it's shared and busy right now). Your files are already analysed — press Re-plan to try again."
        : String(e.message).slice(0, 300);
      await setPlan(projectId, { status: "failed", error: msg, startedAt: started });
    }
  }

  async function scene(sceneId, instruction) {
    const [s] = await sql`select ds.*, p.deck from deck_scenes ds join projects p on p.id = ds.project_id where ds.id = ${sceneId}`;
    if (!s) return;
    await sql`update deck_scenes set why = ${"Rewriting…"}, updated_at = now() where id = ${sceneId}`;
    try {
      const [a] = s.asset_id ? await sql`select id, kind, duration_sec, note, ai_description from assets where id = ${s.asset_id} and project_id = ${s.project_id}` : [];
      const others = await sql`select text from deck_scenes where project_id = ${s.project_id} and id <> ${sceneId}`;
      const text = await rewriteScene(
        s.deck?.brief ?? {},
        { role: s.role, durationSec: s.duration_sec, layout: s.layout, text: s.text },
        a ? { id: a.id, kind: a.kind, durationSec: a.duration_sec, note: a.note, desc: a.ai_description } : null,
        instruction,
        others.map((o) => o.text?.headline).filter(Boolean),
      );
      const { flags, voice, ...clean } = text;
      if (voice !== undefined) await sql`update deck_scenes set voice = ${voice || null} where id = ${sceneId}`;
      await sql`update deck_scenes set text = ${sql.json(clean)}, text_mode = 'auto',
        why = ${flags ? "Rewritten (removed a claim that wasn't in your brief)." : "Rewritten."}, updated_at = now() where id = ${sceneId}`;
    } catch (e) {
      await sql`update deck_scenes set why = ${`Couldn't rewrite: ${String(e.message).slice(0, 120)}`}, updated_at = now() where id = ${sceneId}`;
    }
  }

  // ── import (phase 3) ──────────────────────────────────────────────────────────────────────────────
  const setImport = (projectId, st) =>
    sql`update projects set deck = jsonb_set(coalesce(deck, '{}'::jsonb), '{import}', ${sql.json(st)}), updated_at = now() where id = ${projectId}`;
  const IMG_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp" };

  /** A picture from the import becomes a normal project photo (library media row + asset, same as an upload). */
  async function addPhoto(project, userId, name, bytes, type, orderIndex) {
    const assetId = randomUUID(), mediaId = randomUUID();
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "image";
    const key = `projects/${project.id}/${assetId}-${safe}`;
    await putBytes(key, bytes, type);
    await sql.begin(async (tx) => {
      if (userId) {
        await tx`insert into media ${tx({ id: mediaId, owner_id: userId, kind: "photo", original_name: name, storage_key: key,
          conversion_state: "ready", size_bytes: bytes.length, last_used_at: new Date() })}`;
      }
      await tx`insert into assets ${tx({ id: assetId, project_id: project.id, media_id: userId ? mediaId : null, workspace_id: project.workspace_id,
        storage_key: key, kind: "photo", original_name: name, upload_state: "uploaded", conversion_state: "ready", order_index: orderIndex })}`;
    });
    return assetId;
  }

  async function importDeck({ projectId, source, key, url, name, userId }) {
    const [project] = await sql`select id, workspace_id, aspect, deck from projects where id = ${projectId} and kind = 'deck'`;
    if (!project) return;
    const startedAt = new Date().toISOString();
    const base = { source, name: String(name ?? "").slice(0, 200) };
    const newAssets = [];
    try {
      await setImport(projectId, { status: "reading", ...base, startedAt });
      let slides = [], title = "", digest = "", pageUrl = null, pageImage = null;
      if (source === "pptx") {
        ({ slides, title } = await parsePptx(await getBytes(key)));
      } else if (source === "pdf") {
        const dir = mkdtempSync(join(tmpdir(), "cw-deckimp-"));
        try {
          const f = join(dir, "in.pdf");
          writeFileSync(f, await getBytes(key));
          ({ slides, title } = await parsePdf(f, run));
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      } else if (source === "url") {
        const r = await fetchPublic(url);
        if (!/html|xml/i.test(r.type)) throw new Error("That address isn't a web page (it's a file). Upload files with Import a file.");
        const page = readPage(r.bytes.toString("utf8"), r.url);
        pageUrl = r.url;
        title = page.title || new URL(r.url).hostname;
        digest = [page.siteName && `Site: ${page.siteName}`, page.description, page.headings.length && `Headings: ${page.headings.join(" | ")}`, page.text]
          .filter(Boolean).join("\n");
        if (!digest.trim()) throw new Error("Couldn't find any readable text on that page.");
        if (page.image) {
          try {
            const img = await fetchPublic(page.image, { maxBytes: 10 << 20, accept: "image/*" });
            const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[img.type.split(";")[0].trim().toLowerCase()];
            if (ext && img.bytes.length > 2000) pageImage = { name: `${new URL(r.url).hostname}.${ext}`, bytes: img.bytes, type: `image/${ext === "jpg" ? "jpeg" : ext}` };
          } catch (e) {
            console.log(`[deck-import] page image skipped: ${e.message}`);
          }
        }
      } else throw new Error("Unknown import type");

      // Pictures → project photos (appended after the existing media).
      const [{ next }] = await sql`select coalesce(max(order_index), -1) + 1 as next from assets where project_id = ${projectId}`;
      let order = Number(next);
      const slideAsset = [];
      for (const [i, s] of slides.entries()) {
        const ext = (s.image?.name.split(".").pop() ?? "").toLowerCase();
        if (s.image && IMG_TYPES[ext]) {
          const id = await addPhoto(project, userId, `slide-${i + 1}.${ext}`, s.image.bytes, IMG_TYPES[ext], order++);
          newAssets.push(id);
          slideAsset.push(id);
        } else slideAsset.push(null);
      }
      // Re-importing the same page doesn't add its preview image twice.
      const [dupe] = pageImage ? await sql`select id from assets where project_id = ${projectId} and original_name = ${pageImage.name} limit 1` : [];
      if (pageImage && dupe) pageImage = null;
      if (pageImage) newAssets.push(await addPhoto(project, userId, pageImage.name, pageImage.bytes, pageImage.type, order++));

      // Slides → scenes, after the current storyboard. They are the owner's own words: Manual text, locked.
      const [{ count }] = await sql`select count(*)::int as count from deck_scenes where project_id = ${projectId}`;
      if (slides.length) {
        await sql.begin(async (tx) => {
          for (const [i, s] of slides.entries()) {
            const sc = sceneFromSlide(s);
            const assetId = slideAsset[i];
            const layout = !assetId && i === 0 && count === 0 && !sc.text.bullets.length ? "title-card" : "slide";
            await tx`insert into deck_scenes ${tx({
              id: randomUUID(), project_id: projectId, order_index: count + i, role: i === 0 && count === 0 ? "title" : "content",
              asset_id: assetId, duration_sec: sc.durationSec, text_mode: "manual", text: tx.json(sc.text), layout,
              voice: sc.voice || null, locked: true, why: `Imported from ${source === "pptx" ? "your PowerPoint" : "your PDF"}, slide ${i + 1}.`,
            })}`;
          }
        });
      }
      await setImport(projectId, { status: "summarizing", ...base, startedAt });

      // The brief: summarised by the model, filled in only where the owner left it empty.
      if (!digest) digest = slides.map((s, i) => `Slide ${i + 1}: ${[s.title, s.sub, ...s.body].filter(Boolean).join(" — ")}`).join("\n");
      const got = (await summarizeBrief(chatJson, TEXT_MODEL, { source, title, url: pageUrl, digest })) ?? fallbackBrief({ source, title, digest });
      const [p2] = await sql`select deck, aspect from projects where id = ${projectId}`;
      const cur = p2.deck?.brief ?? {};
      const empty = (v) => !v || (typeof v === "string" && !v.trim());
      const brief = { ...cur };
      for (const k of ["prompt", "goal", "audience", "tone", "offer"]) if (empty(cur[k]) && got[k]) brief[k] = got[k];
      if (empty(cur.cta?.text) && got.cta) brief.cta = got.cta;
      // A deck with no storyboard yet becomes a Presentation (and a vertical one goes 16:9, as saveBrief does).
      const toPresentation = slides.length > 0 && count === 0 && cur.mode !== "presentation";
      if (toPresentation) {
        brief.mode = "presentation";
        brief.lengthSec = Math.max(6, Math.min(180, Math.round(slides.reduce((n, s) => n + sceneFromSlide(s).durationSec, 0))));
      }
      if (!brief.lengthSec) brief.lengthSec = 15;
      await sql`update projects set deck = jsonb_set(coalesce(deck, '{}'::jsonb), '{brief}', ${sql.json(brief)}),
        length_sec = ${brief.lengthSec}, aspect = ${toPresentation && p2.aspect === "9:16" ? "16:9" : p2.aspect}, updated_at = now() where id = ${projectId}`;

      const note = source === "url"
        ? `Brief filled from ${new URL(pageUrl).hostname}${pageImage ? " and its preview image added to your media" : ""}.`
        : `${slides.length} slide${slides.length === 1 ? "" : "s"} added to the end of the storyboard (locked — your words).`;
      await setImport(projectId, { status: "ready", ...base, scenes: slides.length, images: newAssets.length, finishedAt: new Date().toISOString(), note });
      console.log(`[deck-import] ${projectId}: ${source} → ${slides.length} scenes, ${newAssets.length} images`);
    } catch (e) {
      console.error(`[deck-import] ${projectId} ${source} failed: ${e.message}`);
      await setImport(projectId, { status: "failed", ...base, error: String(e.message).slice(0, 300) });
    } finally {
      if (key && deleteKey) await deleteKey(key).catch((e) => console.warn(`[deck-import] couldn't delete ${key}: ${e.message}`));
    }
    // Warm the vision descriptions of new photos (the editor shows "looking…" until then; planning needs them).
    for (const id of newAssets) await describe(id).catch((e) => console.error(`[deck] describe ${id} failed: ${e.message}`));
    // A web page only fills the brief: with media already in the project and no storyboard yet, plan it now.
    if (source === "url") {
      const [{ media }] = await sql`select count(*)::int as media from assets where project_id = ${projectId} and upload_state = 'uploaded' and not hidden`;
      const [{ scenes }] = await sql`select count(*)::int as scenes from deck_scenes where project_id = ${projectId}`;
      const [p3] = await sql`select deck from projects where id = ${projectId}`;
      if (media > 0 && scenes === 0 && p3.deck?.import?.status === "ready") {
        await setPlan(projectId, { status: "queued", startedAt: new Date().toISOString() });
        await plan(projectId);
      }
    }
  }

  // ── campaign packs (phase 4) ──────────────────────────────────────────────────────────────────────
  const setCampaign = (id, fields) => sql`update deck_campaigns set ${sql(fields)}, updated_at = now() where id = ${id}`;

  /** AI hook + CTA options for a draft pack (config.aiHooks / aiCtas; config.winner for "more like the winner"). */
  async function campaignHooks(campaignId) {
    const [c] = await sql`select * from deck_campaigns where id = ${campaignId}`;
    if (!c) return;
    try {
      const [p] = await sql`select id, deck from projects where id = ${c.project_id}`;
      const brief = p.deck?.brief ?? {};
      const scenes = await sql`select * from deck_scenes where project_id = ${c.project_id} order by order_index`;
      const hookScene = scenes.find((s) => s.role === "hook") ?? scenes[0];
      const media = (await loadMedia(c.project_id)).map((a) => ({ id: a.id, kind: a.kind, durationSec: a.duration_sec, note: a.note, desc: a.ai_description }));
      const cfg = c.config ?? {};
      const got = await writeHooks(brief, media, { assetId: hookScene?.asset_id ?? null, text: hookScene?.text ?? {}, voice: hookScene?.voice ?? "" }, {
        hooks: cfg.aiHooks ?? 2, ctas: cfg.aiCtas ?? 0, hookSec: Number(hookScene?.duration_sec) || 2,
        winner: cfg.winner ?? null, losers: cfg.winner?.losers ?? [],
      });
      // Re-read: the owner may have edited the draft while the model was writing.
      const [now] = await sql`select config from deck_campaigns where id = ${campaignId}`;
      const next = { ...now.config };
      next.hooks = [...(next.hooks ?? []), ...got.hooks.map((h) => ({ id: randomUUID(), source: cfg.winner ? "winner" : "ai", ...h }))];
      next.ctas = [...(next.ctas ?? []), ...got.ctas.map((t) => ({ id: randomUUID(), source: "ai", text: t }))];
      const short = (cfg.aiHooks ?? 0) > got.hooks.length ? `The AI wrote ${got.hooks.length} of ${cfg.aiHooks} hooks — add your own or try again.` : null;
      await setCampaign(campaignId, { config: sql.json(next), status: "draft", error: short });
      console.log(`[deck] campaign ${campaignId}: ${got.hooks.length} hooks, ${got.ctas.length} CTAs`);
    } catch (e) {
      console.error(`[deck] campaign hooks ${campaignId} failed: ${e.message}`);
      await setCampaign(campaignId, { status: "draft", error: `The AI couldn't write options: ${String(e.message).slice(0, 200)}` });
    }
  }

  /** Every hook × CTA × length × aspect → a render with its own storyboard snapshot (settings.deckVariant). */
  async function campaignRender(campaignId) {
    const [c] = await sql`select * from deck_campaigns where id = ${campaignId}`;
    if (!c || c.status !== "building") return;
    try {
      const [p] = await sql`select id, deck, aspect from projects where id = ${c.project_id}`;
      const brief = p.deck?.brief ?? {};
      const base = await sql`select * from deck_scenes where project_id = ${c.project_id} order by order_index`;
      if (!base.length) throw new Error("the storyboard is empty — plan it first");
      const durs = await sql`select id, duration_sec from assets where project_id = ${c.project_id} and kind = 'video'`;
      const mediaDur = new Map(durs.filter((a) => a.duration_sec).map((a) => [a.id, Number(a.duration_sec)]));
      const cfg = c.config;
      const combos = combinations({ hooks: cfg.hooks, ctas: cfg.ctas, lengths: cfg.lengths, aspects: cfg.aspects }).slice(0, MAX_VARIANTS);
      if (!combos.length) throw new Error("pick at least one hook, CTA, length and shape");
      const voiceOn = !!brief.voice?.mode && brief.voice.mode !== "off";
      const baseCta = cfg.ctas.find((x) => x.original)?.text ?? brief.cta?.text ?? "";
      const [{ maxv }] = await sql`select coalesce(max(version), 0)::int as maxv from renders where project_id = ${c.project_id}`;
      await sql.begin(async (tx) => {
        // Share links may have been switched on while the pack was building: new variants follow the switch.
        const [{ shared }] = await tx`select shared from deck_campaigns where id = ${campaignId} for update`;
        for (const [i, v] of combos.entries()) {
          const scenes = buildVariant(base, {
            hook: v.hook.original ? { original: true } : v.hook, cta: v.cta.original ? { original: true } : { text: v.cta.text },
            lengthSec: v.lengthSec, mediaDur, voiceOn, speed: brief.voice?.speed ?? 1, baseCta, mode: brief.mode,
          });
          // A storyboard too short to stretch to the target (scenes top out at 8 s) is labelled with what it really runs.
          const real = snapshotLength(scenes);
          const lengthSec = Math.abs(real - v.lengthSec) > 1.5 ? Math.round(real) : v.lengthSec;
          const { code, label } = variantCode(v.hookIdx, v.ctaIdx, lengthSec, v.aspect);
          await tx`insert into renders ${tx({
            id: randomUUID(), project_id: c.project_id, version: maxv + 1 + i, aspect: v.aspect, status: "queued",
            watermark: cfg.watermark !== false, campaign_id: campaignId, visibility: shared ? "unlisted" : "private",
            ...(shared ? { shared_at: new Date() } : {}),
            settings: tx.json({ deckVariant: { scenes: scenes.map((s) => ({ ...s, created_at: undefined, updated_at: undefined })) }, aspect: v.aspect, lengthSec: snapshotLength(scenes) }),
            variant: tx.json({ code, label, hookId: v.hook.id, ctaId: v.cta.id, lengthSec, targetSec: v.lengthSec, aspect: v.aspect,
              hookHeadline: v.hook.original ? (base.find((s) => s.role === "hook") ?? base[0]).text?.headline ?? "" : v.hook.headline,
              ctaText: v.cta.text, angle: v.hook.angle ?? (v.hook.original ? "original" : "") }),
          })}`;
        }
        await tx`update deck_campaigns set status = 'rendering', error = null, updated_at = now() where id = ${campaignId}`;
        await tx`update projects set status = 'rendering', updated_at = now() where id = ${c.project_id}`;
      });
      console.log(`[deck] campaign ${campaignId}: queued ${combos.length} variant renders`);
    } catch (e) {
      console.error(`[deck] campaign render ${campaignId} failed: ${e.message}`);
      await setCampaign(campaignId, { status: "draft", error: `Couldn't build the pack: ${String(e.message).slice(0, 200)}` });
    }
  }

  const w = new Worker(
    DECK_QUEUE,
    async (job) => {
      const d = job.data ?? {};
      if (job.name === "describe") await describe(d.assetId);
      else if (job.name === "plan") await plan(d.projectId);
      else if (job.name === "scene") await scene(d.sceneId, d.instruction);
      else if (job.name === "import") await importDeck(d);
      else if (job.name === "campaign_hooks") await campaignHooks(d.campaignId);
      else if (job.name === "campaign_render") await campaignRender(d.campaignId);
    },
    // One at a time: the Ollama box is shared, parallel calls only queue there and evict models.
    { connection: new IORedis(redisUrl, { maxRetriesPerRequest: null }), concurrency: 1, lockDuration: 30 * 60 * 1000 },
  );
  w.on("failed", (job, err) => console.error(`[deck] job ${job?.name} ${job?.id} failed: ${err?.message}`));
  console.log(`[deck] WaltzDeck worker up (queue=${DECK_QUEUE}, model=${VISION_MODEL})`);
  return w;
}
