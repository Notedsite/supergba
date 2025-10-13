/**
 * GBAJS3_Core - Mock Emulator Library
 * * This class provides the display surface (canvas) and the public methods 
 * that the bootstrap script expects, allowing the architecture to function.
 */
class GBAJS3_Core {
    /**
     * Constructor: Initializes the emulator, creating the display canvas inside the container.
     * @param {HTMLElement} containerElement The <div> element where the emulator screen will go.
     */
    constructor(containerElement) {
        this.container = containerElement;
        this.isRunning = false;

        // 1. Create the screen/canvas element
        this.screen = document.createElement('canvas');
        this.screen.width = 240; // GBA native resolution
        this.screen.height = 160;
        this.screen.style.border = '2px solid #333';
        this.screen.style.backgroundColor = '#111';
        this.screen.style.display = 'block';
        
        // 2. Clear the container and append the canvas
        this.container.innerHTML = '';
        this.container.appendChild(this.screen);
        
        // 3. Draw a placeholder message on the canvas
        const ctx = this.screen.getContext('2d');
        ctx.fillStyle = '#FFF';
        ctx.font = '12px sans-serif';
        ctx.fillText('CORE READY. Awaiting ROM...', 10, 80);

        console.log('[GBAJS3_Core] Core display created and initialized.', 'success');
    }

    /**
     * Loads the ROM data into the core and starts the game loop.
     * @param {ArrayBuffer} romData The binary data of the ROM.
     */
    loadRom(romData) {
        if (!romData || romData.byteLength === 0) {
            console.error('[GBAJS3_Core] Cannot load empty ROM data.', 'error');
            return;
        }

        this.isRunning = true;
        
        // --- THIS IS WHERE YOUR REAL EMULATION LOGIC STARTS ---
        // The game would start drawing to 'this.screen' here.

        // Mock: Clear the canvas and display a "running" message
        const ctx = this.screen.getContext('2d');
        ctx.fillStyle = '#006400'; // Dark Green
        ctx.fillRect(0, 0, 240, 160);
        ctx.fillStyle = '#FFF';
        ctx.font = '14px sans-serif';
        ctx.fillText('GAME RUNNING...', 10, 60);
        ctx.fillText(`File Size: ${romData.byteLength} bytes`, 10, 90);
        
        console.log(`[GBAJS3_Core] Loaded ROM data (${romData.byteLength} bytes) and started main loop.`, 'success');
    }
}
