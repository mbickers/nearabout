export const SERVICE_PERIODS = ["regular", "late_night", "weekend"] as const;

export type ServicePeriod = (typeof SERVICE_PERIODS)[number];

export type Layer =
  | { kind: "geography" }
  | { kind: "streets" }
  | { kind: "parks" }
  | { kind: "bike_lanes" }
  | { kind: "subway"; servicePeriod: ServicePeriod };
