/**
 * Split items into `cols` columns for a Pinterest-style layout: each item goes to the currently shortest column
 * (heights estimated by `height`, in any consistent unit), so newer items stay near the top and columns end level.
 */
export function masonry<T>(items: T[], cols: number, height: (item: T) => number): T[][] {
  const out: T[][] = Array.from({ length: cols }, () => []);
  const h = new Array<number>(cols).fill(0);
  for (const it of items) {
    let k = 0;
    for (let i = 1; i < cols; i++) if (h[i] < h[k] - 0.001) k = i; // ties → leftmost, keeps reading order across
    out[k].push(it);
    h[k] += height(it);
  }
  return out;
}
