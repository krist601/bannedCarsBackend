import { ApiKeyType, ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { createApiKeysWorkflow, createStockLocationsWorkflow, linkSalesChannelsToApiKeyWorkflow, linkSalesChannelsToStockLocationWorkflow, linkProductsToSalesChannelWorkflow } from "@medusajs/medusa/core-flows";

export function storeDomain(value: unknown) {
  if (typeof value !== "string") throw new Error("Enter a store domain.");
  const domain = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw new Error("Use a domain such as distritotcg.cl, without a path or port.");
  return domain.replace(/^www\./, "");
}
export async function storeChannels(scope: any) {
  return (await scope.resolve(Modules.SALES_CHANNEL).listSalesChannels({}, {take:1000})).filter((c:any)=>c.metadata?.cms_store);
}
export async function storeLocations(scope: any) {
  return (await scope.resolve(ContainerRegistrationKeys.QUERY).graph({entity:"stock_location",fields:["id","name","sales_channels.id"],pagination:{take:1000}})).data;
}
// Stock receipts must never add a managed store to a warehouse it cannot use.
export async function allowedStockChannels(scope: any, locationId: string, candidates: string[]) {
  const managed = await storeChannels(scope);
  if (!managed.length) return candidates;
  const locations = await storeLocations(scope);
  const assigned = new Set((locations.find((l:any)=>l.id===locationId)?.sales_channels||[]).map((c:any)=>c.id));
  return candidates.filter(id=>!managed.some((c:any)=>c.id===id)||assigned.has(id));
}
export async function productStoreChannels(scope: any, fallback: string) {
  const channels = await storeChannels(scope);
  return channels.length ? channels.map((c:any)=>({id:c.id})) : [{id:fallback}];
}
async function attachCatalog(scope:any,channelId:string) {
  for(let skip=0;;skip+=200) {
    const products=await scope.resolve(Modules.PRODUCT).listProducts({}, {take:200,skip,order:{id:"ASC"}});
    if(products.length) await linkProductsToSalesChannelWorkflow(scope).run({input:{id:channelId,add:products.map((p:any)=>p.id),remove:[]}});
    if(products.length<200) break;
  }
}
export async function readStores(scope:any) {
  const [channels,warehouses]=await Promise.all([storeChannels(scope),storeLocations(scope)]);
  const rows=await Promise.all(channels.map(async(c:any)=>{
    const key=c.metadata.cms_store.api_key_id ? await scope.resolve(Modules.API_KEY).retrieveApiKey(c.metadata.cms_store.api_key_id) : null;
    return {id:c.id,name:c.name,domain:c.metadata.cms_store.domain,publishable_key:key?.token||null,warehouse_ids:warehouses.filter((l:any)=>l.sales_channels?.some((s:any)=>s.id===c.id)).map((l:any)=>l.id)};
  }));
  return {rows,warehouses:warehouses.map((l:any)=>({id:l.id,name:l.name}))};
}
export async function saveStore(scope:any,body:any,actor:string) {
  const domain=storeDomain(body.domain),name=String(body.name||"").trim();
  if(!name||name.length>100) throw new Error("Enter a store name (up to 100 characters).");
  if(!Array.isArray(body.warehouse_ids)||body.warehouse_ids.some((id:any)=>typeof id!=="string"))throw new Error("Select valid warehouses.");
  const locations=await storeLocations(scope);
  if(body.warehouse_ids.some((id:string)=>!locations.some((l:any)=>l.id===id)))throw new Error("Unknown warehouse.");
  const channels=await storeChannels(scope);
  if(channels.some((c:any)=>c.id!==body.id&&c.metadata.cms_store.domain===domain))throw new Error("This domain is already assigned to a store.");
  const service=scope.resolve(Modules.SALES_CHANNEL);
  let channel:any;
  if(body.id) {
    channel=channels.find((c:any)=>c.id===body.id);
    if(!channel)throw new Error("Store not found.");
  } else {
    // Initial Banned Cards setup adopts its existing channel so installed keys keep working.
    const [store]=await scope.resolve(Modules.STORE).listStores({}, {take:1});
    const legacy=domain==="bannedcards.cl"&&store?.default_sales_channel_id&&!channels.some((c:any)=>c.id===store.default_sales_channel_id);
    channel=legacy ? await service.retrieveSalesChannel(store.default_sales_channel_id) : await service.createSalesChannels({name,metadata:{cms_store:{domain}}});
  }
  let keyId=channel.metadata?.cms_store?.api_key_id;
  if(!keyId) {
    const {result}=await createApiKeysWorkflow(scope).run({input:{api_keys:[{title:`${name} storefront`,type:ApiKeyType.PUBLISHABLE,created_by:actor}]}});
    keyId=result[0].id;
    await linkSalesChannelsToApiKeyWorkflow(scope).run({input:{id:keyId,add:[channel.id],remove:[]}});
  }
  await service.updateSalesChannels(channel.id,{name,metadata:{...channel.metadata,cms_store:{domain,api_key_id:keyId}}});
  // Reconcile both additions and removals; other stores on these warehouses are preserved.
  for(const location of locations) {
    const current=location.sales_channels?.some((c:any)=>c.id===channel.id)===true;
    const desired=body.warehouse_ids.includes(location.id);
    if(current!==desired)await linkSalesChannelsToStockLocationWorkflow(scope).run({input:{id:location.id,add:desired?[channel.id]:[],remove:desired?[]:[channel.id]}});
  }
  await attachCatalog(scope,channel.id);
  return channel.id;
}
export async function cmsStores(req:any,res:any) {
  const actor=await req.scope.resolve(Modules.USER).retrieveUser(req.auth_context.actor_id);
  if(actor.metadata?.isAdmin!==true)return res.status(403).json({message:"Only administrators can manage stores and warehouses."});
  try {
    if(req.method!=="GET") await req.scope.resolve(Modules.LOCKING).execute("cms-store-directory",async()=>{
      if(req.body.action==="warehouse_create") {
        const name=String(req.body.name||"").trim();
        if(!name||name.length>100)throw new Error("Enter a warehouse name (up to 100 characters).");
        if((await storeLocations(req.scope)).some((l:any)=>l.name.toLowerCase()===name.toLowerCase()))throw new Error("A warehouse with that name already exists.");
        await createStockLocationsWorkflow(req.scope).run({input:{locations:[{name}]}});
      } else await saveStore(req.scope,req.body,actor.id);
    });
    res.setHeader("Cache-Control","no-store");
    return res.json(await readStores(req.scope));
  } catch(e) {return res.status(400).json({message:(e as Error).message});}
}
