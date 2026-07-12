import PositioningOrbit from "./PositioningOrbit";
import "./PositioningSection.css";

export default function PositioningSection() {
  return (
    <section className="intro-section positioning-section" data-motion-section data-terrain-preset="positioning" id="origin">
      <PositioningOrbit />
    </section>
  );
}
