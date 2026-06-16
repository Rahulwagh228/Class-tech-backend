# Classsly — Complete Product Knowledge Base
> Version: June 2026 | For use in RAG embeddings pipeline

---

## 1. Product Overview

Classsly is an all-in-one SaaS platform built for modern coaching institutes in India. It helps coaching classes manage their day-to-day operations — from student attendance and batch scheduling to exam results, parent communication, and learning resources — all from a single, beautifully designed dashboard.

Classsly is mobile-first and web-based, designed to work without any technical setup. An institute can go from sign-up to running live classes in under 10 minutes.

**Tagline:** Run your coaching class beautifully. Effortlessly. Everywhere.

**Website:** https://classsly.in

**Target Users:** Coaching institutes, tutoring centers, private academies across India.

---

## 2. Key Value Propositions

- All operations in one platform — no juggling between apps
- Separate portals for admins, teachers, students, and parents
- Mobile apps available for students and parents (Android & iOS)
- Automated alerts and reports reduce manual work
- Parent app launched on both Android and iOS
- 500+ institutes trust Classsly
- 14-day free trial, no credit card needed
- No setup fees, no developers needed

---

## 3. User Roles & Portals

Classsly supports four distinct login types, each with a tailored experience.

### 3.1 Admin Portal
The admin is typically the institute owner or director. They have full control over the platform.

**Responsibilities & Capabilities:**
- Set up the institute profile, subjects, and academic schedule
- Create and manage batches (group students by class, subject, or time slot)
- Add and manage teachers and students
- Invite parents and manage parent accounts
- View attendance reports across all batches and teachers
- Monitor exam schedules and results
- Access overall student progress and performance analytics
- Manage fee collection and dues
- Configure announcements and notifications

### 3.2 Teacher Portal
Teachers get a focused set of tools to manage their batches without paperwork.

**Capabilities — Currently Built:**
- Mark student attendance in one tap (for their assigned batches)
- Upload practice papers, mock tests, and study notes
- Create and schedule exams
- Enter and publish exam results
- Track batch-level performance
- Send announcements to students and parents

**Capabilities — Yet to Be Built:**
- Teacher attendance tracking (teachers marking their own attendance)
- Detailed per-teacher performance reports

### 3.3 Student Portal
Students have a personal dashboard to track their academic journey.

**Capabilities — Currently Built:**
- View their own attendance record
- View their batch timetable
- Download practice papers and study notes (uploaded by teacher)
- See exam schedule
- View live exam results as soon as published
- Personal progress dashboard
- Get reminders and announcements
- Access from both web and mobile

**Capabilities — Yet to Be Built:**
- Practice problems (interactive exercises for students to attempt directly on the platform)
- Student progress card / report card (detailed academic progress report)
- Class materials / downloadable resources section (structured by subject)

### 3.4 Parent Portal
Parents get a read-only + communication view into their child's academic life.

**Capabilities — Currently Built:**
- Live attendance updates for their child
- View exam results and reports
- Track fee dues and payments
- Direct messaging / chat with teachers
- Weekly progress summary
- Available via mobile app (Android & iOS)

---

## 4. Core Features — Currently Built

### 4.1 Smart Attendance
- Mark student attendance in one tap from the teacher or admin view
- Automatic alerts / SMS notifications sent to parents for absences
- Monthly attendance reports generated automatically
- Zero paperwork — fully digital
- Attendance percentage visible on student dashboard
- Admin can view attendance across all batches

**Status: Completed**

### 4.2 Batch Management
- Organize students into batches by class, subject, or time slot
- Assign teachers to specific batches
- Set timetables per batch
- Multiple batches supported per institute
- Batch-level performance tracking and reports

**Status: Completed**

### 4.3 Exams & Results
- Schedule exams with date, time, and batch assignment
- Upload answer keys
- Auto-generate report cards
- Share results with parents instantly upon publishing
- Students can see live results on their dashboard
- 5+ exams can be scheduled in a week

**Status: Completed**

### 4.4 Practice Papers & Study Materials
- Teachers can upload PDFs, practice papers, mock tests, and study notes
- Organized by subject
- Students access them from web or mobile, anytime
- Supports PDF and video content

