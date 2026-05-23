import type { BiteCategory } from "../types/domain";

export const BITE_CATEGORY_OPTIONS: { value: BiteCategory; roman: string; num: string }[] = [
  { value: 1, roman: "I", num: "1" },
  { value: 2, roman: "II", num: "2" },
  { value: 3, roman: "III", num: "3" },
  { value: 4, roman: "IV", num: "4" },
];

/** Label for Doctor's Order dropdown / read-only fields. */
export function biteCategoryLabel(value: BiteCategory | undefined | null): string {
  if (value == null) return "Select category";
  const opt = BITE_CATEGORY_OPTIONS.find((o) => o.value === value);
  return opt ? `Category ${opt.roman} (${opt.num})` : "Select category";
}

/** Compact value for queue table cells (Roman numeral only). */
export function biteCategoryQueueDisplay(value: BiteCategory | undefined | null): string {
  if (value == null) return "—";
  const opt = BITE_CATEGORY_OPTIONS.find((o) => o.value === value);
  return opt?.roman ?? "—";
}

export function parseBiteCategory(raw: unknown): BiteCategory | undefined {
  const n = Number(raw);
  if (n >= 1 && n <= 4) return n as BiteCategory;
  return undefined;
}
