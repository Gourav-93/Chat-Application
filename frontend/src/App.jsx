/**
 * File: App.jsx
 *
 * Purpose:
 * Controls the main application view based on authentication.
 *
 * Responsibilities:
 * 1. Show the login page for unauthenticated users.
 * 2. Show the chat dashboard after successful OTP verification.
 * 3. Keep authenticated screens protected.
 */

import { useContext } from "react";
import { AuthContext } from "./app/AuthContext";
import LoginPage from "./features/Auth/Pages/LoginPage";
import ChatPage from "./features/Conversations/Pages/ChatPage";

export default function App() {
  const auth = useContext(AuthContext);

  if (!auth?.isAuthenticated) {
    return (
      <LoginPage
      onLoginSuccess={auth?.login}
      logoutReason={auth?.logoutReason}
    />
    );
  }

  return <ChatPage />;
}
