import ShowcaseArchiveDeck, { type ShowcaseArchiveItem } from "./ShowcaseArchiveDeck";
import "./TechnicalRouteSection.css";

const routeItems: ShowcaseArchiveItem[] = [
  {
    id: 1,
    title: "协议接入",
    meta: "PROTOCOL / INPUT",
    description: "通过算法结构描述协议接入传感器、轨迹、目标和环境上下文，降低对车企核心代码的侵入。",
  },
  {
    id: 2,
    title: "感知诊断",
    meta: "PERCEPTION / DIAGNOSE",
    description: "用几何原型空间量化类别混淆和语义漂移，定位“看错了什么”。",
  },
  {
    id: 3,
    title: "决策审计",
    meta: "DECISION / AUDIT",
    description: "用结构化思维链还原风险识别、意图预测与决策选择，定位“为什么这样做”。",
  },
  {
    id: 4,
    title: "RLHF 闭环",
    meta: "RLHF / IMPROVE",
    description: "把诊断 Agent 输出的失效逻辑反向生成正确/错误推理对，形成高价值训练数据包。",
  },
];

export default function TechnicalRouteSection() {
  return (
    <section className="pain-section route-section" data-terrain-preset="route" id="route">
      <div className="content-width">
        <div className="section-index">03 / TECHNICAL ROUTE</div>
        <div className="pain-header">
          <h2>把故障诊断拆成<br />四个<em>可审计</em>环节</h2>
          <p>技术路线不是简单展示结果，而是把数据如何进入、偏差如何量化、决策如何解释、修复数据如何生成全部结构化。</p>
        </div>
        <ShowcaseArchiveDeck ariaLabel="技术路线四个环节" className="route-archive-deck" items={routeItems} />
      </div>
    </section>
  );
}
