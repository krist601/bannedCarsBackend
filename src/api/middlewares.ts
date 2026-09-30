import {
  authenticate,
  defineMiddlewares,
  type MedusaRequest,
  type AuthenticatedMedusaRequest,
  type MedusaResponse,
  type MedusaNextFunction,
} from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";
import { isCmsAdmin } from "../lib/cms-access";
export default defineMiddlewares({
  routes: [
    { matcher: "/store/auth/google/complete", method: ["POST"], middlewares: [authenticate("customer", ["bearer"], { allowUnregistered: true })] },
    {
      matcher: "/admin/cms*",
      middlewares: [
        authenticate("user", ["bearer", "session"]),
        async (
          req: MedusaRequest,
          res: MedusaResponse,
          next: MedusaNextFunction,
        ) => {
          const user = await req.scope
            .resolve(Modules.USER)
            .retrieveUser(
              (req as AuthenticatedMedusaRequest).auth_context.actor_id,
            );
          if (!isCmsAdmin(user)) {
            res
              .status(403)
              .json({ message: "CMS access requires isAdmin=true." });
            return;
          }
          next();
        },
      ],
    },
  ],
});
