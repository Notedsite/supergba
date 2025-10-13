// gbajs3-core.js

// === CONSTANTS for ARM Mode and Flags ===
const REG_PC = 15;
const ARM_MODE = 0b10000; // User mode (for now)
const FLAG_N = 0x80000000; // Negative flag (Bit 31)
const FLAG_Z = 0x40000000; // Zero flag (Bit 30)

// === GBA Input Key Map ===
const KEY_MAP = {
    'z': 0x0001,         // A button
    'x': 0x0002,         // B button
    'Enter': 0x0004,     // Select
    ' ': 0x0008,         // Start (Spacebar)
    'ArrowRight': 0x0010,// Right
    'ArrowLeft': 0x0020, // Left
    'ArrowUp': 0x0040,   // Up
    'ArrowDown': 0x0080, // Down
    'a': 0x0100,         // R shoulder
    's': 0x0200,         // L shoulder
};


// === MemoryBus (Handles BIOS, ROM, VRAM, and IO reads) ===
class MemoryBus {
    constructor(ewram, iwram, vram, paletteRAM, oam, ioRegsView, romData, biosData) {
        this.ewram = ewram;
        this.iwram = iwram;
        this.vram = vram; 
        this.paletteRAM = paletteRAM; 
        this.oam = oam;
        this.ioRegsView = ioRegsView;
        this.romData = romData;
        this.biosData = biosData; 
    }
    
    // Helper to read 16-bit data
    read16(address) {
        // 1. PRAM Read (0x05000000 - 0x050003FF)
        if (address >= 0x05000000 && address < 0x05000400) {
            const offset = address - 0x05000000;
            const view = new DataView(this.paletteRAM.buffer);
            return view.getUint16(offset, true); 
        }
        
        // 2. VRAM Read (0x06000000 - 0x0601FFFF)
        if (address >= 0x06000000 && address < 0x07000000) {
            const offset = address - 0x06000000;
            const view = new DataView(this.vram.buffer);
            return view.getUint16(offset % this.vram.byteLength, true); 
        }

        // 3. IO Register Read (0x04000000 - 0x040003FE)
        if (address >= 0x04000000 && address < 0x04000400) {
            const offset = address - 0x04000000;
            return this.ioRegsView.getUint16(offset, true);
        }

        return this.read32(address) & 0xFFFF;
    }

    read32(address) {
        // 1. BIOS Region (0x00000000 - 0x00003FFF)
        if (address < 0x00004000 && this.biosData) {
            const biosView = new DataView(this.biosData);
            try {
                return biosView.getUint32(address, true); // Little Endian
            } catch (e) {
                return 0x0; 
            }
        }
        
        // 2. ROM Region (0x08000000 onwards)
        if (address >= 0x08000000 && this.romData) {
            const romBase = 0x08000000;
            const offset = (address - romBase) % this.romData.byteLength;
            const romView = new DataView(this.romData.buffer);
            try {
                return romView.getUint32(offset, true); 
            } catch (e) {
                return 0xDEADBEEF; 
            }
        }
        
        // Default (other memory regions)
        return 0x0; 
    }
}


// === GBA_CPU (The ARM7TDMI Interpreter) ===
class GBA_CPU {
    constructor(bus) {
        this.bus = bus;
        this.registers = new Uint32Array(16);
        this.CPSR = 0x00000010 | ARM_MODE; 
        
        this.registers[REG_PC] = 0x00000000; 
        
        console.log('[GBA_CPU] Initialized. PC set to 0x00000000 (BIOS Start).');
    }

    setZNFlags(result) {
        this.CPSR &= ~(FLAG_Z | FLAG_N);
        if (result === 0) {
            this.CPSR |= FLAG_Z;
        }
        if (result & 0x80000000) { 
            this.CPSR |= FLAG_N;
        }
    }

    runCycles(cycles) {
        this.executeNextInstruction();
    }

    executeNextInstruction() {
        const currentPC = this.registers[REG_PC];
        
        const instructionAddress = currentPC - 8;
        const instruction = this.bus.read32(instructionAddress);
        
        const opcode = (instruction >> 21) & 0xF; 
        const cond = (instruction >> 28) & 0xF; 
        const isBranch = ((instruction >> 25) & 0b111) === 0b101;
        const isDataProcessing = (instruction >> 26) === 0b00; 
        
        this.registers[REG_PC] += 4; 
        
        if (cond === 0b1110) { 
            
            if (isBranch) {
                let offset = (instruction & 0x00FFFFFF) << 2; 
                if (offset & 0x02000000) {
                    offset |= 0xFC000000; 
                }
                
                this.registers[REG_PC] = currentPC + offset; 
                
            } else if (isDataProcessing) {
                if (opcode === 0b1101) { 
                    const Rd = (instruction >> 12) & 0xF; 
                    const isImmediate = instruction & 0x02000000;
                    
                    let operand2;
                    if (isImmediate) {
                        const imm8 = instruction & 0xFF;
                        operand2 = imm8; 
                    } else {
                        const Rm = instruction & 0xF;
                        let value = this.registers[Rm];
                        
                        if (Rm === REG_PC) { 
                            value = instructionAddress + 8;
                        }
                        
                        operand2 = value;
                    }
                    
                    this.registers[Rd] = operand2;
                    
                    if (instruction & 0x00100000) {
                        this.setZNFlags(this.registers[Rd]);
                    }
                }
            }
        }
    }
}


