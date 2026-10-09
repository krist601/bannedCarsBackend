import { createHmac, timingSafeEqual } from "node:crypto"
import { Modules } from "@medusajs/framework/utils"

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000
const SIGNATURE_KEY = "email_verified_sig"
const lastSent = new Map<string, number>()

const sign = (secret: string, value: string) => createHmac("sha256", secret).update(value).digest("base64url")
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
const secretOf = (scope: any) => String(scope.resolve("configModule").projectConfig?.http?.jwtSecret || "supersecret")
export const storefrontUrl = () => (process.env.STOREFRONT_URL || (process.env.STORE_CORS || "http://localhost:3000").split(",")[0]).trim().replace(/\/$/, "")

/** The proof of verification is a signature only the server can produce, so customers cannot set it through their own metadata. */
export function verificationSignature(scope: any, customer: { id: string; email: string }) {
  return sign(secretOf(scope), `verified:${customer.id}:${customer.email.toLowerCase()}`)
}
export function isEmailVerified(scope: any, customer: { id: string; email: string; metadata?: Record<string, unknown> | null }) {
  const saved = customer.metadata?.[SIGNATURE_KEY]
  return typeof saved === "string" && equal(saved, verificationSignature(scope, customer))
}
export async function markEmailVerified(scope: any, customer: { id: string; email: string; metadata?: Record<string, unknown> | null }) {
  if (isEmailVerified(scope, customer)) return
  await scope.resolve(Modules.CUSTOMER).updateCustomers(customer.id, { metadata: { ...customer.metadata, [SIGNATURE_KEY]: verificationSignature(scope, customer) } })
}
export function createVerificationToken(scope: any, customer: { id: string; email: string }, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ c: customer.id, e: customer.email.toLowerCase(), x: now + TOKEN_TTL_MS })).toString("base64url")
  return `${payload}.${sign(secretOf(scope), `token:${payload}`)}`
}
/** Returns the customer id and email the token was issued for, or null when it is forged, malformed or expired. */
export function readVerificationToken(scope: any, token: unknown, now = Date.now()): { id: string; email: string } | null {
  if (typeof token !== "string" || token.length > 1000) return null
  const [payload, signature] = token.split(".")
  if (!payload || !signature || !equal(signature, sign(secretOf(scope), `token:${payload}`))) return null
  try {
    const { c, e, x } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
    return typeof c === "string" && typeof e === "string" && typeof x === "number" && x > now ? { id: c, email: e } : null
  } catch { return null }
}

export function verificationEmail(locale: "es" | "en", link: string, name?: string | null) {
  const es = locale !== "en"
  const greeting = name ? (es ? `Hola ${name},` : `Hi ${name},`) : (es ? "Hola," : "Hi,")
  const subject = es ? "Confirma tu correo en Banned Cards" : "Confirm your email at Banned Cards"
  const body = es
    ? ["Gracias por crear tu cuenta en Banned Cards. Para confirmar tu correo, usa el siguiente botón:", "Confirmar mi correo", "Este enlace vence en 24 horas. Si tú no creaste esta cuenta, puedes ignorar este mensaje."]
    : ["Thanks for creating your Banned Cards account. To confirm your email, use the button below:", "Confirm my email", "This link expires in 24 hours. If you didn't create this account, you can ignore this message."]
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;color:#1c1c22;line-height:1.5"><h2 style="margin:0 0 16px">Banned Cards</h2><p>${greeting}</p><p>${body[0]}</p><p style="margin:24px 0"><a href="${link}" style="background:#6d3df0;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">${body[1]}</a></p><p style="font-size:13px;color:#555">${body[2]}</p><p style="font-size:12px;color:#777;word-break:break-all">${link}</p></div>`
  return { subject, html, text: `${greeting}\n\n${body[0]}\n${link}\n\n${body[2]}` }
}

export async function sendVerificationEmail(scope: any, customer: { id: string; email: string; first_name?: string | null }, locale: "es" | "en", now = Date.now()) {
  const previous = lastSent.get(customer.id)
  if (previous && now - previous < 60_000) return { sent: false as const, retry_after: Math.ceil((60_000 - (now - previous)) / 1000) }
  lastSent.set(customer.id, now)
  const link = `${storefrontUrl()}/verificar-correo?token=${encodeURIComponent(createVerificationToken(scope, customer, now))}`
  try {
    await scope.resolve(Modules.NOTIFICATION).createNotifications({ to: customer.email, channel: "email", template: "email-verification", data: { ...verificationEmail(locale, link, customer.first_name), link } })
  } catch (error) {
    lastSent.delete(customer.id)
    throw error
  }
  return { sent: true as const, link }
}
