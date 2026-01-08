import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { jsPDF } from 'jspdf';
import Swiper from 'swiper';
import { jsonrepair } from 'jsonrepair';

// State Management
const state = {
    currentRefinement: null,
    history: JSON.parse(localStorage.getItem('story_history') || '[]'),
    favorites: JSON.parse(localStorage.getItem('story_favorites') || '[]'),
    draft: localStorage.getItem('story_draft') || '',
    theme: localStorage.getItem('story_theme') || 'light',
    fontSize: localStorage.getItem('story_font_size') || '16',
    fontFamily: localStorage.getItem('story_font_family') || 'sans',
    model: localStorage.getItem('story_model') || 'gpt-4o',
    apiKey: localStorage.getItem('story_api_key') || '',
    availableModels: []
};

// UI Elements
const els = {
    input: document.getElementById('story-input'),
    refineBtn: document.getElementById('refine-btn'),
    loading: document.getElementById('loading-state'),
    results: document.getElementById('results-area'),
    inspiration: document.getElementById('inspiration-text'),
    historyList: document.getElementById('history-list'),
    favoritesList: document.getElementById('favorites-list'),
    sidebar: document.getElementById('sidebar'),
    overlay: document.getElementById('sidebar-overlay'),
    genre: document.getElementById('genre-select'),
    lang: document.getElementById('lang-select')
};

// --- Initialization ---

function init() {
    applyTheme();
    applyFont();
    updateHistoryUI();
    updateFavoritesUI();
    generateInspiration();
    
    // Restore draft
    els.input.value = state.draft;

    // Event Listeners
    els.refineBtn.addEventListener('click', handleRefine);
    els.input.addEventListener('input', (e) => {
        state.draft = e.target.value;
        localStorage.setItem('story_draft', state.draft);
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleRefine();
        if (e.key === 'Escape') {
            els.input.value = '';
            state.draft = '';
            localStorage.setItem('story_draft', '');
        }
    });

    // Theme & Font
    document.getElementById('text-settings-toggle').addEventListener('click', (e) => {
        document.getElementById('text-settings-group').classList.toggle('locked');
        document.getElementById('ai-settings-group').classList.remove('locked');
    });

    document.getElementById('ai-settings-toggle').addEventListener('click', (e) => {
        document.getElementById('ai-settings-group').classList.toggle('locked');
        document.getElementById('text-settings-group').classList.remove('locked');
    });

    const modelSelect = document.getElementById('model-select');
    modelSelect.value = state.model;
    modelSelect.addEventListener('change', (e) => {
        state.model = e.target.value;
        localStorage.setItem('story_model', state.model);
    });

    const apiKeyInput = document.getElementById('api-key-input');
    apiKeyInput.value = state.apiKey;
    apiKeyInput.addEventListener('input', (e) => {
        state.apiKey = e.target.value;
        localStorage.setItem('story_api_key', state.apiKey);
        fetchModels();
    });

    // Load models immediately on init
    fetchModels();

    document.getElementById('toggle-dark').addEventListener('click', toggleTheme);
    document.getElementById('toggle-contrast').addEventListener('click', toggleContrast);
    document.getElementById('text-size-slider').addEventListener('input', (e) => {
        state.fontSize = e.target.value;
        applyFont();
        localStorage.setItem('story_font_size', state.fontSize);
    });
    document.querySelectorAll('.font-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.fontFamily = btn.dataset.font;
            applyFont();
            localStorage.setItem('story_font_family', state.fontFamily);
        });
    });

    // Sidebar
    document.getElementById('open-sidebar').addEventListener('click', toggleSidebar);
    document.getElementById('close-sidebar').addEventListener('click', toggleSidebar);
    els.overlay.addEventListener('click', toggleSidebar);
    document.getElementById('clear-data').addEventListener('click', clearAllData);

    // Export & Feedback
    document.getElementById('download-txt').addEventListener('click', exportTxt);
    document.getElementById('download-pdf').addEventListener('click', exportPdf);
    document.getElementById('open-feedback').addEventListener('click', () => document.getElementById('feedback-modal').classList.remove('hidden'));
    document.getElementById('close-feedback').addEventListener('click', () => document.getElementById('feedback-modal').classList.add('hidden'));
    document.getElementById('feedback-form').addEventListener('submit', (e) => {
        e.preventDefault();
        alert('Thank you for your feedback!');
        document.getElementById('feedback-modal').classList.add('hidden');
    });

    // Inspiration
    document.getElementById('refresh-inspiration').addEventListener('click', generateInspiration);
}

