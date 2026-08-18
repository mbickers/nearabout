import { addProtocol } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import "./index.css";
import { App } from "./App";

// Must run before any map is constructed, or pmtiles:// sources fail to resolve.
addProtocol("pmtiles", new Protocol().tile);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
