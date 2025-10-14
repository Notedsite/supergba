// GBAJS3-Core.js (Full Script with Alpha Channel Fixes)

// === CONSTANTS for ARM Mode and Flags ===
const REG_PC = 15;
const ARM_MODE = 0b10000; // User mode
const FLAG_N = 0x80000000; 
const FLAG_Z = 0x40000000; 

// PPU Timing Constants
const H_CYCLES = 1232; 
const V_DRAW_LINES = 160;
const V_BLANK_LINES = 68;
const V_TOTAL_LINES = V_DRAW_LINES + V_BLANK_LINES;
const CYCLES_PER_FRAME = H_CYCLES * V_TOTAL_LINES; 
const CYCLES_PER_INSTRUCTION = 4; // 1 ARM instruction = 4 cycles

// IO Register Offsets 
const REG_DISPCNT  = 0x000; // Display Control (0x4000000)
const REG_DISPSTAT = 0x004; // Display Status (0x4000004) - V-Blank flag is Bit 0
const REG_VCOUNT   = 0x006; // V-Count (Current Scanline) (0x4000006)
const REG_WAITCNT  = 0x204; // Waitstate Control Register (0x4000204) <-- STUBBED
const REG_IME      = 0x208; // Interrupt Master Enable (0x4000208) <-- STUBBED

// === MemoryBus (Handles memory reads/writes) ===
class MemoryBus {
    constructor(core, ewram, iwram, vram, paletteRAM, oam, ioRegsView, romData, biosData) {
        this.core = core; 
        this.ewram = ewram; 
        this.iwram = iwram; 
        this.vram = vram; 	
        this.paletteRAM = paletteRAM; 
        this.oam = oam; 	
        this.ioRegsView = ioRegsView; 
        this.romData = romData;
        this.biosData = biosData; 
    }
    
    // --- READS ---
    read16(address) {
        address >>>= 0;
        if (address < 0x00004000 && this.biosData) {
            const biosView = new DataView(this.biosData);
            return biosView.getUint16(address, true); 
        }
        if (address >= 0x04000000 && address < 0x04000400) {
            const offset = address - 0x04000000;
            return this.ioRegsView.getUint16(offset, true);
        }
        return this.read32(address) & 0xFFFF;
    }

    read32(address) {
        address >>>= 0;
        if (address < 0x00004000 && this.biosData) {
            const biosView = new DataView(this.biosData);
            try { return biosView.getUint32(address, true); } catch (e) { return 0x0; }
        }
        if (address >= 0x08000000 && this.romData) {
            const romBase = 0x08000000;
            const offset = (address - romBase) % this.romData.byteLength;
            const romView = new DataView(this.romData.buffer);
            try { return romView.getUint32(offset, true); } catch (e) { return 0xDEADBEEF; }
        }
        return 0x0;
    }

    // --- WRITES ---
    write16(address, value) {
        address >>>= 0;
        value &= 0xFFFF;

        // 1. IO Register Write
        if (address >= 0x04000000 && address < 0x04000400) {
            const offset = address - 0x04000000;
            this.ioRegsView.setUint16(offset, value, true);
            if (this.core) { 
                this.core.handleIOWrite(address, value); 
            }
            return;
        }
        
        // 2. PRAM Write
        if (address >= 0x05000000 && address < 0x05000400) {
            const offset = address - 0x05000000;
            const view = new DataView(this.paletteRAM.buffer);
            view.setUint16(offset % this.paletteRAM.byteLength, value, true);
            return;
        }
        
        // 3. VRAM Write
        if (address >= 0x06000000 && address < 0x07000000) {
            const offset = address - 0x06000000;
            const view = new DataView(this.vram.buffer);
            view.setUint16(offset % this.vram.byteLength, value, true);
            return;
        }
        
        // 4. Internal WRAM Write
        if (address >= 0x03000000 && address < 0x03008000) {
            const offset = address - 0x03000000;
            const view = new DataView(this.iwram.buffer);
            view.setUint16(offset % this.iwram.byteLength, value, true);
            return;
        }
        
        // 5. External WRAM Write
        if (address >= 0x02000000 && address < 0x02040000) {
            const offset = address - 0x02000000;
            const view = new DataView(this.ewram.buffer);
            view.setUint16(offset % this.ewram.byteLength, value, true);
            return;
        }
    }

