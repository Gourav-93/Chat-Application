/**
 * File: authService.js
 *
 * Purpose:
 * This service handles OTP-based authentication API requests.
 * It connects the React frontend to the existing ASP.NET Core backend.
 *
 * Responsibilities:
 * 1. Send an OTP to the provided mobile number.
 * 2. Verify the OTP and receive the authenticated user's data.
 * 3. Keep API communication separate from UI components.
 */

import api from "../../../shared/lib/api";

// Backend authentication endpoints.
const AUTH_ENDPOINTS = {
  SEND_OTP: "/auth/send-otp",
  VERIFY_OTP: "/auth/verify-otp",
};

/**
 * Sends an OTP request to the backend.
 *
 * @param {string} mobileNumber - Mobile number in international format.
 * @returns {Promise<object>} Backend response data.
 */
export const sendOtp = async (mobileNumber) => {
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
 * @returns {Promise<object>} JWT token and user details.
 */
export const verifyOtp = async (mobileNumber, otp) => {
  const response = await api.post(AUTH_ENDPOINTS.VERIFY_OTP, {
    mobileNumber: mobileNumber.trim(),
    otp: otp.trim(),
  });

  return response.data;
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

  if (error.response.status >= 500) {
    return "Invalid OTP. Please try again.";
  }

  return "Request failed. Please check your details and try again.";
};
