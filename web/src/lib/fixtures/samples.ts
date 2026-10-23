// Sample resumes, job posts and AI answers, used to test tailoring end to end (tailoring.samples.test.ts).
// Each AI answer is what a model returns for the app's prompt: mostly honest, plain rewrites that use
// the job's words, plus the slips models really make (buzzwords, a tool from another job, a changed number).

import { normalizeResume } from "../schema";
import type { AiTailorOutput } from "../tailor";

export interface Sample {
  name: string;
  resume: object;
  jd: string;
  ai: AiTailorOutput;
  /** Lines the checks must refuse (the original text of the line). */
  refuse?: string[];
}

const noIdeas = { project_ideas: [], advice: [] };

// ------------------------------------------------------------------ 1. backend engineer -> payments backend

const backend = {
  basics: { name: "Alex Rivera", headline: "Software Engineer" },
  summary:
    "Backend-focused software engineer with 4 years of experience building data pipelines and APIs in Python and Go. Shipped services handling 2M+ requests a day, cut cloud costs by 30%, and mentor junior engineers.",
  skills: [
    { id: "sk1", category: "Languages", items: ["Python", "Go", "SQL", "TypeScript"] },
    { id: "sk2", category: "Backend & Data", items: ["FastAPI", "PostgreSQL", "Redis", "Kafka", "Airflow", "dbt"] },
    { id: "sk3", category: "Cloud & DevOps", items: ["AWS", "Docker", "Kubernetes", "Terraform", "GitHub Actions"] },
  ],
  experience: [
    {
      id: "ex1",
      company: "Northwind Logistics",
      role: "Software Engineer II",
      dates: "Mar 2023 – Present",
      bullets: [
        "Built a Kafka-based event pipeline in Go that processes 2M+ shipment updates a day with 99.95% uptime.",
        "Cut AWS spend by 30% by moving batch jobs from always-on EC2 to scheduled Airflow tasks on spot instances.",
        "Mentored 3 junior engineers through code reviews and weekly pairing sessions.",
      ],
    },
    {
      id: "ex2",
      company: "Brightpath Health",
      role: "Backend Developer",
      dates: "Jun 2021 – Feb 2023",
      bullets: [
        "Designed FastAPI services for patient scheduling used by 40 clinics, reducing booking errors by 25%.",
        "Wrote dbt models and SQL dashboards that replaced 10 hours a week of manual reporting.",
        "Added CI with GitHub Actions and Docker, cutting release time from 2 days to 2 hours.",
      ],
    },
  ],
  projects: [
    {
      id: "pr1",
      name: "OpenRoute – Delivery ETA Predictor",
      stack: ["Python", "scikit-learn", "FastAPI", "PostgreSQL"],
      bullets: ["Trained a gradient-boosting model on 500k trips that predicts delivery times within 6 minutes on average."],
    },
    {
      id: "pr2",
      name: "Tiny Feature Flags",
      stack: ["Go", "Redis", "React"],
      bullets: ["Open-source feature-flag service with a 1 ms p99 read path; 300+ GitHub stars."],
    },
  ],
  education: [{ id: "ed1", degree: "B.S. in Computer Science", institution: "University of Texas at Austin" }],
};

const paymentsJd = `Senior Backend Engineer, Payments — Ledgerly

We move money for 5,000 small businesses. You will build the services behind payouts and invoicing.

What you'll do
- Design and run reliable, high-throughput Python and Go services on Kubernetes
- Build event-driven systems with Kafka and keep them observable (Prometheus, Grafana)
- Own PostgreSQL schemas and query performance
- Expose internal APIs with gRPC and REST

Requirements
- 4+ years building backend services in production
- Strong Python or Go, SQL and PostgreSQL
- Experience with Docker, Kubernetes and CI/CD
- Mentoring other engineers

Nice to have
- Payments or fintech experience
- Terraform, AWS`;

const backendAi: AiTailorOutput = {
  job: { title: "Senior Backend Engineer, Payments", company: "Ledgerly" },
  summary:
    "Backend software engineer with 4 years of experience building event-driven services and APIs in Python and Go. Shipped services handling 2M+ requests a day, cut cloud costs by 30%, and mentor junior engineers.",
  skills: [
    { category: "Languages", items: ["Python", "Go", "SQL", "TypeScript"] },
    { category: "Backend & Data", items: ["PostgreSQL", "Kafka", "FastAPI", "gRPC", "Redis", "Airflow"] },
    { category: "Cloud & DevOps", items: ["Kubernetes", "Docker", "Prometheus", "Grafana", "AWS", "Terraform"] },
  ],
  experience: [
    {
      id: "ex1",
      bullets: [
        "Built an event-driven Kafka pipeline in Go that handles 2M+ shipment updates a day with 99.95% uptime.",
        "Cut AWS spend by 30% by moving batch jobs from always-on EC2 servers to scheduled Airflow tasks on spot instances.",
        "Mentored 3 junior engineers through weekly pairing sessions and code reviews.",
      ],
    },
    {
      id: "ex2",
      bullets: [
        "Built Python services with FastAPI for patient scheduling used by 40 clinics, cutting booking errors by 25%.",
        "Wrote SQL and dbt models behind dashboards that replaced 10 hours a week of manual reporting.",
        "Added CI with GitHub Actions and Docker, cutting release time from 2 days to 2 hours.",
      ],
    },
  ],
  projects: [
    {
      id: "pr1",
      stack: ["Python", "FastAPI", "PostgreSQL", "scikit-learn"],
      bullets: ["Trained a gradient-boosting model on 500k trips that predicts delivery times within 6 minutes on average."],
    },
    {
      id: "pr2",
      stack: ["Go", "Redis", "React"],
      bullets: ["Built an open-source feature-flag service in Go with a 1 ms p99 read path; 300+ GitHub stars."],
    },
  ],
  project_order: ["pr2", "pr1"],
  keywords: [
    { term: "Python", importance: "must" },
    { term: "Go", importance: "must" },
    { term: "Kubernetes", importance: "must" },
    { term: "Kafka", importance: "must" },
    { term: "gRPC", importance: "must" },
    { term: "PostgreSQL", importance: "must" },
    { term: "Terraform", importance: "nice" },
  ],
  ...noIdeas,
};

// ------------------------------------------------------------------ 2. same backend engineer -> data engineer

const dataEngJd = `Data Engineer — Harbor Analytics

You'll build and own the pipelines that feed our warehouse and dashboards.

Responsibilities
- Build batch and streaming pipelines with Airflow, Kafka and Spark
- Model data in dbt and Snowflake for analysts
- Keep pipelines reliable, tested and cheap to run on AWS
- Work with analysts to replace manual reporting

Requirements
- 3+ years of data engineering
- Python and SQL
- Airflow, dbt, a cloud data warehouse (Snowflake or BigQuery)
- Spark is a plus`;

