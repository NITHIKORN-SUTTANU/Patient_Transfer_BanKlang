import {test} from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import {monthlyRequest,monthlyReport,monthlyFile,outcomes} from '../server/monthly-report.mjs'

const villages=Array.from({length:12},(_,i)=>({id:`v${i+1}`,number:i+1,name:`หมู่บ้าน ${i+1}`}))
const row=outcome=>({village_id:'v1',mobility:'standard',hospital_id:'h1',hospital_name:'โรงพยาบาล',vehicle_id:null,driver_id:null,outcome,approved:false})
const capture=cohort=>monthlyReport({query:async()=>({rows:[{cohort,villages}]})},{role:'admin'},'2030-12','2030-11-12T00:00:00Z')

test('month contract rejects ambiguous dates, formats and client authority',()=>{
 for(const month of ['2030-00','2030-13','2030-1','0000-01','9999-12','2030-01-01',null])assert.throws(()=>monthlyRequest({month}))
 assert.throws(()=>monthlyRequest({month:'2030-01',format:'pdf'}))
 assert.throws(()=>monthlyRequest({month:'2030-01',role:'admin'}))
 assert.deepEqual(monthlyRequest({month:'2030-02'}),{month:'2030-02'})
})
test('outcomes partition the cohort; approval and cancelled totals are separate; rates use specified denominator',async()=>{
 const cohort=outcomes.map(row);cohort[0].approved=true;cohort[1].approved=true
 const report=await capture(cohort)
 assert.equal(report.summary.requests,12)
 assert.equal(outcomes.reduce((n,key)=>n+report.summary[key],0),12)
 assert.equal(report.summary.approvedActivity,2)
 assert.equal(report.summary.cancelledCombined,2)
 assert.equal(report.summary.completionRate,'33.3')
 assert.equal(report.periodEnd,'2031-01-01T00:00:00+07:00')
 assert.equal(report.villages.length,12)
 assert.equal(report.villages[0].requests,12)
 assert.equal(report.villages[1].completionRate,'N/A')
 for(const dimension of ['hospital','vehicle','driver','mobility','outcome'])assert.equal(report.groups.filter(g=>g.dimension===dimension).reduce((n,g)=>n+g.requests,0),12)
 assert.equal(report.groups.find(g=>g.dimension==='vehicle').key,'unassigned')
 const file=await monthlyFile(report),book=new ExcelJS.Workbook();await book.xlsx.load(file.buffer)
 assert.equal(book.worksheets.length,3)
 const sheet=book.getWorksheet('สรุปบริการ'),header=sheet.getRow(13).values
 assert.equal(sheet.getCell(14,header.indexOf('คำขอทั้งหมด')).value,12)
 assert.equal(sheet.getCell(14,header.indexOf('อัตราสำเร็จ (%)')).value,'33.3')
})
test('empty and excluded-only cohorts have N/A rather than zero; near rounding boundaries remain exact',async()=>{
 assert.equal((await capture([])).summary.completionRate,'N/A')
 assert.equal((await capture([row('rejected'),row('other_cancelled'),row('requested')])).summary.completionRate,'N/A')
 assert.equal((await capture([row('completed')])).summary.completionRate,'100.0')
 assert.equal((await capture([row('aborted')])).summary.completionRate,'0.0')
 assert.equal((await capture([...Array.from({length:2},()=>row('completed')),row('failed_pickup')])).summary.completionRate,'66.7')
})
test('resource attribution counts once per ID and retains distinct recorded labels as literal text',async()=>{
 const a={...row('completed'),vehicle_id:'vehicle',vehicle_name_snapshot:'=HYPERLINK("bad")',vehicle_plate_snapshot:'001'},b={...a,outcome:'aborted',vehicle_name_snapshot:'ชื่อเก่า'}
 const report=await capture([a,b]),group=report.groups.find(g=>g.dimension==='vehicle')
 assert.equal(group.requests,2);assert.match(group.label,/ชื่อเก่า/)
 const book=new ExcelJS.Workbook();await book.xlsx.load((await monthlyFile(report)).buffer)
 const values=book.getWorksheet('โรงพยาบาลและกองรถ').getColumn(3).values
 const text=values.find(v=>typeof v==='string'&&v.includes('HYPERLINK'))
 assert.equal(typeof text,'string')
})
