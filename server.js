import express from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import db from './database.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration de la base de données
await db.initDb();

// S'assurer que les dossiers nécessaires existent
const isVercel = !!process.env.VERCEL;
const uploadsDir = isVercel ? '/tmp' : path.join(__dirname, 'uploads');
if (!isVercel && !fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Middleware
app.use(express.json());
app.use(express.static(publicDir));
app.use('/uploads', express.static(uploadsDir));

// Configuration de Multer pour stocker les uploads d'images temporaires
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Helper pour récupérer une configuration en base de données
async function getSetting(key) {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

const numistaCache = new Map();

function extractNumistaId(url) {
  if (!url) return null;
  const match = url.match(/pieces(\d+)\.html/);
  if (match) return match[1];
  return null;
}

function findBestMatchingType(types, targetTitle) {
  if (!types || types.length === 0 || !targetTitle) return null;
  
  const cleanTarget = targetTitle.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, " ");
  const targetWords = cleanTarget.split(/\s+/).filter(w => w.length > 0);

  let bestType = null;
  let bestScore = -1;

  for (const type of types) {
    const cleanTypeTitle = type.title.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, " ");
    const typeWords = cleanTypeTitle.split(/\s+/).filter(w => w.length > 0);

    let score = 0;
    for (const word of targetWords) {
      if (typeWords.includes(word)) {
        score += 2;
      } else if (cleanTypeTitle.includes(word)) {
        score += 1;
      }
    }

    const targetNumbers = targetWords.filter(w => !isNaN(w));
    const typeNumbers = typeWords.filter(w => !isNaN(w));
    
    for (const num of targetNumbers) {
      if (!typeNumbers.includes(num)) {
        score -= 5;
      }
    }
    for (const num of typeNumbers) {
      if (!targetNumbers.includes(num)) {
        score -= 5;
      }
    }
    
    // Donner un bonus de score de +5 si le type possède au moins une image de référence (avers ou revers)
    if (type.obverse_thumbnail || type.reverse_thumbnail) {
      score += 5;
    }

    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  }

  return bestScore >= 1 ? bestType : types[0];
}

async function fetchNumistaCoinDetails(coinId, numistaKey) {
  if (!numistaKey || !coinId) return null;
  const cacheKey = `details-${coinId}`;
  if (numistaCache.has(cacheKey)) {
    return numistaCache.get(cacheKey);
  }

  try {
    const url = `https://api.numista.com/v3/types/${coinId}`;
    const res = await fetch(url, {
      headers: {
        'Numista-API-Key': numistaKey,
        'User-Agent': 'NumisDetect App'
      }
    });
    if (res.status === 200) {
      const data = await res.json();
      const details = {
        obverseImage: data.obverse?.picture || '',
        reverseImage: data.reverse?.picture || '',
        weight: data.weight || null,
        diameter: data.diameter || null,
        metal: data.composition?.name || null
      };
      numistaCache.set(cacheKey, details);
      return details;
    }
  } catch (err) {
    console.error(`Erreur récup détails Numista pour ID ${coinId}:`, err);
  }
  return null;
}

