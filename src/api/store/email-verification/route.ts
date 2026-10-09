import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { isEmailVerified, sendVerificationEmail } from "../../../lib/email-verification"

const customerOf = (req: AuthenticatedMedusaRequest) => req.scope.resolve(Modules.CUSTOMER).retrieveCustomer(req.auth_context.actor_id)

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customer = await customerOf(req)
  res.json({ verified: isEmailVerified(req.scope, customer), email: customer.email })
}

/** Sends (or resends) the verification email for the signed-in customer. */
export async function POST(req: AuthenticatedMedusaRequest<{ locale?: string }>, res: MedusaResponse) {
  const customer = await customerOf(req)
  if (isEmailVerified(req.scope, customer)) return res.json({ verified: true, sent: false })
  try {
    const result = await sendVerificationEmail(req.scope, customer, req.body?.locale === "en" ? "en" : "es")
    if (!result.sent) return res.status(429).json({ code: "too_soon", retry_after: result.retry_after })
    // Only when explicitly enabled for local testing; never set EMAIL_DEV_MODE on a deployed server.
    return res.json({ sent: true, ...(process.env.EMAIL_DEV_MODE === "true" ? { dev_link: result.link } : {}) })
  } catch {
    return res.status(502).json({ code: "email_unavailable", message: "The verification email could not be sent. Please try again later." })
  }
}
