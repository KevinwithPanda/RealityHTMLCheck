const tabs = [...document.querySelectorAll('[role="tab"]')];
const selectTab = (tab, moveFocus = false) => {
  for (const candidate of tabs) {
    const selected = candidate === tab;
    candidate.setAttribute("aria-selected", String(selected));
    candidate.tabIndex = selected ? 0 : -1;
    document.getElementById(candidate.getAttribute("aria-controls"))?.toggleAttribute("hidden", !selected);
  }
  if (moveFocus) tab.focus();
};
for (const tab of tabs) {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", (event) => {
    const current = tabs.indexOf(tab);
    const destination = event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
        : event.key === "ArrowRight" || event.key === "ArrowDown" ? (current + 1) % tabs.length
          : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (current - 1 + tabs.length) % tabs.length
            : null;
    if (destination === null) return;
    event.preventDefault();
    selectTab(tabs[destination], true);
  });
}
if (tabs[0]) selectTab(tabs[0]);

const disclosure = document.querySelector("[aria-controls=advanced]");
disclosure?.addEventListener("click", () => {
  const expanded = disclosure.getAttribute("aria-expanded") !== "true";
  disclosure.setAttribute("aria-expanded", String(expanded));
  document.getElementById("advanced")?.toggleAttribute("hidden", !expanded);
});
