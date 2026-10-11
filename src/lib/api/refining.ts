import { apiRequest } from "@/lib/api-client";
import type {
  RefiningCollectInput,
  RefiningJob,
  RefiningJobInput,
} from "@/types/nexus";

/**
 * The reader's refining orders (see `/api/refining/jobs` in Nexus Tools),
 * the finished ones first, then by the nearest end.
 */
export async function listRefiningJobs() {
  const { jobs } = await apiRequest<{ jobs: RefiningJob[] }>(
    "/api/refining/jobs",
  );
  return jobs;
}

/** Starts tracking an order, which starts now. */
export async function createRefiningJob(input: RefiningJobInput) {
  const { job } = await apiRequest<{ job: RefiningJob }>("/api/refining/jobs", {
    method: "POST",
    body: input,
  });
  return job;
}

/** Edits an order; its start does not move. */
export async function updateRefiningJob(jobId: string, input: RefiningJobInput) {
  const { job } = await apiRequest<{ job: RefiningJob }>(
    `/api/refining/jobs/${encodeURIComponent(jobId)}`,
    { method: "PUT", body: input },
  );
  return job;
}

export function deleteRefiningJob(jobId: string) {
  return apiRequest<void>(`/api/refining/jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
  });
}

/**
 * Adds the order's lines to the inventory — topping up a lot already held
 * with the same material, quality and unit at that place — and removes the
 * order. With no lines, the order is only removed.
 */
export function collectRefiningJob(jobId: string, input: RefiningCollectInput) {
  return apiRequest<{ created: number; merged: number }>(
    `/api/refining/jobs/${encodeURIComponent(jobId)}/collect`,
    { method: "POST", body: input },
  );
}
