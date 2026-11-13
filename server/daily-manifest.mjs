import {randomUUID} from 'node:crypto'
import {check,fields} from './errors.mjs'

export function manifestRequest(body) {
 fields(body,['date','format'],['date','format'])
 check(typeof body.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(body.date)&&Number.isFinite(Date.parse(`${body.date}T00:00:00Z`))&&new Date(`${body.date}T00:00:00Z`).toISOString().slice(0,10)===body.date,400,'Valid report date required')
 check(['xlsx','pdf'].includes(body.format),400,'Supported manifest format required')
 return body
}
const currentLabel=(saved,current)=>saved??(current?`${current} [ชื่อปัจจุบัน; ไม่ทราบชื่อ ณ มอบหมาย]`:'ไม่ทราบชื่อ ณ มอบหมาย')
export async function dailyManifest(client,user,date,asOf) {
 check(user.role==='dispatcher',403,'Dispatcher manifest authority required')
 // One SQL statement provides one MVCC dataset, including released committed
 // schedules, actual event history and latest continuation. No UI row limit applies.
 const {rows}=await client.query(`SELECT b.id,b.reference,b.patient_name,b.requester_name,b.contact_phone,b.pickup_address,b.landmark,b.appointment_at,b.status,b.mobility,
  to_json(b.assistance) AS assistance,b.village_id,sv.village_number,sv.name AS village_name,
  ST_Y(b.pickup_point::geometry) AS latitude,ST_X(b.pickup_point::geometry) AS longitude,
  coalesce(json_agg(json_build_object(
   'scheduleId',s.id,'vehicleId',s.vehicle_id,'driverId',s.driver_id,'driverUserId',s.driver_user_snapshot,
   'vehicleName',s.vehicle_name_snapshot,'vehiclePlate',s.vehicle_plate_snapshot,'driverName',s.driver_name_snapshot,
   'currentVehicleName',v.name,'currentVehiclePlate',v.plate,'currentDriverName',u.display_name,
   'originLocationId',s.origin_location_id,'originKind',s.origin_kind,'originName',s.origin_name_snapshot,'currentOriginName',o.name,
   'originLatitude',ST_Y(o.point::geometry),'originLongitude',ST_X(o.point::geometry),'previousBookingId',s.previous_booking_id,
   'hospitalId',s.hospital_id,'hospitalLocationId',s.hospital_location_snapshot,'hospitalName',s.hospital_name_snapshot,
   'recordedHospitalName',CASE WHEN b.hospital_location_snapshot=s.hospital_location_snapshot THEN b.hospital_name_snapshot END,
   'currentHospitalName',h.name,'appointmentAt',s.appointment_at,'departureAt',s.departure_at,'pickupAt',s.pickup_at,'arrivalAt',s.arrival_at,'readyAt',s.ready_at,
   'routedAt',s.routed_at,'releasedAt',s.released_at,'changeReason',s.change_reason
  ) ORDER BY s.routed_at,s.created_at,s.id) FILTER(WHERE s.id IS NOT NULL),'[]'::json) AS assignments,
  (SELECT coalesce(json_agg(json_build_object('version',r.version,'scheduleId',r.schedule_id,'hospitalId',r.hospital_id,'hospitalName',r.hospital_name,
    'hospitalLocationId',r.hospital_location_id,'arrivalAt',r.arrival_at,'readyAt',r.ready_at,'recordedAt',r.recorded_at,'reason',r.reason) ORDER BY r.version),'[]'::json)
   FROM patient_transfer.trip_route_legs r WHERE r.booking_id=b.id) AS route_legs,
  (SELECT coalesce(json_agg(json_build_object('type',e.command,'at',e.recorded_at,'reason',CASE WHEN e.command IN ('REPORT_INCIDENT','RESOLVE_INCIDENT','FAILED_PICKUP','CANCEL','ABORT','MODIFY_ASSIGNMENT','REVISE_DESTINATION','CORRECT_MILESTONE') THEN e.command_data->>'reason' END) ORDER BY e.sequence),'[]'::json)
   FROM patient_transfer.trip_events e WHERE e.booking_id=b.id) AS events,
  (SELECT coalesce(json_agg(json_build_object('id',vl.id,'correctsId',vl.corrects_id,'outcome',vl.outcome,'note',vl.notes,'at',vl.recorded_at,'actorId',vl.actor_id) ORDER BY vl.recorded_at,vl.revision),'[]'::json)
   FROM patient_transfer.verification_logs vl WHERE vl.booking_id=b.id) AS verification
 FROM patient_transfer.bookings b JOIN patient_transfer.service_villages sv ON sv.id=b.village_id
 JOIN patient_transfer.schedules s ON s.booking_id=b.id AND s.committed
 JOIN patient_transfer.vehicles v ON v.id=s.vehicle_id JOIN patient_transfer.drivers d ON d.id=s.driver_id
 LEFT JOIN patient_transfer.users u ON u.id=d.user_id JOIN patient_transfer.locations o ON o.id=s.origin_location_id
 JOIN patient_transfer.hospitals h ON h.id=s.hospital_id
 WHERE b.appointment_at>=($1::date::timestamp AT TIME ZONE 'Asia/Bangkok')
  AND b.appointment_at<((($1::date+1)::timestamp) AT TIME ZONE 'Asia/Bangkok')
 GROUP BY b.id,sv.village_number,sv.name ORDER BY b.appointment_at,b.reference`,[date])
 const entries=rows.map(row=>{
  const assignments=row.assignments.map(a=>({...a,vehicleName:currentLabel(a.vehicleName,a.currentVehicleName),vehiclePlate:currentLabel(a.vehiclePlate,a.currentVehiclePlate),
   driverName:currentLabel(a.driverName,a.currentDriverName),originName:currentLabel(a.originName,a.currentOriginName),
   hospitalName:a.hospitalName??a.recordedHospitalName??currentLabel(null,a.currentHospitalName),legacyLabels:!a.driverName||!a.vehicleName||!a.originName}))
  const latest=assignments.at(-1),leg=row.route_legs.filter(r=>r.scheduleId===latest.scheduleId).at(-1)
  return {id:row.id,reference:row.reference,appointmentAt:row.appointment_at.toISOString(),patientName:row.patient_name,requesterName:row.requester_name,contactPhone:row.contact_phone,
   pickupAddress:row.pickup_address,landmark:row.landmark,latitude:row.latitude,longitude:row.longitude,villageId:row.village_id,villageNumber:row.village_number,villageName:row.village_name,
   mobility:row.mobility,assistance:row.assistance,status:row.status,outcome:row.status==='CANCELLED'?(row.events.some(e=>e.type==='FAILED_PICKUP')?'failed_pickup':'other_cancelled'):row.status.toLowerCase(),
   assignment:latest,assignments,routeLegs:row.route_legs,hospitalName:leg?.hospitalName??latest.hospitalName,
   estimatedArrivalAt:leg?.arrivalAt??latest.arrivalAt,estimatedReadyAt:leg?.readyAt??latest.readyAt,events:row.events,verification:row.verification}
 })
 return {id:randomUUID(),date,asOf,timezone:'Asia/Bangkok',periodStart:`${date}T00:00:00+07:00`,periodEnd:new Date(Date.parse(`${date}T00:00:00+07:00`)+86400000).toISOString(),
  cohort:'Appointment date in Asia/Bangkok; committed assignment history only; includes relevant ended assigned work',entries}
}
export async function auditManifest(client,user,manifest,format,recordedAt=manifest.asOf) {
 await client.query(`INSERT INTO patient_transfer.audit_logs(actor_id,action,entity_type,entity_id,reason,recorded_at,after_data)
  VALUES($1,'EXPORT_DAILY_MANIFEST','report_export',$2,$3,$4,$5)`,[user.id,manifest.id,`Daily ${format} manifest ${manifest.date}`,recordedAt,
  {kind:'daily_manifest',date:manifest.date,format,asOf:manifest.asOf,timezone:manifest.timezone,periodStart:manifest.periodStart,periodEnd:manifest.periodEnd,cohort:manifest.cohort,rowCount:manifest.entries.length}])
}