// --- Logic ---

async function handleRefine() {
    const prompt = els.input.value.trim();
    if (!prompt) return;

    if (!state.apiKey) {
        alert("Please enter your Pollinations API Key in the AI Settings (gear icon) to refine your idea.");
        document.getElementById('ai-settings-group').classList.add('locked');
        return;
    }

    els.refineBtn.disabled = true;
    els.loading.classList.remove('hidden');
    els.results.classList.add('hidden');
    els.loading.scrollIntoView({ behavior: 'smooth' });

    try {
        const genre = els.genre.value;
        const lang = els.lang.value;
        const systemPrompt = `You are a professional story doctor and creative writing coach. 
                    Given a story idea, refine it into:
                    1. Three catchy alternative taglines.
                    2. A compelling narrative arc (plot summary).
                    3. Detailed character profiles.
                    4. Worldbuilding notes.
                    
                    IMPORTANT: Output ONLY a valid JSON object. Ensure all strings are correctly escaped.
                    JSON structure: 
                    {
                        "taglines": ["tagline 1", "tagline 2", "tagline 3"],
                        "plot": "Detailed narrative arc in markdown format",
                        "characters": "Detailed character profiles in markdown format",
                        "world": "Detailed worldbuilding notes in markdown format",
                        "summary": "A short one-sentence summary of the core concept"
                    }
                    Respond in ${lang}. Genre context: ${genre}.`;

        let data;
        const response = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.apiKey}`
            },
            body: JSON.stringify({
                model: state.model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: prompt }
                ],
                seed: Math.floor(Math.random() * 1000000)
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("API Error Response:", errorText);
            throw new Error(`API Error: ${response.status} - ${errorText.substring(0, 100)}`);
        }

        const result = await response.json();
        const content = result.choices[0].message.content;
        
        // Robust JSON parsing using jsonrepair to handle common LLM mistakes (like unescaped quotes or newlines)
        try {
            // Strip markdown code blocks if they exist before repairing
            const stripped = content.replace(/```json\n?|```/g, '').trim();
            const repaired = jsonrepair(stripped);
            data = JSON.parse(repaired);
        } catch (e) {
            console.error("JSON Parse Error. Raw content:", content);
            throw new Error(`The AI's response format was invalid: ${e.message}. Please try again.`);
        }

        state.currentRefinement = { ...data, original: prompt, id: Date.now() };
        
        displayResults(state.currentRefinement);
        addToHistory(state.currentRefinement);
        generateCharacterImage(data.summary);
        
    } catch (err) {
        console.error("Refinement error details:", err);
        alert(`Failed to refine idea: ${err.message || "Unknown error"}. Check console for details.`);
    } finally {
        els.refineBtn.disabled = false;
        els.loading.classList.add('hidden');
    }
}

async function fetchModels() {
    try {
        const headers = {};
        if (state.apiKey) {
            headers['Authorization'] = `Bearer ${state.apiKey}`;
        }
        
        const response = await fetch('https://gen.pollinations.ai/text/models', { headers });
        const models = await response.json();
        state.availableModels = models;
        updateModelsUI();
    } catch (err) {
        console.warn("Could not fetch models from Pollinations:", err);
    }
}

