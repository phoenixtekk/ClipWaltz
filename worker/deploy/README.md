# Deploy the render worker to the AI box

Prod render host: **AI box** (`ai`, 192.168.166.168 — 32-core, FFmpeg, reaches MinIO on the LAN).

## Prerequisite — already satisfied
Run the worker as **lacy@ai** (not root@ai): `lacy@ai` already has key-auth to `lacy@linuxg1`
(verified 2026-09-16), so the Postgres tunnel needs no `authorized_keys` change. (The earlier
"authorize the AI box key" idea was a red herring from a root@ai-vs-lacy@ai mix-up.)

## Already deployed (2026-09-16)
Code + deps + env are in place on **`lacy@ai:~/clipwaltz`**: `worker/render-worker.mjs`,
`npm i postgres @aws-sdk/client-s3` done, and `~/clipwaltz/.env.worker` (mode 600, **PROD** db
`clipwaltz` via the tunnel + S3 creds). The DB tunnel + worker startup were verified (worker
connected, "no queued renders"). A full render on the box is still unverified — blocked by a
**linuxg7 (MinIO host) outage** on 2026-09-16.

## Remaining (once linuxg7/MinIO is back)
Install the user systemd services so it runs always-on:
```bash
mkdir -p ~/.config/systemd/user
cp ~/clipwaltz/worker/deploy/clipwaltz-db-tunnel.service ~/clipwaltz/worker/deploy/clipwaltz-worker.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now clipwaltz-db-tunnel clipwaltz-worker
sudo loginctl enable-linger lacy   # keep user services running after logout
```

## Verify
```bash
systemctl --user status clipwaltz-worker --no-pager
journalctl --user -u clipwaltz-worker -n 30 --no-cat
```
Queue a render from the app; the worker log should show it claimed + finished.

## After deploying
Update `server-inventory.md` (new services on the AI box: `clipwaltz-db-tunnel`, `clipwaltz-worker`,
local port 55432) and re-publish the gated wiki copy.
