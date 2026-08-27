import { useCallback, useEffect, useRef, useState } from "react";
import { NYC_BOUNDS } from "../map_bounds";
import type { LayerComponentProps, LayerDefinition, LayerOfKind } from "./shared";

type NominatimSearchResult = {
  display_name: string;
  lat: string;
  lon: string;
};

type PointOfInterestRow = {
  id: string;
  address: string;
  label: string;
  longitude?: number;
  latitude?: number;
  searchResults: NominatimSearchResult[];
  searchScope: "visible_map" | "entire_city";
  status: "idle" | "pending" | "searching" | "not_found" | "error";
};

const emptyPointOfInterestRow = (): PointOfInterestRow => ({
  id: crypto.randomUUID(),
  address: "",
  label: "",
  searchResults: [],
  searchScope: "visible_map",
  status: "idle",
});

const normalizePointOfInterestRows = (rows: PointOfInterestRow[], editedRowId?: string) => {
  const nonemptyRows = rows.filter(({ address, label }) => address.trim() || label.trim());
  const emptyRow =
    rows.find(({ id, address, label }) => id === editedRowId && !address.trim() && !label.trim()) ??
    rows.find(({ address, label }) => !address.trim() && !label.trim()) ??
    emptyPointOfInterestRow();
  return [...nonemptyRows, emptyRow];
};

