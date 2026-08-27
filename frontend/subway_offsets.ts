export type Position = [longitude: number, latitude: number];

type SubwayTrackGraphEdge = {
  geometry: Position[];
  trunks: string[];
};

type SubwayTrackGraphVertex = {
  position: Position;
  edge_ids: number[];
};

export type SubwayTrackGraphData = {
  edges_by_id: Record<string, SubwayTrackGraphEdge>;
  vertices: SubwayTrackGraphVertex[];
};

type GraphProperties = {
  kind: "edge" | "vertex";
  label: string;
  trunks?: string[];
  edge_id?: number;
  edge_ids?: number[];
};

export type SubwayTrackGraph = {
  type: "FeatureCollection";
  features: (
    | {
        type: "Feature";
        geometry: { type: "LineString"; coordinates: Position[] };
        properties: GraphProperties;
      }
    | {
        type: "Feature";
        geometry: { type: "Point"; coordinates: Position };
        properties: GraphProperties;
      }
  )[];
};

export const loadSubwayTrackGraph = async (): Promise<SubwayTrackGraphData> => {
  const response = await fetch("/data/subway_track_graph.json");
  if (!response.ok) throw new Error(`Unable to load subway track graph: ${response.status}`);
  return response.json() as Promise<SubwayTrackGraphData>;
};

export const buildSubwayTrackGraph = (graph: SubwayTrackGraphData): SubwayTrackGraph => ({
  type: "FeatureCollection",
  features: [
    ...Object.entries(graph.edges_by_id).map(([edgeIdString, edge]) => {
      const edgeId = Number(edgeIdString);
      return {
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates: edge.geometry },
        properties: {
          kind: "edge" as const,
          trunks: edge.trunks,
          edge_id: edgeId,
          label: `${edgeId}: ${edge.trunks.join(", ")}`,
        },
      };
    }),
    ...graph.vertices.map((vertex) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: vertex.position },
      properties: {
        kind: "vertex" as const,
        edge_ids: vertex.edge_ids,
        label: vertex.edge_ids.join(", "),
      },
    })),
  ],
});
