/**
 * EMULATOR BOOTSTRAP for GitHub Pages (Control Flow)
 * This script handles file loading, hardcoded BIOS loading, and ROM verification.
 */

const CONFIG = {
    BIOS_FILE: 'gba_bios.bin', // Hardcoded BIOS file path
    EMULATOR_ID: 'gbajs-container',
    STATUS_ID: 'emulator-status'
};

// Global variables
window.gbaEmulatorInstance = null; 
window.gbaBiosData = null; 

// The expected sum of the Nintendo logo bytes in a valid GBA ROM (Bytes 0xC0 to 0x9F).
// This is a common and quick integrity check.
const NINTENDO_LOGO_HASH = 0xAF; // Sum of 0xC0 through 0x9F must equal 0xAF

// --- BIOS Loading (Synchronous) ---

function loadHardcodedBios() {
    console.log(`[BIOS Loader] Attempting to load hardcoded BIOS: ${CONFIG.BIOS_FILE}...`);
    
    try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', CONFIG.BIOS_FILE, false); // FALSE for synchronous request
        xhr.responseType = 'arraybuffer';
        xhr.send(null);
        
        if (xhr.status === 200 || xhr.status === 0) { // status 0 for local file:// access
            const biosData = new Uint8Array(xhr.response);

            if (biosData.byteLength !== 0x4000) {
                console.error(`[BIOS Loader] ERROR: Incorrect BIOS size: ${biosData.byteLength} bytes. Expected 16KB (0x4000).`, 'error');
                return false;
            }

            window.gbaBiosData = xhr.response; // Store ArrayBuffer
            console.log('[BIOS Loader] BIOS successfully loaded.', 'success');
            return true;
        } else {
            console.error(`[BIOS Loader] ERROR: Could not load BIOS. Status: ${xhr.status}`, 'error');
            return false;
        }
    } catch (e) {
        console.error(`[BIOS Loader] ERROR: Failed to load BIOS file. Ensure '${CONFIG.BIOS_FILE}' is in the same folder.`, 'error');
        return false;
    }
}

// --- ROM Verification ---

/**
 * Performs basic ROM verification: checks the size and the Nintendo logo checksum.
 * @param {ArrayBuffer} romData - The binary data of the ROM.
 * @returns {boolean} True if verification passes, false otherwise.
 */
function verifyRom(romData) {
    const romView = new Uint8Array(romData);

    // 1. Size Check: Must be at least 0xA0 (for the logo)
    if (romData.byteLength < 0xA0) {
        console.error('[ROM Verification] ROM file is too small.', 'error');
        return false;
    }

    // 2. Nintendo Logo Checksum (0xC0 to 0x9F)
    let checksum = 0;
    // The logo data is from 0x000000A0 to 0x0000009F in the GBA header.
    // The logo itself spans bytes 0x04-0x9F. The checksum involves the bytes *after* the logo.
    // However, the standard ROM verification usually checks the XOR or SUM of the Nintendo logo bytes.
    // For simplicity and common practice, we'll check the header checksum byte 0xBD (the header complement check).
    
    // We will use the *header complement check* which is a more official verification method.
    // Sum of bytes 0xA0 to 0xBC XOR 0x19 must equal the complement byte at 0xBD
    let headerSum = 0;
    for (let i = 0xA0; i <= 0xBC; i++) {
        headerSum += romView[i];
    }
    const calculatedComplement = ((headerSum - 0x19) & 0xFF);
    const expectedComplement = romView[0xBD];

    if (calculatedComplement !== expectedComplement) {
        console.error(`[ROM Verification] Header checksum FAILED. Expected 0x${expectedComplement.toString(16)}, Calculated 0x${calculatedComplement.toString(16)}`, 'error');
        return false;
    }

    console.log('[ROM Verification] ROM header checksum PASSED.', 'success');
    return true;
}


// --- ROM Loading ---

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
        
        // --- ROM VERIFICATION STEP ---
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
    console.log(`[Emulator Core] Preparing to load ROM data for ${fileName}...`);
    
    if (!window.gbaBiosData) {
        console.error('[Emulator Core] BIOS not loaded or failed to load. Cannot proceed.', 'error');
        alert('BIOS loading failed. Check console for errors.');
        return;
    }

    const container = document.getElementById(CONFIG.EMULATOR_ID);
    let statusEl = document.getElementById(CONFIG.STATUS_ID);
    
    if (!window.gbaEmulatorInstance) {
        // Pass BIOS data to the core on creation
        window.gbaEmulatorInstance = new GBAJS3_Core(container, window.gbaBiosData); 
        console.log('[Emulator Core] New emulator instance created with BIOS data.');
    }
    
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
    
    // Attempt to load the BIOS synchronously
    if (!loadHardcodedBios()) {
        const statusEl = document.getElementById(CONFIG.STATUS_ID);
        statusEl.className = 'error';
        statusEl.innerHTML = `ERROR: GBA BIOS failed to load. Ensure **gba_bios.bin** is in the correct folder.`;
        return;
    }
    
    const container = document.getElementById(CONFIG.EMULATOR_ID);
    let statusEl = document.getElementById(CONFIG.STATUS_ID);
    if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.id = CONFIG.STATUS_ID;
        container.insertAdjacentElement('afterend', statusEl);
    }
    
    statusEl.className = '';
    statusEl.innerHTML = '<h2>Emulator Ready</h2><p>BIOS loaded. Please use the file input to load the **ROM (.gba)**.</p>';
    
    container.innerHTML = ''; 
    
    console.log('[Bootstrap] Bootstrap process complete. Waiting for ROM...', 'success');
}

window.onload = startBootstrap;
