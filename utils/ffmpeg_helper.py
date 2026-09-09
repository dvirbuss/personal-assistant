import os
import shutil
import imageio_ffmpeg

def get_ffmpeg_path() -> str:
    """
    Retrieves the absolute path to the FFmpeg executable from imageio-ffmpeg.
    Ensures that a standard 'ffmpeg.exe' exists alongside any versioned binary.
    """
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    ffmpeg_dir = os.path.dirname(ffmpeg_exe)
    
    target_name = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
    standard_ffmpeg = os.path.join(ffmpeg_dir, target_name)
    
    if not os.path.exists(standard_ffmpeg) and os.path.exists(ffmpeg_exe):
        try:
            shutil.copyfile(ffmpeg_exe, standard_ffmpeg)
        except Exception:
            pass
            
    return standard_ffmpeg if os.path.exists(standard_ffmpeg) else ffmpeg_exe


def ensure_ffmpeg_on_path() -> str:
    """
    Ensures that the directory containing FFmpeg is prepended to os.environ['PATH'].
    Returns the directory path containing the FFmpeg binary.
    """
    ffmpeg_path = get_ffmpeg_path()
    ffmpeg_dir = os.path.dirname(ffmpeg_path)
    
    current_path = os.environ.get("PATH", "")
    if ffmpeg_dir not in current_path:
        os.environ["PATH"] = ffmpeg_dir + os.pathsep + current_path
        
    return ffmpeg_dir
