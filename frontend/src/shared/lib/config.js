import { resolveEndpoints } from "../../../config/endpoints.js";

const devServerPreview = import.meta.env.DEV && import.meta.env.MODE === "development";
// Testing-server builds only: CI sets VITE_FORCE_INVITATION_PREVIEW=true at build time.
const testingBuildPreview = import.meta.env.VITE_FORCE_INVITATION_PREVIEW === "true";

export const invitationPreviewEnabled = (devServerPreview || testingBuildPreview)
  && import.meta.env.VITE_ENABLE_INVITATION_PREVIEW === "true";