const dataEngAi: AiTailorOutput = {
  job: { title: "Data Engineer", company: "Harbor Analytics" },
  summary:
    "Software engineer with 4 years of experience building data pipelines in Python, SQL and Go. Shipped pipelines handling 2M+ events a day, cut cloud costs by 30%, and replaced manual reporting with dbt models.",
  skills: [
    { category: "Languages", items: ["Python", "SQL", "Go", "TypeScript"] },
    { category: "Data Engineering", items: ["Airflow", "dbt", "Kafka", "Snowflake", "Spark", "PostgreSQL"] },
    { category: "Cloud & DevOps", items: ["AWS", "Docker", "Terraform", "Kubernetes", "GitHub Actions"] },
  ],
  experience: [
    {
      id: "ex1",
      bullets: [
        "Built a streaming pipeline on Kafka and Go that processes 2M+ shipment updates a day with 99.95% uptime.",
        "Cut AWS costs by 30% by moving batch jobs from always-on EC2 to scheduled Airflow pipelines on spot instances.",
        "Mentored 3 junior engineers through code reviews and weekly pairing sessions.",
      ],
    },
    {
      id: "ex2",
      bullets: [
        "Built FastAPI services for patient scheduling used by 40 clinics, reducing booking errors by 25%.",
        "Wrote dbt models and SQL dashboards with analysts that replaced 10 hours a week of manual reporting.",
        "Added CI with GitHub Actions and Docker, cutting release time from 2 days to 2 hours.",
      ],
    },
  ],
  projects: [
    {
      id: "pr1",
      stack: ["Python", "PostgreSQL", "scikit-learn", "FastAPI"],
      bullets: ["Built a Python pipeline on 500k trips to train a gradient-boosting model that predicts delivery times within 6 minutes."],
    },
    {
      id: "pr2",
      stack: ["Go", "Redis", "React"],
      bullets: ["Open-source feature-flag service with a 1 ms p99 read path; 300+ GitHub stars."],
    },
  ],
  project_order: ["pr1", "pr2"],
  keywords: [
    { term: "Airflow", importance: "must" },
    { term: "dbt", importance: "must" },
    { term: "Snowflake", importance: "must" },
    { term: "Spark", importance: "nice" },
  ],
  ...noIdeas,
};

// ------------------------------------------------------------------ 3. registered nurse -> ICU nurse

const nurse = {
  basics: { name: "Maria Lopez", headline: "Registered Nurse, BSN" },
  summary:
    "Registered nurse with 5 years on a busy medical-surgical floor. Cares for 5-6 patients a shift, trains new nurses, and keeps patients safe with careful assessments and clear handoffs.",
  skills: [
    { id: "s1", category: "Clinical", items: ["Patient assessment", "IV therapy", "Wound care", "Medication administration", "Telemetry"] },
    { id: "s2", category: "Systems", items: ["Epic", "Pyxis", "Microsoft Office"] },
  ],
  experience: [
    {
      id: "n1",
      company: "St. Mary's Hospital",
      role: "Registered Nurse, Medical-Surgical",
      dates: "2020 – Present",
      bullets: [
        "Care for 5-6 adult patients per 12-hour shift, including post-op and telemetry patients.",
        "Give IV medications, including heparin and diltiazem drips, and watch for side effects.",
        "Precepted 8 new graduate nurses during their first 12 weeks on the unit.",
        "Led the unit's fall prevention project, which cut patient falls by 30% in one year.",
      ],
    },
    {
      id: "n2",
      company: "Lakeside Clinic",
      role: "Patient Care Technician",
      dates: "2018 – 2020",
      bullets: ["Took vital signs and helped 20+ patients a day with daily care and mobility."],
    },
  ],
  certifications: ["BLS", "ACLS", "RN License #RN123456"],
};

const icuJd = `ICU Registered Nurse — Riverside Medical Center

Our 24-bed medical ICU cares for critically ill adults.

Responsibilities
- Care for 1-2 critically ill patients per shift
- Manage vasoactive drips, ventilated patients and hemodynamic monitoring
- Work closely with physicians, respiratory therapists and pharmacists
- Teach patients and families

Requirements
- Active RN license, BLS and ACLS
- 2+ years acute care experience (ICU, step-down or med-surg with telemetry)
- Epic charting

Preferred
- CCRN certification
- Experience precepting new nurses`;

const nurseAi: AiTailorOutput = {
  job: { title: "ICU Registered Nurse", company: "Riverside Medical Center" },
  summary:
    "Registered nurse with 5 years of acute care on a busy medical-surgical floor with telemetry. Cares for 5-6 patients a shift, precepts new nurses, and keeps patients safe with careful assessments.",
  skills: [
    { category: "Clinical", items: ["Patient assessment", "Telemetry", "IV therapy", "Medication administration", "Hemodynamic monitoring"] },
    { category: "Systems", items: ["Epic", "Pyxis", "Microsoft Office"] },
  ],
  experience: [
    {
      id: "n1",
      bullets: [
        "Care for 5-6 acute care adult patients per 12-hour shift, including post-op and telemetry patients.",
        "Manage vasoactive drips such as heparin and diltiazem, and watch closely for side effects.",
        "Precepted 8 new graduate nurses through their first 12 weeks on the unit.",
        "Led the unit's fall prevention project, which cut patient falls by 30% in one year.",
      ],
    },
    {
      id: "n2",
      bullets: ["Took vital signs and helped 20+ patients a day with daily care and mobility."],
    },
  ],
  projects: [],
  project_order: [],
  keywords: [
    { term: "ACLS", importance: "must" },
    { term: "Epic", importance: "must" },
    { term: "CCRN", importance: "nice" },
  ],
  ...noIdeas,
};

// ------------------------------------------------------------------ 4. marketing specialist -> growth marketing manager

const marketer = {
  basics: { name: "Priya Shah", headline: "Digital Marketing Specialist" },
  summary:
    "Digital marketer with 4 years in e-commerce. Runs paid search and email campaigns, writes clear copy, and uses data to decide what to test next. Grew online revenue 35% at my last company.",
  skills: [
    { id: "m1", category: "Channels", items: ["Google Ads", "Meta Ads", "Email marketing", "SEO"] },
    { id: "m2", category: "Tools", items: ["Google Analytics", "Mailchimp", "Canva", "Excel", "WordPress"] },
  ],
  experience: [
    {
      id: "m-ex1",
      company: "Bloom & Co.",
      role: "Digital Marketing Specialist",
      dates: "2022 – Present",
      bullets: [
        "Managed a $40k monthly Google Ads and Meta Ads budget, lowering cost per order by 22%.",
        "Ran weekly A/B tests on email subject lines and landing pages in Mailchimp and WordPress.",
        "Grew online revenue 35% in 2023 by rebuilding the welcome email flow and abandoned-cart emails.",
      ],
    },
    {
      id: "m-ex2",
      company: "Green Leaf Market",
      role: "Marketing Coordinator",
      dates: "2020 – 2022",
      bullets: [
        "Wrote blog posts and product pages that doubled organic traffic in 18 months.",
        "Built monthly reports in Excel and Google Analytics for the owner and store managers.",
      ],
    },
  ],
};

