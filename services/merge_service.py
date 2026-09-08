import os
import json
import shutil
import zipfile
import datetime
from typing import Dict, List, Tuple
from core.job_manager import jobs

COCO_KEYPOINT_NAMES = [
    "Nose", "Left Eye", "Right Eye", "Left Ear", "Right Ear",
    "Left Shoulder", "Right Shoulder", "Left Elbow", "Right Elbow",
    "Left Wrist", "Right Wrist", "Left Hip", "Right Hip",
    "Left Knee", "Right Knee", "Left Ankle", "Right Ankle"
]

def find_dataset_components(dataset_root: str) -> Tuple[str, str]:
    """
    Finds the COCO JSON file and the directory containing image files.
    Searches recursively in case the dataset has nested subdirectories.
    """
    json_path = None
    images_dir = None
    valid_exts = ('.jpg', '.jpeg', '.png', '.bmp', '.webp')

    # 1. Search for any .json file
    for root, dirs, files in os.walk(dataset_root):
        for f in files:
            if f.lower().endswith('.json'):
                # Prioritize annotations.json if present
                if f.lower() == 'annotations.json':
                    json_path = os.path.join(root, f)
                    break
                elif json_path is None:
                    json_path = os.path.join(root, f)
        if json_path and os.path.basename(json_path).lower() == 'annotations.json':
            break

    if not json_path:
        raise ValueError("Could not find a COCO annotations JSON (.json) file in dataset.")

    # 2. Search for images directory
    for root, dirs, files in os.walk(dataset_root):
        if "images" in dirs:
            images_dir = os.path.join(root, "images")
            break

    # If no folder named 'images' exists, look for folder containing image files
    if not images_dir:
        for root, dirs, files in os.walk(dataset_root):
            img_count = sum(1 for f in files if f.lower().endswith(valid_exts))
            if img_count > 0:
                images_dir = root
                break

    if not images_dir:
        raise ValueError("Could not find any image files (.jpg, .png, etc.) in dataset.")

    return json_path, images_dir

