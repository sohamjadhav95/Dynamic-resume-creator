// Skill dictionary for the offline keyword engine.
// Format: "Canonical name|alias|alias". Matching is case-insensitive on whole words.
// Covers many professions so the match score works for everyone, not just engineers.

export const SKILL_ENTRIES: string[] = [
  // ---- programming languages
  "Python", "Java", "JavaScript|JS|ECMAScript", "TypeScript|TS", "C++|cpp", "C#|C sharp|csharp", "C", "Go|Golang",
  "Rust", "Ruby", "PHP", "Swift", "Kotlin", "Scala", "R", "MATLAB", "Julia", "Perl", "Dart", "Elixir", "Haskell",
  "Clojure", "Lua", "Objective-C", "Bash|shell scripting|shell", "PowerShell", "SQL", "PL/SQL", "T-SQL", "VBA",
  "COBOL", "Fortran", "Solidity", "Groovy", "Assembly",
  // ---- web / frontend
  "HTML|HTML5", "CSS|CSS3", "Sass|SCSS", "Tailwind|Tailwind CSS|TailwindCSS", "React|React.js|ReactJS",
  "Next.js|NextJS", "Vue|Vue.js|VueJS", "Nuxt", "Angular|AngularJS", "Svelte|SvelteKit", "Redux", "jQuery",
  "Webpack", "Vite", "Node.js|Node|NodeJS", "Express|Express.js", "NestJS", "Deno", "Bun", "GraphQL", "REST|REST API|REST APIs|RESTful",
  "gRPC", "WebSockets|WebSocket", "OAuth|OAuth2", "JWT", "Accessibility|a11y|WCAG", "Responsive design",
  "Web performance", "SEO|search engine optimization", "Storybook", "Three.js", "WebGL", "WebAssembly|Wasm",
  // ---- backend frameworks
  "Django", "Flask", "FastAPI", "Spring|Spring Boot", "Rails|Ruby on Rails", "Laravel", ".NET|dotnet|ASP.NET",
  "Gin", "Phoenix", "Microservices|microservice", "Serverless", "Event-driven architecture|event driven",
  "System design", "Distributed systems", "API design", "Message queues|message queue",
  // ---- mobile
  "iOS", "Android", "React Native", "Flutter", "SwiftUI", "Jetpack Compose", "Xamarin", "Mobile development",
  // ---- databases / data infra
  "PostgreSQL|Postgres", "MySQL", "SQLite", "SQL Server|MSSQL", "Oracle", "MongoDB|Mongo", "Redis", "Cassandra",
  "DynamoDB", "Elasticsearch|Elastic|OpenSearch", "Neo4j", "Snowflake", "BigQuery", "Redshift", "Databricks",
  "Supabase", "Firebase", "ClickHouse", "Kafka|Apache Kafka", "RabbitMQ", "Spark|Apache Spark|PySpark", "Hadoop",
  "Hive", "Airflow|Apache Airflow", "dbt", "Flink", "Beam", "ETL|ELT", "Data pipelines|data pipeline",
  "Data modeling|data modelling", "Data warehousing|data warehouse", "Data lake|lakehouse", "Delta Lake",
  "Data governance", "Data quality", "Fivetran", "Looker", "Tableau", "Power BI|PowerBI", "Excel|Microsoft Excel",
  "Google Sheets", "Metabase", "Superset", "Qlik", "SAS", "SPSS", "Stata",
  // ---- cloud / devops
  "AWS|Amazon Web Services", "Azure|Microsoft Azure", "GCP|Google Cloud|Google Cloud Platform", "EC2", "S3", "Lambda|AWS Lambda",
  "ECS", "EKS", "CloudFormation", "Docker", "Kubernetes|K8s", "Helm", "Terraform", "Ansible", "Pulumi", "Chef", "Puppet",
  "CI/CD|CI CD|continuous integration|continuous delivery|continuous deployment", "Jenkins", "GitHub Actions",
  "GitLab CI", "CircleCI", "ArgoCD|Argo CD", "Git", "Linux", "Unix", "Nginx", "Prometheus", "Grafana", "Datadog",
  "Splunk", "New Relic", "Observability", "Monitoring", "SRE|site reliability", "Infrastructure as code|IaC",
  "Vercel", "Heroku", "Cloudflare", "Networking", "TCP/IP", "DNS", "Load balancing",
  // ---- security
  "Cybersecurity|cyber security|information security|infosec", "Penetration testing|pentesting|pen testing",
  "SIEM", "SOC 2|SOC2", "ISO 27001", "NIST", "OWASP", "IAM|identity and access management", "Zero trust",
  "Vulnerability management", "Threat modeling", "Incident response", "Encryption", "Firewalls|firewall",
  "Cloud security", "Application security|AppSec", "GDPR", "HIPAA", "PCI DSS|PCI",
  // ---- AI / ML
  "Machine learning|ML", "Deep learning", "Artificial intelligence|AI", "Generative AI|GenAI|gen AI",
  "LLM|LLMs|large language models|large language model", "NLP|natural language processing", "Computer vision|CV",
  "PyTorch", "TensorFlow", "Keras", "JAX", "scikit-learn|sklearn", "XGBoost", "LightGBM", "Pandas", "NumPy",
  "SciPy", "Matplotlib", "Hugging Face|HuggingFace|Transformers", "LangChain", "LangGraph", "LlamaIndex",
  "RAG|retrieval augmented generation|retrieval-augmented generation", "Vector databases|vector database|vector DB",
  "Pinecone", "Weaviate", "ChromaDB|Chroma", "FAISS", "Prompt engineering", "Fine-tuning|fine tuning|finetuning",
  "LoRA|QLoRA", "RLHF", "Embeddings", "AI agents|agentic|multi-agent", "OpenAI", "MLOps", "MLflow",
  "Kubeflow", "SageMaker", "Vertex AI", "Model deployment", "Feature engineering", "A/B testing|AB testing|experimentation",
  "Statistics|statistical analysis", "Time series|forecasting", "Recommendation systems|recommender systems",
  "Reinforcement learning", "OpenCV", "Segmentation", "Object detection", "CNN|CNNs|convolutional neural networks",
  "Transformers architecture", "Data science", "Data analysis|data analytics|analytics", "Predictive modeling",
  "Regression", "Classification", "Clustering", "Big data", "Jupyter",
  // ---- testing / quality
  "Unit testing|unit tests", "Integration testing", "Test automation|automated testing", "TDD|test-driven development",
  "Jest", "Pytest", "Cypress", "Playwright", "Selenium", "JUnit", "QA|quality assurance", "Performance testing",
  "Load testing", "Code review|code reviews",
  // ---- design / product
  "Figma", "Sketch", "Adobe XD", "Adobe Creative Suite|Adobe Creative Cloud", "Photoshop", "Illustrator", "InDesign",
  "After Effects", "Premiere Pro", "Canva", "UX|user experience", "UI|user interface", "UX research|user research",
  "Usability testing", "Wireframing|wireframes", "Prototyping|prototypes", "Design systems|design system",
  "Interaction design", "Visual design", "Information architecture", "Product design", "Motion design",
  "Product management", "Product strategy", "Roadmapping|roadmap|roadmaps", "Product discovery", "OKRs|OKR",
  "KPIs|KPI", "User stories", "Requirements gathering", "PRD|product requirements", "Go-to-market|GTM",
  "Jira", "Confluence", "Asana", "Trello", "Notion", "Linear", "Miro",
  // ---- methods / management
  "Agile", "Scrum", "Kanban", "Lean", "Six Sigma", "Waterfall", "Project management", "Program management",
  "PMP", "PRINCE2", "Stakeholder management|stakeholder communication|stakeholders", "Risk management",
  "Change management", "Budgeting|budget management", "Resource planning", "Vendor management", "Process improvement",
  "Operations management", "Strategic planning", "Cross-functional collaboration|cross-functional",
  "People management|team management|managing teams", "Hiring|recruiting", "Mentoring|mentorship|coaching",
  // ---- marketing / sales
  "Digital marketing", "Content marketing", "Social media marketing|social media", "Email marketing", "SEM|PPC|paid search",
  "Google Ads", "Meta Ads|Facebook Ads", "Google Analytics|GA4", "HubSpot", "Salesforce", "Marketo", "Mailchimp",
  "CRM", "Copywriting", "Brand strategy|branding", "Market research", "Growth marketing", "Marketing automation",
  "Lead generation", "Conversion rate optimization|CRO", "Campaign management", "Public relations|PR",
  "Content strategy", "B2B", "B2C", "SaaS", "Sales", "Account management", "Business development",
  "Customer success", "Negotiation", "Cold calling|prospecting", "Pipeline management", "Customer service|customer support",
  "Zendesk", "Partnerships",
  // ---- finance / business
  "Financial modeling|financial modelling", "Financial analysis", "Accounting", "Bookkeeping", "GAAP", "IFRS",
  "Auditing|audit", "Tax", "Forecasting and budgeting|FP&A", "Valuation", "Investment banking", "Equity research",
  "Portfolio management", "Risk analysis", "Compliance", "Anti-money laundering|AML", "KYC", "QuickBooks", "SAP",
  "Oracle Financials", "NetSuite", "Xero", "Payroll", "Accounts payable", "Accounts receivable", "Reconciliation",
  "Business analysis|business analyst", "Business intelligence|BI", "Data visualization|data visualisation",
  "Supply chain", "Logistics", "Procurement", "Inventory management", "ERP", "Pricing strategy",
  // ---- HR / legal / admin
  "Talent acquisition", "Onboarding", "Employee relations", "Performance management", "Compensation and benefits|compensation",
  "HRIS", "Workday", "Training and development|L&D", "Diversity and inclusion|DEI", "Contract negotiation",
  "Legal research", "Contract drafting|contracts", "Litigation", "Regulatory compliance", "Intellectual property|IP law",
  "Microsoft Office|MS Office", "Word|Microsoft Word", "PowerPoint", "Outlook", "Data entry", "Scheduling",
  // ---- healthcare / science / education / engineering
  "Patient care", "EHR|EMR|electronic health records", "Epic", "Cerner", "Clinical research", "Clinical trials",
  "GCP compliance|good clinical practice", "CPR|BLS", "ACLS", "Phlebotomy", "Medical coding|ICD-10", "Nursing",
  "Pharmacology", "Laboratory|lab techniques", "PCR", "Bioinformatics", "Genomics", "Biostatistics",
  "Curriculum development", "Lesson planning", "Classroom management", "Instructional design", "LMS|learning management system",
  "AutoCAD", "SolidWorks", "CAD", "Revit", "MATLAB Simulink|Simulink", "PLC", "Embedded systems|embedded",
  "FPGA", "Verilog", "VHDL", "PCB design", "IoT|Internet of Things", "Robotics", "ROS", "Mechanical design",
  "Electrical engineering", "Civil engineering", "Quality control", "Lean manufacturing", "GIS|ArcGIS",
  // ---- soft skills (lower weight, still useful)
  "Communication|communication skills|written communication|verbal communication", "Leadership", "Problem solving|problem-solving",
  "Teamwork|collaboration", "Time management", "Attention to detail|detail-oriented", "Critical thinking",
  "Adaptability", "Presentation skills|presenting|presentations", "Analytical skills|analytical", "Ownership",
  "Customer focus|customer-focused", "Creativity", "Decision making|decision-making",
];

export const SOFT_SKILLS = new Set([
  "Communication", "Leadership", "Problem solving", "Teamwork", "Time management", "Attention to detail",
  "Critical thinking", "Adaptability", "Presentation skills", "Analytical skills", "Ownership", "Customer focus",
  "Creativity", "Decision making",
]);

// Single letters / very common words that only count when written exactly like this (case-sensitive).
export const CASE_SENSITIVE = new Set(["C", "R", "Go", "Word", "Linear", "Lean", "Spark", "Epic", "Chef", "Puppet", "Express", "Bun", "Gin", "Beam", "AI", "ML", "CV", "PR", "IP law", "BI", "TS", "JS", "UI", "UX", "QA", "Tax", "Elastic", "Node", "Oracle", "Sales", "Outlook", "Mongo", "Chroma"]);
