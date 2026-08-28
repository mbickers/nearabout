import { useCallback, useEffect, useRef, useState } from "react";
import { Marker } from "react-map-gl/maplibre";
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
  layer,
  disabled,
  visibleMapBounds,
  entireSearchBounds,
  onChange,
  onMapContributionChange,
}: LayerComponentProps<LayerOfKind<"points_of_interest">>) => {
  const [viewRequestSourceId] = useState(() => crypto.randomUUID());
  const nextSearchRequestId = useRef(0);
  const lastEmittedItems = useRef<string>(undefined);
  const onChangeRef = useRef(onChange);
  const onMapContributionChangeRef = useRef(onMapContributionChange);
  const visibleMapBoundsRef = useRef(visibleMapBounds);
  onChangeRef.current = onChange;
  onMapContributionChangeRef.current = onMapContributionChange;
  visibleMapBoundsRef.current = visibleMapBounds;
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
      onMapContributionChangeRef.current(undefined);
      return;
    }

    const activeSearchRow = rows.find(({ search }) => locationSearchResults(search.state));
    const results = activeSearchRow && locationSearchResults(activeSearchRow.search.state);
    const completedSearch = rows
      .map(({ search }) => completedEntireCitySearch(search.state))
      .filter((search): search is NonNullable<typeof search> => search !== undefined)
      .sort((first, second) => second.requestId - first.requestId)[0];
    if (!activeSearchRow && !completedSearch) {
      onMapContributionChangeRef.current(undefined);
      return;
    }

    onMapContributionChangeRef.current({
      ...(activeSearchRow && results
        ? {
            markerElements: results.map((result) => (
              <PointOfInterestMarker
                key={`${activeSearchRow.id}:${result.latitude},${result.longitude}:${result.label}`}
                {...result}
                onClick={() => selectSearchResult(activeSearchRow.id, result)}
              />
            )),
          }
        : {}),
      ...(completedSearch
        ? {
            viewRequest: {
              id: `${viewRequestSourceId}:${completedSearch.requestId}`,
              points: completedSearch.results,
              paddingFraction: 0.1,
              maxZoom: 14,
            },
          }
        : {}),
    });
  }, [rows, disabled, selectSearchResult, viewRequestSourceId]);

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
  mapContribution: ({ items }) => ({
    sources: {},
    physicalLayers: [],
    markerElements: items.map(({ id, label, longitude, latitude }) => (
      <PointOfInterestMarker key={id} label={label} longitude={longitude} latitude={latitude} />
    )),
  }),
  Controls: PointsOfInterestControls,
};