const growthJd = `Growth Marketing Manager — Fernway (DTC home goods)

Own acquisition and retention for our online store.

You will
- Plan and run paid acquisition across Google, Meta and TikTok
- Run experiments (A/B tests) across landing pages, email and SMS
- Build lifecycle email flows in Klaviyo
- Report on CAC, ROAS and LTV with GA4 and Looker Studio

You have
- 3+ years in performance or growth marketing for e-commerce
- Hands-on Google Ads and Meta Ads
- Strong analytics: GA4, spreadsheets, SQL a plus
- Klaviyo or a similar email tool`;

const marketerAi: AiTailorOutput = {
  job: { title: "Growth Marketing Manager", company: "Fernway" },
  summary:
    "Digital marketer with 4 years in e-commerce growth. Runs paid search, Meta Ads and email campaigns, A/B tests landing pages, and uses data to decide what to test next. Grew online revenue 35%.",
  skills: [
    { category: "Growth Channels", items: ["Google Ads", "Meta Ads", "Email marketing", "A/B testing", "SEO"] },
    { category: "Tools", items: ["Google Analytics", "Klaviyo", "Mailchimp", "Excel", "Looker Studio"] },
  ],
  experience: [
    {
      id: "m-ex1",
      bullets: [
        "Spearheaded a $40k monthly paid acquisition budget across Google Ads and Meta Ads, lowering CAC by 22%.",
        "Ran weekly A/B tests on email subject lines and landing pages in Mailchimp and WordPress.",
        "Grew online revenue 35% in 2023 by rebuilding the welcome and abandoned-cart email flows.",
      ],
    },
    {
      id: "m-ex2",
      bullets: [
        "Wrote blog posts and product pages that doubled organic traffic in 18 months.",
        "Built monthly performance reports in Excel and Google Analytics for the owner and store managers.",
      ],
    },
  ],
  projects: [],
  project_order: [],
  keywords: [
    { term: "Google Ads", importance: "must" },
    { term: "Meta Ads", importance: "must" },
    { term: "Klaviyo", importance: "must" },
    { term: "GA4", importance: "must" },
    { term: "SQL", importance: "nice" },
  ],
  ...noIdeas,
};

// ------------------------------------------------------------------ 5. accountant -> financial analyst

const accountant = {
  basics: { name: "Daniel Kim", headline: "Staff Accountant" },
  summary:
    "Staff accountant with 3 years in month-end close, reconciliations and reporting for a $50M manufacturer. Known for clean books, fast closes and Excel models that save the team hours.",
  skills: [
    { id: "a1", category: "Accounting", items: ["Month-end close", "Account reconciliation", "Accounts payable", "GAAP"] },
    { id: "a2", category: "Software", items: ["NetSuite", "Excel (pivot tables, XLOOKUP)", "QuickBooks", "Power BI"] },
  ],
  experience: [
    {
      id: "acc1",
      company: "Carter Manufacturing",
      role: "Staff Accountant",
      dates: "2021 – Present",
      bullets: [
        "Closed the books each month in 5 days instead of 9 by building reconciliation templates in Excel.",
        "Reconciled 14 bank and balance sheet accounts monthly with zero audit findings in 2023.",
        "Built a Power BI dashboard of monthly spend by department for the CFO.",
        "Worked with plant managers to explain budget-to-actual variances each quarter.",
      ],
    },
  ],
  education: [{ id: "ae1", degree: "B.S. Accounting", institution: "Ohio State University" }],
};

const finJd = `Financial Analyst — Brightline Foods

Join our FP&A team to support budgeting, forecasting and business decisions.

Responsibilities
- Build and maintain forecasting and budget models in Excel
- Analyze budget-to-actual variances and explain them to business leaders
- Create dashboards in Power BI for leadership
- Support month-end close and the annual budget

Requirements
- 2+ years in accounting or FP&A
- Advanced Excel (XLOOKUP, pivot tables), financial modeling
- Power BI or Tableau
- NetSuite or another ERP; SQL is a plus`;

const accountantAi: AiTailorOutput = {
  job: { title: "Financial Analyst", company: "Brightline Foods" },
  summary:
    "Staff accountant with 3 years in month-end close, variance analysis and reporting for a $50M manufacturer. Builds Excel models and Power BI dashboards that save the team hours and help leaders decide.",
  skills: [
    { category: "Finance & Accounting", items: ["Variance analysis", "Budgeting", "Month-end close", "Account reconciliation", "GAAP"] },
    { category: "Software", items: ["Excel (pivot tables, XLOOKUP)", "Power BI", "NetSuite", "QuickBooks"] },
  ],
  experience: [
    {
      id: "acc1",
      bullets: [
        "Cut the monthly close from 9 days to 5 by building reconciliation templates in Excel.",
        "Reconciled 14 bank and balance sheet accounts monthly with zero audit findings in 2023.",
        "Built a Power BI dashboard of monthly spend by department for the CFO and leadership.",
        "Explained budget-to-actual variances to plant managers each quarter and helped plan next steps.",
      ],
    },
  ],
  projects: [],
  project_order: [],
  keywords: [
    { term: "Excel", importance: "must" },
    { term: "Power BI", importance: "must" },
    { term: "financial modeling", importance: "must" },
    { term: "SQL", importance: "nice" },
  ],
  ...noIdeas,
};

// ------------------------------------------------------------------ 6. frontend developer -> full-stack engineer

