const { test } = require('node:test')
const assert = require('node:assert/strict')
const { groupSets, pageGroups, latestSetCodes } = require('../src/lib/set-directory')
const { rankBestSellers } = require('../src/lib/hottest-cards')
const set = (code, released_at, metadata = {}) => ({ id: code, code, name: code, released_at, metadata })
test('official blocks and parent chains group together; newest first; missing dates last', () => {
 const groups = groupSets([set('a','2020-01-01',{block_code:'old',block:'Old block'}),set('b','2020-03-01',{block_code:'old'}),set('c','2026-01-01'),set('tc','2026-02-01',{parent_set_code:'c'}),set('ptc','2026-02-01',{parent_set_code:'tc'}),set('z',null)], '2026-01-15')
 assert.equal(groups.length,3); assert.equal(groups[0].id,'set:c'); assert.equal(groups[0].sets.length,3)
 assert.equal(groups[0].sets[0].upcoming,true); assert.equal(groups[1].name,'Old block'); assert.equal(groups[2].releasedAt,null)
 const first=pageGroups(groups,{limit:2}); assert.equal(first.groups.length,2)
 const next=pageGroups(groups,{limit:1,cursor:first.nextCursor}); assert.equal(next.groups[0].id,'set:z'); assert.equal(next.nextCursor,null)
 assert.equal(pageGroups(groups,{limit:2,query:'ptc'}).groups[0].sets[0].code,'ptc')
 assert.throws(()=>pageGroups(groups,{limit:1,cursor:'missing'}))
})
test('parent cycles terminate and every set remains present',()=>{ const groups=groupSets([set('a',null,{parent_set_code:'b'}),set('b',null,{parent_set_code:'a'})]); assert.equal(groups.flatMap(g=>g.sets).length,2) })
test('latest releases excludes future sets and includes related products',()=>{
 const codes=latestSetCodes([set('a','2025-01-01',{set_type:'expansion'}),set('b','2026-01-01',{set_type:'expansion'}),set('tb','2026-01-01',{parent_set_code:'b'}),set('c','2027-01-01',{set_type:'expansion'})],'2026-06-01')
 assert.deepEqual(new Set(codes),new Set(['a','b','tb']))
})
test('best sellers count paid units, subtract returns, exclude canceled and unpaid orders',()=>{
 const paid={status:'pending',payment_collections:[{status:'completed'}]}
 assert.deepEqual(rankBestSellers([{...paid,items:[{variant_id:'a',quantity:5,detail:{return_received_quantity:4}},{variant_id:'b',quantity:3}]},{...paid,status:'canceled',items:[{variant_id:'c',quantity:100}]},{status:'pending',items:[{variant_id:'d',quantity:100}]}]),['b','a'])
 assert.deepEqual(rankBestSellers([]),[])
})

test('Commander children follow their main release rather than a global Commander group',()=>{
 const groups=groupSets([set('abc','2026-01-01',{set_type:'expansion'}),set('abcc','2026-01-01',{set_type:'commander',block_code:'cmd',block:'Commander',parent_set_code:'abc'}),set('def','2025-01-01',{set_type:'expansion'}),set('defc','2025-01-01',{set_type:'commander',block_code:'cmd',parent_set_code:'def'})]);
 assert.equal(groups.length,2);assert.deepEqual(groups[0].sets.map(s=>s.code),['abc','abcc']);assert.deepEqual(groups[1].sets.map(s=>s.code),['def','defc'])
})
test('core releases remain separate instead of one decades-long Core Set block',()=>{
 const groups=groupSets([set('m21','2020-01-01',{set_type:'core',block_code:'lea'}),set('m20','2019-01-01',{set_type:'core',block_code:'lea'})]);assert.equal(groups.length,2)
})
