import { apiRequest } from "@/lib/api-client";
import type { MyPresence, OrgPresence } from "@/types/nexus";

export function getMyPresence() {
  return apiRequest<MyPresence>("/api/me/presence");
}

/** Declares playing, or renews the declaration with the same activity. */
export function declarePlaying(activity: string | null) {
  return apiRequest<MyPresence>("/api/me/presence", {
    method: "PUT",
    body: { activity },
  });
}

export function stopPlaying() {
  return apiRequest<MyPresence>("/api/me/presence", { method: "DELETE" });
}

/** The members of an organization currently playing. Members only. */
export function getOrgPresence(orgId: string) {
  return apiRequest<OrgPresence>(
    `/api/orgs/${encodeURIComponent(orgId)}/presence`,
  );
}
