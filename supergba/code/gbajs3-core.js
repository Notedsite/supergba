// gbajs3-core.js

// === NEW CLASS: MemoryBus (Handles all memory access) ===
class MemoryBus {
    constructor(ewram, iwram, vram, paletteRAM, oam, ioRegsView, romData) {
        // Direct references to all GBA memory regions
        this.ewram = ewram;
        this.iwram = iwram;
        this.vram = vram;
        this.paletteRAM = paletteRAM;
        this.oam = oam;
        this.ioRegsView = ioRegsView;
        this.romData = romData;
    }

    /**
     * Reads a 32-bit word from the emulated memory address.
     * This is highly simplified and only handles ROM/IO reads.
     * @param {number} address - The 32-bit memory address.
     */
    read32(address) {
        // Simplest case: Read from the ROM area (0x08000000)
        if (address >= 0x08000000 && this.romData) {
            // ROM size is usually padded to a power of 2 (e.g., 32MB)
            const romBase = 0x08000000;
            const offset = (address - romBase) % this.romData.byteLength;
            
            // Use DataView for easy 32-bit reading from the ROM ArrayBuffer
            const romView = new DataView(this.romData.buffer);
            try {
                // Read 32 bits (4 bytes) at the offset, assuming Little Endian (true)
                return romView.getUint32(offset, true);
            } catch (e) {
                console.error(`[Bus] Out of bounds read at ROM offset: 0x${offset.toString(16)}`);
                return 0xDEADBEEF; // Return a debug value on error
            }
        }
        
        // STUB: For the BIOS (0x00000000) and other regions, return 0 for now.
        return 0x0; 
    }

    // STUB: Methods for reading 16-bit and 8-bit, and writing will go here later.
    // write32(address, value) { ... }
}


// === NEW CLASS: GBA_CPU (Handles Registers and Instruction Execution) ===
class GBA_CPU {
    constructor(bus) {
        this.bus = bus;
        // R0-R12, R13 (SP), R14 (LR), R15 (PC)
        this.registers = new Uint32Array(16);
        this.SPSR = 0; // Saved Program Status Registers
        this.CPSR = 0; // Current Program Status Register (flags, mode)
        
        // The GBA starts execution at the BIOS, which we'll skip for now
        // A typical GBA ROM starts at 0x08000000.
        // We'll set the PC to a default ROM start point for testing.
        this.registers[15] = 0x08000000; 
        
        console.log('[GBA_CPU] Initialized. PC set to 0x08000000.');
    }

    /**
     * Executes a set number of CPU cycles. This is the heart of the emulator.
     * @param {number} cycles - The number of cycles to run (mocked).
     */
    runCycles(cycles) {
        let cyclesLeft = cycles;

        // In a real emulator, we'd loop until cyclesLeft is 0, executing one
        // or more instructions per iteration. For this stub, we'll only fetch
        // and advance the PC to simulate code running.
        
        // We run a single fetch/decode/execute step to prevent an infinite loop 
        // if the PC isn't updated.
        if (cyclesLeft > 0) {
            this.executeNextInstruction();
        }
        
        // STUB: This is where interrupt checking and real cycle counting happens.
    }

    /**
     * Mocks the core Fetch-Decode-Execute cycle.
     */
    executeNextInstruction() {
        const pc = this.registers[15];
        
        // 1. Fetch the instruction from the Memory Bus (32-bit fetch)
        const instruction = this.bus.read32(pc);
        
        // STUB: The rest of the execution cycle is missing!
        // - Decode instruction (is it ARM or THUMB?)
        // - Execute instruction (add, sub, mov, branch, etc.)
        
        // 2. Mock PC Update: If no branch happens, the PC advances.
        // ARM instructions are 4 bytes long.
        this.registers[15] += 4; 
        
        // Log the mock execution (useful for debugging the bus)
        // console.log(`[CPU] Executed 0x${instruction.toString(16).padStart(8, '0')} at PC 0x${pc.toString(16).padStart(8, '0')}`);
    }

    // STUB: Other methods like readRegister(r), writeRegister(r, val), etc.
}

// === GBAJS3_Core (Updated to include MemoryBus and CPU) ===
class GBAJS3_Core {
    // ... constructor remains mostly the same, but initializes new components ...
    constructor(containerElement) {
        this.container = containerElement;
        this.paused = true;
        this.romLoaded = false;
        this.frameCounter = 0;
        this.animationFrameId = null;

        // --- 1. GBA Memory Map Setup (Same as before) ---
        this.ewram = new Uint8Array(0x40000); 
        this.iwram = new Uint8Array(0x8000);  
        this.vram = new Uint8Array(0x18000); 
        this.paletteRAM = new Uint8Array(0x400); 
        this.oam = new Uint8Array(0x400); 
        this.ioRegs = new ArrayBuffer(0x400); 
        this.ioRegsView = new DataView(this.ioRegs);
        this.KEYINPUT_ADDR = 0x130; 
        this.keyInputRegister = 0xFFFF;

        // --- 2. Initialize the Bus and the CPU ---
        this.bus = new MemoryBus(
            this.ewram, this.iwram, this.vram, this.paletteRAM, 
            this.oam, this.ioRegsView, null // ROM data is loaded later
        );
        this.cpu = new GBA_CPU(this.bus);

        // --- 3. Display Setup (Same as before) ---
        this.screen = document.createElement('canvas');
        this.screen.width = 240;
        this.screen.height = 160;
        this.screen.style.width = '240px';
        this.screen.style.height = '160px';

        this.container.appendChild(this.screen);
        this.ctx = this.screen.getContext('2d');
        this.frameBuffer = this.ctx.createImageData(240, 160);
        this.frameData = this.frameBuffer.data; 

        this.drawPlaceholder();
        this.setupInputHandlers();
        
        console.log('[GBAJS3_Core] Core display, memory, bus, and CPU stubs initialized.');
    }

