import type { ExecArgs } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { saveStore,storeChannels,storeLocations } from "../lib/cms-stores";
export default async function configureCmsStores({container}:ExecArgs) {
  const [admin]=(await container.resolve(Modules.USER).listUsers({}, {take:1000})).filter(u=>u.metadata?.isAdmin===true);
  if(!admin)throw new Error("A CMS administrator must exist first.");
  await container.resolve(Modules.LOCKING).execute("cms-store-directory",async()=>{
    const channels=await storeChannels(container);
    const [store]=await container.resolve(Modules.STORE).listStores({}, {take:1});
    const locations=await storeLocations(container);
    for(const entry of [{name:"Banned Cards",domain:"bannedcards.cl",warehouse_ids:locations.filter((l:any)=>l.sales_channels?.some((c:any)=>c.id===store.default_sales_channel_id)).map((l:any)=>l.id)},{name:"Distrito TCG",domain:"distritotcg.cl",warehouse_ids:[]}]) {
      const existing=channels.find((c:any)=>c.metadata.cms_store.domain===entry.domain);
      if(existing?.metadata.cms_store.api_key_id)continue;
      await saveStore(container,{...entry,...(existing?{id:existing.id}: {})},admin.id);
      console.log(`Configured ${entry.name}: ${entry.warehouse_ids.length} warehouses.`);
    }
  });
}
