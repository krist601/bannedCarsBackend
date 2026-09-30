import type { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
export default async function configureSealedTree({ container }: ExecArgs) {
 const service=container.resolve(Modules.PRODUCT)
 const [root]=await service.listProductCategories({handle:"sealed-products"})
 if(!root)throw new Error("Run configure-sealed-catalogue first.")
 const definitions=[['bundles','Bundles'],['precons','Precons'],['booster-boxes','Booster boxes'],['booster-packs','Booster packs'],['extras','Extras']]
 for(const [slug,name] of definitions){
  const handle=`sealed-${slug}`
  let [category]=await service.listProductCategories({handle})
  if(!category)category=await service.createProductCategories({handle,name,parent_category_id:root.id,is_active:true,is_internal:false,description:slug==='extras'?'Draft Night, Secret Lair drops and bundles, and special releases.':name})
  const demoHandle=slug==='precons'?'demo-sealed-commander-deck':slug==='booster-boxes'?'demo-sealed-booster-box':null
  if(demoHandle){const [product]=await service.listProducts({handle:demoHandle},{relations:['categories']});if(product){await service.updateProducts(product.id,{category_ids:[...new Set([...(product.categories??[]).map(c=>c.id),category.id])],metadata:{...product.metadata,language:'English',set_code:'demo',set:'Demo collection'}})}}
  console.log(`Ready: ${name}`)
 }
}
