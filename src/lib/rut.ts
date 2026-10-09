/** Chilean RUT helpers (modulo 11). Used to validate the number printed on boletas and facturas. */
export const cleanRut = (value: string) => String(value ?? "").replace(/[^0-9kK]/g, "").toUpperCase()

export function isValidRut(value: unknown): boolean {
  if (typeof value !== "string") return false
  const rut = cleanRut(value)
  if (rut.length < 8 || rut.length > 9) return false
  const body = rut.slice(0, -1), check = rut.slice(-1)
  if (!/^\d+$/.test(body)) return false
  let sum = 0, factor = 2
  for (let index = body.length - 1; index >= 0; index--) { sum += Number(body[index]) * factor; factor = factor === 7 ? 2 : factor + 1 }
  const expected = 11 - (sum % 11)
  return check === (expected === 11 ? "0" : expected === 10 ? "K" : String(expected))
}

/** 12345678-5 → 12.345.678-5 */
export function formatRut(value: string): string {
  const rut = cleanRut(value)
  if (rut.length < 2) return rut
  const body = rut.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  return `${body}-${rut.slice(-1)}`
}
