import type { CloudProvider, CloudProviderId } from "./types";
import { googleDrive } from "./google-drive";
import { oneDrive } from "./onedrive";
import { dropbox } from "./dropbox";
import { box } from "./box";

const PROVIDERS: Record<CloudProviderId, CloudProvider> = {
  google_drive: googleDrive,
  onedrive: oneDrive,
  dropbox,
  box,
};

export const provider = (id: CloudProviderId): CloudProvider => PROVIDERS[id];
