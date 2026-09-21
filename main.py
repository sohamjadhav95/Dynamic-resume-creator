from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import os

from model import tailor_resume

app = FastAPI(title="Resume Tailor API")

class TailorRequest(BaseModel):
    masterData: dict
    jobDescription: str

class AnalyzeRequest(BaseModel):
    resumeText: str
    jobDescription: str

@app.post("/api/tailor")
async def api_tailor(req: TailorRequest):
    try:
        result = tailor_resume(req.masterData, req.jobDescription)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/master")
async def update_master_resume(new_data: dict):
    try:
        file_path = os.path.join("public", "master_resume.json")
        with open(file_path, "w", encoding="utf-8") as f:
            import json
            json.dump(new_data, f, indent=2)
        return {"message": "Master resume updated successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/analyze")
async def api_analyze(req: AnalyzeRequest):
    try:
        # Import dynamically if not imported at top
        from model import analyze_resume
        result = analyze_resume(req.resumeText, req.jobDescription)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Mount the static files directory at the root
# We explicitly map the public folder
app.mount("/", StaticFiles(directory="public", html=True), name="public")

if __name__ == "__main__":
    import uvicorn
    # Run the server
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
