import os
from core.job_manager import jobs

try:
    from ultralytics import YOLO
except ImportError:
    YOLO = None

# Cache for loaded models to prevent reloading every time
loaded_models = {}

def get_model(model_name: str):
    if YOLO is None:
        return None
    if model_name not in loaded_models:
        model_path = os.path.join("models", model_name)
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"Model {model_name} not found in models/ directory.")
        loaded_models[model_name] = YOLO(model_path)
    return loaded_models[model_name]

def process_poses_background(job_id: str, temp_dir: str, file_info_list: list, model_name: str):
    try:
        results_data = []
        total = len(file_info_list)
        
        try:
            model_pose = get_model(model_name)
        except Exception as e:
            raise Exception(f"Failed to load model: {str(e)}")
        
        for idx, file_info in enumerate(file_info_list):
            image_path = file_info["path"]
            filename = file_info["filename"]
            
            if model_pose is not None:
                try:
                    import torch
                    device = '0' if torch.cuda.is_available() else 'cpu'
                except ImportError:
                    device = 'cpu'
                    
                kwargs = {"verbose": False, "device": device}
                if "1_det" in model_name:
                    kwargs["max_det"] = 1
                results = model_pose(image_path, **kwargs)
                keypoints_data = []
                if len(results) > 0 and results[0].keypoints is not None:
                    kpts = results[0].keypoints.data[0].cpu().numpy()
                    if len(kpts) > 0:
                        for kp in kpts:
                            keypoints_data.append({
                                "x": float(kp[0]),
                                "y": float(kp[1]),
                                "v": float(kp[2]) if len(kp) > 2 else 1.0
                            })
            else:
                keypoints_data = [] # fallback if ultralytics not installed
                
            results_data.append({
                "filename": filename,
                "keypoints": keypoints_data
            })
            
            jobs[job_id]["progress"] = int(((idx + 1) / total) * 100)
            
        jobs[job_id]["status"] = "completed"
        jobs[job_id]["progress"] = 100
        jobs[job_id]["results"] = results_data
        
    except Exception as e:
        jobs[job_id]["status"] = "error"
        jobs[job_id]["error"] = str(e)
