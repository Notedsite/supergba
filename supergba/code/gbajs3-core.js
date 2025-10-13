// gbajs3-core.js

class GBAJS3_Core {
    /**
     * @param {HTMLElement} containerElement - The DOM element to host the emulator.
     */
    constructor(containerElement) {
        this.container = containerElement;
        this.paused = true;
        this.romLoaded = false;
        this.frameCounter = 0;
        this.animationFrameId = null;

        // --- 1. GBA Memory Map Setup (Stubs) ---
        // A. WORK RAM (32-bit access)
        this.ewram = new Uint8Array(0x40000); // 256KB External Work RAM (Fast)
        this.iwram = new Uint8Array(0x8000);  // 32KB Internal Work RAM (Faster)

        // B. PPU RAM (Dedicated access)
        this.vram = new Uint8Array(0x18000); // 96KB Video RAM
        this.paletteRAM = new Uint8Array(0x400); // 1KB Palette RAM
        this.oam = new Uint8Array(0x400); // 1KB Object Attribute Memory

        // C. I/O REGISTERS (Controls everything)
        // We'll use a DataView to handle 16-bit and 32-bit register access easily.
        this.ioRegs = new ArrayBuffer(0x400); // Mapped at 0x04000000
        this.ioRegsView = new DataView(this.ioRegs);

        // Define the KEYINPUT register address (relative to IO base 0x04000000)
        this.KEYINPUT_ADDR = 0x130; // Address 0x4000130

        // --- 2. Input Setup ---
        this.KEY_MAP = {
            // Note: GBA buttons are active LOW (0 means pressed, 1 means released)
            'z': 0x0001,      // A (Bit 0)
            'x': 0x0002,      // B (Bit 1)
            'Enter': 0x0008,  // Start (Bit 3)
            'Shift': 0x0004,  // Select (Bit 2)
            'ArrowRight': 0x0010, // Right (Bit 4)
            'ArrowLeft': 0x0020,  // Left (Bit 5)
            'ArrowUp': 0x0040,    // Up (Bit 6)
            'ArrowDown': 0x0080,  // Down (Bit 7)
            'a': 0x0100,      // R Shoulder (Bit 8)
            's': 0x0200       // L Shoulder (Bit 9)
        };
        // Initial state: All keys released (0xFFFF)
        this.keyInputRegister = 0xFFFF;


        // --- 3. Display Setup ---
        this.screen = document.createElement('canvas');
        this.screen.width = 240;
        this.screen.height = 160;
        this.screen.style.width = '240px';
        this.screen.style.height = '160px';

        this.container.appendChild(this.screen);
        this.ctx = this.screen.getContext('2d');

        // Create the frame buffer for PPU to draw to (240*160 pixels * 4 bytes/pixel)
        this.frameBuffer = this.ctx.createImageData(240, 160);
        this.frameData = this.frameBuffer.data; // A Uint8ClampedArray for easy access

        this.drawPlaceholder();
        this.setupInputHandlers();
        
        console.log('[GBAJS3_Core] Core display and memory stubs initialized.');
    }

