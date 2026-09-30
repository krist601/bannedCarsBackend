const { test } = require('node:test')
const assert = require('node:assert/strict')
const { syncSetDirectory } = require('../src/lib/sync-set-directory')
function setup() {
 const sets=[]; const uploads=[]; const removed=[]
 const catalog={listGames:async filters=>{assert.equal(filters.handle,'magic');return[{id:'game'}]},listCardSets:async(_filters,config)=>sets.slice(config.skip,config.skip+config.take),createCardSets:async data=>{const record={id:`set_${sets.length}`,...data};sets.push(record);return record},updateCardSets:async data=>{const record=sets.find(s=>s.id===data.id);Object.assign(record,data);return record}}
 const files={createFiles:async input=>{uploads.push(input);return{id:'file',url:'https://store.test/icons/abc.svg'}},deleteFiles:async id=>removed.push(id)}
 const container={resolve:key=>key==='tcgCatalog'?catalog:key==='file'?files:{info:()=>{},warn:()=>{}}}
 return {sets,uploads,removed,catalog,files,container}
}
const data={id:'scryfall-id',code:'abc',name:'Example',released_at:'2026-01-01',icon_svg_uri:'https://svgs.scryfall.io/sets/abc.svg',set_type:'expansion',digital:false}
test('sync stores icons once, reuses them, and preserves existing metadata',async t=>{
 const state=setup();t.mock.method(global,'fetch',async url=>String(url).endsWith('/sets')?Response.json({data:[data]}):new Response('<svg xmlns="http://www.w3.org/2000/svg"/>',{headers:{'content-type':'image/svg+xml'}}))
 await syncSetDirectory(state.container);assert.equal(state.sets[0].metadata.isVisible,true);state.sets[0].metadata.isVisible=false;state.sets[0].metadata.custom='keep';await syncSetDirectory(state.container);assert.equal(state.sets[0].metadata.isVisible,false)
 assert.equal(state.sets.length,1);assert.equal(state.uploads.length,1);assert.equal(state.sets[0].metadata.custom,'keep');assert.equal(state.sets[0].metadata.icon_storage_url,'https://store.test/icons/abc.svg');assert.equal(state.uploads[0].access,'public')
})
test('upstream failure keeps previous sets intact',async t=>{
 const state=setup();t.mock.method(global,'fetch',async()=>new Response('',{status:503}));await assert.rejects(syncSetDirectory(state.container),/503/);assert.equal(state.sets.length,0)
})
test('failed icon keeps metadata available and gets retried on the next sync',async t=>{
 const state=setup();let fail=true;t.mock.method(global,'fetch',async url=>String(url).endsWith('/sets')?Response.json({data:[data]}):fail?new Response('',{status:503}):new Response('<svg/>',{headers:{'content-type':'image/svg+xml'}}))
 assert.equal((await syncSetDirectory(state.container)).iconFailures,1);assert.equal(state.sets.length,1);assert.equal(state.sets[0].metadata.icon_storage_url,undefined)
 fail=false;assert.equal((await syncSetDirectory(state.container)).iconFailures,0);assert.equal(state.uploads.length,1)
})
test('failed database write removes the uploaded orphan',async t=>{
 const state=setup();state.catalog.createCardSets=async()=>{throw Error('write failed')};t.mock.method(global,'fetch',async url=>String(url).endsWith('/sets')?Response.json({data:[data]}):new Response('<svg/>',{headers:{'content-type':'image/svg+xml'}}))
 await assert.rejects(syncSetDirectory(state.container),/write failed/);assert.deepEqual(state.removed,['file'])
})
