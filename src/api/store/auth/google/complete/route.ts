import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";
import { createCustomerAccountWorkflow } from "@medusajs/medusa/core-flows";
import { markEmailVerified } from "../../../../../lib/email-verification";

/** Both identities must be proven: Google via bearer, existing customer via session. */
export async function POST(req: AuthenticatedMedusaRequest<{link?: boolean}>, res: MedusaResponse) {
  if (req.auth_context.auth_provider !== "google") return res.status(403).json({ code: "google_required" });
  const auth = req.scope.resolve(Modules.AUTH);
  const identity = await auth.retrieveAuthIdentity(req.auth_context.auth_identity_id, { relations: ["provider_identities"] });
  const google = identity.provider_identities?.find(provider => provider.provider === "google");
  // The native Google provider verifies signature, issuer, audience and email_verified.
  const email = google?.user_metadata?.email;
  if (typeof email !== "string" || !email) return res.status(400).json({ code: "google_email_missing" });
  const existingId = identity.app_metadata?.customer_id;
  if (req.body?.link === true) {
    const session = req.session?.auth_context;
    if (session?.actor_type !== "customer" || !session.actor_id) return res.status(401).json({ code: "sign_in_to_link" });
    if (existingId && existingId !== session.actor_id) return res.status(409).json({ code: "google_already_linked" });
    const customer = await req.scope.resolve(Modules.CUSTOMER).retrieveCustomer(session.actor_id);
    if (customer.email.toLowerCase() !== email.toLowerCase()) return res.status(409).json({ code: "google_email_mismatch" });
    await auth.updateAuthIdentities({ id: identity.id, app_metadata: { ...identity.app_metadata, customer_id: customer.id } });
    // Google has verified this address and it matches the account, so the account's email is verified too.
    await markEmailVerified(req.scope, customer);
    return res.json({ success: true });
  }
  if (existingId) {
    // A returning Google login: Google vouches for this address, so the account never needs our own confirmation email.
    const owner = await req.scope.resolve(Modules.CUSTOMER).retrieveCustomer(String(existingId)).catch(() => null);
    if (owner && owner.email.toLowerCase() === email.toLowerCase()) await markEmailVerified(req.scope, owner);
    return res.json({ success: true });
  }
  const customers = await req.scope.resolve(Modules.CUSTOMER).listCustomers({ email });
  if (customers.some(customer => customer.has_account)) return res.status(409).json({ code: "sign_in_to_link" });
  await createCustomerAccountWorkflow(req.scope).run({ input: {
    authIdentityId: identity.id,
    customerData: { email, first_name: typeof google?.user_metadata?.given_name === "string" ? google.user_metadata.given_name : undefined, last_name: typeof google?.user_metadata?.family_name === "string" ? google.user_metadata.family_name : undefined }
  } });
  const [created] = await req.scope.resolve(Modules.CUSTOMER).listCustomers({ email });
  if (created) await markEmailVerified(req.scope, created);
  return res.json({ success: true });
}
