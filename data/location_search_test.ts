import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLocationSearchIndex,
  normalizeLocationSearchText,
  type SearchRecord,
  searchLocationIndex,
} from "./location_search.ts";

const NYC = { west: -74.3, south: 40.4, east: -73.6, north: 41 };

test("normalizes accents, ordinals, directionals, and street suffixes", () => {
  assert.equal(
    normalizeLocationSearchText("  W. 42nd St. & SÉVENTH Avenue  "),
    "w 42 st and 7 ave",
  );
});

test("finds exact, reordered, and prefix name matches", () => {
  const records: SearchRecord[] = [
    ["Empire State Building", -73.9857, 40.7484, ["empire state building"]],
    ["State Theatre", -73.99, 40.75, ["state theatre"]],
  ];
  const index = buildLocationSearchIndex(records);

  assert.deepEqual(searchLocationIndex({ index, query: "Empire Sta", bounds: NYC }), [
    { label: "Empire State Building", longitude: -73.9857, latitude: 40.7484 },
  ]);
  assert.deepEqual(searchLocationIndex({ index, query: "building empire", bounds: NYC }), [
    { label: "Empire State Building", longitude: -73.9857, latitude: 40.7484 },
  ]);
});

test("ranks exact matches before prefix matches", () => {
  const records: SearchRecord[] = [
    ["Central Park", -73.9654, 40.7829, ["central park"]],
    ["Central Park Zoo", -73.9718, 40.7678, ["central park zoo"]],
  ];
  const index = buildLocationSearchIndex(records);

  assert.equal(
    searchLocationIndex({ index, query: "Central Park", bounds: NYC })[0]?.label,
    "Central Park",
  );
});

test("orders equally good matches by label", () => {
  const records: SearchRecord[] = [
    ["Broadway, Queens", -73.88, 40.76, ["broadway"]],
    ["Broadway, Manhattan", -73.99, 40.75, ["broadway"]],
  ];
  const index = buildLocationSearchIndex(records);

  assert.deepEqual(
    searchLocationIndex({ index, query: "Broadway", bounds: NYC }).map(({ label }) => label),
    ["Broadway, Manhattan", "Broadway, Queens"],
  );
});

test("applies the bounding box before ranking", () => {
  const records: SearchRecord[] = [
    ["Nearby Cafe", -73.99, 40.75, ["nearby cafe"]],
    ["Outside Cafe", -74.5, 40.75, ["outside cafe"]],
  ];
  const index = buildLocationSearchIndex(records);

  assert.deepEqual(searchLocationIndex({ index, query: "Cafe", bounds: NYC }), [
    { label: "Nearby Cafe", longitude: -73.99, latitude: 40.75 },
  ]);
});

test("returns one result for repeated OSM objects with the same label", () => {
  const records: SearchRecord[] = [
    ["Broadway", -74.01, 40.71, ["broadway"]],
    ["Broadway", -73.99, 40.75, ["broadway"]],
  ];
  const index = buildLocationSearchIndex(records);

  assert.equal(searchLocationIndex({ index, query: "Broadway", bounds: NYC }).length, 1);
});
