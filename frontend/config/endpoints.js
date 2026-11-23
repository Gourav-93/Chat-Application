// Shared by Vite's build/dev configuration and the browser configuration module.
// VITE_API_BASE_URL keeps its existing meaning as the backend origin, without /api.
export function resolveEndpoints(env, production = false) {
  const backendOrigin = (env.VITE_API_BASE_URL || "").trim().replace(/\/+$/, "");
  const hubOverride = (env.VITE_SIGNALR_HUB_URL || "").trim();

  function validateUrl(value, name, originOnly) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${name} must be an absolute HTTP(S) URL`);
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
        url.search || url.hash || (originOnly && url.pathname !== "/")) {
      throw new Error(`${name} must be an HTTP(S) URL without credentials, query, or fragment`);
    }
    if (production && url.protocol !== "https:") {
      throw new Error(`${name} must use HTTPS for a deployment build`);
    }
  }

  if (backendOrigin) validateUrl(backendOrigin, "VITE_API_BASE_URL", true);
  if (hubOverride && hubOverride !== "/hubs/chat") {
    validateUrl(hubOverride, "VITE_SIGNALR_HUB_URL", false);
  }

  return {
    backendOrigin,
    apiBaseUrl: `${backendOrigin}/api`,
    signalRHubUrl: hubOverride || `${backendOrigin}/hubs/chat`,
  };
}
