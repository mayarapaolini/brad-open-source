import type { LifeDomainId } from "@brad/domain";
import type { Suggestion } from "@brad/priority-engine";
import type { MessageKey } from "./i18n/en";

type T = (key: MessageKey, params?: Record<string, string | number | boolean>) => string;

/** Human-readable text for a suggested life-map change, in the current language. */
export function describeSuggestion(t: T, s: Suggestion): string {
  const params = { ...s.params };
  if (typeof params.domain === "string") params.domain = t(`domain.${params.domain as LifeDomainId}`);
  return t(`suggestion.${s.change}`, params);
}
