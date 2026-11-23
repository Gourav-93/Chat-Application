/**
 * File: authService.js
 *
 * Purpose:
 * This service handles OTP-based authentication API requests.
 * It connects the React frontend to the existing ASP.NET Core backend.
 *
 * Responsibilities:
 * 1. Send an OTP to the provided mobile number.
 * 2. Verify OTPs and complete first-time profiles before authentication.
 * 3. Keep API communication separate from UI components.
 */

import api from "../../../shared/lib/api";

// Backend authentication endpoints.
const AUTH_ENDPOINTS = {
  SEND_OTP: "/auth/send-otp",
  VERIFY_OTP: "/auth/verify-otp",
  COMPLETE_PROFILE: "/auth/complete-profile",
};

async function ensureBrowserSession() {
  if (!navigator.locks) {
    throw new Error(
      "Browser coordination is unavailable. Open the app on localhost or HTTPS in a supported browser."
    );
  }

  await navigator.locks.request(
    "sandesh-browser-initialization",
    async () => {
      await api.post("/auth/browser");
    },
  );
}
/**
 * Sends an OTP request to the backend.
 *
 * @param {string} mobileNumber - Mobile number in international format.
 * @returns {Promise<object>} Backend response data.
 */
export const sendOtp = async (mobileNumber) => {
  await ensureBrowserSession();

  const response = await api.post(AUTH_ENDPOINTS.SEND_OTP, {
    mobileNumber: mobileNumber.trim(),
  });

  return response.data;
};

/**
 * Verifies the OTP entered by the user.
 *
 * @param {string} mobileNumber - User's mobile number.
 * @param {string} otp - Six-digit verification code.
 * @returns {Promise<object>} Signed-in login data or a pending registration.
 */
export const verifyOtp = async (
  mobileNumber,
  otp,
  confirmationToken = null,
) => {
  await ensureBrowserSession();
  
  const response = await api.post(AUTH_ENDPOINTS.VERIFY_OTP, {
    mobileNumber: mobileNumber.trim(),
    otp: otp.trim(),

    confirmExistingSession: Boolean(confirmationToken),

    confirmationToken: confirmationToken || undefined,
    
    
  });

  

  const data = response.data;
  if (data?.status === "signedIn") {
    return { status: "signedIn", login: validateLoginResponse(data.login) };
  }
  if (
    data?.status === "profileRequired" &&
    typeof data.registrationToken === "string" &&
    data.registrationToken.trim() &&
    typeof data.registrationExpiresAt === "string" &&
    Number.isFinite(Date.parse(data.registrationExpiresAt))
  ) {
    return data;
  }
  throw invalidAuthResponse();
};

// Match .NET String.Trim whitespace and UTF-16 length without restricting names.
const PROFILE_WHITESPACE = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001,
  0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]);

export const normalizeProfileName = (value) => {
  let start = 0;
  let end = value.length;
  while (start < end && PROFILE_WHITESPACE.has(value.charCodeAt(start)))
    start++;
  while (end > start && PROFILE_WHITESPACE.has(value.charCodeAt(end - 1)))
    end--;
  return value.slice(start, end);
};

function invalidAuthResponse() {
  const error = new Error(
    "The server returned an invalid sign-in response. Please try again.",
  );
  error.code = "INVALID_AUTH_RESPONSE";
  return error;
}

function validateLoginResponse(data) {
  if (
    typeof data?.token !== "string" ||
    !data.token.trim() ||
    typeof data.userId !== "string" ||
    !data.userId.trim() ||
    typeof data.userName !== "string" ||
    (data.mobileNumber != null && typeof data.mobileNumber !== "string") ||
    typeof data.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(data.expiresAt)) ||
    Date.parse(data.expiresAt) <= Date.now()
  ) {
    throw invalidAuthResponse();
  }
  return data;
}

// Registration credentials are used only for this endpoint, never as JWTs.
export const completeProfile = async (registrationToken, userName, signal) => {
  await ensureBrowserSession();
  const response = await api.post(
    AUTH_ENDPOINTS.COMPLETE_PROFILE,
    {
      registrationToken,
      userName: normalizeProfileName(userName),
    },
    { signal },
  );
  return validateLoginResponse(response.data);
};

/**
 * Extracts a readable error message from an API failure.
 * Handles backend messages, validation errors, and network failures.
 *
 * @param {unknown} error - Error returned by Axios.
 * @returns {string} User-friendly error message.
 */
export const getAuthErrorMessage = (error) => {
  const data = error?.response?.data;

  // Server failures must never be presented as an incorrect OTP or name.
  if (error?.response?.status >= 500) {
    return "The server could not complete your request. Please try again.";
  }
  if (error?.code === "INVALID_AUTH_RESPONSE") return error.message;

  // Prefer the message provided by the backend.
  if (typeof data?.message === "string" && data.message.trim()) {
    return data.message;
  }

  // ASP.NET Core may return validation errors as a dictionary.
  if (data?.errors && typeof data.errors === "object") {
    const messages = Object.values(data.errors).flat();

    if (messages.length > 0) {
      return messages.map(String).join(" ");
    }
  }

  // Handle network errors or an unavailable backend.
  if (!error?.response) {
    return "Unable to connect to the server. Please try again.";
  }

  if (error.response.status === 429) {
    return "Too many requests. Please try again later.";
  }

  return "Request failed. Please check your details and try again.";
};
