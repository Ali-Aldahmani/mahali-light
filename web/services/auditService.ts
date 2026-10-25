import { apiGetWithMeta } from './http';
export type AuditEntityType='invoice'|'customer'|'product'|'category'|'supplier'|'purchase_order'|'return_request'|'return_order'|'stock_count'|'bill'|'journal_entry'|'warranty'|'warranty_claim';
export interface AuditEvent { id:string;entityType:string;entityId:string;action:string;actorId:string|null;actor:string;at:string;oldValue:Record<string,unknown>|null;newValue:Record<string,unknown>|null;notes:string|null;scope:'direct'|'related';relationship:string }
export interface AuditRecord { entityType:AuditEntityType;entityId:string;typeLabel:string;display:string }
export interface AuditQuery { cursor?:string|null;scope?:'all'|'direct'|'related';action?:string;search?:string;from?:string;to?:string;signal?:AbortSignal }
export function getAuditEvents(entityType:AuditEntityType,entityId:string,query:AuditQuery={}){const p=new URLSearchParams({entityType,entityId,limit:'50'});for(const k of ['cursor','scope','action','search','from','to'] as const)if(query[k])p.set(k,String(query[k]));return apiGetWithMeta<AuditEvent[]>(`/audit/events?${p}`,{signal:query.signal});}
