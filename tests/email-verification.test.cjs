const {test}=require('node:test');const assert=require('node:assert/strict');
const v=require('../src/lib/email-verification');
const Service=require('../src/modules/email-notification/service').default;
const scope=(secret='s3cret',saved=[])=>({resolve:name=>name==='configModule'?{projectConfig:{http:{jwtSecret:secret}}}:name==='customer'?{updateCustomers:async(id,data)=>saved.push({id,data})}:name==='notification'?{createNotifications:async n=>saved.push(n)}:{}});
const customer={id:'cus_1',email:'Ana@Example.com',first_name:'Ana',metadata:{}};
test('tokens round trip, expire and reject tampering or another secret',()=>{
 const token=v.createVerificationToken(scope(),customer,1000);
 assert.deepEqual(v.readVerificationToken(scope(),token,2000),{id:'cus_1',email:'ana@example.com'});
 assert.equal(v.readVerificationToken(scope(),token,1000+24*60*60*1000+1),null);
 assert.equal(v.readVerificationToken(scope('other'),token,2000),null);
 const [payload,sig]=token.split('.');const forged=Buffer.from(JSON.stringify({c:'cus_2',e:'ana@example.com',x:9e15})).toString('base64url')+'.'+sig;
 assert.equal(v.readVerificationToken(scope(),forged,2000),null);
 for(const bad of [undefined,'',123,'a.b','x'.repeat(2000)])assert.equal(v.readVerificationToken(scope(),bad,2000),null);
});
test('verified flag needs the server signature for this id and email',async()=>{
 const saved=[];const s=scope('s3cret',saved);
 assert.equal(v.isEmailVerified(s,customer),false);
 assert.equal(v.isEmailVerified(s,{...customer,metadata:{email_verified_sig:'true'}}),false);
 await v.markEmailVerified(s,customer);
 const sig=saved[0].data.metadata.email_verified_sig;
 assert.equal(v.isEmailVerified(s,{...customer,metadata:{email_verified_sig:sig}}),true);
 assert.equal(v.isEmailVerified(s,{...customer,email:'other@example.com',metadata:{email_verified_sig:sig}}),false);
 assert.equal(v.isEmailVerified(s,{...customer,id:'cus_2',metadata:{email_verified_sig:sig}}),false);
});
test('the emailed link carries a valid token and resends are rate limited',async()=>{
 const saved=[];const s=scope('s3cret',saved);const c={...customer,id:'cus_rate'};
 const first=await v.sendVerificationEmail(s,c,'es',100000);
 assert.equal(first.sent,true);assert.match(first.link,/\/verificar-correo\?token=/);
 const token=decodeURIComponent(first.link.split('token=')[1]);
 assert.equal(v.readVerificationToken(s,token,100001).id,'cus_rate');
 assert.equal(saved[0].to,'Ana@Example.com');assert.match(saved[0].data.subject,/Confirma/);
 const second=await v.sendVerificationEmail(s,c,'es',100000+30000);assert.equal(second.sent,false);assert.equal(second.retry_after,30);
 assert.equal((await v.sendVerificationEmail(s,c,'en',100000+61000)).sent,true);
});
test('email provider logs without a key and posts to Resend with one',async()=>{
 const logs=[];const logger={info:m=>logs.push(m),warn:m=>logs.push(m)};
 const dev=new Service({logger},{});
 assert.match((await dev.send({to:'a@b.cl',channel:'email',template:'t',data:{subject:'Hi',html:'<p>x</p>',link:'http://x/y'}})).id,/^dev-/);assert.match(logs[0],/link=http:\/\/x\/y/);
 const calls=[];const fetcher=async(url,init)=>{calls.push({url,init});return {ok:true,json:async()=>({id:'re_1'})};};
 const live=new Service({logger},{apiKey:'key',from:'Banned Cards <hola@bannedcards.cl>'},fetcher);
 assert.equal((await live.send({to:'a@b.cl',channel:'email',template:'t',data:{subject:'Hi',text:'x'}})).id,'re_1');
 const body=JSON.parse(calls[0].init.body);assert.deepEqual(body.to,['a@b.cl']);assert.equal(body.from,'Banned Cards <hola@bannedcards.cl>');assert.equal(calls[0].init.headers.Authorization,'Bearer key');
 const failing=new Service({logger},{apiKey:'key'},async()=>({ok:false,status:422}));
 await assert.rejects(failing.send({to:'a@b.cl',channel:'email',template:'t',data:{subject:'Hi',text:'x'}}),/HTTP 422/);
 await assert.rejects(dev.send({to:'a@b.cl',channel:'email',template:'t',data:{}}),/subject/);
});
test('email provider can send through Amazon SES with the store sender',async()=>{
 const sent=[];const logger={info(){},warn(){}};
 const ses=new Service({logger},{driver:'ses',from:'Banned Cards <compras@bannedcards.cl>'},fetch,async()=>({send:async command=>{sent.push(command.input);return {MessageId:'ses_1'};}}));
 assert.equal((await ses.send({to:'cliente@example.cl',channel:'email',template:'t',data:{subject:'Hola',html:'<p>x</p>',text:'x'}})).id,'ses_1');
 assert.equal(sent[0].FromEmailAddress,'Banned Cards <compras@bannedcards.cl>');assert.deepEqual(sent[0].Destination.ToAddresses,['cliente@example.cl']);assert.equal(sent[0].Content.Simple.Subject.Data,'Hola');assert.equal(sent[0].Content.Simple.Body.Html.Data,'<p>x</p>');
 const failing=new Service({logger},{driver:'ses',from:'a@b.cl'},fetch,async()=>({send:async()=>{throw new Error('boom');}}));
 await assert.rejects(failing.send({to:'c@d.cl',channel:'email',template:'t',data:{subject:'s',text:'x'}}),/could not send/);
 await assert.rejects(new Service({logger},{driver:'ses'},fetch,async()=>({send:async()=>({})})).send({to:'c@d.cl',channel:'email',template:'t',data:{subject:'s',text:'x'}}),/EMAIL_FROM/);
});
