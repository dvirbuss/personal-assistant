import os
import uuid
import shutil
from fastapi import APIRouter, UploadFile, Form, HTTPException, File
from services.evaluation_service import evaluate_models
from utils.zip_helper import extract_if_zip

router = APIRouter()

@router.post("/evaluate")
async def evaluate_images(
    model_a: str = Form(...),
    model_b: str = Form(...),
    dataset_zip: UploadFile = File(...)
):
    try:
        job_id = str(uuid.uuid4())
        temp_dir = os.path.join("temp", job_id)
        os.makedirs(temp_dir, exist_ok=True)
        
        # Save ZIP
        zip_path = os.path.join(temp_dir, dataset_zip.filename)
        with open(zip_path, "wb") as f:
            f.write(await dataset_zip.read())
            
        # Extract
        extract_if_zip(zip_path, temp_dir)
        
        # Temp dir should now contain images/ and labels/
        # Or maybe it has them in a subfolder. Let's create a yaml file pointing to temp_dir.
        
        results = evaluate_models(model_a, model_b, temp_dir)
        
        # Cleanup temp dir (optional, but good for space)
        shutil.rmtree(temp_dir, ignore_errors=True)
        
        return results
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
