const {test}=require('node:test');const assert=require('node:assert/strict');
const {planStock}=require('../src/lib/test-checkout');
const {orderSummaryEmail}=require('../src/lib/order-email');
const {paymentStateOf,setOrderPayment}=require('../src/lib/cms-orders');
const line=(variant_id,quantity,item,extra={})=>({line_id:'l_'+variant_id,variant_id,title:variant_id,quantity,sellable:true,manage_inventory:true,links:[{inventory_item_id:item,required_quantity:1}],...extra});
const level=(item,location,available)=>({inventory_item_id:item,location_id:location,available});
test('plans reservations when every line has stock',()=>{
 const {problems,reservations}=planStock([line('a',2,'ia'),line('b',1,'ib')],[level('ia','w1',5),level('ib','w1',1)]);
 assert.deepEqual(problems,[]);assert.deepEqual(reservations.map(r=>[r.variant_id,r.location_id,r.quantity]),[['a','w1',2],['b','w1',1]]);
});
test('reports how many are really available when a line is short or sold out',()=>{
 const {problems,reservations}=planStock([line('a',4,'ia'),line('b',1,'ib')],[level('ia','w1',2),level('ib','w1',0)]);
 assert.deepEqual(problems.map(p=>[p.variant_id,p.requested,p.available]),[['a',4,2],['b',1,0]]);assert.deepEqual(reservations,[]);
});
test('splits a reservation across warehouses and never double counts shared items',()=>{
 const split=planStock([line('a',5,'ia')],[level('ia','w1',3),level('ia','w2',4)]);
 assert.deepEqual(split.problems,[]);assert.equal(split.reservations.reduce((n,r)=>n+r.quantity,0),5);
 const shared=planStock([line('a',2,'ia'),line('a2',2,'ia')],[level('ia','w1',3)]);
 assert.equal(shared.problems.length,1);assert.equal(shared.problems[0].variant_id,'a2');assert.equal(shared.problems[0].available,1);
});
test('unpublished products and bundles (required quantity) are handled',()=>{
 assert.equal(planStock([line('a',1,'ia',{sellable:false})],[level('ia','w1',9)]).problems[0].available,0);
 const bundle=planStock([line('a',2,'ia',{links:[{inventory_item_id:'ia',required_quantity:3}]})],[level('ia','w1',5)]);
 assert.equal(bundle.problems[0].available,1);
 const untracked=planStock([line('a',9,'ia',{manage_inventory:false})],[]);assert.deepEqual(untracked,{problems:[],reservations:[]});
});
test('summary email lists items, total and a red/green payment state, in both languages',()=>{
 const order={display_id:12,email:'a@b.cl',total:20970,payment_status:'not_paid',customer_name:'Ana <b>',items:[{title:'Sleeves & more',quantity:2,unit_price:8990},{title:'D20',quantity:1,unit_price:2990}]};
 const es=orderSummaryEmail('es',order);
 assert.match(es.subject,/#12/);assert.match(es.html,/Pago pendiente/);assert.match(es.html,/#d64545/);assert.match(es.html,/\$20\.970/);assert.match(es.html,/Sleeves &amp; more/);assert.doesNotMatch(es.html,/<b>/);assert.match(es.text,/2 × Sleeves & more/);
 const en=orderSummaryEmail('en',{...order,payment_status:'paid'});assert.match(en.html,/Paid/);assert.match(en.html,/#2e9e6b/);assert.match(en.subject,/summary/);
});
test('payment state reads metadata first, then Medusa payment status',()=>{
 assert.equal(paymentStateOf({metadata:{payment_status:'paid'}}),'paid');
 assert.equal(paymentStateOf({metadata:{payment_status:'not_paid'},payment_status:'captured'}),'not_paid');
 assert.equal(paymentStateOf({metadata:{},payment_status:'captured'}),'paid');
 assert.equal(paymentStateOf({metadata:null,payment_status:'awaiting'}),'not_paid');
});
test('CMS can mark an order paid or not paid and keeps its other metadata',async()=>{
 const updates=[];const scope={resolve:()=>({retrieveOrder:async id=>{if(id==='missing')throw new Error('nf');return {id,metadata:{test_order:true,payment_status:'not_paid'}};},updateOrders:async(id,data)=>updates.push({id,data})})};
 const run=async body=>{const res={code:200,body:null,status(c){this.code=c;return this;},json(b){this.body=b;return this;}};await setOrderPayment({scope,body},res);return res;};
 const ok=await run({order_id:'o1',paid:true});assert.equal(ok.body.payment_status,'paid');assert.equal(updates[0].data.metadata.test_order,true);assert.equal(updates[0].data.metadata.payment_status,'paid');
 assert.equal((await run({order_id:'o1',paid:'yes'})).code,400);assert.equal((await run({order_id:'missing',paid:true})).code,404);
});
