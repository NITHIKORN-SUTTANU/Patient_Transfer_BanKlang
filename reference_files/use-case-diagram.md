# Maintained Use-Case Diagram

The PNG is a historical export. This source reflects the original 29 stable use-case IDs and current ownership. Approval does not include justification. Dispatcher owns UC-28; administrator initiates settings changes. Incident handling, corrections, readiness and ABORTED are extensions of UC-15/UC-20/UC-23; holiday administration extends UC-22. These extensions follow SRS Sections 16.11–16.12.

```mermaid
flowchart LR
  CIT[Citizen / Caregiver]
  DIS[Municipal Dispatcher]
  DRV[Driver]
  ADM[Administrator]
  subgraph SYSTEM[Municipal Patient Transit Platform]
    UC01([UC-01 Submit Booking Request])
    UC02([UC-02 Specify Mobility Assistance])
    UC03([UC-03 Pin Pickup Location])
    UC04([UC-04 Review Confirmation Card])
    UC05([UC-05 Review Pickup Time])
    UC06([UC-06 Review Notifications])
    UC07([UC-07 Triage Requests])
    UC08([UC-08 Review Assignment])
    UC09([UC-09 Evaluate Warnings])
    UC10([UC-10 Approve Request])
    UC11([UC-11 Modify Request])
    UC12([UC-12 Reject Request])
    UC13([UC-13 Log Justification])
    UC14([UC-14 Monitor Fleet Schedule])
    UC15([UC-15 Handle Cancellation / Incident Outcome])
    UC16([UC-16 Handle Reassignment])
    UC17([UC-17 View Daily Schedule])
    UC18([UC-18 View Pickup Location])
    UC19([UC-19 View Mobility Aids])
    UC20([UC-20 Record Execution Milestones])
    UC21([UC-21 Maintain Fleet Data])
    UC22([UC-22 Configure Geography / Closures])
    UC23([UC-23 Audit Transaction History])
    UC24([UC-24 Manage Roles / Access])
    UC25([UC-25 Cancel Booking])
    UC26([UC-26 Resolve Resource Conflicts])
    UC27([UC-27 Report Failed Pickup])
    UC28([UC-28 Confirm Recalculated Schedule])
    UC29([UC-29 Safeguard Resource / Account Changes])
  end
  CIT --- UC01 & UC04 & UC05 & UC06 & UC25
  DIS --- UC07 & UC08 & UC09 & UC10 & UC11 & UC12 & UC13 & UC14 & UC15 & UC16 & UC26 & UC28
  DRV --- UC17 & UC18 & UC19 & UC20 & UC27
  ADM --- UC21 & UC22 & UC23 & UC24 & UC29
  UC01 -. include .-> UC02
  UC01 -. include .-> UC03
  UC11 -. include .-> UC13
  UC12 -. include .-> UC13
  UC09 -. extend .-> UC08
```
