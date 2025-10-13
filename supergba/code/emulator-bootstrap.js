/**
 * EMULATOR BOOTSTRAP for GitHub Pages
 * This script initializes the emulator environment and handles ROM loading only after user input.https://troyschools.schoology.com/course/7944882501/materials
 */

const CONFIG = {
    SAVE_PATH: 'gbajs_saves/',    // Key for local storage or IndexedDB
    EMULATOR_ID: 'gbajs-container' // ID of the HTML element to host the emulator
};

// Global variable to hold the emulator instance (e.g., your GBAJS3 object)
window.gbaEmulatorInstance = null; 

// --- Core Bootstrap Functions ---

/** 1. Checks for basic browser requirements (modern features). */
function checkCompatibility() {
    console.log('[Bootstrap] Checking browser compatibility...');
    
    const requiredFeatures = ['indexedDB', 'localStorage', 'WebAssembly'];
    let compatible = true;

    for (const feature of requiredFeatures) {
        if (!window[feature]) {
            console.error(`[Bootstrap] ERROR: Missing required feature: ${feature}.`);
            compatible = false;
        }
    }

    if (!compatible) {
        const message = 'ERROR: Your browser is too old or lacks necessary features for emulation.';
        document.getElementById(CONFIG.EMULATOR_ID).innerHTML = `<p class="error">${message}</p>`;
        return false;
    }
    
    console.log('[Bootstrap] Browser check passed.', 'success');
    return true;
}

/** 2. Simulates creation of default "directories" (i.e., local storage keys). */
function createDefaultStorage() {
    console.log('[Bootstrap] Simulating default storage creation...');
    
    try {
        if (!localStorage.getItem('bootstrapped')) {
            localStorage.setItem('bootstrapped', new Date().toISOString());
            console.log(`[Bootstrap] Initializing storage path: ${CONFIG.SAVE_PATH}`, 'success');
        } else {
            console.log(`[Bootstrap] Storage path already exists: ${CONFIG.SAVE_PATH}`);
        }
        return true;
    } catch (e) {
        console.error('[Bootstrap] Failed to access local storage. Check browser settings.');
        return false;
    }
}

/** 3. Initializes the main emulator object and prepares the UI (NO ROM LOADING YET). */
function initializeEmulator() {
    console.log('[Bootstrap] Initializing emulator core...');
    
    const container = document.getElementById(CONFIG.EMULATOR_ID);
    if (!container) {
        console.error(`[Bootstrap] FATAL: Emulator host element with ID "${CONFIG.EMULATOR_ID}" not found.`);
        return;
    }

    // --- INSTANTIATE YOUR EMULATOR OBJECT HERE ---
    // Example: window.gbaEmulatorInstance = new GBAJS3(container);
    // (You would need to include your GBAJS3 library script, e.g., <script src="gbajs3.js"></script>)

    // Update the container to show it's ready for input
    container.innerHTML = '<h2>Emulator Ready</h2><p>Please use the input above to load a game ROM.</p>';
    console.log('[Bootstrap] Emulator instance ready for ROM input.', 'success');
}


// --- ROM Loading Functionality ---

/**
 * Reads a ROM file selected by the user and passes it to the emulator core.
 * @param {FileList} files - The FileList object from the <input type="file"> event.
 */
window.loadRomFromFile = function(files) {
    if (files.length === 0) {
        console.log('[ROM Loader] No file selected.');
        return;
    }

    const file = files[0];
    const fileName = file.name;
    const fileExtension = fileName.slice(((fileName.lastIndexOf(".") - 1) >>> 0) + 2).toLowerCase();
    
    // Basic validation
    if (fileExtension !== 'gba' && fileExtension !== 'zip') {
        console.error(`[ROM Loader] Invalid file type: ${fileExtension}. Please select a .gba or .zip file.`, 'error');
        alert('Invalid file type. Please select a .gba or .zip file.');
        return;
    }

    console.log(`[ROM Loader] Selected file: ${fileName} (${file.size} bytes)`);

    // Use FileReader to read the file contents as an ArrayBuffer
    const reader = new FileReader();

    reader.onload = function(event) {
        const romData = event.target.result; // This is the ArrayBuffer containing the ROM
        console.log('[ROM Loader] File successfully read into memory.');
        
        // Pass Data to the Emulator Core
        loadRomDataIntoEmulator(romData, fileName);
    };

    reader.onerror = function(event) {
        console.error(`[ROM Loader] Error reading file: ${event.target.error.name}`, 'error');
    };

    reader.readAsArrayBuffer(file);
}


/**
 * Placeholder function to integrate with the actual emulator library.
 * @param {ArrayBuffer} romData - The binary data of the ROM.
 * @param {string} fileName - The name of the ROM file.
 */
function loadRomDataIntoEmulator(romData, fileName) {
    console.log(`[Emulator Core] Loading ROM data for ${fileName}...`);
    
    const container = document.getElementById(CONFIG.EMULATOR_ID);
    
    // Check if the emulator instance exists (it should, after initializeEmulator)
    // if (window.gbaEmulatorInstance && typeof window.gbaEmulatorInstance.loadRom === 'function') {
    //     window.gbaEmulatorInstance.loadRom(romData);
    //     container.innerHTML = `<h2 class="success">${fileName} loaded! Game running.</h2>`;
    // } else {
    //     console.error('[Emulator Core] Emulator instance not ready or loadRom function missing.', 'error');
    // }

    // Placeholder confirmation:
    container.innerHTML = `<h2 class="success">ROM Loaded: ${fileName}</h2><p>The game would be running now!</p>`;
    console.log('[Emulator Core] ROM data passed to core successfully.', 'success');
}


// --- Main Execution Flow ---
function startBootstrap() {
    console.log('[Bootstrap] Starting client-side bootstrap...');
    
    if (!checkCompatibility()) return;
    if (!createDefaultStorage()) return;
    
    initializeEmulator(); // Sets up the instance and UI, but DOES NOT load a ROM
    
    console.log('[Bootstrap] Bootstrap process complete.', 'success');
}

// Start the whole process once the page structure is loaded
window.onload = startBootstrap;
