import "./showcase-motion.css";

export default function ShowcaseOpening() {
  return (
    <div aria-hidden="true" className="showcase-opening" data-motion-opening hidden>
      <div className="showcase-opening-panels">
        <span data-motion-opening-panel />
        <span data-motion-opening-panel />
        <span data-motion-opening-panel />
      </div>
    </div>
  );
}
