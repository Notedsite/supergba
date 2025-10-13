/**
 * EMULATOR BOOTSTRAP for GitHub Pages (Control Flow)
 * This script handles browser compatibility, storage setup, and initiates the 
 * emulator ONLY after the user has successfully uploaded a ROM file.
 */

// Global configuration 
const CONFIG = {
    SAVE_PATH: 'gbajs_saves/',    // Key for local storage or IndexedDB
    EMULATOR_ID: 'gbajs-container' // ID of the HTML element to host the emulator
};

// Global variable to hold the emulator instance
window.gbaEmulatorInstance = null; 

// --- Core Bootstrap Functions (Run on Page Load) ---

/** Checks for basic browser requirements (modern features). */
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

/** Simulates creation of default "directories" (i.e., local storage keys for saves). */
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

// --- ROM Loading Functionality (Triggered by User Input) ---

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
    
    // Validation check for supported file types
    if (fileExtension !== 'gba' && fileExtension !== 'zip') {
        console.error(`[ROM Loader] Invalid file type: ${fileExtension}. Please select a .gba or .zip file.`, 'error');
        alert('Invalid file type. Please select a .gba or .zip file.');
        return;
    }

    console.log(`[ROM Loader] Selected file: ${fileName} (${file.size} bytes)`);

    // Use FileReader to read the file contents as an ArrayBuffer
    const reader = new FileReader();

    reader.onload = function(event) {
        const romData = event.target.result; // ArrayBuffer containing the ROM
        console.log('[ROM Loader] File successfully read into memory.');
        
        // Pass Data to the Emulator Core
        loadRomDataIntoEmulator(romData, fileName);
    };

    reader.onerror = function(event) {
        console.error(`[ROM Loader] Error reading file: ${event.target.error.name}`, 'error');
    };

    // Start reading the file
    reader.readAsArrayBuffer(file);
}


/**
 * Creates the emulator instance (if it doesn't exist) and loads the ROM data.
 * This function is called ONLY when the ROM data is fully read from the file.
 * @param {ArrayBuffer} romData - The binary data of the ROM.
 * @param {string} fileName - The name of the ROM file.
 */
function loadRomDataIntoEmulator(romData, fileName) {
    console.log(`[Emulator Core] Preparing to load ROM data for ${fileName}...`);
    
    const container = document.getElementById(CONFIG.EMULATOR_ID);
    
    // 1. CREATE THE EMULATOR INSTANCE (Only once)
    if (!window.gbaEmulatorInstance) {
         // Instantiate the core class we defined in gbajs3-core.js
         window.gbaEmulatorInstance = new GBAJS3_Core(container); 
         console.log('[Emulator Core] New emulator instance created.');
    } else {
        // If we are reloading a ROM, ensure the canvas is visible
        if (window.gbaEmulatorInstance.screen) {
            container.innerHTML = '';
            container.appendChild(window.gbaEmulatorInstance.screen);
        }
    }

    // 2. LOAD THE ROM AND START EXECUTION
    
    if (window.gbaEmulatorInstance && typeof window.gbaEmulatorInstance.loadRom === 'function') {
        try {
            window.gbaEmulatorInstance.loadRom(romData); 
            
            // Success message displayed outside the canvas
            container.innerHTML += `<div class="success">Successfully loaded and started: ${fileName}</div>`;
        } catch (e) {
            console.error(`[Emulator Core] Error during ROM loading or starting: ${e.message}`, 'error');
            container.innerHTML += `<p class="error">Error: Could not start game. Check console for details.</p>`;
        }
    } 
}

// --- Main Execution Flow ---
function startBootstrap() {
    console.log('[Bootstrap] Starting client-side bootstrap...');
    
    if (!checkCompatibility()) return;
    if (!createDefaultStorage()) return;
    
    // Update UI to show we're ready for input
    document.getElementById(CONFIG.EMULATOR_ID).innerHTML = '<h2>Emulator Ready</h2><p>Please use the **"Select a ROM"** button to start a game.</p>';
    
    console.log('[Bootstrap] Bootstrap process complete. Waiting for ROM file...', 'success');
}

// Start the whole process once the page structure is loaded
window.onload = startBootstrap;
