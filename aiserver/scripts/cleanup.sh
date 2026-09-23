#!/usr/bin/env bash
# ClipWaltz AISERVER scratch cleanup. Generated outputs and staged inputs are copied to MinIO by
# the ClipWaltz worker within minutes, so the on-box copies under /data/clipwaltz-ai are transient
# (doc 04 §27/§28). Delete files older than the retention window; keep a buffer for in-flight jobs.
# Runs as `lacy` (owns /data/clipwaltz-ai) via the clipwaltz-aiserver-cleanup systemd timer.
set -euo pipefail

DATA=/data/clipwaltz-ai
KEEP_MIN=${CW_KEEP_MIN:-360}      # outputs + inputs: 6h buffer (covers retries / just-finished jobs)
TMP_KEEP_MIN=${CW_TMP_KEEP_MIN:-120}  # temp + cache: 2h

removed=0
for d in output input; do
  [ -d "$DATA/$d" ] || continue
  c=$(find "$DATA/$d" -type f -mmin "+$KEEP_MIN" -delete -print 2>/dev/null | wc -l)
  removed=$((removed + c))
done
for d in temp cache; do
  [ -d "$DATA/$d" ] && find "$DATA/$d" -type f -mmin "+$TMP_KEEP_MIN" -delete 2>/dev/null || true
done
# prune now-empty per-job subdirs
find "$DATA/output" "$DATA/input" -mindepth 1 -type d -empty -delete 2>/dev/null || true

echo "clipwaltz-aiserver-cleanup: removed $removed output/input file(s) older than ${KEEP_MIN}min"
