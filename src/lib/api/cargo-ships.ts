import { apiRequest } from "@/lib/api-client";
import { getCachedCargoShips, setCachedCargoShips } from "@/lib/settings";
import { DEFAULT_TRANSPORTS, type Transport } from "@/lib/cargo";

/**
 * The ships the cargo sheet offers, and the one thing in it that comes from
 * the network. Everything else — the sheet itself — never leaves this machine.
 *
 * Read once and cached, so the tool opens and works with no connection: in
 * game, that is the normal case rather than the exception.
 */

export type TransportSource = "network" | "cache" | "builtin";

export interface TransportsResult {
  transports: Transport[];
  source: TransportSource;
}

function isTransport(value: unknown): value is Transport {
  if (!value || typeof value !== "object") return false;

  const transport = value as Record<string, unknown>;

  return (
    typeof transport.id === "string" &&
    transport.id !== "" &&
    typeof transport.name === "string" &&
    typeof transport.capacity === "number" &&
    Number.isFinite(transport.capacity) &&
    transport.capacity > 0
  );
}

function readCache(raw: unknown): Transport[] {
  return Array.isArray(raw) ? raw.filter(isTransport) : [];
}

/**
 * Asks the site, falls back on what was cached, then on the built-in list.
 *
 * The answer says which of the three it is: a sheet built on a stale ship list
 * is still usable, but the user is entitled to know the capacities may have
 * moved since.
 */
export async function listTransports(): Promise<TransportsResult> {
  const cached = readCache(await getCachedCargoShips());

  try {
    const { transports } = await apiRequest<{ transports: unknown }>(
      "/api/cargo-ships",
      // The list is the same for everyone; no session is sent for it.
      { authenticated: false },
    );

    const usable = readCache(transports);

    if (usable.length > 0) {
      await setCachedCargoShips(usable);
      return { transports: usable, source: "network" };
    }
  } catch {
    // Offline, or the site is down — which is exactly what the cache is for.
  }

  if (cached.length > 0) return { transports: cached, source: "cache" };

  return { transports: DEFAULT_TRANSPORTS, source: "builtin" };
}
