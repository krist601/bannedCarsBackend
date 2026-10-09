import { backupMaintenanceMiddleware } from "../lib/database-backups";
import {
  authenticate,
  defineMiddlewares,
  type MedusaRequest,
  type AuthenticatedMedusaRequest,
  type MedusaResponse,
  type MedusaNextFunction,
} from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";
import { cmsPermissions, canAccessCms, scopeWarehouseResponse } from "../lib/cms-permissions";
import { storeCartGuard } from "../lib/store-warehouse-scope";
export default defineMiddlewares({
  routes: [
    { matcher: "*", middlewares: [backupMaintenanceMiddleware] },
    { matcher: "/store/auth/google/complete", method: ["POST"], middlewares: [authenticate("customer", ["bearer"], { allowUnregistered: true })] },
    {
      matcher: "/admin/cms*",
      // Product images are sent as base64 JSON (5 MB images).
      bodyParser: { sizeLimit: "10mb" },
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
          const permissions = cmsPermissions(user);
          const key = req.method === "GET" ? String(req.query.resource || "overview") : String((req.body as any)?.action || "");
          if (!canAccessCms(user, req.method, key, (req.body as any)?.location_id || (req.query as any)?.location_id, req.method === "GET" ? (req.query as any)?.section : (req.body as any)?.section)) {
            res
              .status(403)
              .json({ message: "You do not have access to this section or warehouse." });
            return;
          }
          const json = res.json.bind(res);
          res.json = ((data: any) => {
            if (key === "me") data.user = {...data.user, ...permissions};
            if (key === "locations" && permissions.warehouseIds !== null) data.rows = data.rows.filter((l: any) => permissions.warehouseIds!.includes(l.id));
            return json(scopeWarehouseResponse(data, permissions.warehouseIds));
          }) as typeof res.json;
          next();
        },
      ],
    },
    {
      matcher: "/admin*",
      middlewares: [authenticate("user", ["bearer", "session"]), async (req: any, res: any, next: any) => {
        const user = await req.scope.resolve(Modules.USER).retrieveUser(req.auth_context.actor_id);
        // CMS members must not bypass section/warehouse policy through Medusa admin APIs.
        const path = (req.originalUrl || req.path).split("?")[0];
        if (user.metadata?.cmsAccess && user.metadata?.isAdmin !== true && !/^\/admin\/cms\/?$/.test(path))
          return res.status(403).json({message:"This account can only use its assigned CMS sections."});
        next();
      }],
    },
    { matcher: "/store/carts*", middlewares: [storeCartGuard] },
    { matcher: "/store/test-checkout", method: ["GET", "POST"], middlewares: [authenticate("customer", ["session", "bearer"])] },
    { matcher: "/store/webpay/create", method: ["POST"], middlewares: [authenticate("customer", ["session", "bearer"])] },
    { matcher: "/store/email-verification", method: ["GET", "POST"], middlewares: [authenticate("customer", ["session", "bearer"])] },
  ],
});
