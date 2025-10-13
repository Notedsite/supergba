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
        this.ewram = new Uint8Array(0x40000); // 256KB External Work RAM
        this.iwram = new Uint8Array(0x8000);  // 32KB Internal Work RAM

        // B. PPU RAM (Dedicated access)
        this.vram = new Uint8Array(0x18000); // 96KB Video RAM
        this.paletteRAM = new Uint8Array(0x400); // 1KB Palette RAM
        this.oam = new Uint8Array(0x400); // 1KB Object Attribute Memory

        // C. I/O REGISTERS (Controls everything)
        this.ioRegs = new ArrayBuffer(0x400); 
        this.ioRegsView = new DataView(this.ioRegs);
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
    // --- Input Handling (Writes to the I/O Register) ---
    // ------------------------------------------------------------------
    setupInputHandlers() {
        document.addEventListener('keydown', (e) => this.handleInput(e, true));
        document.addEventListener('keyup', (e) => this.handleInput(e, false));
    }

    handleInput(event, isKeyDown) {
        const keyBit = this.KEY_MAP[event.key];
        if (keyBit) {
            event.preventDefault(); // Stop default browser behavior

            // Active LOW: 0 = pressed, 1 = released
            if (isKeyDown) {
                this.keyInputRegister &= ~keyBit; // Set bit to 0 (pressed)
            } else {
                this.keyInputRegister |= keyBit;  // Set bit to 1 (released)
            }
            
            // Write the new state to the emulated I/O register (0x4000130)
            this.ioRegsView.setUint16(this.KEYINPUT_ADDR, this.keyInputRegister, true);
        }
    }

    // ------------------------------------------------------------------
    // --- Game Loop and Execution ---
    // ------------------------------------------------------------------
    runGameLoop() {
        if (!this.paused && this.romLoaded) {
            this.frameCounter++;
            
            // STUB: CPU Execution would happen here
            // this.cpu.runCycles(280896); 
            
            this.renderScreen();
        }
        this.animationFrameId = requestAnimationFrame(() => this.runGameLoop());
    }

    // ------------------------------------------------------------------
    // --- Rendering Logic (PPU Stub: Visualization of ROM Data) ---
    // ------------------------------------------------------------------
    renderScreen() {
        if (!this.romData) return;

        const frameData = this.frameData;
        const romView = new DataView(this.romData.buffer);
        const romSize = this.romData.byteLength;
        const width = 240;
        const height = 160;
        
        // Use a pointer that scrolls through the ROM data based on frame count
        let romPointer = this.frameCounter * 3; 

        // Get A-button state (Bit 0) for visualization effect
        const A_BUTTON_BIT = 0x0001;
        const aButtonPressed = !(this.keyInputRegister & A_BUTTON_BIT);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                
                // Read a byte from the ROM data, wrapping the address
                const dataIndex = (romPointer + y * width + x) % romSize;
                const tileByte = romView.getUint8(dataIndex);
                
                // --- Simple Mock PPU Palette Conversion ---
                let r, g, b;
                
                if (tileByte < 0x20) {
                    // Dark Blue/Black for low values
                    r = 0x00; g = 0x00; b = 0x80;
                } else if (tileByte < 0x80) {
                    // Green/Mid-range for medium values
                    r = 0x00; g = tileByte * 2; b = 0x00;
                } else {
                    // Red/White for high values
                    r = 0xFF; g = 0xAA; b = 0xAA;
                }

                // Input Effect: Flash the screen red if the A button is pressed
                if (aButtonPressed) {
                    r = Math.min(255, r + 100);
                    g = Math.max(0, g - 100);
                    b = Math.max(0, b - 100);
                }
                
                frameData[i] = r;      // R
                frameData[i + 1] = g;  // G
                frameData[i + 2] = b;  // B
                frameData[i + 3] = 0xFF; // Alpha (Opaque)
            }
        }

        // 2. Transfer to Canvas (Efficiently)
        this.ctx.putImageData(this.frameBuffer, 0, 0);

        // 3. Draw overlay (Input status)
        let pressedKeys = [];
        for (const [key, bit] of Object.entries(this.KEY_MAP)) {
            if (!(this.keyInputRegister & bit)) { 
                pressedKeys.push(key);
            }
        }
        
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

        // Store the ROM data as a Uint8Array
        this.romData = new Uint8Array(romData); 
        
        this.romLoaded = true;
        this.paused = false;
        this.frameCounter = 0; // Reset state
        
        // Initialize KEYINPUT register to 'released'
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
