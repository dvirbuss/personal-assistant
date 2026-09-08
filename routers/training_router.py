import os
import uuid
from typing import List
from fastapi import APIRouter, UploadFile, Form, HTTPException, File
from services.training_service import run_training_job
from core.job_manager import jobs

router = APIRouter()

@router.post("/train")
async def start_training(
    files: List[UploadFile] = File(...),
    paths: List[str] = Form(...),
    base_model: str = Form(...),
    epochs: int = Form(...),
    lr0: float = Form(...),
    pose: float = Form(...),
    use_optuna: bool = Form(...),
    new_model_name: str = Form(...)
):
    try:
        job_id = str(uuid.uuid4())
        
        # Create temp dir
        temp_dir = os.path.join("temp", job_id)
        os.makedirs(temp_dir, exist_ok=True)
        
        # Reconstruct directory structure
        print(f"\nSaving {len(files)} dataset files to temporary directory: {temp_dir}...")
        for file, rel_path in zip(files, paths):
            clean_rel_path = rel_path.replace('\\', '/')
            full_path = os.path.join(temp_dir, clean_rel_path)
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            with open(full_path, "wb") as f:
                f.write(await file.read())
                
        # Find where annotations.json (or any JSON) and images folder are located
        json_path = None
        images_dir = None
        for root, dirs, filenames in os.walk(temp_dir):
            for filename in filenames:
                if filename.endswith('.json'):
                    json_path = os.path.join(root, filename)
                    break
            if "images" in dirs:
                images_dir = os.path.join(root, "images")
                
        if not json_path:
            raise Exception("Uploaded folder structure must contain a COCO annotations JSON (.json).")
        if not images_dir:
            raise Exception("Uploaded folder structure must contain an 'images' directory.")
            
        # Initialize job
        jobs[job_id] = {
            "status": "processing",
            "progress": 0,
            "status_msg": "Initializing...",
            "temp_dir": temp_dir
        }
        
        # Start background job
        run_training_job(
            job_id=job_id,
            temp_dir=temp_dir,
            json_path=json_path,
            images_dir=images_dir,
            base_model=base_model,
            epochs=epochs,
            lr0=lr0,
            pose=pose,
            use_optuna=use_optuna,
            new_model_name=new_model_name
        )
        
        return {"job_id": job_id}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/train/status/{job_id}")
async def get_training_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return jobs[job_id]