const frontend = {
  basics: { name: "Sam Taylor", headline: "Frontend Developer" },
  summary:
    "Frontend developer with 3 years building fast, accessible web apps in React and TypeScript. Works closely with designers and backend engineers to ship features users like.",
  skills: [
    { id: "f1", category: "Frontend", items: ["React", "TypeScript", "JavaScript", "HTML", "CSS", "Tailwind"] },
    { id: "f2", category: "Other", items: ["Node.js", "Express", "Jest", "Git", "Figma"] },
  ],
  experience: [
    {
      id: "fe1",
      company: "Parcel Labs",
      role: "Frontend Developer",
      dates: "2022 – Present",
      bullets: [
        "Rebuilt the customer dashboard in React and TypeScript, cutting page load time from 4s to 1.5s.",
        "Built a shared component library used by 4 teams, with Jest tests and Storybook docs.",
        "Added Node.js and Express endpoints for the dashboard's export feature.",
      ],
    },
    {
      id: "fe2",
      company: "Freelance",
      role: "Web Developer",
      dates: "2021 – 2022",
      bullets: ["Made websites for 12 local businesses with WordPress and custom JavaScript."],
    },
  ],
  projects: [
    {
      id: "fp1",
      name: "Habit Tracker",
      stack: ["React", "Node.js", "MongoDB"],
      bullets: ["Built a habit tracking app with login, streaks and reminders; 200 weekly users."],
    },
  ],
};

const fullstackJd = `Full-Stack Engineer — Nimbus (B2B SaaS)

Build features end to end, from React UI to Node.js APIs and PostgreSQL.

What you'll do
- Ship features across our React/TypeScript frontend and Node.js backend
- Design REST APIs and PostgreSQL schemas
- Write tests (Jest, Playwright) and care about performance and accessibility
- Work with product and design

What we're looking for
- 3+ years of professional web development
- React, TypeScript, Node.js
- SQL databases (PostgreSQL)
- Bonus: AWS, Docker, GraphQL`;

const frontendAi: AiTailorOutput = {
  job: { title: "Full-Stack Engineer", company: "Nimbus" },
  summary:
    "Web developer with 3 years building fast, accessible apps in React, TypeScript and Node.js. Works closely with designers and backend engineers to ship features from the UI to the API.",
  skills: [
    { category: "Frontend", items: ["React", "TypeScript", "JavaScript", "HTML", "CSS", "Tailwind"] },
    { category: "Backend & Testing", items: ["Node.js", "Express", "REST APIs", "PostgreSQL", "Jest", "Git"] },
  ],
  experience: [
    {
      id: "fe1",
      bullets: [
        "Rebuilt the customer dashboard in React and TypeScript, cutting page load time from 4s to 1.5s.",
        "Built a shared React component library used by 4 teams, with Jest tests and Storybook docs.",
        "Built REST endpoints in Node.js and Express for the dashboard's export feature.",
      ],
    },
    {
      id: "fe2",
      bullets: ["Built websites for 12 local businesses with WordPress and custom JavaScript."],
    },
  ],
  projects: [
    {
      id: "fp1",
      stack: ["React", "Node.js", "MongoDB"],
      bullets: ["Built a full-stack habit tracker in React and Node.js with login, streaks and reminders; 200 weekly users."],
    },
  ],
  project_order: ["fp1"],
  keywords: [
    { term: "React", importance: "must" },
    { term: "Node.js", importance: "must" },
    { term: "PostgreSQL", importance: "must" },
    { term: "Playwright", importance: "nice" },
  ],
  ...noIdeas,
};

// ------------------------------------------------------------------ 7. teacher -> instructional designer

const teacher = {
  basics: { name: "Emily Chen", headline: "High School Science Teacher" },
  summary:
    "Science teacher with 6 years of experience planning lessons, building online courses and helping students of all levels learn. Turns hard topics into clear, hands-on activities.",
  skills: [
    { id: "t1", category: "Teaching", items: ["Lesson planning", "Assessment design", "Differentiated instruction", "Classroom management"] },
    { id: "t2", category: "Tools", items: ["Google Classroom", "Canvas LMS", "Canva", "Microsoft Office"] },
  ],
  experience: [
    {
      id: "te1",
      company: "Lincoln High School",
      role: "Biology and Chemistry Teacher",
      dates: "2018 – Present",
      bullets: [
        "Teach biology and chemistry to 150 students a year, with pass rates up from 78% to 91%.",
        "Built a full online biology course in Canvas LMS with videos, quizzes and labs during remote learning.",
        "Wrote new lab activities and rubrics now used by all 5 science teachers in the department.",
        "Lead monthly training sessions for teachers on Google Classroom and online quizzes.",
      ],
    },
  ],
};

const idJd = `Instructional Designer — LearnWell (corporate training)

Design online courses for employees at our clients.

Responsibilities
- Work with subject matter experts to design e-learning courses and job aids
- Build courses in Articulate Storyline and Rise and publish them to an LMS
- Write learning objectives, assessments and storyboards
- Use learner feedback and data to improve courses

Requirements
- 3+ years in instructional design, training or teaching
- Knowledge of ADDIE and adult learning principles
- Articulate 360, an LMS (Canvas, Moodle, Cornerstone)`;

const teacherAi: AiTailorOutput = {
  job: { title: "Instructional Designer", company: "LearnWell" },
  summary:
    "Science teacher with 6 years of experience designing lessons, building online courses in Canvas LMS and writing assessments. Turns hard topics into clear, hands-on learning for every level.",
  skills: [
    { category: "Instructional Design", items: ["Course design", "Assessment design", "Lesson planning", "Differentiated instruction"] },
    { category: "Tools", items: ["Canvas LMS", "Articulate 360", "Google Classroom", "Canva"] },
  ],
  experience: [
    {
      id: "te1",
      bullets: [
        "Teach biology and chemistry to 150 students a year, raising pass rates from 78% to 91%.",
        "Designed a full online biology course in Canvas LMS with videos, quizzes and labs for remote learning.",
        "Wrote lab activities, rubrics and assessments now used by all 5 science teachers in the department.",
        "Lead monthly teacher training sessions on Google Classroom and building online quizzes.",
      ],
    },
  ],
  projects: [],
  project_order: [],
  keywords: [
    { term: "Articulate Storyline", importance: "must" },
    { term: "ADDIE", importance: "must" },
    { term: "LMS", importance: "must" },
  ],
  ...noIdeas,
};

// ------------------------------------------------------------------ 8. data analyst -> product analyst (with an extra section)

const analyst = {
  basics: { name: "Jordan Patel", headline: "Data Analyst" },
  summary:
    "Data analyst with 3 years of turning messy sales data into clear reports. Writes SQL every day, builds Tableau dashboards and explains findings to non-technical teams.",
  skills: [
    { id: "d1", category: "Analysis", items: ["SQL", "Python (pandas)", "Excel", "Statistics"] },
    { id: "d2", category: "BI", items: ["Tableau", "Power BI", "Looker"] },
  ],
  experience: [
    {
      id: "da1",
      company: "Retail Co.",
      role: "Data Analyst",
      dates: "2022 – Present",
      bullets: [
        "Built 25 Tableau dashboards for 300+ store managers, used every week to plan staffing and stock.",
        "Wrote SQL queries on a 2 TB sales database to find why returns rose 12% in Q3 2023.",
        "Automated a weekly Excel report with Python (pandas), saving 6 hours a week.",
      ],
    },
  ],
  projects: [
    {
      id: "dp1",
      name: "Customer Churn Analysis",
      stack: ["Python", "pandas", "scikit-learn"],
      bullets: ["Found the top 3 reasons customers left a subscription box service, using survey and order data."],
    },
  ],
  custom_sections: [
    {
      id: "cs1",
      title: "Volunteering",
      items: [
        {
          id: "ci1",
          title: "Data Volunteer, Code for Good",
          subtitle: "",
          dates: "2023",
          bullets: ["Cleaned and analyzed donation data for a food bank and presented the results to the board."],
        },
      ],
    },
  ],
};

