import { check } from './errors.mjs'

export function citizenText(value,field,maximum,optional=false) {
  if(optional&&value===undefined) return ''
  check(typeof value==='string',400,`Invalid ${field}`,{field})
  const normalized=value.trim()
  check((optional||normalized.length>0)&&[...normalized].length<=maximum,400,`Invalid ${field}`,{field})
  return normalized
}

export function citizenFields(body) {
  const patientName=citizenText(body.patientName,'patientName',120)
  const pickupAddress=citizenText(body.pickupAddress,'pickupAddress',1000)
  const landmark=citizenText(body.landmark,'landmark',1000,true)
  check(typeof body.contactPhone==='string',400,'Invalid contact phone',{field:'contactPhone'})
  const contactPhone=body.contactPhone.replace(/[\s-]/g,'').replace(/^\+66/,'0')
  check(/^0[0-9]{9}$/.test(contactPhone),400,'Invalid contact phone',{field:'contactPhone'})
  check(['standard','wheelchair','stretcher'].includes(body.mobility),400,'Invalid mobility',{field:'mobility'})
  for(const [field,maximum] of [['latitude',90],['longitude',180]]) {
    check(Number.isFinite(body[field])&&Math.abs(body[field])<=maximum,400,`Invalid ${field}`,{field})
  }
  const assistance=body.assistance===undefined?[]:body.assistance
  check(Array.isArray(assistance)&&assistance.length<=2&&assistance.every(code=>['boarding_support','caregiver_accompanies'].includes(code))&&new Set(assistance).size===assistance.length,
    400,'Invalid assistance codes',{field:'assistance'})
  return {patientName,pickupAddress,landmark,contactPhone,assistance:[...assistance]}
}
