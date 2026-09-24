import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeSla} from './sla-summary.mjs';

test('SLA excludes unevaluated records and keeps type and period separate', () => {
  const row = {source:'RMD',year:2026,month:9};
  const result = summarizeSla([
    {...row,internal_sla_status:' ok ',total:3},
    {...row,internal_sla_status:'NO OK',total:1},
    {...row,internal_sla_status:null,total:6},
    {...row,source:'NPS',internal_sla_status:'Pendiente',total:2},
    {...row,year:2025,internal_sla_status:'OK',total:1},
    {...row,month:8,internal_sla_status:'NO OK',total:1},
    {...row,year:null,month:null,internal_sla_status:'OK',total:1},
  ]);
  assert.equal(result.length,5);
  assert.equal(result[0].percentage,75);
  assert.equal(result[0].total,10);
  assert.equal(result[0].unknown,6);
  assert.equal(result[1].percentage,null);
  assert.equal(result[2].percentage,100);
  assert.equal(result[3].percentage,0);
  assert.equal(result[4].year,null);
});
