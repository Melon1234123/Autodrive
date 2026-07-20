import { lazy, Suspense } from "react";
import type { LidarBevProps } from "./LidarBev";

export const preloadLidarBev = () => import("./LidarBev");

const LidarBev = lazy(() => preloadLidarBev().then(({ LidarBev: Component }) => ({ default: Component })));

export function LazyLidarBev(props: LidarBevProps) {
  return (
    <Suspense fallback={<div className="lidar-bev-state lidar-bev-overlay" data-testid="lidar-bev-loading">正在加载 LiDAR 渲染器</div>}>
      <LidarBev {...props} />
    </Suspense>
  );
}
