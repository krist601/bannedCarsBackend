export const CARD_CONDITIONS = [
  "near_mint",
  "lightly_played",
  "moderately_played",
  "heavily_played",
  "damaged",
];
export const CARD_FINISHES = ["non_foil", "foil", "etched", "other"];
export function stockLanguage(value: unknown): string {
  if (typeof value !== "string") throw new Error("Language is required");
  const text = value.trim();
  if (!text || text.length > 60)
    throw new Error("Language must contain 1–60 characters");
  if (["en", "english"].includes(text.toLowerCase())) return "English";
  if (["es", "spanish", "español"].includes(text.toLowerCase()))
    return "Spanish";
  return text;
}
export function optionalCardSku(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    value.trim().length > 120 ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new Error(
      "SKU must be at most 120 characters without control characters",
    );
  return value.trim() || null;
}
