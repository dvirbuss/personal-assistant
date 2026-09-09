// YouTube Downloader Tool Logic
document.addEventListener('DOMContentLoaded', () => {
    const clipsContainer = document.getElementById('yt-clips-list');
    const btnAddClip = document.getElementById('btn-add-clip');
    const btnDownload = document.getElementById('btn-yt-download');
    const loadingState = document.getElementById('yt-loading');
    const progressFill = document.getElementById('yt-progress-fill');
    const progressText = document.getElementById('yt-progress-text');
    const processingText = document.getElementById('yt-processing-text');
    const resultMessage = document.getElementById('yt-result-message');
    const resultsPanel = document.getElementById('yt-results-panel');
    const btnDownloadZip = document.getElementById('btn-yt-download-zip');
    const btnSendToFrames = document.getElementById('btn-yt-send-to-frames');
    const statZipSize = document.getElementById('yt-stat-zip-size');
    const statClipsCount = document.getElementById('yt-stat-clips-count');
    const resultsClipsList = document.getElementById('yt-results-clips-list');

    let currentJobId = null;

    // Helper: Show notification message
    function showYtMessage(msg, type = 'error') {
        resultMessage.textContent = msg;
        resultMessage.className = `message ${type}`;
        resultMessage.classList.remove('hidden');
        setTimeout(() => {
            resultMessage.classList.add('hidden');
        }, 6000);
    }

    // Helper: Create a clip card
    function createClipCard(data = {}) {
        const card = document.createElement('div');
        card.className = 'yt-clip-card';
        
        card.innerHTML = `
            <div class="yt-clip-header">
                <div class="yt-clip-title">
                    <span class="yt-clip-index-badge">#1</span>
                    <span>Video Clip</span>
                    <span class="yt-clip-badge">YouTube</span>
                </div>
                <div class="yt-clip-actions">
                    <button type="button" class="yt-icon-btn btn-duplicate" title="Duplicate clip settings">
                        📋 Duplicate
                    </button>
                    <button type="button" class="yt-icon-btn danger btn-remove" title="Remove this clip">
                        ✕ Remove
                    </button>
                </div>
            </div>

            <div class="yt-form-grid">
                <div class="yt-field">
                    <label>
                        YouTube URL
                        <span class="hint">e.g., https://www.youtube.com/watch?v=...</span>
                    </label>
                    <input type="text" class="yt-input yt-url" placeholder="https://www.youtube.com/watch?v=..." value="${data.url || ''}">
                </div>

                <div class="yt-meta-preview hidden">
                    <img class="yt-meta-thumb" style="width: 50px; height: 32px; object-fit: cover; border-radius: 4px;" src="" alt="">
                    <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        <span class="yt-meta-title" style="font-weight: 600; color: #f8fafc;"></span>
                        <span class="yt-meta-duration" style="margin-left: 8px; font-size: 0.75rem; color: #94a3b8;"></span>
                    </div>
                </div>

                <div class="yt-time-row">
                    <div class="yt-field">
                        <label>
                            Start Time
                            <span class="hint">00:00 / seconds</span>
                        </label>
                        <input type="text" class="yt-input yt-start" placeholder="00:00:00 (opt)" value="${data.start_time || ''}">
                    </div>

                    <div class="yt-field">
                        <label>
                            End Time
                            <span class="hint">01:30 / seconds</span>
                        </label>
                        <input type="text" class="yt-input yt-end" placeholder="00:01:00 (opt)" value="${data.end_time || ''}">
                    </div>

                    <div class="yt-field">
                        <label>
                            Custom Name
                            <span class="hint">optional filename</span>
                        </label>
                        <input type="text" class="yt-input yt-name" placeholder="clip_name" value="${data.name || ''}">
                    </div>
                </div>
            </div>
        `;

        // Event: Remove
        card.querySelector('.btn-remove').addEventListener('click', () => {
            const allCards = clipsContainer.querySelectorAll('.yt-clip-card');
            if (allCards.length > 1) {
                card.remove();
                updateCardNumbers();
            } else {
                // Clear fields if only 1 card
                card.querySelector('.yt-url').value = '';
                card.querySelector('.yt-start').value = '';
                card.querySelector('.yt-end').value = '';
                card.querySelector('.yt-name').value = '';
                card.querySelector('.yt-meta-preview').classList.add('hidden');
            }
        });

        // Event: Duplicate
        card.querySelector('.btn-duplicate').addEventListener('click', () => {
            const url = card.querySelector('.yt-url').value;
            const start = card.querySelector('.yt-start').value;
            const end = card.querySelector('.yt-end').value;
            const name = card.querySelector('.yt-name').value;
            const dupName = name ? `${name}_clip` : '';
            addClip({ url, start_time: start, end_time: end, name: dupName });
        });

        // Event: URL input blur to fetch metadata preview
        const urlInput = card.querySelector('.yt-url');
        const metaPreview = card.querySelector('.yt-meta-preview');
        const metaThumb = card.querySelector('.yt-meta-thumb');
        const metaTitle = card.querySelector('.yt-meta-title');
        const metaDuration = card.querySelector('.yt-meta-duration');

        urlInput.addEventListener('change', async () => {
            const url = urlInput.value.trim();
            if (url && (url.includes('youtube.com/') || url.includes('youtu.be/'))) {
                try {
                    const res = await fetch('/youtube/info', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url })
                    });
                    if (res.ok) {
                        const info = await res.json();
                        if (info.thumbnail) {
                            metaThumb.src = info.thumbnail;
                            metaThumb.style.display = 'block';
                        } else {
                            metaThumb.style.display = 'none';
                        }
                        metaTitle.textContent = info.title || 'YouTube Video';
                        metaDuration.textContent = info.duration_formatted ? `(${info.duration_formatted})` : '';
                        metaPreview.classList.remove('hidden');

                        // Prepopulate name if empty
                        const nameInput = card.querySelector('.yt-name');
                        if (!nameInput.value.trim() && info.title) {
                            const safe = info.title.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').slice(0, 30);
                            nameInput.value = safe;
                        }
                    }
                } catch (err) {
                    // Non-critical, ignore preview error
                }
            } else {
                metaPreview.classList.add('hidden');
            }
        });

        return card;
    }

    function updateCardNumbers() {
        const cards = clipsContainer.querySelectorAll('.yt-clip-card');
        cards.forEach((c, i) => {
            const badge = c.querySelector('.yt-clip-index-badge');
            if (badge) badge.textContent = `#${i + 1}`;
            const removeBtn = c.querySelector('.btn-remove');
            if (removeBtn) {
                removeBtn.style.visibility = cards.length > 1 ? 'visible' : 'hidden';
            }
        });
    }

    function addClip(data = {}) {
        const card = createClipCard(data);
        clipsContainer.appendChild(card);
        updateCardNumbers();
        // If initial data had url, trigger preview
        if (data.url) {
            const urlInput = card.querySelector('.yt-url');
            urlInput.dispatchEvent(new Event('change'));
        }
        return card;
    }

    // Add initial card
    addClip();

    // Plus button click
    btnAddClip.addEventListener('click', () => {
        addClip();
    });

    // Start download process
    btnDownload.addEventListener('click', async () => {
        const cards = clipsContainer.querySelectorAll('.yt-clip-card');
        const items = [];

        cards.forEach(card => {
            const url = card.querySelector('.yt-url').value.trim();
            const startTime = card.querySelector('.yt-start').value.trim();
            const endTime = card.querySelector('.yt-end').value.trim();
            const name = card.querySelector('.yt-name').value.trim();

            if (url) {
                items.push({
                    url: url,
                    start_time: startTime || null,
                    end_time: endTime || null,
                    name: name || null
                });
            }
        });

        if (items.length === 0) {
            showYtMessage('Please enter at least one valid YouTube URL.', 'error');
            return;
        }

        // Start processing
        btnDownload.disabled = true;
        loadingState.classList.remove('hidden');
        resultsPanel.classList.add('hidden');
        resultMessage.classList.add('hidden');

        progressFill.style.width = '0%';
        progressText.textContent = '0%';
        processingText.textContent = 'Connecting to YouTube downloader...';

        try {
            const res = await fetch('/youtube/download_clips', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items })
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({ detail: 'Failed to start download.' }));
                throw new Error(errData.detail || 'Download request failed.');
            }

            const data = await res.json();
            currentJobId = data.job_id;
            pollYtStatus(currentJobId);
        } catch (err) {
            btnDownload.disabled = false;
            loadingState.classList.add('hidden');
            showYtMessage(err.message, 'error');
        }
    });

    function pollYtStatus(jobId) {
        const interval = setInterval(async () => {
            try {
                const res = await fetch(`/status/${jobId}`);
                if (!res.ok) return;

                const data = await res.json();

                if (data.status === 'error') {
                    clearInterval(interval);
                    btnDownload.disabled = false;
                    loadingState.classList.add('hidden');
                    showYtMessage(data.error || 'An error occurred during download.', 'error');
                    return;
                }

                const progress = data.progress || 0;
                progressFill.style.width = `${progress}%`;
                progressText.textContent = `${progress}%`;

                if (data.status_msg) {
                    processingText.textContent = data.status_msg;
                }

                if (data.status === 'completed') {
                    clearInterval(interval);
                    btnDownload.disabled = false;
                    loadingState.classList.add('hidden');
                    showResults(data.results);
                }
            } catch (err) {
                console.error('Polling error:', err);
            }
        }, 1000);
    }

    function showResults(results) {
        resultsPanel.classList.remove('hidden');
        
        const count = results ? results.total_clips : 0;
        const sizeMb = results ? results.zip_size_mb : 0;
        
        statClipsCount.textContent = `${count} video${count === 1 ? '' : 's'}`;
        statZipSize.textContent = `${sizeMb} MB`;

        resultsClipsList.innerHTML = '';
        if (results && results.clips) {
            results.clips.forEach(c => {
                const row = document.createElement('div');
                row.className = 'yt-result-clip-item';
                row.innerHTML = `
                    <span style="font-weight: 500; color: #f1f5f9;">📹 ${c.name}</span>
                    <span style="color: var(--text-muted); font-size: 0.8rem;">${c.size_mb} MB</span>
                `;
                resultsClipsList.appendChild(row);
            });
        }

        // Setup download ZIP button
        btnDownloadZip.onclick = () => {
            if (currentJobId) {
                window.location.href = `/youtube/download/${currentJobId}`;
            }
        };

        // Setup send to video frames tool button
        btnSendToFrames.onclick = () => {
            const frameTabBtn = document.querySelector('.tool-btn[data-tool="video-processor"]');
            if (frameTabBtn) {
                frameTabBtn.click();
            }
        };
    }
});
