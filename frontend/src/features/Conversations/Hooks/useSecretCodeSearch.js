// Checks debounced Secret Code candidates and holds an unused reveal grant in memory.

import { useLayoutEffect, useRef, useState } from "react";
import api from "../../../shared/lib/api";
import { verifySecretCode } from "../Services/ConversationService";

export function normalizeSecretCode(value) {
  // Match .NET whitespace and count scalar values after NFC, including emoji sequences.
  if (
    !value ||
    /^\p{White_Space}+$/u.test(value) ||
    /[\uD800-\uDFFF]/u.test(value)
  )
    return null;
  const normalized = value.normalize("NFC");
  return [...normalized].length <= 100 ? normalized : null;
}

export default function useSecretCodeSearch(query, enabled, composing) {
  const candidate = enabled && !composing ? normalizeSecretCode(query) : null;
  const [match, setMatch] = useState(null);
  const pendingGrant = useRef(null);
  const revealAvailable = Boolean(candidate && match?.query === query);

  useLayoutEffect(() => {
    if (!candidate) return undefined;
    const controller = new AbortController();
    let expiryTimer;
    const release = () => {
      const grant = pendingGrant.current;
      if (grant?.controller !== controller) return;
      pendingGrant.current = null;
      // Revoke only this unused capability; other tabs keep their own grants.
      if (grant.expiresAt > Date.now()) {
        void api
          .post("/privacy/session/lock", { token: grant.grant.token })
          .catch(() => {});
      }
    };
    const expire = () => {
      if (
        pendingGrant.current?.controller !== controller ||
        pendingGrant.current.expiresAt > Date.now()
      )
        return;
      pendingGrant.current = null;
      setMatch(null);
    };
    const timer = window.setTimeout(async () => {
      try {
        const grant = await verifySecretCode(candidate, controller.signal);
        if (controller.signal.aborted) return;
        const expiresAt = Date.parse(grant?.expiresAt);
        if (
          typeof grant?.token !== "string" ||
          !/^[0-9A-F]{64}$/.test(grant.token) ||
          !Number.isFinite(expiresAt) ||
          expiresAt <= Date.now()
        )
          return;
        pendingGrant.current = { query, grant, expiresAt, controller };
        setMatch({ query, expiresAt });
        expiryTimer = window.setTimeout(expire, expiresAt - Date.now());
      } catch {
        // Ordinary search remains usable on verification failures.
      }
    }, 350);
    window.addEventListener("focus", expire);
    document.addEventListener("visibilitychange", expire);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      window.clearTimeout(expiryTimer);
      window.removeEventListener("focus", expire);
      document.removeEventListener("visibilitychange", expire);
      release();
      setMatch((previous) => (previous?.query === query ? null : previous));
    };
  }, [candidate, query]);

  function takeGrant() {
    const current = pendingGrant.current;
    if (
      !revealAvailable ||
      current?.query !== query ||
      current.expiresAt <= Date.now() ||
      current.controller.signal.aborted
    )
      return null;
    pendingGrant.current = null;
    setMatch(null);
    return current.grant;
  }

  return { revealAvailable, takeGrant };
}
