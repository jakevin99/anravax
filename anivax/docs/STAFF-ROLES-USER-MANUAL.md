# Anivax Health Information System  
## Staff Roles User Manual

**Document title:** Staff Roles User Manual  
**Product:** Anivax  
**Version:** 1.0  
**Audience:** Clinic staff (ADMIN, ENCODER, PROGRAM COORDINATOR)  
**Scope:** Staff accounts only. Patient (phone-based) login is not covered in this manual.

---

## Document control

| Item | Detail |
|------|--------|
| Purpose | Describe staff roles, sign-in, navigation, permissions, and role-specific procedures |
| Roles covered | ADMIN, ENCODER, PROGRAM COORDINATOR |
| Related systems | Anivax web application; REST API (`/api/v1`) |

---

## Table of contents

1. [Introduction](#chapter-1-introduction)  
2. [Getting started — sign-in and navigation](#chapter-2-getting-started--sign-in-and-navigation)  
3. [Understanding permissions](#chapter-3-understanding-permissions)  
4. [Features shared by all staff](#chapter-4-features-shared-by-all-staff)  
5. [ADMIN role guide](#chapter-5-admin-role-guide)  
6. [ENCODER role guide](#chapter-6-encoder-role-guide)  
7. [PROGRAM COORDINATOR role guide](#chapter-7-program-coordinator-role-guide)  
8. [Role comparison at a glance](#chapter-8-role-comparison-at-a-glance)  
9. [Troubleshooting access problems](#chapter-9-troubleshooting-access-problems)  
10. [Appendix — technical reference](#chapter-10-appendix--technical-reference)

---

## Chapter 1. Introduction

### 1.1 Purpose of this manual

This manual explains how staff members use Anivax according to their assigned role. It is written for clinic administrators, encoders, and program coordinators who need clear guidance on what they can do in the system and what is restricted.

After reading this manual, you should be able to:

- Sign in and reach the correct home screen for your role  
- Use the main menu (Home, Schedules, Dashboard, Records)  
- Understand why some actions are blocked for certain roles  
- Follow step-by-step procedures for common tasks  

### 1.2 The three staff roles

Anivax defines three built-in staff roles. Each role is intended for a different level of responsibility.

**ADMIN** — System owner. Manages staff accounts, views patients in the Admin Dashboard, and maintains the single administrator login. Does not perform routine front-desk encoding as a primary duty.

**ENCODER** — Front-desk and records staff. Works the daily queue, registers and retrieves patients, and updates personal information. Cannot change schedules or open clinical history tabs beyond Personal Information.

**PROGRAM COORDINATOR** — Operations lead. Performs encoder duties plus managing appointment schedules in the user interface and accessing full patient history (Doctor's Order and Vaccination). Has user-management rights on the API but not the Admin Dashboard screen.

### 1.3 Where you land after sign-in

| Role | Home screen after login |
|------|-------------------------|
| ADMIN | Admin Dashboard |
| ENCODER | Queue (Home) |
| PROGRAM COORDINATOR | Queue (Home) |

All roles that use the clinical application share the same top navigation when they open Home, Schedules, Dashboard, or Records.

---

## Chapter 2. Getting started — sign-in and navigation

### 2.1 Signing in

**Procedure: Staff sign-in**

1. Open the Anivax login page in your browser.  
2. Enter the **username** supplied by your administrator.  
3. Enter your **password**.  
4. Select **Sign in**.  

**Result**

- If credentials are correct and the account is active, you are signed in.  
- **ADMIN** users are taken to the **Admin Dashboard**.  
- **ENCODER** and **PROGRAM COORDINATOR** users are taken to **Queue (Home)**.  

If sign-in fails, check username and password with your administrator. Inactive accounts cannot sign in.

### 2.2 Default administrator account (first installation only)

On a new installation, one administrator account may exist:

| Field | Value |
|-------|--------|
| Username | admin |
| Password | admin123 |

**Important:** Change this password before using the system in a live clinic. Use **Admin → profile / credentials** after first sign-in.

### 2.3 Main navigation (clinical application)

When you use the clinical areas of Anivax, the top menu includes:

| Menu label | Function | Route |
|------------|----------|-------|
| HOME | Daily queue (waiting patients, follow-ups, requests) | /queue |
| SCHEDULES | View and (for Program Coordinator) manage appointment slots | /schedules |
| DASHBOARD | Statistics and charts | /dashboard |
| RECORDS | Patient registry — search, retrieve, history | /queue/records |

**Signing out**

Open the user menu at the top right (your name) and choose sign out.

---

## Chapter 3. Understanding permissions

### 3.1 How access works

The server controls what each role may do using **authorities** — permission codes linked to roles in the database. The application may apply **additional rules on screen** (for example, only Program Coordinators see **Add Schedule**).

**ADMIN** is special: the system treats ADMIN as having full access. Authority checks do not block ADMIN on the server.

### 3.2 Authority definitions

| Authority code | What it allows |
|----------------|----------------|
| SCHEDULES_READ | View queue, appointments, schedules, patients, doses, inventory, and dashboard statistics |
| SCHEDULES_WRITE | Create, update, and delete clinical data (appointments, profiles, queue actions, and related records) |
| USERS_READ | List user accounts and roles (API) |
| USERS_WRITE | Create, update, and deactivate users; manage role authorities (API) |

### 3.3 Authority assignments (default setup)

| Role | Authorities granted |
|------|---------------------|
| ADMIN | All four; plus full bypass on the server |
| ENCODER | SCHEDULES_READ, SCHEDULES_WRITE |
| PROGRAM COORDINATOR | SCHEDULES_READ, SCHEDULES_WRITE, USERS_READ, USERS_WRITE |

### 3.4 When the screen and the server differ

Some limits exist only in the user interface:

- **Schedules:** Only **PROGRAM COORDINATOR** may add, edit, or delete schedules in the Schedules page, even though ADMIN and ENCODER have schedule write access on the API.  
- **Admin Dashboard:** Only **ADMIN** may use `/admin`; other roles are redirected.  
- **Patient history tabs:** **ENCODER** may open **Personal Information** only; other clinical tabs show an unauthorized message.

Refer to your role chapter and Chapter 8 when in doubt.

---

## Chapter 4. Features shared by all staff

This chapter describes modules available from the main navigation. Role-specific limits are noted where they apply.

### 4.1 Queue (HOME)

The queue is the center of daily clinic operations.

**Tabs**

- **QUEUE** — Patients waiting; includes token, time, vitals, and retrieve actions.  
- **FOLLOW-UP** — Scheduled follow-up visits.  
- **REQUESTS** — Incoming appointment requests.  

**Typical actions**

- Select the working date on the calendar.  
- Search or filter the list.  
- **Retrieve** — Open patient history for an appointment.  
- **Vitals** — Record or view vitals where the column is shown.  
- **Gear menu** — Accept appointment, reschedule, retrieve record, or remove patient (options depend on tab and status).  
- **Call next** — Advance the queue when that control is available.  

### 4.2 Schedules

The Schedules screen lists appointment slots for the selected date: time, date, number of slots, who added the entry, and date added.

- **All staff** may view the table.  
- **Add, edit, and delete** slots in this screen are allowed for **PROGRAM COORDINATOR** only (see Chapter 7).  
- **ADMIN** and **ENCODER** who attempt to add or change schedules here see an **Unauthorized** message.  

### 4.3 Dashboard

The Dashboard provides operational analytics: visit trends (daily, weekly, monthly, annual), and filters such as classification, patient status, age group, and gender. Summary charts support reporting and supervision.

All three staff roles may view the Dashboard (SCHEDULES_READ).

### 4.4 Records

The Records screen is the patient registry.

**You can**

- Search by last name.  
- Sort by name, registration number, or date registered.  
- Use **RETRIEVE RECORD** to open or continue the patient profile (create-profile flow).  
- Use the **history icon** (separate control) to open that patient’s consultation history list.  

### 4.5 Patient history (Retrieve)

Patient history opens from Queue (**Retrieve**) or Records (**RETRIEVE RECORD**).

**Tabs**

| Tab | Contents |
|-----|----------|
| Personal Information | Demographics, document uploads, guardian information |
| Doctor's Order | Clinical orders |
| Vaccination | Vaccination records and related actions |

**Access by role**

- **ENCODER:** Personal Information only.  
- **ADMIN** and **PROGRAM COORDINATOR:** All tabs.  

### 4.6 Related workflows

Depending on clinic process, staff may also use:

- **New consultation** — Register a consultation; optional PDF OCR.  
- **Create profile** — Patient registration and profile editing.  
- **Schedule appointment** — Booking from queue-related flows.  
- **Add user** — Add a patient to the registry.  

These require an active staff session with schedule read/write access (ENCODER and PROGRAM COORDINATOR; ADMIN has full API access).

---

## Chapter 5. ADMIN role guide

### 5.1 Role summary

**Who should use ADMIN**

IT lead or clinic administrator responsible for staff accounts and system-level oversight—not routine front-desk encoding.

**Primary workspace**

Admin Dashboard (exclusive). Clinical navigation (Home, Schedules, Dashboard, Records) remains available if needed.

### 5.2 Capabilities

| Area | What ADMIN can do |
|------|-------------------|
| Admin Dashboard | Full access; other roles cannot stay on this screen |
| Patients | Search and view registered patients (ID, name, age/sex, birthday, date registered) |
| Staffs | Add staff; edit name, username, password, and role; assign ENCODER or PROGRAM COORDINATOR |
| Admin account | Change administrator username and password (only one ADMIN account in the system) |
| Clinical app | Open Home, Schedules, Dashboard, Records from the top menu |
| Patient history | All tabs (Personal Information, Doctor's Order, Vaccination) |
| API | Unrestricted; authority checks do not apply |

### 5.3 Limitations

| Limitation | Explanation |
|------------|-------------|
| Add or edit schedules (Schedules UI) | Only PROGRAM COORDINATOR may modify slots in the Schedules page |
| Second ADMIN account | The system allows only one ADMIN user |
| Assign ADMIN to new staff | ADMIN is not offered in Add/Edit Staff forms |

### 5.4 Typical duties

1. Create **ENCODER** accounts for front-desk staff.  
2. Create **PROGRAM COORDINATOR** accounts for supervisors.  
3. Update or deactivate staff when personnel change.  
4. Rotate the administrator password on a regular schedule.  
5. Review the patient registry in the Patients section.  

### 5.5 Procedure: Add a new staff member

**Prerequisites:** Signed in as ADMIN.

1. Open the **Staffs** section in the Admin Dashboard sidebar.  
2. Select **Add staff** (or the equivalent control).  
3. Enter **first name**, **last name**, **username**, and a **temporary password**.  
4. Select role: **ENCODER** or **PROGRAM COORDINATOR**.  
5. Save the record.  
6. Provide the username and password to the new user through a secure channel.  
7. Instruct the user to sign in and confirm they reach Queue (Home), not the Admin Dashboard.  

### 5.6 Procedure: Change administrator credentials

**Prerequisites:** Signed in as ADMIN.

1. Open the profile or **credentials** option in the Admin Dashboard.  
2. Enter the **current password**.  
3. Enter the new **username** and/or **new password** as required.  
4. Confirm and save.  
5. Sign in again with the new credentials if prompted.  

---

## Chapter 6. ENCODER role guide

### 6.1 Role summary

**Who should use ENCODER**

Front-desk or records staff who register patients, work the queue, and update profiles—but who must not manage schedules or staff accounts.

**Primary workspace**

Queue (Home).

### 6.2 Capabilities

| Area | What ENCODER can do |
|------|---------------------|
| Queue | Full queue operations (tabs, vitals, retrieve, gear actions as shown) |
| Records | Search registry; retrieve record; open consultation history list |
| Schedules | View only |
| Dashboard | View reports and charts |
| Patient profiles | Create and update via retrieve and registration flows |
| Patient history | **Personal Information** tab only |

### 6.3 Limitations

| Limitation | What you will see |
|------------|-------------------|
| Admin Dashboard | Not available; sign-in goes to Queue |
| Add, edit, or delete schedules | Unauthorized alert on Schedules |
| Doctor's Order / Vaccination | Unauthorized alert on those history tabs |
| Staff user management | No access via USERS_READ / USERS_WRITE |

### 6.4 Typical duties

1. **Morning queue** — Home → today’s date → process QUEUE and REQUESTS.  
2. **Register walk-in** — Records or Add user → create profile.  
3. **Continue chart** — Retrieve record → update Personal Information.  
4. **Follow-ups** — Home → FOLLOW-UP tab.  
5. **Reporting** — Dashboard → set filters → review charts.  

### 6.5 Procedure: Retrieve a patient from Records

**Prerequisites:** Signed in as ENCODER.

1. Select **RECORDS** from the top menu.  
2. Optionally search by **last name**.  
3. Locate the patient row.  
4. Select **RETRIEVE RECORD**.  
5. Update fields in **Personal Information** as allowed.  
6. Save changes.  
7. Return to Records or Home as needed.  

### 6.6 Procedure: Process the waiting queue

**Prerequisites:** Signed in as ENCODER.

1. Select **HOME**.  
2. Confirm the calendar shows **today** (or the correct clinic date).  
3. Open the **QUEUE** tab.  
4. For each patient, use **Retrieve**, **Vitals**, or the **gear menu** as required by clinic protocol.  
5. Use **Call next** when the clinic advances the line.  

---

## Chapter 7. PROGRAM COORDINATOR role guide

### 7.1 Role summary

**Who should use PROGRAM COORDINATOR**

Clinic program lead or supervisor who owns appointment schedules, oversees queue and records, and needs full clinical history access. May manage users through the API; staff management in the Admin Dashboard UI remains with ADMIN.

**Primary workspace**

Queue (Home), with regular use of Schedules.

### 7.2 Capabilities

| Area | What PROGRAM COORDINATOR can do |
|------|--------------------------------|
| All ENCODER capabilities | Queue, records, dashboard, profiles |
| Schedules | Add, edit, and delete schedule slots; **+ ADD SCHEDULE** |
| Patient history | Personal Information, Doctor's Order, Vaccination |
| User management (API) | USERS_READ and USERS_WRITE for integrated tools |

### 7.3 Limitations

| Limitation | Explanation |
|------------|-------------|
| Admin Dashboard UI | Sign-in goes to Queue; `/admin` redirects non-ADMIN users |
| Change admin username/password | Reserved for ADMIN on the server |
| Become ADMIN | ADMIN role cannot be assigned through standard staff UI |
| Second ADMIN account | System allows only one ADMIN |

### 7.4 Typical duties

1. Publish and adjust weekly schedule slots.  
2. Supervise queue activity (FOLLOW-UP and REQUESTS).  
3. Review clinical history (Doctor's Order, Vaccination).  
4. Coordinate with ADMIN for new encoder accounts.  

### 7.5 Procedure: Add a schedule

**Prerequisites:** Signed in as PROGRAM COORDINATOR.

1. Select **SCHEDULES** from the top menu.  
2. On the calendar, select the **target date**.  
3. Select **+ ADD SCHEDULE**.  
4. Enter **time** and **number of slots**.  
5. Confirm and save.  
6. Verify the new row appears in the schedules table.  
7. Inform staff that patients may be booked against these slots through queue workflows.  

### 7.6 Procedure: Edit or remove a schedule

**Prerequisites:** Signed in as PROGRAM COORDINATOR.

1. Open **SCHEDULES** and select the date.  
2. On the row to change, open the **gear** (settings) control.  
3. Choose **edit** to change time or slots, or **delete** to remove the slot.  
4. Confirm the action.  
5. Verify the table reflects the update.  

---

## Chapter 8. Role comparison at a glance

Use this table for quick reference.

| Feature | ADMIN | ENCODER | PROGRAM COORDINATOR |
|---------|:-----:|:-------:|:-------------------:|
| Login landing | Admin Dashboard | Queue | Queue |
| Admin Dashboard (screen) | Yes | No | No |
| Manage staff (screen) | Yes | No | No |
| Manage staff (API) | Yes | No | Yes |
| Queue / Records / Dashboard | Yes | Yes | Yes |
| View schedules | Yes | Yes | Yes |
| Modify schedules (screen) | No | No | **Yes** |
| History: Personal Information | Yes | Yes | Yes |
| History: Doctor's Order & Vaccination | Yes | No | Yes |
| Full API authority bypass | Yes | No | No |

---

## Chapter 9. Troubleshooting access problems

### 9.1 Unauthorized user message

If you see **UNAUTHORIZED USER** or cannot complete an action:

1. Confirm you are signed in with the correct username.  
2. Compare the task to Chapter 8.  
3. Ask your **ADMIN** to verify your role (Staffs → edit user).  
4. Sign out and sign in again after any role change.  

### 9.2 Common situations

**ENCODER selects + ADD SCHEDULE**  
Only PROGRAM COORDINATOR may add schedules in the Schedules screen. Ask a Program Coordinator or use Personal Information / queue tasks instead.

**ENCODER opens Vaccination or Doctor's Order**  
Use Personal Information, or ask a Program Coordinator or clinical lead to complete those sections.

**PROGRAM COORDINATOR opens /admin**  
Use the top menu (Home, Schedules, Dashboard, Records). Staff accounts are managed by ADMIN in the Admin Dashboard.

**Action worked yesterday but not today**  
Your account may have been deactivated or your role changed. Contact ADMIN.

---

## Chapter 10. Appendix — technical reference

### 10.1 For system integrators

| Topic | Location / note |
|-------|-----------------|
| API base (development) | http://localhost:4000/api/v1 |
| Role seed data | server/db.js — ADMIN, ENCODER, PROGRAM COORDINATOR |
| Authority enforcement | server/middleware/auth.js |
| UI role checks | SchedulesPage.tsx, RetrieveHistoryPage.tsx, AdminDashboardPage.tsx |

### 10.2 Support contacts

For deployment, account provisioning, and password policy, contact your clinic **ADMIN** or system integrator.

### 10.3 Document history

| Version | Date | Summary |
|---------|------|---------|
| 1.0 | — | Initial manual book format; aligned with seeded roles and current application behavior |

---

*End of manual*
