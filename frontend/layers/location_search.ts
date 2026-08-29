import {
  type LocationSearchBucket,
  type LocationSearchManifest,
  locationSearchBucket,
  locationSearchPostingKey,
  locationSearchTokens,
  normalizeLocationSearchText,
  type SearchRecord,
  searchLocationRecords,
} from "../../data/location_search.ts";
import type { GeographicBounds } from "../map_bounds";
import type { LocationSearchResult } from "./point_of_interest_search";

let manifestPromise: Promise<LocationSearchManifest> | undefined;
const bucketPromises = new Map<number, Promise<LocationSearchBucket>>();

const loadManifest = (): Promise<LocationSearchManifest> => {
  manifestPromise ??= fetch("/data/location_search/manifest.json").then(async (response) => {
    if (!response.ok) throw new Error(`Location manifest returned ${response.status}`);
    return (await response.json()) as LocationSearchManifest;
  });
  return manifestPromise;
};

const loadBucket = (bucketNumber: number): Promise<LocationSearchBucket> => {
  const existing = bucketPromises.get(bucketNumber);
  if (existing) return existing;

  const promise = fetch(`/data/location_search/${bucketNumber}.json.gz`).then(async (response) => {
    if (!response.ok) throw new Error(`Location bucket returned ${response.status}`);
    return (await response.json()) as LocationSearchBucket;
  });
  bucketPromises.set(bucketNumber, promise);
  return promise;
};

const namedPostingKey = (
  normalizedQuery: string,
  manifest: LocationSearchManifest,
): string | undefined =>
  locationSearchTokens(normalizedQuery)
    .map(locationSearchPostingKey)
    .filter((key) => manifest.namedCounts[key] !== undefined)
    .toSorted((a, b) => manifest.namedCounts[a] - manifest.namedCounts[b])[0];

export const searchLocations = async ({
  query,
  bounds,
}: {
  query: string;
  bounds: GeographicBounds;
}): Promise<LocationSearchResult[]> => {
  const normalizedQuery = normalizeLocationSearchText(query);
  if (!normalizedQuery) return [];

  const manifest = await loadManifest();
  const nameKey = namedPostingKey(normalizedQuery, manifest);
  const firstToken = locationSearchTokens(normalizedQuery)[0];
  const addressKey = firstToken && /^\d/.test(firstToken) ? firstToken : undefined;
  const recordPromises: Promise<SearchRecord[]>[] = [];

  if (nameKey) {
    const bucketNumber = locationSearchBucket(nameKey, manifest.bucketCount);
    recordPromises.push(loadBucket(bucketNumber).then((bucket) => bucket.names[nameKey] ?? []));
  }
  if (addressKey) {
    const bucketNumber = locationSearchBucket(addressKey, manifest.bucketCount);
    recordPromises.push(
      loadBucket(bucketNumber).then((bucket) => bucket.addresses[addressKey] ?? []),
    );
  }

  const records = (await Promise.all(recordPromises)).flat();
  return searchLocationRecords({ records, normalizedQuery, bounds });
};