async function correctCoinViaNumista(title, numistaKey, defaultWeight, defaultDiameter, defaultMetal) {
  const cacheKey = `search-${title}`;
  if (numistaCache.has(cacheKey)) {
    return numistaCache.get(cacheKey);
  }

  let imageObverse = '';
  let imageReverse = '';
  let refWeight = defaultWeight;
  let refDiameter = defaultDiameter;
  let refMetal = defaultMetal;
  let refUrl = '';

  let refTitle = '';

  if (!numistaKey || !title) {
    return { title: refTitle, imageObverse, imageReverse, refWeight, refDiameter, refMetal, refUrl };
  }

  try {
    const cleanTitle = title
      .replace(/\(.*?\)/g, '')
      .replace(/\b(le bel|le hardi|le long|le fort|de valois|de lusignan)\b/gi, '')
      .replace(/[-\/]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const searchUrl = `https://api.numista.com/v3/types?q=${encodeURIComponent(cleanTitle)}`;
    const res = await fetch(searchUrl, {
      headers: {
        'Numista-API-Key': numistaKey,
        'User-Agent': 'NumisDetect App'
      }
    });

    if (res.status === 200) {
      const data = await res.json();
      if (data.types && data.types.length > 0) {
        // Sélectionner le meilleur match par pertinence de titre
        const bestCoin = findBestMatchingType(data.types, title);
        refTitle = bestCoin.title || '';
        imageObverse = bestCoin.obverse_thumbnail || '';
        imageReverse = bestCoin.reverse_thumbnail || '';
        
        // Charger les caractéristiques physiques complètes via le type détaillé
        const details = await fetchNumistaCoinDetails(bestCoin.id, numistaKey);
        if (details) {
          refTitle = details.title || refTitle;
          imageObverse = details.obverseImage || imageObverse;
          imageReverse = details.reverseImage || imageReverse;
          if (details.weight) refWeight = details.weight;
          if (details.diameter) refDiameter = details.diameter;
          if (details.metal) refMetal = details.metal;
        }
        refUrl = `https://fr.numista.com/catalogue/pieces${bestCoin.id}.html`;
      }
    }
    const result = { title: refTitle, imageObverse, imageReverse, refWeight, refDiameter, refMetal, refUrl };
    numistaCache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.error(`Erreur correction Numista pour titre "${title}":`, err);
  }

  return { title: refTitle, imageObverse, imageReverse, refWeight, refDiameter, refMetal, refUrl };
}

// ----------------------------------------------------
// ROUTES : PARAMÈTRES / CONFIGURATIONS
// ----------------------------------------------------
app.get('/api/settings/:key', async (req, res) => {
  try {
    const value = await getSetting(req.params.key);
    res.json({ key: req.params.key, value: value || '' });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.post('/api/settings', async (req, res) => {
  const { key, value } = req.body;
  try {
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, value]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Route proxy pour contourner le blocage du hotlinking et les règles CORS sur les images de référence Numista
app.get('/api/proxy-image', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) {
      return res.status(400).send("Paramètre url manquant.");
    }

    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://fr.numista.com/'
      }
    });

    if (!response.ok) {
      return res.status(response.status).send("Impossible de charger l'image.");
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache 1 jour
    
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error("Erreur proxy image:", err);
    res.status(500).send("Erreur de proxy.");
  }
});

// ----------------------------------------------------
// ROUTE : ANALYSE VISUELLE PAR IA (GEMINI)
// ----------------------------------------------------
app.post('/api/analyze', upload.fields([{ name: 'obverse', maxCount: 1 }, { name: 'reverse', maxCount: 1 }]), async (req, res) => {
  try {
    const selectedModel = await getSetting('selected_model') || process.env.SELECTED_MODEL || 'pixtral';
    const mistralKey = await getSetting('mistral_key') || process.env.MISTRAL_API_KEY;
    const geminiKey = await getSetting('google_key') || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    
    if (selectedModel === 'gemini') {
      if (!geminiKey) {
        return res.status(400).send("Clé API Google Gemini manquante. Veuillez la renseigner dans les configurations (bouton engrenage en haut à droite).");
      }
    } else {
      if (!mistralKey) {
        return res.status(400).send("Clé API Mistral manquante. Veuillez la renseigner dans les configurations (bouton engrenage en haut à droite).");
      }
    }

    const files = req.files;
    if (!files || !files.obverse || !files.reverse) {
      return res.status(400).send("Les photos de l'avers et du revers sont obligatoires pour l'analyse.");
    }

    const obversePath = files.obverse[0].path;
    const reversePath = files.reverse[0].path;

    const { weight, diameter, metal, axis } = req.body;
    const weightVal = parseFloat(weight) || 0;
    const diameterVal = parseFloat(diameter) || 0;

    // Auto-apprentissage étendu : Récupérer l'historique d'expérience de l'utilisateur
    let learningContext = "";
    try {
      // 1. Les 10 dernières monnaies validées (chronologiques)
      const pastCoins = await db.all("SELECT matched_title, matched_issuer, matched_year, metal, weight, diameter, axis, detected_legend_obverse FROM identified_coins ORDER BY id DESC LIMIT 10");
      
      // 2. Les monnaies de dimensions physiques ou métal similaires déjà validées (RAG local)
      let physicalSimQuery = "SELECT matched_title, matched_issuer, matched_year, metal, weight, diameter, axis FROM identified_coins WHERE 1=1";
      const simParams = [];
      if (weightVal > 0) {
        physicalSimQuery += " AND weight >= ? AND weight <= ?";
        simParams.push(weightVal * 0.75, weightVal * 1.25);
      }
      if (diameterVal > 0) {
        physicalSimQuery += " AND diameter >= ? AND diameter <= ?";
        simParams.push(diameterVal * 0.85, diameterVal * 1.15);
      }
      const hasMetal = metal && metal !== "Non identifié";
      if (hasMetal) {
        physicalSimQuery += " AND metal = ?";
        simParams.push(metal);
      }
      physicalSimQuery += " ORDER BY id DESC LIMIT 5";
      const similarCoins = (weightVal > 0 || diameterVal > 0 || hasMetal) ? await db.all(physicalSimQuery, simParams) : [];

      // 3. Statistiques des préférences de collection (profiling)
      const topIssuers = await db.all("SELECT matched_issuer, COUNT(*) as count FROM identified_coins GROUP BY matched_issuer ORDER BY count DESC LIMIT 3");

      if ((pastCoins && pastCoins.length > 0) || (similarCoins && similarCoins.length > 0) || (topIssuers && topIssuers.length > 0)) {
        learningContext = `\n[BLOC D'AUTO-APPRENTISSAGE ET MACHINE LEARNING LOCAL]
        Tu as développé une expérience en apprenant des validations passées de cet utilisateur. Sers-toi de ces connaissances acquises pour guider ton analyse actuelle :`;
        
        if (topIssuers && topIssuers.length > 0) {
          learningContext += `\n- Profil de la collection : L'utilisateur a une préférence marquée pour les émetteurs ou autorités suivantes : ${topIssuers.map(ti => `${ti.matched_issuer} (${ti.count} validations)`).join(', ')}.`;
        }

        if (similarCoins && similarCoins.length > 0) {
          learningContext += `\n- Précédentes pièces similaires validées (même gabarit physique) :`;
          similarCoins.forEach(sc => {
            learningContext += `\n  * "${sc.matched_title}" (${sc.matched_issuer}, ${sc.matched_year}) [Métal: ${sc.metal}, Poids: ${sc.weight}g, Ø: ${sc.diameter}mm]`;
          });
        }

        if (pastCoins && pastCoins.length > 0) {
          learningContext += `\n- Récemment identifié et validé dans la collection :`;
          pastCoins.forEach(pc => {
            learningContext += `\n  * "${pc.matched_title}" [Légende avers observée: "${pc.detected_legend_obverse || 'N/C'}"]`;
          });
        }
        
        learningContext += `\nUtilise cette expérience acquise pour affiner tes diagnostics actuels et éviter de suggérer des types de monnaies trop éloignés des habitudes et de la spécialisation géographique/historique de cet utilisateur.`;
      }
    } catch (dbErr) {
      console.error("Erreur lors de la récupération de l'historique d'apprentissage:", dbErr);
    }
    
    let physicalInfo = "";
    const hasMetal = metal && metal !== "Non identifié";
    const hasAxis = axis && axis !== "Non spécifié";
    
    if (weightVal > 0 || diameterVal > 0 || hasMetal || hasAxis) {
      physicalInfo = `La monnaie à identifier a les caractéristiques physiques réelles suivantes :
      - Métal observé : ${hasMetal ? metal : 'Non identifié / Inconnu'}
      - Axe / Orientation des coins : ${hasAxis ? axis : 'Non spécifié / Inconnu'}
      ${weightVal > 0 ? `- Poids mesuré : ${weightVal}g` : ''}
      ${diameterVal > 0 ? `- Diamètre mesuré : ${diameterVal}mm` : ''}
      Sers-toi de ces caractéristiques physiques pour éliminer les fausses pistes.`;
    }

    const prompt = `
      Tu es un expert mondial en numismatique ancienne (grecque, romaine, byzantine, médiévale, royale française, féodale, moderne).
      Voici deux photos d'une même monnaie trouvée en détection de métaux (l'une est l'avers, l'autre le revers).
      La patine peut être abîmée, très usée, oxydée ou sombre. Analyse attentivement les moindres reliefs et lettres circulaires.
      
      ${physicalInfo}
      ${learningContext}
      
      CONSIGNES D'ANALYSE EXPERTE ET DE TRANSCRIPTION (OCR) :
      1. Ne cède JAMAIS à la facilité de déclarer les légendes "illisibles" ou "fragmentaires" si des caractères ou des formes géométriques sont visibles sur le pourtour.
      2. Analyse le pourtour de chaque face de manière circulaire. Les lettres médiévales ou romaines suivent la courbure de la pièce.
      3. Utilise tes connaissances encyclopédiques en numismatique pour décoder et extrapoler les lettres usées :
         - Si la pièce présente une croix à l'avers et un château/bâtiment/châtel au revers, c'est le type Tournois ou similaire (féodal ou royal). Cherche la légende d'avers comme '+ PHILIPVS REX', '+ LVD OVICVS REX' ou '+ KAROLVS REX' et de revers comme '+ TVRONVS CIVIS' ou '+ MET ALO'. Si tu reconnais ne serait-ce que 2 ou 3 lettres de ces motifs, reconstitue la titulature complète correspondante.
         - Si la pièce est romaine, cherche les formules classiques comme 'IMP...', 'CAES...', 'AVG', 'PM TR P...', 'COS...', 'PROVIDENTIA...', 'VIRTVS...', 'CONCORDIA...', etc.
      4. Fais l'effort d'une transcription intelligente : propose la titulature la plus rationnelle selon les indices visuels et physiques.
      
      Effectue des recherches internes pour identifier cette monnaie de manière extrêmement fiable.
      
      Rends-moi un objet JSON contenant STRICTEMENT ces clés et aucun autre texte :
      {
        "legendObverse": "Transcris les lettres décodées de l'avers. Remplis au maximum en extrapolant de manière experte (ex: 'PHILIPVS REX')",
        "legendReverse": "Transcris les lettres décodées du revers. Remplis au maximum (ex: 'TVRONVS CIVIS')",
        "iconography": "Description ultra-précise de l'avers (ex: 'Croix pattée au centre') et du revers (ex: 'Châtel tournois classique avec deux tours crenelées et toit pointu')",
        "estimatedPeriod": "L'époque ou l'empire (ex: 'Royale Française - Philippe IV le Bel (1285-1314)')",
        "estimatedMetal": "Devine le métal d'origine (Bronze, Cuivre, Argent, Billon, Or) selon l'aspect et la patine",
        "suggestedSearchTerms": ["Tableau de 3 ou 4 mots clés pertinents pour la recherche de comparaison, ex: ['Denier', 'Tournois', 'Philippe', 'IV']"],
        "directIdentification": {
          "title": "Nom exact de la monnaie (ex: 'Denier Tournois - Philippe IV le Bel')",
          "issuer": "Autorité émettrice (ex: 'Royaume de France')",
          "year": "Année ou plage d'années (ex: '1285-1314')",
          "metal": "Métal (Bronze, Cuivre, Argent, Billon, Or)",
          "referenceWeight": 1.11,
          "referenceDiameter": 18.0,
          "referenceAxis": "12h",
          "description": "Description concise avers/revers",
          "referenceUrl": "Lien URL théorique vers la fiche Numista ou CGB de cette pièce s'il existe (ex: 'https://fr.numista.com/catalogue/pieces28581.html')"
        },
        "doubleCheckCandidates": [
          {
            "title": "Nom de la monnaie similaire pour double-check (ex: 'Double Tournois - Philippe IV le Bel')",
            "issuer": "Émetteur",
            "year": "Année ou période",
            "metal": "Métal",
            "referenceWeight": 1.34,
            "referenceDiameter": 20.0,
            "referenceAxis": "12h",
            "description": "Description succincte montrant les différences ou similitudes",
            "referenceUrl": "Lien URL vers la fiche Numista ou CGB de ce spécimen de comparaison"
          }
        ]
      }
    `;

    let content = "";
    
    if (selectedModel === 'gemini' && geminiKey) {
      console.log("Utilisation de Google Gemini (gemini-1.5-pro) pour l'analyse visuelle...");
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({
        model: "gemini-1.5-pro",
        generationConfig: { responseMimeType: "application/json" }
      });
      
      const obversePart = {
        inlineData: {
          data: Buffer.from(fs.readFileSync(obversePath)).toString("base64"),
          mimeType: "image/jpeg"
        }
      };
      const reversePart = {
        inlineData: {
          data: Buffer.from(fs.readFileSync(reversePath)).toString("base64"),
          mimeType: "image/jpeg"
        }
      };
      
      const result = await model.generateContent([
        prompt,
        obversePart,
        reversePart
      ]);
      content = result.response.text().trim();
    } else {
      console.log("Utilisation de Mistral AI (Pixtral 12B) pour l'analyse visuelle...");
      const obverseBase64 = Buffer.from(fs.readFileSync(obversePath)).toString("base64");
      const reverseBase64 = Buffer.from(fs.readFileSync(reversePath)).toString("base64");

      const payload = {
        model: "pixtral-12b-latest",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: `data:image/jpeg;base64,${obverseBase64}`
              },
              {
                type: "image_url",
                image_url: `data:image/jpeg;base64,${reverseBase64}`
              }
            ]
          }
        ],
        response_format: { type: "json_object" }
      };

      const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${mistralKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Erreur API Mistral: ${response.status} - ${errorText}`);
      }

      const resJson = await response.json();
      content = resJson.choices[0].message.content.trim();
    }

    // Nettoyage si le modèle a enveloppé le JSON dans du markdown
    if (content.startsWith("```")) {
      content = content.replace(/^```json/, "").replace(/```$/, "").trim();
    }

    const aiData = JSON.parse(content);
    aiData.obverseFilename = files.obverse[0].filename;
    aiData.reverseFilename = files.reverse[0].filename;
    return res.json(aiData);
  } catch (err) {
    console.error("Erreur d'analyse:", err);
    res.status(500).send("Erreur de traitement IA : " + err.message);
  }
});

