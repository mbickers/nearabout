import * as z from "zod";

const servicePeriodSchema = z.enum(["regular", "late_night", "weekend"]);

const SERVICE_PERIODS = servicePeriodSchema.options;

type ServicePeriod = z.infer<typeof servicePeriodSchema>;

const pointOfInterestSchema = z.object({
  id: z.string(),
  label: z.string(),
  address: z.string(),
  longitude: z.number(),
  latitude: z.number(),
});

type PointOfInterest = z.infer<typeof pointOfInterestSchema>;

const geographyStateSchema = z.object({
  enabled: z.boolean(),
  parksVisible: z.boolean(),
});
type GeographyState = z.infer<typeof geographyStateSchema>;

const subwayStateSchema = z.object({
  enabled: z.boolean(),
  servicePeriod: servicePeriodSchema,
});
type SubwayState = z.infer<typeof subwayStateSchema>;

const streetsStateSchema = z.object({
  enabled: z.boolean(),
  bikeLanesVisible: z.boolean(),
});
type StreetsState = z.infer<typeof streetsStateSchema>;

const citibikeDocksStateSchema = z.object({ enabled: z.boolean() });
type CitibikeDocksState = z.infer<typeof citibikeDocksStateSchema>;

const pointsOfInterestStateSchema = z.object({
  enabled: z.boolean(),
  items: z.array(pointOfInterestSchema),
});
type PointsOfInterestState = z.infer<typeof pointsOfInterestStateSchema>;

const layerStatesSchema = z.object({
  geography: geographyStateSchema,
  subway: subwayStateSchema,
  streets: streetsStateSchema,
  citibikeDocks: citibikeDocksStateSchema,
  pointsOfInterest: pointsOfInterestStateSchema,
});

type LayerStates = z.infer<typeof layerStatesSchema>;
type LayerKey = keyof LayerStates;

const LAYER_KEYS = layerStatesSchema.keyof().options;

const mapStateSchema = z.object({
  view: z.object({ longitude: z.number(), latitude: z.number(), zoom: z.number() }),
  layers: layerStatesSchema,
});

type MapState = z.infer<typeof mapStateSchema>;

export type {
  CitibikeDocksState,
  GeographyState,
  LayerKey,
  LayerStates,
  MapState,
  PointOfInterest,
  PointsOfInterestState,
  ServicePeriod,
  StreetsState,
  SubwayState,
};
export { LAYER_KEYS, layerStatesSchema, mapStateSchema, SERVICE_PERIODS };
