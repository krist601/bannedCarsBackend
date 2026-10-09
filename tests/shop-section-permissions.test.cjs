const {test}=require('node:test');const assert=require('node:assert/strict');
const {canAccessCms}=require('../src/lib/cms-permissions');
const staff=sections=>({metadata:{cmsAccess:{enabled:true,sections,warehouseIds:null}}});
test('custom and accessories reuse product actions with their own section permission',()=>{
 assert.equal(canAccessCms(staff(['custom']),'GET','sealed',undefined,'custom'),true);
 assert.equal(canAccessCms(staff(['custom']),'POST','sealed_create',undefined,'custom'),true);
 assert.equal(canAccessCms(staff(['custom']),'POST','sealed_stock',undefined,'accessories'),false);
 assert.equal(canAccessCms(staff(['sealed']),'GET','sealed',undefined,'custom'),false);
 assert.equal(canAccessCms(staff(['sealed']),'GET','sealed'),true);
 assert.equal(canAccessCms(staff(['custom','accessories']),'POST','sealed_find',undefined,'custom'),false);
 assert.equal(canAccessCms(staff(['sealed']),'POST','sealed_stock',undefined,'bogus'),false);
});