**Status: Completed (upload & access flow)**
**Note: Interactive practice problems (in-platform exercises) are yet to be built**

### 4.5 Parent Login & Communication
- Parents have a dedicated portal and mobile app
- Live attendance and result updates
- Fee dues and payment tracking
- Direct chat with teachers
- Weekly progress summary
- Parent app available on Android and iOS

**Status: Completed**

### 4.6 Progress Tracker
- Personalized dashboard for each student
- Shows strengths and weak areas
- Performance trends over time
- AI-powered insights (planned/in progress)
- Charts and visual analytics

**Status: Core tracker built; AI insights layer in progress**

### 4.7 Dark Mode / Light Mode
- The platform supports both dark mode and light mode
- Users can toggle between themes based on preference

**Status: Completed**

### 4.8 Multi-Role Authentication
- Admin login
- Teacher login
- Student login
- Parent login
- Each role has a separate, permission-controlled view

**Status: Completed**

---

## 5. Features Yet to Be Built

### 5.1 Student Progress Card
A formal, printable/downloadable progress card for each student — summarizing attendance percentage, exam scores across subjects, ranking within batch, teacher remarks, and overall grade. This is different from the in-app progress tracker; it's a structured report card document.

**Use Cases:**
- Parents can download or print the report card
- Admin can generate batch-level progress cards
- Can be shared at the end of each term or exam cycle

### 5.2 Teacher Attendance
Currently, the attendance module tracks student attendance only. Teacher attendance tracking is a planned feature.

**Planned Capabilities:**
- Teachers mark their own attendance (check-in/check-out)
- Admin can view teacher attendance reports
- Monthly teacher attendance summaries
- Integration with payroll or leave management (future)

### 5.3 Practice Problems (Interactive Exercises)
Currently, teachers can upload static practice papers (PDFs). The planned "Practice Problems" feature will allow students to attempt questions directly on the platform.

**Planned Capabilities:**
- Teachers create question banks per subject/topic
- Students attempt MCQ or subjective problems on the platform
- Instant feedback and score for MCQs
- Track attempt history and accuracy per topic
- Helps identify weak areas automatically

### 5.4 Class Materials / Study Resources Section
A structured, organized section where students can browse and download all materials shared by their institute — organized by subject, batch, and topic.

**Planned Capabilities:**
- Categorized by subject and topic
- Downloadable PDFs, notes, video links
- Students can bookmark important materials
- Teachers can organize resources in folders

---

## 6. Product Architecture (User-Facing)

### Portals
| Portal | Type | Access |
|--------|------|--------|
| Admin Dashboard | Web | Browser |
| Teacher Portal | Web + Mobile (future) | Browser |
| Student Portal | Web + Mobile App | Browser & App |
| Parent Portal | Web + Mobile App | Browser & App (Android/iOS) |

### How It Works — Onboarding Flow
1. **Institute Setup** — Admin creates institute profile, adds subjects, builds batches, configures schedule
2. **Team Invitation** — Admin adds teachers, enrolls students, invites parents; everyone gets their own login automatically
3. **Daily Operations** — Track attendance, schedule exams, share resources, communicate with parents — all from one dashboard

---

## 7. Audience & Market

- **Primary Market:** Coaching institutes in India (IIT-JEE, NEET, board exam prep, tuition centers)
- **Cities:** Pan-India, mobile-first for Tier 2 and Tier 3 cities
- **Institute Size:** Small to medium coaching centers (10–2000 students)
- **Languages:** Currently English UI; Indian regional language support planned

### Testimonials
- **Rajesh Patel, Director, Patel IIT Academy, Ahmedabad:** Saves 3+ hours per day on attendance, results, and parent communication.
- **Priya Sharma, Maths Teacher, Delhi:** Batch tools, paper uploads, and result sharing are one-tap simple.
- **Anita Mishra, Parent, Mumbai:** Real-time visibility into daughter's attendance and results from mobile.

---

## 8. Business Model

- **Free Trial:** 14-day free trial, no credit card required
- **Pricing:** Subscription-based (pricing page coming soon)
- **Setup:** No setup fees, no developers needed
- **Current Scale:** 500+ institutes onboarded

