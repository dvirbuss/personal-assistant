import os
import uuid
import shutil
from fastapi import APIRouter, UploadFile, Form, HTTPException, File, BackgroundTasks
from typing import List

from core.job_manager import jobs, cleanup_job
from services.evaluation_service import evaluate_models_background

router = APIRouter()

@router.post("/evaluate")
async def evaluate_images(
    background_tasks: BackgroundTasks,
    models: str = Form(...),  # Comma-separated models
    files: List[UploadFile] = File(...),
    paths: List[str] = Form(...)
):
    try:
        job_id = str(uuid.uuid4())
        temp_dir = os.path.join("temp", job_id)
        os.makedirs(temp_dir, exist_ok=True)
        
        # Initialize job status
        jobs[job_id] = {
            "status": "processing",
            "progress": 0,
            "temp_dir": temp_dir,
            "type": "eval"
        }
        
        # Parse models
        model_list = [m.strip() for m in models.split(",") if m.strip()]
        if not model_list:
            jobs[job_id] = {"status": "error", "error": "No models selected for evaluation."}
            return {"job_id": job_id}
            
        # Reconstruct directory structure
        if len(files) != len(paths):
            jobs[job_id] = {"status": "error", "error": "Mismatched files and paths."}
            return {"job_id": job_id}
            
        print(f"\nSaving {len(files)} uploaded files to temporary directory: {temp_dir}...")
        for file, rel_path in zip(files, paths):
            full_path = os.path.join(temp_dir, rel_path.replace('/', os.sep))
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            with open(full_path, "wb") as f:
                f.write(await file.read())
        print(f"Finished saving uploaded files. Kicking off background evaluation job...")
        
        background_tasks.add_task(evaluate_models_background, job_id, model_list, temp_dir)
        return {"job_id": job_id}
        
    except Exception as e:
        if 'job_id' in locals() and job_id in jobs:
            jobs[job_id] = {"status": "error", "error": str(e)}
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/evaluation_results/{job_id}")
def get_evaluation_results(job_id: str, background_tasks: BackgroundTasks):
    if job_id not in jobs or jobs[job_id]["status"] != "completed":
        raise HTTPException(status_code=404, detail="Job not completed or not found")
        
    results = jobs[job_id].get("results", {})
    temp_dir = jobs[job_id].get("temp_dir")
    
    # Clean up temp dir and remove job status in background after response
    background_tasks.add_task(cleanup_job, job_id, temp_dir)
    return results
