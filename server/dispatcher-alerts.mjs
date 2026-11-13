import {check,fields,uuid} from './errors.mjs'
import {eventDescription} from './notification-messages.mjs'
export async function dispatcherAlerts(client,user,cursor) {
 check(user.role==='dispatcher',403,'Dispatcher authority required')
 if(cursor)uuid(cursor)
 const {rows:[count]}=await client.query(`SELECT count(*)::int AS unread FROM patient_transfer.dispatcher_alerts a
  WHERE NOT EXISTS(SELECT 1 FROM patient_transfer.dispatcher_alert_receipts r WHERE r.alert_id=a.id AND r.user_id=$1)`,[user.id])
 const {rows}=await client.query(`SELECT a.*,r.recorded_at AS acknowledged_at FROM patient_transfer.dispatcher_alerts a
  LEFT JOIN patient_transfer.dispatcher_alert_receipts r ON r.alert_id=a.id AND r.user_id=$1
  WHERE $2::uuid IS NULL OR (a.created_at,a.id)<(SELECT created_at,id FROM patient_transfer.dispatcher_alerts WHERE id=$2)
  ORDER BY a.created_at DESC,a.id DESC LIMIT 51`,[user.id,cursor??null])
 return {unread:count.unread,nextCursor:rows.length>50?rows[49].id:null,alerts:rows.slice(0,50).map(row=>({id:row.id,eventId:row.event_id,
  reference:row.message_data.reference,event:row.message_data.event,status:row.message_data.status,description:eventDescription(row.message_data),
  pickupAt:row.message_data.pickupAt,arrivalAt:row.message_data.arrivalAt,linkPath:row.message_data.linkPath,createdAt:row.created_at,acknowledgedAt:row.acknowledged_at}))}
}
export async function acknowledgeAlert(client,user,id,body,now) {
 check(user.role==='dispatcher',403,'Dispatcher authority required');fields(body,[])
 const {rowCount:exists}=await client.query('SELECT 1 FROM patient_transfer.dispatcher_alerts WHERE id=$1',[uuid(id)])
 check(exists,404,'Alert not found')
 const {rowCount}=await client.query(`INSERT INTO patient_transfer.dispatcher_alert_receipts(alert_id,user_id,recorded_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[id,user.id,now])
 if(rowCount)await client.query(`INSERT INTO patient_transfer.audit_logs(actor_id,action,entity_type,entity_id,reason,recorded_at)
  VALUES($1,'ACK_DISPATCHER_ALERT','dispatcher_alert',$2,'Acknowledged authenticated work alert',$3)`,[user.id,id,now])
 return {acknowledged:true}
}
