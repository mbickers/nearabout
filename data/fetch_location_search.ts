import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { gzipSync } from "node:zlib";

import {
  type LocationSearchBucket,
  type LocationSearchManifest,
  locationSearchBucket,
  locationSearchPostingKey,
  locationSearchTokens,
  normalizeLocationSearchText,
  type SearchRecord,
} from "./location_search.ts";

type OsmTags = Record<string, string | undefined>;

interface GeoJsonGeometry {
  type: string;
  coordinates?: unknown;
}

interface GeoJsonFeature {
  type: "Feature";
  geometry: GeoJsonGeometry | null;
  properties: OsmTags;
}

const run = async (command: string, args: string[]): Promise<void> => {
  console.log([command, ...args].join(" "));
  const child = spawn(command, args, { stdio: ["ignore", "inherit", "inherit"] });
  const exitCode = await new Promise<number | null>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", resolveExit);
  });
  if (exitCode !== 0) throw new Error(`${command} exited with status ${exitCode}`);
};

const download = async (url: string, outputPath: string): Promise<void> => {
  console.log(`Downloading ${url}`);
  const response = await fetch(url, {
    headers: { "User-Agent": "nearabout/0.0.0 (https://github.com/mbickers/nearabout)" },
  });
  if (!response.ok || !response.body) throw new Error(`Download returned ${response.status}`);
  await pipeline(
    Readable.from(response.body as unknown as AsyncIterable<Uint8Array>),
    fs.createWriteStream(outputPath),
  );
};

const maybeDownloadRawOsmData = async ({
  rawOsmDataPath,
}: {
  rawOsmDataPath: string;
}): Promise<void> => {
  try {
    await fsp.access(rawOsmDataPath);
    console.log(`Reusing ${rawOsmDataPath}`);
  } catch {
    const stagingPath = `${rawOsmDataPath}.partial`;
    await download(
      "https://download.geofabrik.de/north-america/us/new-york-latest.osm.pbf",
      stagingPath,
    );
    await fsp.rename(stagingPath, rawOsmDataPath);
  }
};

const splitNames = (value: string | undefined): string[] =>
  value
    ? value
        .split(";")
        .map((name) => name.trim())
        .filter(Boolean)
    : [];

const namesFromTags = (tags: OsmTags): string[] => {
  const names = new Set<string>();
  for (const [key, value] of Object.entries(tags)) {
    if (
      key === "name" ||
      key === "alt_name" ||
      key === "short_name" ||
      key === "official_name" ||
      key === "loc_name" ||
      key.startsWith("name:")
    ) {
      for (const name of splitNames(value)) names.add(name);
    }
  }
  return [...names];
};

const addressParts = (tags: OsmTags): { primary?: string; suffix?: string } => {
  const street = tags["addr:street"] ?? tags["addr:place"];
  const primary = [tags["addr:housenumber"], street].filter(Boolean).join(" ") || undefined;
  const suffix = [tags["addr:city"], tags["addr:state"], tags["addr:postcode"]]
    .filter((part, index, parts) => Boolean(part) && parts.indexOf(part) === index)
    .join(", ");
  return { primary, suffix: suffix || undefined };
};

const coordinateBounds = (coordinates: unknown): [number, number, number, number] | undefined => {
  if (!Array.isArray(coordinates)) return undefined;
  if (
    coordinates.length >= 2 &&
    typeof coordinates[0] === "number" &&
    typeof coordinates[1] === "number"
  ) {
    return [coordinates[0], coordinates[1], coordinates[0], coordinates[1]];
  }

  let bounds: [number, number, number, number] | undefined;
  for (const child of coordinates) {
    const childBounds = coordinateBounds(child);
    if (!childBounds) continue;
    if (!bounds) {
      bounds = childBounds;
    } else {
      bounds = [
        Math.min(bounds[0], childBounds[0]),
        Math.min(bounds[1], childBounds[1]),
        Math.max(bounds[2], childBounds[2]),
        Math.max(bounds[3], childBounds[3]),
      ];
    }
  }
  return bounds;
};

