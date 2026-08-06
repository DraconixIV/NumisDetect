// Configuration Globale de l'Application
let state = {
  settings: {
    mistralKey: '',
    numistaKey: ''
  },
  images: {
    obverse: { file: null, rotation: 0, enhanced: false, base64: '' },
    reverse: { file: null, rotation: 0, enhanced: false, base64: '' }
  },
  physical: {
    metal: 'Non identifié',
    weight: 0,
    diameter: 0,
    axis: '12h'
  },
  aiResults: null,
  candidates: [],
  selectedCandidate: null
};

// ----------------------------------------------------
// INITIALISATION DE L'APPLICATION
// ----------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initSettings();
  initUploads();
  initPhysicalInputs();
  initAxisSelector();
  initHistory();
  restoreDebugPersist();

  // Événement d'Analyse Visuelle
  document.getElementById('btn-run-analysis').addEventListener('click', runAiAnalysis);

  // Événement d'Inversion Avers/Revers manuelle
  document.getElementById('btn-swap-images').addEventListener('click', swapUploadedImages);

  // Événement de Recherche Match
  document.getElementById('btn-trigger-match').addEventListener('click', runMatchSearch);

  // Bouton Confirmer Sauvegarde dans la modale
  document.getElementById('btn-confirm-save').addEventListener('click', confirmSaveCoin);

  // Événement pour la case de verrouillage debug
  const chkPersist = document.getElementById('chk-persist-debug');
  if (chkPersist) {
    chkPersist.addEventListener('change', () => {
      saveDebugPersist();
    });
  }

  // Gestion des Fermetures Modales
  document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('save-modal').classList.add('hidden');
    });
  });
});

