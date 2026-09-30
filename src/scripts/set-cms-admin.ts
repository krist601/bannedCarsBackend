import type { ExecArgs } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
export default async function setCmsAdmin({ container, args }: ExecArgs) {
  const [email, value] = args;
  if (!email || !["true", "false"].includes(value))
    throw new Error(
      "Usage: medusa exec ./src/scripts/set-cms-admin.ts email@example.com true|false",
    );
  const users = container.resolve(Modules.USER);
  const [user] = await users.listUsers({ email });
  if (!user)
    throw new Error(
      "Create the Medusa user first with medusa user -e EMAIL -p PASSWORD",
    );
  await users.updateUsers({
    id: user.id,
    metadata: { ...user.metadata, isAdmin: value === "true" },
  });
  console.log(
    `CMS access ${value === "true" ? "enabled" : "disabled"} for ${email}`,
  );
}
