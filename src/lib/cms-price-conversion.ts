/** Apply the minimum before rounding, so the result is always a whole increment. */
export function usdToClp(value: unknown, settings: {rate:number;minimum:number;rounding?:number} = {rate:750,minimum:300,rounding:50}): number | null {
  const text = String(value ?? "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [dollars, fraction = ""] = text.split(".");
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0) return null;
  const rounding = settings.rounding ?? 50;
  const clp = Math.ceil(Math.max(settings.minimum * 100, cents * settings.rate) / (rounding * 100)) * rounding;
  return Number.isSafeInteger(clp) && clp <= 100000000 ? clp : null;
}
