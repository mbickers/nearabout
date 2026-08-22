export const SERVICE_PERIODS = ["regular", "late_night", "weekend"] as const;

export type ServicePeriod = (typeof SERVICE_PERIODS)[number];

export type Layer =
  | { kind: "geography"; parksVisible: boolean }
  | { kind: "streets"; bikeLanesVisible: boolean }
  | { kind: "citibike_docks" }
  | { kind: "subway"; servicePeriod: ServicePeriod };
