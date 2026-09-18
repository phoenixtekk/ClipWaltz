import { NextResponse } from "next/server";

export const runtime = "nodejs";

// OneDrive File Picker (OneDrive.js) redirect target: the popup lands here after the
// user authenticates with Microsoft; loading OneDrive.js lets the SDK post the picked
// files back to the opener window. Public — serves only the SDK loader, no secrets.
export async function GET() {
  return new NextResponse(
    '<!doctype html><html><head><meta charset="utf-8"><script src="https://js.live.net/v7.2/OneDrive.js"></script></head><body></body></html>',
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
