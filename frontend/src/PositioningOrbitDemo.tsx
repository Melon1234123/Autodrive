import PositioningOrbit from "./PositioningOrbit";

export default function PositioningOrbitDemo() {
  return (
    <main className="positioning-orbit-demo">
      <header className="positioning-orbit-demo-header">
        <span className="positioning-orbit-demo-brand"><i /> 智驾卫士</span>
        <span className="positioning-orbit-demo-index">01 / 项目定位 · 交互预览</span>
        <a href="/" className="positioning-orbit-demo-back">返回页面</a>
      </header>

      <PositioningOrbit standalone />
    </main>
  );
}
