document.addEventListener('DOMContentLoaded', () => {
    // --- Tool Switching ---
    const toolBtns = document.querySelectorAll('.tool-btn');
    const toolContents = document.querySelectorAll('.tool-content');

    toolBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active class from all
            toolBtns.forEach(b => b.classList.remove('active'));
            toolContents.forEach(c => c.classList.remove('active'));

            // Add active class to clicked
            btn.classList.add('active');
            const targetId = btn.getAttribute('data-tool');
            document.getElementById(targetId).classList.add('active');
        });
    });

    // --- Drag and Drop functionality ---
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const loadingState = document.getElementById('loading-state');
    const resultMessage = document.getElementById('result-message');

    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    // Highlight drop zone when item is dragged over it
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, unhighlight, false);
    });

    function highlight(e) {
        dropZone.classList.add('dragover');
    }

    function unhighlight(e) {
        dropZone.classList.remove('dragover');
    }

    const fileListEl = document.getElementById('file-list');
    const generateBtn = document.getElementById('generate-btn');
    let selectedFiles = [];

    // Handle dropped files
    dropZone.addEventListener('drop', handleDrop, false);

    function handleDrop(e) {
        let dt = e.dataTransfer;
        let files = dt.files;
        handleFiles(files);
    }

    // Handle file input change
    fileInput.addEventListener('change', function(e) {
        handleFiles(this.files);
    });

    function handleFiles(files) {
        if (files.length === 0) return;
        
        const validExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.zip'];
        
        Array.from(files).forEach(file => {
            const fileName = file.name.toLowerCase();
            const hasValidExtension = validExtensions.some(ext => fileName.endsWith(ext));

            if (file.type.startsWith('video/') || hasValidExtension) {
                selectedFiles.push({ file: file, limit: 25 });
            } else {
                showMessage(`Skipped ${file.name}: Not a valid video file.`, "error");
            }
        });
        
        renderFileList();
    }
    
    function renderFileList() {
        if (selectedFiles.length > 0) {
            fileListEl.classList.remove('hidden');
            
            fileListEl.innerHTML = '';
            selectedFiles.forEach((item, index) => {
                const div = document.createElement('div');
                div.className = 'file-item';
                div.innerHTML = `
                    <span class="file-name">${item.file.name}</span>
                    <div class="file-controls">
                        <label>Max Frames: <input type="number" class="frame-limit-input" min="1" value="${item.limit}" onchange="updateLimit(${index}, this.value)"></label>
                        <button class="remove-btn" onclick="removeFile(${index})">❌</button>
                    </div>
                `;
                fileListEl.appendChild(div);
            });
        } else {
            fileListEl.classList.add('hidden');
        }
    }
    
    window.updateLimit = function(index, value) {
        const parsed = parseInt(value, 10);
        selectedFiles[index].limit = parsed > 0 ? parsed : 25;
    };
    
    window.removeFile = function(index) {
        selectedFiles.splice(index, 1);
        renderFileList();
        fileInput.value = '';
    };

    generateBtn.addEventListener('click', () => {
        if (selectedFiles.length > 0) {
            uploadVideos(selectedFiles);
        }
    });

    function showMessage(msg, type) {
        resultMessage.textContent = msg;
        resultMessage.className = `message ${type}`;
        
        // Hide after 5 seconds
        setTimeout(() => {
            resultMessage.classList.add('hidden');
        }, 5000);
    }

    function uploadVideos(items) {
        // Show loading state
        loadingState.classList.remove('hidden');
        resultMessage.classList.add('hidden');
        
        const progressBarFill = document.getElementById('progress-bar-fill');
        const progressText = document.getElementById('progress-text');
        const processingText = document.getElementById('processing-text');
        
        progressBarFill.style.width = '0%';
        progressText.textContent = '0%';
        processingText.textContent = 'Uploading videos...';

        const formData = new FormData();
        const limits = [];
        items.forEach(item => {
            formData.append('files', item.file);
            limits.push(item.limit);
        });
        formData.append('limits', JSON.stringify(limits));

        const fpsSelect = document.getElementById('fps-select');
        const fpsOption = fpsSelect ? fpsSelect.value : '1';
        formData.append('fps_option', fpsOption);

        fetch('/process_video', {
            method: 'POST',
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                return response.text().then(text => { throw new Error(text || 'Network response was not ok'); });
            }
            return response.json();
        })
        .then(data => {
            if (data.error) throw new Error(data.error);
            const jobId = data.job_id;
            processingText.textContent = 'Processing Frames...';
            pollStatus(jobId);
        })
        .catch(error => {
            console.error('Error:', error);
            showMessage("Failed to start processing: " + error.message, "error");
            loadingState.classList.add('hidden');
            fileInput.value = '';
        });
    }
    
    function pollStatus(jobId) {
        const progressBarFill = document.getElementById('progress-bar-fill');
        const progressText = document.getElementById('progress-text');
        const processingText = document.getElementById('processing-text');
        
        const interval = setInterval(() => {
            fetch(`/status/${jobId}`)
                .then(res => res.json())
                .then(data => {
                    if (data.status === 'error') {
                        clearInterval(interval);
                        throw new Error(data.error || 'Unknown error during processing');
                    }
                    
                    const progress = data.progress || 0;
                    progressBarFill.style.width = `${progress}%`;
                    progressText.textContent = `${progress}%`;
                    
                    if (data.status === 'completed') {
                        clearInterval(interval);
                        processingText.textContent = 'Complete! Downloading...';
                        
                        setTimeout(() => {
                            downloadResult(jobId);
                        }, 500); // small delay to show 100%
                    }
                })
                .catch(err => {
                    clearInterval(interval);
                    showMessage("Error checking status: " + err.message, "error");
                    loadingState.classList.add('hidden');
                    fileInput.value = '';
                });
        }, 500);
    }
    
    function downloadResult(jobId) {
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = `/download/${jobId}`;
        const now = new Date();
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const d = new Date(utc + (3600000 * 3));
        
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yy = String(d.getFullYear()).slice(-2);
        const hh = String(d.getHours()).padStart(2, '0');
        const mins = String(d.getMinutes()).padStart(2, '0');
        
        a.download = `videos_frames_${dd}-${mm}-${yy}_${hh}-${mins}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        showMessage("Videos processed successfully! Downloading frames...", "success");
        
        selectedFiles = [];
        renderFileList();
        
        loadingState.classList.add('hidden');
        fileInput.value = '';
    }
});
