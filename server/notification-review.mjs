import {check,fields,text,uuid} from './errors.mjs'
import {sanitizedFailure} from './notifications.mjs'

const technicalCodes=['LINE_HTTP_401','LINE_HTTP_403','DELIVERY_FAILED','LINE_DELIVERY_UNCERTAIN','RETRY_KEY_EXPIRED','RETRY_HISTORY_UNKNOWN','MESSAGE_PAYLOAD_UNAVAILABLE','MESSAGE_LINK_UNCONFIGURED','RETRY_PAYLOAD_UNKNOWN']
const technicalSql="n.failure_code IN ('LINE_HTTP_401','LINE_HTTP_403','DELIVERY_FAILED','LINE_DELIVERY_UNCERTAIN','RETRY_KEY_EXPIRED','RETRY_HISTORY_UNKNOWN','MESSAGE_PAYLOAD_UNAVAILABLE','MESSAGE_LINK_UNCONFIGURED','RETRY_PAYLOAD_UNKNOWN')"
export async function notificationFailures(client,user,cursor,service) {
  check(['dispatcher','admin'].includes(user.role),403,'Notification review authority required')
  const admin=user.role==='admin',prefix=admin?'technical_':''
  if(cursor) uuid(cursor)
  const condition=`n.status='FAILED' ${admin?`AND ${technicalSql}`:''}`
  const {rows:[count]}=await client.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE (n.next_attempt_at IS NULL OR n.attempts>=5) AND n.${prefix}reviewed_at IS NULL)::int AS pending FROM patient_transfer.notifications n WHERE ${condition}`)
  const {rows}=await client.query(`SELECT n.*,b.reference,u.role AS recipient_role,r.display_name AS reviewer_name,
    coalesce(r.active AND r.role=$2,false) AS reviewer_active
    FROM patient_transfer.notifications n JOIN patient_transfer.bookings b ON b.id=n.booking_id
    JOIN patient_transfer.users u ON u.id=n.recipient_id LEFT JOIN patient_transfer.users r ON r.id=n.${prefix}claimed_by
    WHERE ${condition} AND ($1::uuid IS NULL OR (n.created_at,n.id)<(SELECT created_at,id FROM patient_transfer.notifications WHERE id=$1))
    ORDER BY n.created_at DESC,n.id DESC LIMIT 51`,[cursor??null,user.role])
  const failures=rows.slice(0,50).map(row=>({id:row.id,revision:Number(row.revision),failureCode:sanitizedFailure(row.failure_code),attempts:row.attempts,
    lastAttemptAt:row.last_attempt_at,nextAttemptAt:row.attempts>=5?null:row.next_attempt_at,terminal:row.next_attempt_at===null||row.attempts>=5,
    claimedBy:row[`${prefix}claimed_by`],reviewerName:row.reviewer_name,reviewerActive:row.reviewer_active,
    isMine:row[`${prefix}claimed_by`]===user.id,reviewedAt:row[`${prefix}reviewed_at`],reviewNote:row[`${prefix}review_note`],
    ...(admin?{}:{bookingId:row.booking_id,reference:row.reference,eventId:row.event_id,recipientId:row.recipient_id,recipientRole:row.recipient_role})}))
  return {failures,total:count.total,pending:count.pending,nextCursor:rows.length>50?rows[49].id:null,...(admin?{service}:{})}
}
export async function reviewNotification(client,user,id,body,now) {
  check(['dispatcher','admin'].includes(user.role),403,'Notification review authority required')
  fields(body,['action','expectedRevision','note'],['action','expectedRevision'])
  check(['claim','review'].includes(body.action),400,'Supported review action required')
  const {rows:[row]}=await client.query('SELECT * FROM patient_transfer.notifications WHERE id=$1 FOR UPDATE',[uuid(id)])
  check(row,404,'Notification not found')
  const admin=user.role==='admin',prefix=admin?'technical_':''
  check(!admin||technicalCodes.includes(row.failure_code),403,'Technical diagnostics only')
  check(row.status==='FAILED'&&(row.next_attempt_at===null||row.attempts>=5),409,'Only terminal failures need manual review')
  check(Number.isSafeInteger(body.expectedRevision)&&body.expectedRevision===Number(row.revision),409,'Notification changed; reload')
  check(!row[`${prefix}reviewed_at`],409,'Failure already reviewed')
  const owner=row[`${prefix}claimed_by`]
  if(body.action==='claim') {
    check(!Object.hasOwn(body,'note'),400,'Claim does not accept a review note')
    if(owner&&owner!==user.id) {
      const {rows:[other]}=await client.query('SELECT active,role FROM patient_transfer.users WHERE id=$1',[owner])
      check(!other?.active||other.role!==user.role,409,'Another active reviewer owns this failure')
    }
    await client.query(`UPDATE patient_transfer.notifications SET ${prefix}claimed_by=$2,${prefix}claimed_at=$3 WHERE id=$1`,[row.id,user.id,now])
  } else {
    check(owner===user.id,403,'Claim this failure before recording review')
    const note=text(body.note,'review and next action',1000)
    await client.query(`UPDATE patient_transfer.notifications SET ${prefix}reviewed_at=$2,${prefix}review_note=$3 WHERE id=$1`,[row.id,now,note])
  }
  // Review records human responsibility; it never marks delivery accepted, resets
  // attempts, resends a message or changes the booking/lifecycle transaction.
  await client.query(`INSERT INTO patient_transfer.audit_logs(actor_id,action,entity_type,entity_id,reason,recorded_at)
    VALUES($1,$2,'notification',$3,$4,$5)`,[user.id,`${admin?'TECHNICAL_':''}NOTIFICATION_${body.action.toUpperCase()}`,row.id,body.action==='review'?body.note.trim():'Claim failure review',now])
  return {recorded:true}
}
