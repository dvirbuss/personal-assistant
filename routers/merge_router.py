import os
import uuid
import shutil
from typing import List
from fastapi import APIRouter, UploadFile, Form, HTTPException, File, BackgroundTasks
from fastapi.responses import FileResponse
from core.job_manager import jobs
from services.merge_service import run_merge_job

router = APIRouter()

@router.post("/merge_datasets")
async def merge_datasets(
    background_tasks: BackgroundTasks,
    base_files: List[UploadFile] = File(...),
    base_paths: List[str] = Form(...),
    new_files: List[UploadFile] = File(...),
    new_paths: List[str] = Form(...)
):
    try:
        job_id = str(uuid.uuid4())
        temp_dir = os.path.join("temp", job_id)
        base_dir = os.path.join(temp_dir, "base_dataset")
        new_dir = os.path.join(temp_dir, "new_dataset")
        
        os.makedirs(base_dir, exist_ok=True)
        os.makedirs(new_dir, exist_ok=True)

        # Save base files
        for file, rel_path in zip(base_files, base_paths):
            clean_path = rel_path.replace('\\', '/').lstrip('/')
            full_path = os.path.join(base_dir, clean_path)
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            with open(full_path, "wb") as f:
                content = await file.read()
                f.write(content)

        # Save new files
        for file, rel_path in zip(new_files, new_paths):
            clean_path = rel_path.replace('\\', '/').lstrip('/')
            full_path = os.path.join(new_dir, clean_path)
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            with open(full_path, "wb") as f:
                content = await file.read()
                f.write(content)

        jobs[job_id] = {
            "status": "processing",
            "progress": 5,
            "status_msg": "Uploaded datasets, initializing merge...",
            "temp_dir": temp_dir
        }

        background_tasks.add_task(run_merge_job, job_id, temp_dir, base_dir, new_dir)

        return {"status": "started", "job_id": job_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/download_merged/{job_id}")
def download_merged(job_id: str):
    temp_dir = None
    if job_id in jobs:
        temp_dir = jobs[job_id].get("temp_dir")
    else:
        possible = os.path.join("temp", job_id)
        if os.path.exists(possible):
            temp_dir = possible

    if not temp_dir or not os.path.exists(temp_dir):
        raise HTTPException(status_code=404, detail="Job directory not found")

    zip_path = os.path.join(temp_dir, "merged_dataset", "merged_dataset.zip")
    if not os.path.exists(zip_path):
        zip_path = os.path.join(temp_dir, "merged_dataset.zip")

    if not os.path.exists(zip_path):
        raise HTTPException(status_code=404, detail="Merged zip file not found")

    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename="merged_dataset.zip"
    )
