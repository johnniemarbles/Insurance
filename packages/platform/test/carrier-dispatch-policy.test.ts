import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { assertExternalCarrierDispatch } from '../src/carrier-dispatch-policy.ts';
const allowed = { environment:'staging' as const, allowExternalDispatch:true, carrierAuthorized:true, destinationVerified:true, sandboxApproved:true, productionApproved:false, changeTicket:'SEC-123' };
test('external carrier dispatch defaults fail closed',()=>{
 for(const patch of [{allowExternalDispatch:false},{carrierAuthorized:false},{destinationVerified:false},{sandboxApproved:false},{changeTicket:null}])
  assert.throws(()=>assertExternalCarrierDispatch({...allowed,...patch}));
});
test('production requires distinct production approval',()=>{
 assert.throws(()=>assertExternalCarrierDispatch({...allowed,environment:'prod',productionApproved:false}));
 assert.doesNotThrow(()=>assertExternalCarrierDispatch({...allowed,environment:'prod',productionApproved:true}));
});
