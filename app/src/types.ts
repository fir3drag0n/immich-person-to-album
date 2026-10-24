export interface Config {
  immichServer: string;
  /** Cron schedule for the quick incremental sync (default every 30 minutes) */
  schedule?: string;
  /**
   * Cron schedule for the full sync (default daily at 03:00). The full sync
   * compares the album with every asset of the linked people, so it also picks up
   * faces that were assigned after the first sync, and removes untagged assets
   * when `removeUntagged` is set. Set to an empty string to disable.
   */
  fullSyncSchedule?: string;
  users: User[]
}

export interface User {
  apiKey: string;
  personLinks: Link[]
}

export interface Link {
  description?: string;
  /** A single person (original config format) */
  personId?: string;
  /** Several people, combined according to `match` */
  personIds?: string[];
  /** `any` (default): assets with at least one of the people; `all`: assets with all of them */
  match?: 'any' | 'all';
  albumId: string;
  /** Only assets taken on or after this date (ISO 8601, e.g. 2020-01-01) */
  takenAfter?: string;
  /** Only assets taken before this date (ISO 8601) */
  takenBefore?: string;
  /**
   * During the full sync, remove assets from the album that no longer belong to
   * any link pointing at this album (e.g. a face was unassigned). Off by default,
   * because it also removes assets that were added to the album by hand.
   */
  removeUntagged?: boolean;
  apiKeyShort: string;
}
