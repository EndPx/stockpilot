"use client";

import { useEffect, useState } from "react";
import { MoonIcon, SunIcon } from "./icons";

type Theme = "dark" | "light";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("stockpilot-theme", next); } catch { /* Storage can be unavailable. */ }
    setTheme(next);
  }

  return <button type="button" className="theme-toggle" onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
    {theme === "dark" ? <SunIcon className="nav-icon" /> : <MoonIcon className="nav-icon" />}
    <span className="theme-toggle-label">{theme === "dark" ? "Light mode" : "Dark mode"}</span>
  </button>;
}
