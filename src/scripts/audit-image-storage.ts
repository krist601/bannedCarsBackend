import type { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
export default async function audit({container}:ExecArgs) {
  const catalog=container.resolve("tcgCatalog") as any;
  const base=process.env.S3_FILE_URL!.replace(/\/$/,"")+"/";
  const stats={cards:0,ownedCardUrls:0,missingCardUrls:0,externalCardUrls:0,sets:0,ownedSetIcons:0,missingSetIcons:0,externalSetIcons:0,products:0,ownedThumbnails:0,externalThumbnails:0};
  let sample="";
  for(let skip=0;;skip+=500){const rows=await catalog.listCardPrintings({}, {take:500,skip,order:{id:"ASC"}});for(const row of rows){stats.cards++;for(const field of ['image_url','image_small_url']){const url=row[field];if(!url)stats.missingCardUrls++;else if(url.startsWith(base)){stats.ownedCardUrls++;sample ||= url;}else stats.externalCardUrls++;}}if(rows.length<500)break;}
  for(let skip=0;;skip+=500){const rows=await catalog.listCardSets({}, {take:500,skip,order:{id:"ASC"}});for(const row of rows){stats.sets++;const url=row.metadata?.icon_storage_url;if(!url)stats.missingSetIcons++;else if(url.startsWith(base))stats.ownedSetIcons++;else stats.externalSetIcons++;}if(rows.length<500)break;}
  const products=container.resolve(Modules.PRODUCT) as any;
  for(let skip=0;;skip+=500){const rows=await products.listProducts({}, {take:500,skip,order:{id:"ASC"}});for(const row of rows){stats.products++;if(row.thumbnail?.startsWith(base))stats.ownedThumbnails++;else if(row.thumbnail)stats.externalThumbnails++;}if(rows.length<500)break;}
  console.log('IMAGE_STORAGE_AUDIT '+JSON.stringify(stats));
  if(sample){const response=await fetch(sample,{method:'HEAD'}); console.log('STORED_IMAGE_HTTP '+response.status);}
}
