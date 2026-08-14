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
    const btnExportCoco = document.getElementById('btn-export-coco');
    const btnExportGt = document.getElementById('btn-export-gt');
    const btnCopyPrev = document.getElementById('btn-copy-prev');
    const frameIndicator = document.getElementById('frame-indicator');
    const modelSelect = document.getElementById('tool2-model-select');
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
    
    // Canvas dragging state
    let isDragging = false;
    let dragPointIdx = -1;
    const pointRadius = 6;
    
    function handleFileSelection(files) {
        if (files.length === 0) return;
        
        loadingState.classList.remove('hidden');
        progressFill.style.width = '0%';
        progressText.textContent = '0%';
        processingText.textContent = 'Uploading frames...';
        
        // Prepare FormData
        const formData = new FormData();
        files.forEach(file => {
            formData.append('files', file);
        });
        if (modelSelect && modelSelect.value) {
            formData.append('model_name', modelSelect.value);
        }
        
        fetch('/detect_poses', {
            method: 'POST',
            body: formData
        }).then(async uploadRes => {
            if (!uploadRes.ok) throw new Error(await uploadRes.text());
            
            const { job_id } = await uploadRes.json();
            currentJobId = job_id;
            const chosenModel = modelSelect ? modelSelect.value : 'YOLOv8';
            processingText.textContent = `Running model ${chosenModel}...`;
            pollTool2Status(job_id, files);
        }).catch(err => {
            console.error(err);
            alert("Error starting detection: " + err.message);
            loadingState.classList.add('hidden');
        });
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
            li.style.padding = '8px 12px';
            li.style.background = 'rgba(255,255,255,0.05)';
            li.style.borderRadius = '6px';
            li.style.cursor = 'pointer';
            li.style.display = 'flex';
            li.style.justifyContent = 'space-between';
            li.style.alignItems = 'center';
            li.style.transition = 'background 0.2s';
            
            // Highlight if dragging
            if (i === dragPointIdx) {
                li.style.background = 'rgba(59, 130, 246, 0.4)'; // blue tint
            }
            
            const nameSpan = document.createElement('span');
            const name = i < COCO_KEYPOINT_NAMES.length ? COCO_KEYPOINT_NAMES[i] : `KP ${i}`;
            nameSpan.textContent = `${i}: ${name}`;
            
            const visBadge = document.createElement('span');
            visBadge.style.fontSize = '0.75rem';
            visBadge.style.padding = '2px 6px';
            visBadge.style.borderRadius = '4px';
            
            if (kp.v === 2 || kp.v === undefined) {
                visBadge.textContent = 'Visible';
                visBadge.style.background = 'rgba(16, 185, 129, 0.3)';
                visBadge.style.color = '#10b981';
            } else if (kp.v === 1) {
                visBadge.textContent = 'Occluded';
                visBadge.style.background = 'rgba(245, 158, 11, 0.3)';
                visBadge.style.color = '#f59e0b';
            } else {
                visBadge.textContent = 'Hidden';
                visBadge.style.background = 'rgba(239, 68, 68, 0.3)';
                visBadge.style.color = '#ef4444';
                li.style.opacity = '0.5';
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
            if (kp.v === 0) return; // Do not draw hidden points
            
            const cx = (kp.x * scale) + offsetX;
            const cy = (kp.y * scale) + offsetY;
            
            ctx.beginPath();
            ctx.arc(cx, cy, pointRadius, 0, Math.PI * 2);
            
            if (i === dragPointIdx) {
                ctx.fillStyle = '#ff0000'; // red when dragging
            } else if (kp.v === 1) {
                ctx.fillStyle = 'rgba(245, 158, 11, 0.7)'; // orange/semi-transparent for occluded
            } else {
                ctx.fillStyle = '#00ff00'; // green for visible
            }
            
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#000000';
            ctx.stroke();
            
            ctx.fillStyle = 'white';
            ctx.font = '10px Arial';
            ctx.fillText(i, cx + 8, cy + 8);
        });
        
        renderSidebar();
    }
    
    let isDraggingSkeleton = false;
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
        
        dragPointIdx = -1;
        for (let i = 0; i < frame.keypoints.length; i++) {
            const kp = frame.keypoints[i];
            if (kp.v === 0) continue; // Skip hidden points
            
            const cx = (kp.x * canvas._scale) + canvas._offsetX;
            const cy = (kp.y * canvas._scale) + canvas._offsetY;
            
            const dist = Math.hypot(mx - cx, my - cy);
            if (dist <= pointRadius * 2) {
                saveHistory();
                dragPointIdx = i;
                isDragging = true;
                drawFrame();
                break;
            }
        }
        
        if (dragPointIdx === -1 && frame.keypoints.length > 0) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            frame.keypoints.forEach(kp => {
                if (kp.v === 0) return;
                if (kp.x < minX) minX = kp.x;
                if (kp.y < minY) minY = kp.y;
                if (kp.x > maxX) maxX = kp.x;
                if (kp.y > maxY) maxY = kp.y;
            });
            
            const padding = 20 / canvas._scale;
            if (origX >= minX - padding && origX <= maxX + padding &&
                origY >= minY - padding && origY <= maxY + padding) {
                saveHistory();
                isDraggingSkeleton = true;
                lastMouseOrigX = origX;
                lastMouseOrigY = origY;
            }
        }
    });
    
    canvas.addEventListener('mousemove', (e) => {
        if (!isDragging && !isDraggingSkeleton) return;
        
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        
        const origX = (mx - canvas._offsetX) / canvas._scale;
        const origY = (my - canvas._offsetY) / canvas._scale;
        
        const frame = framesData[currentFrameIdx];
        
        if (isDragging && dragPointIdx !== -1) {
            frame.keypoints[dragPointIdx].x = origX;
            frame.keypoints[dragPointIdx].y = origY;
            drawFrame();
        } else if (isDraggingSkeleton) {
            const dx = origX - lastMouseOrigX;
            const dy = origY - lastMouseOrigY;
            
            frame.keypoints.forEach(kp => {
                kp.x += dx;
                kp.y += dy;
            });
            
            lastMouseOrigX = origX;
            lastMouseOrigY = origY;
            drawFrame();
        }
    });
    
    window.addEventListener('mouseup', () => {
        isDragging = false;
        isDraggingSkeleton = false;
        if (dragPointIdx !== -1) {
            dragPointIdx = -1;
            drawFrame();
        }
    });
    
    btnPrev.addEventListener('click', () => {
        if (currentFrameIdx > 0) {
            currentFrameIdx--;
            drawFrame();
        }
    });
    
    btnNext.addEventListener('click', () => {
        if (currentFrameIdx < framesData.length - 1) {
            currentFrameIdx++;
            drawFrame();
        }
    });
    
    function copyFromPrevious() {
        if (currentFrameIdx > 0 && framesData.length > 0) {
            saveHistory();
            const prevKpts = framesData[currentFrameIdx - 1].keypoints;
            // Deep copy keypoints
            framesData[currentFrameIdx].keypoints = prevKpts.map(kp => ({ x: kp.x, y: kp.y, v: kp.v }));
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
    
    // Export COCO JSON
    btnExportCoco.addEventListener('click', () => {
        if (framesData.length === 0) return;
        
        const cocoData = {
            info: { description: "Pose Annotations Export", date_created: new Date().toISOString() },
            images: [],
            annotations: [],
            categories: [{ id: 1, name: "person", supercategory: "person", keypoints: COCO_KEYPOINT_NAMES }]
        };
        
        let annotId = 1;
        framesData.forEach((frame, idx) => {
            const imgId = idx + 1;
            cocoData.images.push({
                id: imgId,
                file_name: frame.filename,
                width: frame.img ? frame.img.width : 0,
                height: frame.img ? frame.img.height : 0
            });
            
            let flattenedKpts = [];
            frame.keypoints.forEach(kp => {
                flattenedKpts.push(kp.x, kp.y, kp.v);
            });
            
            if (flattenedKpts.length > 0) {
                cocoData.annotations.push({
                    id: annotId++,
                    image_id: imgId,
                    category_id: 1,
                    num_keypoints: frame.keypoints.length,
                    keypoints: flattenedKpts
                });
            }
        });
        
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(cocoData, null, 2));
        const a = document.createElement('a');
        a.href = dataStr;
        a.download = `annotations_coco.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });

    // Export YOLO GT (ZIP)
    btnExportGt.addEventListener('click', () => {
        if (framesData.length === 0 || !currentJobId) return;

        // Collect modified annotations
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

        exportMsg.textContent = "Generating YOLO GT dataset...";
        exportMsg.className = "message success";
        exportMsg.classList.remove('hidden');
        btnExportGt.disabled = true;

        fetch(`/export_yolo_gt/${currentJobId}`, {
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
            a.download = `ground_truth_dataset.zip`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            
            exportMsg.textContent = "Downloaded YOLO GT Dataset!";
            setTimeout(() => exportMsg.classList.add('hidden'), 5000);
        })
        .catch(err => {
            exportMsg.textContent = "Export error: " + err.message;
            exportMsg.className = "message error";
        })
        .finally(() => {
            btnExportGt.disabled = false;
        });
    });
});
