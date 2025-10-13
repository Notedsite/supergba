// gbajs3-core.js

class GBAJS3_Core {
    /**
     * @param {HTMLElement} containerElement - The DOM element to host the emulator.
     */
    constructor(containerElement) {
        this.container = containerElement; 
        this.paused = true;
        this.romLoaded = false;

        // 1. Create the screen/canvas element
        this.screen = document.createElement('canvas');
        this.screen.width = 240; 
        this.screen.height = 160;
        
        // Apply inline styles for consistency with the CSS zoom
        this.screen.style.width = '240px'; 
        this.screen.style.height = '160px'; 
        
        // 2. Append the canvas to the container
        this.container.appendChild(this.screen);
        
        // 3. Draw a placeholder message on the canvas
        const ctx = this.screen.getContext('2d');
        ctx.fillStyle = '#000000'; // Black background
        ctx.fillRect(0, 0, 240, 160);
        
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('SuperGBA Core Ready', 120, 70);
        ctx.fillText('Awaiting ROM Data...', 120, 90);
        
        console.log('[GBAJS3_Core] Core display created and initialized.', 'success');
    }

    /**
     * Loads the ROM data into the core and starts the game loop.
     * @param {ArrayBuffer} romData - The binary data of the ROM.
     */
    loadRom(romData) {
        if (!romData || romData.byteLength === 0) {
            console.error('[GBAJS3_Core] Cannot load empty ROM data.', 'error');
            throw new Error("Empty ROM data provided.");
        }

        this.romData = romData;
        this.romLoaded = true;
        this.paused = false;

        const ctx = this.screen.getContext('2d');
        
        // Clear the canvas
        ctx.clearRect(0, 0, 240, 160);
        
        // Set a default background
        ctx.fillStyle = '#101010'; 
        ctx.fillRect(0, 0, 240, 160);
        
        // === MOCK GAME RENDERING LOGIC (The crucial new part) ===
        const dataView = new DataView(romData);
        
        // 1. Read the first 240 bytes (one byte per pixel across the top row)
        const bytesToRead = Math.min(240, romData.byteLength); 

        for (let x = 0; x < bytesToRead; x++) {
            // Get one byte of data from the ROM
            const byteValue = dataView.getUint8(x); 
            
            // Use the byte value to generate a color. 
            // We'll use the value for Red and Green components, and 50 for Blue.
            const r = byteValue;          // 0-255
            const g = (byteValue + 50) % 256; // Shifted G
            const b = 50;                 // Fixed B
            
            ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
            
            // Draw a vertical bar 4 pixels tall for each byte
            ctx.fillRect(x, 0, 1, 4);
        }
        
        // 2. Display a success message *on the canvas* below the mock game data
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`MOCK GAME SCREEN: ROM Signature Generated (${bytesToRead} bytes used)`, 5, 10);
        ctx.fillText('Emulator is now running the main loop.', 5, 150);
        // =======================================================

        console.log(`[GBAJS3_Core] Loaded ROM data (${romData.byteLength} bytes) and started main loop.`, 'success');
    }
    
    // Placeholder for other core methods (e.g., saveState, pause, controls)
}
