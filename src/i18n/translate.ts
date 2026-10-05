import { createTranslator, type NamespaceKeys, type NestedKeyOf } from "use-intl";
import { getLocale } from "@/i18n/locale";
import { MESSAGES } from "@/i18n/messages";
import type { Messages } from "@/i18n/messages-types";

/**
 * `useTranslations` for code that is not a component: a label table in
 * `lib/`, a helper that builds a sentence. Call it where the text is needed,
 * not at module load, so it follows the language on screen.
 */
export function translator<
  NestedKey extends NamespaceKeys<Messages, NestedKeyOf<Messages>>,
>(namespace: NestedKey) {
  const locale = getLocale();
  return createTranslator({
    locale,
    messages: MESSAGES[locale],
    namespace,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}
