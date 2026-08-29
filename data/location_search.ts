export type GeographicBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type SearchRecord = [
  label: string,
  longitude: number,
  latitude: number,
  normalizedVariants: string[],
];

export type LocationSearchIndex = {
  records: SearchRecord[];
  postings: Record<string, number[]>;
};

export type LocationSearchManifest = {
  bucketCount: number;
  namedCounts: Record<string, number>;
};

export type LocationSearchBucket = {
  addresses: Record<string, SearchRecord[]>;
  names: Record<string, SearchRecord[]>;
};

export type LocationSearchResult = {
  label: string;
  longitude: number;
  latitude: number;
};

const TOKEN_REPLACEMENTS: Record<string, string> = {
  avenue: "ave",
  boulevard: "blvd",
  circle: "cir",
  court: "ct",
  drive: "dr",
  east: "e",
  eighth: "8",
  eleventh: "11",
  expressway: "expy",
  first: "1",
  fourth: "4",
  highway: "hwy",
  lane: "ln",
  north: "n",
  northeast: "ne",
  northwest: "nw",
  parkway: "pkwy",
  place: "pl",
  plaza: "plz",
  road: "rd",
  second: "2",
  seventh: "7",
  sixth: "6",
  south: "s",
  southeast: "se",
  southwest: "sw",
  street: "st",
  terrace: "ter",
  third: "3",
  tenth: "10",
  trail: "trl",
  turnpike: "tpke",
  twelfth: "12",
  west: "w",
  ninth: "9",
};

export const normalizeLocationSearchText = (value: string): string =>
  value
    // Split characters such as "é" into "e" and a combining accent.
    .normalize("NFKD")
    // Remove the combining accents produced by Unicode normalization.
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    // Reduce numeric ordinals such as "42nd" to "42".
    .replace(/(\d+)(?:st|nd|rd|th)\b/g, "$1")
    // Replace each run of non-letter and non-number characters with one space.
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .split(/\s+/)
    // Splitting an empty string produces one empty token.
    .filter(Boolean)
    .map((token) => TOKEN_REPLACEMENTS[token] ?? token)
    .join(" ");

export const locationSearchTokens = (normalizedText: string): string[] =>
  normalizedText.split(" ").filter(Boolean);

export const locationSearchPostingKey = (token: string): string =>
  token.length < 3 ? token : Array.from(token).slice(0, 3).join("");

export const locationSearchBucket = (key: string, bucketCount: number): number => {
  let hash = 2166136261;
  for (const character of key) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % bucketCount;
};

export const buildLocationSearchIndex = (records: SearchRecord[]): LocationSearchIndex => {
  const sortedRecords = records.toSorted(
    ([labelA, longitudeA, latitudeA], [labelB, longitudeB, latitudeB]) =>
      labelA.localeCompare(labelB) || longitudeA - longitudeB || latitudeA - latitudeB,
  );
  const postingSets = new Map<string, Set<number>>();

  sortedRecords.forEach(([, , , variants], recordId) => {
    const keys = new Set(
      variants.flatMap((variant) => locationSearchTokens(variant).map(locationSearchPostingKey)),
    );
    for (const key of keys) {
      const ids = postingSets.get(key) ?? new Set<number>();
      ids.add(recordId);
      postingSets.set(key, ids);
    }
  });

  return {
    records: sortedRecords,
    postings: Object.fromEntries(
      [...postingSets.entries()]
        .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
        .map(([key, ids]) => [key, [...ids]]),
    ),
  };
};

const matchTier = (query: string, variants: string[]): number | undefined => {
  if (variants.includes(query)) return 0;
  if (variants.some((variant) => variant.startsWith(`${query} `))) return 1;

  const queryTokens = locationSearchTokens(query);
  let prefixMatch = false;
  for (const variant of variants) {
    const variantTokens = locationSearchTokens(variant);
    if (queryTokens.every((queryToken) => variantTokens.includes(queryToken))) return 2;
    if (
      queryTokens.every((queryToken) =>
        variantTokens.some((variantToken) => variantToken.startsWith(queryToken)),
      )
    ) {
      prefixMatch = true;
    }
  }
  return prefixMatch ? 3 : undefined;
};

const isInside = (longitude: number, latitude: number, bounds: GeographicBounds): boolean =>
  longitude >= bounds.west &&
  longitude <= bounds.east &&
  latitude >= bounds.south &&
  latitude <= bounds.north;

export const searchLocationIndex = ({
  index,
  query,
  bounds,
  limit = 20,
}: {
  index: LocationSearchIndex;
  query: string;
  bounds: GeographicBounds;
  limit?: number;
}): LocationSearchResult[] => {
  const normalizedQuery = normalizeLocationSearchText(query);
  if (!normalizedQuery) return [];

  const candidateLists = locationSearchTokens(normalizedQuery)
    .map((token) => index.postings[locationSearchPostingKey(token)])
    .filter((ids): ids is number[] => Boolean(ids));
  const candidateIds = candidateLists.toSorted((a, b) => a.length - b.length)[0];
  if (!candidateIds) return [];

  return searchLocationRecords({
    records: candidateIds
      .map((recordId) => index.records[recordId])
      .filter((record): record is SearchRecord => Boolean(record)),
    normalizedQuery,
    bounds,
    limit,
  });
};

export const searchLocationRecords = ({
  records,
  normalizedQuery,
  bounds,
  limit = 20,
}: {
  records: SearchRecord[];
  normalizedQuery: string;
  bounds: GeographicBounds;
  limit?: number;
}): LocationSearchResult[] => {
  const matches = records
    .flatMap((record) => {
      const [label, longitude, latitude, variants] = record;
      if (!isInside(longitude, latitude, bounds)) return [];
      const tier = matchTier(normalizedQuery, variants);
      return tier === undefined ? [] : [{ label, longitude, latitude, tier }];
    })
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        a.label.localeCompare(b.label) ||
        a.longitude - b.longitude ||
        a.latitude - b.latitude,
    );

  const results: LocationSearchResult[] = [];
  const labels = new Set<string>();
  for (const { label, longitude, latitude } of matches) {
    const normalizedLabel = normalizeLocationSearchText(label);
    if (labels.has(normalizedLabel)) continue;
    labels.add(normalizedLabel);
    results.push({ label, longitude, latitude });
    if (results.length === limit) break;
  }
  return results;
};
