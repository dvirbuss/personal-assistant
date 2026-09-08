import os
import shutil
import tempfile
import uuid
import glob
import json
import zipfile
from typing import List, Dict
from fastapi import APIRouter, UploadFile, File, Form, BackgroundTasks, HTTPException, Body
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from core.job_manager import jobs, cleanup_job
from services.pose_service import process_poses_background
from utils.zip_helper import extract_if_zip

router = APIRouter()

@router.get("/models")
def list_models():
    models_dir = "models"
    os.makedirs(models_dir, exist_ok=True)
    model_files = [os.path.basename(f) for f in glob.glob(os.path.join(models_dir, "*.pt"))]
    return {"models": model_files}

@router.post("/detect_poses")
async def detect_poses(background_tasks: BackgroundTasks, files: List[UploadFile] = File(...), model_name: str = Form("yolov8n-pose_1_det.pt"), run_model: bool = Form(True)):
    job_id = str(uuid.uuid4())
    temp_dir = tempfile.mkdtemp()
    
    jobs[job_id] = {
        "status": "processing",
        "progress": 0,
        "temp_dir": temp_dir,
        "type": "pose"
    }
    
    file_info_list = []
    
    if len(files) == 1 and files[0].filename.lower().endswith('.zip'):
        zip_file = files[0]
        zip_path = os.path.join(temp_dir, zip_file.filename)
        with open(zip_path, "wb") as buffer:
            zip_file.file.seek(0)
            shutil.copyfileobj(zip_file.file, buffer)
            
        if not zipfile.is_zipfile(zip_path):
            jobs[job_id] = {"status": "error", "error": f"Uploaded file {zip_file.filename} is not a valid ZIP archive."}
            return {"job_id": job_id}
            
        if extract_if_zip(zip_path, temp_dir):
            valid_exts = ('.jpg', '.jpeg', '.png')
            for root, _, extracted_files in os.walk(temp_dir):
                for f in extracted_files:
                    if f.lower().endswith(valid_exts):
                        v_path = os.path.join(root, f)
                        rel_name = os.path.relpath(v_path, temp_dir).replace('\\', '/')
                        file_info_list.append({
                            "filename": rel_name,
                            "path": v_path
                        })
        else:
            jobs[job_id] = {"status": "error", "error": "extract_if_zip failed to extract the ZIP archive."}
            return {"job_id": job_id}
    else:
        for file in files:
            if file.filename:
                orig_filename = file.filename.replace('\\', '/').split('/')[-1]
            else:
                orig_filename = "image.jpg"
                
            image_path = os.path.join(temp_dir, orig_filename)
            with open(image_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            file_info_list.append({
                "filename": orig_filename,
                "path": image_path
            })
            
            
    if not file_info_list:
        jobs[job_id] = {"status": "error", "error": "No valid images (.jpg, .jpeg, .png) found in the upload."}
        return {"job_id": job_id}
        
    if not run_model:
        results_data = []
        for file_info in file_info_list:
            filename = file_info["filename"]
            empty_kpts = [{"x": 0.0, "y": 0.0, "v": 0} for _ in range(17)]
            results_data.append({
                "filename": filename,
                "keypoints": empty_kpts
            })
        jobs[job_id]["status"] = "completed"
        jobs[job_id]["progress"] = 100
        jobs[job_id]["results"] = results_data
    else:
        background_tasks.add_task(process_poses_background, job_id, temp_dir, file_info_list, model_name)
        
    return {"job_id": job_id}

@router.get("/pose_results/{job_id}")
def get_pose_results(job_id: str):
    if job_id not in jobs or jobs[job_id]["status"] != "completed":
        return {"error": "Job not completed or not found"}
        
    results = jobs[job_id].get("results", [])
    
    # We DO NOT delete temp_dir or jobs[job_id] here because we might export GT later.
    
    return {"results": results}

@router.get("/temp_image/{job_id}/{filename:path}")
def get_temp_image(job_id: str, filename: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
        
    temp_dir = jobs[job_id].get("temp_dir")
    image_path = os.path.join(temp_dir, filename)
    
    # Basic path traversal protection
    if not os.path.abspath(image_path).startswith(os.path.abspath(temp_dir)):
        raise HTTPException(status_code=403, detail="Invalid path")
        
    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail="Image not found")
        
    return FileResponse(image_path)

@router.post("/export_training_dataset/{job_id}")
def export_training_dataset(job_id: str, payload: Dict = Body(...)):
    temp_dir = None
    if job_id in jobs:
        temp_dir = jobs[job_id].get("temp_dir")
    else:
        possible_dir = os.path.join("temp", job_id)
        if os.path.exists(possible_dir):
            temp_dir = possible_dir
            
    if not temp_dir or not os.path.exists(temp_dir):
        raise HTTPException(status_code=404, detail="Job/Temp directory not found")
        
    import json
    import datetime
    
    export_dir = os.path.join(temp_dir, "export_training")
    images_dir = os.path.join(export_dir, "images")
    os.makedirs(images_dir, exist_ok=True)
    
    COCO_KEYPOINT_NAMES = [
        "Nose", "Left Eye", "Right Eye", "Left Ear", "Right Ear",
        "Left Shoulder", "Right Shoulder", "Left Elbow", "Right Elbow",
        "Left Wrist", "Right Wrist", "Left Hip", "Right Hip",
        "Left Knee", "Right Knee", "Left Ankle", "Right Ankle"
    ]
    
    coco_data = {
        "info": {
            "description": "Pose Annotations Exported from Tool 2",
            "date_created": datetime.datetime.now().isoformat()
        },
        "images": [],
        "annotations": [],
        "categories": [{
            "id": 1,
            "name": "person",
            "supercategory": "person",
            "keypoints": COCO_KEYPOINT_NAMES
        }]
    }
    
    image_id = 1
    annot_id = 1
    
    for filename, data in payload.items():
        original_img_path = os.path.join(temp_dir, filename)
        if not os.path.exists(original_img_path):
            continue
            
        new_img_name = filename.replace('/', '_').replace('\\', '_')
        dest_img_path = os.path.join(images_dir, new_img_name)
        shutil.copy2(original_img_path, dest_img_path)
        
        width = float(data.get("width", 1))
        height = float(data.get("height", 1))
        keypoints = data.get("keypoints", [])
        
        if not keypoints:
            continue
            
        coco_data["images"].append({
            "id": image_id,
            "file_name": f"images/{new_img_name}",
            "width": int(width),
            "height": int(height)
        })
        
        valid_kps = [kp for kp in keypoints if kp.get("v", 0) > 0]
        if not valid_kps:
            image_id += 1
            continue
            
        xs = [kp["x"] for kp in valid_kps]
        ys = [kp["y"] for kp in valid_kps]
        
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        
        pad_x = (max_x - min_x) * 0.1
        pad_y = (max_y - min_y) * 0.1
        
        box_w = (max_x - min_x) + pad_x * 2
        box_h = (max_y - min_y) + pad_y * 2
        box_x_min = max(0.0, (min_x + max_x)/2 - box_w/2)
        box_y_min = max(0.0, (min_y + max_y)/2 - box_h/2)
        
        coco_kpts = []
        num_kpts = 0
        for kp in keypoints:
            v = int(kp.get("v", 0))
            x = float(kp.get("x", 0))
            y = float(kp.get("y", 0))
            coco_kpts.extend([x, y, v])
            if v > 0:
                num_kpts += 1
                
        coco_data["annotations"].append({
            "id": annot_id,
            "image_id": image_id,
            "category_id": 1,
            "bbox": [box_x_min, box_y_min, box_w, box_h],
            "keypoints": coco_kpts,
            "num_keypoints": num_kpts
        })
        annot_id += 1
        image_id += 1
        
    with open(os.path.join(export_dir, "annotations.json"), "w") as f:
        json.dump(coco_data, f, indent=2)
        
    zip_path = os.path.join(temp_dir, "ground_truth_training_dataset.zip")
    shutil.make_archive(zip_path.replace('.zip', ''), 'zip', export_dir)
    
    return FileResponse(
        zip_path, 
        media_type="application/zip", 
        filename="ground_truth_training_dataset.zip"
    )

@router.post("/export_evaluation_dataset/{job_id}")
def export_evaluation_dataset(job_id: str, payload: Dict = Body(...)):
    temp_dir = None
    if job_id in jobs:
        temp_dir = jobs[job_id].get("temp_dir")
    else:
        possible_dir = os.path.join("temp", job_id)
        if os.path.exists(possible_dir):
            temp_dir = possible_dir
            
    if not temp_dir or not os.path.exists(temp_dir):
        raise HTTPException(status_code=404, detail="Job/Temp directory not found")
        
    export_dir = os.path.join(temp_dir, "export_dataset")
    images_dir = os.path.join(export_dir, "images")
    labels_dir = os.path.join(export_dir, "labels")
    
    os.makedirs(images_dir, exist_ok=True)
    os.makedirs(labels_dir, exist_ok=True)
    
    for filename, data in payload.items():
        original_img_path = os.path.join(temp_dir, filename)
        if not os.path.exists(original_img_path):
            continue
            
        new_img_name = filename.replace('/', '_').replace('\\', '_')
        dest_img_path = os.path.join(images_dir, new_img_name)
        shutil.copy2(original_img_path, dest_img_path)
        
        width = float(data.get("width", 1))
        height = float(data.get("height", 1))
        keypoints = data.get("keypoints", [])
        
        if not keypoints:
            continue
            
        # Calc bounding box
        valid_kps = [kp for kp in keypoints if kp.get("v", 0) > 0]
        if not valid_kps:
            continue
            
        xs = [kp["x"] for kp in valid_kps]
        ys = [kp["y"] for kp in valid_kps]
        
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        
        # Add 10% padding
        pad_x = (max_x - min_x) * 0.1
        pad_y = (max_y - min_y) * 0.1
        
        box_x_center = (min_x + max_x) / 2
        box_y_center = (min_y + max_y) / 2
        box_w = (max_x - min_x) + pad_x * 2
        box_h = (max_y - min_y) + pad_y * 2
        
        # Normalize
        norm_x_center = box_x_center / width
        norm_y_center = box_y_center / height
        norm_w = box_w / width
        norm_h = box_h / height
        
        # Clamp
        norm_x_center = max(0, min(1, norm_x_center))
        norm_y_center = max(0, min(1, norm_y_center))
        norm_w = max(0, min(1, norm_w))
        norm_h = max(0, min(1, norm_h))
        
        label_parts = [0, norm_x_center, norm_y_center, norm_w, norm_h]
        
        for kp in keypoints:
            v = int(kp.get("v", 0))
            x = float(kp.get("x", 0))
            y = float(kp.get("y", 0))
            if v > 0:
                norm_kp_x = max(0, min(1, x / width))
                norm_kp_y = max(0, min(1, y / height))
                label_parts.extend([norm_kp_x, norm_kp_y, v])
            else:
                label_parts.extend([0.0, 0.0, 0])
                
        label_line = " ".join(f"{v:.6f}" if isinstance(v, float) else str(v) for v in label_parts)
        
        base_name = os.path.splitext(new_img_name)[0]
        label_path = os.path.join(labels_dir, f"{base_name}.txt")
        with open(label_path, "w") as f:
            f.write(label_line + "\n")
            
    # Zip export_dir
    zip_path = os.path.join(temp_dir, "ground_truth_dataset.zip")
    shutil.make_archive(zip_path.replace('.zip', ''), 'zip', export_dir)
    
    return FileResponse(
        zip_path, 
        media_type="application/zip", 
        filename="ground_truth_dataset.zip"
    )

@router.post("/re_detect_poses/{job_id}")
async def re_detect_poses(job_id: str, background_tasks: BackgroundTasks, payload: Dict = Body(...)):
    if job_id not in jobs:
        possible_dir = os.path.join("temp", job_id)
        if os.path.exists(possible_dir):
            jobs[job_id] = {
                "status": "processing",
                "progress": 0,
                "temp_dir": possible_dir,
                "type": "pose"
            }
        else:
            raise HTTPException(status_code=404, detail="Job directory not found")
            
    temp_dir = jobs[job_id]["temp_dir"]
    model_name = payload.get("model_name", "yolov8n-pose_1_det.pt")
    
    valid_exts = ('.jpg', '.jpeg', '.png')
    file_info_list = []
    
    for root, dirs, extracted_files in os.walk(temp_dir):
        dirs[:] = [d for d in dirs if d not in ('export_training', 'export_dataset', 'export_annotated', 'conversion_extract', 'conversion_output')]
        for f in extracted_files:
            if f.lower().endswith(valid_exts):
                v_path = os.path.join(root, f)
                rel_name = os.path.relpath(v_path, temp_dir).replace('\\', '/')
                file_info_list.append({
                    "filename": rel_name,
                    "path": v_path
                })
                
    if not file_info_list:
        raise HTTPException(status_code=400, detail="No images found in job directory to generate annotations.")
        
    jobs[job_id]["status"] = "processing"
    jobs[job_id]["progress"] = 0
    jobs[job_id]["error"] = None
    if "results" in jobs[job_id]:
        del jobs[job_id]["results"]
        
    background_tasks.add_task(process_poses_background, job_id, temp_dir, file_info_list, model_name)
    return {"status": "started", "job_id": job_id}

@router.post("/export_annotated_images/{job_id}")
def export_annotated_images(job_id: str, payload: Dict = Body(...)):
    temp_dir = None
    if job_id in jobs:
        temp_dir = jobs[job_id].get("temp_dir")
    else:
        possible_dir = os.path.join("temp", job_id)
        if os.path.exists(possible_dir):
            temp_dir = possible_dir
            
    if not temp_dir or not os.path.exists(temp_dir):
        raise HTTPException(status_code=404, detail="Job/Temp directory not found")
        
    from PIL import Image, ImageDraw
    
    export_dir = os.path.join(temp_dir, "export_annotated")
    shutil.rmtree(export_dir, ignore_errors=True)
    os.makedirs(export_dir, exist_ok=True)
    
    for filename, data in payload.items():
        original_img_path = os.path.join(temp_dir, filename)
        if not os.path.exists(original_img_path):
            continue
            
        with Image.open(original_img_path) as img:
            img = img.convert("RGB")
            draw = ImageDraw.Draw(img)
            
            width = float(data.get("width", img.width))
            height = float(data.get("height", img.height))
            keypoints = data.get("keypoints", [])
            
            scale_x = img.width / width
            scale_y = img.height / height
            
            point_radius = 6
            for i, kp in enumerate(keypoints):
                v = int(kp.get("v", 0))
                if v == 0:
                    continue
                    
                x = float(kp.get("x", 0)) * scale_x
                y = float(kp.get("y", 0)) * scale_y
                
                # Visible = green (0, 255, 0), Occluded = orange (245, 158, 11)
                color = (0, 255, 0) if v == 2 else (245, 158, 11)
                
                draw.ellipse(
                    [x - point_radius, y - point_radius, x + point_radius, y + point_radius], 
                    fill=color, 
                    outline=(0, 0, 0), 
                    width=2
                )
                
                draw.text((x + 8, y - 6), str(i), fill=(255, 255, 255))
                
            new_img_name = filename.replace('/', '_').replace('\\', '_')
            dest_img_path = os.path.join(export_dir, new_img_name)
            img.save(dest_img_path)
            
    zip_path = os.path.join(temp_dir, "annotated_images.zip")
    shutil.make_archive(zip_path.replace('.zip', ''), 'zip', export_dir)
    
    return FileResponse(
        zip_path, 
        media_type="application/zip", 
        filename="annotated_images.zip"
    )
