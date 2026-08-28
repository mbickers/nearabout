import { useCallback, useEffect, useRef, useState } from "react";
import { searchNominatim } from "./nominatim";
import {
  completedEntireCitySearch,
  type LocationSearchEvent,
  type LocationSearchResult,
  type LocationSearchScope,
  locationSearchResults,
  type PointOfInterestSearch,
  selectedLocationSearchResult,
  transitionLocationSearch,
} from "./point_of_interest_search";
import type { LayerComponentProps, LayerDefinition, LayerOfKind } from "./shared";

type PointOfInterestRow = {
  id: string;
  label: string;
  search: PointOfInterestSearch;
};

const emptyPointOfInterestRow = (): PointOfInterestRow => ({
  id: crypto.randomUUID(),
  label: "",
  search: { query: "", state: { status: "idle" } },
});

const normalizePointOfInterestRows = (rows: PointOfInterestRow[], editedRowId?: string) => {
  const nonemptyRows = rows.filter(({ label, search }) => search.query.trim() || label.trim());
  const emptyRow =
    rows.find(
      ({ id, label, search }) => id === editedRowId && !search.query.trim() && !label.trim(),
    ) ??
    rows.find(({ label, search }) => !search.query.trim() && !label.trim()) ??
    emptyPointOfInterestRow();
  return [...nonemptyRows, emptyRow];
};

const PointsOfInterestControls = ({
  layer,
  disabled,
  visibleMapBounds,
  entireSearchBounds,
  onChange,
  onMarkerPreviewChange,
  fitMapToPoints,
}: LayerComponentProps<LayerOfKind<"points_of_interest">>) => {
  const nextSearchRequestId = useRef(0);
  const lastFittedSearchRequestId = useRef<number>(undefined);
  const lastEmittedItems = useRef<string>(undefined);
  const onChangeRef = useRef(onChange);
  const onMarkerPreviewChangeRef = useRef(onMarkerPreviewChange);
  const visibleMapBoundsRef = useRef(visibleMapBounds);
  const fitMapToPointsRef = useRef(fitMapToPoints);
  onChangeRef.current = onChange;
  onMarkerPreviewChangeRef.current = onMarkerPreviewChange;
  visibleMapBoundsRef.current = visibleMapBounds;
  fitMapToPointsRef.current = fitMapToPoints;
  const [rows, setRows] = useState<PointOfInterestRow[]>(() =>
    normalizePointOfInterestRows(
      layer.items.map((item) => ({
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
  );

  const transitionRowSearch = useCallback(
    (rowId: string, event: LocationSearchEvent) =>
      setRows((currentRows) =>
        currentRows.map((currentRow) =>
          currentRow.id === rowId
            ? {
                ...currentRow,
                search: transitionLocationSearch(currentRow.search, event),
              }
            : currentRow,
        ),
      ),
    [],
  );

  const selectSearchResult = useCallback(
    (rowId: string, result: LocationSearchResult) => {
      transitionRowSearch(rowId, { type: "result_selected", result });
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    },
    [transitionRowSearch],
  );

  useEffect(() => {
    const items = rows.flatMap(({ id, label, search }) => {
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
    const serializedItems = JSON.stringify(items);
    if (serializedItems === lastEmittedItems.current) return;

    lastEmittedItems.current = serializedItems;
    onChangeRef.current({ kind: "points_of_interest", items });
  }, [rows]);

  useEffect(() => {
    if (disabled) {
      onMarkerPreviewChangeRef.current(undefined);
      return;
    }

    const activeSearchRow = rows.find(({ search }) => locationSearchResults(search.state));
    const results = activeSearchRow && locationSearchResults(activeSearchRow.search.state);
    onMarkerPreviewChangeRef.current(
      activeSearchRow && results
        ? results.map((result, resultIndex) => ({
            id: `${activeSearchRow.id}:${result.latitude},${result.longitude}:${resultIndex}`,
            label: result.label,
            longitude: result.longitude,
            latitude: result.latitude,
            onClick: () => selectSearchResult(activeSearchRow.id, result),
          }))
        : undefined,
    );
  }, [rows, disabled, selectSearchResult]);

  const runLocationSearch = useCallback(
    async (rowId: string, query: string, scope: LocationSearchScope, requestId: number) => {
      const visibleBounds = visibleMapBoundsRef.current;
      const bounds = scope === "entire_city" ? entireSearchBounds : visibleBounds;
      if (!bounds) return;

      try {
        const results = await searchNominatim({ query, bounds });
        transitionRowSearch(rowId, { type: "search_succeeded", requestId, results });
      } catch {
        transitionRowSearch(rowId, { type: "search_failed", requestId });
      }
    },
    [entireSearchBounds, transitionRowSearch],
  );

  useEffect(() => {
    if (!visibleMapBounds) return;

    setRows((currentRows) =>
      currentRows.map((currentRow) => ({
        ...currentRow,
        search: transitionLocationSearch(currentRow.search, { type: "map_moved" }),
      })),
    );
  }, [visibleMapBounds]);

  useEffect(() => {
    const rowToSearch = rows.find(
      ({ search }) =>
        search.state.status === "queued" &&
        (search.state.scope === "entire_city" || visibleMapBounds),
    );
    if (rowToSearch?.search.state.status !== "queued") return;

    const { query } = rowToSearch.search;
    const { scope } = rowToSearch.search.state;
    const timeout = window.setTimeout(() => {
      const requestId = ++nextSearchRequestId.current;
      transitionRowSearch(rowToSearch.id, { type: "search_started", requestId });
      void runLocationSearch(rowToSearch.id, query, scope, requestId);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [rows, visibleMapBounds, runLocationSearch, transitionRowSearch]);

  useEffect(() => {
    const completedSearch = rows
      .map(({ search }) => completedEntireCitySearch(search.state))
      .filter((search): search is NonNullable<typeof search> => search !== undefined)
      .sort((first, second) => second.requestId - first.requestId)[0];
    if (!completedSearch || completedSearch.requestId <= (lastFittedSearchRequestId.current ?? 0)) {
      return;
    }

    lastFittedSearchRequestId.current = completedSearch.requestId;
    fitMapToPointsRef.current({
      points: completedSearch.results,
      paddingFraction: 0.1,
      maxZoom: 14,
    });
  }, [rows]);

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
                  disabled={disabled}
                  onChange={({ target }) =>
                    setRows((currentRows) =>
                      normalizePointOfInterestRows(
                        currentRows.map((currentRow) =>
                          currentRow.id === row.id
                            ? {
                                ...currentRow,
                                search: transitionLocationSearch(currentRow.search, {
                                  type: "query_changed",
                                  query: target.value,
                                }),
                              }
                            : currentRow,
                        ),
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
                  disabled={disabled}
                  onChange={({ target }) =>
                    setRows((currentRows) =>
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
                  disabled={disabled}
                  onClick={() =>
                    setRows((currentRows) =>
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
                    cursor: disabled ? "default" : "pointer",
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
                    disabled={disabled}
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

export const pointsOfInterestDefinition: LayerDefinition<LayerOfKind<"points_of_interest">> = {
  label: "Points of interest",
  mapStyleFragment: ({ items }) => ({ sources: {}, physicalLayers: [], markers: items }),
  Controls: PointsOfInterestControls,
};
