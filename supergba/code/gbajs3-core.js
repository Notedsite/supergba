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


// === MemoryBus (Handles BIOS, ROM, VRAM, and IO reads/writes) ===
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

    // Helper for 16-bit writes
    write16(address, value) {
        // 1. PRAM Write (0x05000000 - 0x050003FF)
        if (address >= 0x05000000 && address < 0x05000400) {
            const offset = address - 0x05000000;
            const view = new DataView(this.paletteRAM.buffer);
            view.setUint16(offset % this.paletteRAM.byteLength, value, true);
            return;
        }
        
        // 2. VRAM Write (0x06000000 - 0x0601FFFF)
        if (address >= 0x06000000 && address < 0x07000000) {
            const offset = address - 0x06000000;
            const view = new DataView(this.vram.buffer);
            view.setUint16(offset % this.vram.byteLength, value, true);
            return;
        }

        // 3. IO Register Write (0x04000000 - 0x040003FE)
        if (address >= 0x04000000 && address < 0x04000400) {
            const offset = address - 0x04000000;
            this.ioRegsView.setUint16(offset, value, true);
            return;
        }
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

    // Helper for 32-bit writes
    write32(address, value) {
        // 1. PRAM Write (0x05000000 - 0x050003FF)
        if (address >= 0x05000000 && address < 0x05000400) {
            const offset = address - 0x05000000;
            const view = new DataView(this.paletteRAM.buffer);
            view.setUint32(offset % this.paletteRAM.byteLength, value, true);
            return;
        }
        
        // 2. VRAM Write (0x06000000 - 0x0601FFFF)
        if (address >= 0x06000000 && address < 0x07000000) {
            const offset = address - 0x06000000;
            const view = new DataView(this.vram.buffer);
            view.setUint32(offset % this.vram.byteLength, value, true);
            return;
        }

        // 3. IO Register Write (0x04000000 - 0x040003FE)
        if (address >= 0x04000000 && address < 0x04000400) {
            const offset = address - 0x04000000;
            this.ioRegsView.setUint32(offset, value, true);
            return;
        }
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

    executeNextInstruction() {
        const currentPC = this.registers[REG_PC];
        
        // The instruction fetched is PC - 8 bytes in ARM state (due to pipelining)
        const instructionAddress = currentPC - 8;
        const instruction = this.bus.read32(instructionAddress);
        
        const opcode = (instruction >> 21) & 0xF; 
        const cond = (instruction >> 28) & 0xF; 
        const isBranch = ((instruction >> 25) & 0b111) === 0b101;
        const isDataProcessing = (instruction >> 26) === 0b00; 
        
        // Check for LDR/STR instruction (Load/Store Register)
        const isLoadStore = (instruction >> 26) === 0b01; 
        const isStore = ((instruction >> 20) & 0x1) === 0x0; 

        // Increment PC before execution
        this.registers[REG_PC] += 4; 
        
        // Simplified condition check (always execute if cond is 0b1110 (AL))
        if (cond === 0b1110) { 
            
            if (isBranch) {
                // Branch Instruction (B/BL)
                let offset = (instruction & 0x00FFFFFF) << 2; 
                // Sign extend 24-bit offset to 32-bit
                if (offset & 0x02000000) {
                    offset |= 0xFC000000; 
                }
                
                this.registers[REG_PC] = currentPC + offset; 
                
            } else if (isDataProcessing) {
                // Data Processing Instruction (MOV, AND, ORR, etc.)
                const Rd = (instruction >> 12) & 0xF; 
                const isImmediate = instruction & 0x02000000;
                
                // Read Rn (first operand), defaults to R0 for simplicity if Rn is not needed
                const RnIndex = (instruction >> 16) & 0xF;
                let operand1 = this.registers[RnIndex]; 
                
                let operand2;
                
                // Determine Operand 2 (Immediate or Register)
                if (isImmediate) {
                    // Simplified: Use the 8-bit immediate value directly 
                    operand2 = instruction & 0xFF; 
                } else {
                    const Rm = instruction & 0xF;
                    operand2 = this.registers[Rm];
                    
                    // PC adjustment if used as source
                    if (Rm === REG_PC) { 
                        operand2 = instructionAddress + 8;
                    }
                }
                
                let result = 0;

                switch (opcode) {
                    case 0b0000: // AND
                        result = operand1 & operand2;
                        this.registers[Rd] = result;
                        break;
                        
                    case 0b1100: // ORR (Logical OR)
                        result = operand1 | operand2;
                        this.registers[Rd] = result;
                        break;
                        
                    case 0b1101: // MOV (Move)
                        result = operand2; // Rn (operand1) is ignored for MOV
                        this.registers[Rd] = result;
                        break;
                        
                    default:
                        // Unhandled opcode. Halt execution to prevent crashing.
                        // console.log(`[CPU] Unhandled opcode: 0x${opcode.toString(16)}. Halting.`);
                        return;
                }
                
                // If S-bit is set, update flags
                if (instruction & 0x00100000) { 
                    this.setZNFlags(result);
                }

            } else if (isLoadStore) {
                // Load/Store Instruction (STR/LDR)
                const Rd = (instruction >> 12) & 0xF; 
                const Rn = (instruction >> 16) & 0xF; 
                
                // Check if it's a byte transfer (LDRB/STRB) - bit 22
                const isByteTransfer = (instruction >> 22) & 0x1; 

                // Simplified Immediate Offset calculation (Offset/Immediate is bits 0-11)
                const offset = instruction & 0xFFF; 
                
                // Address calculation (simplified: Base + Offset)
                const baseAddress = this.registers[Rn];
                const targetAddress = baseAddress + offset;
                
                // LDR/STR bit is bit 20 (1 = LDR, 0 = STR)
                const isLoad = ((instruction >> 20) & 0x1) === 0x1; 

                if (isStore) { // STR (Store Register)
                    const value = this.registers[Rd];
                    
                    // Simplified write access
                    if (isByteTransfer) {
                        // Not implemented yet
                    } else if (targetAddress & 0x3) { 
                       // Unaligned write (16-bit)
                       this.bus.write16(targetAddress, value & 0xFFFF);
                    } else { 
                       // Aligned write (32-bit)
                       this.bus.write32(targetAddress, value);
                    }
                } else if (isLoad) { // LDR (Load Register)
                    let loadedValue;
                    
                    if (isByteTransfer) {
                        // LDRB (Load Byte) - Reads a full word and masks
                        loadedValue = this.bus.read32(targetAddress) & 0xFF; 
                    } else if (targetAddress & 0x3) {
                        // Unaligned Load (16-bit) - Reads a halfword
                        loadedValue = this.bus.read16(targetAddress);
                    } else { 
                        // Aligned Load (32-bit)
                        loadedValue = this.bus.read32(targetAddress);
                    }
                    
                    // The loaded value is placed into Rd
                    this.registers[Rd] = loadedValue;
                    
                    // PC must be adjusted if it's the destination register (R15)
                    if (Rd === REG_PC) {
                        this.registers[REG_PC] &= 0xFFFFFFFC; // Align PC
                    }
                }
            }
        }
    }
}


// === GBAJS3_Core (PPU/IO Initialization and Drawing Logic) ===
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
        this.paletteRAM = new Uint8Array(0x400); // 1KB (512 colors)
        this.oam = new Uint8Array(0x400); 
        this.ioRegs = new ArrayBuffer(0x400); 
        this.ioRegsView = new DataView(this.ioRegs);
        this.KEYINPUT_ADDR = 0x130; 
        this.keyInputRegister = 0xFFFF;
        this.KEY_MAP = KEY_MAP; 
        
        // PPU/IO REGISTERS
        this.REG_DISPCNT = 0x000; // Address 0x04000000
        this.REG_BG0CNT = 0x008;  // BG0 Control Register Address (0x04000008)
        
        this.ioRegsView.setUint16(this.REG_DISPCNT, 0x0000, true); 
        this.ioRegsView.setUint16(this.REG_BG0CNT, 0x0000, true); 

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
        // Draw initial black screen with info text
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, 240, 160);
        
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.font = '12px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('SuperGBA Core Ready (Interpreter Active)', 120, 70);
        this.ctx.fillText('Awaiting ROM Data...', 120, 90);
        this.ctx.putImageData(this.frameBuffer, 0, 0); // Apply immediately
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
            // Directly update IO Register for key state
            this.ioRegsView.setUint16(this.KEYINPUT_ADDR, this.keyInputRegister, true);
        }
    }

    runGameLoop() {
        if (!this.paused && this.romLoaded) {
            this.frameCounter++;
            
            // Run a high number of cycles per frame to approach real speed (16.78 MHz)
            const CYCLES_PER_FRAME = 200000; 
            
            for (let i = 0; i < CYCLES_PER_FRAME; i++) {
                this.cpu.executeNextInstruction(); 
            }
            
            this.renderScreen();
        }
        this.animationFrameId = requestAnimationFrame(() => this.runGameLoop());
    }

    // --- Helper to draw a single 8x8 tile (for Mode 0) ---
    drawTile(ctx, tileNum, tileBase, mapBase, paletteBank, x, y, flipH, flipV) {
        
        const tileDataOffset = tileBase + tileNum * 32; // 32 bytes per 8x8/4bpp tile
        const vramView = new DataView(this.vram.buffer);

        const paletteView = new DataView(this.paletteRAM.buffer);
        const paletteBaseOffset = paletteBank * 32; // 16 colors * 2 bytes/color

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                
                // Read pixel index (4 bits per pixel, 2 pixels per byte)
                const byteOffset = tileDataOffset + row * 4 + Math.floor(col / 2);
                const byte = vramView.getUint8(byteOffset % this.vram.byteLength);

                let pixelIndex;
                if (col % 2 === 0) {
                    pixelIndex = byte & 0x0F; 
                } else {
                    pixelIndex = byte >> 4;
                }
                
                // Index 0 is transparent in tiled backgrounds
                if (pixelIndex === 0) continue; 
                
                // Read color from Palette RAM
                const colorOffset = paletteBaseOffset + pixelIndex * 2;
                const color16 = paletteView.getUint16(colorOffset % this.paletteRAM.byteLength, true);

                // Convert BGR-555 to RGB-888
                let r5 = (color16 >> 10) & 0x1F; 
                let g5 = (color16 >> 5) & 0x1F;
                let b5 = color16 & 0x1F;
                let r8 = (r5 << 3) | (r5 >> 2);
                let g8 = (g5 << 3) | (g5 >> 2);
                let b8 = (b5 << 3) | (b5 >> 2);
                
                // Draw pixel to frame buffer
                const drawX = x + col;
                const drawY = y + row;
                
                if (drawX >= 0 && drawX < 240 && drawY >= 0 && drawY < 160) {
                    const i = (drawY * 240 + drawX) * 4;
                    ctx.frameData[i] = r8;
                    ctx.frameData[i + 1] = g8;
                    ctx.frameData[i + 2] = b8;
                    ctx.frameData[i + 3] = 0xFF;
                }
            }
        }
    }


    renderScreen() {
        const frameData = this.frameBuffer.data;
        const width = 240;
        const height = 160;
        
        // 1. Read DISPCNT
        const dispcnt = this.ioRegsView.getUint16(this.REG_DISPCNT, true);
        const displayMode = dispcnt & 0x7; // Bits 0-2 (0-5)
        const bg0Enabled = (dispcnt >> 8) & 0x1; // Bit 8

        const vramView = new DataView(this.vram.buffer);
        
        // Clear frame data to black at the start of every frame
        for (let i = 0; i < frameData.length; i += 4) {
            frameData[i] = 0;      
            frameData[i + 1] = 0;  
            frameData[i + 2] = 0;  
            frameData[i + 3] = 0xFF;
        }

        // --- PPU LOGIC BRANCH ---
        
        if (displayMode === 3) {
            // Mode 3: 240x160, 16-bit color bitmap (Used by BIOS logo)
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const i = (y * width + x) * 4;
                    const vram_offset = (y * width + x) * 2;
                    const color16 = vramView.getUint16(vram_offset, true);

                    let r5 = (color16 >> 10) & 0x1F; 
                    let g5 = (color16 >> 5) & 0x1F;
                    let b5 = color16 & 0x1F;

                    let r8 = (r5 << 3) | (r5 >> 2);
                    let g8 = (g5 << 3) | (g5 >> 2);
                    let b8 = (b5 << 3) | (b5 >> 2);
                    
                    frameData[i] = r8; frameData[i + 1] = g8; frameData[i + 2] = b8; frameData[i + 3] = 0xFF; 
                }
            }
        } else if (displayMode === 0 && bg0Enabled) {
            // Mode 0: Tiled Background Rendering (Simple BG0)
            
            const bg0cnt = this.ioRegsView.getUint16(this.REG_BG0CNT, true);
            
            // Character Base (Tile Data)
            const tileBaseIndex = (bg0cnt >> 2) & 0x3;
            const tileBase = tileBaseIndex * 0x4000; 
            
            // Screen Base (Tile Map)
            const mapBaseIndex = (bg0cnt >> 8) & 0x1F;
            const mapBaseOffset = mapBaseIndex * 0x800; 

            const MAP_TILE_WIDTH = 32; // Assumes 256x256 map size

            for (let tileY = 0; tileY < 20; tileY++) {
                for (let tileX = 0; tileX < 30; tileX++) {
                    
                    const mapIndex = tileY * MAP_TILE_WIDTH + tileX; 
                    const mapWordOffset = mapBaseOffset + mapIndex * 2; 
                    
                    const mapEntry = vramView.getUint16(mapWordOffset % this.vram.byteLength, true);

                    const tileNum = mapEntry & 0x3FF;       
                    const paletteBank = (mapEntry >> 12) & 0xF; 
                    const flipH = (mapEntry >> 10) & 0x1;   
                    const flipV = (mapEntry >> 11) & 0x1;

                    this.drawTile(this.ctx, tileNum, tileBase, mapBaseOffset, paletteBank, tileX * 8, tileY * 8, flipH, flipV);
                }
            }
        } else {
            // Screen is black if mode is unsupported/disabled.
        }

        this.ctx.putImageData(this.frameBuffer, 0, 0);

        // Draw overlay (Keep status text for debugging)
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
        this.ctx.fillText(`Mode: ${displayMode}`, 5, 30);
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

        if (!this.animationFrameId) {
            this.runGameLoop();
        }

        // Immediately clear the placeholder when ROM is loaded
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, 240, 160);

        console.log(`[GBAJS3_Core] Loaded ROM data (${romData.byteLength} bytes). CPU is running.`);
    }

    pause() {
        this.paused = true;
        console.log('[GBAJS3_Core] Paused.');
    }
}
