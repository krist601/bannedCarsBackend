export type ImportRow = {
  line: number;
  quantity: number;
  name: string;
  code: string;
  collector: string;
  finish: string;
  language: string;
  printing_id?: string;
  error?: string;
  warning?: string;
};
export function parseStockImport(value: unknown): ImportRow[] {
  if (typeof value !== "string" || value.length > 50000)
    throw new Error("Paste up to 100 card lines (50,000 characters maximum).");
  const lines = value
    .split(/\r?\n/)
    .map((text, i) => ({ text: text.trim(), line: i + 1 }))
    .filter((x) => x.text);
  if (!lines.length || lines.length > 100)
    throw new Error("Paste between 1 and 100 card lines.");
  return lines.map(({ text, line }) => {
    const row: ImportRow = {
      line,
      quantity: 0,
      name: "",
      code: "",
      collector: "",
      finish: "non_foil",
      language: "English",
    };
    const match = text.match(
      /^(\d+)\s*(?:[x×]\s+)?(.+?)\s+\(([a-z0-9]+)\)\s+#?([^\s*]+)(.*)$/i,
    );
    if (!match) return { ...row, error: "Use: 2x Card name (SET) 123 *F* S" };
    row.quantity = Number(match[1]);
    row.name = match[2].trim();
    row.code = match[3].toLowerCase();
    row.collector = match[4];
    if (
      !Number.isSafeInteger(row.quantity) ||
      row.quantity < 1 ||
      row.quantity > 10000
    )
      row.error = "Quantity must be 1–10,000.";
    const suffix = match[5]
      .replace(/\*/g, "")
      .trim()
      .replace(/\.$/, "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (/^(F|NF)$/i.test(suffix[0] || ""))
      row.finish = suffix.shift()!.toUpperCase() === "F" ? "foil" : "non_foil";
    const language = suffix.join(" ").toLowerCase();
    const languages: Record<string, string> = {
      "": "English",
      e: "English",
      en: "English",
      english: "English",
      s: "Spanish",
      es: "Spanish",
      spanish: "Spanish",
      español: "Spanish",
      o: "Other",
      other: "Other",
    };
    if (language in languages) row.language = languages[language];
    else if (/^other:[\p{L} -]{1,50}$/u.test(language))
      row.language = suffix.join(" ").slice(6).trim();
    else
      row.error =
        "Language must be E, S, O, or other:Language; foil must be F or NF.";
    return row;
  });
}
export const normalizeImportName = (value: string) =>
  value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