    write32(address, value) {
        this.write16(address, value & 0xFFFF);
        this.write16(address + 2, (value >>> 16) & 0xFFFF);
    }
}


// === GBA_CPU (The ARM7TDMI Interpreter) ===
class GBA_CPU {
    constructor(bus) {
        this.bus = bus;
        this.registers = new Uint32Array(16);
        this.CPSR = 0x00000010 | ARM_MODE; 
        this.registers[REG_PC] = 0x00000008; 
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
        const instructionAddress = currentPC - 8;
        const instruction = this.bus.read32(instructionAddress);
        
        let branchOccurred = false; 
        const isDataProcessing = (instruction >> 26) === 0b00; 
        const isLoadStore = (instruction >> 26) === 0b01; 
        const isHalfWordOrByte = ((instruction >> 25) & 0b111) === 0b000 && ((instruction >> 4) & 0b1111) === 0b1011;

        if (isLoadStore) {
            const isLoad = (instruction >> 20) & 0x1;
            const Rd = (instruction >> 12) & 0xF; 
            const Rn = (instruction >> 16) & 0xF; 
            const isImmediateOffset = !((instruction >> 25) & 0x1); 
            
            if (isHalfWordOrByte) {
                const H_code = (instruction >> 5) & 0b11; 
                const offset = (instruction & 0xF) | ((instruction >> 8) & 0xF0); 
                const baseAddress = this.registers[Rn];
                const targetAddress = baseAddress + offset;
                
                if (isLoad) { // LDRH
                    if (H_code === 0b01) { 
                        this.registers[Rd] = this.bus.read16(targetAddress);
                    }
                } else { // STRH
                    if (H_code === 0b01) { 
                        this.bus.write16(targetAddress, this.registers[Rd] & 0xFFFF);
                    }
                }
            }
            else if (isImmediateOffset) { 
                const offset = instruction & 0xFFF;
                const baseAddress = (Rn === REG_PC) ? (currentPC - 8) : this.registers[Rn];
                const targetAddress = baseAddress + offset;

                if (isLoad) { // LDR
                    const data = this.bus.read32(targetAddress & ~0x3);

                    if (Rd === REG_PC) {
                        this.registers[REG_PC] = (data & ~0x3) + 4; 
                        branchOccurred = true;
                        if (instructionAddress < 0x4000) {
                            console.log(`[CPU] BIOS jump to ROM detected. New PC: 0x${data.toString(16).toUpperCase().padStart(8, '0')}`);
                        }
                    } else {
                        this.registers[Rd] = data;
                    }
                } else { // STR
                    this.bus.write32(targetAddress, this.registers[Rd]);
                }
            }

        }
        else if (isDataProcessing) {
            const S = (instruction >> 20) & 0x1; 
            const Rn = (instruction >> 16) & 0xF; 
            const Rd = (instruction >> 12) & 0xF;
            const isImmediate = instruction & 0x02000000;
            let operand2 = isImmediate ? (instruction & 0xFF) : (this.registers[instruction & 0xF]); 
            const opcode = (instruction >> 21) & 0xF; 

            switch (opcode) {
                case 0b1000: { // TST
                    if (S) { 
                        const operand1 = this.registers[Rn];
                        const result = operand1 & operand2; 
                        this.setZNFlags(result);
                    }
                    break;
                }
                case 0b1101: { // MOV
                    this.registers[Rd] = operand2; 
                    if (S) { this.setZNFlags(this.registers[Rd]); }
                    break;
                }
                case 0b1100: { // ORR
                    this.registers[Rd] = this.registers[Rn] | operand2; 
                    if (S) { this.setZNFlags(this.registers[Rd]); }
                    break;
                }
                default: 
                    // Handle BEQ/BNE for V-Blank loop
                    if (instructionAddress === 0x94 && opcode === 0b0000) { 
                        if (this.CPSR & FLAG_Z) { 
                            this.registers[REG_PC] = 0x8C + 8;
                            branchOccurred = true;
                            return; 
                        }
                    } 
                    break;
            }
        }
        
        if (!branchOccurred) {
            this.registers[REG_PC] += 4; 
        }
    }
}


