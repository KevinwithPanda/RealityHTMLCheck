const tabs = [...document.querySelectorAll('[role="tab"]')];
for (const tab of tabs) {
  tab.addEventListener("click", () => {
    for (const candidate of tabs) {
      const selected = candidate === tab;
      candidate.setAttribute("aria-selected", String(selected));
      document.getElementById(candidate.getAttribute("aria-controls"))?.toggleAttribute("hidden", !selected);
    }
  });
}

const disclosure = document.querySelector("[aria-controls=advanced]");
disclosure?.addEventListener("click", () => {
  const expanded = disclosure.getAttribute("aria-expanded") !== "true";
  disclosure.setAttribute("aria-expanded", String(expanded));
  document.getElementById("advanced")?.toggleAttribute("hidden", !expanded);
});
