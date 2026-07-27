import { apiRequest } from "@/lib/api-client";
import type { OrganizationsResponse, OrgInventoryItem } from "@/types/nexus";

export function listOrganizations(params: { query?: string; page?: number } = {}) {
  return apiRequest<OrganizationsResponse>("/api/orgs", {
    params: { query: params.query, page: params.page },
  });
}

export type OrgInventoryPage = {
  items: OrgInventoryItem[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  members: { id: string; name: string }[];
};

/** Items shared with the organization by its members (`orgVisible: true`). */
export function listOrgInventory(
  orgId: string,
  params: {
    query?: string;
    quality?: number;
    page?: number;
    userId?: string;
  } = {},
) {
  return apiRequest<OrgInventoryPage>(
    `/api/orgs/${encodeURIComponent(orgId)}/inventory`,
    {
      params: {
        query: params.query,
        quality: params.quality,
        page: params.page,
        userId: params.userId,
      },
    },
  );
}
