import { useState } from "react";
import { useTranslations } from "use-intl";
import { formatShortcut } from "@/lib/settings";
import { cn } from "@/lib/utils";

/** Held down, these are part of a combination rather than the key itself. */
const MODIFIER_KEYS = ["Control", "Shift", "Alt", "Meta"];

type ShortcutInputProps = {
  id?: string;
  value: string;
  onChange: (accelerator: string) => void;
};

/**
 * Records a key combination.
 *
 * At least one modifier is required: a bare key registered globally would be
 * swallowed system-wide, in every other application.
 */
export function ShortcutInput({ id, value, onChange }: ShortcutInputProps) {
  const t = useTranslations("Common.shortcutInput");
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    // Tab keeps its normal behaviour, otherwise recording mode traps keyboard
    // focus in this field. The cost is that Tab cannot be part of a shortcut.
    if (event.key === "Tab") {
      setRecording(false);
      setError(null);
      return;
    }

    event.preventDefault();

    if (event.key === "Escape") {
      setRecording(false);
      setError(null);
      return;
    }

    if (MODIFIER_KEYS.includes(event.key)) return;

    const modifiers: string[] = [];
    if (event.ctrlKey) modifiers.push("Ctrl");
    if (event.shiftKey) modifiers.push("Shift");
    if (event.altKey) modifiers.push("Alt");
    if (event.metaKey) modifiers.push("Super");

    if (modifiers.length === 0) {
      setError(t("missingModifier"));
      return;
    }

    // `event.code` matches the key names the shortcut parser expects.
    onChange([...modifiers, event.code].join("+"));
    setRecording(false);
    setError(null);
  }

  return (
    <div className="shrink-0 space-y-1">
      <button
        id={id}
        type="button"
        onClick={() => {
          setRecording(true);
          setError(null);
        }}
        onBlur={() => setRecording(false)}
        onKeyDown={recording ? handleKeyDown : undefined}
        className={cn(
          "h-7.5 min-w-33 rounded-md border px-2.5 text-center font-mono text-xs transition-colors",
          recording
            ? "border-nexus-bright bg-nexus-bright/10 text-nexus-bright"
            : "border-nexus-accent/18 bg-nexus-abyss text-nexus-white hover:border-nexus-accent/40",
        )}
      >
        {recording ? t("recording") : formatShortcut(value)}
      </button>

      {error && (
        <p className="max-w-48 text-[11.5px] text-rose-300">{error}</p>
      )}
    </div>
  );
}
