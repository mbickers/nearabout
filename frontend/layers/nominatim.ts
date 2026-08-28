import type { GeographicBounds } from "../map_bounds";
import type { LocationSearchResult } from "./point_of_interest_search";

type NominatimSearchResult = {
  display_name: string;
  lat: string;
  lon: string;
};

export const searchNominatim = async ({
  query,
  bounds,
}: {
  query: string;
  bounds: GeographicBounds;
}): Promise<LocationSearchResult[]> => {
  const parameters = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "20",
    layer: "address,poi",
    countrycodes: "us",
    viewbox: [bounds.west, bounds.north, bounds.east, bounds.south].join(","),
    bounded: "1",
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${parameters}`);
  if (!response.ok) throw new Error(`Geocoder returned ${response.status}`);

  return ((await response.json()) as NominatimSearchResult[]).map(
    ({ display_name, lon, lat }): LocationSearchResult => ({
      label: display_name,
      longitude: Number(lon),
      latitude: Number(lat),
    }),
  );
};
