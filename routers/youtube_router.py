import os
import tempfile
import uuid
from typing import List, Optional
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from core.job_manager import jobs, cleanup_job
from services.youtube_service import download_youtube_clips_background, fetch_video_info

router = APIRouter(prefix="/youtube", tags=["youtube"])

class ClipItem(BaseModel):
    url: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    name: Optional[str] = None

class DownloadClipsRequest(BaseModel):
    items: List[ClipItem]

class VideoInfoRequest(BaseModel):
    url: str


@router.post("/info")
def get_video_info(req: VideoInfoRequest):
    if not req.url or not req.url.strip():
        raise HTTPException(status_code=400, detail="URL cannot be empty.")
    try:
        info = fetch_video_info(req.url.strip())
        return info
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch video info: {str(e)}")


@router.post("/download_clips")
async def start_youtube_download(req: DownloadClipsRequest, background_tasks: BackgroundTasks):
    valid_items = [item.dict() for item in req.items if item.url and item.url.strip()]
    if not valid_items:
        raise HTTPException(status_code=400, detail="At least one valid YouTube URL must be provided.")
        
    job_id = str(uuid.uuid4())
    temp_dir = tempfile.mkdtemp()
    
    jobs[job_id] = {
        "status": "processing",
        "progress": 0,
        "status_msg": "Queuing downloads...",
        "temp_dir": temp_dir
    }
    
    background_tasks.add_task(download_youtube_clips_background, job_id, temp_dir, valid_items)
    return {"job_id": job_id}


@router.get("/download/{job_id}")
def download_youtube_zip(job_id: str):
    if job_id not in jobs or jobs[job_id].get("status") != "completed":
        raise HTTPException(status_code=404, detail="Download not ready or expired.")
        
    job_info = jobs[job_id]
    result_path = job_info.get("result_path")
    temp_dir = job_info.get("temp_dir")
    
    if not result_path or not os.path.exists(result_path):
        raise HTTPException(status_code=404, detail="ZIP archive file not found.")
        
    utc_plus_3 = timezone(timedelta(hours=3))
    now = datetime.now(utc_plus_3)
    date_str = now.strftime("%d-%m-%y_%H-%M")
    
    return FileResponse(
        path=result_path,
        media_type="application/zip",
        filename=f"youtube_clips_{date_str}.zip",
        background=BackgroundTask(cleanup_job, job_id, temp_dir)
    )
