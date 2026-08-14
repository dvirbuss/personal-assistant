import os
import uuid
from typing import List
from fastapi import APIRouter, UploadFile, Form, HTTPException
from services.training_service import run_training_job
from core.job_manager import jobs

router = APIRouter()

@router.post("/train")
async def start_training(
    json_file: UploadFile,
    images: List[UploadFile],
    base_model: str = Form(...),
    epochs: int = Form(...),
    new_model_name: str = Form(...)
):
    try:
        job_id = str(uuid.uuid4())
        
        # Create temp dir
        temp_dir = os.path.join("temp", job_id)
        os.makedirs(temp_dir, exist_ok=True)
        
        # Save JSON
        json_path = os.path.join(temp_dir, "annotations.json")
        with open(json_path, "wb") as f:
            f.write(await json_file.read())
            
        # Save images
        images_dir = os.path.join(temp_dir, "uploaded_images")
        os.makedirs(images_dir, exist_ok=True)
        
        for img_file in images:
            img_path = os.path.join(images_dir, img_file.filename)
            with open(img_path, "wb") as f:
                f.write(await img_file.read())
                
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
