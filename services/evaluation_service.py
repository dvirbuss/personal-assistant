import os
import cv2
import base64
import yaml
import glob
import numpy as np

try:
    from ultralytics import YOLO
except ImportError:
    YOLO = None

def evaluate_models(model_a_name: str, model_b_name: str, dataset_dir: str):
    if YOLO is None:
        raise Exception("Ultralytics YOLO is not installed.")
        
    model_a_path = os.path.join("models", model_a_name)
    model_b_path = os.path.join("models", model_b_name)
    
    if not os.path.exists(model_a_path):
        raise FileNotFoundError(f"Model A {model_a_name} not found.")
    if not os.path.exists(model_b_path):
        raise FileNotFoundError(f"Model B {model_b_name} not found.")
        
    # Find images dir inside dataset_dir
    images_dir = os.path.join(dataset_dir, "images")
    if not os.path.exists(images_dir):
        # Maybe it's extracted as a root folder
        for root, dirs, files in os.walk(dataset_dir):
            if "images" in dirs:
                images_dir = os.path.join(root, "images")
                dataset_dir = root
                break
                
    if not os.path.exists(images_dir):
        raise Exception("Could not find 'images' directory in the uploaded ZIP.")
        
    # Create dataset.yaml
    yaml_path = os.path.join(dataset_dir, "dataset.yaml")
    # For validation, YOLO needs `val: images/`
    dataset_yaml = {
        'path': os.path.abspath(dataset_dir),
        'train': 'images',
        'val': 'images',
        'names': {0: 'person'},
        'kpt_shape': [17, 3]
    }
    
    with open(yaml_path, 'w') as f:
        yaml.dump(dataset_yaml, f)
        
    import torch
    device = '0' if torch.cuda.is_available() else 'cpu'
    
    model_a = YOLO(model_a_path)
    model_b = YOLO(model_b_path)
    
    # 1. Run Validation to get mAP
    try:
        val_res_a = model_a.val(data=yaml_path, device=device, split='val')
        map_a = val_res_a.pose.map if hasattr(val_res_a, 'pose') else getattr(val_res_a.box, 'map', 0)
    except Exception as e:
        print(f"Error validating A: {e}")
        map_a = 0.0
        
    try:
        val_res_b = model_b.val(data=yaml_path, device=device, split='val')
        map_b = val_res_b.pose.map if hasattr(val_res_b, 'pose') else getattr(val_res_b.box, 'map', 0)
    except Exception as e:
        print(f"Error validating B: {e}")
        map_b = 0.0

    # 2. Generate side-by-side predictions for the gallery
    base64_results = []
    
    image_files = [f for f in os.listdir(images_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
    image_files = image_files[:20] # Limit to 20 to avoid crashing the browser
    
    for img_name in image_files:
        img_path = os.path.join(images_dir, img_name)
        try:
            res_a = model_a.predict(img_path, device=device, verbose=False)
            res_b = model_b.predict(img_path, device=device, verbose=False)
            
            if len(res_a) > 0 and len(res_b) > 0:
                ann_a = res_a[0].plot()
                ann_b = res_b[0].plot()
                
                _, buf_a = cv2.imencode('.jpg', ann_a)
                img_a_b64 = base64.b64encode(buf_a).decode('utf-8')
                
                _, buf_b = cv2.imencode('.jpg', ann_b)
                img_b_b64 = base64.b64encode(buf_b).decode('utf-8')
                
                base64_results.append({
                    "a": img_a_b64,
                    "b": img_b_b64
                })
        except Exception as e:
            print(f"Error generating pred images: {e}")
            
    return {
        "map_a": float(map_a),
        "map_b": float(map_b),
        "images": base64_results
    }
