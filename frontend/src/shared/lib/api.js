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
let unauthorizedHandler = null;

export const setUnauthorizedHandler = (handler) => {
  unauthorizedHandler = handler;
};

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
  if (accessToken && !config.headers.has("Authorization")) {
    config.headers.set("Authorization", `Bearer ${accessToken}`);
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,

  (error) => {
    const authorization =
      error.config?.headers?.get?.("Authorization");

    const anonymousAuth =
      /\/auth\/(send-otp|verify-otp|complete-profile)(?:$|\?)/.test(
        error.config?.url || ""
      );

    if (
      !anonymousAuth &&
      error.response?.status === 401 &&
      accessToken &&
      authorization === `Bearer ${accessToken}`
    ) {
      unauthorizedHandler?.(accessToken);
    }

    return Promise.reject(error);
  }
);

export default api;
