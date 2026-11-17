/**
 * File: AuthProvider.jsx
 *
 * Purpose:
 * Manages authentication state and session persistence for Sandesh.
 *
 * Responsibilities:
 * 1. Restore a valid session after page refresh.
 * 2. Configure the JWT for protected API requests.
 * 3. Handle login, logout, and JWT expiration.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { setAccessToken } from "../shared/lib/api";
import { AuthContext } from "./AuthContext";

const SESSION_KEY = "sandesh-auth-session";
const MAX_TIMEOUT = 2147483647;

// Read the saved session and reject expired or malformed data.
function restoreSession() {
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);

    if (!saved) return null;

    const session = JSON.parse(saved);

    if (
      typeof session.token !== "string" ||
      !session.token.trim() ||
      !session.userId ||
      !Number.isFinite(session.expiresAt) ||
      session.expiresAt <= Date.now()
    ) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }

    setAccessToken(session.token);
    return session;
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(restoreSession);

  const logout = useCallback(() => {
    setAccessToken(null);
    sessionStorage.removeItem(SESSION_KEY);
    setSession(null);
  }, []);

  const login = useCallback((response) => {
    const token = response?.token ?? response?.Token;
    const userId = response?.userId ?? response?.UserId;
    const expiresAt = response?.expiresAt ?? response?.ExpiresAt;

    const expiryTime = Date.parse(expiresAt);

    if (
      typeof token !== "string" ||
      !token.trim() ||
      !userId ||
      !Number.isFinite(expiryTime) ||
      expiryTime <= Date.now()
    ) {
      throw new Error("Invalid or expired authentication response.");
    }

    const nextSession = {
      token: token.trim(),
      userId,
      userName: response.userName ?? response.UserName ?? "",
      mobileNumber: response.mobileNumber ?? response.MobileNumber ?? "",
      expiresAt: expiryTime,
    };

    // Save the session for refresh restoration.
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
    setAccessToken(nextSession.token);
    setSession(nextSession);
  }, []);

  useEffect(() => {
    if (!session) return undefined;

    const remainingTime = session.expiresAt - Date.now();

    if (remainingTime <= 0) {
      const timeoutId = window.setTimeout(logout, 0);
      return () => window.clearTimeout(timeoutId);
    }

    // Recheck after long delays instead of logging out prematurely.
    const timeoutId = window.setTimeout(
      () => {
        if (session.expiresAt <= Date.now()) {
          logout();
        }
      },
      Math.min(remainingTime, MAX_TIMEOUT),
    );

    return () => window.clearTimeout(timeoutId);
  }, [session, logout]);

  const value = useMemo(
    () => ({
      user: session,
      isAuthenticated: Boolean(session),
      login,
      logout,
    }),
    [session, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
