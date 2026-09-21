# Resume Tailor ATS

Deterministic ATS-compliant Resume Builder powered by Gemini 2.5 Flash and FastAPI.

## Tech Stack
- **Frontend**: Plain HTML, CSS, JavaScript
- **Backend**: Python, FastAPI
- **AI Model**: Google Gemini (`google-genai` SDK)

## Local Setup

1. Create a Python Virtual Environment:
```bash
python -m venv venv
venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Create .env file:
```bash
cp .env.example .env
# Add your GEMINI_API_KEY
```

4. Run locally via Uvicorn:
```bash
python main.py
```
Open http://localhost:8000.

## Exporting ATS PDF

1. Click Tailor Resume with your target job posting.
2. Click Print / Export PDF (or Ctrl/Cmd + P).
3. Destination: Save as PDF
4. Paper size: A4
5. Margins: Default or None
6. Options: Ensure Background graphics is checked.