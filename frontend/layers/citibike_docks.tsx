import type { CircleLayerSpecification } from "maplibre-gl";
import {
  circleLegend,
  DETAIL_FADE_IN,
  interpolateOnZoom,
  type LayerDefinition,
  type LayerOfKind,
  LegendRows,
} from "./shared";

const dockMarkerPaint = {
  "circle-radius": interpolateOnZoom([
    [DETAIL_FADE_IN, 5.25],
    [18, 10.5],
  ]),
  "circle-color": "#0067b1",
  "circle-stroke-color": "#ffffff",
  "circle-stroke-width": 0.75,
} satisfies CircleLayerSpecification["paint"];

export const citibikeDocksDefinition: LayerDefinition<LayerOfKind<"citibike_docks">> = {
  label: "Citi Bike docks",
  mapStyleFragment: () => ({
    sources: {
      citibike_docks: {
        type: "geojson",
        data: "/data/citibike_docks.geojson",
        attribution: '<a href="https://citibikenyc.com/system-data">Citi Bike</a>',
      },
    },
    physicalLayers: [
      {
        z: "feature",
        style: {
          id: "citibike_docks",
          type: "circle",
          source: "citibike_docks",
          minzoom: DETAIL_FADE_IN,
          paint: dockMarkerPaint,
        },
      },
    ],
  }),
  Controls: () => (
    <LegendRows
      items={[
        {
          label: "Dock",
          legend: circleLegend(dockMarkerPaint),
        },
      ]}
    />
  ),
};
