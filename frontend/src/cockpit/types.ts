export type CockpitScreen = "entry" | "live" | "diagnosis" | "report";

export type VideoGeometry = {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: number;
};

export type SceneManifestEntry = {
  id: string;
  label: string;
  description?: string;
  videoFile: string;
  telemetryFile: string;
  perceptionFile: string;
  metadataFile?: string;
  lidarIndexFile?: string;
  riskEventsFile?: string;
};
