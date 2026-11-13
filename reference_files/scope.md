# Scope Baseline (In-Scope vs. Out-of-Scope)

> Historical seminar scope, superseded for delivery by `docs/requirements/SRS-Complete-Official-EN.md` and the user's production-build instruction. The matrix below is retained as provenance, not a restriction on current implementation. Current work includes full-stack development; live municipal use still requires the SRS release prerequisites. Existing exclusions for shared rides, return trips, clinical integration, payments, and continuous tracking remain.

This document formalizes the scope boundary for the Seminar in Software Engineering course (Academic Year 2569), establishing clear demarcations between seminar research deliverables and future senior project implementations.

## 1. Scope Matrix

| In-Scope (This Seminar Deliverables) | Out-of-Scope (Parked for SP1, 2) |
| :--- | :--- |
| **Formal SRS & Architecture:** Complete SRS detailing core booking, scheduling, and human-in-the-loop dispatch modules. | **Full-Stack Production Coding:** End-to-end backend and frontend software coding and production server deployment. |
| **Single-Occupancy Transit Model:** One-way patient pickup route modeling (Pickup Location → Hospital) for 1 vehicle : 1 patient. | **Return & Transfer Logistics:** Return-trip coordination (Hospital → Home) and inter-hospital patient transfers. |
| **Interactive Map Pinning:** Citizen pickup location pinning via LINE LIFF (HTML5 GPS retrieval & draggable Leaflet/OSM marker). | **Continuous Vehicle Telematics:** Continuous driver GPS telemetry streaming, live vehicle icon tracking, and geofencing. |
| **Deterministic Backward Scheduling:** Route-based duration estimation via OSRM with mandatory 20-minute safety buffer. | **Hardware IoT/OBD Devices:** Vehicle OBD telematics units, dedicated hardware GPS tracking devices, and physical sensor setups. |
| **Discrete Trip State Machine:** Formal 8-stage manual milestone updates managed by drivers without live telemetry streams. | **Clinical System Integration:** Integration with Electronic Health Records (EHR) or hospital diagnostic databases. |
| **Relational Data Modeling:** Normalized PostgreSQL schema for Bookings, Vehicles, Drivers, and Schedules. | **Multi-Stop Shared Pooling:** Multi-passenger shared-ride routing algorithms and corridor grouping. |
| **High-Fidelity Interactive Prototype:** Dual-interface Figma prototype covering Citizen LINE LIFF and Staff Web Portal. | **Commercial Billing Modules:** Tariff calculation, fare collection, payment gateway, or commercial billing logic. |
| **Dual-Axis Empirical Evaluation:** Structured Usability Testing ($n = 10$) and deterministic schedule collision simulations. | **Live Fleet Operations:** Live on-premise municipal deployment and physical passenger transport operations. |

## 2. Scope Clarifications
- **No Live Vehicle Telematics:** Continuous live map tracking (e.g., Grab-style vehicle tracking) is strictly excluded due to municipal hardware constraints and bandwidth overhead. It is replaced by the deterministic 8-stage manual status update model.
- **Seminar Deliverable Focus:** The seminar phase prioritizes requirements validation, mathematical/logical scheduling rigor, and user interface usability testing using interactive Figma prototypes before full-scale coding in Senior Project 1 and 2.
