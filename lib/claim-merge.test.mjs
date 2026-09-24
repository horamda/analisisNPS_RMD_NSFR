import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeClaimRows } from './claim-merge.mjs';
import { inspectRows } from './claim-normalizers.mjs';

test('same survey preserves distinct reasons and source rows',()=>{
  const a={driver_primary:'Entrega',comment:'A',raw:{PRIMARY_DRIVER:'Entrega'}};
  const b={driver_primary:'Precio',comment:'B',raw:{PRIMARY_DRIVER:'Precio'}};
  const merged=mergeClaimRows(mergeClaimRows(a,b),b);
  assert.equal(merged.driver_primary,'Entrega\nPrecio');
  assert.equal(merged.comment,'A\nB');
  assert.equal(merged.raw._source_rows.length,2);
});

test('missing RMD score is counted explicitly instead of silently disappearing',()=>{
  const result=inspectRows('RMD',[{Rmd_rating_id:'1','#SCORE':'','#COMMENT':'Problema'},{Rmd_rating_id:'2','#SCORE':2}]);
  assert.equal(result.claims.length,1);
  assert.deepEqual(result.issues,{'RMD sin puntaje válido':1});
});
