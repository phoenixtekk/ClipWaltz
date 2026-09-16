# Deploy the render worker to the AI box

Prod render host: **AI box** (`ai`, 192.168.166.168 — 32-core, FFmpeg, reaches MinIO on the LAN).

## Prerequisite (one-time, blocked from automation — run yourself)
The AI box must be able to SSH to linuxg1 to tunnel to Postgres. Authorize its key (run from your
workstation):
```bash
PUB=$(ssh ai 'cat ~/.ssh/id_ed25519.pub'); ssh linuxg1 "grep -qF \"$PUB\" ~/.ssh/authorized_keys || echo \"$PUB\" >> ~/.ssh/authorized_keys"
```
Verify: `ssh ai 'ssh -o BatchMode=yes lacy@linuxg1 hostname'` → should print `linuxg1`.

## Install (on the AI box)
```bash
# 1. copy the app's worker + deps (git clone the repo, or rsync worker/, package.json)
mkdir -p ~/clipwaltz && cd ~/clipwaltz
# ...place worker/ here...
npm init -y >/dev/null && npm i postgres @aws-sdk/client-s3

# 2. env (fill secrets from G:\VisualStudioCode\_keys\clipwaltz.txt — PROD db, not _dev)
cat > ~/clipwaltz/.env.worker <<'ENV'
DATABASE_URL=postgres://clipwaltz:<PW>@127.0.0.1:55432/clipwaltz
S3_ENDPOINT=http://192.168.166.169:9000
S3_BUCKET=clipwaltz
S3_ACCESS_KEY=<key>
S3_SECRET_KEY=<secret>
S3_REGION=us-east-1
ENV
chmod 600 ~/clipwaltz/.env.worker

# 3. services (user units)
mkdir -p ~/.config/systemd/user
cp worker/deploy/clipwaltz-db-tunnel.service worker/deploy/clipwaltz-worker.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now clipwaltz-db-tunnel clipwaltz-worker
loginctl enable-linger "$USER"   # keep user services running after logout
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
