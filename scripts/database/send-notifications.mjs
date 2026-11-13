import pg from 'pg'
import { linePushSender } from '../../server/line.mjs'
import { deliverNotifications } from '../../server/notifications.mjs'

let pool
try {
  if(process.env.ALLOW_LINE_DELIVERY!=='true') throw new Error('Set ALLOW_LINE_DELIVERY=true only when external delivery is authorized')
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL required')
  const sender=linePushSender(process.env.LINE_CHANNEL_ACCESS_TOKEN)
  pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2})
  const results=await deliverNotifications(pool,sender)
  process.stdout.write(`Processed ${results.length} outbox records.\n`)
} catch(error) {
  process.stderr.write(`Notification worker stopped: ${error.message}\n`)
  process.exitCode=1
} finally {if(pool) await pool.end()}