// Helper pour formater les requêtes HTTP
async function apiCall(url, method = 'GET', body = null) {
  const options = {
    method,
    headers: {}
  };
  
  if (body) {
    if (body instanceof FormData) {
      options.body = body;
    } else {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
  }

  const response = await fetch(url, options);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Erreur serveur : ${response.status}`);
  }
  return response.json();
}

// ----------------------------------------------------
// GESTION DES CONFIGURATIONS / PARAMÈTRES
// ----------------------------------------------------
const settingsPanel = document.getElementById('settings-panel');
const btnShowSettings = document.getElementById('btn-show-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');

btnShowSettings.addEventListener('click', () => {
  settingsPanel.classList.toggle('hidden');
});

btnCloseSettings.addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
});

// Toggle visibility of passwords/keys
document.querySelectorAll('.btn-toggle-pwd').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const input = btn.previousElementSibling;
    const icon = btn.querySelector('i');
    if (input.type === 'password') {
      input.type = 'text';
      icon.className = 'fa-solid fa-eye-slash';
    } else {
      input.type = 'password';
      icon.className = 'fa-solid fa-eye';
    }
  });
});

async function initSettings() {
  try {
    const mistralSetting = await apiCall('/api/settings/mistral_key');
    const numistaSetting = await apiCall('/api/settings/numista_key');
    const geminiSetting = await apiCall('/api/settings/google_key');
    const modelSetting = await apiCall('/api/settings/selected_model');
    
    state.settings.mistralKey = mistralSetting.value || '';
    state.settings.numistaKey = numistaSetting.value || '';
    state.settings.geminiKey = geminiSetting.value || '';
    state.settings.selectedModel = modelSetting.value || 'pixtral';
    
    document.getElementById('input-mistral-key').value = state.settings.mistralKey;
    document.getElementById('input-numista-key').value = state.settings.numistaKey;
    document.getElementById('input-gemini-key').value = state.settings.geminiKey;
    document.getElementById('select-ai-model').value = state.settings.selectedModel;
  } catch (err) {
    console.error('Erreur lors du chargement des configurations:', err);
  }
}

btnSaveSettings.addEventListener('click', async () => {
  const mistralKey = document.getElementById('input-mistral-key').value.trim();
  const numistaKey = document.getElementById('input-numista-key').value.trim();
  const geminiKey = document.getElementById('input-gemini-key').value.trim();
  const selectedModel = document.getElementById('select-ai-model').value;

  try {
    await apiCall('/api/settings', 'POST', { key: 'mistral_key', value: mistralKey });
    await apiCall('/api/settings', 'POST', { key: 'numista_key', value: numistaKey });
    await apiCall('/api/settings', 'POST', { key: 'google_key', value: geminiKey });
    await apiCall('/api/settings', 'POST', { key: 'selected_model', value: selectedModel });
    
    state.settings.mistralKey = mistralKey;
    state.settings.numistaKey = numistaKey;
    state.settings.geminiKey = geminiKey;
    state.settings.selectedModel = selectedModel;
    
    showNotification('Paramètres sauvegardés !', 'success');
    settingsPanel.classList.add('hidden');
    checkAnalysisAvailability();
  } catch (err) {
    showNotification('Erreur de sauvegarde des paramètres', 'error');
    console.error(err);
  }
});

// ----------------------------------------------------
// ZONE D'UPLOAD ET TRAITEMENTS D'IMAGES
// ----------------------------------------------------
function initUploads() {
  ['obverse', 'reverse'].forEach(face => {
    const zone = document.getElementById(`zone-${face}`);
    const input = document.getElementById(`file-${face}`);
    const previewContainer = zone.querySelector('.preview-container');
    const imgPreview = document.getElementById(`img-preview-${face}`);

    // Clic sur la zone d'upload
    zone.addEventListener('click', (e) => {
      // Ignorer si le clic provient des contrôles de l'image
      if (e.target.closest('.img-controls') || e.target.closest('.file-input')) return;
      input.click();
    });

    // Drag and Drop
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.style.borderColor = 'var(--color-gold)';
    });

    zone.addEventListener('dragleave', () => {
      zone.style.borderColor = 'var(--border-glass)';
    });

    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.style.borderColor = 'var(--border-glass)';
      if (e.dataTransfer.files.length > 0) {
        handleFileSelect(face, e.dataTransfer.files[0]);
      }
    });

    // Input file change
    input.addEventListener('change', () => {
      if (input.files.length > 0) {
        handleFileSelect(face, input.files[0]);
      }
    });

    // Contrôles de l'image (Rotation & Contraste)
    const btnRotate = zone.querySelector('.btn-rotate');
    const btnFilter = zone.querySelector('.btn-filter');

    btnRotate.addEventListener('click', (e) => {
      e.stopPropagation();
      state.images[face].rotation = (state.images[face].rotation + 90) % 360;
      updateImageStyle(face);
    });

    btnFilter.addEventListener('click', (e) => {
      e.stopPropagation();
      state.images[face].enhanced = !state.images[face].enhanced;
      previewContainer.classList.toggle('enhanced', state.images[face].enhanced);
      btnFilter.style.color = state.images[face].enhanced ? 'var(--color-gold)' : '#fff';
    });
  });
}

function handleFileSelect(face, file) {
  if (!file.type.startsWith('image/')) {
    showNotification('Veuillez insérer une image valide.', 'error');
    return;
  }

  state.images[face].file = file;
  state.images[face].rotation = 0;
  state.images[face].enhanced = false;

  const reader = new FileReader();
  reader.onload = (e) => {
    const tempImg = new Image();
    tempImg.onload = () => {
      const maxDim = 600;
      let width = tempImg.width;
      let height = tempImg.height;
      
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(tempImg, 0, 0, width, height);
      
      const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
      
      state.images[face].base64 = compressedDataUrl;
      const imgPreview = document.getElementById(`img-preview-${face}`);
      imgPreview.src = compressedDataUrl;
      
      const zone = document.getElementById(`zone-${face}`);
      const previewContainer = zone.querySelector('.preview-container');
      previewContainer.classList.remove('hidden');
      previewContainer.classList.remove('enhanced');
      
      const btnFilter = zone.querySelector('.btn-filter');
      btnFilter.style.color = '#fff';
      
      updateImageStyle(face);
      checkAnalysisAvailability();
    };
    tempImg.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function updateImageStyle(face) {
  const imgPreview = document.getElementById(`img-preview-${face}`);
  imgPreview.style.transform = `rotate(${state.images[face].rotation}deg)`;
}

function checkAnalysisAvailability() {
  const btn = document.getElementById('btn-run-analysis');
  const hasImages = (state.images.obverse.file || state.images.obverse.base64) && (state.images.reverse.file || state.images.reverse.base64);
  btn.disabled = !hasImages;
  saveDebugPersist();
}

// ----------------------------------------------------
// CARACTÉRISTIQUES PHYSIQUES & ROUE D'AXE
// ----------------------------------------------------
function initPhysicalInputs() {
  // Segmented control pour les métaux
  const metalButtons = document.querySelectorAll('#metal-control .segment-btn');
  metalButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      metalButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.physical.metal = btn.getAttribute('data-value');
      saveDebugPersist();
    });
  });

  // Inputs numériques
  document.getElementById('input-weight').addEventListener('input', (e) => {
    state.physical.weight = parseFloat(e.target.value) || 0;
    saveDebugPersist();
  });

  document.getElementById('input-diameter').addEventListener('input', (e) => {
    state.physical.diameter = parseFloat(e.target.value) || 0;
    saveDebugPersist();
  });
}

function initAxisSelector() {
  const wheel = document.getElementById('axis-wheel');
  const needle = document.getElementById('axis-needle');
  const display = document.getElementById('axis-display-val');

  wheel.addEventListener('click', (e) => {
    const rect = wheel.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const mouseX = e.clientX;
    const mouseY = e.clientY;

    // Calcul de l'angle en degrés
    let radians = Math.atan2(mouseY - centerY, mouseX - centerX);
    let degrees = radians * (180 / Math.PI);
    
    // Décalage pour aligner 0° avec le haut (12h)
    let adjustedDegrees = (degrees + 90 + 360) % 360;
    
    // Conversion en heures (1h = 30°)
    let hour = Math.round(adjustedDegrees / 30);
    if (hour === 0) hour = 12;
    if (hour > 12) hour = 12;

    // Repositionner l'aiguille précisément sur l'heure (multiple de 30°)
    const targetAngle = hour * 30;
    needle.style.transform = `rotate(${targetAngle}deg)`;
    display.textContent = `${hour}h`;
    state.physical.axis = `${hour}h`;
    saveDebugPersist();
  });
}

// ----------------------------------------------------
// PIPELINE D'ANALYSE IA (GEMINI)
// ----------------------------------------------------
// Fonction pour prétraiter et exporter une image avec rotation/filtres sous forme de Blob
function processImageToBlob(face) {
  return new Promise((resolve) => {
    const img = document.getElementById(`img-preview-${face}`);
    const rotation = state.images[face].rotation;
    const enhanced = state.images[face].enhanced;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Charger l'image dans une balise Image HTML pour récupérer les dimensions originales
    const tempImg = new Image();
    tempImg.onload = () => {
      // Limiter la taille maximale de l'image (max 1000px) pour alléger l'envoi réseau (évite le Bad Gateway sur les gros fichiers)
      const MAX_SIZE = 1000;
      let width = tempImg.naturalWidth;
      let height = tempImg.naturalHeight;

      if (width > MAX_SIZE || height > MAX_SIZE) {
        if (width > height) {
          height = Math.round((height * MAX_SIZE) / width);
          width = MAX_SIZE;
        } else {
          width = Math.round((width * MAX_SIZE) / height);
          height = MAX_SIZE;
        }
      }

      // Dimensions de destination du canvas (inverser si rotation à 90 ou 270)
      if (rotation === 90 || rotation === 270) {
        canvas.width = height;
        canvas.height = width;
      } else {
        canvas.width = width;
        canvas.height = height;
      }

      // Appliquer les translations et rotations
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      
      // Appliquer le filtre de contraste si activé
      if (enhanced) {
        ctx.filter = 'contrast(1.4) brightness(1.1) saturate(1.2)';
      }

      // Dessiner l'image centrée et redimensionnée
      ctx.drawImage(tempImg, -width / 2, -height / 2, width, height);

      // Exporter en Blob jpeg léger
      canvas.toBlob((blob) => {
        resolve(blob);
      }, 'image/jpeg', 0.85);
    };
    tempImg.src = img.src;
  });
}

async function runAiAnalysis() {
  const loader = document.getElementById('analysis-loader');
  const aiCard = document.getElementById('ai-results-card');
  const matchCard = document.getElementById('matching-results-card');

  // Affichage du loader
  loader.classList.remove('hidden');
  aiCard.classList.add('hidden');
  matchCard.classList.add('hidden');
  
  // Désactiver le bouton d'analyse
  const btnAnalysis = document.getElementById('btn-run-analysis');
  btnAnalysis.disabled = true;

  try {
    // 1. Traitement des images
    const obverseBlob = await processImageToBlob('obverse');
    const reverseBlob = await processImageToBlob('reverse');

    // 2. Préparation du FormData
    const formData = new FormData();
    formData.append('obverse', obverseBlob, 'obverse.jpg');
    formData.append('reverse', reverseBlob, 'reverse.jpg');
    formData.append('weight', state.physical.weight);
    formData.append('diameter', state.physical.diameter);
    formData.append('metal', state.physical.metal);
    formData.append('axis', state.physical.axis || '12h');

    // 3. Appel de l'API d'analyse visuelle
    const result = await apiCall('/api/analyze', 'POST', formData);
    state.aiResults = result;

    // Si l'IA a détecté une inversion, on permute également l'affichage et l'état en local
    if (result.swapRequired === true || result.swapRequired === 'true') {
      console.log("Permutation Avers/Revers automatique déclenchée par l'analyse IA...");
      const tempObv = { ...state.images.obverse };
      state.images.obverse = { ...state.images.reverse };
      state.images.reverse = tempObv;
      
      // Mettre à jour les visualisations d'images
      ['obverse', 'reverse'].forEach(face => {
        const zone = document.getElementById(`zone-${face}`);
        const previewContainer = zone.querySelector('.preview-container');
        const imgPreview = document.getElementById(`img-preview-${face}`);
        const btnFilter = zone.querySelector('.btn-filter');
        const data = state.images[face];

        if (data.base64) {
          imgPreview.src = data.base64;
          previewContainer.classList.remove('hidden');
          previewContainer.classList.toggle('enhanced', data.enhanced);
          btnFilter.style.color = data.enhanced ? 'var(--color-gold)' : '#fff';
          updateImageStyle(face);
        } else {
          imgPreview.src = '';
          previewContainer.classList.add('hidden');
          previewContainer.classList.remove('enhanced');
          btnFilter.style.color = '#fff';
        }
      });
      showNotification('Avers/Revers automatiquement permutés pour correspondre à la réalité !', 'info');
    }

    // 4. Remplissage des champs de validation
    document.getElementById('ai-legend-obverse').value = result.legendObverse || '';
    document.getElementById('ai-legend-reverse').value = result.legendReverse || '';
    
    let iconValue = '';
    if (result.iconography) {
      if (typeof result.iconography === 'object') {
        iconValue = Object.entries(result.iconography)
          .map(([key, val]) => `${key}: ${val}`)
          .join('\n');
      } else {
        iconValue = result.iconography;
      }
    }
    document.getElementById('ai-iconography').value = iconValue;
    document.getElementById('ai-period').value = result.estimatedPeriod || '';

    // Afficher la carte d'indices IA
    loader.classList.add('hidden');
    aiCard.classList.remove('hidden');
  } catch (err) {
    loader.classList.add('hidden');
    showNotification(err.message || "Erreur lors de l'analyse visuelle", 'error');
    console.error(err);
  } finally {
    btnAnalysis.disabled = false;
  }
}

// ----------------------------------------------------
// RECHERCHE DANS LE CATALOGUE ET SCORING
// ----------------------------------------------------
async function runMatchSearch() {
  const btnTriggerMatch = document.getElementById('btn-trigger-match');
  btnTriggerMatch.disabled = true;
  
  // Lire les critères éventuellement mis à jour par l'utilisateur
  const searchCriteria = {
    metal: state.physical.metal,
    weight: state.physical.weight,
    diameter: state.physical.diameter,
    axis: state.physical.axis,
    legendObverse: document.getElementById('ai-legend-obverse').value.trim(),
    legendReverse: document.getElementById('ai-legend-reverse').value.trim(),
    iconography: document.getElementById('ai-iconography').value.trim(),
    period: document.getElementById('ai-period').value.trim(),
    suggestedTerms: state.aiResults?.suggestedSearchTerms || [],
    directIdentification: state.aiResults?.directIdentification || null,
    doubleCheckCandidates: state.aiResults?.doubleCheckCandidates || null
  };

  const resultsCard = document.getElementById('matching-results-card');
  const candidatesList = document.getElementById('candidates-list');
  candidatesList.innerHTML = '<div class="loading-candidates"><i class="fa-solid fa-spinner fa-spin"></i> Recherche des correspondances en ligne...</div>';
  resultsCard.classList.remove('hidden');

  try {
    const response = await apiCall('/api/identify', 'POST', searchCriteria);
    state.candidates = response.candidates || [];
    
    renderCandidates();
  } catch (err) {
    candidatesList.innerHTML = `<div class="error-candidates"><i class="fa-solid fa-triangle-exclamation"></i> Une erreur est survenue : ${err.message}</div>`;
    console.error(err);
  } finally {
    btnTriggerMatch.disabled = false;
  }
}

function renderCandidates() {
  const candidatesList = document.getElementById('candidates-list');
  const resultsCount = document.getElementById('results-count');
  candidatesList.innerHTML = '';

  if (state.candidates.length === 0) {
    resultsCount.textContent = 'Aucune correspondance';
    candidatesList.innerHTML = `
      <div class="no-results-box">
        <i class="fa-solid fa-face-frown"></i>
        <p>Aucun spécimen correspondant n'a été identifié dans le catalogue de référence.</p>
        <small>Essayez de simplifier ou de corriger les légendes détectées dans l'étape 3.</small>
      </div>
    `;
    return;
  }

  resultsCount.textContent = `${state.candidates.length} correspondance${state.candidates.length > 1 ? 's' : ''}`;

  let alternativesContainer = null;
  if (state.candidates.length > 1) {
    alternativesContainer = document.createElement('div');
    alternativesContainer.id = 'alternatives-container';
    alternativesContainer.className = 'hidden';
    alternativesContainer.style.transition = 'all 0.3s ease';
  }

  state.candidates.forEach((cand, index) => {
    const scoreClass = cand.matchScore >= 80 ? 'high-match' : '';
    const isBestMatch = index === 0;
    const bestMatchClass = isBestMatch ? 'best-match' : '';
    
    // Comparaisons physiques pour le style CSS (match/mismatch)
    const wDiff = Math.abs(cand.referenceWeight - state.physical.weight);
    const weightMatch = state.physical.weight > 0 ? (wDiff <= cand.referenceWeight * 0.2 ? 'match' : 'mismatch') : '';
    
    const dDiff = Math.abs(cand.referenceDiameter - state.physical.diameter);
    const diameterMatch = state.physical.diameter > 0 ? (dDiff <= cand.referenceDiameter * 0.15 ? 'match' : 'mismatch') : '';

    const card = document.createElement('div');
    card.className = `candidate-card ${scoreClass} ${bestMatchClass}`;
    
    // Liens de double-check direct
    const searchQuery = encodeURIComponent(cand.title);
    const numistaSearchUrl = `https://fr.numista.com/catalogue/index.php?r=${searchQuery}`;
    const cgbSearchUrl = `https://www.cgb.fr/boutique_recherche.html?q=${searchQuery}`;

    let obverseSrc = '';
    let reverseSrc = '';

    if (cand.imageObverse && cand.imageObverse.length > 0 && !cand.imageObverse.includes('no-photo.png')) {
      obverseSrc = cand.imageObverse;
    }
    if (cand.imageReverse && cand.imageReverse.length > 0 && !cand.imageReverse.includes('no-photo.png')) {
      reverseSrc = cand.imageReverse;
    }

    const hasObv = obverseSrc.length > 0;
    const hasRev = reverseSrc.length > 0;

    let imagesHtml = '';
    if (!hasObv && !hasRev) {
      imagesHtml = `
        <div style="display: flex; gap: 4px; flex-shrink: 0;">
          <div class="no-ref-photo-box" style="width: 134px; height: 65px; border-radius: 8px; border: 1px dashed rgba(255,255,255,0.1); background: rgba(0,0,0,0.15); display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 4px; color: var(--color-text-muted);">
            <i class="fa-solid fa-image-slash" style="font-size: 1.1rem; margin-bottom: 2px; color: rgba(255,255,255,0.25);"></i>
            <span style="font-size: 0.65rem; line-height: 1.1; font-weight: 500;">Pas de photo de référence</span>
          </div>
        </div>
      `;
    } else if (cand.source === 'CGB') {
      // Pour CGB, l'image contient généralement les deux faces. On l'affiche en large (134px)
      imagesHtml = `
        <div style="display: flex; gap: 4px; flex-shrink: 0;">
          <div class="candidate-img" style="width: 134px; height: 65px; background: rgba(0,0,0,0.2); border-radius: 8px;" title="Monnaie de référence CGB">
            <img src="${obverseSrc}" referrerpolicy="no-referrer" alt="Réf CGB" style="object-fit: contain; width: 100%; height: 100%;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div class="coin-placeholder" style="display: none; width: 100%; height: 100%; align-items: center; justify-content: center; font-size: 1.5rem; color: rgba(212, 175, 55, 0.3);"><i class="fa-solid fa-coins"></i></div>
          </div>
        </div>
      `;
    } else {
      imagesHtml = `
        <div style="display: flex; gap: 4px; flex-shrink: 0;">
          <div class="candidate-img" style="width: 65px; height: 65px;" title="Avers de référence">
            ${hasObv ? `
              <img src="${obverseSrc}" referrerpolicy="no-referrer" alt="Avers Ref" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
              <div class="coin-placeholder" style="display: none; width: 100%; height: 100%; align-items: center; justify-content: center; font-size: 1.5rem; color: rgba(212, 175, 55, 0.3);"><i class="fa-solid fa-coins"></i></div>
            ` : `
              <div class="coin-placeholder" style="display: flex; width: 100%; height: 100%; align-items: center; justify-content: center; font-size: 1.5rem; color: rgba(212, 175, 55, 0.3);"><i class="fa-solid fa-coins"></i></div>
            `}
          </div>
          <div class="candidate-img" style="width: 65px; height: 65px;" title="Revers de référence">
            ${hasRev ? `
              <img src="${reverseSrc}" referrerpolicy="no-referrer" alt="Revers Ref" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
              <div class="coin-placeholder" style="display: none; width: 100%; height: 100%; align-items: center; justify-content: center; font-size: 1.5rem; color: rgba(212, 175, 55, 0.3);"><i class="fa-solid fa-coins"></i></div>
            ` : `
              <div class="coin-placeholder" style="display: flex; width: 100%; height: 100%; align-items: center; justify-content: center; font-size: 1.5rem; color: rgba(212, 175, 55, 0.3);"><i class="fa-solid fa-coins"></i></div>
            `}
          </div>
        </div>
      `;
    }

    card.innerHTML = `
      ${imagesHtml}
      <div class="candidate-details">
        <div style="width: 100%;">
          <div class="candidate-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; flex-wrap: wrap; gap: 6px; width: 100%;">
            ${isBestMatch ? `
              <div class="best-match-tag" style="margin-bottom: 0;">
                <i class="fa-solid fa-trophy"></i> Meilleure Correspondance
              </div>
            ` : '<div></div>'}
            <span class="score-badge" style="position: static;">${cand.matchScore}% Match</span>
          </div>
          <h3 class="candidate-title">${cand.title}</h3>
          <div class="candidate-subtitle">${cand.issuer || 'Émetteur inconnu'} (${cand.year || 'Date inconnue'})</div>
          
          <div class="candidate-specs">
            <span class="spec-item">
              <span class="label">Métal:</span>${cand.metal}
            </span>
            <span class="spec-item ${weightMatch}">
              <span class="label">Poids Ref:</span>${cand.referenceWeight ? cand.referenceWeight.toFixed(2) + 'g' : 'N/C'}
            </span>
            <span class="spec-item ${diameterMatch}">
              <span class="label">Ø Ref:</span>${cand.referenceDiameter ? cand.referenceDiameter + 'mm' : 'N/C'}
            </span>
            ${cand.referenceAxis ? `
              <span class="spec-item">
                <span class="label">Axe Ref:</span>${cand.referenceAxis}
              </span>
            ` : ''}
          </div>
          
          <div class="candidate-desc">${cand.description || 'Pas de description disponible.'}</div>
        </div>
        
        <div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px;">
            <button class="btn btn-accent btn-save-candidate" data-index="${index}" style="padding: 6px 12px; font-size: 0.8rem;">
              <i class="fa-solid fa-bookmark"></i> Valider & Enregistrer
            </button>
            ${cand.referenceUrl ? `
              <a href="${cand.referenceUrl}" target="_blank" class="btn btn-secondary" style="font-size: 0.8rem; padding: 6px 12px;">
                Fiche officielle <i class="fa-solid fa-arrow-up-right-from-square"></i>
              </a>
            ` : ''}
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button class="btn btn-secondary btn-double-check" data-index="${index}" style="font-size: 0.8rem; padding: 6px 12px; border-color: rgba(212, 175, 55, 0.4); color: var(--color-gold);">
              <i class="fa-solid fa-wand-magic-sparkles"></i> Lancer le Double-Check Visuel
            </button>
          </div>
          
          <div id="double-check-panel-${index}" class="double-check-panel hidden" style="margin-top: 12px; padding: 12px; background: rgba(255, 255, 255, 0.02); border-radius: 8px; border: 1px dashed rgba(212, 175, 55, 0.2); width: 100%; box-sizing: border-box;">
          </div>
        </div>
      </div>
    `;

    if (isBestMatch) {
      candidatesList.appendChild(card);
    } else if (alternativesContainer) {
      alternativesContainer.appendChild(card);
    }

    if (isBestMatch && state.candidates.length > 1) {
      const divider = document.createElement('div');
      divider.className = 'section-divider-title';
      divider.style.cursor = 'pointer';
      divider.style.userSelect = 'none';
      divider.style.display = 'flex';
      divider.style.justifyContent = 'space-between';
      divider.style.alignItems = 'center';
      divider.style.padding = '10px 14px';
      divider.style.background = 'rgba(255, 255, 255, 0.01)';
      divider.style.borderRadius = '6px';
      divider.style.border = '1px solid rgba(255, 255, 255, 0.05)';
      divider.style.marginTop = '20px';
      divider.style.transition = 'all 0.3s ease';

      divider.innerHTML = `
        <span><i class="fa-solid fa-list-check"></i> Alternatives et comparatifs</span>
        <i class="fa-solid fa-chevron-down toggle-icon" style="transition: transform 0.3s ease; transform: rotate(-90deg);"></i>
      `;
      candidatesList.appendChild(divider);

      divider.addEventListener('mouseenter', () => {
        divider.style.borderColor = 'rgba(212, 175, 55, 0.3)';
        divider.style.color = 'var(--color-gold)';
      });
      divider.addEventListener('mouseleave', () => {
        divider.style.borderColor = 'rgba(255, 255, 255, 0.05)';
        divider.style.color = '';
      });

      divider.addEventListener('click', () => {
        const collapsed = alternativesContainer.classList.toggle('hidden');
        const icon = divider.querySelector('.toggle-icon');
        if (collapsed) {
          icon.style.transform = 'rotate(-90deg)';
          divider.style.background = 'rgba(255, 255, 255, 0.01)';
        } else {
          icon.style.transform = 'rotate(0deg)';
          divider.style.background = 'rgba(255, 255, 255, 0.03)';
        }
      });
    }
  });

  if (alternativesContainer) {
    candidatesList.appendChild(alternativesContainer);
  }

  // Associer l'événement de sauvegarde
  document.querySelectorAll('.btn-save-candidate').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(btn.getAttribute('data-index'));
      openSaveModal(state.candidates[idx]);
    });
  });

  // Associer l'événement de double-check visuel
  document.querySelectorAll('.btn-double-check').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const idx = parseInt(btn.getAttribute('data-index'));
      const cand = state.candidates[idx];
      const panel = document.getElementById(`double-check-panel-${idx}`);
      
      panel.classList.remove('hidden');
      panel.innerHTML = `
        <div style="font-size: 0.8rem; color: rgba(255,255,255,0.7); display: flex; align-items: center; gap: 8px; padding: 4px 0;">
          <i class="fa-solid fa-spinner fa-spin" style="color: var(--color-gold);"></i> 
          <span>Analyse comparative approfondie des clichés d'internet par l'IA...</span>
        </div>
      `;
      btn.disabled = true;

      try {
        const payload = {
          title: cand.title,
          obverseImage: state.aiResults.obverseFilename,
          reverseImage: state.aiResults.reverseFilename,
          refImageObverse: cand.imageObverse,
          refImageReverse: cand.imageReverse
        };

        const result = await apiCall('/api/double-check', 'POST', payload);
        
        // Mettre à jour le score du candidat localement et dans l'UI
        cand.matchScore = result.confidenceScore;
        const scoreBadge = btn.closest('.candidate-card').querySelector('.match-score');
        if (scoreBadge) {
          scoreBadge.textContent = `${result.confidenceScore}%`;
          scoreBadge.className = `match-score ${result.confidenceScore >= 80 ? 'high' : 'medium'}`;
        }

        panel.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
            <span style="background: rgba(46, 204, 113, 0.15); color: #2ecc71; font-weight: bold; font-size: 0.8rem; padding: 4px 8px; border-radius: 4px; border: 1px solid rgba(46, 204, 113, 0.3);">
              🏆 Double-Check Visuel : ${result.confidenceScore}% de correspondance
            </span>
          </div>
          <div style="font-size: 0.8rem; line-height: 1.4; color: rgba(255, 255, 255, 0.9);">
            <p style="margin-bottom: 8px; font-style: italic; color: rgba(255,255,255,0.7);">${result.verdict}</p>
            
            ${result.pointsOfAgreement && result.pointsOfAgreement.length > 0 ? `
              <div style="margin-top: 8px;">
                <strong style="color: #2ecc71;"><i class="fa-solid fa-circle-check"></i> Points de concordance :</strong>
                <ul style="margin: 4px 0 8px 16px; padding: 0; list-style-type: disc; color: rgba(255,255,255,0.85);">
                  ${result.pointsOfAgreement.map(p => `<li>${p}</li>`).join('')}
                </ul>
              </div>
            ` : ''}

            ${result.pointsOfDisagreement && result.pointsOfDisagreement.length > 0 ? `
              <div style="margin-top: 8px;">
                <strong style="color: #e74c3c;"><i class="fa-solid fa-triangle-exclamation"></i> Points de divergence / usure :</strong>
                <ul style="margin: 4px 0 8px 16px; padding: 0; list-style-type: disc; color: rgba(255,255,255,0.85);">
                  ${result.pointsOfDisagreement.map(p => `<li>${p}</li>`).join('')}
                </ul>
              </div>
            ` : ''}

            <div style="margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap;">
              <a href="${result.numistaSearchUrl}" target="_blank" class="btn btn-secondary" style="font-size: 0.75rem; padding: 4px 8px; border-color: rgba(212, 175, 55, 0.4); color: var(--color-gold); background: transparent;">
                <i class="fa-solid fa-magnifying-glass"></i> Comparer sur Numista
              </a>
              <a href="${result.cgbSearchUrl}" target="_blank" class="btn btn-secondary" style="font-size: 0.75rem; padding: 4px 8px; border-color: rgba(255, 255, 255, 0.1); background: transparent;">
                <i class="fa-solid fa-magnifying-glass"></i> Comparer sur CGB.fr
              </a>
            </div>
          </div>
        `;
        
        btn.innerHTML = `<i class="fa-solid fa-circle-check"></i> Double-Check effectué (${result.confidenceScore}%)`;
        btn.style.borderColor = 'rgba(46, 204, 113, 0.4)';
        btn.style.color = '#2ecc71';
        btn.disabled = false;
        
      } catch (err) {
        panel.innerHTML = `
          <div style="font-size: 0.8rem; color: #e74c3c;">
            <i class="fa-solid fa-triangle-exclamation"></i> Échec du double-check visuel : ${err.message}
          </div>
        `;
        btn.disabled = false;
      }
    });
  });
}

// ----------------------------------------------------
// ENREGISTREMENT ET BOUCLE D'APPRENTISSAGE
// ----------------------------------------------------
// ----------------------------------------------------
// ENREGISTREMENT ET BOUCLE D'APPRENTISSAGE
// ----------------------------------------------------
function openSaveModal(candidate) {
  state.selectedCandidate = candidate;
  document.getElementById('save-coin-title').value = candidate.title || '';
  document.getElementById('save-coin-issuer').value = candidate.issuer || '';
  document.getElementById('save-coin-year').value = candidate.year || '';
  document.getElementById('save-coin-ref-url').value = candidate.referenceUrl || '';
  
  document.getElementById('save-user-notes').value = '';
  document.getElementById('save-modal').classList.remove('hidden');
}

async function confirmSaveCoin() {
  const title = document.getElementById('save-coin-title').value.trim();
  const issuer = document.getElementById('save-coin-issuer').value.trim();
  const year = document.getElementById('save-coin-year').value.trim();
  const refUrl = document.getElementById('save-coin-ref-url').value.trim();
  const notes = document.getElementById('save-user-notes').value.trim();

  if (!title) {
    showNotification('Le titre de la monnaie est obligatoire.', 'error');
    return;
  }

  const btn = document.getElementById('btn-confirm-save');
  btn.disabled = true;

  try {
    // Exporter les images traitées de l'avers et du revers
    const obverseBlob = await processImageToBlob('obverse');
    const reverseBlob = await processImageToBlob('reverse');

    const formData = new FormData();
    formData.append('obverse', obverseBlob, 'obverse.jpg');
    formData.append('reverse', reverseBlob, 'reverse.jpg');
    
    // Données d'identification
    formData.append('weight', state.physical.weight);
    formData.append('diameter', state.physical.diameter);
    formData.append('axis', state.physical.axis);
    formData.append('metal', state.physical.metal);
    formData.append('legendObverse', document.getElementById('ai-legend-obverse') ? document.getElementById('ai-legend-obverse').value.trim() : '');
    formData.append('legendReverse', document.getElementById('ai-legend-reverse') ? document.getElementById('ai-legend-reverse').value.trim() : '');
    formData.append('iconography', document.getElementById('ai-iconography') ? document.getElementById('ai-iconography').value.trim() : '');
    formData.append('notes', notes);
    formData.append('matchedCoinId', state.selectedCandidate?.id || 'manual');
    formData.append('matchedTitle', title);
    formData.append('matchedIssuer', issuer);
    formData.append('matchedYear', year);
    formData.append('matchedRefUrl', refUrl);
    formData.append('matchedDescription', state.selectedCandidate?.description || 'Enregistrement manuel.');

    await apiCall('/api/save', 'POST', formData);

    showNotification('Identification validée et enregistrée !', 'success');
    document.getElementById('save-modal').classList.add('hidden');
    
    // Réinitialiser l'interface pour le prochain scan
    resetScanner();
    initHistory();
  } catch (err) {
    showNotification("Erreur lors de l'enregistrement", 'error');
    console.error(err);
  } finally {
    btn.disabled = false;
  }
}

function resetScanner() {
  state.images.obverse.file = null;
  state.images.reverse.file = null;
  state.aiResults = null;
  state.candidates = [];
  state.selectedCandidate = null;

  document.getElementById('file-obverse').value = '';
  document.getElementById('file-reverse').value = '';
  document.getElementById('zone-obverse').querySelector('.preview-container').classList.add('hidden');
  document.getElementById('zone-reverse').querySelector('.preview-container').classList.add('hidden');

  document.getElementById('input-weight').value = '';
  document.getElementById('input-diameter').value = '';
  document.getElementById('axis-needle').style.transform = `rotate(0deg)`;
  document.getElementById('axis-display-val').textContent = `12h`;
  state.physical.weight = 0;
  state.physical.diameter = 0;
  state.physical.axis = '12h';

  document.getElementById('ai-results-card').classList.add('hidden');
  document.getElementById('matching-results-card').classList.add('hidden');
  checkAnalysisAvailability();
}

// ----------------------------------------------------
// HISTORIQUE DE COLLECTION
// ----------------------------------------------------
const panelHistory = document.getElementById('history-panel');
const panelIdentification = document.getElementById('identification-panel');
const btnShowHistory = document.getElementById('btn-show-history');
const btnBackToScan = document.getElementById('btn-back-to-scan');

btnShowHistory.addEventListener('click', () => {
  panelIdentification.classList.add('hidden');
  panelHistory.classList.remove('hidden');
});

btnBackToScan.addEventListener('click', () => {
  panelHistory.classList.add('hidden');
  panelIdentification.classList.remove('hidden');
});

async function initHistory() {
  const grid = document.getElementById('collection-grid');
  grid.innerHTML = '<div class="loading-candidates"><i class="fa-solid fa-spinner fa-spin"></i> Chargement de votre collection...</div>';

  try {
    const history = await apiCall('/api/history');
    grid.innerHTML = '';

    if (history.length === 0) {
      grid.innerHTML = `
        <div class="no-results-box" style="grid-column: 1 / -1;">
          <i class="fa-solid fa-folder-open" style="font-size: 3rem; margin-bottom: 12px; color: var(--color-text-muted);"></i>
          <p>Votre collection est encore vide.</p>
          <small>Les monnaies que vous identifierez et validerez apparaîtront ici.</small>
        </div>
      `;
      return;
    }

    history.forEach(item => {
      const card = document.createElement('div');
      card.className = 'collection-card';
      
      card.innerHTML = `
        <div class="coll-img-box">
          <div class="coll-img-half">
            <img src="${item.obverse_image ? (item.obverse_image.startsWith('data:') ? item.obverse_image : '/uploads/' + item.obverse_image) : 'https://en.numista.com/images/no-photo.png'}" alt="Avers">
          </div>
          <div class="coll-img-half">
            <img src="${item.reverse_image ? (item.reverse_image.startsWith('data:') ? item.reverse_image : '/uploads/' + item.reverse_image) : 'https://en.numista.com/images/no-photo.png'}" alt="Revers">
          </div>
          <span class="coll-badge">${item.metal}</span>
        </div>
        <div class="coll-body">
          <h3 class="coll-title">${item.matched_title}</h3>
          <div class="coll-meta">${item.matched_issuer || 'Monnayage inconnu'} • ${item.matched_year || 'Époque indéterminée'}</div>
          
          <div class="coll-specs">
            <span class="coll-spec">Poids: ${item.weight ? item.weight.toFixed(2) + 'g' : 'N/C'}</span>
            <span class="coll-spec">Ø: ${item.diameter ? item.diameter + 'mm' : 'N/C'}</span>
            <span class="coll-spec">Axe: ${item.axis || 'N/C'}</span>
          </div>
          
          ${item.user_notes ? `<div class="coll-notes">"${item.user_notes}"</div>` : ''}
        </div>
        <div class="coll-actions">
          <button class="btn-delete-item" data-id="${item.id}" title="Supprimer de la collection">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      `;

      grid.appendChild(card);
    });

    // Associer l'événement de suppression
    document.querySelectorAll('.btn-delete-item').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        if (confirm('Voulez-vous vraiment retirer cette monnaie de votre collection ?')) {
          try {
            await apiCall(`/api/history/${id}`, 'DELETE');
            showNotification('Monnaie retirée de la collection', 'success');
            initHistory();
          } catch (err) {
            showNotification('Erreur lors de la suppression', 'error');
            console.error(err);
          }
        }
      });
    });

  } catch (err) {
    grid.innerHTML = `<div class="error-candidates" style="grid-column: 1 / -1;"><i class="fa-solid fa-triangle-exclamation"></i> Impossible de charger la collection : ${err.message}</div>`;
    console.error(err);
  }
}

// ----------------------------------------------------
// UTILS & NOTIFICATIONS
// ----------------------------------------------------
function showNotification(message, type = 'success') {
  // Création dynamique de la bulle de notification
  const notif = document.createElement('div');
  notif.className = `toast-notif ${type}`;
  notif.innerHTML = `
    <i class="fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i>
    <span>${message}</span>
  `;
  
  // Style css direct temporaire de la notif
  Object.assign(notif.style, {
    position: 'fixed',
    bottom: '24px',
    left: '50%',
    transform: 'translateX(-50%) translateY(100px)',
    background: type === 'success' ? 'rgba(76, 138, 112, 0.95)' : 'rgba(239, 68, 68, 0.95)',
    color: '#fff',
    border: `1px solid ${type === 'success' ? '#5ca184' : '#ef4444'}`,
    padding: '12px 24px',
    borderRadius: '8px',
    boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    zIndex: 9999,
    fontFamily: 'var(--font-sans)',
    fontWeight: '600',
    fontSize: '0.9rem',
    opacity: 0,
    transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
  });

  document.body.appendChild(notif);
  
  // Animer entrée
  setTimeout(() => {
    notif.style.transform = 'translateX(-50%) translateY(0)';
    notif.style.opacity = 1;
  }, 10);

  // Sortie
  setTimeout(() => {
    notif.style.transform = 'translateX(-50%) translateY(100px)';
    notif.style.opacity = 0;
    setTimeout(() => notif.remove(), 400);
  }, 3500);
}

// ----------------------------------------------------
// PERSISTANCE / VERROUILLAGE DEBUG (LOCALSTORAGE)
// ----------------------------------------------------
function saveDebugPersist() {
  const chk = document.getElementById('chk-persist-debug');
  if (!chk) return;
  
  if (!chk.checked) {
    localStorage.removeItem('debug_persist_enabled');
    localStorage.removeItem('debug_obverse');
    localStorage.removeItem('debug_reverse');
    localStorage.removeItem('debug_weight');
    localStorage.removeItem('debug_diameter');
    localStorage.removeItem('debug_metal');
    localStorage.removeItem('debug_axis');
    return;
  }
  
  localStorage.setItem('debug_persist_enabled', 'true');
  localStorage.setItem('debug_obverse', state.images.obverse.base64 || '');
  localStorage.setItem('debug_reverse', state.images.reverse.base64 || '');
  localStorage.setItem('debug_weight', document.getElementById('input-weight').value || '');
  localStorage.setItem('debug_diameter', document.getElementById('input-diameter').value || '');
  localStorage.setItem('debug_metal', state.physical.metal || 'Non identifié');
  localStorage.setItem('debug_axis', state.physical.axis || '12h');
}

function restoreDebugPersist() {
  const chk = document.getElementById('chk-persist-debug');
  if (!chk) return;
  
  const enabled = localStorage.getItem('debug_persist_enabled') === 'true';
  chk.checked = enabled;
  if (!enabled) return;
  
  const obverse = localStorage.getItem('debug_obverse');
  const reverse = localStorage.getItem('debug_reverse');
  const weightVal = localStorage.getItem('debug_weight');
  const diameterVal = localStorage.getItem('debug_diameter');
  const metalVal = localStorage.getItem('debug_metal');
  const axisVal = localStorage.getItem('debug_axis');
  
  if (obverse) {
    state.images.obverse.base64 = obverse;
    const img = document.getElementById('img-preview-obverse');
    img.src = obverse;
    document.getElementById('zone-obverse').querySelector('.preview-container').classList.remove('hidden');
    document.getElementById('zone-obverse').querySelector('.upload-prompt').classList.add('hidden');
  }
  if (reverse) {
    state.images.reverse.base64 = reverse;
    const img = document.getElementById('img-preview-reverse');
    img.src = reverse;
    document.getElementById('zone-reverse').querySelector('.preview-container').classList.remove('hidden');
    document.getElementById('zone-reverse').querySelector('.upload-prompt').classList.add('hidden');
  }
  
  if (weightVal) {
    document.getElementById('input-weight').value = weightVal;
    state.physical.weight = parseFloat(weightVal) || 0;
  }
  if (diameterVal) {
    document.getElementById('input-diameter').value = diameterVal;
    state.physical.diameter = parseFloat(diameterVal) || 0;
  }
  if (metalVal) {
    state.physical.metal = metalVal;
    document.querySelectorAll('#metal-control .segment-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-value') === metalVal);
    });
  }
  if (axisVal) {
    state.physical.axis = axisVal;
    document.getElementById('axis-display-val').textContent = axisVal;
    const hour = parseInt(axisVal.replace('h', ''));
    const deg = (hour * 30) % 360;
    const needle = document.getElementById('axis-needle');
    if (needle) needle.style.transform = `rotate(${deg}deg)`;
  }
  
  // Forcer l'activation du bouton d'analyse
  const btn = document.getElementById('btn-run-analysis');
  if (btn) btn.disabled = false;
}

function swapUploadedImages() {
  const tempObv = { ...state.images.obverse };
  state.images.obverse = { ...state.images.reverse };
  state.images.reverse = tempObv;

  ['obverse', 'reverse'].forEach(face => {
    const zone = document.getElementById(`zone-${face}`);
    const previewContainer = zone.querySelector('.preview-container');
    const imgPreview = document.getElementById(`img-preview-${face}`);
    const btnFilter = zone.querySelector('.btn-filter');
    const data = state.images[face];

    if (data.base64) {
      imgPreview.src = data.base64;
      previewContainer.classList.remove('hidden');
      previewContainer.classList.toggle('enhanced', data.enhanced);
      btnFilter.style.color = data.enhanced ? 'var(--color-gold)' : '#fff';
      updateImageStyle(face);
    } else {
      imgPreview.src = '';
      previewContainer.classList.add('hidden');
      previewContainer.classList.remove('enhanced');
      btnFilter.style.color = '#fff';
    }
  });

  checkAnalysisAvailability();
  saveDebugPersist();
  showNotification('Avers et Revers inversés !', 'info');
}
