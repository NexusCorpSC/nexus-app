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

/**
 * Every item shared with the organization by its members (`orgVisible:
 * true`), at once: they are grouped by place and resource on screen, and a
 * page would split a resource in two. A server that predates `all` answers
 * with its largest page.
 */
export function listOrgInventory(
  orgId: string,
  params: {
    query?: string;
    quality?: number;
    userId?: string;
  } = {},
) {
  return apiRequest<OrgInventoryPage>(
    `/api/orgs/${encodeURIComponent(orgId)}/inventory`,
    {
      params: {
        query: params.query,
        quality: params.quality,
        userId: params.userId,
        all: 1,
        limit: 100,
      },
    },
  );
}
