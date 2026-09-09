import shutil

# Global jobs store
jobs = {}

def cleanup_job(job_id: str, temp_dir: str):
    """Cleans up the temporary directory associated with a job."""
    shutil.rmtree(temp_dir, ignore_errors=True)
    if job_id in jobs:
        del jobs[job_id]

def get_job_status(job_id: str):
    if job_id not in jobs:
        return {"status": "not_found", "progress": 0}
    return {
        "status": jobs[job_id].get("status", "unknown"),
        "progress": jobs[job_id].get("progress", 0),
        "error": jobs[job_id].get("error"),
        "status_msg": jobs[job_id].get("status_msg", ""),
        "results": jobs[job_id].get("results")
    }
