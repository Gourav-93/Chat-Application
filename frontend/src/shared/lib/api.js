/**
 * File: api.js
 *
 * Purpose:
 * Configures the shared Axios client for Sandesh.
 *
 * Responsibilities:
 * 1. Configure the backend API connection.
 * 2. Keep the JWT access token in memory.
 * 3. Attach the JWT to authenticated API requests.
 * 4. Allow the authentication layer to clear the token on logout.
 */

import axios from "axios";

// In-memory token: cleared automatically when the page reloads.
let accessToken = null;

/**
 * Updates the JWT used by authenticated API requests.
 *
 * @param {string | null} token - JWT or null to clear it.
 */
export const setAccessToken = (token) => {
  accessToken = typeof token === "string" && token.trim() ? token.trim() : null;
};

const api = axios.create({
  baseURL: "/api",
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Attach the JWT only when an access token is available.
api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.set("Authorization", `Bearer ${accessToken}`);
  }

  return config;
});

export default api;
