// Shared shape + normaliser for Auto Post presets.
//
// This lives here rather than in the route because a Next.js route file may only
// export request handlers and a fixed set of config fields — exporting a helper
// from one and importing it into a sibling route fails the build with
// "not a valid Route export field".

export interface PresetConfig {
  daysOfWeek?: number[] | string;
  timeOfDay?: string;
  timesOfDay?: string[];
  providers?: string[] | string;
  mode?: string;
  seedPrompt?: string;
  topics?: string;
  productId?: string | null;
  imageMode?: string;
  videoMode?: string;
  imageSet?: string[] | string;
  links?: string;
  linkUtm?: boolean;
  reviewFirst?: boolean;
}

// Normalise a config body (from the form or a rule) into the stored column shape.
export function normalizePreset(body: PresetConfig) {
  const days = (Array.isArray(body.daysOfWeek)
    ? body.daysOfWeek
    : String(body.daysOfWeek ?? "1,2,3,4,5").split(",").map(Number)
  ).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);

  const rawTimes = Array.isArray(body.timesOfDay)
    ? body.timesOfDay
    : String(body.timeOfDay ?? "").split(",");
  const validTimes = [...new Set(rawTimes.map((s) => String(s).trim()).filter((t) => /^\d{2}:\d{2}$/.test(t)))]
    .sort()
    .slice(0, 12);

  const providers = Array.isArray(body.providers)
    ? body.providers
    : String(body.providers ?? "").split(",");
  const imageSet = Array.isArray(body.imageSet)
    ? body.imageSet
    : String(body.imageSet ?? "").split(",");

  return {
    daysOfWeek: (days.length ? days : [1, 2, 3, 4, 5]).join(","),
    timeOfDay: (validTimes.length ? validTimes : ["09:00"]).join(","),
    providers: providers.map((s) => String(s).trim()).filter(Boolean).join(","),
    mode: body.mode === "queue" ? "queue" : "generate",
    seedPrompt: (body.seedPrompt ?? "").slice(0, 4000),
    topics: (body.topics ?? "").slice(0, 4000),
    links: (body.links ?? "").slice(0, 4000),
    linkUtm: body.linkUtm === true,
    productId: body.productId || null,
    imageMode: ["generate", "set"].includes(body.imageMode ?? "") ? body.imageMode! : "none",
    // `normalize()` is a FULL replace — anything omitted is blanked (that is how
    // three rules lost their links once). So this has to be listed here, and
    // every caller that saves a rule has to send it.
    videoMode: body.videoMode === "explainer" ? "explainer" : "none",
    imageSet: imageSet.map((s) => String(s).trim()).filter(Boolean).join(","),
    reviewFirst: body.reviewFirst ?? false,
  };
}
