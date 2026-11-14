// Types for the parts of worker/deck/importer.mjs the web app uses (G3 product URL import).
export type FetchedPage = { url: string; type: string; bytes: Buffer };
export function fetchPublic(u: string, opts?: { maxBytes?: number; accept?: string }): Promise<FetchedPage>;
export function readPage(html: string, baseUrl: string): {
  title: string; image: string; description: string; siteName: string; headings: string[]; text: string;
};
export type ProductRead = {
  name: string;
  description: string;
  price: string | null;
  currency: string | null;
  brand: string | null;
  images: string[];
  source: "jsonld" | "og" | "text";
};
export function readProduct(html: string, baseUrl: string): ProductRead;
