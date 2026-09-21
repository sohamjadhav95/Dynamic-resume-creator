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

@app.post("/api/tailor")
        print(f"Error during tailoring: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Mount the static files directory at the root
# We explicitly map the public folder
app.mount("/", StaticFiles(directory="public", html=True), name="public")

if __name__ == "__main__":
    import uvicorn
    # Run the server
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
