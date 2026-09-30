import type {ExecArgs} from '@medusajs/framework/types';
import {getSealed} from '../lib/cms-sealed';
export default async function audit({container}:ExecArgs){
 let result:any;const res={status(code:number){if(code>=400)throw new Error(`HTTP ${code}`);return this;},json(body:any){result=body;}};
 await getSealed({scope:container,query:{}},res);
 console.log('SEALED_AUDIT '+JSON.stringify({count:result.count,categories:result.categories.map((c:any)=>c.name),rows:result.rows.length,variants:result.rows.reduce((n:number,p:any)=>n+p.variants.length,0),sample:result.rows[0]?.title,stockEditable:result.rows[0]?.variants[0]?.stock_editable,price:result.rows[0]?.variants[0]?.price_clp}));
 for(const category of result.categories.filter((c:any)=>c.handle!=='sealed-products')){await getSealed({scope:container,query:{category_id:category.id}},res);console.log('SEALED_GROUP '+category.name+' '+result.count);}
}
