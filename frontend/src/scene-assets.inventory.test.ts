import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface SceneManifestEntry {
  id: string;
  videoFile: string;
  telemetryFile: string;
  perceptionFile: string;
  metadataFile: string;
  lidarIndexFile: string;
}

interface SceneManifest {
  scenes: SceneManifestEntry[];
}

interface LidarIndex {
  frames: Array<{ file: string }>;
}

const publicRoot = process.env.SCENE_PUBLIC_ROOT
  ? resolve(process.env.SCENE_PUBLIC_ROOT)
  : fileURLToPath(new URL("../public/", import.meta.url));

function resolvePublicAsset(assetPath: string): string {
  return resolve(publicRoot, assetPath.replace(/^\/+/, ""));
}

describe("scene asset inventory", () => {
  it("ships every manifest asset and indexed LiDAR frame", () => {
    const manifestPath = resolve(publicRoot, "scenes.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SceneManifest;

    expect(manifest.scenes.length).toBeGreaterThan(0);

    for (const scene of manifest.scenes) {
      const manifestAssets = [
        scene.videoFile,
        scene.telemetryFile,
        scene.perceptionFile,
        scene.metadataFile,
        scene.lidarIndexFile,
      ];

      for (const assetPath of manifestAssets) {
        expect(existsSync(resolvePublicAsset(assetPath)), `${scene.id}: missing ${assetPath}`).toBe(true);
      }

      const lidarIndexPath = resolvePublicAsset(scene.lidarIndexFile);
      const lidarIndex = JSON.parse(readFileSync(lidarIndexPath, "utf8")) as LidarIndex;
      expect(lidarIndex.frames.length, `${scene.id}: empty LiDAR index`).toBeGreaterThan(0);

      for (const frame of lidarIndex.frames) {
        const framePath = resolve(dirname(lidarIndexPath), frame.file);
        expect(existsSync(framePath), `${scene.id}: missing LiDAR frame ${frame.file}`).toBe(true);
      }
    }
  });
});
