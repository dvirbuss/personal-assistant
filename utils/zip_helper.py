import os
import zipfile

def extract_if_zip(file_path: str, output_dir: str):
    """
    Checks if a file is a zip file. If so, extracts its contents into output_dir
    and deletes the original zip file.
    Returns True if it was a zip file, False otherwise.
    """
    if file_path.lower().endswith('.zip') and zipfile.is_zipfile(file_path):
        with zipfile.ZipFile(file_path, 'r') as zip_ref:
            zip_ref.extractall(output_dir)
        os.remove(file_path)
        
        # Flatten structure if the zip contains a single root folder
        extracted_items = os.listdir(output_dir)
        if len(extracted_items) == 1:
            single_item_path = os.path.join(output_dir, extracted_items[0])
            if os.path.isdir(single_item_path):
                for item in os.listdir(single_item_path):
                    os.rename(os.path.join(single_item_path, item), os.path.join(output_dir, item))
                os.rmdir(single_item_path)
        return True
    return False


def create_zip_from_directory(source_dir: str, output_zip_path: str, allowed_extensions: tuple = None) -> list:
    """
    Packages all files (optionally filtered by allowed_extensions) from source_dir into output_zip_path.
    Returns a list of dicts with file metadata [{'filename': ..., 'size_mb': ...}].
    """
    packaged_files = []
    with zipfile.ZipFile(output_zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as zipf:
        for root, _, files in os.walk(source_dir):
            for file in files:
                if allowed_extensions and not file.lower().endswith(allowed_extensions):
                    continue
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, source_dir)
                zipf.write(full_path, arcname=rel_path)
                packaged_files.append({
                    "filename": rel_path,
                    "size_mb": round(os.path.getsize(full_path) / (1024 * 1024), 2)
                })
    return packaged_files


def get_file_size_mb(file_path: str) -> float:
    """Returns the size of a file in megabytes rounded to 2 decimal places."""
    if not os.path.exists(file_path):
        return 0.0
    return round(os.path.getsize(file_path) / (1024 * 1024), 2)
