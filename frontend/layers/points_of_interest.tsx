import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef } from "react";
import { Marker } from "react-map-gl/maplibre";
import type { MapContribution } from "../Map";
import type { PointOfInterest, PointsOfInterestState } from "../map_state";
import { searchLocations } from "./location_search";
import {
  completedEntireCitySearch,
  type LocationSearchEvent,
  type LocationSearchResult,
  type LocationSearchScope,
  locationSearchResults,
  type PointOfInterestSearchRow,
  type PointsOfInterestSearchState,
  selectedLocationSearchResult,
  transitionLocationSearch,
} from "./point_of_interest_search";
import type { LayerControlContext, LayerDefinition, StateChange } from "./shared";

const emptyPointOfInterestRow = (): PointOfInterestSearchRow => ({
  id: crypto.randomUUID(),
  label: "",
  search: { query: "", state: { status: "idle" } },
});

const normalizePointOfInterestRows = (rows: PointOfInterestSearchRow[], editedRowId?: string) => {
  const nonemptyRows = rows.filter(({ label, search }) => search.query.trim() || label.trim());
  const emptyRow =
    rows.find(
      ({ id, label, search }) => id === editedRowId && !search.query.trim() && !label.trim(),
    ) ??
    rows.find(({ label, search }) => !search.query.trim() && !label.trim()) ??
    emptyPointOfInterestRow();
  return [...nonemptyRows, emptyRow];
};

const searchStateForItems = (items: PointOfInterest[]): PointsOfInterestSearchState => ({
  viewRequestSourceId: crypto.randomUUID(),
  nextRequestId: 0,
  rows: normalizePointOfInterestRows(
    items.map((item) => ({
      id: item.id,
      label: item.label,
      search: {
        query: item.address,
        state: {
          status: "selected" as const,
          result: {
            label: item.address,
            longitude: item.longitude,
            latitude: item.latitude,
          },
        },
      },
    })),
  ),
});

const pointOfInterestItemsForRows = (rows: PointOfInterestSearchRow[]): PointOfInterest[] =>
  rows.flatMap(({ id, label, search }) => {
    const selectedResult = selectedLocationSearchResult(search.state);
    return search.query.trim() && selectedResult
      ? [
          {
            id,
            address: search.query,
            label: label.trim() || search.query.trim(),
            longitude: selectedResult.longitude,
            latitude: selectedResult.latitude,
          },
        ]
      : [];
  });

const transitionSearchRow = (
  rows: PointOfInterestSearchRow[],
  rowId: string,
  event: LocationSearchEvent,
) => {
  let changed = false;
  const nextRows = rows.map((row) => {
    if (row.id !== rowId) return row;

    const search = transitionLocationSearch(row.search, event);
    if (search === row.search) return row;

    changed = true;
    return { ...row, search };
  });
  return changed ? nextRows : rows;
};

const transitionEverySearchRow = (rows: PointOfInterestSearchRow[], event: LocationSearchEvent) => {
  let changed = false;
  const nextRows = rows.map((row) => {
    const search = transitionLocationSearch(row.search, event);
    if (search === row.search) return row;

    changed = true;
    return { ...row, search };
  });
  return changed ? nextRows : rows;
};

