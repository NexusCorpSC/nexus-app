import { apiRequest } from "@/lib/api-client";
import { setSessionCookie } from "@/lib/settings";
import type { CurrentUser } from "@/types/nexus";

/**
 * Sign-in uses better-auth's email OTP flow, which is the only provider that
 * works without a browser redirect. Discord OAuth would need a loopback
 * redirect handler — see the README for the follow-up.
 */

export function sendSignInOtp(email: string) {
  return apiRequest<unknown>("/api/auth/email-otp/send-verification-otp", {
    method: "POST",
    body: { email, type: "sign-in" },
    authenticated: false,
  });
}

export async function verifySignInOtp(email: string, otp: string) {
  await apiRequest<unknown>("/api/auth/sign-in/email-otp", {
    method: "POST",
    body: { email, otp },
    authenticated: false,
    // Persists the returned session cookie for subsequent requests.
    captureCookies: true,
  });

  return getCurrentUser();
}

export function getCurrentUser() {
  return apiRequest<CurrentUser>("/api/me");
}

export async function signOut() {
  try {
    await apiRequest<unknown>("/api/auth/sign-out", { method: "POST" });
  } catch {
    // The local session is cleared regardless of what the server answers.
  }
  await setSessionCookie(null);
}
