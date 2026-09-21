import os
from pydantic import BaseModel, Field
from typing import List
from google import genai
from google.genai import types
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize Gemini Client
client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))

# Define Pydantic schema for structured output
class Skills(BaseModel):
    languages: str
    generative_ai: str
    ml_dl: str
    data_systems: str
    architecture: str
    deployment_mlops: str

class ExperienceEntry(BaseModel):
    role: str
    company: str
    timeline: str
    bullets: List[str]

class ProjectEntry(BaseModel):
    name: str
    timeline: str
    stack: str
    bullets: List[str]

class TailoredResume(BaseModel):
    summary: str = Field(description="A tailored 2-3 sentence professional summary focusing on requirements found in the JD.")
    skills: Skills
    experience: List[ExperienceEntry]
    projects: List[ProjectEntry]

def tailor_resume(master_data: dict, job_description: str) -> dict:
    """
    Calls the Gemini API to tailor the master resume based on the job description.
    """
    system_instruction = """
    You are an expert ATS Resume Optimization Engine. You will be provided with:
    1. Master Resume Data (Ground Truth - facts, metrics, tools, experiences).
    2. Target Job Description (Target role criteria).
    
    Strict Rules:
    - NEVER invent new employers, projects, metrics, or technologies not grounded in Master Resume Data.
    - DO NOT alter company names, project names, or role titles. ONLY modify the descriptive bullet points and the skills list to better match the Job Description.
    - Select and prioritize the most relevant projects (maximum 4) that directly match the JD.
    - Re-align action verbs and emphasize matching technical proficiencies to maximize ATS relevancy.
    - STRICT LENGTH CONSTRAINTS (CRITICAL for formatting):
        - Each line/category in the "skills" section must NOT exceed 15 words. Keep them as concise comma-separated lists.
        - Each bullet point in the "experience" and "projects" sections must NOT exceed 30 words (strictly 1 to 2 lines max). Do not expand short points into paragraphs.
    - Return ONLY valid JSON adhering strictly to the provided schema.
    """
    
    prompt = f"Master Resume: {master_data}\n\nTarget Job Description:\n{job_description}"
    
    # We use gemini-3.6-flash for structured output
    response = client.models.generate_content(
        model='gemini-3.5-flash',
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=system_instruction,
            response_mime_type="application/json",
            response_schema=TailoredResume,
            temperature=0.15,
        ),
    )
    
    # The SDK automatically returns the text which is a JSON string matching the schema
    # We can parse it and return as a dict
    import json
    return json.loads(response.text)
