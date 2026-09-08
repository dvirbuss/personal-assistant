document.addEventListener('DOMContentLoaded', () => {
    const datasetInput = document.getElementById('tool3-dataset-input');
    const datasetStatus = document.getElementById('tool3-dataset-status');
    const startTrainingBtn = document.getElementById('btn-start-training');
    
    let selectedDatasetFiles = [];

    // Load available models
    fetch('/models')
        .then(res => res.json())
        .then(data => {
            const select = document.getElementById('tool3-model-select');
            select.innerHTML = '';
            data.models.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                option.style.color = "black";
                select.appendChild(option);
            });
        })
        .catch(err => console.error("Error loading models:", err));

    datasetInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        if (files.length > 0) {
            selectedDatasetFiles = files;
            const hasJson = files.some(f => f.name.endsWith('.json'));
            if (hasJson) {
                datasetStatus.textContent = `Selected folder with ${files.length} files (.json found)`;
                datasetStatus.style.color = '#10b981';
                startTrainingBtn.disabled = false;
            } else {
                datasetStatus.textContent = `Error: COCO JSON file (.json) not found in selected directory.`;
                datasetStatus.style.color = '#ef4444';
                startTrainingBtn.disabled = true;
            }
        } else {
            datasetStatus.textContent = "";
            selectedDatasetFiles = [];
            startTrainingBtn.disabled = true;
        }
    });

    startTrainingBtn.addEventListener('click', () => {
        const modelName = document.getElementById('tool3-model-select').value;
        const epochs = document.getElementById('tool3-epochs').value;
        const lr0 = document.getElementById('tool3-lr0').value;
        const pose = document.getElementById('tool3-pose').value;
        const useOptuna = document.getElementById('tool3-use-optuna').checked;
        const newModelName = document.getElementById('tool3-new-model-name').value;
        
        if (!modelName || !newModelName) {
            alert("Please select a base model and provide a name for the new model.");
            return;
        }
        if (selectedDatasetFiles.length === 0) {
            alert("Please select a dataset folder to upload.");
            return;
        }

        const formData = new FormData();
        selectedDatasetFiles.forEach(file => {
            formData.append('files', file);
            formData.append('paths', file.webkitRelativePath || file.name);
        });
        formData.append('base_model', modelName);
        formData.append('epochs', epochs);
        formData.append('lr0', lr0);
        formData.append('pose', pose);
        formData.append('use_optuna', useOptuna);
        formData.append('new_model_name', newModelName);

        const loadingState = document.getElementById('tool3-loading');
        const progressFill = document.getElementById('tool3-progress-fill');
        const progressText = document.getElementById('tool3-progress-text');
        const resultMsg = document.getElementById('tool3-result-message');
        
        loadingState.classList.remove('hidden');
        resultMsg.classList.add('hidden');
        startTrainingBtn.disabled = true;
        
        progressFill.style.width = '0%';
        progressText.textContent = '0%';
        document.getElementById('tool3-processing-text').textContent = 'Uploading dataset...';

        fetch('/train', {
            method: 'POST',
            body: formData
        })
        .then(res => res.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            pollTrainingStatus(data.job_id);
        })
        .catch(err => {
            loadingState.classList.add('hidden');
            resultMsg.textContent = `Error: ${err.message}`;
            resultMsg.className = "message error";
            resultMsg.classList.remove('hidden');
            startTrainingBtn.disabled = false;
        });
    });

    function pollTrainingStatus(jobId) {
        const progressFill = document.getElementById('tool3-progress-fill');
        const progressText = document.getElementById('tool3-progress-text');
        const statusText = document.getElementById('tool3-processing-text');
        const resultMsg = document.getElementById('tool3-result-message');
        const loadingState = document.getElementById('tool3-loading');

        const interval = setInterval(() => {
            fetch(`/train/status/${jobId}`)
                .then(res => res.json())
                .then(data => {
                    if (data.status === 'error') {
                        clearInterval(interval);
                        loadingState.classList.add('hidden');
                        resultMsg.textContent = `Training Error: ${data.error}`;
                        resultMsg.className = "message error";
                        resultMsg.classList.remove('hidden');
                        startTrainingBtn.disabled = false;
                        return;
                    }
                    
                    const progress = data.progress || 0;
                    progressFill.style.width = `${progress}%`;
                    progressText.textContent = `${progress}%`;
                    
                    if (data.status_msg) {
                        statusText.textContent = data.status_msg;
                    }
                    
                    if (data.status === 'completed') {
                        clearInterval(interval);
                        loadingState.classList.add('hidden');
                        resultMsg.textContent = `Training Complete! New model saved as ${data.model_path}`;
                        resultMsg.className = "message success";
                        resultMsg.classList.remove('hidden');
                        startTrainingBtn.disabled = false;
                        
                        // Force refresh of the model dropdowns by reloading them if needed
                        // (User can just refresh the page or we can trigger the fetch again)
                    }
                })
                .catch(err => {
                    clearInterval(interval);
                    loadingState.classList.add('hidden');
                    resultMsg.textContent = `Connection Error: ${err.message}`;
                    resultMsg.className = "message error";
                    resultMsg.classList.remove('hidden');
                    startTrainingBtn.disabled = false;
                });
        }, 2000); // Check every 2 seconds for training
    }
    // Drag & Drop for Dataset Folder
    const dropZone3 = document.getElementById('tool3-drop-zone');

    async function getFilesFromEntry(entry, path = "") {
        if (entry.isFile) {
            return new Promise((resolve) => {
                entry.file((file) => {
                    const relPath = path + file.name;
                    Object.defineProperty(file, 'webkitRelativePath', {
                        value: relPath,
                        configurable: true,
                        enumerable: true,
                        writable: true
                    });
                    resolve([file]);
                });
            });
        } else if (entry.isDirectory) {
            const dirReader = entry.createReader();
            return new Promise((resolve) => {
                dirReader.readEntries(async (entries) => {
                    const filePromises = entries.map(e => getFilesFromEntry(e, path + entry.name + "/"));
                    const fileGroups = await Promise.all(filePromises);
                    resolve(fileGroups.flat());
                });
            });
        }
        return [];
    }

    async function getFilesFromItems(items) {
        const filePromises = items.map(item => {
            if (item.kind === 'file') {
                const entry = item.webkitGetAsEntry();
                if (entry) return getFilesFromEntry(entry);
            }
            return Promise.resolve([]);
        });
        const fileGroups = await Promise.all(filePromises);
        return fileGroups.flat();
    }

    if (dropZone3) {
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone3.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone3.classList.add('dragover');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone3.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone3.classList.remove('dragover');
            }, false);
        });

        dropZone3.addEventListener('drop', async (e) => {
            const items = Array.from(e.dataTransfer.items);
            const files = await getFilesFromItems(items);
            if (files.length > 0) {
                selectedDatasetFiles = files;
                const hasJson = files.some(f => f.name.endsWith('.json'));
                if (hasJson) {
                    datasetStatus.textContent = `Selected dropped folder with ${files.length} files (.json found)`;
                    datasetStatus.style.color = '#10b981';
                    startTrainingBtn.disabled = false;
                } else {
                    datasetStatus.textContent = `Error: COCO JSON file (.json) not found in dropped folder.`;
                    datasetStatus.style.color = '#ef4444';
                    startTrainingBtn.disabled = true;
                }
            } else {
                datasetStatus.textContent = "No valid files found in dropped folder.";
                selectedDatasetFiles = [];
                startTrainingBtn.disabled = true;
            }
        });
    }
});
