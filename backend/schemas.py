"""Request bodies and the JSON shapes we ask the AI models to return."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator

MAX_JD_CHARS = 15_000
MAX_RESUME_TEXT_CHARS = 30_000
MAX_RESUME_JSON_CHARS = 60_000


# ---------------------------------------------------------------- requests


class TailorOptions(BaseModel):
    bullets_per_role: int = Field(3, ge=1, le=6)
    bullets_per_project: int = Field(2, ge=1, le=4)
    max_words_per_bullet: int = Field(30, ge=12, le=60)
    one_page: bool = True
    tone: Literal["balanced", "technical", "leadership", "concise"] = "balanced"
    instructions: str = Field("", max_length=600)


class TailorRequest(BaseModel):
    resume: dict
    job_description: str = Field(min_length=30, max_length=MAX_JD_CHARS)
    options: TailorOptions = TailorOptions()

    @field_validator("resume")
    @classmethod
    def _resume_size(cls, value: dict) -> dict:
        import json

        if len(json.dumps(value)) > MAX_RESUME_JSON_CHARS:
            raise ValueError("Resume is too large.")
        return value


class RewriteRequest(BaseModel):
    text: str = Field(min_length=3, max_length=800)
    mode: Literal["shorter", "impact", "keyword", "fix"] = "impact"
    keyword: str = Field("", max_length=80)
    context: str = Field("", max_length=300)
    job_description: str = Field("", max_length=MAX_JD_CHARS)


class ParseRequest(BaseModel):
    text: str = Field(min_length=40, max_length=MAX_RESUME_TEXT_CHARS)


MAX_FILE_B64_CHARS = 4_200_000  # ~3 MB file; Vercel accepts request bodies up to 4.5 MB


class FileUploadRequest(BaseModel):
    filename: str = Field("", max_length=300)
    file_base64: str = Field(min_length=10, max_length=MAX_FILE_B64_CHARS)


class FileEdit(BaseModel):
    id: str = Field(max_length=40)
    text: str = Field(max_length=2000)


class FileTailorRequest(BaseModel):
    file_type: Literal["pdf", "docx"]
    file_base64: str = Field(min_length=10, max_length=MAX_FILE_B64_CHARS)
    job_description: str = Field(min_length=30, max_length=MAX_JD_CHARS)
    options: TailorOptions = TailorOptions()


class FileRenderRequest(BaseModel):
    file_type: Literal["pdf", "docx"]
    file_base64: str = Field(min_length=10, max_length=MAX_FILE_B64_CHARS)
    edits: list[FileEdit] = Field(default_factory=list, max_length=200)


# ---------------------------------------------------------------- AI outputs


class SkillGroup(BaseModel):
    category: str
    items: list[str]


class BulletsById(BaseModel):
    id: str
    bullets: list[str]


class ProjectTailoring(BaseModel):
    id: str
    stack: list[str]
    bullets: list[str]


class Keyword(BaseModel):
    term: str
    importance: Literal["must", "nice"]


class ProjectIdea(BaseModel):
    title: str
    stack: list[str]
    pitch: str


class JobInfo(BaseModel):
    title: str
    company: str


class TailorOutput(BaseModel):
    job: JobInfo
    summary: str
    skills: list[SkillGroup]
    experience: list[BulletsById]
    projects: list[ProjectTailoring]
    project_order: list[str]
    keywords: list[Keyword]
    project_ideas: list[ProjectIdea]
    advice: list[str]


class FileTailorOutput(BaseModel):
    job: JobInfo
    edits: list[FileEdit]
    keywords: list[Keyword]
    project_ideas: list[ProjectIdea]
    advice: list[str]


class FileFixOutput(BaseModel):
    edits: list[FileEdit]


class RewriteOutput(BaseModel):
    options: list[str]


class ParsedBasics(BaseModel):
    name: str
    headline: str
    email: str
    phone: str
    location: str
    links: list[str]


class ParsedExperience(BaseModel):
    company: str
    role: str
    location: str
    dates: str
    bullets: list[str]


class ParsedProject(BaseModel):
    name: str
    link: str
    dates: str
    stack: list[str]
    bullets: list[str]


class ParsedEducation(BaseModel):
    degree: str
    institution: str
    location: str
    dates: str
    details: str


class ParsedCustomItem(BaseModel):
    title: str
    subtitle: str
    dates: str
    bullets: list[str]


class ParsedCustomSection(BaseModel):
    title: str
    items: list[ParsedCustomItem]


class ParsedResume(BaseModel):
    basics: ParsedBasics
    summary: str
    skills: list[SkillGroup]
    experience: list[ParsedExperience]
    projects: list[ParsedProject]
    education: list[ParsedEducation]
    certifications: list[str]
    custom_sections: list[ParsedCustomSection]