// ----------------------------------------------------
// ROUTE : MOTEUR DE RECHERCHE HYBRIDE & IDENTIFICATION
// ----------------------------------------------------
app.post('/api/identify', async (req, res) => {
  const {
    metal,
    weight,
    diameter,
    axis,
    legendObverse,
    legendReverse,
    iconography,
    period,
    suggestedTerms,
    directIdentification,
    doubleCheckCandidates
  } = req.body;

  try {
    const numistaKey = await getSetting('numista_key') || process.env.NUMISTA_API_KEY;
    let candidates = [];
    const weightVal = parseFloat(weight) || 0;
    const diameterVal = parseFloat(diameter) || 0;

    // Injecter l'identification directe de l'IA (Vision) en premier candidat
    if (directIdentification && directIdentification.title) {
      let imageObverse = '';
      let imageReverse = '';
      let refWeight = parseFloat(directIdentification.referenceWeight) || null;
      let refDiameter = parseFloat(directIdentification.referenceDiameter) || null;
      let refMetal = directIdentification.metal || metal || "Bronze";
      let refUrl = directIdentification.referenceUrl || '';

      // Correction prioritaire via recherche textuelle exacte
      let displayTitle = directIdentification.title;
      if (numistaKey && directIdentification.title) {
        const corrected = await correctCoinViaNumista(directIdentification.title, numistaKey, refWeight, refDiameter, refMetal);
        if (corrected.imageObverse || corrected.imageReverse) {
          if (corrected.title) displayTitle = corrected.title;
          imageObverse = corrected.imageObverse;
          imageReverse = corrected.imageReverse;
          refWeight = corrected.refWeight;
          refDiameter = corrected.refDiameter;
          refMetal = corrected.refMetal;
          refUrl = corrected.refUrl;
        }
      }

      // Repli si échec (sécurisation anti-hallucination d'URL)
      if (!imageObverse && !imageReverse) {
        const numistaId = extractNumistaId(directIdentification.referenceUrl);
        if (numistaId && numistaKey) {
          const details = await fetchNumistaCoinDetails(numistaId, numistaKey);
          if (details) {
            const cleanTitleLower = (details.title || '').toLowerCase();
            const targetTitleLower = displayTitle.toLowerCase();
            const commonWords = targetTitleLower.split(/\s+/).filter(w => w.length > 3 && !/argent|bronze|cuivre|billon|or/i.test(w));
            const hasCommonWords = commonWords.some(w => cleanTitleLower.includes(w) || w.includes(cleanTitleLower));
            
            if (hasCommonWords) {
              if (details.title) displayTitle = details.title;
              imageObverse = details.obverseImage;
              imageReverse = details.reverseImage;
              if (details.weight) refWeight = details.weight;
              if (details.diameter) refDiameter = details.diameter;
              if (details.metal) refMetal = details.metal;
            } else {
              console.log(`Rejet de l'URL direct ID ${numistaId} : titre "${details.title}" ne correspond pas à "${displayTitle}"`);
            }
          }
        }
      }

      candidates.push({
        id: 'ai-direct',
        title: displayTitle,
        issuer: directIdentification.issuer || "Inconnu",
        year: directIdentification.year || "Inconnue",
        metal: refMetal,
        referenceWeight: refWeight,
        referenceDiameter: refDiameter,
        referenceAxis: directIdentification.referenceAxis || null,
        description: directIdentification.description || "Identification directe proposée par l'IA de vision.",
        imageObverse,
        imageReverse,
        referenceUrl: refUrl || directIdentification.referenceUrl || '',
        source: 'Vision IA'
      });
    }

    // Injecter les autres candidats de double-check identifiés par l'IA (Vision)
    if (doubleCheckCandidates && Array.isArray(doubleCheckCandidates)) {
      for (let idx = 0; idx < doubleCheckCandidates.length; idx++) {
        const cand = doubleCheckCandidates[idx];
        if (cand && cand.title) {
          let imageObverse = '';
          let imageReverse = '';
          let refWeight = parseFloat(cand.referenceWeight) || null;
          let refDiameter = parseFloat(cand.referenceDiameter) || null;
          let refMetal = cand.metal || metal || "Bronze";
          let refUrl = cand.referenceUrl || '';

          let displayTitle = cand.title;
          // Correction prioritaire via recherche textuelle exacte
          if (numistaKey && cand.title) {
            const corrected = await correctCoinViaNumista(cand.title, numistaKey, refWeight, refDiameter, refMetal);
            if (corrected.imageObverse || corrected.imageReverse) {
              if (corrected.title) displayTitle = corrected.title;
              imageObverse = corrected.imageObverse;
              imageReverse = corrected.imageReverse;
              refWeight = corrected.refWeight;
              refDiameter = corrected.refDiameter;
              refMetal = corrected.refMetal;
              refUrl = corrected.refUrl;
            }
          }

          // Repli si échec (sécurisation anti-hallucination d'URL)
          if (!imageObverse && !imageReverse) {
            const numistaId = extractNumistaId(cand.referenceUrl);
            if (numistaId && numistaKey) {
              const details = await fetchNumistaCoinDetails(numistaId, numistaKey);
              if (details) {
                const cleanTitleLower = (details.title || '').toLowerCase();
                const targetTitleLower = displayTitle.toLowerCase();
                const commonWords = targetTitleLower.split(/\s+/).filter(w => w.length > 3 && !/argent|bronze|cuivre|billon|or/i.test(w));
                const hasCommonWords = commonWords.some(w => cleanTitleLower.includes(w) || w.includes(cleanTitleLower));
                
                if (hasCommonWords) {
                  if (details.title) displayTitle = details.title;
                  imageObverse = details.obverseImage;
                  imageReverse = details.reverseImage;
                  if (details.weight) refWeight = details.weight;
                  if (details.diameter) refDiameter = details.diameter;
                  if (details.metal) refMetal = details.metal;
                } else {
                  console.log(`Rejet de l'URL doublecheck ID ${numistaId} : titre "${details.title}" ne correspond pas à "${displayTitle}"`);
                }
              }
            }
          }

          candidates.push({
            id: `ai-doublecheck-${idx}`,
            title: displayTitle,
            issuer: cand.issuer || "Inconnu",
            year: cand.year || "Inconnue",
            metal: refMetal,
            referenceWeight: refWeight,
            referenceDiameter: refDiameter,
            referenceAxis: cand.referenceAxis || null,
            description: cand.description || "Monnaie similaire de comparaison trouvée sur le web.",
            imageObverse,
            imageReverse,
            referenceUrl: refUrl || cand.referenceUrl || '',
            source: 'Double-Check IA'
          });
        }
      }
    }

    // --- RECHERCHE OCRE (Pour monnaies romaines impériales) ---
    // Si le terme "romain" ou "empire" ou des empereurs romains typiques sont suggérés, on interroge OCRE
    const isRoman = /roman|rome|romain/i.test(period) || /imp|avg|caesar|ric/i.test(legendObverse + legendReverse);
    
    if (isRoman) {
      console.log("Recherche OCRE initiée...");
      // Construire une requête générale Solr pour OCRE
      // Utiliser les mots clés et/ou empereurs identifiés
      const searchTerms = suggestedTerms ? suggestedTerms.filter(t => !/bronze|silver|gold|copper|billon/i.test(t)) : [];
      let query = searchTerms.join(' ');
      
      // Si la requête est vide, utiliser la légende
      if (!query && legendObverse) {
        query = legendObverse.replace(/\./g, '').trim();
      }

      if (query) {
        const ocreUrl = `https://numismatics.org/ocre/feed/?q=${encodeURIComponent(query)}`;
        const ocreRes = await fetch(ocreUrl);
        if (ocreRes.status === 200) {
          const xml = await ocreRes.text();
          const $ = cheerio.load(xml, { xmlMode: true });
          
          const entries = $('entry');
          const maxOcreQueries = Math.min(entries.length, 10); // Limiter à 10 pour la rapidité
          
          const ocrePromises = [];
          for (let i = 0; i < maxOcreQueries; i++) {
            const entry = entries.eq(i);
            const title = entry.find('title').text();
            const link = entry.find('link[rel="alternate"]').attr('href');
            
            // Le lien alternate se termine par .xml, c'est l'URL NUDS XML
            if (link && link.endsWith('.xml')) {
              ocrePromises.push((async () => {
                try {
                  const coinRes = await fetch(link);
                  const coinXml = await coinRes.text();
                  const c$ = cheerio.load(coinXml, { xmlMode: true });

                  // Extraction des spécifications physiques de OCRE
                  const refDenomination = c$('denomination').text().trim();
                  const refMaterial = c$('material').text().trim();
                  const refAuthority = c$('authority').text().trim();
                  const refObvLegend = c$('obverse legend').text().trim();
                  const refObvDesc = c$('obverse typeDescription').text().trim();
                  const refRevLegend = c$('reverse legend').text().trim();
                  const refRevDesc = c$('reverse typeDescription').text().trim();

                  // Convertir le métal en équivalent standard
                  let metalMapped = 'Bronze';
                  if (/gold|or/i.test(refMaterial)) metalMapped = 'Gold';
                  else if (/silver|argent/i.test(refMaterial)) metalMapped = 'Silver';
                  else if (/copper|cuivre/i.test(refMaterial)) metalMapped = 'Copper';
                  else if (/billon/i.test(refMaterial)) metalMapped = 'Billon';

                  // Estimer les dimensions théoriques moyennes pour le scoring
                  let estWeight = 3.0; // Denarius typique
                  let estDiameter = 19;
                  if (/aureus/i.test(refDenomination)) { estWeight = 7.3; estDiameter = 20; }
                  else if (/follis|nummus/i.test(refDenomination)) { estWeight = 5.0; estDiameter = 23; }
                  else if (/antoninianus|double/i.test(refDenomination)) { estWeight = 3.8; estDiameter = 21; }
                  else if (/sestertius/i.test(refDenomination)) { estWeight = 25.0; estDiameter = 32; }
                  else if (/dupondius|as/i.test(refDenomination)) { estWeight = 11.0; estDiameter = 27; }

                  // Image de référence (OCRE fournit des liens d'images d'ANS ou British Museum)
                  // On tente d'extraire la première image disponible dans le NUDS
                  let refImage = '';
                  const imageNode = c$('reference[TypeOfResource="image"]').first();
                  if (imageNode.length > 0) {
                    refImage = imageNode.attr('href') || '';
                  } else {
                    // Tenter de pointer vers l'URL de base de l'ANS
                    const id = link.substring(link.lastIndexOf('/') + 1, link.lastIndexOf('.xml'));
                    refImage = `http://numismatics.org/ocre/id/${id}`;
                  }

                  return {
                    id: title,
                    title: `${refDenomination} - ${refAuthority}`,
                    issuer: "Empire Romain",
                    year: period || "Antiquité",
                    metal: metalMapped,
                    referenceWeight: estWeight,
                    referenceDiameter: estDiameter,
                    referenceAxis: "12h",
                    description: `Avers: ${refObvDesc} (${refObvLegend}) \nRevers: ${refRevDesc} (${refRevLegend})`,
                    imageObverse: refImage.includes('http') ? refImage : '',
                    imageReverse: '',
                    referenceUrl: link.replace('.xml', ''),
                    source: 'OCRE'
                  };
                } catch (e) {
                  return null;
                }
              })());
            }
          }
          const ocreCoins = (await Promise.all(ocrePromises)).filter(c => c !== null);
          candidates = [...candidates, ...ocreCoins];
        }
      }
    }

    // --- RECHERCHE NUMISTA ---
    if (numistaKey) {
      console.log("Recherche Numista initiée...");
      let query = '';
      const legendsCombined = [legendObverse, legendReverse].filter(Boolean).join(' ').replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
      if (legendsCombined && legendsCombined.length > 5) {
        query = legendsCombined;
      } else {
        query = (suggestedTerms || []).join(' ') || period || legendObverse || '';
      }
      if (query) {
        const numistaUrl = `https://api.numista.com/v3/types?q=${encodeURIComponent(query)}`;
        const numistaRes = await fetch(numistaUrl, {
          headers: {
            'Numista-API-Key': numistaKey,
            'User-Agent': 'NumisDetect App'
          }
        });

        if (numistaRes.status === 200) {
          const numistaData = await numistaRes.json();
          if (numistaData.types && numistaData.types.length > 0) {
            const numistaCoinsPromises = numistaData.types.slice(0, 5).map(async coin => {
              let refWeight = null;
              let refDiameter = null;
              let refMetal = "Bronze";
              let imageObverse = coin.obverse_thumbnail || '';
              let imageReverse = coin.reverse_thumbnail || '';

              // Récupérer les détails de la fiche (poids, diamètre) pour le scoring hybride
              const details = await fetchNumistaCoinDetails(coin.id, numistaKey);
              if (details) {
                refWeight = details.weight;
                refDiameter = details.diameter;
                refMetal = details.metal || "Bronze";
                if (details.obverseImage) imageObverse = details.obverseImage;
                if (details.reverseImage) imageReverse = details.reverseImage;
              }

              return {
                id: `numista-${coin.id}`,
                title: coin.title,
                issuer: coin.issuer?.name || "Inconnu",
                year: coin.min_year === coin.max_year ? `${coin.min_year}` : `${coin.min_year} - ${coin.max_year}`,
                metal: refMetal,
                referenceWeight: refWeight,
                referenceDiameter: refDiameter,
                referenceAxis: null,
                description: `Type: ${coin.object_type?.name || 'Pièce'}. Composition : ${refMetal}.`,
                imageObverse,
                imageReverse,
                referenceUrl: `https://fr.numista.com/catalogue/pieces${coin.id}.html`,
                source: 'Numista'
              };
            });
            
            const numistaCoins = await Promise.all(numistaCoinsPromises);
            candidates = [...candidates, ...numistaCoins];
          }
        }
      }
    }

    // --- ALGORITHME DE SCORING HYBRIDE ---
    const scoredCandidates = candidates.map(cand => {
      let score = 50; // Score de base pour un résultat retourné par la recherche de l'API

      // Détecter si les légendes fournies par le client sont présentes
      const hasUserLegends = !!(legendObverse || legendReverse);
      const descLower = (cand.description || '').toLowerCase() + ' ' + cand.title.toLowerCase();
      let matchesAnyLegend = false;
      if (hasUserLegends) {
        const cleanObv = legendObverse ? legendObverse.toLowerCase().trim() : '';
        const cleanRev = legendReverse ? legendReverse.toLowerCase().trim() : '';
        if (cleanObv && descLower.includes(cleanObv.replace(/vs$/, '').substring(0, 5))) matchesAnyLegend = true;
        if (cleanRev && descLower.includes(cleanRev.replace(/vs$/, '').substring(0, 5))) matchesAnyLegend = true;
      }

      if (cand.id === 'ai-direct') {
        score = (hasUserLegends && !matchesAnyLegend) ? 50 : 75; // Perte de l'avantage si contradiction avec les légendes corrigées
      } else if (cand.id && cand.id.startsWith('ai-doublecheck')) {
        score = (hasUserLegends && !matchesAnyLegend) ? 50 : 65;
      }

      // 1. Scoring du Métal (+20 ou -20)
      if (metal && metal !== 'Non identifié' && cand.metal) {
        const candMetalLower = cand.metal.toLowerCase();
        const inputMetalLower = metal.toLowerCase();
        if (candMetalLower.includes(inputMetalLower) || inputMetalLower.includes(candMetalLower)) {
          score += 20;
        } else {
          score -= 10;
        }
      }

      // 2. Scoring du Poids (Tolérance ±20%, max +20 points)
      if (weight > 0 && cand.referenceWeight > 0) {
        const diffPercent = Math.abs(cand.referenceWeight - weight) / cand.referenceWeight;
        if (diffPercent <= 0.05) score += 20;
        else if (diffPercent <= 0.10) score += 15;
        else if (diffPercent <= 0.20) score += 8;
        else if (diffPercent > 0.30) score -= 50; // Mismatch physique sévère
        else if (diffPercent > 0.40) score -= 65; // Mismatch critique
      }

      // 3. Scoring du Diamètre (Tolérance ±15%, max +20 points)
      if (diameter > 0 && cand.referenceDiameter > 0) {
        const diffPercent = Math.abs(cand.referenceDiameter - diameter) / cand.referenceDiameter;
        if (diffPercent <= 0.05) score += 20;
        else if (diffPercent <= 0.10) score += 15;
        else if (diffPercent <= 0.15) score += 8;
        else if (diffPercent > 0.20) score -= 50; // Mismatch physique sévère
        else if (diffPercent > 0.30) score -= 65; // Mismatch critique
      }

      // 4. Scoring Textuel sur les légendes avec racinisation (max +30 points)
      let textMatchBonus = 0;
      
      const allLegendWords = [legendObverse, legendReverse]
        .filter(Boolean)
        .join(' ')
        .replace(/\./g, ' ')
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length > 2 && w !== 'rex' && w !== 'civis');

      for (const word of allLegendWords) {
        // Racinisation basique : on enlève la désinence "vs" ou on garde les 5 premières lettres
        const cleanWord = word.replace(/vs$/, '').substring(0, 5);
        if (descLower.includes(cleanWord)) {
          textMatchBonus += 10; // +10 pour chaque mot de légende clé trouvé
        }
      }
      
      // Bonus additionnel de +5 pour la correspondance exacte de la phrase entière
      if (legendObverse && descLower.includes(legendObverse.toLowerCase().trim())) {
        textMatchBonus += 5;
      }
      if (legendReverse && descLower.includes(legendReverse.toLowerCase().trim())) {
        textMatchBonus += 5;
      }
      score += textMatchBonus;

      // Borner le score final entre 5% et 99%
      let finalScore = Math.max(5, Math.min(99, score));
      
      // Si aucune caractéristique physique n'est saisie, on fait confiance au visuel de l'IA
      const noWeight = weightVal === 0;
      const noDiameter = diameterVal === 0;
      const noMetal = !metal || metal === 'Non identifié';
      if (noWeight && noDiameter && noMetal) {
        if (cand.id === 'ai-direct') {
          finalScore = 95;
        } else if (cand.id && cand.id.startsWith('ai-doublecheck')) {
          finalScore = 85;
        }
      }

      return {
        ...cand,
        matchScore: Math.round(finalScore)
      };
    });

    // Trier les candidats par score descendant
    scoredCandidates.sort((a, b) => b.matchScore - a.matchScore);

    res.json({ candidates: scoredCandidates.slice(0, 15) });
  } catch (err) {
    console.error("Erreur d'identification:", err);
    res.status(500).send("Erreur d'identification : " + err.message);
  }
});

