import type { ExecArgs } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { readFileSync } from "node:fs";
import { cmsUsers } from "../lib/cms-users";
import {
  createStockLocationsWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from "@medusajs/medusa/core-flows";

// Read provisioning data from stdin so passwords never enter source or command arguments.
export default async function configureCmsMember({ container }: ExecArgs) {
  const config = JSON.parse(readFileSync(0, "utf8"));
  const users = container.resolve(Modules.USER);
  const admin = (await users.listUsers({}, { take: 1000 })).find(
    (u) => u.metadata?.isAdmin === true,
  );
  if (!admin) throw new Error("A CMS administrator must exist first.");
  const locations = await container
    .resolve(Modules.STOCK_LOCATION)
    .listStockLocations({}, { take: 1000 });
  if (config.createMissingWarehouses === true) {
    const [channel] = await container
      .resolve(Modules.SALES_CHANNEL)
      .listSalesChannels({}, { take: 1 });
    if (!channel) throw new Error("Configure a sales channel first.");
    for (const name of config.warehouseNames) {
      if (locations.some((l) => l.name === name)) continue;
      const { result } = await createStockLocationsWorkflow(container).run({
        input: { locations: [{ name }] },
      });
      await linkSalesChannelsToStockLocationWorkflow(container).run({
        input: { id: result[0].id, add: [channel.id], remove: [] },
      });
      locations.push(result[0]);
    }
  }
  const warehouseIds = config.warehouseNames.map((name: string) => {
    const matches = locations.filter((l) => l.name === name);
    if (matches.length !== 1)
      throw new Error(`Expected exactly one warehouse named ${name}.`);
    return matches[0].id;
  });
  const [existing] = await users.listUsers({ email: config.email });
  let status = 200;
  await cmsUsers(
    {
      scope: container,
      method: "POST",
      auth_context: { actor_id: admin.id },
      body: {
        action: existing ? "user_save" : "user_create",
        user_id: existing?.id,
        email: config.email,
        name: config.name,
        password: config.password,
        sections: config.sections,
        warehouseIds,
        enabled: true,
      },
    },
    {
      status(code: number) {
        status = code;
        return this;
      },
      json(data: any) {
        if (status !== 200) throw new Error(data.message);
        console.log(
          JSON.stringify({
            user: data.user,
            warehouseNames: config.warehouseNames,
          }),
        );
      },
    },
  );
}
