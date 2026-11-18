/**
 * File: main.jsx
 *
 * Purpose:
 * Initializes the Sandesh React application.
 *
 * Responsibilities:
 * 1. Enable React StrictMode.
 * 2. Provide global authentication state.
 * 3. Provide global Dark/Light theme state.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "./app/AuthProvider";
import { ThemeProvider } from "./app/ThemeProvider";
import "./index.css";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
