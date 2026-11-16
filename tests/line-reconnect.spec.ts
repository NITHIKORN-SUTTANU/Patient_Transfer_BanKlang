import {test,expect,type Page} from '@playwright/test'

async function setup(page:Page,{inside=false,expired=false,reject=false}={}) {
  const calls:string[]=[]
  const tokens:string[]=[]
  await page.exposeFunction('lineTestCall',(name:string)=>calls.push(name))
  // Only the external SDK and HTTP responses are synthetic; run the original reconnect adapter and screen.
  await page.route('**/node_modules/.vite/deps/@line_liff.js*',route=>route.fulfill({contentType:'application/javascript',body:`
    export default {
      init:async()=>{},isLoggedIn:()=>true,isInClient:()=>${inside},
      getDecodedIDToken:()=>({exp:Date.now()/1000+${expired?-60:3600}}),
      getIDToken:()=>'synthetic-original-token',logout:()=>window.lineTestCall('logout'),
      login:({redirectUri})=>window.lineTestCall('login:'+redirectUri),
      openWindow:({url})=>window.lineTestCall('external:'+url)
    }`}))
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname
    if(path==='/api/config')return route.fulfill({json:{lineEnabled:true,liffId:'synthetic-liff',noticeVersion:'test',noticeText:'ทดสอบ',contactPhone:'053000000'}})
    if(path==='/api/auth/line'){
      tokens.push(route.request().postDataJSON().idToken)
      return route.fulfill({status:reject?401:200,json:reject?{error:'LINE identity verification failed'}:{token:'synthetic-session'}})
    }
    if(path==='/api/auth/me')return route.fulfill({json:{id:'synthetic-owner',name:'ทดสอบ',role:'citizen'}})
    return route.fulfill({json:{profiles:[],bookings:[],hospitals:[],villages:[]}})
  })
  return {calls,tokens}
}
test('rejected original token offers fresh login rather than repeatedly exchanging it',async({page})=>{
  const f=await setup(page,{reject:true})
  await page.goto('/booking')
  await expect(page.getByRole('status')).toContainText('กรุณายืนยันตัวตนผ่าน LINE ใหม่')
  await page.getByRole('button',{name:'ลองเชื่อมต่อ LINE อีกครั้ง'}).click()
  await expect.poll(()=>f.calls.filter(c=>c==='logout').length).toBe(1)
  await expect.poll(()=>f.calls.some(c=>c.startsWith('login:'))).toBe(true)
  expect(f.tokens).toEqual(['synthetic-original-token'])
})
test('expired LIFF token waits for explicit external recovery and sends no stale exchange',async({page})=>{
  const f=await setup(page,{inside:true,expired:true})
  await page.goto('/booking')
  await expect(page.getByRole('status')).toContainText('กรุณายืนยันตัวตนผ่าน LINE ใหม่')
  expect(f.calls).toEqual([])
  await page.getByRole('button',{name:'ลองเชื่อมต่อ LINE อีกครั้ง'}).click()
  await expect.poll(()=>f.calls.some(c=>c.endsWith('/booking?line_reconnect=1'))).toBe(true)
  expect(f.tokens).toEqual([])
})
test('external recovery marker is consumed once so a fresh callback can reach booking',async({page})=>{
  const f=await setup(page)
  await page.goto('/booking?line_reconnect=1')
  await expect(page).toHaveURL(/\/booking$/)
  await expect.poll(()=>f.calls.filter(c=>c==='logout').length).toBe(1)
  await page.reload()
  await expect(page.getByRole('button',{name:'เริ่มจองรถ →',exact:true})).toBeVisible()
  expect(f.calls.filter(c=>c==='logout')).toHaveLength(1)
  expect(f.tokens).toEqual(['synthetic-original-token'])
})
