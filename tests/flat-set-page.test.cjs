const { test } = require('node:test')
const assert = require('node:assert/strict')
const { pageVisibleSets } = require('../src/lib/flat-set-page')
const record = (code, flag, date='2026-01-01') => ({id:code,code,name:code,released_at:date,metadata:{isVisible:flag}})
test('CMS grouping hides the entire disabled family and includes only enabled divisions',()=>{
 const records=[record('hob',true),{...record('hobt',true),metadata:{isVisible:true,parent_set_code:'hob'}},{...record('hobe',true),metadata:{isVisible:true,scryfall_data:{parent_set_code:'hob'}}},{...record('hidden',false),metadata:{isVisible:false,parent_set_code:'hob'}},record('trek',false),{...record('trekt',true),metadata:{isVisible:true,parent_set_code:'trek'}}]
 const page=pageVisibleSets(records,{limit:10,offset:0})
 assert.equal(page.sets.length,1)
 assert.equal(page.sets[0].code,'hob')
 assert.deepEqual(new Set(page.sets[0].setCodes),new Set(['hob','hobt','hobe']))
 assert.equal(pageVisibleSets(records,{limit:10,offset:0,query:'hobe'}).sets[0].code,'hob')
 assert.equal(pageVisibleSets(records,{limit:10,offset:0,query:'hidden'}).sets.length,0)
})
test('flat pages replace ten sets; next/previous offsets and last partial page are correct',()=>{
 const records=Array.from({length:23},(_,i)=>record(String(i).padStart(2,'0'),true))
 const first=pageVisibleSets(records,{limit:10,offset:0});const second=pageVisibleSets(records,{limit:10,offset:first.nextOffset});const last=pageVisibleSets(records,{limit:10,offset:second.nextOffset})
 assert.equal(first.sets.length,10);assert.equal(first.previousOffset,null);assert.equal(second.sets.length,10);assert.equal(second.previousOffset,0);assert.equal(last.sets.length,3);assert.equal(last.nextOffset,null)
 assert.deepEqual(pageVisibleSets(records,{limit:10,offset:second.previousOffset}),first)
 assert.equal(new Set([...first.sets,...second.sets,...last.sets].map(s=>s.code)).size,23)
})
test('search, date sorting, empty visibility and stale offsets are handled before pagination',()=>{
 const records=[record('old',true,'2020-01-01'),record('new',true,'2026-01-01'),record('undated',true,null)]
 assert.deepEqual(pageVisibleSets(records,{limit:10,offset:0}).sets.map(s=>s.code),['new','old','undated'])
 assert.deepEqual(pageVisibleSets(records,{limit:10,offset:0,query:'OLD'}).sets.map(s=>s.code),['old'])
 assert.equal(pageVisibleSets(records,{limit:10,offset:100}).offset,0)
 assert.deepEqual(pageVisibleSets([record('hidden',false)],{limit:10,offset:0}).sets,[])
})