    /** Draws the initial black screen and text. */
    drawPlaceholder() {
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, 240, 160);
        
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.font = '12px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('SuperGBA Core Ready', 120, 70);
        this.ctx.fillText('Awaiting ROM Data...', 120, 90);
    }

    // ------------------------------------------------------------------
    // --- Input Handling (Now writes to the I/O Register) ---
    // ------------------------------------------------------------------
    setupInputHandlers() {
        document.addEventListener('keydown', (e) => this.handleInput(e, true));
        document.addEventListener('keyup', (e) => this.handleInput(e, false));
    }

    handleInput(event, isKeyDown) {
        const keyBit = this.KEY_MAP[event.key];
        if (keyBit) {
            event.preventDefault(); // Stop default browser behavior

            // Write the new key state to the I/O register (KEYINPUT)
            if (isKeyDown) {
                // Key pressed: Set the corresponding bit to 0 (Active LOW)
                this.keyInputRegister &= ~keyBit;
            } else {
                // Key released: Set the corresponding bit to 1
                this.keyInputRegister |= keyBit;
            }
            
            // Now, write the new state to the emulated I/O register space (Little Endian)
            // The GBA CPU will read this 16-bit value from 0x4000130
            this.ioRegsView.setUint16(this.KEYINPUT_ADDR, this.keyInputRegister, true);
            
            // Log for debugging
            // console.log(`[Input] Key ${event.key} ${isKeyDown ? 'pressed' : 'released'}. KEYINPUT: ${this.keyInputRegister.toString(16).padStart(4, '0')}`);
        }
    }

    // ------------------------------------------------------------------
    // --- Game Loop and Execution ---
    // ------------------------------------------------------------------
    runGameLoop() {
        if (!this.paused && this.romLoaded) {
            this.frameCounter++;
            
            // === STUB: Run CPU cycles for one frame (e.g., ~16.7ms or ~280,000 cycles)
            // this.cpu.runCycles(280896); 
            
            this.renderScreen();
        }
        this.animationFrameId = requestAnimationFrame(() => this.runGameLoop());
    }

    // ------------------------------------------------------------------
    // --- Rendering Logic (PPU Stub) ---
    // ------------------------------------------------------------------
    renderScreen() {
        // This is a minimal stub to show interaction with the new frame buffer
        
        // 1. PPU Logic STUB: Simulate rendering a frame by drawing a simple pattern
        const frameData = this.frameData;
        const width = 240;
        const height = 160;
        
        // Mock rendering based on frame counter (for visualization)
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                
                // Color logic: R based on x, G based on y, B based on time/frame count
                frameData[i] = (x + this.frameCounter) & 0xFF;     // R
                frameData[i + 1] = (y + this.frameCounter) & 0xFF; // G
                frameData[i + 2] = 0xAA;                           // B (constant)
                frameData[i + 3] = 0xFF;                           // Alpha (opaque)
            }
        }
        
        // 2. Mock Input Display (Read from the I/O Register)
        // Convert the register value back to a list of active keys
        let pressedKeys = [];
        for (const [key, bit] of Object.entries(this.KEY_MAP)) {
            // Check if the bit is 0 (Active LOW = pressed)
            if (!(this.keyInputRegister & bit)) { 
                pressedKeys.push(key);
            }
        }
        
        // 3. Transfer to Canvas (Efficiently)
        this.ctx.putImageData(this.frameBuffer, 0, 0);

        // 4. Draw overlay (since putImageData clears the canvas)
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.font = '10px monospace';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(`Frame: ${this.frameCounter}`, 5, 10);
        this.ctx.fillText(`KEYINPUT Reg: ${this.keyInputRegister.toString(16).padStart(4, '0')}`, 5, 20);
        this.ctx.fillText(`Input: ${pressedKeys.join(', ') || 'None'}`, 5, 155);
    }
    
    // ------------------------------------------------------------------
    // --- ROM Loading ---
    // ------------------------------------------------------------------
    loadRom(romData) {
        if (!romData || romData.byteLength === 0) {
            console.error('[GBAJS3_Core] Cannot load empty ROM data.');
            throw new Error("Empty ROM data provided.");
        }

        // STUB: For a real emulator, you would copy this data into the 
        // emulated Game Pak ROM region (starting at 0x08000000).
        this.romData = new Uint8Array(romData); // Keep the ROM data accessible for now
        
        this.romLoaded = true;
        this.paused = false;
        this.frameCounter = 0; // Reset state
        
        // Clear KEYINPUT register (all keys released by default)
        this.keyInputRegister = 0xFFFF;
        this.ioRegsView.setUint16(this.KEYINPUT_ADDR, this.keyInputRegister, true);


        // Start the continuous game loop only once
        if (!this.animationFrameId) {
            this.runGameLoop();
        }

        console.log(`[GBAJS3_Core] Loaded ROM data (${romData.byteLength} bytes). Game loop started.`);
    }

    pause() {
        this.paused = true;
        console.log('[GBAJS3_Core] Paused.');
    }
}
