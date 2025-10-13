// gbajs3-core.js

// === CONSTANTS for ARM Mode and Flags ===
const REG_PC = 15;
const ARM_MODE = 0b10000; // User mode (for now)
const FLAG_N = 0x80000000; // Negative flag (Bit 31)
const FLAG_Z = 0x40000000; // Zero flag (Bit 30)

// === MemoryBus (Unchanged, but crucial for 32-bit fetch) ===
class MemoryBus {
    constructor(ewram, iwram, vram, paletteRAM, oam, ioRegsView, romData) {
        this.ewram = ewram;
        this.iwram = iwram;
        this.vram = vram;
        this.paletteRAM = paletteRAM;
        this.oam = oam;
        this.ioRegsView = ioRegsView;
        this.romData = romData;
    }

    read32(address) {
        if (address >= 0x08000000 && this.romData) {
            const romBase = 0x08000000;
            // The GBA PC is offset by 8 bytes due to pipelining, so the fetched address is PC - 8.
            // For now, we'll keep the simple direct read but remember the PC offset for later.
            const offset = (address - romBase) % this.romData.byteLength;
            const romView = new DataView(this.romData.buffer);
            try {
                return romView.getUint32(offset, true); // Little Endian
            } catch (e) {
                return 0xDEADBEEF;
            }
        }
        return 0x0; 
    }
}


// === GBA_CPU (The ARM7TDMI Interpreter) ===
class GBA_CPU {
    constructor(bus) {
        this.bus = bus;
        this.registers = new Uint32Array(16);
        this.CPSR = 0x00000010 | ARM_MODE; // Default flags and mode
        
        // GBA ROM execution typically starts after the 16-byte header
        this.registers[REG_PC] = 0x08000000; 
        
        console.log('[GBA_CPU] Initialized. PC set to 0x08000000. Ready to execute ARM instructions.');
    }

    /** Helper to update the Zero and Negative flags. */
    setZNFlags(result) {
        this.CPSR &= ~(FLAG_Z | FLAG_N); // Clear Z and N flags
        if (result === 0) {
            this.CPSR |= FLAG_Z;
        }
        // Check sign bit (bit 31)
        if (result & 0x80000000) { 
            this.CPSR |= FLAG_N;
        }
    }

    /**
     * Executes a set number of CPU cycles (one mock instruction for now).
     */
    runCycles(cycles) {
        // We'll execute one instruction per call to keep the core responsive
        // and allow the PPU to render a frame.
        this.executeNextInstruction();
    }

    /**
     * The core Fetch-Decode-Execute cycle for ARM instructions.
     */
    executeNextInstruction() {
        // ARM instruction fetching: The PC points to the instruction + 8.
        // The instruction we want is at PC - 8.
        const currentPC = this.registers[REG_PC];
        
        // 1. Fetch: Read the instruction word
        // In ARM state, instructions are always 4 bytes, aligned to a 4-byte boundary.
        const instruction = this.bus.read32(currentPC);
        
        // 2. Decode: Extract instruction components (simplified for now)
        const opcode = (instruction >> 21) & 0xF; // Bits 24-21 determine opcode for Data Processing
        const cond = (instruction >> 28) & 0xF; // Bits 31-28 is the condition code
        const isBranch = (instruction >> 24) === 0b101; // Instruction bits 27-24 = 101X
        const isDataProcessing = (instruction >> 26) === 0b00; // Instruction bits 27-26 = 00
        
        // --- 3. Execute ---
        
        // Check Condition Code (Stub: Always execute if cond is AL/0b1110)
        if (cond === 0b1110) { 
            
            if (isBranch) {
                // === Implement Instruction: B (Branch) ===
                // Format: 1010 L offset (24 bits)
                
                // Sign-extend the 24-bit offset to 32 bits, then shift left by 2 (as it's word offset)
                let offset = (instruction & 0x00FFFFFF) << 2; 
                if (offset & 0x02000000) {
                    // Sign-extension for negative jump
                    offset |= 0xFC000000; 
                }
                
                // Branch target is (PC - 8) + offset. The -8 is for the ARM pipeline.
                this.registers[REG_PC] = (currentPC - 4) + offset;
                
                // If it was a Branch with Link (BL), R14 (LR) would be set here.
                
            } else if (isDataProcessing) {
                // === Implement Instruction: MOV (Move) - Simplified Case (Opcode 0b1101) ===
                if (opcode === 0b1101) { 
                    const Rd = (instruction >> 12) & 0xF; // Destination Register
                    const isImmediate = instruction & 0x02000000; // Bit 25
                    
                    let operand2;
                    if (isImmediate) {
                        // Simplified: Read the immediate value (8 bits rotated)
                        const imm8 = instruction & 0xFF;
                        const rot4 = (instruction >> 8) & 0xF;
                        // Full rotation logic is complex, simplify to just the immediate for now
                        operand2 = imm8; 
                        
                    } else {
                        // Register operand (stub: Read from the source register)
                        const Rm = instruction & 0xF;
                        operand2 = this.registers[Rm];
                    }
                    
                    // Execute MOV: Rd = operand2
                    this.registers[Rd] = operand2;
                    
                    // If the S-bit (Bit 20) was set, update flags
                    if (instruction & 0x00100000) {
                        this.setZNFlags(this.registers[Rd]);
                    }
                }
                
                // STUB: ADD, SUB, AND, ORR, etc. would go here.
            }
            
            // 4. PC Update: If no branch happened, advance PC by one instruction (4 bytes).
            // This is skipped if a branch/jump instruction has already updated the PC.
            if (!isBranch) {
                this.registers[REG_PC] += 4; 
            }
        } else {
            // Condition failed: Skip instruction by advancing PC
            this.registers[REG_PC] += 4;
        }

        // console.log(`[CPU] Executed 0x${instruction.toString(16).padStart(8, '0')} at PC 0x${currentPC.toString(16).padStart(8, '0')}`);
    }
}