const PointsOfInterestControls = ({
  layer,
  disabled,
  visibleMapBounds,
  onChange,
  onMarkerPreviewChange,
  fitMapToPoints,
}: LayerComponentProps<LayerOfKind<"points_of_interest">>) => {
  const selectFirstResultOnCompletion = useRef(new Set<string>());
  const pendingSearches = useRef(new Map<string, symbol>());
  const suppressAddressSearchOnBlur = useRef(false);
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
        ...item,
        searchResults: [],
        searchScope: "visible_map" as const,
        status: "idle" as const,
      })),
    ),
  );

  const selectSearchResult = useCallback((rowId: string, result: NominatimSearchResult) => {
    pendingSearches.current.delete(rowId);
    suppressAddressSearchOnBlur.current = true;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    suppressAddressSearchOnBlur.current = false;
    setRows((currentRows) =>
      currentRows.map((currentRow) =>
        currentRow.id === rowId
          ? {
              ...currentRow,
              longitude: Number(result.lon),
              latitude: Number(result.lat),
              searchResults: [],
              status: "idle",
            }
          : currentRow,
      ),
    );
  }, []);

  useEffect(() => {
    const items = rows.flatMap(
      ({ status: _, searchResults: __, searchScope: ___, longitude, latitude, ...row }) =>
        row.address.trim() && longitude !== undefined && latitude !== undefined
          ? [{ ...row, label: row.label.trim() || row.address.trim(), longitude, latitude }]
          : [],
    );
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

    const activeSearchRow = rows.find(({ searchResults }) => searchResults.length > 0);
    onMarkerPreviewChangeRef.current(
      activeSearchRow
        ? activeSearchRow.searchResults.map((result, resultIndex) => ({
            id: `${activeSearchRow.id}:${result.lat},${result.lon}:${resultIndex}`,
            label: result.display_name,
            longitude: Number(result.lon),
            latitude: Number(result.lat),
            onClick: () => selectSearchResult(activeSearchRow.id, result),
          }))
        : undefined,
    );
  }, [rows, disabled, selectSearchResult]);

  const searchRow = useCallback(
    async (row: PointOfInterestRow, selectFirstResult = false) => {
      if (!row.address.trim()) return;
      if (
        selectFirstResult &&
        row.longitude !== undefined &&
        row.latitude !== undefined &&
        row.searchResults.length === 0
      ) {
        return;
      }
      if (selectFirstResult && row.searchResults.length > 0) {
        selectSearchResult(row.id, row.searchResults[0]);
        return;
      }
      if (row.status === "searching") {
        if (selectFirstResult) selectFirstResultOnCompletion.current.add(row.id);
        return;
      }

      const searchBounds = visibleMapBoundsRef.current;
      if (!searchBounds) return;

      const pendingSearch = Symbol();
      pendingSearches.current.set(row.id, pendingSearch);

      setRows((currentRows) =>
        currentRows.map((currentRow) =>
          currentRow.id === row.id ? { ...currentRow, status: "searching" } : currentRow,
        ),
      );

      try {
        const parameters = new URLSearchParams({
          q: row.address,
          format: "jsonv2",
          limit: "20",
          layer: "address,poi",
          countrycodes: "us",
          viewbox:
            row.searchScope === "entire_city"
              ? [NYC_BOUNDS.west, NYC_BOUNDS.north, NYC_BOUNDS.east, NYC_BOUNDS.south].join(",")
              : [
                  searchBounds.getWest(),
                  searchBounds.getNorth(),
                  searchBounds.getEast(),
                  searchBounds.getSouth(),
                ].join(","),
          bounded: "1",
        });
        const response = await fetch(`https://nominatim.openstreetmap.org/search?${parameters}`);
        if (!response.ok) throw new Error(`Geocoder returned ${response.status}`);

        const results = (await response.json()) as NominatimSearchResult[];
        if (pendingSearches.current.get(row.id) !== pendingSearch) return;
        pendingSearches.current.delete(row.id);
        if (row.searchScope === "entire_city" && results.length > 0) {
          fitMapToPointsRef.current({
            points: results.map(({ lon, lat }) => ({
              longitude: Number(lon),
              latitude: Number(lat),
            })),
            paddingFraction: 0.1,
            maxZoom: 14,
          });
        }
        const shouldSelectFirstResult =
          selectFirstResult || selectFirstResultOnCompletion.current.delete(row.id);
        setRows((currentRows) =>
          currentRows.map((currentRow) => {
            if (
              currentRow.id !== row.id ||
              currentRow.address !== row.address ||
              currentRow.searchScope !== row.searchScope ||
              currentRow.status !== "searching"
            ) {
              return currentRow;
            }
            if (results.length === 0) {
              return {
                ...currentRow,
                longitude: undefined,
                latitude: undefined,
                searchResults: [],
                status: "not_found",
              };
            }
            if (!shouldSelectFirstResult) {
              return {
                ...currentRow,
                longitude: undefined,
                latitude: undefined,
                searchResults: results,
                status: "idle",
              };
            }

            const [result] = results;

            return {
              ...currentRow,
              longitude: Number(result.lon),
              latitude: Number(result.lat),
              searchResults: [],
              status: "idle",
            };
          }),
        );
      } catch {
        if (pendingSearches.current.get(row.id) !== pendingSearch) return;
        pendingSearches.current.delete(row.id);
        setRows((currentRows) =>
          currentRows.map((currentRow) =>
            currentRow.id === row.id &&
            currentRow.address === row.address &&
            currentRow.searchScope === row.searchScope
              ? { ...currentRow, status: "error" }
              : currentRow,
          ),
        );
      }
    },
    [selectSearchResult],
  );

  useEffect(() => {
    if (!visibleMapBounds) return;

    pendingSearches.current.clear();
    selectFirstResultOnCompletion.current.clear();
    setRows((currentRows) => {
      const rowsToResearch = currentRows.filter(
        ({ address, longitude }) => longitude === undefined && address.trim().length >= 3,
      );
      if (rowsToResearch.length === 0) return currentRows;

      return currentRows.map((currentRow) =>
        rowsToResearch.includes(currentRow)
          ? {
              ...currentRow,
              searchScope: "visible_map" as const,
              status: "pending" as const,
            }
          : currentRow,
      );
    });
  }, [visibleMapBounds]);

  useEffect(() => {
    const rowToSearch = rows.find(
      ({ address, longitude, status, searchResults }) =>
        address.trim().length >= 3 &&
        (status === "pending" ||
          (longitude === undefined && status === "idle" && searchResults.length === 0)),
    );
    if (!rowToSearch) return;

    const timeout = window.setTimeout(() => void searchRow(rowToSearch), 300);
    return () => window.clearTimeout(timeout);
  }, [rows, searchRow]);

  return (
    <div style={{ display: "grid", gap: 6, width: 260 }}>
      <div style={{ display: "grid", gap: 4 }}>
        {rows.map((row) => (
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
                void searchRow(row);
              }}
            >
              <input
                aria-label="Point of interest address"
                type="text"
                placeholder="Address"
                value={row.address}
                disabled={disabled}
                onChange={({ target }) => {
                  pendingSearches.current.delete(row.id);
                  selectFirstResultOnCompletion.current.delete(row.id);
                  setRows((currentRows) =>
                    normalizePointOfInterestRows(
                      currentRows.map((currentRow) =>
                        currentRow.id === row.id
                          ? {
                              ...currentRow,
                              address: target.value,
                              longitude: undefined,
                              latitude: undefined,
                              searchResults: [],
                              searchScope: "visible_map",
                              status: "idle",
                            }
                          : currentRow,
                      ),
                      row.id,
                    ),
                  );
                }}
                onBlur={() => {
                  if (!suppressAddressSearchOnBlur.current) void searchRow(row, true);
                }}
                style={{ boxSizing: "border-box", minWidth: 0, width: "100%", font: "inherit" }}
              />
              <input
                aria-label="Point of interest label"
                type="text"
                placeholder={row.address || "Label"}
                value={row.label}
                disabled={disabled}
                onChange={({ target }) =>
                  setRows((currentRows) =>
                    normalizePointOfInterestRows(
                      currentRows.map((currentRow) =>
                        currentRow.id === row.id
                          ? { ...currentRow, label: target.value, status: "idle" }
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
                aria-label={`Delete ${row.label || row.address || "empty point of interest"}`}
                title="Delete"
                disabled={disabled}
                onClick={() => {
                  pendingSearches.current.delete(row.id);
                  selectFirstResultOnCompletion.current.delete(row.id);
                  setRows((currentRows) =>
                    normalizePointOfInterestRows(currentRows.filter(({ id }) => id !== row.id)),
                  );
                }}
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
            {row.status === "searching" ? <span role="status">Searching…</span> : null}
            {row.status === "not_found" && row.searchScope === "visible_map" ? (
              <span role="status">
                Nothing found on the visible map.{" "}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    pendingSearches.current.delete(row.id);
                    selectFirstResultOnCompletion.current.delete(row.id);
                    setRows((currentRows) =>
                      currentRows.map((currentRow) =>
                        currentRow.id === row.id
                          ? {
                              ...currentRow,
                              searchResults: [],
                              searchScope: "entire_city",
                              status: "idle",
                            }
                          : currentRow,
                      ),
                    );
                  }}
                  style={{ font: "inherit" }}
                >
                  Search entire city
                </button>
              </span>
            ) : null}
            {row.status === "not_found" && row.searchScope === "entire_city" ? (
              <span role="status">Nothing found in the city.</span>
            ) : null}
            {row.status === "error" ? (
              <span role="status">Address search failed. Try again.</span>
            ) : null}
            {row.searchResults.length > 0 ? (
              <span role="status">Select a result on the map.</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
};

export const pointsOfInterestDefinition: LayerDefinition<LayerOfKind<"points_of_interest">> = {
  label: "Points of interest",
  mapStyleFragment: ({ items }) => ({ sources: {}, physicalLayers: [], markers: items }),
  Controls: PointsOfInterestControls,
};
