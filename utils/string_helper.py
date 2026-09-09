import re

def sanitize_filename(name: str, max_length: int = 100, default: str = "video") -> str:
    """
    Sanitizes a string to produce a safe filename across Windows and Unix filesystems.
    Removes invalid characters, strips surrounding whitespace, and truncates length.
    """
    if not name or not isinstance(name, str):
        return default
        
    cleaned = re.sub(r'[\\/*?:"<>|]', "", name)
    cleaned = cleaned.strip().replace(" ", "_")
    
    # Remove multiple contiguous underscores
    cleaned = re.sub(r'_+', '_', cleaned)
    
    result = cleaned[:max_length].strip('_')
    return result if result else default
