const { test } = require('node:test')
const assert = require('node:assert/strict')
const { GET } = require('../src/api/store/tcg/hottest/route')
test('hottest scopes orders to the current store and a rolling 30-day window; paginates',async()=>{
 const calls=[];let result
 const query={graph:async request=>{calls.push(request);return{data:calls.length===1?Array.from({length:500},()=>({status:'pending',payment_collections:[{status:'completed'}],items:[{variant_id:'a',quantity:1}]})):[{status:'pending',payment_collections:[{status:'completed'}],items:[{variant_id:'b',quantity:501}]}]}}}
 const before=Date.now()
 await GET({scope:{resolve:()=>query},publishable_key_context:{sales_channel_ids:['store']}},{setHeader:()=>{},json:value=>{result=value}})
 assert.equal(calls.length,2);assert.equal(calls[1].pagination.skip,500);assert.deepEqual(calls[0].filters.sales_channel_id,['store'])
 const start=Date.parse(calls[0].filters.created_at.$gte);assert.ok(Math.abs(start-(before-30*24*60*60*1000))<2000)
 assert.deepEqual(result.variantIds,['b','a']);assert.equal(Object.hasOwn(result,'orders'),false)
})
test('a key without sales channels cannot read cross-store rankings',async()=>{
 let result;await GET({scope:{resolve:()=>({graph:()=>{throw Error('must not read')}})},publishable_key_context:{sales_channel_ids:[]}},{json:value=>{result=value}});assert.deepEqual(result.variantIds,[])
})
