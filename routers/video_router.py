import os
import shutil
import tempfile
import json
import uuid
from typing import List
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from core.job_manager import jobs, cleanup_job
from services.video_service import process_video_background

router = APIRouter()

@router.post("/process_video")
async def process_video(
    background_tasks: BackgroundTasks, 
    files: List[UploadFile] = File(...), 
    limits: str = Form(...),
    fps_option: int = Form(1)
):
    job_id = str(uuid.uuid4())
    temp_dir = tempfile.mkdtemp()
    
    try:
        limits_list = json.loads(limits)
    except Exception:
        limits_list = [25] * len(files)
        
    if len(limits_list) < len(files):
        limits_list.extend([25] * (len(files) - len(limits_list)))
    limits_list = limits_list[:len(files)]
        
    jobs[job_id] = {
        "status": "processing",
        "progress": 0,
        "temp_dir": temp_dir
    }
    
    from utils.zip_helper import extract_if_zip
    
    file_info_list = []
    
    # Check if a single zip file was uploaded
    if len(files) == 1 and files[0].filename.lower().endswith('.zip'):
        zip_file = files[0]
        zip_path = os.path.join(temp_dir, zip_file.filename)
        with open(zip_path, "wb") as buffer:
            shutil.copyfileobj(zip_file.file, buffer)
            
        if extract_if_zip(zip_path, temp_dir):
            # Find all videos extracted
            valid_exts = ('.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v')
            extracted_videos = []
            for root, _, extracted_files in os.walk(temp_dir):
                for f in extracted_files:
                    if f.lower().endswith(valid_exts):
                        extracted_videos.append(os.path.join(root, f))
            
            for v_path in extracted_videos:
                file_info_list.append({
                    "filename": os.path.basename(v_path),
                    "path": v_path
                })
            
            # Since limits were based on original 1 file, apply first limit to all extracted videos
            if len(limits_list) > 0:
                limits_list = [limits_list[0]] * len(file_info_list)
            else:
                limits_list = [25] * len(file_info_list)
    else:
        for file in files:
            if file.filename:
                orig_filename = file.filename.replace('\\', '/').split('/')[-1]
            else:
                orig_filename = "video.mp4"
                
            video_path = os.path.join(temp_dir, orig_filename)
            with open(video_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            file_info_list.append({
                "filename": orig_filename,
                "path": video_path
            })
            
    if not file_info_list:
        jobs[job_id] = {"status": "error", "error": "No valid videos found."}
        return {"job_id": job_id}
        
    background_tasks.add_task(process_video_background, job_id, temp_dir, file_info_list, limits_list, fps_option)
    return {"job_id": job_id}

@router.get("/download/{job_id}")
def download_result(job_id: str):
    if job_id not in jobs or jobs[job_id]["status"] != "completed":
        return {"error": "Job not completed or not found"}
        
    job_info = jobs[job_id]
    result_path = job_info["result_path"]
    temp_dir = job_info["temp_dir"]
    
    utc_plus_3 = timezone(timedelta(hours=3))
    now = datetime.now(utc_plus_3)
    date_str = now.strftime("%d-%m-%y_%H-%M")
    
    return FileResponse(
        path=result_path,
        media_type="application/zip",
        filename=f"videos_frames_{date_str}.zip",
        background=BackgroundTask(cleanup_job, job_id, temp_dir)
    )
