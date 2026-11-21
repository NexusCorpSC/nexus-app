import {
  describeForChat,
  enumName,
  getTelemetryStatus,
  isDangerousAction,
  listGameActions,
  MAX_HOLD_MS,
  telemetryErrorCode,
  triggerGameAction,
  TRIGGER_STATUS,
} from "@/lib/telemetry";

/**
 * The tools of Nexus Chat that answer from this computer: the site declares
 * them (`lib/chat/game-tools.ts` in nexus-tools) without running them, since
 * the game's telemetry is only here, and the app runs each call the model
 * makes (`src/components/chat/chat-view.tsx`). Their names must match the
 * site's.
 *
 * A dangerous action (ejecting, self-destruct…) is never run on the model's
 * word: the conversation shows a confirmation, and only the player's yes runs
 * it (`confirmGameAction`).
 */
export const GAME_TOOL_STATUS = "game_status";
export const GAME_TOOL_LIST_ACTIONS = "game_list_actions";
export const GAME_TOOL_TRIGGER = "game_trigger_action";

export const GAME_TOOLS = [
  GAME_TOOL_STATUS,
  GAME_TOOL_LIST_ACTIONS,
  GAME_TOOL_TRIGGER,
] as const;

export type GameToolName = (typeof GAME_TOOLS)[number];

export function isGameTool(name: string | undefined): name is GameToolName {
  return GAME_TOOLS.some((tool) => tool === name);
}

/** The most actions handed to the model at once. */
const MAX_LISTED = 150;

export type GameToolResult =
  | { kind: "output"; output: unknown }
  | { kind: "error"; errorText: string }
  /** A dangerous action: the player is asked before anything runs. */
  | { kind: "confirm" };

type TriggerInput = { action: string; holdSeconds?: number };

function triggerInput(input: unknown): TriggerInput | null {
  const candidate = input as Partial<TriggerInput> | null;
  if (typeof candidate?.action !== "string" || !candidate.action.trim()) {
    return null;
  }
  const hold =
    typeof candidate.holdSeconds === "number" &&
    Number.isFinite(candidate.holdSeconds) &&
    candidate.holdSeconds > 0
      ? candidate.holdSeconds
      : undefined;
  return { action: candidate.action.trim(), holdSeconds: hold };
}

/** Whether a call of `game_trigger_action` needs the player's yes. */
export function needsConfirmation(
  toolName: string | undefined,
  input: unknown,
) {
  if (toolName !== GAME_TOOL_TRIGGER) return false;
  const parsed = triggerInput(input);
  return parsed !== null && isDangerousAction(parsed.action);
}

/** The action a call of `game_trigger_action` asks for, for the card. */
export function requestedAction(input: unknown): string | null {
  return triggerInput(input)?.action ?? null;
}

function failure(cause: unknown): GameToolResult {
  const code = telemetryErrorCode(cause);
  return {
    kind: "error",
    errorText:
      code === "notConnected"
        ? "The game's telemetry is not connected: Star Citizen is closed, or GameTelemetryEnabled is not set (Nexus App settings, Game section)."
        : (code ?? String(cause)),
  };
}

async function trigger(
  input: TriggerInput,
  confirmed: boolean,
): Promise<GameToolResult> {
  try {
    const result = await triggerGameAction(input.action, {
      holdMs:
        input.holdSeconds === undefined
          ? undefined
          : Math.min(MAX_HOLD_MS, Math.round(input.holdSeconds * 1000)),
      confirmed,
    });
    return {
      kind: "output",
      output: {
        action: input.action,
        status: enumName(TRIGGER_STATUS, result.status) ?? "unknown",
        message: result.message || null,
      },
    };
  } catch (cause) {
    return failure(cause);
  }
}

/** Runs one call of a game tool, as the model made it. */
export async function runGameTool(
  toolName: GameToolName,
  input: unknown,
): Promise<GameToolResult> {
  switch (toolName) {
    case GAME_TOOL_STATUS:
      try {
        return {
          kind: "output",
          output: describeForChat(await getTelemetryStatus()),
        };
      } catch (cause) {
        return failure(cause);
      }
    case GAME_TOOL_LIST_ACTIONS: {
      const query =
        typeof (input as { query?: unknown } | null)?.query === "string"
          ? (input as { query: string }).query.trim().toLowerCase()
          : "";
      try {
        const actions = (await listGameActions()).filter(
          (action) =>
            !query ||
            action.name.toLowerCase().includes(query) ||
            action.category.toLowerCase().includes(query),
        );
        return {
          kind: "output",
          output: {
            total: actions.length,
            actions: actions.slice(0, MAX_LISTED).map((action) => ({
              name: action.name,
              category: action.category,
              holdable: action.holdable,
              needsConfirmation: action.dangerous,
            })),
          },
        };
      } catch (cause) {
        return failure(cause);
      }
    }
    case GAME_TOOL_TRIGGER: {
      const parsed = triggerInput(input);
      if (!parsed) return { kind: "error", errorText: "`action` is required." };
      if (isDangerousAction(parsed.action)) return { kind: "confirm" };
      return trigger(parsed, false);
    }
  }
}

/** The player answered the confirmation of a dangerous action. */
export async function confirmGameAction(
  input: unknown,
  approved: boolean,
): Promise<GameToolResult> {
  const parsed = triggerInput(input);
  if (!parsed) return { kind: "error", errorText: "`action` is required." };
  if (!approved) {
    return {
      kind: "output",
      output: { action: parsed.action, status: "declinedByPlayer" },
    };
  }
  return trigger(parsed, true);
}
