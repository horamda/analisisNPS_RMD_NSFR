import test from 'node:test';
import assert from 'node:assert/strict';
import {identityResolver} from './claim-identity.mjs';
const base={id:1,dedupe_key:'old-key',source:'BEES_CARE',external_id:'123',customer_id:'13692800002131',opened_at:'2026-09-01T10:00:00Z'};
test('same ticket from another file reuses existing claim and short customer code',()=>{
 assert.equal(identityResolver([base])({...base,source:'SHEET_TICKETS_BEES_CARE',customer_id:'2131',comment:'updated'}).key,'old-key');
});
test('NPS repeated rows do not generate a new claim when comment changes',()=>{
 const resolve=identityResolver([]);const c={...base,source:'NPS',external_id:''};
 assert.equal(resolve(c).key,resolve({...c,comment:'changed',score:1}).key);
});
test('ambiguous existing NPS records are held for review',()=>{
 const c={...base,source:'NPS',external_id:''};
 assert.ok(identityResolver([c,{...c,id:2,dedupe_key:'other'}])(c).conflict);
});
test('cross-type coincidences are held, not silently merged or duplicated',()=>{
 assert.ok(identityResolver([base])({...base,source:'RMD'}).conflict);
});
test('an unrelated customer is a separate complaint',()=>{
 assert.ok(identityResolver([base])({...base,external_id:'999',customer_id:'13692800009999'}).key);
});
test('missing identity is held for review',()=>{
 assert.ok(identityResolver([])({source:'NPS',customer_id:'',opened_at:null,external_id:''}).conflict);
});
