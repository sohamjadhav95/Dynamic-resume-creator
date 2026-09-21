import os
from pydantic import BaseModel, Field
from typing import List
from google import genai
from google.genai import types
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

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
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise Exception("GEMINI_API_KEY is missing! Please add it to your Vercel Environment Variables.")
        
    client = genai.Client(api_key=api_key)
    
    system_instruction = """
    You are an expert ATS Resume Optimization Engine. You will be provided with:
    1. Master Resume Data (Ground Truth - facts, metrics, tools, experiences).
    2. Target Job Description (Target role criteria).
    
    Strict Rules:
    - NEVER invent new employers, projects, metrics, or technologies not grounded in Master Resume Data.
    - DO NOT alter company names, project names, or role titles. ONLY modify the descriptive bullet points and the skills list to better match the Job Description.
    - Select and prioritize the most relevant projects (maximum 4) that directly match the JD.
    - TONE & STYLE (CRITICAL): Write in a highly natural, human-like, and direct professional tone. AVOID robotic AI patterns, cliché buzzwords (e.g., "spearheaded", "synergized", "delved", "unleashed"), and overly complex corporate jargon. Write as if a real engineer is describing their work.
    - CONTENT FOCUS: Use the "Hook -> Action -> Result" framework. Bullet points should clearly state the specific problem you solved, the exact action taken, and concrete business/technical results, rather than just listing general responsibilities. Make them punchy and interesting.
    - STRICT LENGTH CONSTRAINTS (CRITICAL for formatting):
        - Each line/category in the "skills" section must NOT exceed 15 words. Keep them as concise comma-separated lists.
        - Each bullet point in the "experience" and "projects" sections must NOT exceed 30 words (strictly 1 to 2 lines max). Do not expand short points into paragraphs.
    - Return ONLY valid JSON adhering strictly to the provided schema.
    """
    
    prompt = f"Master Resume: {master_data}\n\nTarget Job Description:\n{job_description}"
    
    # Fallback loop for free models in case of rate limits or high demand
    # WARNING: Do not put invalid models at the top. 
    # Vercel's free tier has a strict 10-second timeout. Testing invalid models wastes seconds on HTTP errors and causes a crash.
    models_to_try = [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
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
            
    # If all models fail, raise the last error
    raise Exception(f"All fallback models failed. Last error: {str(last_error)}")
