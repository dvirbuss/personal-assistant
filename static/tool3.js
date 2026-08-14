document.addEventListener('DOMContentLoaded', () => {
    const jsonInput = document.getElementById('tool3-json-input');
    const folderInput = document.getElementById('tool3-folder-input');
    const jsonStatus = document.getElementById('tool3-json-status');
    const folderStatus = document.getElementById('tool3-folder-status');
    const startTrainingBtn = document.getElementById('btn-start-training');
    
    let selectedJsonFile = null;
    let selectedImages = [];

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

    jsonInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            selectedJsonFile = e.target.files[0];
            jsonStatus.textContent = `Selected: ${selectedJsonFile.name}`;
            checkReady();
        }
    });

    folderInput.addEventListener('change', (e) => {
        const files = e.target.files;
        selectedImages = Array.from(files).filter(file => file.type.startsWith('image/'));
        if (selectedImages.length > 0) {
            folderStatus.textContent = `Selected ${selectedImages.length} images`;
            checkReady();
        } else {
            folderStatus.textContent = "No images found in folder.";
            selectedImages = [];
            checkReady();
        }
    });

    function checkReady() {
        if (selectedJsonFile && selectedImages.length > 0) {
            startTrainingBtn.disabled = false;
        } else {
            startTrainingBtn.disabled = true;
        }
    }

    startTrainingBtn.addEventListener('click', () => {
        const modelName = document.getElementById('tool3-model-select').value;
        const epochs = document.getElementById('tool3-epochs').value;
        const newModelName = document.getElementById('tool3-new-model-name').value;
        
        if (!modelName || !newModelName) {
            alert("Please select a base model and provide a name for the new model.");
            return;
        }

        const formData = new FormData();
        formData.append('json_file', selectedJsonFile);
        selectedImages.forEach(file => {
            formData.append('images', file);
        });
        formData.append('base_model', modelName);
        formData.append('epochs', epochs);
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
});