app.post('/api/double-check', async (req, res) => {
  const { title, obverseImage, reverseImage, refImageObverse, refImageReverse } = req.body;

  if (!title) {
    return res.status(400).send("Le titre de la monnaie est requis pour le double-check.");
  }

  try {
    const mistralKey = await getSetting('mistral_key') || process.env.MISTRAL_API_KEY;
    if (!mistralKey) {
      return res.status(400).send("Clé API Mistral manquante dans les paramètres.");
    }

    let obverseBase64 = '';
    let reverseBase64 = '';

    const getLocalImagePath = (imgUrl) => {
      if (!imgUrl) return null;
      if (imgUrl.includes('/uploads/')) {
        const filename = imgUrl.split('/uploads/')[1];
        return path.join(uploadsDir, filename);
      }
      return path.join(uploadsDir, imgUrl);
    };

    const obvPath = getLocalImagePath(obverseImage);
    const revPath = getLocalImagePath(reverseImage);

    if (obvPath && fs.existsSync(obvPath)) {
      obverseBase64 = Buffer.from(fs.readFileSync(obvPath)).toString("base64");
    }
    if (revPath && fs.existsSync(revPath)) {
      reverseBase64 = Buffer.from(fs.readFileSync(revPath)).toString("base64");
    }

    if (!obverseBase64 || !reverseBase64) {
      return res.status(400).send("Impossible de charger les images de la monnaie soumise.");
    }

    const prompt = `
      Tu es un expert mondial en numismatique et en authentification / double-check visuel de monnaies.
      Voici en entrée les photos de la monnaie soumise par l'utilisateur (Avers et Revers).
      Et voici les photos de référence officielles du catalogue pour le type exact "${title}".
      
      Effectue une comparaison visuelle comparative extrêmement minutieuse. Compare les reliefs, le drapé du buste, les détails du portrait, l'alignement et la police des lettres des légendes, et les symboles (comme les lettres d'atelier ou les signatures).
      
      Rends-moi un objet JSON contenant STRICTEMENT ces clés et aucun autre texte :
      {
        "confidenceScore": 95, // Score de correspondance visuelle estimé (entre 0 et 100)
        "pointsOfAgreement": [
          "Le profil correspond exactement à la gravure officielle.",
          "La légende de l'avers coïncide avec le lettrage de référence."
        ],
        "pointsOfDisagreement": [
          "Usure prononcée des reliefs du revers par rapport au spécimen officiel."
        ],
        "verdict": "La monnaie soumise correspond avec certitude au type de référence. Les légères différences ou points d'usures constatés sont normaux pour une monnaie ayant circulé."
      }
    `;

    const contentArray = [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${obverseBase64}` } },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${reverseBase64}` } }
    ];

    if (refImageObverse && refImageObverse.trim().length > 0 && !refImageObverse.includes('no-photo.png')) {
      contentArray.push({ type: "image_url", image_url: { url: refImageObverse } });
    }
    if (refImageReverse && refImageReverse.trim().length > 0 && !refImageReverse.includes('no-photo.png')) {
      contentArray.push({ type: "image_url", image_url: { url: refImageReverse } });
    }

    const payload = {
      model: "mistral-large-latest",
      messages: [
        {
          role: "user",
          content: contentArray
        }
      ],
      response_format: { type: "json_object" }
    };

    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${mistralKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Erreur API Mistral: ${errText}`);
    }

    const mistralData = await response.json();
    const resultJson = JSON.parse(mistralData.choices[0].message.content);

    const cleanCgbQuery = title
      .replace(/\b(tête|tete)\s+(nue|laurée|lauree)\b/gi, '')
      .replace(/\b(argent|bronze|cuivre|or|billon)\b/gi, '')
      .replace(/-/g, ' ')
      .replace(/[^\w\sÀ-ÿ]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    const queryEscaped = encodeURIComponent(title);
    const cgbQueryEscaped = encodeURIComponent(cleanCgbQuery);
    resultJson.cgbSearchUrl = `https://www.google.com/search?q=site%3Acgb.fr+${cgbQueryEscaped}`;
    resultJson.numistaSearchUrl = `https://fr.numista.com/catalogue/index.php?r=${queryEscaped}`;

    res.json(resultJson);

  } catch (err) {
    console.error("Erreur lors du double-check visuel:", err);
    res.status(500).send("Erreur lors du double-check visuel: " + err.message);
  }
});

