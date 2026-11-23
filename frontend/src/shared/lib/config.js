import { resolveEndpoints } from "../../../config/endpoints.js";

export const { apiBaseUrl, signalRHubUrl } = resolveEndpoints(import.meta.env, import.meta.env.PROD);
