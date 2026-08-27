const languageButtons = [...document.querySelectorAll("[data-language]")];
const translatable = [...document.querySelectorAll("[data-en][data-zh-cn]")];
const toast = document.querySelector(".toast");

function setLanguage(language) {
  const key = language === "zh-CN" ? "zhCn" : "en";
  document.documentElement.lang = language;
  for (const element of translatable) element.textContent = element.dataset[key];
  for (const button of languageButtons) button.setAttribute("aria-pressed", String(button.dataset.language === language));
  try { localStorage.setItem("realitycheck-site-language", language); } catch (_) {}
}

for (const button of languageButtons) button.addEventListener("click", () => setLanguage(button.dataset.language));
for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", async () => {
    const language = document.documentElement.lang;
    try {
      const copyValue = language === "zh-CN" && button.dataset.copyZhCn
        ? button.dataset.copyZhCn
        : button.dataset.copy;
      await navigator.clipboard.writeText(copyValue);
      toast.textContent = language === "zh-CN" ? "命令已复制。" : "Command copied.";
    } catch (_) {
      toast.textContent = language === "zh-CN" ? "浏览器阻止了复制，请手动复制。" : "Copy was blocked; copy the command manually.";
    }
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1800);
  });
}

let initial = "en";
try { initial = localStorage.getItem("realitycheck-site-language") || (navigator.language.startsWith("zh") ? "zh-CN" : "en"); } catch (_) {}
setLanguage(initial);
