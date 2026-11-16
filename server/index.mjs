import pg from 'pg'
import { createApi } from './app.mjs'

if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL required')
const port=Number(process.env.API_PORT??3001)
const host=process.env.API_HOST??'127.0.0.1'
if(!['127.0.0.1','0.0.0.0'].includes(host)) throw new Error('Invalid API_HOST')
if(!Number.isInteger(port)||port<1||port>65535) throw new Error('Invalid API_PORT')
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:10,connectionTimeoutMillis:10000})
const server=createApi({pool})
server.listen(port,host,()=>process.stdout.write(`Patient transfer API listening on ${host}:${port}\n`))
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>server.close(()=>pool.end().then(()=>process.exit(0))))
