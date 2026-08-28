export type GeographicBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export const NYC_BOUNDS: GeographicBounds = {
  west: -74.25909,
  south: 40.4774,
  east: -73.70018,
  north: 40.91758,
};

export const movementBoundsWithMargin = (
  bounds: GeographicBounds,
  marginFraction: number,
): [west: number, south: number, east: number, north: number] => [
  bounds.west - (bounds.east - bounds.west) * marginFraction,
  bounds.south - (bounds.north - bounds.south) * marginFraction,
  bounds.east + (bounds.east - bounds.west) * marginFraction,
  bounds.north + (bounds.north - bounds.south) * marginFraction,
];
