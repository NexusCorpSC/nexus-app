import { useState } from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui";
import { requestChatAccess } from "@/lib/api/chat";
import type { ChatStatus } from "@/types/chat";

/**
 * What a player without access sees: request it, the pending request, the
 * access taken back, or the chat closed by the admin.
 */
export function ChatAccessPanel({
  status,
  onStatus,
}: {
  status: ChatStatus;
  onStatus: (status: ChatStatus) => void;
}) {
  const t = useTranslations("Chat.access");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function request() {
    setSending(true);
    setFailed(false);
    try {
      onStatus(await requestChatAccess());
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  const state = !status.enabled
    ? "disabled"
    : status.status === "granted"
      ? null
      : status.status;
  if (!state) return null;

  return (
    <div className="mx-auto max-w-md space-y-3 py-10 text-center">
      <h2 className="font-display text-lg font-semibold text-nexus-white">
        {t(`${state}.title`)}
      </h2>
      <p className="text-[13px] text-nexus-muted">{t(`${state}.body`)}</p>
      {state === "none" && (
        <Button onClick={() => void request()} disabled={sending}>
          {t("request")}
        </Button>
      )}
      {failed && <p className="text-[13px] text-red-300">{t("failed")}</p>}
    </div>
  );
}
