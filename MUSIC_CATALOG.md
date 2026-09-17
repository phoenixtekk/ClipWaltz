# ClipWaltz — Music Catalog

The soundtrack beds users pick in the editor. Each is one row in `music_tracks` (see
`src/db/app-schema.ts`) plus one object in MinIO under `music/<id>.<ext>` (bucket `clipwaltz`).
The editor's picker reads `getMusicTracks()` (`src/lib/music.ts`, active tracks only); the render
worker muxes the chosen track under the video (`worker/render-worker.mjs`), looping it to length.
The draft preview and (future) picker audition stream a track via `GET /api/music/[trackId]`
(owner/auth-checked, proxied through the app so MinIO stays off the public internet).

## Status

- **`clipwaltz_dev` (2026-09-17): seeded with 6 real Pixabay tracks** (2 each upbeat / chill /
  cinematic — see `scripts/music-manifest.json`); the 3 original placeholders are `active = false`.
  Verified: 0 active placeholders, all beds retrievable from MinIO (`audio/mpeg`).
- **`clipwaltz` (prod): still needs the same seed run before launch** — re-run the seeder with a
  prod `DATABASE_URL`, then confirm 0 active placeholders.

`license_ref` is the per-track proof that a bed is safe to post; the seed script refuses placeholder
refs unless `--allow-placeholder` (dev only).

## The licensing decision (owner)

ClipWaltz doesn't just *play* music — it **embeds a bed into a video the end user then posts
publicly** (TikTok / Instagram / YouTube) and, on paid tiers, may monetize. So a track must clear
**all** of:

1. **Commercial use** allowed.
2. **Safe on TikTok/IG/YouTube** — no Content-ID / copyright claim that mutes or demonetizes.
3. **No per-video attribution burden** — we can't force every user to paste a credit string.
4. **Redistribution inside a product** — we hand the same bed to many users inside their videos.
   This is the subtle one: some "free" licenses cover *your own* content but restrict a
   platform/app supplying the music to others. **Confirm this clause per source before we commit.**

### ✅ Decision (2026-09-17): Pixabay Music — verified suitable

Owner chose **Pixabay Music**. The **Pixabay Content License** was checked against our use:
commercial use is allowed, **no attribution required**, and the only redistribution restriction is
on *standalone* distribution — "You cannot sell or distribute Content ... on a Standalone basis.
Standalone means where no creative effort has been applied to the Content and it remains in
substantially the same form as it exists on our website." ClipWaltz muxes the bed **into the
user's edited video** (creative effort applied; the bed is never delivered on its own), so our use
is compliant. **Guardrail:** never add a feature that lets a user download the bare, unmodified
music file by itself — that would be standalone distribution. (In-editor audition streaming inside
the authenticated app is preview, not distribution.) Record each track's `licenseRef` as
`Pixabay <track-url-or-id> — Pixabay Content License`.

### Candidate sources (reference — Pixabay chosen above)

| Source | Model | Notes to verify before use |
| --- | --- | --- |
| **Pixabay Music** | Free, Pixabay Content License | Very permissive, no attribution, commercial OK. Confirm the app-redistribution angle for our use. |
| **Uppbeat** | Free tier + paid | Free tier often needs a credit; paid removes it. Check TikTok/IG safety + app use. |
| **Epidemic Sound** | Subscription | Strong platform/sync terms; has business/partner licensing suited to apps. Paid. |
| **Artlist** | Subscription | Broad commercial license incl. client work; verify multi-user app redistribution. |
| **YouTube Audio Library** | Free | Safe on YouTube; verify use off-YouTube and inside a product. |

None of these terms should be taken from this table as final — **read the current license at
download time and record the exact reference in the manifest.** When in doubt, prefer a paid
catalog with an explicit app/sync/partner license; it removes the redistribution ambiguity.

## Seeding real tracks (once files + licenses are in hand)

1. Copy `scripts/music-manifest.example.json` → `scripts/music-manifest.json` (gitignored; it is
   not committed) and fill in **real** `artist`, `licenseRef`, `source`, `bpm`, `durationSec`.
2. Put the bed files (`.mp3` / `.m4a`) in a media dir.
3. Run (DB tunnel to linuxg1 + `S3_*` env in `.env.local`, MinIO on linuxg7 must be up):
   ```bash
   node --env-file=.env.local scripts/seed-music.mjs scripts/music-manifest.json ./media-dir
   ```
   The script uploads each file to MinIO, upserts the row, and **refuses any placeholder
   `licenseRef`** unless `--allow-placeholder`.
4. **Retire the placeholders** that are no longer in the manifest:
   ```sql
   update music_tracks set active = false where license_ref like '%PLACEHOLDER-DO-NOT-SHIP%';
   ```
5. **Verify** — the seed script's final line must read `⚠ 0` placeholders, or simply omit the
   warning:
   ```sql
   select count(*) from music_tracks where active = true and license_ref like '%PLACEHOLDER%';
   -- must be 0 before launch
   ```

## Go-live checklist

- [ ] Owner has chosen a licensing source and confirmed the redistribution-inside-a-product clause.
- [ ] Real bed files uploaded; every active track has a real `license_ref` recorded.
- [ ] Placeholder rows set `active = false`.
- [ ] `select count(*) … like '%PLACEHOLDER%' and active` returns **0**.
- [ ] A track auditions correctly via the editor draft preview.