const productJd = `Product Analyst — Tandem (consumer app)

Help our product teams decide what to build with data.

You will
- Define and track product metrics, funnels and retention
- Analyze A/B tests and user behavior with SQL and Python
- Build self-serve dashboards in Looker
- Present findings and recommendations to product managers

You have
- 2+ years in analytics
- Strong SQL; Python (pandas) a plus
- Experience with experimentation and statistics
- Clear communication with non-technical partners`;

const analystAi: AiTailorOutput = {
  job: { title: "Product Analyst", company: "Tandem" },
  summary:
    "Data analyst with 3 years of turning messy sales data into clear findings. Writes SQL every day, builds self-serve dashboards and presents findings to non-technical teams.",
  skills: [
    { category: "Analysis", items: ["SQL", "Python (pandas)", "Statistics", "A/B testing", "Excel"] },
    { category: "BI", items: ["Looker", "Tableau", "Power BI"] },
  ],
  experience: [
    {
      id: "da1",
      bullets: [
        "Built 25 self-serve Tableau dashboards for 300+ store managers, used weekly to plan staffing and stock.",
        "Wrote SQL on a 2 TB sales database to find why returns rose 12% in Q3 2023 and presented the findings.",
        "Automated a weekly Excel report with Python (pandas), saving 6 hours a week.",
      ],
    },
  ],
  projects: [
    {
      id: "dp1",
      stack: ["Python", "pandas", "scikit-learn"],
      bullets: ["Found the top 3 reasons customers left a subscription service by analyzing survey data and user behavior."],
    },
  ],
  other_sections: [
    { id: "ci1", bullets: ["Cleaned and analyzed donation data for a food bank and presented findings and recommendations to the board."] },
  ],
  project_order: ["dp1"],
  keywords: [
    { term: "SQL", importance: "must" },
    { term: "Looker", importance: "must" },
    { term: "A/B testing", importance: "must" },
  ],
  ...noIdeas,
};

// ------------------------------------------------------------------ 9. AI engineer (legacy JSON, research section) -> LLM engineer

import legacyJson from "../../../../examples/legacy_master_resume.json";

// The old JSON format gets new random ids on import; fix them so the AI answer can name them.
const legacy = normalizeResume(legacyJson);
legacy.experience.forEach((e, i) => (e.id = `lx${i}`));
legacy.projects.forEach((p, i) => (p.id = `lp${i}`));
legacy.custom_sections.forEach((cs) => cs.items.forEach((it, j) => (it.id = `lc${j}`)));

export const llmJd = `Machine Learning Engineer, LLM Applications — Cortex Labs

Build LLM-powered products: retrieval, agents and evaluation.

Responsibilities
- Build RAG pipelines and multi-agent workflows with LangChain or LangGraph
- Fine-tune open models (LoRA/QLoRA) and serve them with low latency
- Build evaluation and benchmarking for model quality
- Ship APIs with FastAPI and Docker

Requirements
- Python, PyTorch, Transformers (Hugging Face)
- Experience with vector databases (ChromaDB, Pinecone)
- Strong grasp of evaluation and reproducible experiments
- Nice to have: Kubernetes, MLflow, vLLM`;

const llmAi: AiTailorOutput = {
  job: { title: "Machine Learning Engineer, LLM Applications", company: "Cortex Labs" },
  summary:
    "AI engineer building agentic workflows, RAG and multi-agent LLM systems, and multimodal models. Takes deep learning from Springer Nature-published research to production pipelines and open-source work, with a focus on low-latency inference and reproducible benchmarking.",
  skills: [
    { category: "Languages & Core Frameworks", items: ["Python", "PyTorch", "FastAPI", "Docker", "SQL", "TensorFlow", "C++", "Git/CI-CD"] },
    { category: "LLM & Agentic AI", items: ["RAG", "LangChain", "LangGraph", "Multi-Agent Workflows", "LoRA/QLoRA", "Transformers", "Fine-Tuning", "ChromaDB"] },
    { category: "ML Systems & Evaluation", items: ["Benchmarking", "U-Net", "CNNs", "BiLSTM", "Computer Vision", "Segmentation"] },
  ],
  experience: [
    {
      id: "lx0",
      bullets: [
        "Building reproducible benchmarking pipelines for CAC segmentation on the Stanford COCA dataset to evaluate deep learning models for clinical-scale cardiovascular imaging.",
        "Benchmarked U-Net against TotalSegmentator, reaching a 0.9416 Dice score and ~63x faster inference on targeted CAC diagnostic workflows.",
      ],
    },
    {
      id: "lx1",
      bullets: [
        "Led the AI & ML vertical and ran 10+ hands-on workshops on RAG, LangChain orchestration and deep learning for 80+ engineering students.",
        "Mentored students on PyTorch and HuggingFace workflows; received a Certificate of Appreciation for technical leadership and community work.",
      ],
    },
  ],
  projects: [
    {
      id: "lp0",
      stack: ["LangChain", "FastAPI", "Gemma 3 27B", "BLIP-2", "Whisper Large-v3"],
      bullets: [
        "Built a multimodal moderation framework with LangChain and FastAPI that checks text, image and audio in under 3 seconds using Policy-as-Prompt rules; published in Cureus, Springer Nature 2026.",
      ],
    },
    {
      id: "lp1",
      stack: ["Python", "RAG", "LangChain", "NLP", "AutoML", "XAI"],
      bullets: [
        "Built a RAG and LangChain copilot that runs EDA, feature engineering and model selection from plain-language requests, cutting manual pipeline work by 90% with explainable outputs.",
      ],
    },
    {
      id: "lp2",
      stack: ["PyTorch", "ResNet-18", "BiLSTM", "CTC Loss"],
      bullets: [
        "Built a CRNN pipeline in PyTorch with LLM post-processing to transcribe Renaissance-era manuscripts, limiting outputs to historically valid vocabulary.",
      ],
    },
  ],
  other_sections: [
    {
      id: "lc0",
      bullets: ["Designed a Policy-as-Prompt framework that moderates text, image and audio in real time before delivery, in one pipeline."],
    },
    {
      id: "lc1",
      bullets: ["Surveyed 26+ architectures, analyzing critical research gaps in sub-second latency and on-premise data privacy."],
    },
    {
      id: "lc2",
      bullets: [
        "Implemented fit_update() (PR #3160) for incremental Bayesian learning in pgmpy with 38 tests passing; fixed a parameter regression (Issue #376) and added 5 test suites in pyaptamer.",
      ],
    },
  ],
  project_order: ["lp1", "lp0", "lp2"],
  keywords: [
    { term: "RAG", importance: "must" },
    { term: "LangGraph", importance: "must" },
    { term: "PyTorch", importance: "must" },
    { term: "ChromaDB", importance: "must" },
    { term: "vLLM", importance: "nice" },
  ],
  ...noIdeas,
};

