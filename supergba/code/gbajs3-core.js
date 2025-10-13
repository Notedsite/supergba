// gbajs3-core.js

// ... (constructor function) ...
    constructor(containerElement) {
        // ... (variables remain the same) ...

        // 1. Create the screen/canvas element
        this.screen = document.createElement('canvas');
        this.screen.width = 240; 
        this.screen.height = 160;
        // ... (styles remain the same) ...
        
        // 2. Clear the container and append the canvas
        this.container.innerHTML = ''; // Ensure container is clean
        this.container.appendChild(this.screen);
        
        // 3. Draw a placeholder message on the canvas
        const ctx = this.screen.getContext('2d');
        // ... (placeholder drawing remains the same) ...
        console.log('[GBAJS3_Core] Core display created and initialized.', 'success');
    }

    /**
     * Loads the ROM data into the core and starts the game loop.
     */
    loadRom(romData) {
        if (!romData || romData.byteLength === 0) {
            console.error('[GBAJS3_Core] Cannot load empty ROM data.', 'error');
            return;
        }

        // ... (variables remain the same) ...
        
        // Mock: Clear the canvas and display a "running" message
        const ctx = this.screen.getContext('2d');
        
        // *** FIX: Clear the canvas explicitly before drawing the new scene ***
        ctx.clearRect(0, 0, 240, 160);
        
        ctx.fillStyle = '#006400'; // Dark Green
        ctx.fillRect(0, 0, 240, 160);
        // ... (text drawing remains the same) ...
        
        console.log(`[GBAJS3_Core] Loaded ROM data (${romData.byteLength} bytes) and started main loop.`, 'success');
    }
}
