import { useContext, useEffect, useState, useSyncExternalStore } from "react";
import { AuthContext } from "../../../app/AuthContext";
import { getConversations, getConversationErrorMessage } from "../Services/ConversationService";
import { getPrivacySnapshot, subscribePrivacy } from "../../../shared/lib/privacyAccess";

// Keep snapshots in memory: persisted previews can outlive a lock in another tab.
export default function useConversations(refreshKey = 0, section = "normal") {
  const auth = useContext(AuthContext);
  const privacy = useSyncExternalStore(subscribePrivacy, getPrivacySnapshot);
  const token = auth?.isAuthenticated ? auth.user?.token : null;
  const scope = `${token}:${section}:${privacy.version}`;
  const [result, setResult] = useState(null);
  const [pagination, setPagination] = useState(null);
  const pages = pagination?.scope === scope ? pagination.pages : 1;
  const key = `${refreshKey}:${pages}`;

  useEffect(() => {
    if (!token) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        let conversations = [];
        let hasMore = false;
        for (let page = 1; page <= pages; page++) {
          const rows = await getConversations(controller.signal, section, page);
          conversations = conversations.concat(rows);
          hasMore = rows.length === 30;
          if (!hasMore) break;
        }
        if (!controller.signal.aborted) setResult({ scope, key, conversations, hasMore, error: "" });
      } catch (error) {
        if (controller.signal.aborted) return;
        const denied = error.response?.status === 401 || error.response?.status === 403;
        setResult((previous) => ({ scope, key, error: getConversationErrorMessage(error),
          conversations: !denied && previous?.scope === scope ? previous.conversations : null }));
      }
    }, 150);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [token, scope, key, pages, section]);

  const current = result?.scope === scope ? result : null;
  const hasSnapshot = Boolean(current?.conversations);
  const complete = current?.key === key;
  return {
    conversations: current?.conversations ?? [],
    isLoading: Boolean(token) && !complete && !hasSnapshot,
    isRefreshing: Boolean(token) && !complete && hasSnapshot,
    hasSnapshot,
    snapshotReady: complete && hasSnapshot && !current.error,
    accessError: current?.error || "",
    hasMore: Boolean(current?.hasMore),
    loadMore: () => setPagination({ scope, pages: pages + 1 }),
  };
}
