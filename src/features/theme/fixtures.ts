// Omarchy themes for tests, screenshots and the mock core (job 020). The first four are the core's
// reading of the committed files in src-tauri/testdata/omarchy/ (a Rust test checks that); `junk`
// stands for a core that would pass anything on, so the UI's own checks can be tested.
import catppuccinLatte from "./fixtures/catppuccin-latte.json" with { type: "json" };
import fwuDark from "./fixtures/fwu-dark.json" with { type: "json" };
import junk from "./fixtures/junk.json" with { type: "json" };
import lowContrast from "./fixtures/low-contrast.json" with { type: "json" };
import tokyoNight from "./fixtures/tokyo-night.json" with { type: "json" };
import type { OmarchyTheme } from "./omarchy";

export const OMARCHY_FIXTURES = {
  "tokyo-night": tokyoNight as OmarchyTheme,
  "catppuccin-latte": catppuccinLatte as OmarchyTheme,
  "fwu-dark": fwuDark as OmarchyTheme,
  "low-contrast": lowContrast as OmarchyTheme,
  junk: junk as unknown as OmarchyTheme,
} satisfies Record<string, OmarchyTheme>;

export type OmarchyFixture = keyof typeof OMARCHY_FIXTURES;
