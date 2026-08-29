import { useEffect, useRef, useState } from "react";
import { type MapState, mapStateSchema } from "./map_state";

const readState = (storedState: string | null, defaults: MapState): MapState => {
  if (!storedState) return defaults;

  let parsed: unknown;
  try {
    parsed = JSON.parse(storedState);
  } catch {
    return defaults;
  }

  const result = mapStateSchema.safeParse(parsed);
  return result.success ? result.data : defaults;
};

export const useLocalStorageState = (initialState: MapState) => {
  const defaults = useRef(initialState).current;
  const [state, setState] = useState(() => readState(localStorage.getItem("mapState"), defaults));

  useEffect(() => {
    localStorage.setItem("mapState", JSON.stringify(state));
  }, [state]);

  return [state, setState] as const;
};
