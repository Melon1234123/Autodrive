import type { ExtensionContext } from "@foxglove/extension";

import { initPanel } from "./Panel";

export function activate(extensionContext: ExtensionContext): void {
  extensionContext.registerPanel({ name: "Autodrive Diagnosis", initPanel });
}
