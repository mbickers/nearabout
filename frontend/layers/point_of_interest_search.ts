export type LocationSearchResult = {
  label: string;
  longitude: number;
  latitude: number;
};

export type LocationSearchScope = "visible_map" | "entire_city";

type NonEmptyLocationSearchResults = [LocationSearchResult, ...LocationSearchResult[]];

type RetainedLocationSearchResult =
  | { kind: "results"; results: LocationSearchResult[] }
  | { kind: "selected"; result: LocationSearchResult };

type CompletedLocationSearch = {
  requestId: number;
  scope: LocationSearchScope;
  results: NonEmptyLocationSearchResults;
};

export type LocationSearchState =
  | { status: "idle" }
  | {
      status: "queued";
      scope: LocationSearchScope;
      selectFirstResult: boolean;
      retained?: RetainedLocationSearchResult;
    }
  | {
      status: "searching";
      requestId: number;
      scope: LocationSearchScope;
      selectFirstResult: boolean;
      retained?: RetainedLocationSearchResult;
    }
  | { status: "results"; completedSearch: CompletedLocationSearch }
  | { status: "selected"; result: LocationSearchResult; completedSearch?: CompletedLocationSearch }
  | { status: "not_found"; scope: LocationSearchScope }
  | { status: "error"; retained?: RetainedLocationSearchResult };

export type PointOfInterestSearch = {
  query: string;
  state: LocationSearchState;
};

export type LocationSearchEvent =
  | { type: "query_changed"; query: string }
  | { type: "map_moved" }
  | { type: "input_blurred" }
  | { type: "search_requested"; scope: LocationSearchScope }
  | { type: "search_started"; requestId: number }
  | { type: "search_succeeded"; requestId: number; results: LocationSearchResult[] }
  | { type: "search_failed"; requestId: number }
  | { type: "result_selected"; result: LocationSearchResult };

const retainedLocationSearchResult = (
  state: LocationSearchState,
): RetainedLocationSearchResult | undefined => {
  switch (state.status) {
    case "results":
      return { kind: "results", results: state.completedSearch.results };
    case "selected":
      return { kind: "selected", result: state.result };
    case "queued":
    case "searching":
    case "error":
      return state.retained;
    case "idle":
    case "not_found":
      return undefined;
  }
};

const queueSearch = (
  search: PointOfInterestSearch,
  scope: LocationSearchScope,
  selectFirstResult: boolean,
): PointOfInterestSearch =>
  search.query.trim()
    ? {
        ...search,
        state: {
          status: "queued",
          scope,
          selectFirstResult,
          retained: retainedLocationSearchResult(search.state),
        },
      }
    : search;

const transitionAfterInputBlur = (search: PointOfInterestSearch): PointOfInterestSearch => {
  switch (search.state.status) {
    case "selected":
      return search;
    case "results":
      return {
        ...search,
        state: {
          status: "selected",
          result: search.state.completedSearch.results[0],
        },
      };
    case "queued":
    case "searching":
      return {
        ...search,
        state: { ...search.state, selectFirstResult: true },
      };
    case "idle":
    case "not_found":
    case "error":
      return queueSearch(search, "visible_map", true);
  }
};

export const transitionLocationSearch = (
  search: PointOfInterestSearch,
  event: LocationSearchEvent,
): PointOfInterestSearch => {
  switch (event.type) {
    case "query_changed":
      return { query: event.query, state: { status: "idle" } };
    case "map_moved":
      return search.state.status === "selected" || search.query.trim().length < 3
        ? search
        : queueSearch(search, "visible_map", false);
    case "input_blurred":
      return transitionAfterInputBlur(search);
    case "search_requested":
      return queueSearch(search, event.scope, false);
    case "search_started":
      return search.state.status === "queued"
        ? {
            ...search,
            state: {
              ...search.state,
              status: "searching",
              requestId: event.requestId,
            },
          }
        : search;
    case "search_succeeded": {
      if (search.state.status !== "searching" || search.state.requestId !== event.requestId) {
        return search;
      }

      const [firstResult, ...remainingResults] = event.results;
      if (!firstResult) {
        return { ...search, state: { status: "not_found", scope: search.state.scope } };
      }

      const completedSearch: CompletedLocationSearch = {
        requestId: event.requestId,
        scope: search.state.scope,
        results: [firstResult, ...remainingResults],
      };
      return search.state.selectFirstResult
        ? {
            ...search,
            state: {
              status: "selected",
              result: firstResult,
              completedSearch,
            },
          }
        : { ...search, state: { status: "results", completedSearch } };
    }
    case "search_failed":
      return search.state.status === "searching" && search.state.requestId === event.requestId
        ? { ...search, state: { status: "error", retained: search.state.retained } }
        : search;
    case "result_selected":
      return { ...search, state: { status: "selected", result: event.result } };
  }
};

export const locationSearchResults = (
  state: LocationSearchState,
): LocationSearchResult[] | undefined => {
  const retained = retainedLocationSearchResult(state);
  return retained?.kind === "results" ? retained.results : undefined;
};

export const selectedLocationSearchResult = (
  state: LocationSearchState,
): LocationSearchResult | undefined => {
  const retained = retainedLocationSearchResult(state);
  return retained?.kind === "selected" ? retained.result : undefined;
};

export const completedEntireCitySearch = (
  state: LocationSearchState,
): CompletedLocationSearch | undefined => {
  const completedSearch =
    state.status === "results" || state.status === "selected" ? state.completedSearch : undefined;
  return completedSearch?.scope === "entire_city" ? completedSearch : undefined;
};