    // ... handleInput (Remains the same, updating ioRegsView) ...

    handleInput(event, isKeyDown) {
        const keyBit = this.KEY_MAP[event.key];
        if (keyBit) {
            event.preventDefault(); 
            if (isKeyDown) {
                this.keyInputRegister &= ~keyBit;
            } else {
                this.keyInputRegister |= keyBit;
            }
            this.ioRegsView.setUint16(this.KEYINPUT_ADDR, this.keyInputRegister, true);
        }
    }

    // --- Game Loop and Execution (Now includes the CPU) ---
    runGameLoop() {
        if (!this.paused && this.romLoaded) {
            this.frameCounter++;
            
            // === STEP: Run CPU cycles for one frame ===
            const GBA_CYCLES_PER_FRAME = 280896; // Approximate cycles for 60 fps
            this.cpu.runCycles(GBA_CYCLES_PER_FRAME); 
            
            this.renderScreen();
        }
        this.animationFrameId = requestAnimationFrame(() => this.runGameLoop());
    }

    // --- Rendering Logic (Now using ROM data fetched via CPU/Bus for visualization) ---
    renderScreen() {
        if (!this.romData) return;

        const frameData = this.frameData;
        const romView = new DataView(this.romData.buffer);
        const romSize = this.romData.byteLength;
        const width = 240;
        const height = 160;
        
        // Visualization: Use a register value (e.g., PC) to influence the render
        // This simulates the CPU changing a PPU register.
        let romPointer = this.cpu.registers[15]; 
        
        const A_BUTTON_BIT = 0x0001;
        const aButtonPressed = !(this.keyInputRegister & A_BUTTON_BIT);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                
                // Read a byte, using the current PC as a base pointer
                const dataIndex = (romPointer + y * width + x) % romSize;
                const tileByte = romView.getUint8(dataIndex);
                
                // Simple Mock PPU Palette Conversion
                let r, g, b;
                
                if (tileByte < 0x20) {
                    r = 0x00; g = 0x00; b = 0x80;
                } else if (tileByte < 0x80) {
                    r = 0x00; g = tileByte * 2; b = 0x00;
                } else {
                    r = 0xFF; g = 0xAA; b = 0xAA;
                }

                // Input Effect
                if (aButtonPressed) {
                    r = Math.min(255, r + 100);
                    g = Math.max(0, g - 100);
                    b = Math.max(0, b - 100);
                }
                
                frameData[i] = r;      
                frameData[i + 1] = g;  
                frameData[i + 2] = b;  
                frameData[i + 3] = 0xFF;
            }
        }

        this.ctx.putImageData(this.frameBuffer, 0, 0);

        // Draw overlay (Input status & CPU status)
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
        this.ctx.fillText(`PC: 0x${this.cpu.registers[15].toString(16).padStart(8, '0')}`, 5, 20); // NEW
        this.ctx.fillText(`KEYINPUT Reg: ${this.keyInputRegister.toString(16).padStart(4, '0')}`, 5, 30);
        this.ctx.fillText(`Input: ${pressedKeys.join(', ') || 'None'}`, 5, 155);
    }
    
    // --- ROM Loading (Now connects ROM data to the Bus) ---
    loadRom(romData) {
        if (!romData || romData.byteLength === 0) {
            console.error('[GBAJS3_Core] Cannot load empty ROM data.');
            throw new Error("Empty ROM data provided.");
        }

        this.romData = new Uint8Array(romData); 
        
        // === CRITICAL STEP: Connect the ROM to the Memory Bus ===
        this.bus.romData = this.romData; 
        
        this.romLoaded = true;
        this.paused = false;
        this.frameCounter = 0;
        this.keyInputRegister = 0xFFFF;
        this.ioRegsView.setUint16(this.KEYINPUT_ADDR, this.keyInputRegister, true);

        // Reset PC for a fresh start with the new ROM
        this.cpu.registers[15] = 0x08000000; 

        if (!this.animationFrameId) {
            this.runGameLoop();
        }

        console.log(`[GBAJS3_Core] Loaded ROM data (${romData.byteLength} bytes). CPU/Bus are active.`);
    }

    pause() {
        this.paused = true;
        console.log('[GBAJS3_Core] Paused.');
    }
}
