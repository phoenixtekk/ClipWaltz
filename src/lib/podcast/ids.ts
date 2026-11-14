// Public ids for podcast URLs.
//
// Apple: "Use only ASCII filenames and URLs that include a-z, A-Z, or 0-9."
// A UUID is ASCII but carries hyphens, and stripping them costs nothing next to
// the cost of a feed rejected for a reason that is hard to see from outside.
//
// This lives in its own module because a Next.js route file may only export
// request handlers and a small set of config values — exporting a helper from
// one fails the build with "does not match the required types of a Next.js
// Route", which is an unhelpful way to learn it.

/** UUID → 32 hex characters, for use in a URL. */
export function publicId(id: string): string {
  return id.replace(/-/g, "");
}

/** The inverse: 32 hex characters → canonical UUID, or null if it isn't one. */
export function fromPublicId(bare: string): string | null {
  if (!/^[a-f0-9]{32}$/i.test(bare)) return null;
  return [bare.slice(0, 8), bare.slice(8, 12), bare.slice(12, 16), bare.slice(16, 20), bare.slice(20)].join("-");
}
