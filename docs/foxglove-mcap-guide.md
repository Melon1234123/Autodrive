# Foxglove + MCAP 实景演示指南

本项目会从 nuScenes mini 生成一个小体积 Foxglove 可播放文件：

```text
foxglove/autodrive_nuscenes_mini.mcap
```

## 生成

先生成前端和 Foxglove 共用的数据：

```bash
cd /path/to/Autodrive
backend/.venv/bin/python scripts/convert_nuscenes_rich.py \
  --dataroot "$HOME/Datasets/nuscenes-mini-5gb" \
  --fps 12 \
  --render-fps 24 \
  --max-frames 360
```

再导出 MCAP：

```bash
backend/.venv/bin/python scripts/export_foxglove_mcap.py
```

## Foxglove 中打开

1. 打开 Foxglove Studio。
2. Open local file，选择仓库内生成的 `foxglove/autodrive_nuscenes_mini.mcap`
3. 建议添加这些面板：
   - Image：选择 `/camera/front/compressed`
   - 3D：显示 `/autodrive/scene`、`/autodrive/map_grid`
   - Map：显示 `/autodrive/map`、`/gps/fix`
   - Raw Messages 或 Plot：查看 `/autodrive/telemetry`
   - Autodrive Diagnosis 自定义面板：订阅 `/autodrive/telemetry`，点击全域诊断调用本地后端

## Topic 列表

| Topic | Schema | 用途 |
|---|---|---|
| `/camera/front/compressed` | `foxglove.CompressedImage` | 真实 nuScenes CAM_FRONT 前视相机 |
| `/autodrive/telemetry` | JSON | 车速、刹车、油门、转向、加速度、场景描述 |
| `/autodrive/scene` | `foxglove.SceneUpdate` | 自车、3D 目标框、车道线、规划轨迹 |
| `/autodrive/map_grid` | `foxglove.Grid` | 3D 面板里的局部道路底图 |
| `/autodrive/map` | `foxglove.GeoJSON` | Map 面板轨迹 |
| `/gps/fix` | `foxglove.LocationFix` | Map 面板定位点 |

## 数据真实性边界

- 前视相机图片是真实 nuScenes mini。
- 3D 目标框来自 nuScenes keyframe 标注，并映射到当前 ego 坐标系。
- 车速、加速度、转向来自 ego pose 差分估算。
- 刹车、油门、车道线、规划轨迹是演示可视化估算，不是 nuScenes 原生 CAN/HD map 真值。
- 如果后续下载 CAN bus expansion 或完整地图，可把这些字段替换为真实源。
