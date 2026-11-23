import { resolveEndpoints } from "../../../config/endpoints.js";

export const { apiBaseUrl, signalRHubUrl } = resolveEndpoints(import.meta.env, import.meta.env.PROD);

export const invitationPreviewEnabled = import.meta.env.DEV
  && import.meta.env.MODE === "development"
  && import.meta.env.VITE_ENABLE_INVITATION_PREVIEW === "true";
