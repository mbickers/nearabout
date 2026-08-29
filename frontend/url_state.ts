import { useEffect, useRef, useState } from "react";
import { type LayerStates, layerStatesSchema, type MapState } from "./map_state";

const parseLayers = (value: string | null): LayerStates | undefined => {
  if (!value) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(value), (character) => character.charCodeAt(0)),
      ),
    );
  } catch {
    return;
  }

  const result = layerStatesSchema.safeParse(parsed);
  return result.success ? result.data : undefined;
};

export const readUrlState = (url: URL, defaults: MapState): MapState => {
  const center = url.searchParams.get("center")?.split(",").map(Number);
  const zoomParameter = url.searchParams.get("zoom");
  const zoom = zoomParameter === null ? Number.NaN : Number(zoomParameter);
  const view =
    center?.length === 2 && center.every(Number.isFinite) && Number.isFinite(zoom)
      ? { longitude: center[0], latitude: center[1], zoom }
      : defaults.view;

  return { view, layers: parseLayers(url.searchParams.get("layers")) ?? defaults.layers };
};

export const urlWithState = (url: URL, state: MapState) => {
  const { view, layers } = state;
  const nextUrl = new URL(url);
  nextUrl.searchParams.set("center", `${view.longitude.toFixed(5)},${view.latitude.toFixed(5)}`);
  nextUrl.searchParams.set("zoom", view.zoom.toFixed(2));
  nextUrl.searchParams.set(
    "layers",
    btoa(
      Array.from(new TextEncoder().encode(JSON.stringify(layers)), (byte) =>
        String.fromCharCode(byte),
      ).join(""),
    ),
  );
  return nextUrl;
};

export const useUrlState = (initialState: MapState) => {
  const defaults = useRef(initialState).current;
  const [state, setState] = useState(() => readUrlState(new URL(window.location.href), defaults));

  useEffect(() => {
    window.history.replaceState(null, "", urlWithState(new URL(window.location.href), state));
  }, [state]);

  useEffect(() => {
    const readState = () => setState(readUrlState(new URL(window.location.href), defaults));
    window.addEventListener("popstate", readState);
    return () => window.removeEventListener("popstate", readState);
  }, [defaults]);

  return [state, setState] as const;
};