function updateModelsUI() {
    const modelSelect = document.getElementById('model-select');
    if (!modelSelect || !state.availableModels.length) return;

    // Save current selection to see if it's still available
    const currentModel = state.model;
    
    let optionsHtml = '';
    let foundCurrent = false;

    state.availableModels.forEach(m => {
        const id = m.name || m.id || m;
        const name = m.description || m.id || m;
        const isSelected = id === currentModel;
        if (isSelected) foundCurrent = true;
        optionsHtml += `<option value="${id}" ${isSelected ? 'selected' : ''}>${name}</option>`;
    });

    modelSelect.innerHTML = optionsHtml;

    // If the saved model isn't in the new list, update state to the first available model
    if (!foundCurrent && state.availableModels.length > 0) {
        const firstModel = state.availableModels[0].name || state.availableModels[0].id || state.availableModels[0];
        state.model = firstModel;
        localStorage.setItem('story_model', state.model);
    }
}

function displayResults(data) {
    els.results.classList.remove('hidden');
    
    // Taglines
    const taglineWrap = document.getElementById('tagline-container');
    taglineWrap.innerHTML = data.taglines.map(t => `
        <div class="swiper-slide glass p-8 rounded-3xl text-center flex items-center justify-center h-40">
            <h4 class="text-xl font-bold italic">"${t}"</h4>
        </div>
    `).join('');
    
    new Swiper('.tagline-swiper', {
        pagination: { el: '.swiper-pagination', clickable: true },
        spaceBetween: 20,
        grabCursor: true
    });

    // Content sections
    document.getElementById('plot-content').innerHTML = DOMPurify.sanitize(marked.parse(data.plot));
    document.getElementById('character-content').innerHTML = DOMPurify.sanitize(marked.parse(data.characters));
    document.getElementById('world-content').innerHTML = DOMPurify.sanitize(marked.parse(data.world));

    // Stats
    const wordCount = data.plot.split(/\s+/).length;
    document.getElementById('plot-word-count').innerText = `${wordCount} words`;

    // Favorites button reset
    const favBtn = document.querySelector('.fav-btn');
    favBtn.classList.remove('text-yellow-500');
    favBtn.onclick = () => toggleFavorite(state.currentRefinement);

    // Copy buttons
    document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.onclick = () => {
            const text = document.getElementById(btn.dataset.target).innerText;
            navigator.clipboard.writeText(text);
            btn.innerHTML = '✓';
            setTimeout(() => btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>', 2000);
        };
    });

    // Socials
    document.querySelector('.share-twitter').onclick = () => {
        const text = encodeURIComponent(`Check out my refined story idea: ${data.taglines[0]} #StoryRefiner`);
        window.open(`https://twitter.com/intent/tweet?text=${text}`);
    };
    
    document.querySelector('.share-reddit').onclick = () => {
        const title = encodeURIComponent(`Story Idea: ${data.taglines[0]}`);
        const body = encodeURIComponent(data.plot);
        window.open(`https://www.reddit.com/submit?title=${title}&text=${body}`);
    };
}

async function generateCharacterImage(summary) {
    try {
        const imgEl = document.getElementById('char-image');
        imgEl.style.opacity = '0.5';
        const result = await websim.imageGen({
            prompt: `Stylized profile portrait of a main character for a story about: ${summary}. Cinematic lighting, digital painting style, minimalist background.`,
            transparent: false,
            aspect_ratio: "1:1"
        });
        imgEl.src = result.url;
        imgEl.style.opacity = '1';
    } catch (e) {
        console.warn("Image generation failed", e);
    }
}

