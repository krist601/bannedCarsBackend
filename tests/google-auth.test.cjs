const {test}=require('node:test');
const assert=require('node:assert/strict');
const {POST}=require('../src/api/store/auth/google/complete/route');
function fixture({provider='google',owner,session,link=false,email='customer@example.test',customerEmail=email,accounts=[]}={}){
 const updates=[];
 const req={body:{link},auth_context:{auth_provider:provider,auth_identity_id:'google_identity'},session:{auth_context:session},scope:{resolve(name){
  if(name==='auth')return {retrieveAuthIdentity:async()=>({id:'google_identity',app_metadata:{customer_id:owner},provider_identities:[{provider:'google',user_metadata:{email}}]}),updateAuthIdentities:async value=>updates.push(value)};
  if(name==='customer')return {retrieveCustomer:async id=>({id,email:customerEmail}),listCustomers:async()=>accounts};
  throw new Error(`Unexpected module ${name}`);
 }}};
 const res={code:200,body:null,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 return {req,res,updates};
}
test('completion rejects non-Google identities',async()=>{const f=fixture({provider:'emailpass'});await POST(f.req,f.res);assert.equal(f.res.code,403);});
test('existing Google login uses its customer',async()=>{const f=fixture({owner:'cus_1'});await POST(f.req,f.res);assert.equal(f.res.code,200);assert.equal(f.updates.length,0);});
test('matching email alone never links an existing store account',async()=>{const f=fixture({accounts:[{has_account:true}]});await POST(f.req,f.res);assert.equal(f.res.code,409);assert.equal(f.res.body.code,'sign_in_to_link');});
test('explicit link requires an existing authenticated customer session',async()=>{const f=fixture({link:true});await POST(f.req,f.res);assert.equal(f.res.code,401);});
test('explicit link rejects a Google identity owned by a different customer',async()=>{const f=fixture({link:true,owner:'cus_other',session:{actor_type:'customer',actor_id:'cus_1'}});await POST(f.req,f.res);assert.equal(f.res.code,409);assert.equal(f.updates.length,0);});
test('explicit link rejects different Google and customer emails',async()=>{const f=fixture({link:true,customerEmail:'other@example.test',session:{actor_type:'customer',actor_id:'cus_1'}});await POST(f.req,f.res);assert.equal(f.res.code,409);assert.equal(f.updates.length,0);});
test('explicit link binds verified Google identity to the signed-in customer',async()=>{const f=fixture({link:true,session:{actor_type:'customer',actor_id:'cus_1'}});await POST(f.req,f.res);assert.equal(f.res.code,200);assert.equal(f.updates[0].app_metadata.customer_id,'cus_1');});
