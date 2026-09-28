import { useQuery } from "@tanstack/react-query";
import { listFriends } from "@/lib/api/friends";

export const FRIENDS_KEY = ["friends"] as const;

/** Often enough to see a friend arrive, as on the organization pages. */
const REFRESH_MS = 30_000;

/**
 * The reader's friends, those playing first. Shared by the page and the menu's
 * count: one query, whichever asks.
 */
export function useFriends(enabled: boolean) {
  return useQuery({
    queryKey: FRIENDS_KEY,
    queryFn: async () => (await listFriends()).friends,
    enabled,
    refetchInterval: REFRESH_MS,
  });
}
