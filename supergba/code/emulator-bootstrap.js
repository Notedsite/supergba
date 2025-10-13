/**
 * EMULATOR BOOTSTRAP for GitHub Pages (Control Flow)
 * This script handles asynchronous BIOS loading, ROM verification, and core startup.
 */

const CONFIG = {
    BIOS_FILE: 'gba_bios.bin', 
    EMULATOR_ID: 'gbajs-container',
    STATUS_ID: 'emulator-status'
};

window.gbaEmulatorInstance = null; 
window.gbaBiosData = null; 

// --- Bootstrap Utility Functions ---

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
    if (compatible) {
        console.log('[Bootstrap] Browser check passed.', 'success');
    }
    return compatible;
}

function createDefaultStorage() {
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

// --- BIOS Loading (Using modern Async/Await with Fetch) ---

async function loadHardcodedBios() {
    console.log(`[BIOS Loader] Attempting to load hardcoded BIOS: ${CONFIG.BIOS_FILE}...`);
    
    try {
        const response = await fetch(CONFIG.BIOS_FILE);
        
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const biosData = new Uint8Array(arrayBuffer);

        if (biosData.byteLength !== 0x4000) {
            console.error(`[BIOS Loader] ERROR: Incorrect BIOS size: ${biosData.byteLength} bytes. Expected 16KB (0x4000).`, 'error');
            return false;
        }

        window.gbaBiosData = arrayBuffer; // Store ArrayBuffer
        console.log('[BIOS Loader] BIOS successfully loaded.', 'success');
        return true;
    } catch (e) {
        console.error(`[BIOS Loader] ERROR: Failed to load BIOS file. Ensure '${CONFIG.BIOS_FILE}' is in the same folder. Error: ${e.message}`, 'error');
        return false;
    }
}

// --- ROM Verification (Header Checksum) ---

function verifyRom(romData) {
    const romView = new Uint8Array(romData);

    if (romData.byteLength < 0xBD + 1) {
        console.error('[ROM Verification] ROM file is too small to contain a valid header.', 'error');
        return false;
    }

    // Header Complement Check (0xA0 to 0xBC, check byte 0xBD)
    let checkSum = 0;
    for (let i = 0xA0; i < 0xBD; i++) {
        checkSum = (checkSum + romView[i]) & 0xFF;
    }
    
    // Checksum formula: Sum(0xA0..0xBC) + 0xBD byte + 0x19 should be 0 mod 256
    const calculatedComplement = (0x100 - checkSum - 0x19) & 0xFF;
    const expectedComplement = romView[0xBD];

    if (calculatedComplement !== expectedComplement) {
        console.error(`[ROM Verification] Header checksum FAILED. Expected 0x${expectedComplement.toString(16)}, Calculated 0x${calculatedComplement.toString(16)}`, 'error');
        return false;
    }

    console.log('[ROM Verification] ROM header checksum PASSED.', 'success');
    return true;
}

// --- Game Title Extraction ---
/**
 * Reads the game title from the ROM header (offset 0xA0).
 * @param {ArrayBuffer} romData - The binary data of the ROM.
 * @returns {string} The game title.
 */
function getGameTitle(romData) {
    const romView = new Uint8Array(romData);
    const TITLE_OFFSET = 0xA0;
    const TITLE_LENGTH = 12;
    let title = '';

    if (romData.byteLength < TITLE_OFFSET + TITLE_LENGTH) {
        return "Unknown Title (Header too short)";
    }

    for (let i = 0; i < TITLE_LENGTH; i++) {
        const byte = romView[TITLE_OFFSET + i];
        
        // Stop at the null terminator (0x00)
        if (byte === 0x00) {
            break;
        }
        
        // Convert ASCII byte to character
        title += String.fromCharCode(byte);
    }
    
    return title.trim();
}


// --- ROM Loading and Core Execution (Corrected) ---

window.loadRomFromFile = function(files) {
    if (files.length === 0) return;

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
        const romData = event.target.result;
        
        if (!verifyRom(romData)) {
            alert('ROM verification failed. The file may be corrupt or not a valid GBA ROM.');
            return;
        }

        loadRomDataIntoEmulator(romData, fileName);
    };

    reader.onerror = function(event) {
        console.error(`[ROM Loader] Error reading file: ${event.target.error.name}`, 'error');
    };

    reader.readAsArrayBuffer(file);
}


function loadRomDataIntoEmulator(romData, fileName) {
    
    if (!window.gbaBiosData) {
        console.error('[Emulator Core] BIOS not loaded. Cannot proceed.', 'error');
        alert('BIOS loading failed. Check console for errors.');
        return;
    }

    // --- Extract and log the game title ---
    const gameTitle = getGameTitle(romData);
    console.log(`[Emulator Core] Starting game: ${gameTitle}`); 
    
    const container = document.getElementById(CONFIG.EMULATOR_ID);
    let statusEl = document.getElementById(CONFIG.STATUS_ID);
    
    // CRITICAL FIX: Instantiate the core emulator instance
    if (!window.gbaEmulatorInstance && typeof GBAJS3_Core !== 'undefined') {
        // 1. Clear the container's old text right before adding the canvas
        container.innerHTML = ''; 
        
        window.gbaEmulatorInstance = new GBAJS3_Core(container, window.gbaBiosData); 
        console.log('[Emulator Core] New emulator instance created with BIOS data.');
    }
    
    if (window.gbaEmulatorInstance && typeof window.gbaEmulatorInstance.loadRom === 'function') {
        try {
            window.gbaEmulatorInstance.loadRom(romData); 
            
            statusEl.className = 'success';
            statusEl.innerHTML = `Successfully loaded and started: <strong>${gameTitle}</strong> (File: ${fileName})`;
        } catch (e) {
            console.error(`[Emulator Core] Error during ROM loading or starting: ${e.message}`, 'error');
            statusEl.className = 'error';
            statusEl.innerHTML = `Error: Could not start game. Check console for details.`;
        }
    } 
}

// --- Main Execution Flow ---
async function startBootstrap() {
    console.log('[Bootstrap] Starting client-side bootstrap...');
    
    if (!checkCompatibility() || !createDefaultStorage()) return;

    const container = document.getElementById(CONFIG.EMULATOR_ID);
    let statusEl = document.getElementById(CONFIG.STATUS_ID);
    if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.id = CONFIG.STATUS_ID;
        container.insertAdjacentElement('afterend', statusEl);
    }
    
    const biosLoaded = await loadHardcodedBios();

    if (!biosLoaded) {
        statusEl.className = 'error';
        statusEl.innerHTML = `ERROR: GBA BIOS failed to load from **${CONFIG.BIOS_FILE}**. Ensure the file is correctly committed and available on GitHub Pages.`;
        return;
    }
    
    statusEl.className = '';
    statusEl.innerHTML = '<h2>Emulator Ready</h2><p>BIOS loaded. Please use the file input to load the **ROM (.gba)**.</p>';
    
    // Note: The container.innerHTML clearance is now handled inside loadRomDataIntoEmulator
    
    console.log('[Bootstrap] Bootstrap process complete. Waiting for ROM...', 'success');
}

window.onload = startBootstrap;