async function generateInspiration() {
    els.inspiration.innerText = "Consulting the oracle...";
    const res = await websim.chat.completions.create({
        messages: [{ role: "user", content: "Generate a one-sentence wildly unique story prompt." }]
    });
    els.inspiration.innerText = res.content.replace(/"/g, '');
}

// --- Persistence & UI Helpers ---

function addToHistory(item) {
    state.history = [item, ...state.history.slice(0, 19)];
    localStorage.setItem('story_history', JSON.stringify(state.history));
    updateHistoryUI();
}

function updateHistoryUI() {
    if (!els.historyList) return;
    if (state.history.length === 0) {
        els.historyList.innerHTML = '<p class="text-gray-400 italic">History is empty.</p>';
        return;
    }
    els.historyList.innerHTML = state.history.map(item => `
        <button class="w-full text-left p-2 hover:bg-white/5 rounded transition text-xs truncate" onclick="loadItem(${item.id}, 'history')">
            ${item.original.substring(0, 30)}...
        </button>
    `).join('');
}

window.loadItem = (id, type) => {
    const collection = type === 'history' ? state.history : state.favorites;
    const item = collection.find(i => i.id === id);
    if (item) {
        state.currentRefinement = item;
        els.input.value = item.original;
        displayResults(item);
        toggleSidebar();
    }
};

function toggleFavorite(item) {
    const index = state.favorites.findIndex(f => f.id === item.id);
    if (index > -1) {
        state.favorites.splice(index, 1);
        document.querySelector('.fav-btn').classList.remove('text-yellow-500');
    } else {
        state.favorites.push(item);
        document.querySelector('.fav-btn').classList.add('text-yellow-500');
    }
    localStorage.setItem('story_favorites', JSON.stringify(state.favorites));
    updateFavoritesUI();
}

function updateFavoritesUI() {
    if (!els.favoritesList) return;
    if (state.favorites.length === 0) {
        els.favoritesList.innerHTML = '<p class="text-gray-400 italic">No favorites yet.</p>';
        return;
    }
    els.favoritesList.innerHTML = state.favorites.map(item => `
        <button class="w-full text-left p-2 hover:bg-white/5 rounded transition text-xs truncate flex items-center gap-2" onclick="loadItem(${item.id}, 'favorites')">
            <span class="text-yellow-500">★</span> ${item.taglines[0].substring(0, 25)}...
        </button>
    `).join('');
}

function toggleTheme() {
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    applyTheme();
    localStorage.setItem('story_theme', state.theme);
}

function applyTheme() {
    document.body.classList.toggle('dark', state.theme === 'dark');
    const icon = document.getElementById('theme-icon');
    if (state.theme === 'dark') {
        icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
    } else {
        icon.innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
    }
}

function toggleContrast() {
    document.body.classList.toggle('high-contrast');
}

function applyFont() {
    document.body.classList.remove('font-serif', 'font-mono', 'font-fancy');
    if (state.fontFamily !== 'sans') {
        document.body.classList.add(`font-${state.fontFamily}`);
    }
    document.body.style.fontSize = `${state.fontSize}px`;
    
    // Update active UI
    document.querySelectorAll('.font-btn').forEach(btn => {
        btn.classList.toggle('bg-indigo-500/20', btn.dataset.font === state.fontFamily);
    });
}

function toggleSidebar() {
    els.sidebar.classList.toggle('open');
    els.overlay.classList.toggle('hidden');
}

function clearAllData() {
    if (confirm("This will delete all history and favorites. Are you sure?")) {
        localStorage.clear();
        location.reload();
    }
}

// --- Export Functions ---

function exportTxt() {
    if (!state.currentRefinement) return;
    const { taglines, plot, characters, world } = state.currentRefinement;
    const content = `STORY REFINEMENT EXPORT\n\nTAGLINES:\n${taglines.join('\n')}\n\nPLOT:\n${plot}\n\nCHARACTERS:\n${characters}\n\nWORLD:\n${world}`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `story-refinement-${Date.now()}.txt`;
    a.click();
}

async function exportPdf() {
    if (!state.currentRefinement) return;
    const doc = new jsPDF();
    const { taglines, plot, characters, world } = state.currentRefinement;
    
    doc.setFontSize(20);
    doc.text("Story Refinement", 20, 20);
    
    doc.setFontSize(12);
    let y = 40;
    
    const lines = [
        "TAGLINES:", ...taglines, "",
        "PLOT:", plot, "",
        "CHARACTERS:", characters, "",
        "WORLD:", world
    ];

    lines.forEach(line => {
        const splitText = doc.splitTextToSize(line, 170);
        splitText.forEach(t => {
            if (y > 280) { doc.addPage(); y = 20; }
            doc.text(t, 20, y);
            y += 7;
        });
    });

    doc.save(`story-refinement-${Date.now()}.pdf`);
}

// Start
init();