// ------------------------------------------------------------------ 10. operations coordinator -> supply chain analyst

const ops = {
  basics: { name: "Chris Morgan", headline: "Operations Coordinator" },
  summary:
    "Operations coordinator with 4 years in a regional warehouse. Plans inbound shipments, keeps stock accurate and fixes process problems with simple Excel tools.",
  skills: [
    { id: "o1", category: "Operations", items: ["Inventory control", "Vendor communication", "Shipping and receiving", "Process improvement"] },
    { id: "o2", category: "Tools", items: ["SAP", "Excel", "Google Sheets"] },
  ],
  experience: [
    {
      id: "op1",
      company: "Midwest Distribution",
      role: "Operations Coordinator",
      dates: "2020 – Present",
      bullets: [
        "Schedule 60+ inbound trucks a week with 15 vendors and keep the dock running on time.",
        "Raised inventory accuracy from 92% to 98.5% with weekly cycle counts in SAP.",
        "Built an Excel tracker for late shipments that cut vendor delays by 18%.",
      ],
    },
  ],
};

const scJd = `Supply Chain Analyst — Northstar Retail

Use data to keep products in stock and costs down.

Responsibilities
- Analyze inventory levels, forecasts and vendor performance
- Build reports and dashboards (Excel, Power BI)
- Work with vendors and the warehouse team to fix delays
- Support demand planning in SAP

Requirements
- 2+ years in supply chain, logistics or inventory
- Advanced Excel; SAP experience
- Power BI or Tableau is a plus`;

const opsAi: AiTailorOutput = {
  job: { title: "Supply Chain Analyst", company: "Northstar Retail" },
  summary:
    "Operations coordinator with 4 years in a regional warehouse. Tracks inventory and vendor performance, keeps stock accurate in SAP and fixes supply chain delays with Excel tools.",
  skills: [
    { category: "Supply Chain", items: ["Inventory control", "Vendor management", "Demand planning", "Process improvement"] },
    { category: "Tools", items: ["SAP", "Excel", "Power BI", "Google Sheets"] },
  ],
  experience: [
    {
      id: "op1",
      bullets: [
        "Schedule 60+ inbound trucks a week with 15 vendors and track vendor performance to keep the dock on time.",
        "Raised inventory accuracy from 92% to 98.5% with weekly cycle counts in SAP.",
        "Built an Excel tracker for late shipments that cut vendor delays by 18%.",
      ],
    },
  ],
  projects: [],
  project_order: [],
  keywords: [
    { term: "SAP", importance: "must" },
    { term: "Excel", importance: "must" },
    { term: "Power BI", importance: "nice" },
  ],
  ...noIdeas,
};

// ------------------------------------------------------------------ round 2: answers in the style of a cheaper model

// 11. sales rep -> SaaS account executive
const sales = {
  basics: { name: "Luis Romero", headline: "Sales Representative" },
  summary:
    "Sales rep with 4 years selling office equipment to small businesses. Builds my own pipeline, closes deals fast and keeps customers coming back. Beat quota 7 of the last 8 quarters.",
  skills: [
    { id: "sa1", category: "Sales", items: ["Prospecting", "Cold calling", "Negotiation", "Account management"] },
    { id: "sa2", category: "Tools", items: ["Salesforce", "HubSpot", "LinkedIn Sales Navigator", "Excel"] },
  ],
  experience: [
    {
      id: "se1",
      company: "Copyline Office Solutions",
      role: "Sales Representative",
      dates: "2021 – Present",
      bullets: [
        "Beat quota in 7 of 8 quarters, closing $1.2M in new business in 2023.",
        "Book 15+ first meetings a month through cold calls, LinkedIn and referrals.",
        "Grew a book of 120 small business accounts with a 92% renewal rate.",
      ],
    },
  ],
};

const aeJd = `Account Executive, SMB — Slate (SaaS)

Sell our scheduling software to small and mid-size businesses.

You will
- Run the full sales cycle from discovery to close
- Build pipeline with outbound prospecting and inbound leads
- Run product demos and negotiate contracts
- Keep Salesforce up to date and forecast accurately

You have
- 2+ years of B2B sales with a track record of beating quota
- SaaS sales experience is a plus
- Salesforce, Gong or Outreach`;

const salesAi: AiTailorOutput = {
  job: { title: "Account Executive, SMB", company: "Slate" },
  summary:
    "B2B sales rep with 4 years selling to small businesses. Builds my own pipeline through outbound prospecting, runs the full sales cycle and keeps customers coming back. Beat quota 7 of the last 8 quarters.",
  skills: [
    { category: "Sales", items: ["Full-cycle sales", "Prospecting", "Negotiation", "Account management"] },
    { category: "Tools", items: ["Salesforce", "HubSpot", "Outreach", "LinkedIn Sales Navigator"] },
  ],
  experience: [
    {
      id: "se1",
      bullets: [
        "Beat quota in 7 of 8 quarters — closing $1.2M in new SaaS business in 2023.",
        "Book 15+ first meetings a month through outbound prospecting: cold calls, LinkedIn and referrals.",
        "Leveraged strong relationships to grow 120 small business accounts with a 92% renewal rate.",
      ],
    },
  ],
  projects: [],
  project_order: [],
  keywords: [
    { term: "Salesforce", importance: "must" },
    { term: "quota", importance: "must" },
    { term: "Outreach", importance: "nice" },
  ],
  ...noIdeas,
};

