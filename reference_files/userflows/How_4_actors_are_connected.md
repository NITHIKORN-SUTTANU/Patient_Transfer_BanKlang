# How 4 actors are connected

```mermaid

flowchart TD
    CIT["Citizen / Caregiver<br/>LINE LIFF"] -->|Submit valid booking| ENGINE["Scheduling Engine"]
    ENGINE -->|Non-reserving recommendation or warning| DIS["Dispatcher<br/>Staff Portal"]
    DIS -->|Resolve resources and recheck| ENGINE
    DIS -->|Approve, confirm schedule, then assign| DRV["Driver<br/>Mobile Portal"]
    DIS -->|Reject with reason| STATUS["Booking Status / Event History"]
    DRV -->|Start Trip, Depart Origin, pickup, transit, handover| STATUS
    STATUS --> OUTBOX["Notification Outbox"]
    OUTBOX -->|LINE updates| CIT
    ADM["Administrator"] -->|Fleet, geography, closures| ENGINE
    ADM -->|Proposed changes only| DIS
    DIS -->|Confirm replacement after validation| ENGINE
    CIT -->|Cancel only before Start Trip| STATUS
    DRV -->|Failed pickup or incident| DIS
    DIS -->|Failed pickup cancellation with readiness hold| STATUS
    DIS -->|Audited correction, incident resolution or ABORTED disposition| STATUS
    DIS -->|Pre-pickup reassignment; notify both drivers| DRV
    DIS -->|Confirm physical readiness| READY["Resource Availability / Holds"]
    READY --> ENGINE

```
