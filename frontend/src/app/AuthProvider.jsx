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
// import { setAccessToken } from "../shared/lib/api";
import { AuthContext } from "./AuthContext";
// import { useCallback, useEffect, useMemo, useState } from "react";
import { useRef } from "react";
import api, { setAccessToken, setUnauthorizedHandler, } from "../shared/lib/api";
import { clearPrivacy } from "../shared/lib/privacyAccess";

const SESSION_KEY = "sandesh-auth-session";
const MAX_TIMEOUT = 2147483647;

 

// Read the saved session and reject expired or malformed data.
function restoreSession() {
  try {
    // Remove the previous tab-specific session after this upgrade.
    // sessionStorage.removeItem(SESSION_KEY);
    // localStorage.removeItem(SESSION_KEY);

    const saved = localStorage.getItem(SESSION_KEY);

    if (!saved) return null;

    const session = JSON.parse(saved);

    if (
      typeof session.token !== "string" ||
      !session.token.trim() ||
      !session.userId ||
      !Number.isFinite(session.expiresAt) ||
      session.expiresAt <= Date.now()
    ) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }

    setAccessToken(session.token);
    return session;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}


export function AuthProvider({ children }) {
  const [session, setSession] = useState(restoreSession);
  const [logoutReason, setLogoutReason] = useState("");
  const sessionRef = useRef(session);
  

  const endSession = useCallback(
  (reason = "", expectedToken) => {
    if (
      expectedToken &&
      sessionRef.current?.token !== expectedToken
    ) {
      return;
    }

    const sharedSession = restoreSession();

if (
  expectedToken &&
  sharedSession &&
  sharedSession.token !== expectedToken
) {
  sessionRef.current = sharedSession;
  setAccessToken(sharedSession.token);
  setSession(sharedSession);
  setLogoutReason("");
  return;
}

    sessionRef.current = null;
    clearPrivacy("");

    // setAccessToken(null);
    // sessionStorage.removeItem(SESSION_KEY);

    setAccessToken(null);
    localStorage.removeItem(SESSION_KEY);

    setSession(null);
    setLogoutReason(reason);
  },
  []
);

const logout = useCallback(async () => {
  const token = sessionRef.current?.token;

  if (!token) return;

  try {
    await api.post(
      "/auth/logout",
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
 } catch (error) {
  if (error.response?.status !== 401) {
    window.alert(
      "Unable to log out right now. Please reconnect and try again.",
    );
    return;
  }
}

endSession("", token);
}, [endSession]);


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
    clearPrivacy("");
    localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
    sessionRef.current = nextSession;
    clearPrivacy("");

setAccessToken(nextSession.token);
setLogoutReason("");
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

  useEffect(() => {
  setUnauthorizedHandler((token) => {
    endSession(
      "Your session expired or was replaced. Please sign in again.",
      token
    );
  });

  return () => {
    setUnauthorizedHandler(null);
  };
}, [endSession]);

useEffect(() => {
  if (!session) return undefined;

  const validateSession = () => {
    if (document.visibilityState !== "visible") return;

    void api
      .get("/auth/session", {
        headers: {
          Authorization: `Bearer ${session.token}`,
        },
      })
      .catch(() => undefined);
  };

  validateSession();
  window.addEventListener("focus", validateSession);

  document.addEventListener(
    "visibilitychange",
    validateSession
  );

  return () => {
    window.removeEventListener(
      "focus",
      validateSession
    );

    document.removeEventListener(
      "visibilitychange",
      validateSession
    );
  };
}, [session]);

useEffect(() => {
  const synchronizeSession = () => {
    const nextSession = restoreSession();
    const previousSession = sessionRef.current;

    if (
      (previousSession?.token ?? null) ===
      (nextSession?.token ?? null)
    ) {
      return;
    }

    sessionRef.current = nextSession;

    setAccessToken(nextSession?.token ?? null);
    setSession(nextSession);

    setLogoutReason(
      previousSession && !nextSession
        ? "You were signed out in another tab."
        : "",
    );
  };

  const handleStorage = (event) => {
    if (
      event.storageArea === localStorage &&
      (event.key === SESSION_KEY || event.key === null)
    ) {
      synchronizeSession();
    }
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener("focus", synchronizeSession);

  synchronizeSession();

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener("focus", synchronizeSession);
  };
}, []);

  const value = useMemo(
    () => ({
      user: session,
      isAuthenticated: Boolean(session),
      login,
      logout,
      endSession,
      logoutReason,
    }),
    [session, login, logout, endSession, logoutReason],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