// === GBAJS3_Core (PPU/IO Initialization and Drawing Logic) ===
class GBAJS3_Core {
    constructor(containerElement, biosData) {
        this.ewram = new Uint8Array(0x40000); 
        this.iwram = new Uint8Array(0x8000);  
        this.vram = new Uint8Array(0x18000); 
        this.paletteRAM = new Uint8Array(0x400); 
        this.oam = new Uint8Array(0x400); 
        this.ioRegsView = new DataView(new ArrayBuffer(0x400)); 

        this.bus = new MemoryBus(
            this,
            this.ewram, this.iwram, this.vram, this.paletteRAM, this.oam, 
            this.ioRegsView, null, biosData
        );
        this.cpu = new GBA_CPU(this.bus);
        
        this.currentScanline = 0;
        this.cyclesToNextHBlank = H_CYCLES;
        
        this.paused = true; 
        this.animationFrameId = null; 
        this.currentVideoMode = 0; 

        this.ioRegsView.setUint16(REG_DISPSTAT, 0, true);
        this.ioRegsView.setUint16(REG_VCOUNT, 0, true);
        this.ioRegsView.setUint16(REG_WAITCNT, 0, true); 
        this.ioRegsView.setUint16(REG_IME, 0, true);     
        
        this.screen = document.createElement('canvas');
        this.screen.width = 240; this.screen.height = 160;
        this.screen.style.width = '240px';
        this.screen.style.height = '160px';
        containerElement.appendChild(this.screen);
        this.ctx = this.screen.getContext('2d');
        this.frameBuffer = this.ctx.createImageData(240, 160);
        this.frameData = this.frameBuffer.data; 

        this.drawPlaceholder(); 
        console.log('[GBAJS3_Core] Core initialized.');
    }

