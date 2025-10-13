/**
 * EMULATOR BOOTSTRAP for GitHub Pages (Control Flow)
 * This script handles file loading and initiates the emulator.
 */

const CONFIG = {
    EMULATOR_ID: 'gbajs-container',
    STATUS_ID: 'emulator-status'
};

window.gbaEmulatorInstance = null; 
window.gbaBiosData = null; // Global variable to hold the BIOS data

// --- Core Bootstrap Functions (Run on Page Load) ---

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

function createDefaultStorage() {
    // Basic local storage check (can be expanded later)
    try {
        localStorage.setItem('bootstrapped', new Date().toISOString());
        localStorage.removeItem('bootstrapped');
        console.log('[Bootstrap] Local storage access verified.', 'success');
        return true;
    } catch (e) {
        console.error('[Bootstrap] Failed to access local storage. Saves will not work.');
        return false;
    }
}

// --- BIOS Loading ---

window.loadBiosFromFile = function(files) {
    if (files.length === 0) return;

    const file = files[0];
    const fileName = file.name;
    const fileExtension = fileName.slice(((fileName.lastIndexOf(".") - 1) >>> 0) + 2).toLowerCase();
    
    if (fileExtension !== 'bin') {
        console.error(`[BIOS Loader] Invalid file type: ${fileExtension}. Please select a .bin file.`, 'error');
        alert('Invalid file type. Please select a .bin file.');
        return;
    }

    const reader = new FileReader();

    reader.onload = function(event) {
        const biosData = new Uint8Array(event.target.result);
        
        // CRITICAL CHECK: BIOS must be 16KB (0x4000 bytes)
        if (biosData.byteLength !== 0x4000) {
            console.error(`[BIOS Loader] Incorrect BIOS size: ${biosData.byteLength} bytes. Expected 16KB (0x4000).`, 'error');
            alert('Incorrect BIOS size. Please use a standard 16KB GBA BIOS.');
            return;
        }

        window.gbaBiosData = event.target.result; // Store ArrayBuffer
        console.log('[BIOS Loader] BIOS successfully loaded.', 'success');
    };

    reader.onerror = function(event) {
        console.error(`[BIOS Loader] Error reading file: ${event.target.error.name}`, 'error');
    };

    reader.readAsArrayBuffer(file);
}

// --- ROM Loading ---

window.loadRomFromFile = function(files) {
    if (files.length === 0) {
        console.log('[ROM Loader] No file selected.');
        return;
    }

    const file = files[0];
    const fileName = file.name;
    const fileExtension = fileName.slice(((fileName.lastIndexOf(".") - 1) >>> 0) + 2).toLowerCase();
    
    if (fileExtension !== 'gba') {
        console.error(`[ROM Loader] Invalid file type: ${fileExtension}. Please select a .gba file.`, 'error');
        alert('Invalid file type. Please select a .gba file.');
        return;
    }

    console.log(`[ROM Loader] Selected file: ${fileName} (${file.size} bytes)`);

    const reader = new FileReader();

    reader.onload = function(event) {
        loadRomDataIntoEmulator(event.target.result, fileName);
    };

    reader.onerror = function(event) {
        console.error(`[ROM Loader] Error reading file: ${event.target.error.name}`, 'error');
    };

    reader.readAsArrayBuffer(file);
}


function loadRomDataIntoEmulator(romData, fileName) {
    console.log(`[Emulator Core] Preparing to load ROM data for ${fileName}...`);
    
    // NEW CHECK: Must have BIOS loaded before starting emulator
    if (!window.gbaBiosData) {
        console.error('[Emulator Core] BIOS not loaded. Please load the gba_bios.bin first.', 'error');
        alert('Please load the GBA BIOS file (.bin) first.');
        return;
    }

    const container = document.getElementById(CONFIG.EMULATOR_ID);
    let statusEl = document.getElementById(CONFIG.STATUS_ID);
    
    // 1. CREATE THE EMULATOR INSTANCE (Pass BIOS data to it)
    if (!window.gbaEmulatorInstance) {
        window.gbaEmulatorInstance = new GBAJS3_Core(container, window.gbaBiosData); 
        console.log('[Emulator Core] New emulator instance created with BIOS data.');
    }
    
    // 2. LOAD THE ROM AND START EXECUTION
    if (window.gbaEmulatorInstance && typeof window.gbaEmulatorInstance.loadRom === 'function') {
        try {
            window.gbaEmulatorInstance.loadRom(romData); 
            
            statusEl.className = 'success';
            statusEl.innerHTML = `Successfully loaded and started: <strong>${fileName}</strong>`;
        } catch (e) {
            console.error(`[Emulator Core] Error during ROM loading or starting: ${e.message}`, 'error');
            statusEl.className = 'error';
            statusEl.innerHTML = `Error: Could not start game. Check console for details.`;
        }
    } 
}

// --- Main Execution Flow ---
function startBootstrap() {
    console.log('[Bootstrap] Starting client-side bootstrap...');
    
    if (!checkCompatibility()) return;
    if (!createDefaultStorage()) return;
    
    const container = document.getElementById(CONFIG.EMULATOR_ID);
    
    let statusEl = document.getElementById(CONFIG.STATUS_ID);
    if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.id = CONFIG.STATUS_ID;
        container.insertAdjacentElement('afterend', statusEl);
    }
    
    statusEl.className = '';
    statusEl.innerHTML = '<h2>Emulator Ready</h2><p>Please use the file inputs to load the **BIOS (.bin)** and then the **ROM (.gba)**.</p>';
    
    container.innerHTML = ''; 
    
    console.log('[Bootstrap] Bootstrap process complete. Waiting for files...', 'success');
}

window.onload = startBootstrap;