// ----------------------------------------------------
// ROUTES : ENREGISTREMENT ET COLLECTION DE DÉCOUVERTES
// ----------------------------------------------------
app.post('/api/save', upload.fields([{ name: 'obverse', maxCount: 1 }, { name: 'reverse', maxCount: 1 }]), async (req, res) => {
  const {
    weight,
    diameter,
    axis,
    metal,
    legendObverse,
    legendReverse,
    iconography,
    notes,
    matchedCoinId,
    matchedTitle,
    matchedIssuer,
    matchedYear,
    matchedRefUrl,
    matchedDescription
  } = req.body;

  try {
    const files = req.files;
    let obverseFilename = '';
    let reverseFilename = '';

    if (files) {
      if (files.obverse) {
        const filePath = files.obverse[0].path;
        const buffer = fs.readFileSync(filePath);
        obverseFilename = `data:image/jpeg;base64,${buffer.toString('base64')}`;
        try { fs.unlinkSync(filePath); } catch (e) { console.error("Erreur suppression fichier:", e); }
      }
      if (files.reverse) {
        const filePath = files.reverse[0].path;
        const buffer = fs.readFileSync(filePath);
        reverseFilename = `data:image/jpeg;base64,${buffer.toString('base64')}`;
        try { fs.unlinkSync(filePath); } catch (e) { console.error("Erreur suppression fichier:", e); }
      }
    }

    const sql = `
      INSERT INTO identified_coins (
        obverse_image, reverse_image, weight, diameter, axis, metal,
        detected_legend_obverse, detected_legend_reverse, detected_iconography,
        matched_coin_id, matched_title, matched_issuer, matched_year, matched_ref_url,
        matched_description, user_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await db.run(sql, [
      obverseFilename,
      reverseFilename,
      parseFloat(weight) || 0,
      parseFloat(diameter) || 0,
      axis || '12h',
      metal || 'Bronze',
      legendObverse || '',
      legendReverse || '',
      iconography || '',
      matchedCoinId || '',
      matchedTitle || '',
      matchedIssuer || '',
      matchedYear || '',
      matchedRefUrl || '',
      matchedDescription || '',
      notes || ''
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error("Erreur lors de l'enregistrement en BDD:", err);
    res.status(500).send(err.message);
  }
});

app.get('/api/history', async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM identified_coins ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.delete('/api/history/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Récupérer les noms des fichiers image pour les supprimer physiquement
    const coin = await db.get('SELECT obverse_image, reverse_image FROM identified_coins WHERE id = ?', [id]);
    if (coin) {
      if (coin.obverse_image) {
        const p = path.join(uploadsDir, coin.obverse_image);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
      if (coin.reverse_image) {
        const p = path.join(uploadsDir, coin.reverse_image);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    }

    await db.run('DELETE FROM identified_coins WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Démarrage du serveur Express
app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
