document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements - Base Dataset
    const baseDropZone = document.getElementById('merge-base-drop-zone');
    const baseFolderInput = document.getElementById('merge-base-folder-input');
    const baseZipInput = document.getElementById('merge-base-zip-input');
    const baseStatus = document.getElementById('merge-base-status');
    const baseBadge = document.getElementById('merge-base-badge');

    // DOM Elements - New Batch Dataset
    const newDropZone = document.getElementById('merge-new-drop-zone');
    const newFolderInput = document.getElementById('merge-new-folder-input');
    const newZipInput = document.getElementById('merge-new-zip-input');
    const newStatus = document.getElementById('merge-new-status');
    const newBadge = document.getElementById('merge-new-badge');

    // Controls & State
    const btnMerge = document.getElementById('btn-merge-datasets');
    const loadingState = document.getElementById('merge-loading');
    const progressFill = document.getElementById('merge-progress-fill');
    const progressText = document.getElementById('merge-progress-text');
    const processingText = document.getElementById('merge-processing-text');
    const resultPanel = document.getElementById('merge-result-panel');
    const resultMsg = document.getElementById('merge-result-message');
    const btnDownload = document.getElementById('btn-download-merged');
    const btnGotoTraining = document.getElementById('btn-goto-training');

    let baseFiles = [];
    let basePaths = [];
    let newFiles = [];
    let newPaths = [];
    let currentJobId = null;

    // Helper: update button enable state
    function updateMergeButtonState() {
        const isBaseReady = baseFiles.length > 0;
        const isNewReady = newFiles.length > 0;
        btnMerge.disabled = !(isBaseReady && isNewReady);
    }

    // Helper: validate and register files
    function processSelectedFiles(fileList, target) {
        const filesArray = Array.from(fileList);
        const pathsArray = [];
        let hasJson = false;
        let hasZip = false;
        let imgCount = 0;

        filesArray.forEach(f => {
            const relPath = f.webkitRelativePath || f.name;
            pathsArray.push(relPath);
            const lower = relPath.toLowerCase();
            if (lower.endsWith('.json')) hasJson = true;
            if (lower.endsWith('.zip')) hasZip = true;
            if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.endsWith('.webp')) {
                imgCount++;
            }
        });

        if (target === 'base') {
            baseFiles = filesArray;
            basePaths = pathsArray;
            if (hasZip) {
                baseStatus.textContent = `ZIP Archive: ${filesArray[0].name} (${(filesArray[0].size / (1024*1024)).toFixed(1)} MB)`;
                baseStatus.style.color = '#10b981';
                baseBadge.textContent = 'ZIP Ready';
                baseBadge.className = 'status-chip success';
            } else if (hasJson && imgCount > 0) {
                baseStatus.textContent = `Folder loaded: ${imgCount} images, 1 annotations.json`;
                baseStatus.style.color = '#10b981';
                baseBadge.textContent = `${imgCount} Images + JSON`;
                baseBadge.className = 'status-chip success';
            } else if (hasJson) {
                baseStatus.textContent = `Folder loaded: annotations.json found, ${filesArray.length} files`;
                baseStatus.style.color = '#10b981';
                baseBadge.textContent = 'JSON Ready';
                baseBadge.className = 'status-chip success';
            } else {
                baseStatus.textContent = `Loaded ${filesArray.length} files (Warning: .json or .zip not detected)`;
                baseStatus.style.color = '#f59e0b';
                baseBadge.textContent = 'Missing .json?';
                baseBadge.className = 'status-chip warning';
            }
        } else {
            newFiles = filesArray;
            newPaths = pathsArray;
            if (hasZip) {
                newStatus.textContent = `ZIP Archive: ${filesArray[0].name} (${(filesArray[0].size / (1024*1024)).toFixed(1)} MB)`;
                newStatus.style.color = '#10b981';
                newBadge.textContent = 'ZIP Ready';
                newBadge.className = 'status-chip success';
            } else if (hasJson && imgCount > 0) {
                newStatus.textContent = `Folder loaded: ${imgCount} images, 1 annotations.json`;
                newStatus.style.color = '#10b981';
                newBadge.textContent = `${imgCount} Images + JSON`;
                newBadge.className = 'status-chip success';
            } else if (hasJson) {
                newStatus.textContent = `Folder loaded: annotations.json found, ${filesArray.length} files`;
                newStatus.style.color = '#10b981';
                newBadge.textContent = 'JSON Ready';
                newBadge.className = 'status-chip success';
            } else {
                newStatus.textContent = `Loaded ${filesArray.length} files (Warning: .json or .zip not detected)`;
                newStatus.style.color = '#f59e0b';
                newBadge.textContent = 'Missing .json?';
                newBadge.className = 'status-chip warning';
            }
        }

        updateMergeButtonState();
    }

    // Setup drag and drop for a drop zone
    function setupDropZone(dropZoneEl, target) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(name => {
            dropZoneEl.addEventListener(name, (e) => {
                e.preventDefault();
                e.stopPropagation();
            }, false);
        });

        ['dragenter', 'dragover'].forEach(name => {
            dropZoneEl.addEventListener(name, () => dropZoneEl.classList.add('dragover'), false);
        });

        ['dragleave', 'drop'].forEach(name => {
            dropZoneEl.addEventListener(name, () => dropZoneEl.classList.remove('dragover'), false);
        });

        dropZoneEl.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            if (dt && dt.files && dt.files.length > 0) {
                processSelectedFiles(dt.files, target);
            }
        });
    }

    setupDropZone(baseDropZone, 'base');
    setupDropZone(newDropZone, 'new');

    // Input change listeners - Base
    baseFolderInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            processSelectedFiles(e.target.files, 'base');
        }
    });
    baseZipInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            processSelectedFiles(e.target.files, 'base');
        }
    });

    // Input change listeners - New
    newFolderInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            processSelectedFiles(e.target.files, 'new');
        }
    });
    newZipInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            processSelectedFiles(e.target.files, 'new');
        }
    });

    // Merge button handler
    btnMerge.addEventListener('click', () => {
        if (baseFiles.length === 0 || newFiles.length === 0) {
            alert("Please select both the Base Dataset and New Batch Dataset to merge.");
            return;
        }

        const formData = new FormData();
        baseFiles.forEach((file, idx) => {
            formData.append('base_files', file);
            formData.append('base_paths', basePaths[idx]);
        });
        newFiles.forEach((file, idx) => {
            formData.append('new_files', file);
            formData.append('new_paths', newPaths[idx]);
        });

        // UI Transition
        loadingState.classList.remove('hidden');
        resultPanel.classList.add('hidden');
        resultMsg.classList.add('hidden');
        btnMerge.disabled = true;

        progressFill.style.width = '0%';
        progressText.textContent = '0%';
        processingText.textContent = 'Uploading datasets to server...';

        fetch('/merge_datasets', {
            method: 'POST',
            body: formData
        })
        .then(res => {
            if (!res.ok) return res.json().then(d => { throw new Error(d.detail || 'Upload failed'); });
            return res.json();
        })
        .then(data => {
            currentJobId = data.job_id;
            pollMergeStatus(currentJobId);
        })
        .catch(err => {
            loadingState.classList.add('hidden');
            resultMsg.textContent = `Error: ${err.message}`;
            resultMsg.className = "message error";
            resultMsg.classList.remove('hidden');
            btnMerge.disabled = false;
        });
    });

    function pollMergeStatus(jobId) {
        const interval = setInterval(() => {
            fetch(`/status/${jobId}`)
                .then(res => res.json())
                .then(job => {
                    if (job.status === 'processing') {
                        const prog = job.progress || 10;
                        progressFill.style.width = `${prog}%`;
                        progressText.textContent = `${prog}%`;
                        processingText.textContent = job.status_msg || 'Processing dataset merge...';
                    } else if (job.status === 'completed') {
                        clearInterval(interval);
                        progressFill.style.width = '100%';
                        progressText.textContent = '100%';
                        processingText.textContent = 'Merge Complete!';
                        
                        setTimeout(() => {
                            loadingState.classList.add('hidden');
                            btnMerge.disabled = false;
                            displayMergeResults(job.results);
                        }, 500);
                    } else if (job.status === 'error') {
                        clearInterval(interval);
                        loadingState.classList.add('hidden');
                        btnMerge.disabled = false;
                        resultMsg.textContent = `Merge failed: ${job.error || job.status_msg || 'Unknown error'}`;
                        resultMsg.className = "message error";
                        resultMsg.classList.remove('hidden');
                    }
                })
                .catch(err => {
                    console.error("Status polling error:", err);
                });
        }, 800);
    }

    function displayMergeResults(stats) {
        resultPanel.classList.remove('hidden');

        // Populate stats chips
        document.getElementById('stat-base-imgs').textContent = stats.base_images || 0;
        document.getElementById('stat-base-annots').textContent = stats.base_annotations || 0;
        document.getElementById('stat-new-imgs').textContent = stats.new_images || 0;
        document.getElementById('stat-new-annots').textContent = stats.new_annotations || 0;
        document.getElementById('stat-total-imgs').textContent = stats.total_images || 0;
        document.getElementById('stat-total-annots').textContent = stats.total_annotations || 0;
        
        const mbSize = ((stats.zip_size_bytes || 0) / (1024 * 1024)).toFixed(2);
        document.getElementById('stat-zip-size').textContent = `${mbSize} MB`;

        // Download button
        btnDownload.onclick = () => {
            window.location.href = `/download_merged/${currentJobId}`;
        };

        // Scroll smoothly to results
        resultPanel.scrollIntoView({ behavior: 'smooth' });
    }

    // Go to Training shortcut
    btnGotoTraining.addEventListener('click', () => {
        const trainTabBtn = document.querySelector('.tool-btn[data-tool="tool-3"]');
        if (trainTabBtn) {
            trainTabBtn.click();
        }
    });
});
