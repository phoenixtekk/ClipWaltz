import type { CloudProvider, CloudProviderId } from "./types";
import { googleDrive } from "./google-drive";
import { oneDrive } from "./onedrive";
import { dropbox } from "./dropbox";

const PROVIDERS: Record<CloudProviderId, CloudProvider> = {
  google_drive: googleDrive,
  onedrive: oneDrive,
  dropbox,
};

export const provider = (id: CloudProviderId): CloudProvider => PROVIDERS[id];
