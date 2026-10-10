/**
 * Rovers catalog v1 — wire types.
 *
 * Rovers Slice A is info-only: the Pi agent recommends curated open-source
 * services and the Extension Center lists them. There is NO deploy engine, so
 * every entry carries `deploy.kind === 'none'` and no card ever renders a
 * deploy action. The signed catalog body (catalog.json) is the single source of
 * truth; these shapes are what the session tools and the `rovers:list` RPC
 * return.
 *
 * Spec: binding cross-slice contract §1 (catalog.json v1) and §2/§4.
 */

/** Localized text pair. `ru` is the product default language. */
export interface RoversLocalizedText {
  ru: string;
  en: string;
}

/**
 * Deploy descriptor. The info-only slice only ever emits `{ kind: 'none' }`;
 * the field exists so a future deploy engine can widen the union without a
 * catalog schema break.
 */
export interface RoversDeployDescriptor {
  kind: 'none';
}

/** One curated open-source service (a `catalog.json` v1 entry). */
export interface RoversEntryFull {
  /** Stable kebab-case id; also the icon file stem. */
  id: string;
  /** Display name (not localized — brand names are not translated). */
  name: string;
  /** Catalog category (e.g. `vector-db`, `chat-ui`). */
  category: string;
  /** One-line card text. */
  tagline: RoversLocalizedText;
  /** Detail-page markdown. */
  description: RoversLocalizedText;
  /** Repo-relative icon path inside the catalog bundle, e.g. `icons/qdrant.svg`. */
  icon: string;
  /** SPDX license id, or `NOASSERTION`. */
  spdx: string;
  /** Upstream homepage / source URL, or an empty string when unknown. */
  homepage: string;
  /** False when the entry is flagged unreliable upstream (license/pin unconfirmed). */
  verified: boolean;
  /** Always `{ kind: 'none' }` on this slice. */
  deploy: RoversDeployDescriptor;
}

/** Card-sized projection returned by `rovers_list` / `rovers_search`. */
export interface RoversCardSummary {
  id: string;
  name: string;
  category: string;
  tagline: RoversLocalizedText;
  icon: string;
  verified: boolean;
}

/** Catalog provenance baked into the signed header. */
export interface RoversCatalogSourceInfo {
  /** `owner/repo` of the authoring repository. */
  repo: string;
  /** Commit SHA the catalog was built from. */
  commit: string;
}

/** Signed, bundled `catalog.json` v1 body. */
export interface RoversCatalog {
  version: number;
  /** ISO-8601 build timestamp. */
  generated_at: string;
  source: RoversCatalogSourceInfo;
  entries: RoversEntryFull[];
}

/** `rovers_list` / `rovers_search` payload. */
export interface RoversCatalogListResult {
  entries: RoversCardSummary[];
  /** Matches before the `limit` was applied. */
  total: number;
}

/** `rovers_list` arguments. */
export interface RoversCatalogListQuery {
  category?: string;
  query?: string;
  limit?: number;
}