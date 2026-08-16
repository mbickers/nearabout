import { useCallback, useEffect, useRef, useState } from "react";
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
  status: "idle" | "searching" | "not_found" | "error";
};

const emptyPointOfInterestRow = (): PointOfInterestRow => ({
  id: crypto.randomUUID(),
  address: "",
  label: "",
  searchResults: [],
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
  onChange,
  onMarkerPreviewChange,
}: LayerComponentProps<LayerOfKind<"points_of_interest">>) => {
  const selectFirstResultOnCompletion = useRef(new Set<string>());
  const onChangeRef = useRef(onChange);
  const onMarkerPreviewChangeRef = useRef(onMarkerPreviewChange);
  onChangeRef.current = onChange;
  onMarkerPreviewChangeRef.current = onMarkerPreviewChange;
  const [rows, setRows] = useState<PointOfInterestRow[]>(() =>
    normalizePointOfInterestRows(
      layer.items.map((item) => ({ ...item, searchResults: [], status: "idle" as const })),
    ),
  );

  const selectSearchResult = useCallback(
    (rowId: string, result: NominatimSearchResult) =>
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
      ),
    [],
  );

  useEffect(() => {
    onChangeRef.current({
      kind: "points_of_interest",
      items: rows.flatMap(({ status: _, searchResults: __, longitude, latitude, ...row }) =>
        row.address.trim() && longitude !== undefined && latitude !== undefined
          ? [{ ...row, label: row.label.trim() || row.address.trim(), longitude, latitude }]
          : [],
      ),
    });
  }, [rows]);

  useEffect(() => {
    if (disabled) {
      onMarkerPreviewChangeRef.current(undefined);
      return;
    }

    const activeSearchRow =
      rows.find(({ searchResults }) => searchResults.length > 0) ??
      rows.find(({ status }) => status === "searching");
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

      setRows((currentRows) =>
        currentRows.map((currentRow) =>
          currentRow.id === row.id
            ? { ...currentRow, searchResults: [], status: "searching" }
            : currentRow,
        ),
      );

      try {
        const parameters = new URLSearchParams({
          q: row.address,
          format: "jsonv2",
          limit: "20",
          layer: "address",
          countrycodes: "us",
          viewbox: "-74.25909,40.91758,-73.70018,40.4774",
          bounded: "1",
        });
        const response = await fetch(`https://nominatim.openstreetmap.org/search?${parameters}`);
        if (!response.ok) throw new Error(`Geocoder returned ${response.status}`);

        const results = (await response.json()) as NominatimSearchResult[];
        const shouldSelectFirstResult =
          selectFirstResult || selectFirstResultOnCompletion.current.delete(row.id);
        setRows((currentRows) =>
          currentRows.map((currentRow) => {
            if (currentRow.id !== row.id || currentRow.address !== row.address) return currentRow;
            if (results.length === 0) {
              return { ...currentRow, searchResults: [], status: "not_found" };
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
        setRows((currentRows) =>
          currentRows.map((currentRow) =>
            currentRow.id === row.id && currentRow.address === row.address
              ? { ...currentRow, searchResults: [], status: "error" }
              : currentRow,
          ),
        );
      }
    },
    [selectSearchResult],
  );

  useEffect(() => {
    const rowToSearch = rows.find(
      ({ address, longitude, status, searchResults }) =>
        address.trim().length >= 3 &&
        longitude === undefined &&
        status === "idle" &&
        searchResults.length === 0,
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
                onChange={({ target }) =>
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
                              status: "idle",
                            }
                          : currentRow,
                      ),
                      row.id,
                    ),
                  )
                }
                onBlur={() => void searchRow(row, true)}
                style={{ boxSizing: "border-box", minWidth: 0, width: "100%", font: "inherit" }}
              />
              <input
                aria-label="Point of interest label"
                type="text"
                placeholder="Label"
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
            {row.status === "searching" ? <span role="status">Searching…</span> : null}
            {row.status === "not_found" ? <span role="status">Address not found.</span> : null}
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
