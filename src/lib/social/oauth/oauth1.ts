import crypto from "crypto";

// Minimal OAuth 1.0a (HMAC-SHA1) request signer — what X/Twitter's free tier
// uses for user-context writes (POST /2/tweets, media upload). The request body
// (JSON or multipart) is NOT part of the signature; only the oauth params + any
// query params are.

export interface OAuth1Creds {
  consumerKey: string;
  consumerSecret: string;
  token: string;
  tokenSecret: string;
}

function enc(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

export function oauth1Header(
  method: string,
  url: string,
  creds: OAuth1Creds,
  queryParams: Record<string, string> = {}
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.token,
    oauth_version: "1.0",
  };
  const all: Record<string, string> = { ...oauth, ...queryParams };
  const paramString = Object.keys(all)
    .sort()
    .map((k) => `${enc(k)}=${enc(all[k])}`)
    .join("&");
  const base = [method.toUpperCase(), enc(url), enc(paramString)].join("&");
  const signingKey = `${enc(creds.consumerSecret)}&${enc(creds.tokenSecret)}`;
  oauth.oauth_signature = crypto.createHmac("sha1", signingKey).update(base).digest("base64");
  return (
    "OAuth " +
    Object.keys(oauth)
      .sort()
      .map((k) => `${enc(k)}="${enc(oauth[k])}"`)
      .join(", ")
  );
}
