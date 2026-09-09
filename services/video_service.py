import os
import cv2
import zipfile
from core.job_manager import jobs

def calculate_frame_step(fps: float, fps_option: int) -> int:
    """
    Determines the frame jump step based on video FPS and target FPS option.
    Matches the user's exact specification:
      1fps -> 30 jump
      2fps -> 15 jump
      3fps -> 10 jump
      4fps -> 8 jump
    """
    step_map = {
        1: 30,
        2: 15,
        3: 10,
        4: 8
    }
    fps_val = int(fps_option) if fps_option else 1
    if 24 <= fps <= 32 and fps_val in step_map:
        return step_map[fps_val]
    return max(1, round(fps / max(1, fps_val)))


def process_video_background(job_id: str, temp_dir: str, file_info_list: list, limits_list: list, fps_option: int = 1):
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
            
            frame_step = calculate_frame_step(fps, fps_option)
            
            frame_count = 0
            saved_count = 0
            
            while cap.isOpened():
                ret, frame = cap.read()
                if not ret:
                    break
                    
                if saved_count >= limit:
                    break
                    
                if frame_count % frame_step == 0:
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
