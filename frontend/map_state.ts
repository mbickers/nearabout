import * as z from "zod";

const servicePeriodSchema = z.enum(["regular", "late_night", "weekend"]);

export const SERVICE_PERIODS = servicePeriodSchema.options;

export type ServicePeriod = z.infer<typeof servicePeriodSchema>;

const pointOfInterestSchema = z.object({
  id: z.string(),
  label: z.string(),
  address: z.string(),
  longitude: z.number(),
  latitude: z.number(),
});

export type PointOfInterest = z.infer<typeof pointOfInterestSchema>;

const geographyStateSchema = z.object({
  enabled: z.boolean(),
  parksVisible: z.boolean(),
});
export type GeographyState = z.infer<typeof geographyStateSchema>;

const subwayStateSchema = z.object({
  enabled: z.boolean(),
  servicePeriod: servicePeriodSchema,
});
export type SubwayState = z.infer<typeof subwayStateSchema>;

const streetsStateSchema = z.object({
  enabled: z.boolean(),
  bikeLanesVisible: z.boolean(),
});
export type StreetsState = z.infer<typeof streetsStateSchema>;

const citibikeDocksStateSchema = z.object({ enabled: z.boolean() });
export type CitibikeDocksState = z.infer<typeof citibikeDocksStateSchema>;

const pointsOfInterestStateSchema = z.object({
  enabled: z.boolean(),
  items: z.array(pointOfInterestSchema),
});
export type PointsOfInterestState = z.infer<typeof pointsOfInterestStateSchema>;

export const layerStatesSchema = z.object({
  geography: geographyStateSchema,
  subway: subwayStateSchema,
  streets: streetsStateSchema,
  citibikeDocks: citibikeDocksStateSchema,
  pointsOfInterest: pointsOfInterestStateSchema,
});

export type LayerStates = z.infer<typeof layerStatesSchema>;
export type LayerKey = keyof LayerStates;

export const LAYER_KEYS = layerStatesSchema.keyof().options;

export const mapStateSchema = z.object({
  view: z.object({ longitude: z.number(), latitude: z.number(), zoom: z.number() }),
  layers: layerStatesSchema,
});

export type MapState = z.infer<typeof mapStateSchema>;
