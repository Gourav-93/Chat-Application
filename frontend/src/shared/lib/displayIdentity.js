/**
 * File: displayIdentity.js
 * Purpose: Resolves display names consistently without changing stored user data.
 * Responsibilities: Preserve normal names and replace exact legacy generated
 * usernames with the mobile number or the shared Sandesh user fallback.
 */

const LEGACY_USER_NAME = /^user_[0-9a-f]{32}$/i;

export function getDisplayName(userName, mobileNumber) {
  const name = typeof userName === "string" ? userName.trim() : "";
  const mobile = typeof mobileNumber === "string" ? mobileNumber.trim() : "";

  // Apply this only to presentation; API data and search fields stay intact.
  if (name && !LEGACY_USER_NAME.test(name)) return name;
  return mobile || "Sandesh user";
}