---

## 9. Competitive Differentiators

- Designed specifically for Indian coaching institutes (not generic school ERP)
- Four-portal system in one product (admin, teacher, student, parent)
- Mobile-first parent app with live updates
- One-tap attendance marking — no hardware needed
- Instant result sharing to parents
- Beautiful, consumer-grade UI (not legacy ERP design)
- Quick onboarding — live in 10 minutes

---

## 10. Known Limitations / Gaps (as of June 2026)

| Feature | Status |
|---------|--------|
| Student Progress Card (formal report card) | Not yet built |
| Teacher Attendance | Not yet built |
| Practice Problems (interactive in-platform) | Not yet built |
| Structured Class Materials section | Not yet built |
| AI Insights on Progress Tracker | In progress |
| Fee Payment Gateway integration | Partially built (dues visible; payment flow unclear) |
| Regional language support | Not yet built |
| Teacher mobile app | Not yet built |

---

## 11. Frequently Asked Questions (FAQ)

**Q: What is Classsly?**
A: Classsly is an all-in-one platform for coaching institutes to manage attendance, batches, exams, results, parent communication, and student progress from one dashboard.

**Q: Who can use Classsly?**
A: Coaching institute owners (admins), teachers, students, and parents each get their own portal and login.

**Q: Is there a mobile app?**
A: Yes. The parent app is available on both Android and iOS. The student portal is accessible on mobile browsers. A dedicated student mobile app is planned.

**Q: How do I get started?**
A: Sign up for a 14-day free trial at classsly.in. No credit card or developer is needed. You can be live in under 10 minutes.

**Q: Can parents track attendance?**
A: Yes. Parents get real-time attendance notifications and can view their child's attendance record on their parent portal or app.

**Q: How does exam result sharing work?**
A: Teachers enter results on the platform, and once published, parents and students are instantly notified and can view the results on their respective dashboards.

**Q: Does Classsly support multiple batches?**
A: Yes. You can create unlimited batches organized by class, subject, time slot, or any custom grouping.

**Q: Is student attendance marked manually or automatically?**
A: Teachers mark attendance manually with one tap per student. There is no biometric or RFID requirement.

**Q: Can teachers upload study materials?**
A: Yes. Teachers can upload PDFs, practice papers, mock tests, and notes, which students can download from the web or mobile app.

**Q: Does Classsly have dark mode?**
A: Yes, Classsly supports both dark mode and light mode. Users can toggle between themes based on their preference.

**Q: What is not yet available on Classsly?**
A: Features currently in development or planned include: student progress cards (formal report cards), teacher attendance tracking, interactive practice problems, and a structured class materials section.

**Q: Can I chat with teachers on Classsly?**
A: Parents can message teachers directly through the parent portal. Student-to-teacher messaging is part of the roadmap.

**Q: How are absences handled?**
A: When a student is marked absent, the system automatically sends an alert (SMS/notification) to the parent.

**Q: Is there a fee management feature?**
A: Yes. Fee dues and payment information are visible on the parent portal. Full payment gateway integration details are being finalized.

---

## 12. Glossary

| Term | Definition |
|------|-----------|
| Batch | A group of students organized by class, subject, or time slot within an institute |
| Admin | The institute owner or manager with full platform access |
| Progress Tracker | An in-app dashboard showing a student's attendance, scores, and performance trends |
| Progress Card | A formal, structured report card document (planned feature) |
| Practice Paper | A PDF or document uploaded by a teacher for student practice |
| Practice Problems | Interactive in-platform exercises students can attempt (planned feature) |
| Parent Portal | A dedicated dashboard for parents to monitor their child's progress |
| Kobi | Classsly's in-app AI assistant chatbot for user support |
| Dark Mode | A dark-themed UI option available to all users |
| Live Results | Exam scores visible to students and parents immediately upon teacher publishing |

---

*This document is intended for use as a RAG knowledge base. Each section is self-contained and can be chunked independently for embedding. Recommended chunk strategy: chunk by section (##) or sub-section (###), preserving headings as metadata.*
