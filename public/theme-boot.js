// Runs before the first paint (a classic script in <head>, allowed by the CSP as 'self'): sets the
// cached theme on <html> so a dark window never flashes light. The app keeps the attribute in step
// with the settings afterwards (src/features/settings/theme.ts). Same keys and values as there.
(function () {
  var setting = "system";
  try {
    var cached = localStorage.getItem("meeting-companion.theme");
    if (cached === "light" || cached === "dark" || cached === "system") setting = cached;
  } catch {
    // No storage: follow the system.
  }
  var dark =
    setting === "dark" ||
    (setting === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
})();