const representativePoint = (geometry: GeoJsonGeometry | null): [number, number] | undefined => {
  const bounds = coordinateBounds(geometry?.coordinates);
  return bounds ? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] : undefined;
};

interface SearchableRecord {
  addressKey?: string;
  hasName: boolean;
  record: SearchRecord;
}

const searchableRecordFromGeoJsonFeature = (
  feature: GeoJsonFeature,
): SearchableRecord | undefined => {
  const tags = feature.properties;
  const point = representativePoint(feature.geometry);
  if (!point) return undefined;

  const names = namesFromTags(tags);
  const { primary: address, suffix } = addressParts(tags);
  const mainName = tags.name?.trim();
  if (!mainName && !address) return undefined;

  const labelParts = mainName ? [mainName, address, suffix] : [address, suffix];
  const label = labelParts
    .filter((part, index, parts) => Boolean(part) && parts.indexOf(part) === index)
    .join(", ");
  const variants = new Set<string>();
  for (const name of names) {
    variants.add(normalizeLocationSearchText(name));
    if (address) variants.add(normalizeLocationSearchText(`${name} ${address}`));
  }
  if (address) variants.add(normalizeLocationSearchText(address));
  if (mainName && suffix) variants.add(normalizeLocationSearchText(`${mainName} ${suffix}`));

  return {
    addressKey: address ? locationSearchTokens(normalizeLocationSearchText(address))[0] : undefined,
    hasName: Boolean(mainName),
    record: [label, point[0], point[1], [...variants].filter(Boolean)],
  };
};

const recordFromGeoJsonFeature = (feature: GeoJsonFeature): SearchRecord | undefined =>
  searchableRecordFromGeoJsonFeature(feature)?.record;

const deduplicateRecords = (records: SearchableRecord[]): SearchableRecord[] => {
  const recordsByLocation = new Map<string, SearchableRecord>();
  for (const searchableRecord of records) {
    const { record } = searchableRecord;
    const [label, longitude, latitude] = record;
    const key = `${normalizeLocationSearchText(label)}\0${longitude.toFixed(5)}\0${latitude.toFixed(5)}`;
    if (!recordsByLocation.has(key)) recordsByLocation.set(key, searchableRecord);
  }
  return [...recordsByLocation.values()];
};

const streamGeoJsonFeatures = async function* (pbfPath: string): AsyncGenerator<GeoJsonFeature> {
  console.log(`Streaming features from ${basename(pbfPath)}`);
  const child = spawn("osmium", ["export", "-f", "geojsonseq", pbfPath], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const exitCodePromise = new Promise<number | null>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", resolveExit);
  });
  const lines = createInterface({ input: child.stdout });
  const recordSeparatorControlCharacterCode = 0x1e;
  for await (const line of lines) {
    const json = (
      line.charCodeAt(0) === recordSeparatorControlCharacterCode ? line.slice(1) : line
    ).trim();
    if (!json) continue;
    yield JSON.parse(json) as GeoJsonFeature;
  }
  const exitCode = await exitCodePromise;
  if (exitCode !== 0) throw new Error(`osmium export exited with status ${exitCode}`);
};

const flatMap = async function* <Input, Output>({
  values,
  transform,
}: {
  values: AsyncIterable<Input>;
  transform: (value: Input) => Iterable<Output>;
}): AsyncGenerator<Output> {
  for await (const value of values) yield* transform(value);
};

const collect = async <Value>(values: AsyncIterable<Value>): Promise<Value[]> => {
  const collectedValues: Value[] = [];
  for await (const value of values) collectedValues.push(value);
  return collectedValues;
};

const recordsFromPbf = (pbfPath: string): Promise<SearchableRecord[]> =>
  collect(
    flatMap({
      values: streamGeoJsonFeatures(pbfPath),
      transform: (feature) => {
        const record = searchableRecordFromGeoJsonFeature(feature);
        return record ? [record] : [];
      },
    }),
  );

const compareSearchRecords = (
  [labelA, longitudeA, latitudeA]: SearchRecord,
  [labelB, longitudeB, latitudeB]: SearchRecord,
): number => labelA.localeCompare(labelB) || longitudeA - longitudeB || latitudeA - latitudeB;

