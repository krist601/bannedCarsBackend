import type {ExecArgs} from '@medusajs/framework/types';
export default async function audit({container}:ExecArgs){const c:any=container.resolve('tcgCatalog');const [s]=await c.listCardSets({code:'tmt'},{take:1});console.log('TMT_ASSETS '+JSON.stringify({id:s?.id,assets:s?.metadata?.sealed_assets,banner:s?.metadata?.sealed_banner_url}));}
