import os
import json
import shutil
import uuid
import threading
from core.job_manager import jobs

try:
    from ultralytics import YOLO
except ImportError:
    YOLO = None

def convert_coco_to_yolo(coco_json_path: str, images_dir: str, output_dir: str):
    with open(coco_json_path, 'r') as f:
        coco_data = json.load(f)
        
    os.makedirs(os.path.join(output_dir, 'images', 'train'), exist_ok=True)
    os.makedirs(os.path.join(output_dir, 'labels', 'train'), exist_ok=True)
    
    # We will just put everything in train for fine-tuning a small set
    
    images_map = {img['id']: img for img in coco_data['images']}
    
    for ann in coco_data['annotations']:
        img_id = ann['image_id']
        img_info = images_map.get(img_id)
        if not img_info: continue
        
        img_filename = img_info['file_name']
        img_width = img_info['width']
        img_height = img_info['height']
        
        kpts = ann['keypoints']
        
        # Calculate bounding box from keypoints
        x_coords = [kpts[i] for i in range(0, len(kpts), 3) if kpts[i] > 0]
        y_coords = [kpts[i+1] for i in range(0, len(kpts), 3) if kpts[i+1] > 0]
        
        if not x_coords or not y_coords: continue
        
        min_x = min(x_coords)
        max_x = max(x_coords)
        min_y = min(y_coords)
        max_y = max(y_coords)
        
        # Give some padding to the box
        pad_x = (max_x - min_x) * 0.1
        pad_y = (max_y - min_y) * 0.1
        min_x = max(0, min_x - pad_x)
        max_x = min(img_width, max_x + pad_x)
        min_y = max(0, min_y - pad_y)
        max_y = min(img_height, max_y + pad_y)
        
        box_w = max_x - min_x
        box_h = max_y - min_y
        box_cx = min_x + box_w / 2
        box_cy = min_y + box_h / 2
        
        # Normalize
        norm_cx = box_cx / img_width
        norm_cy = box_cy / img_height
        norm_w = box_w / img_width
        norm_h = box_h / img_height
        
        # Normalize keypoints
        norm_kpts = []
        for i in range(0, len(kpts), 3):
            nx = kpts[i] / img_width if kpts[i] > 0 else 0
            ny = kpts[i+1] / img_height if kpts[i+1] > 0 else 0
            # Ultralytics v is usually 0=unlabeled, 1=labeled but not visible, 2=visible
            # In our UI we just set it to 1.0. We will map to 2.
            nv = 2 if kpts[i+2] > 0 else 0
            norm_kpts.extend([nx, ny, nv])
            
        # Write to txt
        txt_filename = os.path.splitext(img_filename)[0] + '.txt'
        txt_path = os.path.join(output_dir, 'labels', 'train', txt_filename)
        
        line = f"0 {norm_cx} {norm_cy} {norm_w} {norm_h} " + " ".join([str(k) for k in norm_kpts])
        with open(txt_path, 'a') as tf:
            tf.write(line + "\n")
            
    # Copy images to output_dir
    for img_filename in os.listdir(images_dir):
        if img_filename.lower().endswith(('.jpg', '.jpeg', '.png')):
            shutil.copy(os.path.join(images_dir, img_filename), os.path.join(output_dir, 'images', 'train', img_filename))
            
    # Create dataset.yaml
    yaml_content = f"""path: {os.path.abspath(output_dir)}
train: images/train
val: images/train
nc: 1
names: ['person']
kpt_shape: [17, 3]
"""
    yaml_path = os.path.join(output_dir, 'dataset.yaml')
    with open(yaml_path, 'w') as yf:
        yf.write(yaml_content)
        
    return yaml_path

def run_training_job(job_id: str, temp_dir: str, json_path: str, images_dir: str, base_model: str, epochs: int, new_model_name: str):
    def _train():
        try:
            jobs[job_id]["status_msg"] = "Converting dataset format..."
            jobs[job_id]["progress"] = 10
            
            yolo_dataset_dir = os.path.join(temp_dir, 'yolo_dataset')
            yaml_path = convert_coco_to_yolo(json_path, images_dir, yolo_dataset_dir)
            
            jobs[job_id]["status_msg"] = "Initializing Model..."
            jobs[job_id]["progress"] = 20
            
            model_path = os.path.join("models", base_model)
            if not os.path.exists(model_path):
                raise FileNotFoundError(f"Base model {base_model} not found.")
                
            model = YOLO(model_path)
            
            jobs[job_id]["status_msg"] = f"Training for {epochs} epochs..."
            jobs[job_id]["progress"] = 30
            
            import torch
            device = '0' if torch.cuda.is_available() else 'cpu'
            
            # Run training
            results = model.train(data=yaml_path, epochs=epochs, imgsz=640, device=device, project=os.path.join(temp_dir, 'runs'), name='train')
            
            jobs[job_id]["status_msg"] = "Saving new model..."
            jobs[job_id]["progress"] = 90
            
            # Find the best weights
            best_weights = os.path.join(temp_dir, 'runs', 'train', 'weights', 'best.pt')
            if not os.path.exists(best_weights):
                best_weights = os.path.join(temp_dir, 'runs', 'train', 'weights', 'last.pt')
                
            if not os.path.exists(best_weights):
                raise Exception("Training finished but weights were not saved.")
                
            new_model_path = os.path.join("models", new_model_name)
            if not new_model_path.endswith('.pt'):
                new_model_path += '.pt'
                
            shutil.copy(best_weights, new_model_path)
            
            jobs[job_id]["status"] = "completed"
            jobs[job_id]["progress"] = 100
            jobs[job_id]["status_msg"] = "Complete"
            jobs[job_id]["model_path"] = new_model_name
            
        except Exception as e:
            jobs[job_id]["status"] = "error"
            jobs[job_id]["error"] = str(e)
            
    thread = threading.Thread(target=_train)
    thread.start()
