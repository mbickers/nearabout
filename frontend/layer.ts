import type { PointsOfInterestSearchState } from "./layers/point_of_interest_search";

export const SERVICE_PERIODS = ["regular", "late_night", "weekend"] as const;

export type ServicePeriod = (typeof SERVICE_PERIODS)[number];

export type PointOfInterest = {
  id: string;
  label: string;
  address: string;
  longitude: number;
  latitude: number;
};

export type Layer =
  | { kind: "geography"; parksVisible: boolean }
  | { kind: "streets"; bikeLanesVisible: boolean }
  | { kind: "citibike_docks" }
  | { kind: "subway"; servicePeriod: ServicePeriod }
  | {
      kind: "points_of_interest";
      items: PointOfInterest[];
      searchState?: PointsOfInterestSearchState;
    };
