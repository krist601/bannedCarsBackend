const {test}=require('node:test');const assert=require('node:assert/strict');
const {cataloguePage}=require('../src/lib/catalogue-page');
const card=(id,extra={})=>({id,variant_id:id,printing_id:id,name:id,set:'Example',set_code:'abc',language:'en',stock:1,price_clp:100,...extra});
test('pages complete printing/language groups without splitting finishes or conditions',()=>{
 const cards=Array.from({length:45},(_,i)=>card(String(i).padStart(2,'0')));
 cards.push(card('foil',{printing_id:'00',finish:'Foil'}),card('lp',{printing_id:'00',condition:'LP'}));
 const first=cataloguePage(cards,{offset:0,limit:40});const second=cataloguePage(cards,{offset:first.nextOffset,limit:40});
 assert.equal(first.count,45);assert.equal(first.cards.length,42);assert.equal(second.cards.length,5);assert.equal(second.nextOffset,null);
 assert.equal(new Set([...first.cards,...second.cards].map(c=>c.id)).size,47);
});
test('filters and price/stock order apply before pagination; hottest preserves complete groups',()=>{
 const cards=[card('a',{price_clp:1000,stock:0}),card('b',{price_clp:200}),card('c',{price_clp:500,set_code:'xyz'}),card('d',{printing_id:'b',price_clp:100,condition:'LP'})];
 assert.equal(cataloguePage(cards,{offset:0,limit:1}).cards[0].id,'c');
 assert.equal(cataloguePage(cards,{offset:0,limit:1,sets:['abc']}).cards[0].id,'b');
 assert.equal(cataloguePage(cards,{offset:0,limit:1,q:'c'}).count,1);
 assert.deepEqual(cataloguePage(cards,{offset:0,limit:1,rankedIds:['b']}).cards.map(c=>c.id),['b','d']);
 assert.equal(cataloguePage(cards,{offset:0,limit:40,rankedIds:[]}).count,0);
});

test('stock filter excludes empty groups before paging but preserves all variants of available cards',()=>{
 const cards=[card('sold',{stock:0}),card('available'),card('sold-foil',{printing_id:'available',stock:0,finish:'Foil'})];
 const result=cataloguePage(cards,{offset:0,limit:1,showOutOfStock:false});
 assert.equal(result.count,1);assert.equal(result.nextOffset,null);assert.equal(result.cards.length,2);
 assert.equal(cataloguePage(cards,{offset:0,limit:40,showOutOfStock:true}).count,2);
 assert.equal(cataloguePage([card('sold',{stock:0})],{offset:0,limit:40,showOutOfStock:false}).count,0);
});

test('latest added uses creation time before price or stock, keeps full groups and paginates',()=>{
 const cards=[card('old',{added_at:'2024-01-01T00:00:00.000Z',price_clp:900}),card('new',{added_at:'2026-01-01T00:00:00.000Z',price_clp:10,stock:0}),card('undated',{added_at:null})];
 assert.equal(cataloguePage(cards,{offset:0,limit:1,sort:'added'}).cards[0].id,'new');
 assert.equal(cataloguePage(cards,{offset:1,limit:1,sort:'added'}).cards[0].id,'old');
 assert.equal(cataloguePage(cards,{offset:0,limit:1,sort:'added',showOutOfStock:false}).cards[0].id,'old');
});
test('release sort orders newest sets first, then most expensive to cheapest',()=>{
 const cards=[card('oldCheap',{released_at:'2020-01-01T00:00:00.000Z',price_clp:10}),card('oldPricey',{released_at:'2020-01-01T00:00:00.000Z',price_clp:900}),card('newCheap',{released_at:'2026-01-01T00:00:00.000Z',price_clp:5}),card('newPricey',{released_at:'2026-01-01T00:00:00.000Z',price_clp:500})];
 assert.deepEqual(cataloguePage(cards,{offset:0,limit:10,sort:'release'}).cards.map(c=>c.id),['newPricey','newCheap','oldPricey','oldCheap']);
});
