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

def convert_yolo_to_coco(dataset_dir: str):
    from PIL import Image
    import yaml
    
    yaml_path = os.path.join(dataset_dir, 'data.yaml')
    with open(yaml_path, 'r') as f:
        dataset_yaml = yaml.safe_load(f)
        
    # Get train and val splits paths from yaml
    splits = {}
    if 'train' in dataset_yaml:
        splits['train'] = dataset_yaml['train']
    if 'val' in dataset_yaml:
        splits['val'] = dataset_yaml['val']
        
    COCO_KEYPOINT_NAMES = [
        "Nose", "Left Eye", "Right Eye", "Left Ear", "Right Ear",
        "Left Shoulder", "Right Shoulder", "Left Elbow", "Right Elbow",
        "Left Wrist", "Right Wrist", "Left Hip", "Right Hip",
        "Left Knee", "Right Knee", "Left Ankle", "Right Ankle"
    ]
    
    for split_name, rel_img_dir in splits.items():
        img_split_dir = os.path.join(dataset_dir, rel_img_dir)
        if not os.path.exists(img_split_dir):
            continue
            
        # Path to labels split
        rel_label_dir = rel_img_dir.replace('images', 'labels')
        label_split_dir = os.path.join(dataset_dir, rel_label_dir)
        
        coco_data = {
            "info": { "description": f"Auto-converted from YOLO {split_name} split" },
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
        
        if os.path.exists(img_split_dir):
            for img_name in os.listdir(img_split_dir):
                if not img_name.lower().endswith(('.jpg', '.jpeg', '.png')):
                    continue
                    
                img_path = os.path.join(img_split_dir, img_name)
                try:
                    with Image.open(img_path) as img:
                        width, height = img.size
                except Exception as e:
                    print(f"Error reading image dimensions for {img_name}: {e}")
                    width, height = 0, 0
                    
                coco_data["images"].append({
                    "id": image_id,
                    "file_name": os.path.join(rel_img_dir, img_name).replace('\\', '/'),
                    "width": width,
                    "height": height
                })
                
                # Check for label file
                base_name = os.path.splitext(img_name)[0]
                label_path = os.path.join(label_split_dir, f"{base_name}.txt")
                
                if os.path.exists(label_path):
                    with open(label_path, 'r') as lf:
                        lines = lf.readlines()
                        
                    for line in lines:
                        parts = line.strip().split()
                        if not parts:
                            continue
                            
                        # Format: class cx cy w h kp_x1 kp_y1 kp_v1 ...
                        if len(parts) >= 5:
                            norm_cx = float(parts[1])
                            norm_cy = float(parts[2])
                            norm_w = float(parts[3])
                            norm_h = float(parts[4])
                            
                            # Convert bbox to absolute coordinates (x_min, y_min, w, h)
                            box_w = norm_w * width
                            box_h = norm_h * height
                            box_cx = norm_cx * width
                            box_cy = norm_cy * height
                            x_min = box_cx - box_w / 2
                            y_min = box_cy - box_h / 2
                            
                            # Keypoints
                            kpts = []
                            num_kpts = 0
                            kpts_parts = parts[5:]
                            for idx in range(0, len(kpts_parts), 3):
                                if idx + 2 < len(kpts_parts):
                                    kx = float(kpts_parts[idx]) * width
                                    ky = float(kpts_parts[idx+1]) * height
                                    kv = int(kpts_parts[idx+2])
                                    kpts.extend([kx, ky, kv])
                                    if kv > 0:
                                        num_kpts += 1
                                        
                            coco_data["annotations"].append({
                                "id": annot_id,
                                "image_id": image_id,
                                "category_id": 1,
                                "bbox": [x_min, y_min, box_w, box_h],
                                "keypoints": kpts,
                                "num_keypoints": num_kpts
                            })
                            annot_id += 1
                            
                image_id += 1
                
        coco_json_path = os.path.join(dataset_dir, f"{split_name}_coco.json")
        with open(coco_json_path, 'w') as jf:
            json.dump(coco_data, jf, indent=2)
        print(f"Generated COCO JSON for {split_name} split at {coco_json_path}")

def convert_coco_to_yolo(coco_json_path: str, images_dir: str, output_dir: str) -> str:
    import json
    import yaml
    import shutil
    
    # Create directory structure
    os.makedirs(os.path.join(output_dir, "images", "train"), exist_ok=True)
    os.makedirs(os.path.join(output_dir, "images", "val"), exist_ok=True)
    os.makedirs(os.path.join(output_dir, "labels", "train"), exist_ok=True)
    os.makedirs(os.path.join(output_dir, "labels", "val"), exist_ok=True)
    
    with open(coco_json_path, 'r') as f:
        coco_data = json.load(f)
        
    # Map image ID to metadata
    images_map = {img['id']: img for img in coco_data.get('images', [])}
    
    # Group annotations by image ID
    annotations_by_image = {}
    for ann in coco_data.get('annotations', []):
        img_id = ann['image_id']
        annotations_by_image.setdefault(img_id, []).append(ann)
        
    # Process each image
    for img_id, img_info in images_map.items():
        file_name = img_info['file_name']
        img_w = float(img_info['width'])
        img_h = float(img_info['height'])
        
        # Check source image path
        base_name = os.path.basename(file_name)
        src_path = os.path.join(images_dir, base_name)
        if not os.path.exists(src_path):
            found = False
            for root, dirs, files in os.walk(images_dir):
                if base_name in files:
                    src_path = os.path.join(root, base_name)
                    found = True
                    break
            if not found:
                src_path = os.path.join(images_dir, file_name)
                if not os.path.exists(src_path):
                    print(f"Warning: Image file {file_name} not found in {images_dir}. Skipping.")
                    continue
                    
        # Copy image to yolo structure
        dest_img_path = os.path.join(output_dir, "images", "train", base_name)
        shutil.copy2(src_path, dest_img_path)
        
        # Parse annotations for this image
        anns = annotations_by_image.get(img_id, [])
        yolo_lines = []
        
        for ann in anns:
            bbox = ann.get('bbox', [])
            keypoints = ann.get('keypoints', [])
            
            if len(bbox) < 4:
                continue
                
            # Normalize bounding box
            x_min, y_min, w, h = bbox
            x_center = (x_min + w / 2.0) / img_w
            y_center = (y_min + h / 2.0) / img_h
            w_norm = w / img_w
            h_norm = h / img_h
            
            x_center = max(0.0, min(1.0, x_center))
            y_center = max(0.0, min(1.0, y_center))
            w_norm = max(0.0, min(1.0, w_norm))
            h_norm = max(0.0, min(1.0, h_norm))
            
            class_id = 0
            line_parts = [class_id, x_center, y_center, w_norm, h_norm]
            
            # Keypoints
            if keypoints:
                for i in range(0, len(keypoints), 3):
                    if i + 2 < len(keypoints):
                        kp_x = float(keypoints[i])
                        kp_y = float(keypoints[i+1])
                        kp_v = int(keypoints[i+2])
                        if kp_v > 0:
                            kp_x_norm = max(0.0, min(1.0, kp_x / img_w))
                            kp_y_norm = max(0.0, min(1.0, kp_y / img_h))
                            line_parts.extend([kp_x_norm, kp_y_norm, kp_v])
                        else:
                            line_parts.extend([0.0, 0.0, 0])
            
            yolo_line = " ".join(f"{val:.6f}" if isinstance(val, float) else str(val) for val in line_parts)
            yolo_lines.append(yolo_line)
            
        # Write to txt file
        txt_name = os.path.splitext(base_name)[0] + ".txt"
        label_path = os.path.join(output_dir, "labels", "train", txt_name)
        with open(label_path, 'w') as lf:
            lf.write("\n".join(yolo_lines) + "\n")
            
    # Write data.yaml
    yaml_data = {
        'path': os.path.abspath(output_dir),
        'train': 'images/train',
        'val': 'images/train',
        'nc': 1,
        'names': {0: 'person'},
        'kpt_shape': [17, 3]
    }
    
    yaml_path = os.path.join(output_dir, 'data.yaml')
    with open(yaml_path, 'w') as yf:
        yaml.dump(yaml_data, yf)
        
    return yaml_path

def run_training_job(job_id: str, temp_dir: str, json_path: str, images_dir: str, base_model: str, epochs: int, lr0: float, pose: float, use_optuna: bool, new_model_name: str):
    def _train():
        try:
            jobs[job_id]["status_msg"] = "Preparing dataset & converting COCO JSON to YOLO format..."
            jobs[job_id]["progress"] = 10
            
            # Generate the YOLO dataset directory and yaml file
            yolo_dataset_dir = os.path.join(temp_dir, 'yolo_dataset')
            yaml_path = convert_coco_to_yolo(json_path, images_dir, yolo_dataset_dir)
            
            # Update data.yaml path with absolute path
            import yaml
            with open(yaml_path, 'r') as f:
                dataset_yaml = yaml.safe_load(f)
                
            dataset_yaml['path'] = os.path.abspath(yolo_dataset_dir)
            with open(yaml_path, 'w') as f:
                yaml.dump(dataset_yaml, f)
                
            jobs[job_id]["status_msg"] = "Initializing Model..."
            jobs[job_id]["progress"] = 20
            
            model_path = os.path.join("models", base_model)
            if not os.path.exists(model_path):
                raise FileNotFoundError(f"Base model {base_model} not found.")
                
            import torch
            device = '0' if torch.cuda.is_available() else 'cpu'
            
            if use_optuna:
                import optuna
                jobs[job_id]["status_msg"] = "Running Optuna tuning..."
                jobs[job_id]["progress"] = 30
                
                def objective(trial):
                    trial_epochs = trial.suggest_categorical("epochs", [20, 30, 50])
                    trial_lr0 = trial.suggest_categorical("lr0", [0.01, 0.001, 0.0001])
                    trial_pose = trial.suggest_categorical("pose", [12.0, 6.0, 24.0])
                    
                    trial_dir = os.path.join(temp_dir, f"trial_{trial.number}")
                    os.makedirs(trial_dir, exist_ok=True)
                    project_dir = os.path.abspath(os.path.join(trial_dir, 'runs'))
                    
                    jobs[job_id]["status_msg"] = f"Optuna Trial {trial.number+1}/3: epochs={trial_epochs}, lr0={trial_lr0}, pose={trial_pose}..."
                    
                    trial_model = YOLO(model_path)
                    results = trial_model.train(
                        data=yaml_path,
                        epochs=trial_epochs,
                        lr0=trial_lr0,
                        pose=trial_pose,
                        imgsz=640,
                        device=device,
                        project=project_dir,
                        name='train',
                        plots=False,
                        save=False,
                        verbose=False
                    )
                    
                    map_val = 0.0
                    if hasattr(results, 'pose') and hasattr(results.pose, 'map'):
                        map_val = results.pose.map
                    elif hasattr(results, 'results_dict') and 'metrics/mAP50-95(B)' in results.results_dict:
                        map_val = results.results_dict.get('metrics/mAP50-95(B)', 0.0)
                    return map_val

                study = optuna.create_study(direction="maximize")
                study.optimize(objective, n_trials=3)
                
                best_params = study.best_params
                best_value = study.best_value
                print(f"Optuna complete! Best parameters: {best_params}, best mAP: {best_value}")
                
                final_epochs = best_params["epochs"]
                final_lr0 = best_params["lr0"]
                final_pose = best_params["pose"]
            else:
                final_epochs = epochs
                final_lr0 = lr0
                final_pose = pose

            jobs[job_id]["status_msg"] = f"Training final model (epochs={final_epochs}, lr0={final_lr0}, pose={final_pose})..."
            jobs[job_id]["progress"] = 50
            
            final_model = YOLO(model_path)
            project_abs_path = os.path.abspath(os.path.join(temp_dir, 'runs'))
            results = final_model.train(
                data=yaml_path,
                epochs=final_epochs,
                lr0=final_lr0,
                pose=final_pose,
                imgsz=640,
                device=device,
                project=project_abs_path,
                name='train'
            )
            
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
