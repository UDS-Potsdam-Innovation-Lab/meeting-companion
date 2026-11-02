// Runs before the first paint (a classic script in <head>, allowed by the CSP as 'self'): sets the
// cached theme on <html> so a dark window never flashes light. The app keeps the attribute in step
// with the settings afterwards (src/features/settings/theme.ts). Same keys and values as there.
// With "System" and a cached Omarchy token map (job 020, src/features/theme/apply.ts), it also sets
// those tokens, so an Omarchy window does not flash the app's own colours. Only the token names below
// and hex colours are taken from the cache; every other entry is ignored.
(function () {
  var TOKENS = [
    "--bg",
    "--surface",
    "--sunken",
    "--ink",
    "--ink-2",
    "--muted",
    "--line",
    "--line-strong",
    "--accent",
    "--accent-soft",
    "--accent-ink",
    "--teal-ink",
    "--teal-soft",
    "--amber-ink",
    "--amber-soft",
    "--overrun",
    "--overrun-soft",
    "--green",
    "--green-soft",
    "--green-ink",
    "--dark",
    "--dark-3",
    "--dark-ink",
    "--dark-muted",
    "--dark-accent",
    "--dark-amber",
    "--dark-overrun",
    "--on-accent",
    "--on-ink",
    "--on-avatar",
    "--dark-strong",
    "--dark-3-hover",
    "--disabled-ink",
    "--overrun-ink",
    "--hover-tint",
    "--warn-ink",
    "--warn-soft",
    "--warn-line",
  ];
  var HEX = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/;
  var root = document.documentElement;
  var setting = "system";
  var omarchy = null;
  try {
    var cached = localStorage.getItem("meeting-companion.theme");
    if (cached === "light" || cached === "dark" || cached === "system") setting = cached;
    if (setting === "system") {
      var raw = localStorage.getItem("meeting-companion.omarchy");
      var parsed = raw ? JSON.parse(raw) : null;
      if (
        parsed &&
        (parsed.mode === "light" || parsed.mode === "dark") &&
        typeof parsed.tokens === "object" &&
        parsed.tokens !== null
      )
        omarchy = parsed;
    }
  } catch {
    // No storage or a broken cache: follow the system.
  }
  if (omarchy) {
    var applied = 0;
    for (var i = 0; i < TOKENS.length; i++) {
      var name = TOKENS[i];
      var value = Object.prototype.hasOwnProperty.call(omarchy.tokens, name) ? omarchy.tokens[name] : null;
      if (typeof value === "string" && HEX.test(value)) {
        root.style.setProperty(name, value);
        applied++;
      }
    }
    if (applied > 0) {
      root.setAttribute("data-theme", omarchy.mode);
      return;
    }
  }
  var dark =
    setting === "dark" ||
    (setting === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.setAttribute("data-theme", dark ? "dark" : "light");
})();
