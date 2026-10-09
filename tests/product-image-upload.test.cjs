const {test}=require('node:test');const assert=require('node:assert/strict');
const {postSealed}=require('../src/lib/cms-sealed');
const png=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.alloc(32)]).toString('base64');
function run(body){
 const files=[];const out={};
 const scope={resolve:name=>name==='file'?{createFiles:async f=>{files.push(f);return {id:'f1',url:`https://files.test/${f.filename}`};}}:name==='product'?{listProductCategories:async()=>[],createProductCategories:async()=>({id:'c1'})}:name==='locking'?{execute:async(_key,fn)=>fn()}:{}};
 const res={code:200,status(c){this.code=c;return this;},json(b){out.body=b;return this;}};
 return postSealed({scope},res,body).then(()=>({res,out,files}));
}
test('uploads a valid PNG into the section folder and returns its URL',async()=>{
 const {out,files}=await run({action:'sealed_image',section:'custom',mime_type:'image/png',content:png});
 assert.equal(out.body.ok,true);assert.match(out.body.url,/products\/custom\/.+\.png$/);assert.equal(files[0].access,'public');
});
test('rejects wrong types, fake images and oversized files',async()=>{
 for(const body of [{mime_type:'image/gif',content:png},{mime_type:'image/png',content:Buffer.from('not an image at all').toString('base64')},{mime_type:'image/png',content:'%%%'},{mime_type:'image/png',content:Buffer.alloc(5*1024*1024+1,1).toString('base64')}]){
  const {res,out,files}=await run({action:'sealed_image',section:'accessories',...body});
  assert.equal(res.code,400,JSON.stringify(out.body));assert.equal(files.length,0);
 }
});
