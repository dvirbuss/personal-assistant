// Tool 2 implementation

const COCO_KEYPOINT_NAMES = [
    "Nose", "Left Eye", "Right Eye", "Left Ear", "Right Ear",
    "Left Shoulder", "Right Shoulder", "Left Elbow", "Right Elbow",
    "Left Wrist", "Right Wrist", "Left Hip", "Right Hip",
    "Left Knee", "Right Knee", "Left Ankle", "Right Ankle"
];

document.addEventListener('DOMContentLoaded', () => {
    // Tool 2 Elements
    const folderInput = document.getElementById('tool2-folder-input');
    const loadingState = document.getElementById('tool2-loading');
    const progressFill = document.getElementById('tool2-progress-fill');
    const progressText = document.getElementById('tool2-progress-text');
    const processingText = document.getElementById('tool2-processing-text');
    const setupDiv = document.getElementById('tool2-setup');
    const workspaceDiv = document.getElementById('tool2-workspace');
    
    const canvas = document.getElementById('annotation-canvas');
    const ctx = canvas.getContext('2d');
    const btnPrev = document.getElementById('btn-prev-frame');
    const btnNext = document.getElementById('btn-next-frame');
    const btnExportTraining = document.getElementById('btn-export-training');
    const btnExportEvaluation = document.getElementById('btn-export-evaluation');
    const btnExportAnnotatedImages = document.getElementById('btn-export-annotated-images');
    const btnCopyPrev = document.getElementById('btn-copy-prev');
    const frameIndicator = document.getElementById('frame-indicator');
    const modelSelect = document.getElementById('tool2-model-select');
    const btnTool2GenerateAnnotations = document.getElementById('btn-tool2-generate-annotations');
    const keypointListUl = document.getElementById('keypoint-list');
    const exportMsg = document.getElementById('tool2-export-message');
    
    // Fetch available models
    fetch('/models').then(res => res.json()).then(data => {
        if (data.models && data.models.length > 0) {
            modelSelect.innerHTML = ''; // clear default
            data.models.forEach(model => {
                const opt = document.createElement('option');
                opt.value = model;
                opt.textContent = model;
                opt.style.color = "black";
                modelSelect.appendChild(opt);
            });
        }
    }).catch(err => console.error("Could not fetch models:", err));
    
    let framesData = []; // [{filename, keypoints: [{x,y,v}...], imgElement}]
    let currentFrameIdx = 0;
    let currentJobId = null; // Store for GT export
    let undoStack = []; // Store history for Ctrl+Z
    let selectedFolderFiles = []; // Store references to selected files locally
    
    // Canvas dragging state
    let isDragging = false;
    let dragPointIdx = -1;
    const pointRadius = 6;
    
    // Selection state
    const selectedPoints = new Set();
    let isSelecting = false;
    let selectionRect = null; // { startX, startY, endX, endY }
    
    function updateSelectionUI() {
        renderSidebar();
    }
    
    function handleFileSelection(files) {
        if (files.length === 0) return;
        
        selectedFolderFiles = files;
        workspaceDiv.classList.add('hidden');
        
        if (folderStatus2) {
            folderStatus2.textContent = `Selected ${files.length} images. Click Generate Annotations to start.`;
        }
    }

    folderInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
        handleFileSelection(files);
    });
    

    
    function pollTool2Status(jobId, originalFiles) {
        const interval = setInterval(async () => {
            try {
                const res = await fetch(`/status/${jobId}`);
                const data = await res.json();
                
                if (data.status === 'error') {
                    clearInterval(interval);
                    throw new Error(data.error);
                }
                
                const progress = data.progress || 0;
                progressFill.style.width = `${progress}%`;
                progressText.textContent = `${progress}%`;
                
                if (data.status === 'completed') {
                    clearInterval(interval);
                    processingText.textContent = 'Loading results...';
                    loadResults(jobId, originalFiles);
                }
            } catch (err) {
                clearInterval(interval);
                alert("Error checking status: " + err.message);
            }
        }, 500);
    }
    
    async function loadResults(jobId, originalFiles) {
        try {
            const res = await fetch(`/pose_results/${jobId}`);
            if (!res.ok) throw new Error("Failed to get results");
            const data = await res.json();
            
            // Map original files to images in browser memory
            // Note: If ZIP was used, we won't have individual files here, we rely on paths from backend
            // Let's modify to fetch the images directly from the backend if it was a ZIP, or just use the local file if it's a folder.
            // Since we can't easily read out of a zip in standard JS without JSZip, we'll fetch them from the server.
            
            // Actually, we can just fetch the images from a static route for temp_dir, but we don't have one.
            // A simpler way: `/pose_results` could return base64 images if requested, but that's too much data.
            // Let's assume we use the original folder files for now, but if zip, we'll need to figure it out.
            // Wait, if it's a ZIP, we uploaded 1 file. We can't use `URL.createObjectURL` for the images inside.
            // Let's add an endpoint to serve the images from temp_dir.
            
            framesData = await Promise.all(data.results.map(async (frameRes) => {
                const img = new Image();
                const file = originalFiles.find(f => f.name === frameRes.filename || f.name.endsWith('/' + frameRes.filename));
                if (file) {
                    img.src = URL.createObjectURL(file);
                }
                
                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = () => {
                        console.error(`Failed to load image: ${frameRes.filename}`);
                        resolve(); // Resolve anyway so it doesn't hang the whole app
                    };
                });
                
                // Initialize visibility
                frameRes.keypoints.forEach(kp => {
                    // YOLOv8 returns confidence (float between 0 and 1) in 'v'.
                    // COCO visibility: 0=Hidden, 1=Occluded, 2=Visible.
                    if (kp.v !== 0 && kp.v !== 1 && kp.v !== 2) {
                        kp.v = kp.v > 0 ? 2 : 0; // If YOLO gave confidence > 0, assume visible
                    }
                });
                
                return {
                    filename: frameRes.filename,
                    keypoints: frameRes.keypoints,
                    img: img
                };
            }));
            
            loadingState.classList.add('hidden');
            workspaceDiv.classList.remove('hidden');
            
            resizeCanvas();
            window.addEventListener('resize', resizeCanvas);
            
            currentFrameIdx = 0;
            drawFrame();
            
        } catch (err) {
            alert("Error loading results: " + err.message);
        }
    }
    
    function resizeCanvas() {
        const container = canvas.parentElement;
        canvas.width = container.clientWidth;
        canvas.height = window.innerHeight * 0.65; 
        drawFrame();
    }
    
    function renderSidebar() {
        keypointListUl.innerHTML = '';
        if (framesData.length === 0) return;
        const frame = framesData[currentFrameIdx];
        
        frame.keypoints.forEach((kp, i) => {
            const li = document.createElement('li');
            li.style.display = 'flex';
            li.style.justifyContent = 'flex-start';
            li.style.alignItems = 'center';
            li.style.gap = '6px';
            li.style.width = '100%';
            li.style.boxSizing = 'border-box';
            li.style.cursor = 'pointer';
            
            const nameSpan = document.createElement('span');
            const name = i < COCO_KEYPOINT_NAMES.length ? COCO_KEYPOINT_NAMES[i] : `KP ${i}`;
            nameSpan.textContent = `${i}: ${name}`;
            
            // Style nameSpan as a separate pill
            nameSpan.style.padding = '5px 10px';
            nameSpan.style.fontSize = '0.75rem';
            nameSpan.style.background = 'rgba(255,255,255,0.05)';
            nameSpan.style.borderRadius = '20px';
            nameSpan.style.border = '1px solid rgba(255,255,255,0.1)';
            nameSpan.style.whiteSpace = 'nowrap';
            nameSpan.style.width = '125px';
            nameSpan.style.flexShrink = '0';
            nameSpan.style.boxSizing = 'border-box';
            nameSpan.style.transition = 'all 0.2s';
            
            // Highlight if selected or dragging
            if (selectedPoints.has(i)) {
                nameSpan.style.background = 'rgba(59, 130, 246, 0.4)'; // blue tint
                nameSpan.style.borderColor = 'rgba(59, 130, 246, 0.8)';
                nameSpan.style.boxShadow = '0 0 6px rgba(59, 130, 246, 0.5)';
            } else if (i === dragPointIdx) {
                nameSpan.style.background = 'rgba(239, 68, 68, 0.4)'; // red tint for dragging
                nameSpan.style.borderColor = 'rgba(239, 68, 68, 0.8)';
            }
            
            const visBadge = document.createElement('span');
            visBadge.style.fontSize = '0.75rem';
            visBadge.style.padding = '5px 8px';
            visBadge.style.borderRadius = '20px';
            visBadge.style.width = '70px';
            visBadge.style.textAlign = 'center';
            visBadge.style.flexShrink = '0';
            visBadge.style.whiteSpace = 'nowrap';
            visBadge.style.boxSizing = 'border-box';
            visBadge.style.transition = 'all 0.2s';
            
            if (kp.v === 2 || kp.v === undefined) {
                visBadge.textContent = 'Visible';
                visBadge.style.background = 'rgba(16, 185, 129, 0.3)';
                visBadge.style.color = '#10b981';
                visBadge.style.border = '1px solid rgba(16, 185, 129, 0.4)';
            } else if (kp.v === 1) {
                visBadge.textContent = 'Occluded';
                visBadge.style.background = 'rgba(245, 158, 11, 0.3)';
                visBadge.style.color = '#f59e0b';
                visBadge.style.border = '1px solid rgba(245, 158, 11, 0.4)';
            } else {
                visBadge.textContent = 'Hidden';
                visBadge.style.background = 'rgba(239, 68, 68, 0.3)';
                visBadge.style.color = '#ef4444';
                visBadge.style.border = '1px solid rgba(239, 68, 68, 0.4)';
                nameSpan.style.opacity = '0.5';
            }
            
            li.appendChild(nameSpan);
            li.appendChild(visBadge);
            
            // Toggle visibility on click
            li.addEventListener('click', () => {
                saveHistory();
                if (kp.v === 2 || kp.v === undefined) kp.v = 1;
                else if (kp.v === 1) kp.v = 0;
                else kp.v = 2;
                drawFrame();
            });
            
            keypointListUl.appendChild(li);
        });
    }
    
    function drawFrame() {
        if (framesData.length === 0) return;
        
        const frame = framesData[currentFrameIdx];
        frameIndicator.textContent = `Frame ${currentFrameIdx + 1} / ${framesData.length}`;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!frame.img) return;
        
        const scale = Math.min(canvas.width / frame.img.width, canvas.height / frame.img.height);
        const offsetX = (canvas.width - frame.img.width * scale) / 2;
        const offsetY = (canvas.height - frame.img.height * scale) / 2;
        
        canvas._scale = scale;
        canvas._offsetX = offsetX;
        canvas._offsetY = offsetY;
        
        ctx.drawImage(frame.img, offsetX, offsetY, frame.img.width * scale, frame.img.height * scale);
        
        frame.keypoints.forEach((kp, i) => {
            if (kp.v === 0 && !selectedPoints.has(i)) return; // Do not draw hidden points unless selected
            
            const cx = (kp.x * scale) + offsetX;
            const cy = (kp.y * scale) + offsetY;
            
            ctx.beginPath();
            ctx.arc(cx, cy, pointRadius, 0, Math.PI * 2);
            
            if (i === dragPointIdx) {
                ctx.fillStyle = '#ff0000'; // red when dragging
            } else if (kp.v === 1) {
                ctx.fillStyle = 'rgba(245, 158, 11, 0.7)'; // orange/semi-transparent for occluded
            } else if (kp.v === 0) {
                ctx.fillStyle = 'rgba(239, 68, 68, 0.4)'; // transparent red for hidden selected points
            } else {
                ctx.fillStyle = '#00ff00'; // green for visible
            }
            
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#000000';
            ctx.stroke();
            
            // Draw selection outer ring
            if (selectedPoints.has(i)) {
                ctx.beginPath();
                ctx.arc(cx, cy, pointRadius + 4, 0, Math.PI * 2);
                ctx.strokeStyle = '#3b82f6';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
            
            ctx.fillStyle = 'white';
            ctx.font = '10px Arial';
            ctx.fillText(i, cx + 8, cy + 8);
        });
        
        // Draw marquee selection rectangle
        if (isSelecting && selectionRect) {
            ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 4]);
            ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
            const rx = Math.min(selectionRect.startX, selectionRect.endX);
            const ry = Math.min(selectionRect.startY, selectionRect.endY);
            const rw = Math.abs(selectionRect.endX - selectionRect.startX);
            const rh = Math.abs(selectionRect.endY - selectionRect.startY);
            ctx.fillRect(rx, ry, rw, rh);
            ctx.strokeRect(rx, ry, rw, rh);
            ctx.setLineDash([]);
        }
        
        renderSidebar();
    }
    
    let lastMouseOrigX = 0;
    let lastMouseOrigY = 0;

    canvas.addEventListener('mousedown', (e) => {
        if (framesData.length === 0) return;
        const frame = framesData[currentFrameIdx];
        
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        
        const origX = (mx - canvas._offsetX) / canvas._scale;
        const origY = (my - canvas._offsetY) / canvas._scale;
        
        lastMouseOrigX = origX;
        lastMouseOrigY = origY;
        
        dragPointIdx = -1;
        // Check if user clicked directly on a keypoint (visible, or hidden if it's already selected)
        for (let i = 0; i < frame.keypoints.length; i++) {
            const kp = frame.keypoints[i];
            if (kp.v === 0 && !selectedPoints.has(i)) continue;
            
            const cx = (kp.x * canvas._scale) + canvas._offsetX;
            const cy = (kp.y * canvas._scale) + canvas._offsetY;
            
            const dist = Math.hypot(mx - cx, my - cy);
            if (dist <= pointRadius * 2) {
                saveHistory();
                dragPointIdx = i;
                isDragging = true;
                
                // If Shift is held, toggle selected state
                if (e.shiftKey) {
                    if (selectedPoints.has(i)) {
                        selectedPoints.delete(i);
                    } else {
                        selectedPoints.add(i);
                    }
                } else {
                    // If not holding shift and the clicked point is not in current selection, select only this point
                    if (!selectedPoints.has(i)) {
                        selectedPoints.clear();
                        selectedPoints.add(i);
                    }
                }
                updateSelectionUI();
                drawFrame();
                break;
            }
        }
        
        // If not standing on a keypoint (a "file"), drag marquee selection box
        if (dragPointIdx === -1) {
            isSelecting = true;
            selectionRect = { startX: mx, startY: my, endX: mx, endY: my };
            if (!e.shiftKey) {
                selectedPoints.clear();
                updateSelectionUI();
            }
            drawFrame();
        }
    });
    
    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        
        const origX = (mx - canvas._offsetX) / canvas._scale;
        const origY = (my - canvas._offsetY) / canvas._scale;
        
        const frame = framesData[currentFrameIdx];
        
        if (isDragging && dragPointIdx !== -1) {
            const dx = origX - lastMouseOrigX;
            const dy = origY - lastMouseOrigY;
            
            // If dragging a point that is part of the selection, drag the entire selection together
            if (selectedPoints.has(dragPointIdx)) {
                selectedPoints.forEach(idx => {
                    frame.keypoints[idx].x += dx;
                    frame.keypoints[idx].y += dy;
                });
            } else {
                // Else, move only the dragged point
                frame.keypoints[dragPointIdx].x = origX;
                frame.keypoints[dragPointIdx].y = origY;
            }
            
            lastMouseOrigX = origX;
            lastMouseOrigY = origY;
            drawFrame();
        } else if (isSelecting && selectionRect) {
            selectionRect.endX = mx;
            selectionRect.endY = my;
            drawFrame();
        }
    });
    
    window.addEventListener('mouseup', (e) => {
        if (isSelecting && selectionRect) {
            isSelecting = false;
            const frame = framesData[currentFrameIdx];
            if (frame && frame.keypoints) {
                const x1 = Math.min(selectionRect.startX, selectionRect.endX);
                const x2 = Math.max(selectionRect.startX, selectionRect.endX);
                const y1 = Math.min(selectionRect.startY, selectionRect.endY);
                const y2 = Math.max(selectionRect.startY, selectionRect.endY);
                
                frame.keypoints.forEach((kp, i) => {
                    const cx = (kp.x * canvas._scale) + canvas._offsetX;
                    const cy = (kp.y * canvas._scale) + canvas._offsetY;
                    
                    if (cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2) {
                        selectedPoints.add(i);
                    }
                });
            }
            selectionRect = null;
            updateSelectionUI();
            drawFrame();
        }
        
        isDragging = false;
        if (dragPointIdx !== -1) {
            dragPointIdx = -1;
            drawFrame();
        }
    });
    
    btnPrev.addEventListener('click', () => {
        if (currentFrameIdx > 0) {
            currentFrameIdx--;
            selectedPoints.clear();
            updateSelectionUI();
            drawFrame();
        }
    });
    
    btnNext.addEventListener('click', () => {
        if (currentFrameIdx < framesData.length - 1) {
            currentFrameIdx++;
            selectedPoints.clear();
            updateSelectionUI();
            drawFrame();
        }
    });
    
    function copyFromPrevious() {
        if (currentFrameIdx > 0 && framesData.length > 0) {
            saveHistory();
            const prevKpts = framesData[currentFrameIdx - 1].keypoints;
            // Deep copy keypoints
            framesData[currentFrameIdx].keypoints = prevKpts.map(kp => ({ x: kp.x, y: kp.y, v: kp.v }));
            selectedPoints.clear();
            updateSelectionUI();
            drawFrame();
        }
    }

    if (btnCopyPrev) {
        btnCopyPrev.addEventListener('click', copyFromPrevious);
    }
    
    // Global Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
        // Only trigger if Tool 2 is active
        if (!document.getElementById('tool-2').classList.contains('active')) return;
        
        // Disable shortcuts if typing in inputs/editable content
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
            return;
        }
        
        // Ctrl+Z to undo
        if (e.ctrlKey && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            undo();
        }
        
        // Ctrl+K to copy from previous
        if (e.ctrlKey && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            copyFromPrevious();
        }
        
        // Escape to clear selection
        if (e.key === 'Escape') {
            if (selectedPoints.size > 0) {
                selectedPoints.clear();
                updateSelectionUI();
                drawFrame();
            }
        }
    });
    
    function saveHistory() {
        if (framesData.length === 0) return;
        const currentKpts = framesData[currentFrameIdx].keypoints.map(kp => ({ x: kp.x, y: kp.y, v: kp.v }));
        undoStack.push({
            frameIdx: currentFrameIdx,
            keypoints: currentKpts
        });
        if (undoStack.length > 50) undoStack.shift(); // keep last 50 actions
    }
    
    function undo() {
        if (undoStack.length === 0) return;
        const lastState = undoStack.pop();
        if (lastState.frameIdx !== currentFrameIdx) {
            currentFrameIdx = lastState.frameIdx;
        }
        framesData[currentFrameIdx].keypoints = lastState.keypoints.map(kp => ({ x: kp.x, y: kp.y, v: kp.v }));
        drawFrame();
    }
    
    // Export Training Dataset (ZIP)
    btnExportTraining.addEventListener('click', () => {
        if (framesData.length === 0 || !currentJobId) return;

        const payload = {};
        framesData.forEach(frame => {
            const width = frame.img ? frame.img.width : 1;
            const height = frame.img ? frame.img.height : 1;
            payload[frame.filename] = {
                width: width,
                height: height,
                keypoints: frame.keypoints
            };
        });

        exportMsg.textContent = "Generating COCO Training ZIP dataset...";
        exportMsg.className = "message success";
        exportMsg.classList.remove('hidden');
        btnExportTraining.disabled = true;

        fetch(`/export_training_dataset/${currentJobId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        })
        .then(async res => {
            if (!res.ok) {
                const text = await res.text();
                throw new Error(text);
            }
            return res.blob();
        })
        .then(blob => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `ground_truth_training_dataset.zip`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            
            exportMsg.textContent = "Downloaded Training Dataset (ZIP)!";
            setTimeout(() => exportMsg.classList.add('hidden'), 5000);
        })
        .catch(err => {
            exportMsg.textContent = "Export error: " + err.message;
            exportMsg.className = "message error";
        })
        .finally(() => {
            btnExportTraining.disabled = false;
        });
    });

    // Export Evaluation Dataset (ZIP)
    btnExportEvaluation.addEventListener('click', () => {
        if (framesData.length === 0 || !currentJobId) return;

        const payload = {};
        framesData.forEach(frame => {
            const width = frame.img ? frame.img.width : 1;
            const height = frame.img ? frame.img.height : 1;
            payload[frame.filename] = {
                width: width,
                height: height,
                keypoints: frame.keypoints
            };
        });

        exportMsg.textContent = "Generating Evaluation ZIP dataset...";
        exportMsg.className = "message success";
        exportMsg.classList.remove('hidden');
        btnExportEvaluation.disabled = true;

        fetch(`/export_evaluation_dataset/${currentJobId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        })
        .then(async res => {
            if (!res.ok) {
                const text = await res.text();
                throw new Error(text);
            }
            return res.blob();
        })
        .then(blob => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `ground_truth_evaluation_dataset.zip`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            
            exportMsg.textContent = "Downloaded Evaluation Dataset (ZIP)!";
            setTimeout(() => exportMsg.classList.add('hidden'), 5000);
        })
        .catch(err => {
            exportMsg.textContent = "Export error: " + err.message;
            exportMsg.className = "message error";
        })
        .finally(() => {
            btnExportEvaluation.disabled = false;
        });
    });

    // Drag & Drop for Folder Upload
    const dropZone2 = document.getElementById('tool2-drop-zone');
    const folderStatus2 = document.getElementById('tool2-folder-status');

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

    if (dropZone2) {
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone2.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone2.classList.add('dragover');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone2.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone2.classList.remove('dragover');
            }, false);
        });

        dropZone2.addEventListener('drop', async (e) => {
            const items = Array.from(e.dataTransfer.items);
            const files = await getFilesFromItems(items);
            const imageFiles = files.filter(f => f.type.startsWith('image/'));
            if (imageFiles.length > 0) {
                if (folderStatus2) {
                    folderStatus2.textContent = `Selected dropped folder with ${imageFiles.length} images`;
                }
                handleFileSelection(imageFiles);
            } else {
                if (folderStatus2) {
                    folderStatus2.textContent = "No images found in dropped folder.";
                }
            }
        });
    }

    // Generate (Re-run model on existing frames)
    // Generate (Re-run model on existing frames)
    function reLoadResults(jobId) {
        loadResults(jobId, selectedFolderFiles);
    }

    function pollReRunStatus(jobId) {
        const interval = setInterval(() => {
            fetch(`/status/${jobId}`)
                .then(res => res.json())
                .then(data => {
                    if (data.status === 'error') {
                        clearInterval(interval);
                        throw new Error(data.error);
                    }
                    
                    const progress = data.progress || 0;
                    progressFill.style.width = `${progress}%`;
                    progressText.textContent = `${progress}%`;
                    
                    if (data.status === 'completed') {
                        clearInterval(interval);
                        processingText.textContent = 'Preparing workspace...';
                        reLoadResults(jobId);
                    }
                })
                .catch(err => {
                    clearInterval(interval);
                    alert("Error checking status: " + err.message);
                    loadingState.classList.add('hidden');
                });
        }, 500);
    }

    if (btnTool2GenerateAnnotations) {
        btnTool2GenerateAnnotations.addEventListener('click', () => {
            if (selectedFolderFiles.length === 0) {
                alert("Please select or drop a folder containing images first.");
                return;
            }
            
            loadingState.classList.remove('hidden');
            progressFill.style.width = '0%';
            progressText.textContent = '0%';
            processingText.textContent = `Uploading frames and running model ${modelSelect.value}...`;
            
            const formData = new FormData();
            selectedFolderFiles.forEach(file => {
                formData.append('files', file);
            });
            if (modelSelect && modelSelect.value) {
                formData.append('model_name', modelSelect.value);
            }
            formData.append('run_model', 'true');
            
            fetch('/detect_poses', {
                method: 'POST',
                body: formData
            })
            .then(async res => {
                if (!res.ok) throw new Error(await res.text());
                const { job_id } = await res.json();
                currentJobId = job_id;
                pollReRunStatus(job_id);
            })
            .catch(err => {
                alert("Error running model: " + err.message);
                loadingState.classList.add('hidden');
            });
        });
    }

    // Download Annotated Images (ZIP)
    if (btnExportAnnotatedImages) {
        btnExportAnnotatedImages.addEventListener('click', () => {
            if (framesData.length === 0 || !currentJobId) return;

            const payload = {};
            framesData.forEach(frame => {
                const width = frame.img ? frame.img.width : 1;
                const height = frame.img ? frame.img.height : 1;
                payload[frame.filename] = {
                    width: width,
                    height: height,
                    keypoints: frame.keypoints
                };
            });

            exportMsg.textContent = "Generating annotated images ZIP...";
            exportMsg.className = "message success";
            exportMsg.classList.remove('hidden');
            btnExportAnnotatedImages.disabled = true;

            fetch(`/export_annotated_images/${currentJobId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            })
            .then(async res => {
                if (!res.ok) {
                    const text = await res.text();
                    throw new Error(text);
                }
                return res.blob();
            })
            .then(blob => {
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = `annotated_images.zip`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                
                exportMsg.textContent = "Downloaded Annotated Images (ZIP)!";
                setTimeout(() => exportMsg.classList.add('hidden'), 5000);
            })
            .catch(err => {
                exportMsg.textContent = "Export error: " + err.message;
                exportMsg.className = "message error";
            })
            .finally(() => {
                btnExportAnnotatedImages.disabled = false;
            });
        });
    }
});