    drawPlaceholder() {
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, 240, 160);
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.font = '12px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('Core Initialized. Waiting for ROM.', 120, 80);
    }
    
    setVideoMode(mode) {
        const DISPCNT_ADDRESS = 0x04000000 + REG_DISPCNT;
        let currentValue = this.bus.read16(DISPCNT_ADDRESS);
        currentValue &= ~0x0007; 
        currentValue |= (mode & 0x7);
        if (mode === 3) {
            currentValue |= (1 << 10); 
        }
        this.bus.write16(DISPCNT_ADDRESS, currentValue);
        this.currentVideoMode = mode;
    }

    handleIOWrite(address, value) {
        const offset = address - 0x04000000;
        
        if (offset === REG_DISPCNT) {
            this.currentVideoMode = value & 0x7;
            if (value & 0x80) {
                this.currentVideoMode = -1; // Forced Blank
            }
        }
    }
    
    renderScreen() {
        const frameData = this.frameBuffer.data;
        const width = 240;
        const height = 160;
        const vramView = new DataView(this.vram.buffer);
        
        // --- STEP 1: GUARANTEE OPAQUE BACKGROUND ---
        // Magenta for unimplemented modes (0, 1, 2). Black for implemented (3) or others.
        let fillColor = (this.currentVideoMode >= 0 && this.currentVideoMode <= 2) 
                      ? [255, 0, 255] // Magenta 
                      : [0, 0, 0];   // Black
        
        for (let i = 0; i < frameData.length; i += 4) {
             frameData[i] = fillColor[0]; 
             frameData[i + 1] = fillColor[1]; 
             frameData[i + 2] = fillColor[2]; 
             frameData[i + 3] = 0xFF; // CRITICAL FIX: Alpha channel MUST be 0xFF
        }

        if (this.currentVideoMode === 3) {
            // Mode 3: 16-bit color, 240x160 bitmap
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const i = (y * width + x) * 4; 
                    const vram_offset = (y * width + x) * 2; 

                    if (vram_offset >= this.vram.byteLength) continue;

                    const color16 = vramView.getUint16(vram_offset, true);

                    let b5 = color16 & 0x1F;
                    let g5 = (color16 >> 5) & 0x1F;
                    let r5 = (color16 >> 10) & 0x1F; 

                    let r8 = (r5 << 3) | (r5 >> 2);
                    let g8 = (g5 << 3) | (g5 >> 2);
                    let b8 = (b5 << 3) | (b5 >> 2);
                    
                    frameData[i] = r8; 
                    frameData[i + 1] = g8; 
                    frameData[i + 2] = b8; 
                    frameData[i + 3] = 0xFF; // CRITICAL FIX: Alpha channel MUST be 0xFF
                }
            }
        } 
        
        // --- STEP 2: DRAW FRAMEBUFFER AND DEBUG INFO ---
        this.ctx.putImageData(this.frameBuffer, 0, 0); 

        // Draw Debug Info (ALWAYS OVERLAYED)
        const vcount = this.ioRegsView.getUint16(REG_VCOUNT, true);
        const pc = this.cpu.registers[REG_PC];
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.font = '10px monospace';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(`PC: 0x${pc.toString(16).toUpperCase().padStart(8, '0')}`, 5, 10);
        this.ctx.fillText(`VCOUNT: ${vcount}`, 5, 20);
        this.ctx.fillText(`MODE: ${this.currentVideoMode}`, 5, 30);
    }
    
    updatePPU(cycles) {
        this.cyclesToNextHBlank -= cycles;
        
        while (this.cyclesToNextHBlank <= 0) {
            this.cyclesToNextHBlank += H_CYCLES;

            let dispstat = this.ioRegsView.getUint16(REG_DISPSTAT, true);
            dispstat &= ~0x0007; 
            
            if (this.currentScanline >= V_DRAW_LINES) {
                dispstat |= 0x0001; 
                if (this.currentScanline === V_DRAW_LINES) { 
                    this.renderScreen(); 
                }
            }
            
            this.currentScanline++;

            if (this.currentScanline >= V_TOTAL_LINES) {
                this.currentScanline = 0;
                dispstat &= ~0x0001; 
            }
            
            dispstat |= 0x0002; 
            
            this.ioRegsView.setUint16(REG_VCOUNT, this.currentScanline, true);
            this.ioRegsView.setUint16(REG_DISPSTAT, dispstat, true);
        }
    }

    drawTestLogo() {
    // This is a minimal stub to put non-zero data into VRAM, simulating the BIOS logo
    // It's a placeholder for where actual BIOS rendering would happen.
    const VRAM_BASE = 0x06000000;
    const PRAM_BASE = 0x05000000;

    // 1. Set a background color (Palette entry 0) to a distinct color, e.g., Blue.
    this.bus.write16(PRAM_BASE, 0x7C00); // 0b11111 00000 00000 (Max Red)

    // 2. Draw a few non-black pixels in VRAM (Mode 3 is 2 bytes per pixel)
    for (let i = 0; i < 100; i++) {
        // Write the max green color to VRAM (0b00000 11111 00000)
        this.bus.write16(VRAM_BASE + i * 2, 0x03E0); 
    }
    
    // 3. Force the video mode to 3 for drawing
    this.setVideoMode(3);
}

// Update the loadRom method
loadRom(romData) {
    // ... (existing checks) ...
    
    this.romData = new Uint8Array(romData); 
    this.bus.romData = this.romData; 
    
    // Inject the test logo data BEFORE starting the loop
    this.drawTestLogo(); // <--- NEW LINE

    this.romLoaded = true;
    this.paused = false;
    
    // ... (rest of the function) ...
}

    runGameLoop() {
        this.animationFrameId = requestAnimationFrame(() => this.runGameLoop()); 
        
        if (!this.paused) {
            let cycles = 0; 
            
            while (cycles < CYCLES_PER_FRAME) {
                this.cpu.executeNextInstruction(); 
                this.updatePPU(CYCLES_PER_INSTRUCTION);
                cycles += CYCLES_PER_INSTRUCTION;
            }
        }
    }
}
