try {
  document.documentElement.dataset.theme = localStorage.getItem("stockpilot-theme") === "light" ? "light" : "dark";
} catch {
  document.documentElement.dataset.theme = "dark";
}
