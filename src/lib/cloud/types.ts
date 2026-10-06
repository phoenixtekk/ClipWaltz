// Cloud storage providers a user can connect so finished videos are saved there (account → Cloud storage).
export const CLOUD_PROVIDERS = ["google_drive", "onedrive", "dropbox", "box"] as const;
export type CloudProviderId = (typeof CLOUD_PROVIDERS)[number];
export const isCloudProvider = (v: unknown): v is CloudProviderId => CLOUD_PROVIDERS.includes(v as CloudProviderId);

export const PROVIDER_LABEL: Record<CloudProviderId, string> = {
  google_drive: "Google Drive",
  onedrive: "OneDrive",
  dropbox: "Dropbox",
  box: "Box",
};

export type FolderLayout = "category" | "project" | "flat";
export const FOLDER_LAYOUTS: FolderLayout[] = ["category", "project", "flat"];

export type Tokens = {
  accessToken: string;
  refreshToken?: string | null; // a new one when the provider rotates refresh tokens
  expiresIn?: number | null; // seconds
  scope?: string | null;
};

export type UploadFile = {
  folders: string[]; // e.g. ["ClipWaltz", "Client ads", "Spring promo"] — already cleaned
  name: string; // file name, already cleaned
  size: number;
  mime: string;
  read: (start: number, end: number) => Promise<Uint8Array>; // inclusive byte range
  /** A current access token (refreshed if needed) — for providers whose every request needs one (Box). */
  token?: () => Promise<string>;
};

export type UploadResult = { id: string; url: string | null; path: string };

export interface CloudProvider {
  id: CloudProviderId;
  configured(): boolean;
  /** Path of the OAuth redirect route (registered in the provider's console). */
  redirectPath: string;
  authUrl(state: string, redirectUri: string): string;
  exchange(code: string, redirectUri: string): Promise<Tokens>;
  refresh(refreshToken: string): Promise<Tokens>;
  /** "Connected as …" — an email or display name; null if the provider won't say. */
  whoAmI(accessToken: string): Promise<string | null>;
  upload(accessToken: string, file: UploadFile): Promise<UploadResult>;
}

/** Folder/file names every provider accepts: no \ / : * ? " < > |, control chars or trailing dots/spaces. */
export function cleanName(s: string, max = 100): string {
  const out = String(s ?? "")
    .replace(/[\u0000-\u001f\\/:*?"<>|#%]+/g, " ") // # and % are refused by OneDrive for work
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^~+\s*/, "") // OneDrive: no leading ~
    .slice(0, max)
    .replace(/[. ]+$/, "");
  return out || "Untitled";
}
