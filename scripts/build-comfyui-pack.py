"""Build public/connector/comfyui-clipwaltz.zip from comfyui-clipwaltz/ (the ClipWaltz talking-photo ComfyUI node pack).

Run from the repo root after any change to comfyui-clipwaltz/:   python scripts/build-comfyui-pack.py
The zip holds one folder, comfyui-clipwaltz/, ready to unzip into ComfyUI/custom_nodes. Deterministic (fixed timestamps).
"""
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "comfyui-clipwaltz")
OUT = os.path.join(ROOT, "public", "connector", "comfyui-clipwaltz.zip")

files = []
for d, dirs, names in os.walk(SRC):
    dirs[:] = sorted(x for x in dirs if x != "__pycache__")
    files += [os.path.join(d, n) for n in sorted(names) if not n.endswith(".pyc")]

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for f in files:
        arc = os.path.join("comfyui-clipwaltz", os.path.relpath(f, SRC)).replace(os.sep, "/")
        info = zipfile.ZipInfo(arc, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        with open(f, "rb") as fh:
            z.writestr(info, fh.read())
print(f"{OUT}: {len(files)} files, {os.path.getsize(OUT) / 1024:.0f} KB")
