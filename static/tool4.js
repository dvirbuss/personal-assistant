document.addEventListener('DOMContentLoaded', () => {
    const imagesInput = document.getElementById('tool4-images-input');
    const imagesStatus = document.getElementById('tool4-images-status');
    const startEvalBtn = document.getElementById('btn-start-evaluation');
    
    let selectedFiles = [];
    let currentResults = [];
    let currentImageIndex = 0;
    let currentTableImageBase64 = "";

    // Load available models
    let loadedModelsList = [];
    fetch('/models')
        .then(res => res.json())
        .then(data => {
            const container = document.getElementById('tool4-models-list');
            container.innerHTML = '';
            loadedModelsList = data.models || [];
            
            loadedModelsList.forEach(model => {
                const card = document.createElement('div');
                card.className = 'model-card';
                card.dataset.model = model;
                
                // Style the card
                card.style.background = 'rgba(255, 255, 255, 0.05)';
                card.style.border = '1px solid rgba(255, 255, 255, 0.1)';
                card.style.borderRadius = '8px';
                card.style.padding = '8px 12px';
                card.style.cursor = 'pointer';
                card.style.textAlign = 'center';
                card.style.transition = 'all 0.2s';
                card.style.userSelect = 'none';
                
                const nameLabel = document.createElement('div');
                nameLabel.style.fontWeight = '600';
                nameLabel.style.fontSize = '0.9rem';
                nameLabel.style.wordBreak = 'break-all';
                nameLabel.textContent = model;
                
                card.appendChild(nameLabel);
                
                // Toggle selection on click
                card.addEventListener('click', () => {
                    const isSelected = card.classList.toggle('selected');
                    if (isSelected) {
                        card.style.borderColor = '#3b82f6';
                        card.style.borderWidth = '1.5px';
                    } else {
                        card.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                        card.style.borderWidth = '1px';
                    }
                });
                
                // Hover animations
                card.addEventListener('mouseenter', () => {
                    if (!card.classList.contains('selected')) {
                        card.style.background = 'rgba(255, 255, 255, 0.08)';
                        card.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                    }
                });
                card.addEventListener('mouseleave', () => {
                    if (!card.classList.contains('selected')) {
                        card.style.background = 'rgba(255, 255, 255, 0.05)';
                        card.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                    }
                });
                
                container.appendChild(card);
            });
        })
        .catch(err => console.error("Error loading models:", err));

    imagesInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        if (files.length > 0) {
            selectedFiles = files;
            imagesStatus.textContent = `Selected folder with ${files.length} files`;
            startEvalBtn.disabled = false;
        } else {
            imagesStatus.textContent = "Please select a valid folder.";
            selectedFiles = [];
            startEvalBtn.disabled = true;
        }
    });

    startEvalBtn.addEventListener('click', () => {
        const selectedModels = Array.from(document.querySelectorAll('.model-card.selected')).map(el => el.dataset.model);
        if (selectedModels.length === 0) {
            alert("Please select at least one model.");
            return;
        }
        if (selectedFiles.length === 0) {
            alert("Please upload a validation dataset folder.");
            return;
        }

        const formData = new FormData();
        formData.append('models', selectedModels.join(','));
        selectedFiles.forEach(f => {
            formData.append('files', f);
            formData.append('paths', f.webkitRelativePath || f.name);
        });

        const loadingState = document.getElementById('tool4-loading');
        const resultsContainer = document.getElementById('tool4-results-container');
        const progressFill = document.getElementById('tool4-progress-fill');
        const progressText = document.getElementById('tool4-progress-text');
        const processingText = document.getElementById('tool4-processing-text');
        
        loadingState.classList.remove('hidden');
        resultsContainer.classList.add('hidden');
        startEvalBtn.disabled = true;
        
        progressFill.style.width = '0%';
        progressText.textContent = '0%';
        processingText.textContent = 'Uploading dataset...';
        
        currentResults = [];
        currentImageIndex = 0;

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/evaluate', true);

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                const scaledUploadProgress = Math.round((percent / 100) * 15);
                progressFill.style.width = `${scaledUploadProgress}%`;
                progressText.textContent = `${scaledUploadProgress}%`;
                processingText.textContent = `Uploading dataset (${percent}%)...`;
            }
        };

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    if (data.error) throw new Error(data.error);
                    processingText.textContent = 'Initializing evaluation...';
                    pollTool4Status(data.job_id, selectedModels);
                } catch (err) {
                    loadingState.classList.add('hidden');
                    startEvalBtn.disabled = false;
                    alert(`Error parsing response: ${err.message}`);
                }
            } else {
                loadingState.classList.add('hidden');
                startEvalBtn.disabled = false;
                alert(`Upload failed with status ${xhr.status}: ${xhr.statusText}`);
            }
        };

        xhr.onerror = () => {
            loadingState.classList.add('hidden');
            startEvalBtn.disabled = false;
            alert("Upload failed due to a network error.");
        };

        xhr.send(formData);
    });

    function pollTool4Status(jobId, selectedModels) {
        const progressFill = document.getElementById('tool4-progress-fill');
        const progressText = document.getElementById('tool4-progress-text');
        const processingText = document.getElementById('tool4-processing-text');
        const loadingState = document.getElementById('tool4-loading');
        
        const interval = setInterval(async () => {
            try {
                const res = await fetch(`/status/${jobId}`);
                const data = await res.json();
                
                if (data.status === 'error') {
                    clearInterval(interval);
                    throw new Error(data.error);
                }
                
                const progress = data.progress || 0;
                const scaledProgress = 15 + Math.round((progress / 100) * 85);
                progressFill.style.width = `${scaledProgress}%`;
                progressText.textContent = `${scaledProgress}%`;
                
                if (progress < 10) {
                    processingText.textContent = 'Initializing evaluation...';
                } else if (progress < 70) {
                    processingText.textContent = `Evaluating models validation...`;
                } else {
                    processingText.textContent = 'Generating visual comparisons...';
                }
                
                if (data.status === 'completed') {
                    clearInterval(interval);
                    processingText.textContent = 'Loading results...';
                    loadEvaluationResults(jobId, selectedModels);
                }
            } catch (err) {
                clearInterval(interval);
                alert("Error checking evaluation status: " + err.message);
                loadingState.classList.add('hidden');
                startEvalBtn.disabled = false;
            }
        }, 500);
    }

    async function loadEvaluationResults(jobId, selectedModels) {
        const loadingState = document.getElementById('tool4-loading');
        const resultsContainer = document.getElementById('tool4-results-container');
        
        try {
            const res = await fetch(`/evaluation_results/${jobId}`);
            if (!res.ok) throw new Error("Failed to load evaluation results.");
            const data = await res.json();
            
            loadingState.classList.add('hidden');
            startEvalBtn.disabled = false;
            
            // Set scores grid dynamically
            const scoresGrid = document.getElementById('tool4-scores-grid');
            scoresGrid.innerHTML = '';
            selectedModels.forEach(model => {
                const score = data.maps[model] || 0;
                const card = document.createElement('div');
                card.style.background = 'rgba(0,0,0,0.2)';
                card.style.padding = '15px';
                card.style.borderRadius = '12px';
                card.style.border = '1px solid var(--glass-border)';
                card.style.textAlign = 'center';
                
                const title = document.createElement('h4');
                title.style.margin = '0 0 8px 0';
                title.style.fontSize = '0.85rem';
                title.style.color = 'var(--text-muted)';
                title.style.whiteSpace = 'nowrap';
                title.style.overflow = 'hidden';
                title.style.textOverflow = 'ellipsis';
                title.textContent = model;
                
                const val = document.createElement('div');
                val.style.fontSize = '2rem';
                val.style.fontWeight = '800';
                val.style.color = 'var(--primary)';
                val.textContent = score.toFixed(3);
                
                card.appendChild(title);
                card.appendChild(val);
                scoresGrid.appendChild(card);
            });
            
            currentResults = data.images; // Array of { filename, predictions: { model: base64 } }
            currentTableImageBase64 = data.table_image || "";
            
            const tableWrapper = document.getElementById('eval-table-wrapper');
            const tableImg = document.getElementById('eval-table-image');
            
            if (currentTableImageBase64 && tableWrapper && tableImg) {
                tableImg.src = `data:image/png;base64,${currentTableImageBase64}`;
                tableWrapper.classList.remove('hidden');
            } else if (tableWrapper) {
                tableWrapper.classList.add('hidden');
            }
            
            if (currentResults.length > 0) {
                resultsContainer.classList.remove('hidden');
                showResultImage(0, selectedModels);
                
                if (currentTableImageBase64) {
                    const date = new Date();
                    const dd = String(date.getDate()).padStart(2, '0');
                    const mm = String(date.getMonth() + 1).padStart(2, '0');
                    const yy = String(date.getFullYear()).slice(-2);
                    const hh = String(date.getHours()).padStart(2, '0');
                    const min = String(date.getMinutes()).padStart(2, '0');
                    const link = document.createElement('a');
                    link.href = `data:image/png;base64,${currentTableImageBase64}`;
                    link.download = `evaluation_results_table_${dd}-${mm}-${yy}_${hh}-${min}.png`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                }
            } else {
                alert("No visualization images returned.");
            }
        } catch (err) {
            alert("Error loading evaluation: " + err.message);
            loadingState.classList.add('hidden');
            startEvalBtn.disabled = false;
        }
    }

    function showResultImage(index, selectedModels) {
        if (index < 0 || index >= currentResults.length) return;
        currentImageIndex = index;
        
        const predictionsGrid = document.getElementById('tool4-predictions-grid');
        predictionsGrid.innerHTML = '';
        
        const frameResult = currentResults[index];
        const indicator = document.getElementById('eval-indicator');
        indicator.textContent = `Image ${index + 1} / ${currentResults.length}`;
        
        selectedModels.forEach(model => {
            const container = document.createElement('div');
            container.className = 'canvas-container';
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.alignItems = 'center';
            
            const label = document.createElement('p');
            label.style.margin = '0 0 8px 0';
            label.style.fontWeight = '600';
            label.textContent = `${model} Prediction`;
            
            const img = document.createElement('img');
            img.style.maxWidth = '100%';
            img.style.maxHeight = '50vh';
            img.style.objectFit = 'contain';
            img.style.borderRadius = '12px';
            img.style.boxShadow = '0 8px 32px rgba(0,0,0,0.3)';
            img.src = `data:image/jpeg;base64,${frameResult.predictions[model] || ''}`;
            
            container.appendChild(label);
            container.appendChild(img);
            predictionsGrid.appendChild(container);
        });
    }

    document.getElementById('btn-eval-prev').addEventListener('click', () => {
        if (currentImageIndex > 0) {
            const selectedModels = Array.from(document.querySelectorAll('.model-card.selected')).map(el => el.dataset.model);
            showResultImage(currentImageIndex - 1, selectedModels);
        }
    });

    document.getElementById('btn-eval-next').addEventListener('click', () => {
        if (currentImageIndex < currentResults.length - 1) {
            const selectedModels = Array.from(document.querySelectorAll('.model-card.selected')).map(el => el.dataset.model);
            showResultImage(currentImageIndex + 1, selectedModels);
        }
    });

    // Drag & Drop for Folder Evaluation
    const dropZone4 = document.getElementById('tool4-drop-zone');

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

    if (dropZone4) {
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone4.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone4.classList.add('dragover');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone4.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone4.classList.remove('dragover');
            }, false);
        });

        dropZone4.addEventListener('drop', async (e) => {
            const items = Array.from(e.dataTransfer.items);
            const files = await getFilesFromItems(items);
            const validFiles = files.filter(f => {
                const name = f.name.toLowerCase();
                return name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png') || name.endsWith('.txt') || name.endsWith('.yaml') || name.endsWith('.yml');
            });
            
            if (validFiles.length > 0) {
                selectedFiles = validFiles;
                imagesStatus.textContent = `Selected dropped folder with ${validFiles.length} files`;
                startEvalBtn.disabled = false;
            } else {
                imagesStatus.textContent = "No valid files found in dropped folder.";
                selectedFiles = [];
                startEvalBtn.disabled = true;
            }
        });
    }

    const tableImgEl = document.getElementById('eval-table-image');
    if (tableImgEl) {
        tableImgEl.style.cursor = 'pointer';
        tableImgEl.title = 'Click to download table';
        tableImgEl.addEventListener('click', () => {
            if (!currentTableImageBase64) return;
            const date = new Date();
            const dd = String(date.getDate()).padStart(2, '0');
            const mm = String(date.getMonth() + 1).padStart(2, '0');
            const yy = String(date.getFullYear()).slice(-2);
            const hh = String(date.getHours()).padStart(2, '0');
            const min = String(date.getMinutes()).padStart(2, '0');
            const link = document.createElement('a');
            link.href = `data:image/png;base64,${currentTableImageBase64}`;
            link.download = `evaluation_results_table_${dd}-${mm}-${yy}_${hh}-${min}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
    }
});
