import { Modules } from "@medusajs/framework/utils";
import { CMS_SECTIONS, cmsPermissions } from "./cms-permissions";
export async function cmsUsers(req: any, res: any) {
  const users = req.scope.resolve(Modules.USER);
  const actor = await users.retrieveUser(req.auth_context.actor_id);
  if (!cmsPermissions(actor).admin)
    return res
      .status(403)
      .json({ message: "Only administrators can manage CMS users." });
  const safe = (u: any) => ({
    id: u.id,
    email: u.email,
    name: u.first_name || "",
    ...cmsPermissions(u),
  });
  if (req.method === "GET")
    return res.json({
      rows: (await users.listUsers({}, { take: 1000 })).map(safe),
    });
  try {
    const b = req.body;
    if (
      !Array.isArray(b.sections) ||
      b.sections.some((s: any) => !CMS_SECTIONS.includes(s)) ||
      !Array.isArray(b.warehouseIds) ||
      b.warehouseIds.some((s: any) => typeof s !== "string") ||
      typeof b.enabled !== "boolean"
    )
      throw new Error("Select valid sections, warehouses and access status.");
    const locations = await req.scope
      .resolve(Modules.STOCK_LOCATION)
      .listStockLocations({}, { take: 1000 });
    if (
      b.warehouseIds.some(
        (id: string) => !locations.some((l: any) => l.id === id),
      )
    )
      throw new Error("Unknown warehouse.");
    const access = {
      enabled: b.enabled,
      sections: [...new Set(b.sections)],
      warehouseIds: [...new Set(b.warehouseIds)],
    };
    if (b.action === "user_save") {
      const u = await users.retrieveUser(String(b.user_id));
      if (cmsPermissions(u).admin)
        throw new Error("Administrator permissions cannot be changed here.");
      const updated = await users.updateUsers({
        id: u.id,
        metadata: { ...u.metadata, cmsAccess: access },
      });
      return res.json({ user: safe(updated) });
    }
    const email = String(b.email || "")
      .trim()
      .toLowerCase();
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof b.password !== "string" ||
      b.password.length < 8 ||
      !String(b.name || "").trim()
    )
      throw new Error(
        "Name, valid email and a password of at least 8 characters are required.",
      );
    if ((await users.listUsers({ email })).length)
      throw new Error("This email already exists. Update its access instead.");
    const auth = req.scope.resolve(Modules.AUTH);
    const { authIdentity, error } = await auth.register("emailpass", {
      body: { email, password: b.password },
    });
    if (error || !authIdentity)
      throw new Error(
        "Could not register this email. It may already have a login.",
      );
    const user = await users.createUsers({
      email,
      first_name: String(b.name).trim(),
      metadata: { isAdmin: false, cmsAccess: access },
    });
    await auth.updateAuthIdentities({
      id: authIdentity.id,
      app_metadata: { ...authIdentity.app_metadata, user_id: user.id },
    });
    return res.json({ user: safe(user) });
  } catch (e) {
    return res.status(400).json({ message: (e as Error).message });
  }
}
