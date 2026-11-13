/** The sender is injected in tests. Calling the configured production sender sends
 * real external messages; the worker is never started by the API automatically.
 */
import {renderNotification} from './notification-messages.mjs'
const delays=[1,5,30,120]
export function sanitizedFailure(code) {
  return typeof code==='string'&&/^(LINE_NETWORK|LINE_DELIVERY_UNCERTAIN|LINE_HTTP_[45]\d\d|NO_VERIFIED_LINE_ACCOUNT|ACCOUNT_INACTIVE|RECIPIENT_ACCESS_CHANGED|RECIPIENT_CHANGED|MESSAGE_PAYLOAD_UNAVAILABLE|MESSAGE_LINK_UNCONFIGURED|RETRY_PAYLOAD_UNKNOWN|RETRY_KEY_EXPIRED|RETRY_HISTORY_UNKNOWN|DELIVERY_FAILED)$/.test(code)?code:'DELIVERY_FAILED'
}
export function retryTime(attempt,now,providerDelay) {
  if(attempt>=5) return null
  const timestamp=Date.parse(now),normal=timestamp+delays[attempt-1]*60000
  let later=0
  if(typeof providerDelay==='string') {
    later=/^\d+$/.test(providerDelay)?timestamp+Number(providerDelay)*1000:Date.parse(providerDelay)
  }
  return new Date(Number.isFinite(later)&&Math.abs(later)<=8.64e15?Math.max(normal,later):normal).toISOString()
}
export async function deliverNotifications(pool,sender,{limit=20,now,clock=()=>new Date().toISOString(),publicAppUrl=process.env.PUBLIC_APP_URL,beforeAttempt}={}) {
  const timestamp=now?()=>now:clock
  const results=[]
  for(let index=0;index<limit;index++) {
    const client=await pool.connect()
    let lockId,releaseError
    try {
      await client.query('BEGIN')
      const startedAt=timestamp()
      const {rows:[notification]}=await client.query(`SELECT n.*,u.line_subject,u.active AS recipient_active,u.role AS recipient_role,b.reference,b.requester_id,
        d.user_id AS current_driver_user FROM patient_transfer.notifications n
        JOIN patient_transfer.users u ON u.id=n.recipient_id JOIN patient_transfer.bookings b ON b.id=n.booking_id
        LEFT JOIN patient_transfer.schedules s ON s.booking_id=b.id AND s.committed AND s.released_at IS NULL
        LEFT JOIN patient_transfer.drivers d ON d.id=s.driver_id
        WHERE n.status IN ('PENDING','FAILED') AND (n.attempts<5 OR n.delivery_in_flight) AND n.next_attempt_at<=$1
        ORDER BY n.created_at,n.id LIMIT 1 FOR UPDATE OF n SKIP LOCKED`,[startedAt])
      if(!notification) {await client.query('COMMIT');break}
      const {rows:[lock]}=await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',[notification.id])
      if(!lock.acquired) {await client.query('ROLLBACK');continue}
      lockId=notification.id
      if(beforeAttempt) await beforeAttempt(client,notification,startedAt)
      if(notification.delivery_in_flight) {
        const expired=!notification.first_attempt_at||Date.parse(startedAt)>=notification.first_attempt_at.getTime()+24*3600000
        const code=expired?'RETRY_KEY_EXPIRED':'LINE_DELIVERY_UNCERTAIN'
        const next=expired?null:retryTime(notification.attempts,startedAt)
        await client.query(`UPDATE patient_transfer.notifications SET status='FAILED',delivery_in_flight=false,last_attempt_at=$2,failure_code=$3,next_attempt_at=$4 WHERE id=$1`,[notification.id,startedAt,code,next])
        await client.query(`INSERT INTO patient_transfer.notification_attempts(notification_id,attempt,attempted_at,outcome,failure_code,next_attempt_at) VALUES($1,$2,$3,$4,$5,$6)`,
          [notification.id,notification.attempts,startedAt,expired?'PERMANENT':'TRANSIENT',code,next])
        await client.query('COMMIT');results.push({id:notification.id,status:'FAILED',retryScheduled:!!next});continue
      }
      // LINE retry keys expire after 24 hours. Unknown legacy retry history or an
      // expired key needs human reconciliation, never a potentially duplicate send.
      if(notification.attempts>0&&(!notification.first_attempt_at||Date.parse(startedAt)>=notification.first_attempt_at.getTime()+24*3600000)) {
        await client.query(`UPDATE patient_transfer.notifications SET status='FAILED',next_attempt_at=NULL,failure_code=$2 WHERE id=$1`,
          [notification.id,notification.first_attempt_at?'RETRY_KEY_EXPIRED':'RETRY_HISTORY_UNKNOWN'])
        await client.query('COMMIT');results.push({id:notification.id,status:'FAILED',retryScheduled:false});continue
      }
      const attempts=notification.attempts+1
      const data=notification.message_data
      const text=notification.message_text??(data?renderNotification(data,publicAppUrl):null)
      let blocked=null
      if(!notification.recipient_active) blocked='ACCOUNT_INACTIVE'
      else if(!/^U[a-f0-9]{32}$/i.test(notification.line_subject??'')) blocked='NO_VERIFIED_LINE_ACCOUNT'
      else if(notification.delivery_subject&&notification.delivery_subject!==notification.line_subject) blocked='RECIPIENT_CHANGED'
      else if(!data) blocked='MESSAGE_PAYLOAD_UNAVAILABLE'
      else if(data&&((data.audience==='citizen'&&(notification.recipient_role!=='citizen'||notification.recipient_id!==notification.requester_id))||
        (data.audience==='driver'&&(notification.recipient_role!=='driver'||(!['COMPLETED','CANCELLED','REJECTED','ABORTED'].includes(data.status)&&data.meaning!=='removed'&&notification.current_driver_user!==notification.recipient_id))))) blocked='RECIPIENT_ACCESS_CHANGED'
      else if(data&&!text) blocked='MESSAGE_LINK_UNCONFIGURED'
      else if(notification.attempts>0&&(!notification.message_text||!notification.delivery_subject)) blocked='RETRY_PAYLOAD_UNKNOWN'
      // Reserve a durable attempt before external I/O. A session lock prevents
      // another live worker from sending concurrently across these transactions.
      // If the process/connection dies, a later worker reconciles the uncertain
      // outcome after 30 seconds; recovery never restores the consumed budget.
      await client.query(`UPDATE patient_transfer.notifications SET status='PENDING',attempts=$2,delivery_in_flight=true,
        first_attempt_at=coalesce(first_attempt_at,$3),last_attempt_at=$3,next_attempt_at=$4,
        message_text=coalesce(message_text,$5),delivery_subject=coalesce(delivery_subject,$6) WHERE id=$1`,
        [notification.id,attempts,startedAt,new Date(Date.parse(startedAt)+30000).toISOString(),text,notification.line_subject])
      await client.query('COMMIT')
      let delivery
      try {
        delivery=!blocked
          ?await sender({recipient:notification.line_subject,text,retryKey:notification.id})
          :{ok:false,retry:false,code:blocked}
      } catch {delivery={ok:false,retry:true,code:'LINE_NETWORK'}}
      const finishedAt=timestamp()
      const accepted=delivery?.ok===true,code=accepted?null:sanitizedFailure(delivery?.code)
      const transient=delivery?.retry===true&&/^(LINE_NETWORK|LINE_HTTP_429|LINE_HTTP_5\d\d)$/.test(code??'')
      const next=!accepted&&transient?retryTime(attempts,finishedAt,delivery.retryAfter):null
      await client.query('BEGIN')
      await client.query(`UPDATE patient_transfer.notifications SET status=$2,attempts=$3,next_attempt_at=$4,sent_at=$5,failure_code=$6,
        delivery_in_flight=false,last_attempt_at=$7 WHERE id=$1`,
        [notification.id,accepted?'SENT':'FAILED',attempts,next,accepted?finishedAt:null,code,finishedAt])
      await client.query(`INSERT INTO patient_transfer.notification_attempts(notification_id,attempt,attempted_at,outcome,failure_code,next_attempt_at) VALUES($1,$2,$3,$4,$5,$6)`,
        [notification.id,attempts,finishedAt,accepted?'ACCEPTED':transient?'TRANSIENT':'PERMANENT',code,next])
      await client.query('COMMIT')
      results.push({id:notification.id,status:accepted?'SENT':'FAILED',retryScheduled:!!next})
    } catch(error) {await client.query('ROLLBACK');throw error}
    finally {
      if(lockId) {try{await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[lockId])}catch(error){releaseError=error}}
      client.release(releaseError)
    }
  }
  return results
}
