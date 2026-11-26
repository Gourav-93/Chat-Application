import { useCallback, useEffect, useRef, useState } from "react";
import api from "../../../shared/lib/api";

// export default function useUserBlocks(userId, targetUserId, revision, connectionStatus) {
export default function useUserBlocks(userId, revision) {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const requestRef = useRef(0);
  const operationRef = useRef(null);
  const retry = useCallback(() => setRefresh((value) => value + 1), []);

  // useEffect(() => {
  //   const controller = new AbortController();
  //   const request = ++requestRef.current;
  //   api.get("/users/blocked", { signal: controller.signal }).then(({ data }) => {
  //     if (!controller.signal.aborted && request === requestRef.current) {
  //       setSnapshot({ userId, users: data });
  //       setError("");
  //     }
  //   }).catch(() => {
  //     if (!controller.signal.aborted && request === requestRef.current)
  //       setError("Unable to load blocked contacts. Try again.");
  //   });
  //   return () => controller.abort();
  // }, [userId, targetUserId, revision, connectionStatus, refresh]);


   useEffect(() => {
    if (!userId) return undefined;

    const controller = new AbortController();
    const request = ++requestRef.current;

    api.get("/users/blocked", { signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted || request !== requestRef.current) return;

        setSnapshot({ userId, users: data });
        setError("");
      })
      .catch(() => {
        if (controller.signal.aborted || request !== requestRef.current) return;

        setError("Unable to load blocked contacts. Try again.");
      });

    return () => controller.abort();
  }, [userId, revision, refresh]);
  
  useEffect(() => () => operationRef.current?.abort(), []);

  const setBlocked = async (target, blocked) => {
    if (operationRef.current) return false;
    const controller = new AbortController();
    operationRef.current = controller;
    ++requestRef.current;
    setBusy(true);
    setError("");
    try {
      const route = `/users/${target.userId || target.otherUserId}/block`;
      const { data } = blocked
        ? await api.post(route, null, { signal: controller.signal })
        : await api.delete(route, { signal: controller.signal });
      if (controller.signal.aborted) return false;
      ++requestRef.current;
      // Only update after server acceptance. Preserve the selected chat and history.
      setSnapshot((previous) => {
        const users = (previous?.userId === userId ? previous.users : [])
          .filter((user) => user.userId !== data.userId);
        if (data.isBlockedByMe) users.unshift({
          userId: data.userId,
          userName: target.userName || target.otherUserName,
          mobileNumber: target.mobileNumber || target.otherUserMobileNumber,
        });
        return { userId, users };
      });
      retry();
      return true;
    } catch (err) {
      if (!controller.signal.aborted)
        setError(err.response?.data?.message || "Unable to update this contact. Try again.");
      return false;
    } finally {
      if (operationRef.current === controller) operationRef.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  const loaded = snapshot?.userId === userId;
  const users = loaded ? snapshot.users : [];
  return {
    users, busy, error, loading: !loaded, retry, setBlocked,
    isBlocked: (target) => users.some((user) => user.userId.toLowerCase() === String(target).toLowerCase()),
  };
}
