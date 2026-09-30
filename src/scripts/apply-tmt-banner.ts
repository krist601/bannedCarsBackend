import type {ExecArgs} from '@medusajs/framework/types';
import {sealedFinder} from '../lib/cms-sealed-finder';
export default async function run({container}:ExecArgs){let failed=false;await sealedFinder({scope:container},{status(n:number){failed=n>=400;return this;},json(b:any){console.log('BANNER_RESULT '+JSON.stringify(b));}},{action:'sealed_banner',code:'tmt',asset_id:'6372c9d0b221d85e0658d07b'});if(failed)throw new Error('Banner assignment failed');}