// 12. mechanical engineer -> manufacturing engineer
const mech = {
  basics: { name: "Anna Kowalski", headline: "Mechanical Design Engineer" },
  summary:
    "Mechanical engineer with 3 years designing sheet metal and plastic parts for consumer appliances. Works closely with suppliers and the factory floor to make parts cheaper and easier to build.",
  skills: [
    { id: "me1", category: "Engineering", items: ["SolidWorks", "GD&T", "DFM", "Tolerance analysis", "FEA"] },
    { id: "me2", category: "Other", items: ["Excel", "Minitab", "ERP (SAP)"] },
  ],
  experience: [
    {
      id: "mx1",
      company: "HomeCo Appliances",
      role: "Mechanical Design Engineer",
      dates: "2021 – Present",
      bullets: [
        "Redesigned a dishwasher door bracket in SolidWorks, cutting part cost by 18% and assembly time by 30 seconds.",
        "Worked with 6 suppliers to fix tooling issues and bring 14 new parts into production.",
        "Ran tolerance stack-ups and FEA on load-bearing parts before each design review.",
      ],
    },
  ],
};

const mfgJd = `Manufacturing Engineer — Apex Motors

Improve how we build electric motor assemblies.

Responsibilities
- Improve assembly lines for quality, cost and cycle time
- Lead root cause analysis (8D, 5 Whys) on production issues
- Work with suppliers and design engineers on DFM
- Use lean manufacturing and Six Sigma tools

Requirements
- BS in Mechanical or Manufacturing Engineering
- 2+ years in manufacturing or design for manufacturing
- SolidWorks, GD&T; Minitab a plus`;

const mechAi: AiTailorOutput = {
  job: { title: "Manufacturing Engineer", company: "Apex Motors" },
  summary:
    "Mechanical engineer with 3 years making sheet metal and plastic parts cheaper and easier to build. Works closely with suppliers and the factory floor on DFM, tooling issues and cycle time.",
  skills: [
    { category: "Manufacturing", items: ["DFM", "GD&T", "SolidWorks", "Root cause analysis", "Tolerance analysis"] },
    { category: "Other", items: ["Minitab", "Excel", "ERP (SAP)", "Six Sigma"] },
  ],
  experience: [
    {
      id: "mx1",
      bullets: [
        "Redesigned a dishwasher door bracket for manufacturing in SolidWorks, cutting part cost by 18% and assembly time by 30 seconds.",
        "Worked with 6 suppliers on root cause analysis of tooling issues and brought 14 new parts into production.",
        "Ensured seamless design reviews by running tolerance stack-ups and FEA on load-bearing parts.",
      ],
    },
  ],
  projects: [],
  project_order: [],
  keywords: [
    { term: "DFM", importance: "must" },
    { term: "lean manufacturing", importance: "must" },
    { term: "Six Sigma", importance: "must" },
  ],
  ...noIdeas,
};

// 13. customer support -> customer success manager
const support = {
  basics: { name: "Taylor Brooks", headline: "Customer Support Specialist" },
  summary:
    "Support specialist with 3 years helping customers of a B2B software company. Solves tricky problems, writes help articles and turns customer feedback into product fixes.",
  skills: [
    { id: "cs1s", category: "Support", items: ["Zendesk", "Intercom", "Help center writing", "Troubleshooting"] },
    { id: "cs2s", category: "Other", items: ["SQL (basic)", "Jira", "Slack"] },
  ],
  experience: [
    {
      id: "su1",
      company: "Ledgerline",
      role: "Customer Support Specialist",
      dates: "2022 – Present",
      bullets: [
        "Answer 40+ tickets a day in Zendesk with a 96% customer satisfaction score.",
        "Wrote 60 help center articles that cut repeat tickets on billing questions by 25%.",
        "Run monthly calls with our 10 largest customers to collect feedback for the product team.",
      ],
    },
  ],
};

const csmJd = `Customer Success Manager — Ledgerline

Own a book of mid-market customers after they buy.

You will
- Onboard new customers and drive adoption
- Run QBRs and build strong relationships with key accounts
- Reduce churn and find expansion opportunities
- Share customer feedback with product

You have
- 2+ years in customer success, account management or support at a SaaS company
- Gainsight or similar, Salesforce, Zendesk`;

const supportAi: AiTailorOutput = {
  job: { title: "Customer Success Manager", company: "Ledgerline" },
  summary:
    "Support specialist with 3 years helping customers of a B2B SaaS company succeed. Builds relationships with key accounts, solves tricky problems and turns customer feedback into product fixes.",
  skills: [
    { category: "Customer Success", items: ["Account management", "Zendesk", "Troubleshooting", "Help center writing"] },
    { category: "Other", items: ["Salesforce", "Jira", "SQL (basic)", "Slack"] },
  ],
  experience: [
    {
      id: "su1",
      bullets: [
        "Answer 40+ tickets a day in Zendesk with a 96% customer satisfaction score.",
        "Wrote 60 help center articles that cut repeat billing tickets by 25% and helped customers adopt the product.",
        "Run monthly calls with our 10 largest accounts to build relationships and bring their feedback to product.",
      ],
    },
  ],
  projects: [],
  project_order: [],
  keywords: [
    { term: "Gainsight", importance: "must" },
    { term: "Salesforce", importance: "must" },
    { term: "QBRs", importance: "must" },
  ],
  ...noIdeas,
};

// 14. fresh graduate (projects only) -> junior Python developer
const grad = {
  basics: { name: "Aarav Mehta", headline: "Computer Science Graduate" },
  summary:
    "Computer science graduate who likes building useful tools in Python. Built 3 full projects from idea to deployment and won second place at a 48-hour hackathon.",
  skills: [
    { id: "g1", category: "Languages", items: ["Python", "JavaScript", "SQL", "C"] },
    { id: "g2", category: "Tools", items: ["Flask", "SQLite", "Git", "Linux", "HTML/CSS"] },
  ],
  experience: [],
  projects: [
    {
      id: "gp1",
      name: "Campus Lost & Found",
      stack: ["Python", "Flask", "SQLite"],
      bullets: ["Built a lost-and-found web app for my college with photo uploads and email alerts; 500+ students signed up."],
    },
    {
      id: "gp2",
      name: "Bus Delay Bot",
      stack: ["Python", "Telegram API"],
      bullets: ["Made a Telegram bot that warns riders about late city buses using open transit data; 2nd place at HackCity 2024."],
    },
  ],
  education: [{ id: "ge1", degree: "B.Tech Computer Science", institution: "Pune University" }],
};

const juniorJd = `Junior Python Developer — Fieldnote

Join our small team building internal tools and APIs.

What you'll do
- Build features in Python (Django or Flask) and PostgreSQL
- Write REST APIs and tests (pytest)
- Use Git, Docker and code review every day

What we look for
- A degree in CS or similar, or projects that show you can build
- Python and SQL basics
- Curiosity and clear communication`;

