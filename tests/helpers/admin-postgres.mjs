import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { createApi } from '../../server/app.mjs'
import { hashPassword } from '../../server/auth.mjs'
import { migrate } from '../../scripts/database/migrate.mjs'

export const syntheticPassword='Synthetic-Browser-Staff-Password-123'
export async function startAdminTestApi(adminUrl, providers={}) {
  const url=new URL(adminUrl)
  if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('Local test database required')
  const database=`pt_test_${randomUUID().replaceAll('-','')}`
  const admin=new pg.Client({connectionString:adminUrl})
  let created=false,pool,server
  async function close() {
    if(server) {server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
    if(pool) await pool.end()
    if(created) {
      await admin.query(`DROP DATABASE "${database}"`)
    }
    await admin.end()
  }
  try {
    await admin.connect();await admin.query(`CREATE DATABASE "${database}"`);created=true
    url.pathname=`/${database}`;pool=new pg.Pool({connectionString:url.toString()})
    const client=await pool.connect()
    try {
      await migrate(client)
      await client.query('BEGIN')
      await client.query(await readFile(new URL('../../database/seeds/development.sql',import.meta.url),'utf8'))
      await client.query('UPDATE patient_transfer.users SET password_hash=$1 WHERE role IN (\'admin\',\'dispatcher\',\'driver\')',[await hashPassword(syntheticPassword)])
      await client.query('COMMIT')
    } finally {client.release()}
    server=createApi({pool:providers.diagnostics?.pool(pool)??pool,clock:providers.clock??(()=>'2030-01-12T00:00:00Z'),liffId:providers.liffId??'',noticeText:'Synthetic test notice',verifyLine:providers.verifyLine??(async()=>{throw new Error('External LINE disabled in admin test')}),route:providers.route??(async()=>{throw new Error('External routing disabled in admin test')})})
    providers.diagnostics?.server(server)
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
    return {pool,base:`http://127.0.0.1:${server.address().port}`,close}
  } catch(error) {await close();throw error}
}
