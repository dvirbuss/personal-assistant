import os
import webbrowser
import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from routers.video_router import router as video_router
from routers.pose_router import router as pose_router
from routers.training_router import router as training_router
from routers.evaluation_router import router as evaluation_router
from routers.merge_router import router as merge_router
from routers.youtube_router import router as youtube_router
from core.job_manager import get_job_status

app = FastAPI(title="Personal Assistant API")

os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

app.include_router(youtube_router)
app.include_router(video_router)
app.include_router(pose_router)
app.include_router(merge_router)
app.include_router(training_router)
app.include_router(evaluation_router)

@app.get("/")
def read_root():
    return FileResponse("static/index.html")

@app.get("/status/{job_id}")
def status(job_id: str):
    return get_job_status(job_id)

if __name__ == "__main__":
    url = "http://127.0.0.1:8005"
    print(f"Starting server at {url}")
    # webbrowser.open(url) # Uncomment to auto-open in browser
    uvicorn.run("main:app", host="127.0.0.1", port=8005, reload=True)
