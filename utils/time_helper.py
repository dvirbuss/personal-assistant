def parse_time_to_seconds(time_val) -> float | None:
    """
    Parses timestamp representations into seconds (float).
    Supports:
        - "HH:MM:SS" (e.g. "01:23:45" -> 5025.0)
        - "MM:SS"    (e.g. "01:30"    -> 90.0)
        - "SS" / "SS.s" (e.g. "45"    -> 45.0, "12.5" -> 12.5)
        - int / float values
        - None or empty string -> None
    """
    if time_val is None:
        return None
    if isinstance(time_val, (int, float)):
        return float(time_val)
        
    s = str(time_val).strip()
    if not s:
        return None
        
    parts = s.split(":")
    try:
        if len(parts) == 1:
            return float(parts[0])
        elif len(parts) == 2:
            minutes = float(parts[0])
            seconds = float(parts[1])
            return minutes * 60 + seconds
        elif len(parts) == 3:
            hours = float(parts[0])
            minutes = float(parts[1])
            seconds = float(parts[2])
            return hours * 3600 + minutes * 60 + seconds
        else:
            raise ValueError(f"Unrecognized time format: {s}")
    except ValueError as e:
        raise ValueError(f"Invalid timestamp '{s}'. Expected formats: 'MM:SS', 'HH:MM:SS', or seconds.") from e


def format_seconds_to_time(seconds: float | int | None) -> str:
    """
    Converts a duration in seconds to a human-readable HH:MM:SS or MM:SS format.
    """
    if seconds is None:
        return "00:00"
        
    sec_int = int(seconds)
    minutes, secs = divmod(sec_int, 60)
    hours, minutes = divmod(minutes, 60)
    
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"
