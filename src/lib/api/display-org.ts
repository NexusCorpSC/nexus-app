import { apiRequest } from "@/lib/api-client";
import type { MyDisplayOrg } from "@/types/nexus";

/** The organization shown with the reader's name, and the ones to pick from. */
export function getMyDisplayOrg() {
  return apiRequest<MyDisplayOrg>("/api/me/display-org");
}

/** Picks the organization shown; `null` goes back to the first one shared. */
export function setMyDisplayOrg(orgId: string | null) {
  return apiRequest<MyDisplayOrg>("/api/me/display-org", {
    method: "PUT",
    body: { orgId },
  });
}