def merge_coco_datasets(base_root: str, new_root: str, output_dir: str) -> Dict:
    """
    Merges Base Dataset and New Batch Dataset into a single unified COCO dataset.
    Prevents image ID and annotation ID collisions and handles duplicate filenames safely.
    """
    base_json_path, base_images_dir = find_dataset_components(base_root)
    new_json_path, new_images_dir = find_dataset_components(new_root)

    with open(base_json_path, 'r', encoding='utf-8') as f:
        base_coco = json.load(f)

    with open(new_json_path, 'r', encoding='utf-8') as f:
        new_coco = json.load(f)

    out_images_dir = os.path.join(output_dir, "images")
    os.makedirs(out_images_dir, exist_ok=True)

    merged_images = []
    merged_annotations = []
    
    # Categories: prioritize base categories or fallback to standard person pose
    merged_categories = base_coco.get("categories", [])
    if not merged_categories:
        merged_categories = new_coco.get("categories", [{
            "id": 1,
            "name": "person",
            "supercategory": "person",
            "keypoints": COCO_KEYPOINT_NAMES
        }])

    used_filenames = set()
    next_image_id = 1
    next_annot_id = 1

    # -------------------------------------------------------------
    # 1. Process Base Dataset
    # -------------------------------------------------------------
    base_id_map = {} # old_base_id -> new_unified_id
    base_images = base_coco.get("images", [])
    
    for img in base_images:
        old_id = img["id"]
        raw_name = img.get("file_name", "")
        # Strip any "images/" or path prefix
        base_filename = os.path.basename(raw_name)
        
        # Locate physical image file
        src_path = os.path.join(base_images_dir, base_filename)
        if not os.path.exists(src_path):
            # Try searching inside base_images_dir recursively
            found = False
            for r, _, fs in os.walk(base_images_dir):
                if base_filename in fs:
                    src_path = os.path.join(r, base_filename)
                    found = True
                    break
            if not found:
                continue

        dest_filename = base_filename
        dest_path = os.path.join(out_images_dir, dest_filename)
        shutil.copy2(src_path, dest_path)
        used_filenames.add(dest_filename.lower())

        unified_img_id = next_image_id
        next_image_id += 1
        base_id_map[old_id] = unified_img_id

        merged_images.append({
            "id": unified_img_id,
            "file_name": f"images/{dest_filename}",
            "width": int(img.get("width", 1)),
            "height": int(img.get("height", 1))
        })

    # Base Annotations
    for ann in base_coco.get("annotations", []):
        old_img_id = ann.get("image_id")
        if old_img_id not in base_id_map:
            continue

        ann_copy = dict(ann)
        ann_copy["id"] = next_annot_id
        ann_copy["image_id"] = base_id_map[old_img_id]
        next_annot_id += 1
        merged_annotations.append(ann_copy)

    # -------------------------------------------------------------
    # 2. Process New Batch Dataset
    # -------------------------------------------------------------
    new_id_map = {} # old_new_id -> new_unified_id
    new_images = new_coco.get("images", [])

    for img in new_images:
        old_id = img["id"]
        raw_name = img.get("file_name", "")
        base_filename = os.path.basename(raw_name)

        src_path = os.path.join(new_images_dir, base_filename)
        if not os.path.exists(src_path):
            found = False
            for r, _, fs in os.walk(new_images_dir):
                if base_filename in fs:
                    src_path = os.path.join(r, base_filename)
                    found = True
                    break
            if not found:
                continue

        # Handle filename collisions
        dest_filename = base_filename
        if dest_filename.lower() in used_filenames:
            stem, ext = os.path.splitext(base_filename)
            counter = 2
            while f"{stem}_batch2_{counter}{ext}".lower() in used_filenames:
                counter += 1
            dest_filename = f"{stem}_batch2_{counter}{ext}"

        dest_path = os.path.join(out_images_dir, dest_filename)
        shutil.copy2(src_path, dest_path)
        used_filenames.add(dest_filename.lower())

        unified_img_id = next_image_id
        next_image_id += 1
        new_id_map[old_id] = unified_img_id

        merged_images.append({
            "id": unified_img_id,
            "file_name": f"images/{dest_filename}",
            "width": int(img.get("width", 1)),
            "height": int(img.get("height", 1))
        })

    # New Batch Annotations
    for ann in new_coco.get("annotations", []):
        old_img_id = ann.get("image_id")
        if old_img_id not in new_id_map:
            continue

        ann_copy = dict(ann)
        ann_copy["id"] = next_annot_id
        ann_copy["image_id"] = new_id_map[old_img_id]
        next_annot_id += 1
        merged_annotations.append(ann_copy)

    # -------------------------------------------------------------
    # 3. Write Merged annotations.json
    # -------------------------------------------------------------
    merged_data = {
        "info": {
            "description": "Merged Dataset created via JSON Merge Tool",
            "date_created": datetime.datetime.now().isoformat()
        },
        "images": merged_images,
        "annotations": merged_annotations,
        "categories": merged_categories
    }

    out_json_path = os.path.join(output_dir, "annotations.json")
    with open(out_json_path, 'w', encoding='utf-8') as f:
        json.dump(merged_data, f, indent=2)

    # -------------------------------------------------------------
    # 4. Create ZIP archive (placed outside output_dir so it doesn't self-archive)
    # -------------------------------------------------------------
    parent_dir = os.path.dirname(os.path.abspath(output_dir))
    zip_base = os.path.join(parent_dir, "merged_dataset")
    zip_path = zip_base + ".zip"
    if os.path.exists(zip_path):
        os.remove(zip_path)
    shutil.make_archive(zip_base, 'zip', output_dir)

    stats = {
        "base_images": len(base_id_map),
        "base_annotations": len([a for a in merged_annotations if a["image_id"] in base_id_map.values()]),
        "new_images": len(new_id_map),
        "new_annotations": len([a for a in merged_annotations if a["image_id"] in new_id_map.values()]),
        "total_images": len(merged_images),
        "total_annotations": len(merged_annotations),
        "zip_path": zip_path,
        "zip_size_bytes": os.path.getsize(zip_path)
    }

    return stats

def run_merge_job(job_id: str, temp_dir: str, base_dir: str, new_dir: str):
    """Background task executor for merging datasets."""
    try:
        jobs[job_id]["status_msg"] = "Extracting & scanning datasets..."
        jobs[job_id]["progress"] = 25

        # Check if directories contain zip files and unpack if necessary
        for d in [base_dir, new_dir]:
            for item in os.listdir(d):
                if item.lower().endswith('.zip'):
                    zip_full = os.path.join(d, item)
                    extract_target = os.path.join(d, "unpacked")
                    os.makedirs(extract_target, exist_ok=True)
                    with zipfile.ZipFile(zip_full, 'r') as zf:
                        zf.extractall(extract_target)

        jobs[job_id]["status_msg"] = "Merging COCO annotations & images..."
        jobs[job_id]["progress"] = 55

        merged_output_dir = os.path.join(temp_dir, "merged_dataset")
        os.makedirs(merged_output_dir, exist_ok=True)

        stats = merge_coco_datasets(base_dir, new_dir, merged_output_dir)

        jobs[job_id]["status_msg"] = "Packaging merged dataset ZIP..."
        jobs[job_id]["progress"] = 90
        
        jobs[job_id]["status"] = "completed"
        jobs[job_id]["progress"] = 100
        jobs[job_id]["results"] = stats
        jobs[job_id]["status_msg"] = "Merged dataset ready for download!"
    except Exception as e:
        jobs[job_id]["status"] = "error"
        jobs[job_id]["error"] = str(e)
        jobs[job_id]["status_msg"] = f"Error: {str(e)}"
