import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { rememberListUrl } from "@/lib/navigation";

type FilterValue = string | number | boolean | null | undefined;

/**
 * The address's query as it was when the screen opened, to seed a list's
 * filters with: coming back to a list finds them in the address.
 */
export function useInitialParams(): URLSearchParams {
  const [searchParams] = useSearchParams();
  const [initial] = useState(() => new URLSearchParams(searchParams));
  return initial;
}

/**
 * Keeps a list's filters in the address (`#/items?category=Armes&page=2`), so
 * coming back from a detail screen, or reopening the list from a "back" link,
 * finds them as they were left. The page still holds its filters in state,
 * seeded from `useInitialParams`; this writes every change back to the
 * address. Empty values, `false` and page 1 stay out of it.
 */
export function useUrlFilters(values: Record<string, FilterValue>) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { pathname } = useLocation();

  const wanted = new URLSearchParams(searchParams);
  for (const [key, value] of Object.entries(values)) {
    const empty =
      value === null ||
      value === undefined ||
      value === "" ||
      value === false ||
      (key === "page" && Number(value) <= 1);
    if (empty) wanted.delete(key);
    else wanted.set(key, String(value));
  }
  const next = wanted.toString();
  const current = searchParams.toString();

  useEffect(() => {
    rememberListUrl(pathname, next);
    if (next !== current) setSearchParams(next, { replace: true });
  }, [pathname, next, current, setSearchParams]);
}

/** Reads a numeric `page` from the address: 1 when absent or invalid. */
export function pageFrom(params: URLSearchParams): number {
  const page = Number.parseInt(params.get("page") ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

/** Reads one of `allowed` from the address, `fallback` otherwise. */
export function oneOf<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = params.get(key);
  return allowed.find((option) => option === value) ?? fallback;
}