// === GBAJS3_Core (Unchanged structure, relies on the new CPU logic) ===
class GBAJS3_Core {
    constructor(containerElement) {
        this.container = containerElement;
        this.paused = true;
        this.romLoaded = false;
        this.frameCounter = 0;
        this.animationFrameId = null;

        // Memory Stubs (Same)
        this.ewram = new Uint8Array(0x40000); 
        this.iwram = new Uint8Array(0x8000);  
        this.vram = new Uint8Array(0x18000); 
        this.paletteRAM = new Uint8Array(0x400); 
        this.oam = new Uint8Array(0x400); 
        this.ioRegs = new ArrayBuffer(0x400); 
        this.ioRegsView = new DataView(this.ioRegs);
        this.KEYINPUT_ADDR = 0x130; 
        this.keyInputRegister = 0xFFFF;

        // Initialize Bus and CPU with new classes
        this.bus = new MemoryBus(
            this.ewram, this.iwram, this.vram, this.paletteRAM, 
            this.oam, this.ioRegsView, null
        );
        this.cpu = new GBA_CPU(this.bus);

        // Display Setup (Same)
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
        
        console.log('[GBAJS3_Core] Core display, memory, bus, and CPU interpreter initialized.');
    }

    drawPlaceholder() {
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, 240, 160);
        
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.font = '12px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('SuperGBA Core Ready (Interpreter Active)', 120, 70);
        this.ctx.fillText('Awaiting ROM Data...', 120, 90);
    }

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

    runGameLoop() {
        if (!this.paused && this.romLoaded) {
            this.frameCounter++;
            
            // --- CRITICAL CHANGE: We run only ONE instruction per frame ---
            // A real emulator runs ~280,000 cycles. We must run at least one
            // instruction now that the CPU logic is in place.
            this.cpu.runCycles(1); 
            
            this.renderScreen();
        }
        this.animationFrameId = requestAnimationFrame(() => this.runGameLoop());
    }

    renderScreen() {
        if (!this.romData) return;

        const frameData = this.frameData;
        const romView = new DataView(this.romData.buffer);
        const romSize = this.romData.byteLength;
        const width = 240;
        const height = 160;
        
        // Visualization: Use a register value (e.g., R0) to influence the render
        let romPointer = this.cpu.registers[0]; // R0 is often used for pointers
        
        const A_BUTTON_BIT = 0x0001;
        const aButtonPressed = !(this.keyInputRegister & A_BUTTON_BIT);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                
                // Read a byte, using R0 as the base pointer
                const dataIndex = (romPointer + y * width + x) % romSize;
                const tileByte = romView.getUint8(dataIndex);
                
                let r, g, b;
                
                if (tileByte < 0x20) {
                    r = 0x00; g = 0x00; b = 0x80;
                } else if (tileByte < 0x80) {
                    r = 0x00; g = tileByte * 2; b = 0x00;
                } else {
                    r = 0xFF; g = 0xAA; b = 0xAA;
                }

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
        this.ctx.fillText(`PC: 0x${this.cpu.registers[REG_PC].toString(16).padStart(8, '0')}`, 5, 20);
        this.ctx.fillText(`R0: 0x${this.cpu.registers[0].toString(16).padStart(8, '0')}`, 5, 30); // Show R0
        this.ctx.fillText(`CPSR: 0x${this.cpu.CPSR.toString(16).padStart(8, '0')}`, 5, 40); // Show Flags
        this.ctx.fillText(`Input: ${pressedKeys.join(', ') || 'None'}`, 5, 155);
    }
    
    loadRom(romData) {
        if (!romData || romData.byteLength === 0) {
            console.error('[GBAJS3_Core] Cannot load empty ROM data.');
            throw new Error("Empty ROM data provided.");
        }

        this.romData = new Uint8Array(romData); 
        this.bus.romData = this.romData; 
        
        this.romLoaded = true;
        this.paused = false;
        this.frameCounter = 0;
        this.keyInputRegister = 0xFFFF;
        this.ioRegsView.setUint16(this.KEYINPUT_ADDR, this.keyInputRegister, true);

        // Reset PC to the start of the ROM
        this.cpu.registers.fill(0); // Clear all registers
        this.cpu.CPSR = 0x00000010 | ARM_MODE;
        this.cpu.registers[REG_PC] = 0x08000000; 

        if (!this.animationFrameId) {
            this.runGameLoop();
        }

        console.log(`[GBAJS3_Core] Loaded ROM data (${romData.byteLength} bytes). CPU is running one instruction per frame.`);
    }

    pause() {
        this.paused = true;
        console.log('[GBAJS3_Core] Paused.');
    }
}
