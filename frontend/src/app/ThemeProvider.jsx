/**
 * File: ThemeProvider.jsx
 *
 * Purpose:
 * Manages the global Dark/Light theme for Sandesh.
 *
 * Responsibilities:
 * 1. Store the selected theme in React state.
 * 2. Save theme preference in localStorage.
 * 3. Apply the theme to the application.
 * 4. Provide a toggle function to components.
 */

import {
  
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { ThemeContext } from "./ThemeContext";

const getInitialTheme = () => {
  try {
    const savedTheme = localStorage.getItem("sandesh-theme");

    if (savedTheme === "light" || savedTheme === "dark") {
      return savedTheme;
    }
  } catch {
    // Use the default theme if browser storage is unavailable.
  }

  return "dark";
};

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    // Apply the selected theme to the root HTML element.
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;

    try {
      localStorage.setItem("sandesh-theme", theme);
    } catch {
      // Keep the theme working even if storage is unavailable.
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  const value = useMemo(
    () => ({
      theme,
      isDark: theme === "dark",
      toggleTheme,
    }),
    [theme, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
