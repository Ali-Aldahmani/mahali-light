import { describe,expect,it } from 'vitest';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { RECORD_TYPES,redact,redactText,decodeCursor }=require('../../server/services/auditService');

describe('record audit service contract',()=>{
  it('supports only explicit record types with record-view permissions',()=>{
    expect(Object.keys(RECORD_TYPES)).toEqual(expect.arrayContaining(['invoice','customer','product','supplier','purchase_order','return_request','return_order','stock_count','bill','journal_entry','warranty','warranty_claim','category']));
    for(const config of Object.values(RECORD_TYPES)){expect(config.permission).toBeTruthy();expect(config.table).toMatch(/^[a-z_]+$/);}
  });
  it('redacts secrets recursively and cost fields without cost permission',()=>{
    const input={password_hash:'hash',token:'secret',name:'Lamp',nested:{card_number:'4111',cost_price:12},lines:[{unit_cost:4,quantity:2}]};
    expect(redact(input,false)).toEqual({password_hash:'[REDACTED]',token:'[REDACTED]',name:'Lamp',nested:{card_number:'[REDACTED]',cost_price:'[REDACTED]'},lines:[{unit_cost:'[REDACTED]',quantity:2}]});
    expect(redact(input,true).nested.cost_price).toBe(12);
    expect(redact(input,true).password_hash).toBe('[REDACTED]');
  });
  it('rejects malformed cursors before querying',()=>{expect(()=>decodeCursor('not-a-cursor')).toThrow(/Invalid audit cursor/);});
  it('redacts obvious credentials embedded in notes',()=>{expect(redactText('reset token=abc123 reason approved')).toBe('reset token=[REDACTED] reason approved');});
});
