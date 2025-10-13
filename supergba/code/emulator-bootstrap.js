/**
 * EMULATOR BOOTSTRAP for GitHub Pages (Control Flow)
 * This script handles file loading, asynchronous BIOS loading, and ROM verification.
 */

const CONFIG = {
    BIOS_FILE: 'gba_bios.bin', // Hardcoded BIOS file path
    EMULATOR_ID: 'gbajs-container',
    STATUS_ID: 'emulator-status'
};

// Global variables
window.gbaEmulatorInstance = null; 
window.gbaBiosData = null; 

// The expected sum of the GBA ROM header complement check.
// Sum of bytes 0xA0 to 0xBC XOR 0x19 must equal the complement byte at 0xBD
// We'll calculate the expected complement based on the ROM data.


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

// --- BIOS Loading (Asynchronous FIX) ---

/**
 * Loads the hardcoded BIOS file asynchronously using XMLHttpRequest.
 * @returns {Promise<boolean>} Resolves true on success, false on failure.
 */
function loadHardcodedBios() {
    return new Promise((resolve) => {
        console.log(`[BIOS Loader] Attempting to load hardcoded BIOS: ${CONFIG.BIOS_FILE} (Async)...`);
        
        const xhr = new XMLHttpRequest();
        xhr.open('GET', CONFIG.BIOS_FILE, true); // TRUE for asynchronous request
        xhr.responseType = 'arraybuffer';
        
        xhr.onload = function() {
            if (xhr.status === 200 || (xhr.status === 0 && xhr.response.byteLength > 0)) {
                const biosData = new Uint8Array(xhr.response);

                if (biosData.byteLength !== 0x4000) {
                    console.error(`[BIOS Loader] ERROR: Incorrect BIOS size: ${biosData.byteLength} bytes. Expected 16KB (0x4000).`, 'error');
                    resolve(false);
                    return;
                }

                window.gbaBiosData = xhr.response; // Store ArrayBuffer
                console.log('[BIOS Loader] BIOS successfully loaded.', 'success');
                resolve(true);
            } else {
                console.error(`[BIOS Loader] ERROR: Could not load BIOS. Status: ${xhr.status}. Check network tab.`, 'error');
                resolve(false);
            }
        };

        xhr.onerror = function() {
            console.error(`[BIOS Loader] ERROR: Network error or file not found. Ensure '${CONFIG.BIOS_FILE}' is in the same folder.`, 'error');
            resolve(false);
        };

        xhr.send();
    });
}

// --- ROM Verification ---

/**
 * Performs basic ROM verification: checks the size and the GBA header complement checksum.
 * @param {ArrayBuffer} romData - The binary data of the ROM.
 * @returns {boolean} True if verification passes, false otherwise.
 */
function verifyRom(romData) {
    const romView = new Uint8Array(romData);

    // 1. Size Check: Must be large enough to contain the header
    if (romData.byteLength < 0xBD + 1) {
        console.error('[ROM Verification] ROM file is too small to contain a valid header.', 'error');
        return false;
    }

    // 2. Header Complement Check (0xA0 to 0xBC, check byte 0xBD)
    let headerSum = 0;
    for (let i = 0xA0; i <= 0xBC; i++) {
        headerSum += romView[i];
    }
    // GBA header checksum formula: (sum of 0xA0..0xBC) XOR 0x19 must equal 0xBD
    // So, we expect: romView[0xBD] = ((headerSum & 0xFF) - 0x19) & 0xFF
    
    // The actual formula for the byte at 0xBD is: 
    // The sum of bytes 0xA0 to 0xBC (inclusive) modulo 256, PLUS the byte at 0xBD 
    // should result in 0x19 modulo 256.
    
    // A simpler way: The complement byte is set such that the checksum (sum of 0xA0-0xBC + 0xBD) is 0x19 mod 256.
    
    // For verification: (Sum(0xA0..0xBC) + romView[0xBD] + 0x19) MOD 256 should be 0.
    // However, the standard implementation usually checks:
    let checkSum = 0;
    for (let i = 0xA0; i < 0xBD; i++) {
        checkSum = (checkSum + romView[i]) & 0xFF;
    }
    const calculatedComplement = (0x100 - checkSum - 0x19) & 0xFF;
    const expectedComplement = romView[0xBD];

    if (calculatedComplement !== expectedComplement) {
        console.error(`[ROM Verification] Header checksum FAILED. Expected 0x${expectedComplement.toString(16)}, Calculated 0x${calculatedComplement.toString(16)}`, 'error');
        return false;
    }

    console.log('[ROM Verification] ROM header checksum PASSED.', 'success');
    return true;
}


// --- ROM Loading and Core Execution ---

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
        console.error('[Emulator Core] BIOS not loaded. Cannot proceed.', 'error');
        alert('BIOS loading failed. Check console for errors.');
        return;
    }

    const container = document.getElementById(CONFIG.EMULATOR_ID);
    let statusEl = document.getElementById(CONFIG.STATUS_ID);
    
    if (!window.gbaEmulatorInstance) {
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

// --- Main Execution Flow (Async) ---
async function startBootstrap() {
    console.log('[Bootstrap] Starting client-side bootstrap...');
    
    if (!checkCompatibility() || !createDefaultStorage()) return;

    const statusEl = document.getElementById
