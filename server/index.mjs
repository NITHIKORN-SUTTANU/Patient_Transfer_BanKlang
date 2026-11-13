import pg from 'pg'
import { createApi } from './app.mjs'

if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL required')
const port=Number(process.env.API_PORT??3001)
if(!Number.isInteger(port)||port<1||port>65535) throw new Error('Invalid API_PORT')
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:10,connectionTimeoutMillis:10000})
const server=createApi({pool})
server.listen(port,'127.0.0.1',()=>process.stdout.write(`Patient transfer API listening on http://127.0.0.1:${port}\n`))
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>server.close(()=>pool.end().then(()=>process.exit(0))))
