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
