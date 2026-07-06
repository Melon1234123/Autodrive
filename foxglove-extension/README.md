# Autodrive Foxglove Panel

Local Foxglove panel for the Autodrive nuScenes mini demo.

The panel subscribes to `/autodrive/telemetry`, displays vehicle state, and sends the current frame to `ws://localhost:8080/ws` for AI or fallback rule diagnosis.

Use with `../dakai` so the FastAPI backend is running before clicking `全域诊断`.
