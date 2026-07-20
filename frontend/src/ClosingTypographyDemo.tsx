import { useState } from "react";
import "./ClosingTypographyDemo.css";

const typeVariants = [
  {
    id: "precision",
    code: "A",
    name: "精密黑体",
    note: "工程取向 · 结构最稳",
  },
  {
    id: "evidence",
    code: "B",
    name: "证据宋体",
    note: "研究结论 · 推荐",
  },
  {
    id: "verdict",
    code: "C",
    name: "裁决混排",
    note: "传统判断 · 技术落点",
  },
] as const;

type TypeVariantId = (typeof typeVariants)[number]["id"];

export default function ClosingTypographyDemo() {
  const [selectedId, setSelectedId] = useState<TypeVariantId>("evidence");
  const selected = typeVariants.find((variant) => variant.id === selectedId) ?? typeVariants[1];

  return (
    <main className="closing-type-demo">
      <section
        className={`closing-type-demo__stage closing-type-demo__stage--${selected.id}`}
        aria-label={`终页字体方案：${selected.code} · ${selected.name}`}
      >
        <div className="closing-type-demo__wash" aria-hidden="true" />
        <div className="closing-type-demo__statement closing-type-demo__statement--primary" aria-label="安全不是一句承诺">
          <span>安全</span>
          <strong>不是</strong>
          <span>一句承诺</span>
        </div>
        <div className="closing-type-demo__statement closing-type-demo__statement--secondary" aria-label="它应当被证明">
          <span>它应当被</span>
          <strong>证明</strong>
        </div>
        <aside className="closing-type-demo__controls" aria-label="终页字体选择">
          <div className="closing-type-demo__controls-head">
            <p>终页字体 / TYPE STUDY</p>
            <a href="/">返回页面</a>
          </div>
          <div className="closing-type-demo__choices" role="group" aria-label="选择字体方案">
            {typeVariants.map((variant) => (
              <button
                className={variant.id === selected.id ? "is-active" : undefined}
                type="button"
                key={variant.id}
                aria-label={`选择 ${variant.code} · ${variant.name}`}
                aria-pressed={variant.id === selected.id}
                onClick={() => setSelectedId(variant.id)}
              >
                <b>{variant.code}</b>
                <span>{variant.name}</span>
                <small>{variant.note}</small>
              </button>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}