const PointOfInterestMarker = ({
  label,
  longitude,
  latitude,
  onClick,
}: LocationSearchResult & { onClick?: () => void }) => (
  <Marker longitude={longitude} latitude={latitude} anchor="center">
    <button
      type="button"
      aria-label={onClick ? `Select ${label}` : undefined}
      // Keep focus on the address input until result selection updates the search state. The
      // selection handler then deliberately removes focus.
      onMouseDown={
        onClick
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
            }
          : undefined
      }
      onClick={
        onClick
          ? (event) => {
              event.stopPropagation();
              onClick();
            }
          : undefined
      }
      style={{
        display: "block",
        boxSizing: "border-box",
        maxWidth: 160,
        padding: "3px 5px",
        border: "1px solid #000000",
        borderRadius: 0,
        background: "#ffffff",
        color: "#000000",
        font: "13px sans-serif",
        textAlign: "center",
        overflowWrap: "anywhere",
        pointerEvents: onClick ? "auto" : "none",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {label}
    </button>
  </Marker>
);

const PointsOfInterestControls = ({
  state,
  searchState,
  context: { visibleMapBounds, entireSearchBounds },
  onChange,
  onSearchStateChange,
}: {
  state: PointsOfInterestState;
  searchState: PointsOfInterestSearchState;
  context: LayerControlContext;
  onChange: (change: StateChange<PointsOfInterestState>) => void;
  onSearchStateChange: Dispatch<SetStateAction<PointsOfInterestSearchState>>;
}) => {
  const rows = searchState.rows;
  const visibleMapBoundsRef = useRef(visibleMapBounds);
  visibleMapBoundsRef.current = visibleMapBounds;

  useEffect(() => {
    const items = pointOfInterestItemsForRows(rows);
    onChange((currentState) =>
      currentState.items.length === items.length &&
      currentState.items.every((item, index) => {
        const nextItem = items[index];
        return (
          item.id === nextItem.id &&
          item.label === nextItem.label &&
          item.address === nextItem.address &&
          item.longitude === nextItem.longitude &&
          item.latitude === nextItem.latitude
        );
      })
        ? currentState
        : { ...currentState, items },
    );
  }, [onChange, rows]);

  const updateRows = useCallback(
    (update: (rows: PointOfInterestSearchRow[]) => PointOfInterestSearchRow[]) =>
      onSearchStateChange((currentSearchState) => {
        const nextRows = update(currentSearchState.rows);
        return nextRows === currentSearchState.rows
          ? currentSearchState
          : { ...currentSearchState, rows: nextRows };
      }),
    [onSearchStateChange],
  );

  const transitionRowSearch = useCallback(
    (rowId: string, event: LocationSearchEvent) =>
      updateRows((currentRows) => transitionSearchRow(currentRows, rowId, event)),
    [updateRows],
  );

  const runLocationSearch = useCallback(
    async (rowId: string, query: string, scope: LocationSearchScope, requestId: number) => {
      const bounds = scope === "entire_city" ? entireSearchBounds : visibleMapBoundsRef.current;
      if (!bounds) return;

      try {
        const results = await searchLocations({ query, bounds });
        transitionRowSearch(rowId, { type: "search_succeeded", requestId, results });
      } catch (error) {
        console.error(error);
        transitionRowSearch(rowId, { type: "search_failed", requestId });
      }
    },
    [entireSearchBounds, transitionRowSearch],
  );

  useEffect(() => {
    if (!visibleMapBounds) return;

    updateRows((currentRows) => transitionEverySearchRow(currentRows, { type: "map_moved" }));
  }, [visibleMapBounds, updateRows]);

  useEffect(() => {
    if (!state.enabled) return;

    const rowToSearch = rows.find(
      ({ search }) =>
        search.state.status === "queued" &&
        (search.state.scope === "entire_city" || visibleMapBounds),
    );
    if (rowToSearch?.search.state.status !== "queued") return;

    const { query } = rowToSearch.search;
    const { scope } = rowToSearch.search.state;
    const requestId = searchState.nextRequestId + 1;
    const timeout = window.setTimeout(() => {
      onSearchStateChange((currentSearchState) => {
        const nextRows = transitionSearchRow(currentSearchState.rows, rowToSearch.id, {
          type: "search_started",
          requestId,
        });
        return {
          ...currentSearchState,
          nextRequestId: Math.max(currentSearchState.nextRequestId, requestId),
          rows: nextRows,
        };
      });
      void runLocationSearch(rowToSearch.id, query, scope, requestId);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [
    onSearchStateChange,
    rows,
    runLocationSearch,
    searchState.nextRequestId,
    state.enabled,
    visibleMapBounds,
  ]);

  return (
    <div style={{ display: "grid", gap: 6, width: 260 }}>
      <div style={{ display: "grid", gap: 4 }}>
        {rows.map((row) => {
          const results = locationSearchResults(row.search.state);
          return (
            <div key={row.id} style={{ display: "grid", gap: 2 }}>
              <form
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) auto",
                  alignItems: "center",
                  gap: 4,
                }}
                onSubmit={(event) => {
                  event.preventDefault();
                  transitionRowSearch(row.id, {
                    type: "search_requested",
                    scope: "visible_map",
                  });
                }}
              >
                <input
                  aria-label="Point of interest address"
                  type="text"
                  placeholder="Address"
                  value={row.search.query}
                  disabled={!state.enabled}
                  onChange={({ target }) =>
                    updateRows((currentRows) =>
                      normalizePointOfInterestRows(
                        transitionSearchRow(currentRows, row.id, {
                          type: "query_changed",
                          query: target.value,
                        }),
                        row.id,
                      ),
                    )
                  }
                  onBlur={() => transitionRowSearch(row.id, { type: "input_blurred" })}
                  style={{ boxSizing: "border-box", minWidth: 0, width: "100%", font: "inherit" }}
                />
                <input
                  aria-label="Point of interest label"
                  type="text"
                  placeholder={row.search.query || "Label"}
                  value={row.label}
                  disabled={!state.enabled}
                  onChange={({ target }) =>
                    updateRows((currentRows) =>
                      normalizePointOfInterestRows(
                        currentRows.map((currentRow) =>
                          currentRow.id === row.id
                            ? { ...currentRow, label: target.value }
                            : currentRow,
                        ),
                        row.id,
                      ),
                    )
                  }
                  style={{ boxSizing: "border-box", minWidth: 0, width: "100%", font: "inherit" }}
                />
                <button
                  type="button"
                  aria-label={`Delete ${row.label || row.search.query || "empty point of interest"}`}
                  title="Delete"
                  disabled={!state.enabled}
                  onClick={() =>
                    updateRows((currentRows) =>
                      normalizePointOfInterestRows(currentRows.filter(({ id }) => id !== row.id)),
                    )
                  }
                  style={{
                    display: "grid",
                    placeItems: "center",
                    padding: 2,
                    border: 0,
                    background: "transparent",
                    color: "inherit",
                    cursor: state.enabled ? "pointer" : "default",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                    <path
                      d="M3.5 4.5h9m-6.5 0v-1h4v1m-5.5 0 .5 8h6l.5-8M7 7v3.5m2-3.5v3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </form>
              {row.search.state.status === "searching" ? (
                <span role="status">Searching…</span>
              ) : null}
              {row.search.state.status === "not_found" &&
              row.search.state.scope === "visible_map" ? (
                <span role="status">
                  Nothing found on the visible map.{" "}
                  <button
                    type="button"
                    disabled={!state.enabled}
                    onClick={() =>
                      transitionRowSearch(row.id, {
                        type: "search_requested",
                        scope: "entire_city",
                      })
                    }
                    style={{ font: "inherit" }}
                  >
                    Search entire city
                  </button>
                </span>
              ) : null}
              {row.search.state.status === "not_found" &&
              row.search.state.scope === "entire_city" ? (
                <span role="status">Nothing found in the city.</span>
              ) : null}
              {row.search.state.status === "error" ? (
                <span role="status">Address search failed. Try again.</span>
              ) : null}
              {results ? <span role="status">Select a result on the map.</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const selectSearchResult = ({
  onSearchStateChange,
  rowId,
  result,
}: {
  onSearchStateChange: Dispatch<SetStateAction<PointsOfInterestSearchState>>;
  rowId: string;
  result: LocationSearchResult;
}) => {
  onSearchStateChange((searchState) => {
    const rows = transitionSearchRow(searchState.rows, rowId, {
      type: "result_selected",
      result,
    });
    return rows === searchState.rows ? searchState : { ...searchState, rows };
  });
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
};

const pointsOfInterestMapContribution = ({
  state,
  searchState,
  onSearchStateChange,
}: {
  state: PointsOfInterestState;
  searchState: PointsOfInterestSearchState;
  onSearchStateChange: Dispatch<SetStateAction<PointsOfInterestSearchState>>;
}): MapContribution => {
  const rows = searchState.rows;
  const activeSearchRow = rows.find(({ search }) => locationSearchResults(search.state));
  const results = activeSearchRow && locationSearchResults(activeSearchRow.search.state);
  const completedSearch = rows
    .map(({ search }) => completedEntireCitySearch(search.state))
    .filter((search): search is NonNullable<typeof search> => search !== undefined)
    .sort((first, second) => second.requestId - first.requestId)[0];

  return {
    sources: {},
    physicalLayers: [],
    markerElements:
      activeSearchRow && results
        ? results.map((result) => (
            <PointOfInterestMarker
              key={`${activeSearchRow.id}:${result.latitude},${result.longitude}:${result.label}`}
              {...result}
              onClick={() =>
                selectSearchResult({
                  onSearchStateChange,
                  rowId: activeSearchRow.id,
                  result,
                })
              }
            />
          ))
        : state.items.map(({ id, label, longitude, latitude }) => (
            <PointOfInterestMarker
              key={id}
              label={label}
              longitude={longitude}
              latitude={latitude}
            />
          )),
    ...(completedSearch
      ? {
          viewRequest: {
            id: `${searchState.viewRequestSourceId}:${completedSearch.requestId}`,
            points: completedSearch.results,
            paddingFraction: 0.1,
            maxZoom: 14,
          },
        }
      : {}),
  };
};

const pointsOfInterestLayer = ({
  searchState,
  onSearchStateChange,
}: {
  searchState: PointsOfInterestSearchState;
  onSearchStateChange: Dispatch<SetStateAction<PointsOfInterestSearchState>>;
}): LayerDefinition<PointsOfInterestState> => ({
  label: "Points of interest",
  contribution: (state) =>
    pointsOfInterestMapContribution({ state, searchState, onSearchStateChange }),
  renderControls: (props) => (
    <PointsOfInterestControls
      {...props}
      searchState={searchState}
      onSearchStateChange={onSearchStateChange}
    />
  ),
});

export { pointsOfInterestLayer, searchStateForItems };
