// gbajs3-core.js

class GBAJS3_Core {
    /**
     * @param {HTMLElement} containerElement - The DOM element to host the emulator.
     */
    constructor(containerElement) {
        this.container = containerElement; 
        // Mock variables
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
        // The container is expected to be cleared by the bootstrap before this call
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

        // Mock: Clear the canvas and display a "running" message
        const ctx = this.screen.getContext('2d');
        
        // FIX: Clear the canvas explicitly before drawing the new scene
        ctx.clearRect(0, 0, 240, 160);
        
        ctx.fillStyle = '#006400'; // Dark Green (Simulating GBA splash/boot)
        ctx.fillRect(0, 0, 240, 160);
        
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Game is Running!', 120, 70);
        ctx.fillText(`ROM Size: ${romData.byteLength} bytes`, 120, 90);
        
        // Mock: Start a game loop (in a real emulator, this would be requestAnimationFrame)
        // setInterval(() => { /* run cpu cycle */ }, 16); 

        console.log(`[GBAJS3_Core] Loaded ROM data (${romData.byteLength} bytes) and started main loop.`, 'success');
    }
    
    // Placeholder for other core methods (e.g., saveState, pause, controls)
    // saveState() { /* ... */ }
    // pause() { this.paused = true; }
}