// === GBAJS3_Core (PPU/IO Initialization) ===
class GBAJS3_Core {
    constructor(containerElement, biosData) {
        this.container = containerElement;
        this.paused = true;
        this.romLoaded = false;
        this.frameCounter = 0;
        this.animationFrameId = null;

        // Memory Stubs
        this.ewram = new Uint8Array(0x40000); 
        this.iwram = new Uint8Array(0x8000);  
        this.vram = new Uint8Array(0x18000); // 96KB
        this.paletteRAM = new Uint8Array(0x400); // 1KB
        this.oam = new Uint8Array(0x400); 
        this.ioRegs = new ArrayBuffer(0x400); 
        this.ioRegsView = new DataView(this.ioRegs);
        this.KEYINPUT_ADDR = 0x130; 
        this.keyInputRegister = 0xFFFF;
        this.KEY_MAP = KEY_MAP; 
        
        // PPU/IO REGISTERS
        this.REG_DISPCNT = 0x000; // Address 0x04000000
        this.ioRegsView.setUint16(this.REG_DISPCNT, 0x0000, true); 

        // Initialize Bus and CPU
        this.bus = new MemoryBus(
            this.ewram, this.iwram, this.vram, this.paletteRAM, 
            this.oam, this.ioRegsView, null, biosData
        );
        this.cpu = new GBA_CPU(this.bus);

        // Display Setup
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
    
    setupInputHandlers() {
        document.addEventListener('keydown', (e) => this.handleInput(e, true));
        document.addEventListener('keyup', (e) => this.handleInput(e, false));
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
            
            this.cpu.runCycles(1); 
            
            this.renderScreen();
        }
        this.animationFrameId = requestAnimationFrame(() => this.runGameLoop());
    }

    renderScreen() {
        const frameData = this.frameData;
        const width = 240;
        const height = 160;
        
        // 1. Check Display Mode (Read DISPCNT from IO Registers)
        const dispcnt = this.ioRegsView.getUint16(this.REG_DISPCNT, true);
        const displayMode = dispcnt & 0x7; // Bits 0-2 contain the mode (0-5)
        
        // Base VRAM address for Mode 3 is 0x06000000
        const vramView = new DataView(this.vram.buffer);
        
        if (displayMode === 3) {
            // Mode 3: 240x160, 16-bit color bitmap
            
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const i = (y * width + x) * 4; // Index into the 32-bit (RGBA) frameData
                    
                    // VRAM offset: (y * 240 + x) * 2 bytes/pixel
                    const vram_offset = (y * width + x) * 2;
                    
                    // Read 16-bit color value (BGR-555)
                    const color16 = vramView.getUint16(vram_offset, true);

                    // Convert BGR-555 to RGB-888
                    let r5 = (color16 >> 10) & 0x1F; 
                    let g5 = (color16 >> 5) & 0x1F;
                    let b5 = color16 & 0x1F;

                    // Scale 5-bit (0-31) to 8-bit (0-255)
                    let r8 = (r5 << 3) | (r5 >> 2);
                    let g8 = (g5 << 3) | (g5 >> 2);
                    let b8 = (b5 << 3) | (b5 >> 2);
                    
                    // Write to canvas frame buffer
                    frameData[i] = r8;      
                    frameData[i + 1] = g8;  
                    frameData[i + 2] = b8;  
                    frameData[i + 3] = 0xFF; // Alpha
                }
            }
        } else {
            // Placeholder/Not Implemented Mode Drawing
            this.drawPlaceholder(); 
            this.ctx.fillText(`Mode ${displayMode} not implemented.`, 120, 110);
            
            // Re-apply placeholder image data to clear any previous game screen data
            this.ctx.putImageData(this.frameBuffer, 0, 0); 
        }

        this.ctx.putImageData(this.frameBuffer, 0, 0);

        // Draw overlay (Keep status text for debugging)
        let pressedKeys = [];
        for (const [key, bit] of Object.entries(this.KEY
