import os
import cv2
import zipfile
from core.job_manager import jobs

def process_video_background(job_id: str, temp_dir: str, file_info_list: list, limits_list: list):
    try:
        frames_dir = os.path.join(temp_dir, "frames")
        os.makedirs(frames_dir, exist_ok=True)
        
        total_limit = sum(limits_list)
        frames_extracted = 0
        
        for idx, file_info in enumerate(file_info_list):
            limit = limits_list[idx]
            orig_filename = file_info["filename"]
            video_path = file_info["path"]
            video_name = os.path.splitext(orig_filename)[0]
            
            cap = cv2.VideoCapture(video_path)
            fps = cap.get(cv2.CAP_PROP_FPS)
            
            if fps <= 0 or fps != fps:
                fps = 30
            fps = max(1, int(fps))
            
            frame_count = 0
            saved_count = 0
            
            while cap.isOpened():
                ret, frame = cap.read()
                if not ret:
                    break
                    
                if saved_count >= limit:
                    break
                    
                if frame_count % fps == 0:
                    frame_filename = os.path.join(frames_dir, f"{video_name}_frame_{saved_count:02d}.jpg")
                    cv2.imwrite(frame_filename, frame)
                    saved_count += 1
                    frames_extracted += 1
                    
                    if total_limit > 0:
                        jobs[job_id]["progress"] = min(99, int((frames_extracted / total_limit) * 100))
                    
                frame_count += 1
                
            cap.release()
            
        zip_filename = os.path.join(temp_dir, "all_frames.zip")
        with zipfile.ZipFile(zip_filename, 'w') as zipf:
            for root, _, extracted_files in os.walk(frames_dir):
                for f in extracted_files:
                    zipf.write(os.path.join(root, f), f)
                    
        jobs[job_id]["status"] = "completed"
        jobs[job_id]["progress"] = 100
        jobs[job_id]["result_path"] = zip_filename
        
    except Exception as e:
        jobs[job_id]["status"] = "error"
        jobs[job_id]["error"] = str(e)
