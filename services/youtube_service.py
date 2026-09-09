import os
import yt_dlp
from yt_dlp.utils import download_range_func

from core.job_manager import jobs
from utils.ffmpeg_helper import ensure_ffmpeg_on_path
from utils.time_helper import parse_time_to_seconds, format_seconds_to_time
from utils.string_helper import sanitize_filename
from utils.zip_helper import create_zip_from_directory, get_file_size_mb


def fetch_video_info(url: str) -> dict:
    """
    Fetches video metadata (title, duration, thumbnail, uploader) without downloading.
    """
    ensure_ffmpeg_on_path()
    ydl_opts = {
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
        duration_sec = info.get('duration') or 0
        
        return {
            "title": info.get('title', 'YouTube Video'),
            "duration": duration_sec,
            "duration_formatted": format_seconds_to_time(duration_sec),
            "thumbnail": info.get('thumbnail', ''),
            "uploader": info.get('uploader', '')
        }


def build_ytdlp_options(outtmpl: str, start_sec: float = None, end_sec: float = None, ffmpeg_dir: str = None) -> dict:
    """
    Constructs yt-dlp configuration options for downloading, merging to MP4,
    and partial trimming with keyframe accuracy.
    """
    opts = {
        'ffmpeg_location': ffmpeg_dir,
        'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        'outtmpl': outtmpl,
        'merge_output_format': 'mp4',
        'quiet': True,
        'no_warnings': True,
    }
    
    if start_sec is not None or end_sec is not None:
        s = start_sec if start_sec is not None else 0.0
        e = end_sec if end_sec is not None else float('inf')
        opts['download_ranges'] = download_range_func(None, [(s, e)])
        opts['force_keyframes_at_cuts'] = True
        
    return opts


def download_single_clip(url: str, outtmpl: str, start_sec: float = None, end_sec: float = None, ffmpeg_dir: str = None):
    """
    Downloads and trims a single clip from YouTube.
    """
    opts = build_ytdlp_options(outtmpl, start_sec, end_sec, ffmpeg_dir)
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])


def validate_clip_request(clip: dict, index: int) -> tuple[str, float | None, float | None, str]:
    """
    Validates a single clip request dictionary and returns parsed values.
    """
    url = clip.get("url", "").strip()
    if not url:
        raise ValueError(f"Clip #{index + 1}: URL cannot be empty.")
        
    start_str = clip.get("start_time")
    end_str = clip.get("end_time")
    custom_name = clip.get("name", "").strip()
    
    start_sec = parse_time_to_seconds(start_str)
    end_sec = parse_time_to_seconds(end_str)
    
    if start_sec is not None and end_sec is not None and end_sec <= start_sec:
        raise ValueError(f"Clip #{index + 1}: End time ({end_str}) must be greater than start time ({start_str}).")
        
    return url, start_sec, end_sec, custom_name


def generate_unique_output_path(videos_dir: str, custom_name: str, index: int, used_names: set) -> str:
    """
    Produces a collision-free filename template within the destination directory.
    """
    base_name = sanitize_filename(custom_name) if custom_name else f"clip_{index + 1}"
    unique_name = base_name
    counter = 1
    while unique_name in used_names:
        unique_name = f"{base_name}_{counter}"
        counter += 1
    used_names.add(unique_name)
    
    return os.path.join(videos_dir, f"{unique_name}.%(ext)s")


def download_youtube_clips_background(job_id: str, temp_dir: str, clip_requests: list):
    """
    Processes a batch of YouTube clip download requests, trims partial ranges,
    converts to standard MP4, and packages all output videos into a ZIP archive.
    """
    try:
        ffmpeg_dir = ensure_ffmpeg_on_path()
        videos_dir = os.path.join(temp_dir, "videos")
        os.makedirs(videos_dir, exist_ok=True)
        
        total_clips = len(clip_requests)
        if total_clips == 0:
            raise ValueError("No video clips requested.")
            
        jobs[job_id]["status_msg"] = f"Initializing download for {total_clips} clip(s)..."
        jobs[job_id]["progress"] = 5
        
        used_filenames = set()
        
        # Download each clip
        for idx, clip in enumerate(clip_requests):
            url, start_sec, end_sec, custom_name = validate_clip_request(clip, idx)
            
            # Progress milestone
            clip_progress_base = 5 + int((idx / total_clips) * 80)
            jobs[job_id]["progress"] = clip_progress_base
            clip_label = f"Clip #{idx + 1}" + (f" ({custom_name})" if custom_name else "")
            jobs[job_id]["status_msg"] = f"Downloading {clip_label} from YouTube..."
            
            outtmpl = generate_unique_output_path(videos_dir, custom_name, idx, used_filenames)
            download_single_clip(url, outtmpl, start_sec, end_sec, ffmpeg_dir)
            
        # Packaging into ZIP archive
        jobs[job_id]["progress"] = 90
        jobs[job_id]["status_msg"] = "Packaging downloaded videos into ZIP archive..."
        
        zip_path = os.path.join(temp_dir, "youtube_videos.zip")
        packaged_clips = create_zip_from_directory(
            source_dir=videos_dir,
            output_zip_path=zip_path,
            allowed_extensions=('.mp4', '.mkv', '.avi', '.mov', '.webm')
        )
        
        if not packaged_clips:
            raise RuntimeError("No valid videos were downloaded. Please verify the URLs and time ranges.")
            
        total_zip_size = get_file_size_mb(zip_path)
        
        # Mark job completed
        jobs[job_id]["status"] = "completed"
        jobs[job_id]["progress"] = 100
        jobs[job_id]["result_path"] = zip_path
        jobs[job_id]["results"] = {
            "total_clips": len(packaged_clips),
            "zip_size_mb": total_zip_size,
            "clips": [{"name": c["filename"], "size_mb": c["size_mb"]} for c in packaged_clips]
        }
        jobs[job_id]["status_msg"] = f"Successfully packaged {len(packaged_clips)} video(s) ({total_zip_size} MB)!"
        
    except Exception as e:
        jobs[job_id]["status"] = "error"
        jobs[job_id]["error"] = str(e)
        jobs[job_id]["status_msg"] = f"Failed: {str(e)}"
