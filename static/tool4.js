document.addEventListener('DOMContentLoaded', () => {
    const imagesInput = document.getElementById('tool4-images-input');
    const imagesStatus = document.getElementById('tool4-images-status');
    const startEvalBtn = document.getElementById('btn-start-evaluation');
    
    let selectedZip = null;
    let currentResults = [];
    let currentImageIndex = 0;

    // Load available models
    fetch('/models')
        .then(res => res.json())
        .then(data => {
            const selectA = document.getElementById('tool4-model-a-select');
            const selectB = document.getElementById('tool4-model-b-select');
            selectA.innerHTML = '';
            selectB.innerHTML = '';
            data.models.forEach(model => {
                const optA = document.createElement('option');
                optA.value = model;
                optA.textContent = model;
                optA.style.color = "black";
                selectA.appendChild(optA);
                
                const optB = document.createElement('option');
                optB.value = model;
                optB.textContent = model;
                optB.style.color = "black";
                selectB.appendChild(optB);
            });
        })
        .catch(err => console.error("Error loading models:", err));

    imagesInput.addEventListener('change', (e) => {
        const files = e.target.files;
        if (files.length > 0 && files[0].name.toLowerCase().endswith('.zip')) {
            selectedZip = files[0];
            imagesStatus.textContent = `Selected dataset: ${selectedZip.name}`;
            startEvalBtn.disabled = false;
        } else {
            imagesStatus.textContent = "Please select a valid .zip dataset.";
            selectedZip = null;
            startEvalBtn.disabled = true;
        }
    });

    startEvalBtn.addEventListener('click', () => {
        const modelA = document.getElementById('tool4-model-a-select').value;
        const modelB = document.getElementById('tool4-model-b-select').value;
        if (!modelA || !modelB) {
            alert("Please select both models.");
            return;
        }
        if (!selectedZip) {
            alert("Please upload a validation dataset zip.");
            return;
        }

        const formData = new FormData();
        formData.append('model_a', modelA);
        formData.append('model_b', modelB);
        formData.append('dataset_zip', selectedZip);

        const loadingState = document.getElementById('tool4-loading');
        const resultsContainer = document.getElementById('tool4-results-container');
        
        loadingState.classList.remove('hidden');
        resultsContainer.classList.add('hidden');
        startEvalBtn.disabled = true;
        
        currentResults = [];
        currentImageIndex = 0;

        fetch('/evaluate', {
            method: 'POST',
            body: formData
        })
        .then(res => res.json())
        .then(data => {
            loadingState.classList.add('hidden');
            startEvalBtn.disabled = false;
            
            if (data.error) throw new Error(data.error);
            
            // Set scores
            document.getElementById('score-model-a-name').textContent = modelA;
            document.getElementById('score-model-a-val').textContent = data.map_a.toFixed(3);
            
            document.getElementById('score-model-b-name').textContent = modelB;
            document.getElementById('score-model-b-val').textContent = data.map_b.toFixed(3);
            
            currentResults = data.images; // Array of { a: base64, b: base64 }
            if (currentResults.length > 0) {
                resultsContainer.classList.remove('hidden');
                showResultImage(0);
            } else {
                alert("No visualization images returned.");
            }
        })
        .catch(err => {
            loadingState.classList.add('hidden');
            startEvalBtn.disabled = false;
            alert(`Error: ${err.message}`);
        });
    });

    function showResultImage(index) {
        if (index < 0 || index >= currentResults.length) return;
        currentImageIndex = index;
        
        const imgA = document.getElementById('eval-image-a');
        const imgB = document.getElementById('eval-image-b');
        const indicator = document.getElementById('eval-indicator');
        
        imgA.src = `data:image/jpeg;base64,${currentResults[index].a}`;
        imgB.src = `data:image/jpeg;base64,${currentResults[index].b}`;
        indicator.textContent = `Image ${index + 1} / ${currentResults.length}`;
    }

    document.getElementById('btn-eval-prev').addEventListener('click', () => {
        if (currentImageIndex > 0) {
            showResultImage(currentImageIndex - 1);
        }
    });

    document.getElementById('btn-eval-next').addEventListener('click', () => {
        if (currentImageIndex < currentResults.length - 1) {
            showResultImage(currentImageIndex + 1);
        }
    });
});
