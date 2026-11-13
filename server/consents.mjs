import { check, uuid } from './errors.mjs'

export async function requireCurrentConsent(client,user,id,now,noticeVersion) {
  const {rowCount}=await client.query(`SELECT 1 FROM patient_transfer.consent_records
    WHERE id=$1 AND user_id=$2 AND accepted AND notice_version=$3 AND recorded_at<=$4
    AND decision_order=(SELECT max(decision_order) FROM patient_transfer.consent_records WHERE user_id=$2 AND notice_version=$3)`,
  [uuid(id),user.id,noticeVersion,now])
  check(rowCount,422,'Latest accepted decision for current notice required',{field:'consentId'})
}
