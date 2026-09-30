import { Modules } from '@medusajs/framework/utils';
import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { sectionDefaults, normalizeSections } from './storefront-sections';
export async function getStorefrontSettings(req: MedusaRequest, res: MedusaResponse) {
  const [store] = await req.scope.resolve(Modules.STORE).listStores({}, {take:1});
  res.setHeader('Cache-Control', 'no-store');
  return res.json({settings:normalizeSections(store?.metadata?.storefront_sections)});
}
export async function saveStorefrontSettings(req: MedusaRequest, res: MedusaResponse, body:Record<string,unknown>) {
  const settings = body.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) || Object.entries(settings).some(([key,value]) => !Object.prototype.hasOwnProperty.call(sectionDefaults,key) || typeof value !== 'boolean')) return res.status(400).json({message:'Settings must contain only known section names and boolean values.'});
  const service = req.scope.resolve(Modules.STORE);
  const [store] = await service.listStores({}, {take:1});
  if (!store) return res.status(404).json({message:'Store not found.'});
  const merged = {...normalizeSections(store.metadata?.storefront_sections), ...settings};
  await service.updateStores(store.id, {metadata:{...store.metadata,storefront_sections:merged}});
  return res.json({settings:merged});
}