const gradAi: AiTailorOutput = {
  job: { title: "Junior Python Developer", company: "Fieldnote" },
  summary:
    "Computer science graduate who builds useful web apps and tools in Python and Flask. Took 3 full projects from idea to deployment and won second place at a 48-hour hackathon.",
  skills: [
    { category: "Languages", items: ["Python", "SQL", "JavaScript", "C"] },
    { category: "Tools", items: ["Flask", "PostgreSQL", "pytest", "Git", "SQLite", "Linux"] },
  ],
  experience: [],
  projects: [
    {
      id: "gp1",
      stack: ["Python", "Flask", "SQLite"],
      bullets: ["Built a Flask web app with a REST API for my college's lost and found, with photo uploads and email alerts; 500+ students signed up."],
    },
    {
      id: "gp2",
      stack: ["Python", "Telegram API"],
      bullets: ["Built a Python Telegram bot with Docker that warns riders about late city buses using open transit data; 2nd place at HackCity 2024."],
    },
  ],
  project_order: ["gp1", "gp2"],
  keywords: [
    { term: "Python", importance: "must" },
    { term: "Django", importance: "must" },
    { term: "pytest", importance: "must" },
  ],
  ...noIdeas,
};

// 15. graphic designer -> UX/UI designer
const designer = {
  basics: { name: "Noah Kim", headline: "Graphic Designer" },
  summary:
    "Graphic designer with 5 years of brand, web and packaging work. Makes clean layouts that people understand at a glance, and works well with writers and developers.",
  skills: [
    { id: "gd1", category: "Design", items: ["Brand identity", "Typography", "Layout", "Web design", "Packaging"] },
    { id: "gd2", category: "Tools", items: ["Figma", "Adobe Illustrator", "Photoshop", "InDesign"] },
  ],
  experience: [
    {
      id: "gx1",
      company: "Northside Studio",
      role: "Graphic Designer",
      dates: "2019 – Present",
      bullets: [
        "Designed websites for 20+ local clients in Figma and handed them off to developers.",
        "Redesigned a bakery's online order page, which doubled online orders in 3 months.",
        "Created brand guides used by 8 clients to keep their marketing consistent.",
      ],
    },
  ],
};

const uxJd = `UX/UI Designer — Pantry (food delivery app)

Design simple, friendly flows for our customers and couriers.

Responsibilities
- Design user flows, wireframes and high-fidelity UI in Figma
- Run usability testing and turn findings into improvements
- Build and maintain our design system
- Work closely with product managers and engineers

Requirements
- 3+ years in UX/UI, product or web design
- Strong Figma skills and a portfolio
- Experience with user research and prototyping`;

const designerAi: AiTailorOutput = {
  job: { title: "UX/UI Designer", company: "Pantry" },
  summary:
    "Designer with 5 years of web, brand and packaging work. Designs clean, simple pages that people understand at a glance, and works closely with writers and developers from layout to hand-off.",
  skills: [
    { category: "Design", items: ["Web design", "UI design", "Layout", "Typography", "Brand identity"] },
    { category: "Tools", items: ["Figma", "Adobe Illustrator", "Photoshop", "InDesign"] },
  ],
  experience: [
    {
      id: "gx1",
      bullets: [
        "Designed websites and UI for 20+ local clients in Figma and handed them off to developers.",
        "Redesigned a bakery's online order flow after usability testing, which doubled online orders in 3 months.",
        "Built brand guides, an early design system, used by 8 clients to keep their marketing consistent.",
      ],
    },
  ],
  projects: [],
  project_order: [],
  keywords: [
    { term: "Figma", importance: "must" },
    { term: "usability testing", importance: "must" },
    { term: "design system", importance: "must" },
  ],
  ...noIdeas,
};

export const SAMPLES: Sample[] = [
  { name: "backend -> payments", resume: backend, jd: paymentsJd, ai: backendAi },
  { name: "backend -> data engineer", resume: backend, jd: dataEngJd, ai: dataEngAi },
  {
    name: "nurse -> ICU",
    resume: nurse,
    jd: icuJd,
    ai: nurseAi,
    refuse: ["Give IV medications, including heparin and diltiazem drips, and watch for side effects."],
  },
  {
    name: "marketer -> growth",
    resume: marketer,
    jd: growthJd,
    ai: marketerAi,
    refuse: ["Managed a $40k monthly Google Ads and Meta Ads budget, lowering cost per order by 22%."],
  },
  { name: "accountant -> financial analyst", resume: accountant, jd: finJd, ai: accountantAi },
  {
    name: "frontend -> full-stack",
    resume: frontend,
    jd: fullstackJd,
    ai: frontendAi,
    refuse: ["Built a habit tracking app with login, streaks and reminders; 200 weekly users."], // padded, too long
  },
  { name: "teacher -> instructional designer", resume: teacher, jd: idJd, ai: teacherAi },
  { name: "analyst -> product analyst", resume: analyst, jd: productJd, ai: analystAi },
  { name: "ops -> supply chain", resume: ops, jd: scJd, ai: opsAi },
  { name: "AI engineer -> LLM engineer", resume: legacy, jd: llmJd, ai: llmAi },
  {
    name: "sales rep -> account executive",
    resume: sales,
    jd: aeJd,
    ai: salesAi,
    refuse: [
      sales.summary, // "B2B" and "outbound": words the resume never uses
      "Beat quota in 7 of 8 quarters, closing $1.2M in new business in 2023.", // "SaaS": they sold office equipment
      "Book 15+ first meetings a month through cold calls, LinkedIn and referrals.", // "outbound"
      "Grew a book of 120 small business accounts with a 92% renewal rate.", // "Leveraged"
    ],
  },
  {
    name: "mechanical -> manufacturing engineer",
    resume: mech,
    jd: mfgJd,
    ai: mechAi,
    refuse: ["Ran tolerance stack-ups and FEA on load-bearing parts before each design review."], // "Ensured seamless"
  },
  {
    name: "support -> customer success",
    resume: support,
    jd: csmJd,
    ai: supportAi,
    refuse: [
      support.summary, // "SaaS": the resume says software
      "Wrote 60 help center articles that cut repeat tickets on billing questions by 25%.", // padded
    ],
  },
  {
    name: "graduate (projects only) -> junior developer",
    resume: grad,
    jd: juniorJd,
    ai: gradAi,
    refuse: [
      "Built a lost-and-found web app for my college with photo uploads and email alerts; 500+ students signed up.", // too long
      "Made a Telegram bot that warns riders about late city buses using open transit data; 2nd place at HackCity 2024.", // Docker
    ],
  },
  {
    name: "graphic designer -> UX/UI designer",
    resume: designer,
    jd: uxJd,
    ai: designerAi,
    refuse: [
      "Redesigned a bakery's online order page, which doubled online orders in 3 months.", // invented usability testing
      "Created brand guides used by 8 clients to keep their marketing consistent.", // padded
    ],
  },
];