interface SearchIndex {
  buckets: LocationSearchBucket[];
  manifest: LocationSearchManifest;
}

const buildSearchIndex = (
  searchableRecords: SearchableRecord[],
  bucketCount: number,
): SearchIndex => {
  const buckets: LocationSearchBucket[] = Array.from({ length: bucketCount }, () => ({
    addresses: {},
    names: {},
  }));
  const namedCounts = new Map<string, number>();

  for (const { addressKey, hasName, record } of searchableRecords) {
    if (addressKey) {
      const bucket = buckets[locationSearchBucket(addressKey, bucketCount)];
      const records = bucket.addresses[addressKey] ?? [];
      records.push(record);
      bucket.addresses[addressKey] = records;
    }
    if (hasName) {
      const keys = new Set(
        record[3].flatMap((variant) => locationSearchTokens(variant).map(locationSearchPostingKey)),
      );
      for (const key of keys) {
        const bucket = buckets[locationSearchBucket(key, bucketCount)];
        const records = bucket.names[key] ?? [];
        records.push(record);
        bucket.names[key] = records;
        namedCounts.set(key, (namedCounts.get(key) ?? 0) + 1);
      }
    }
  }

  for (const bucket of buckets) {
    for (const records of Object.values(bucket.addresses)) records.sort(compareSearchRecords);
    for (const records of Object.values(bucket.names)) records.sort(compareSearchRecords);
  }

  return {
    buckets,
    manifest: {
      bucketCount,
      namedCounts: Object.fromEntries(
        [...namedCounts.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
    },
  };
};

const writeIndex = async ({
  index: { buckets, manifest },
  outputDirectory,
}: {
  index: SearchIndex;
  outputDirectory: string;
}): Promise<void> => {
  const stagingDirectory = `${outputDirectory}.partial`;
  await fsp.rm(stagingDirectory, { recursive: true, force: true });
  await fsp.mkdir(stagingDirectory, { recursive: true });
  await Promise.all(
    buckets.map(async (bucket, bucketNumber) => {
      await fsp.writeFile(
        join(stagingDirectory, `${bucketNumber}.json.gz`),
        gzipSync(JSON.stringify(bucket), { level: 9 }),
      );
    }),
  );
  await fsp.writeFile(join(stagingDirectory, "manifest.json"), JSON.stringify(manifest));
  await fsp.rm(outputDirectory, { recursive: true, force: true });
  await fsp.rename(stagingDirectory, outputDirectory);
};

const main = async () => {
  const temporaryDirectory = await fsp.mkdtemp(join(tmpdir(), "nearabout-location-search-"));
  try {
    const rawOsmDataPath = resolve(import.meta.dirname, "new-york.osm.pbf");
    const outputDirectory = resolve(import.meta.dirname, "../public/data/location_search");
    const clippedPath = join(temporaryDirectory, "nyc.osm.pbf");
    const filteredPath = join(temporaryDirectory, "searchable.osm.pbf");
    await maybeDownloadRawOsmData({ rawOsmDataPath });
    const nycBounds = { west: -74.3, south: 40.47, east: -73.68, north: 40.93 };
    await run("osmium", [
      "extract",
      "--bbox",
      `${nycBounds.west},${nycBounds.south},${nycBounds.east},${nycBounds.north}`,
      "--strategy",
      "complete_ways",
      "--output",
      clippedPath,
      rawOsmDataPath,
    ]);
    await run("osmium", [
      "tags-filter",
      "--output",
      filteredPath,
      clippedPath,
      "nwr/name",
      "nwr/name:*",
      "nwr/addr:housenumber",
    ]);

    const records = deduplicateRecords(await recordsFromPbf(filteredPath));
    await fsp.mkdir(dirname(outputDirectory), { recursive: true });
    const bucketCount = 64;
    await writeIndex({ index: buildSearchIndex(records, bucketCount), outputDirectory });
    console.log(`Wrote ${records.length} searchable locations to ${outputDirectory}`);
  } finally {
    await fsp.rm(temporaryDirectory, { recursive: true });
  }
};

await main();

export { recordFromGeoJsonFeature };
