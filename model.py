import os
from pydantic import BaseModel, Field
from typing import List
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

# Schema for 3 dynamic, ATS-aligned skill lines
class SkillCategory(BaseModel):
    category_name: str = Field(
        description="Dynamic category title matching the JD (e.g., 'Languages & Core Frameworks', 'Generative & Agentic AI', 'ML Systems & Computer Vision')"
    )
    skills: str = Field(
        description="Comma-separated skills list. STRICT LIMIT: Under 15 words."
    )

class ExperienceEntry(BaseModel):
    role: str
    company: str
    timeline: str
    bullets: List[str] = Field(
        description="Exactly 2 punchy bullet points adhering to Hook -> Action -> Result. Max 30 words each."
    )

class ProjectEntry(BaseModel):
    name: str = Field(description="Project title.")
    timeline: str = Field(description="Project timeline e.g., '2025 - 2026' or '2026'.")
    stack: str = Field(description="Comma-separated tech stack list.")
    bullets: List[str] = Field(
        description="STRICTLY 1 high-impact bullet point following Problem -> Architecture -> Metric. Max 30 words."
    )

class TailoredResume(BaseModel):
    summary: str = Field(
        description="Tailored professional summary. STRICT LIMIT: Between 35 and 45 words (maximum 3 lines). Must reflect the target role while keeping ground-truth credentials."
    )
    skills: List[SkillCategory] = Field(
        description="STRICTLY 3 skill categories tailored to the JD.",
        min_length=3,
        max_length=3
    )
    experience: List[ExperienceEntry] = Field(
        description="The 2 professional experience entries tailored to the JD."
    )
    projects: List[ProjectEntry] = Field(
        description="Exactly 4 projects: #1 Convo-Ease, #2 Dynamic Chameleon Project, #3 Copilot for DS, #4 RenAIssance OCR.",
        min_length=4,
        max_length=4
    )

class ATSKeyword(BaseModel):
    skill: str = Field(description="The exact hard skill or keyword found in the Job Description")
    count_in_jd: int = Field(description="Number of times this skill appears in the Job Description")
    found_in_resume: bool = Field(description="True if the exact or synonymous skill is present in the Tailored Resume Text")

class ATSAnalysisResult(BaseModel):
    keywords: List[ATSKeyword] = Field(description="List of top 10-15 hard skills and keywords extracted from the JD")

def tailor_resume(master_data: dict, job_description: str) -> dict:
    """
    Calls the Gemini API to tailor the master resume based on the job description.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise Exception("GEMINI_API_KEY is missing! Please add it to your environment variables.")
        
    client = genai.Client(api_key=api_key)
    
    system_instruction = """
    You are an expert ATS Resume Optimization Engine. You will receive:
    1. Master Resume Data (Ground Truth - facts, metrics, tools, experiences).
    2. Target Job Description (Target role criteria).

    Core Tailoring Rules:
    - NEVER invent employers, formal degrees, or unearned credentials.
    - ATS KEYWORD INJECTION: Actively extract critical hard skills/keywords from the JD and inject them into the 'skills' section and project descriptions wherever plausible.
    
    SECTION-BY-SECTION CONSTRAINTS (STRICT A4 FORMATTING):
    
    1. PROFESSIONAL SUMMARY:
       - Length: Strictly between 35 and 45 words (maximum 3 lines).
       - Maintain grounding: Highlight relevant strengths for the role while maintaining real credibility (e.g., Springer Nature research, open-source systems).

    2. TECHNICAL SKILLS:
       - Output STRICTLY 3 categories (lines).
       - The category names must be dynamically tailored to the target role (e.g., if applying for ML Ops, line 3 can be 'MLOps & Cloud Infrastructure'; if CV, 'Computer Vision & Deep Learning').
       - Each category's skills string must NOT exceed 15 words. Keep them as clean, comma-separated lists.

    3. PROFESSIONAL EXPERIENCE:
       - Keep company names, roles, and timelines identical to the master resume.
       - Exactly 2 bullets per experience item.
       - Each bullet must NOT exceed 30 words (strictly 1 to 2 lines max). Use Hook -> Action -> Metric.

    4. PROJECTS (4 TOTAL):
       - Project 1: 'Convo-Ease: Intelligent Multi-Modal Content Moderation' (Keep title fixed; tailor stack and bullet).
       - Project 2 (DYNAMIC CHAMELEON SLOT): Create or adapt this project to be the HIGHEST direct match for the JD's core focus.
         * Realism Rule: The project architecture must be practical and realistic—something an engineer can build end-to-end within 24 hours using Python, FastAPI, LangGraph/LangChain, Vector DBs, PyTorch, or Docker.
         * Structure: Title, Timeline (2026), Stack (relevant to JD), and exactly 1 bullet (Problem -> Architecture -> Result metric).
       - Project 3: 'Copilot for Data Science and Analysis' (Keep title fixed; tailor stack and bullet).
       - Project 4: 'RenAIssance OCR: Historical Document Recognition' (Keep title fixed; tailor stack and bullet).
       - Each project must have EXACTLY 1 bullet point of under 30 words.

    Return ONLY valid JSON adhering strictly to the provided schema.
    """
    
    prompt = f"Master Resume:\n{master_data}\n\nTarget Job Description:\n{job_description}"
    
    models_to_try = [
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-2.0-flash",
    ]
    
    last_error = None
    for model_name in models_to_try:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    response_mime_type="application/json",
                    response_schema=TailoredResume,
                    temperature=0.15,
                ),
            )
            import json
            return json.loads(response.text)
        except Exception as e:
            last_error = e
            print(f"Warning: {model_name} failed with error: {e}. Trying next model...")
            continue
            
    raise Exception(f"All fallback models failed. Last error: {str(last_error)}")

def analyze_resume(resume_text: str, job_description: str) -> dict:
    """
    Extracts keywords from the Job Description and checks if they are present in the Tailored Resume.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise Exception("GEMINI_API_KEY is missing! Please add it to your environment variables.")
        
    client = genai.Client(api_key=api_key)
    
    system_instruction = """
    You are an expert ATS Resume Analyzer.
    1. Read the target Job Description and extract top 10-15 critical hard skills and tools.
    2. Count their frequency in the JD.
    3. Verify if each keyword exists in the Tailored Resume Text.
    4. Return valid JSON adhering strictly to the ATSAnalysisResult schema.
    """
    
    prompt = f"Target Job Description:\n{job_description}\n\nTailored Resume Text:\n{resume_text}"
    
    models_to_try = [
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-2.0-flash",
    ]
    
    last_error = None
    for model_name in models_to_try:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    response_mime_type="application/json",
                    response_schema=ATSAnalysisResult,
                    temperature=0.1,
                ),
            )
            import json
            return json.loads(response.text)
        except Exception as e:
            last_error = e
            print(f"Warning: {model_name} failed with error: {e}. Trying next model...")
            continue
            
    raise Exception(f"All fallback models failed for analysis. Last error: {str(last_error)}")
