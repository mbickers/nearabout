import type { ExpressionSpecification } from "maplibre-gl";

export const BIKE_COLOR = "#000000";

export const STREET_COLOR = "#d5d5d5";

export const SOURCE_ID = "protomaps";

export const INITIAL_ZOOM = 11;

export const DETAIL_FADE_IN = 14;

export const DETAIL_FADE_FULL = 14.5;

export const STATION_DETAIL_ZOOM = DETAIL_FADE_IN;

// pairs rather than an object because integer-like object keys sort ahead of fractional ones,
// which would silently reorder stops like 14.5 and 15 into a descending list maplibre rejects
export const interpolateOnZoom = (
  stops: [zoom: number, value: number | ExpressionSpecification][],
) => ["interpolate", ["linear"], ["zoom"], ...stops.flat()] as unknown as ExpressionSpecification;

export const DETAIL_FADE = interpolateOnZoom([
  [DETAIL_FADE_IN, 0],
  [DETAIL_FADE_FULL, 1],
]);

export const CARET_SIZE_STOPS: [zoom: number, size: number][] = [
  [DETAIL_FADE_IN, 1.9],
  [16, 2.5],
  [19, 4.5],
];

export const SUBWAY_WIDTH = interpolateOnZoom([
  [10, 1],
  [14, 3],
  [18, 6],
]);

// the caret icon, in css pixels at CARET_SIZE_STOPS size 1
const CARET_LENGTH_PIXELS = 3.5;
const CARET_HEIGHT_PIXELS = 7;
const CARET_STROKE_PIXELS = 1;

// avoids resampling blur at the sizes CARET_SIZE_STOPS reaches
export const CARET_RESOLUTION = 4;

export const drawCaret = ({ color }: { color: string }) => {
  const inset = CARET_STROKE_PIXELS / 2;
  const width = CARET_LENGTH_PIXELS + CARET_STROKE_PIXELS;

  const canvas = document.createElement("canvas");
  canvas.width = width * CARET_RESOLUTION;
  canvas.height = CARET_HEIGHT_PIXELS * CARET_RESOLUTION;
  const context = canvas.getContext("2d")!;
  context.scale(CARET_RESOLUTION, CARET_RESOLUTION);

  context.strokeStyle = color;
  context.lineWidth = CARET_STROKE_PIXELS;
  context.lineCap = "round";
  context.lineJoin = "round";

  // the ink then spans exactly CARET_HEIGHT_PIXELS at any stroke width
  context.beginPath();
  context.moveTo(inset, inset);
  context.lineTo(inset + CARET_LENGTH_PIXELS, CARET_HEIGHT_PIXELS / 2);
  context.lineTo(inset, CARET_HEIGHT_PIXELS - inset);
  context.stroke();

  return context.getImageData(0, 0, canvas.width, canvas.height);
};
