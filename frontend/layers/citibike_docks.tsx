import type { CircleLayerSpecification } from "maplibre-gl";
import type { MapContribution } from "../Map";
import type { CitibikeDocksState } from "../map_state";
import {
  circleLegend,
  DETAIL_FADE,
  DETAIL_FADE_IN,
  interpolateOnZoom,
  type LayerDefinition,
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
  "circle-opacity": DETAIL_FADE,
  "circle-stroke-opacity": DETAIL_FADE,
} satisfies CircleLayerSpecification["paint"];

const citibikeDocksMapContribution = (): MapContribution => ({
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
});

const CitibikeDocksControls = () => (
  <LegendRows
    items={[
      {
        label: "Dock",
        legend: circleLegend(dockMarkerPaint),
      },
    ]}
  />
);

export const citibikeDocksLayer: LayerDefinition<CitibikeDocksState> = {
  label: "Citi Bike docks",
  contribution: citibikeDocksMapContribution,
  renderControls: () => <CitibikeDocksControls />,
};
