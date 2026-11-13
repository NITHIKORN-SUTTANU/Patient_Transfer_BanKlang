export async function catalog(client,user) {
  const {rows:hospitals}=await client.query(`SELECT h.id,h.name,h.location_id,ST_X(l.point::geometry) AS longitude,ST_Y(l.point::geometry) AS latitude
    FROM patient_transfer.hospitals h JOIN patient_transfer.locations l ON l.id=h.location_id WHERE h.active AND l.active ORDER BY h.name`)
  const {rows:villages}=await client.query('SELECT id,village_number AS number,name FROM patient_transfer.service_villages WHERE active ORDER BY village_number')
  const result={hospitals,villages}
  if(['dispatcher','admin'].includes(user.role)) {
    const {rows:vehicles}=await client.query(`SELECT v.id,v.name,v.plate,v.active,to_json(v.capabilities) AS capabilities,
      EXISTS(SELECT 1 FROM patient_transfer.resource_holds h WHERE h.vehicle_id=v.id AND h.ends_at IS NULL) AS held FROM patient_transfer.vehicles v ORDER BY v.name`)
    const {rows:drivers}=await client.query(`SELECT d.id,u.display_name AS name,d.active AND u.active AND u.role='driver' AS active,to_json(d.capabilities) AS capabilities,
      EXISTS(SELECT 1 FROM patient_transfer.resource_holds h WHERE h.driver_id=d.id AND h.ends_at IS NULL) AS held
      FROM patient_transfer.drivers d JOIN patient_transfer.users u ON u.id=d.user_id ORDER BY u.display_name`)
    const {rows:locations}=await client.query('SELECT id,name,kind FROM patient_transfer.locations WHERE active ORDER BY kind,name')
    const {rows:[settings]}=await client.query('SELECT depot_location_id,revision FROM patient_transfer.service_settings')
    const {rows:closures}=await client.query("SELECT to_char(closed_on,'YYYY-MM-DD') AS date,reason FROM patient_transfer.service_closures WHERE active ORDER BY closed_on")
    Object.assign(result,{vehicles,drivers,locations,depotLocationId:settings?.depot_location_id??null,configurationRevision:Number(settings?.revision??0),closures})
    if(user.role==='admin') {
      result.locations=locations.filter(location=>['depot','hospital'].includes(location.kind))
      const {rows:links}=await client.query('SELECT id,user_id,active,phone,revision,location_id,available_at FROM patient_transfer.drivers')
      result.drivers=drivers.map(driver=>{
        const row=links.find(link=>link.id===driver.id)
        return {...driver,accountId:row.user_id,rosterActive:row.active,phone:row.phone,revision:Number(row.revision),locationId:row.location_id,availableAt:row.available_at}
      })
      const {rows:vehicleRows}=await client.query('SELECT id,revision,vehicle_type,location_id,available_at FROM patient_transfer.vehicles')
      result.vehicles=vehicles.map(vehicle=>{
        const row=vehicleRows.find(row=>row.id===vehicle.id)
        return {...vehicle,revision:Number(row.revision),vehicleType:row.vehicle_type,locationId:row.location_id,availableAt:row.available_at}
      })
      const {rows:[configuration]}=await client.query(`SELECT s.depot_name AS center,ST_Y(l.point::geometry) AS latitude,ST_X(l.point::geometry) AS longitude,
        to_char(s.opens_at,'HH24:MI') AS "opensAt",to_char(s.closes_at,'HH24:MI') AS "closesAt"
        FROM patient_transfer.service_settings s JOIN patient_transfer.locations l ON l.id=s.depot_location_id`)
      result.settings=configuration??null
    }
  }
  return result
}
