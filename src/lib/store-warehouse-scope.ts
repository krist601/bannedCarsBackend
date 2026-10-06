import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

export function selectStoreChannel(ids: string[], requested?: unknown) {
  if(requested!==undefined) {
    if(typeof requested!=="string"||!ids.includes(requested))throw new Error("This storefront cannot use the requested store.");
    return requested;
  }
  if(ids.length!==1)throw new Error("Configure a publishable key assigned to exactly one store.");
  return ids[0];
}
export async function storeWarehouseIds(req:any) {
  const channel=selectStoreChannel(req.publishable_key_context?.sales_channel_ids||[],req.query.sales_channel_id);
  const {data}=await req.scope.resolve(ContainerRegistrationKeys.QUERY).graph({entity:"stock_location",fields:["id","sales_channels.id"],pagination:{take:1000}});
  return {channel,locations:data.filter((l:any)=>l.sales_channels?.some((c:any)=>c.id===channel)).map((l:any)=>l.id)};
}
export async function scopeCardListings(req:any,listings:any[],scope?:{channel:string;locations:string[]}) {
  if(!listings.length)return listings;
  const {channel,locations}=scope||await storeWarehouseIds(req);
  if(!locations.length)return listings.map(l=>({...l,quantity:0}));
  const ids=[...new Set(listings.map(l=>l.variant_id).filter(Boolean))];
  const variants=ids.length?(await req.scope.resolve(ContainerRegistrationKeys.QUERY).graph({entity:"product_variant",fields:["id","product.status","product.sales_channels.id","inventory_items.inventory_item_id","inventory_items.required_quantity"],filters:{id:ids}})).data:[];
  const items=[...new Set(variants.flatMap((v:any)=>(v.inventory_items||[]).map((i:any)=>i.inventory_item_id)))];
  const levels:any[]=[];
  if(items.length)for(let skip=0;;skip+=1000) {
    const batch=await req.scope.resolve(Modules.INVENTORY).listInventoryLevels({inventory_item_id:items,location_id:locations},{take:1000,skip});
    levels.push(...batch);if(batch.length<1000)break;
  }
  return listings.map(listing=>{
    const variant=variants.find((v:any)=>v.id===listing.variant_id);
    const permitted=variant?.product?.status==="published"&&variant.product.sales_channels?.some((c:any)=>c.id===channel);
    const links=variant?.inventory_items||[];
    const quantity=permitted&&links.length?Math.min(...links.map((i:any)=>Math.floor(levels.filter(l=>l.inventory_item_id===i.inventory_item_id).reduce((n,l)=>n+Math.max(0,Number(l.available_quantity||0)),0)/Math.max(1,Number(i.required_quantity||1))))):0;
    return {...listing,quantity};
  });
}
// A saved cart belongs to one store; a different store's key cannot reuse it.
export async function storeCartGuard(req:any,res:any,next:any) {
  try {
    const channel=selectStoreChannel(req.publishable_key_context?.sales_channel_ids||[],req.body?.sales_channel_id);
    const path=(req.originalUrl||req.path).split("?")[0];
    const match=path.match(/^\/store\/carts\/([^/]+)/);
    if(match) {
      const cart=await req.scope.resolve(Modules.CART).retrieveCart(decodeURIComponent(match[1]));
      if(cart.sales_channel_id!==channel)return res.status(403).json({message:"This cart belongs to a different store."});
    }
    if(req.method==="POST"&&/^\/store\/carts\/?$/.test(path)) {
      req.body={...req.body,sales_channel_id:channel};
      if(req.validatedBody)req.validatedBody={...req.validatedBody,sales_channel_id:channel};
    }
    next();
  }catch(e){return res.status(403).json({message:(e as Error).message});}
}
