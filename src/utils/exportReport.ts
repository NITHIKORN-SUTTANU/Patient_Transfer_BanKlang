// ไฟล์: src/utils/exportReport.ts
export function exportBookingsToCSV(bookings: any[], filenamePrefix = "รายงานรับส่งผู้ป่วย_ทต_บ้านกลาง") {
  const headers = [
    "รหัสคำขอ",
    "วันที่นัดหมาย",
    "เวลานัดหมอ",
    "เวลารับผู้ป่วย",
    "ชื่อผู้ป่วย",
    "เบอร์โทรศัพท์",
    "จุดรับ/หมู่บ้าน",
    "โรงพยาบาลปลายทาง",
    "ความช่วยเหลือ",
    "รถที่ได้รับมอบหมาย",
    "พนักงานขับรถ",
    "สถานะ"
  ];

  const rows = bookings.map((item) => [
    item.code || item.id || "-",
    item.appointmentDate || item.date || "-",
    item.appointmentTime || item.time || "-",
    item.pickupTime || "-",
    `"${(item.patientName || item.name || "-").replace(/"/g, '""')}"`,
    `"${item.phone || item.contactPhone || "-"}"`,
    `"${(item.pickupLocation || item.address || "-").replace(/"/g, '""')}"`,
    `"${(item.hospital || "-").replace(/"/g, '""')}"`,
    `"${(item.assistance || item.mobilityAid || "-").replace(/"/g, '""')}"`,
    `"${item.vehicle || item.vehicleName || "-"}"`,
    `"${item.driver || item.driverName || "-"}"`,
    `"${item.status || "-"}"`
  ]);

  const csvContent =
    "\uFEFF" + [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const today = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.setAttribute("download", `${filenamePrefix}_${today}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
