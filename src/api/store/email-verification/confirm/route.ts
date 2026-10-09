import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { markEmailVerified, readVerificationToken } from "../../../../lib/email-verification"

/** Public: the signed token in the emailed link is the proof. */
export async function POST(req: MedusaRequest<{ token?: string }>, res: MedusaResponse) {
  const claim = readVerificationToken(req.scope, req.body?.token)
  if (!claim) return res.status(400).json({ code: "invalid_or_expired" })
  const customers = req.scope.resolve(Modules.CUSTOMER)
  let customer
  try { customer = await customers.retrieveCustomer(claim.id) } catch { return res.status(400).json({ code: "invalid_or_expired" }) }
  // The address may have changed since the email was sent.
  if (customer.email.toLowerCase() !== claim.email) return res.status(400).json({ code: "invalid_or_expired" })
  await markEmailVerified(req.scope, customer)
  res.json({ verified: true })
}
