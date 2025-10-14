// GBAJS3-Core.js (Final Script with Mode 0 Tile Renderer)

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
const REG_DISPCNT  = 0x000; 
const REG_DISPSTAT = 0x004; 
const REG_VCOUNT   = 0x006; 
const REG_BG0CNT   = 0x008; // BG Control Register 0 (0x4000008)

// TILE MODE CONSTANTS
const TILE_SIZE = 32; // Bytes per 8x8 tile in 4-bit mode (16 colors)
const TILE_MAP_ENTRY_SIZE = 2; // Bytes per map entry

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
        // Memory allocation
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
        
        // PPU/Loop state (Fixes Syntax Error)
        this.currentScanline = 0;
        this.cyclesToNextHBlank = H_CYCLES;
        this.paused = true; 
        this.animationFrameId = null; 
        this.currentVideoMode = 0; 

        // Initialize I/O registers
        this.ioRegsView.setUint16(0x204, 0, true); // REG_WAITCNT
        this.ioRegsView.setUint16(0x208, 0, true); // REG_IME
        this.ioRegsView.setUint16(0x004, 0, true); // REG_DISPSTAT
        this.ioRegsView.setUint16(0x006, 0, true); // REG_VCOUNT
        
        // Display Setup
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
            currentValue |= (1 << 10); // Enable BG2
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
    
    // Helper function to read BG Control Register settings
    readBgControl(bgIndex) {
        const address = 0x04000000 + REG_BG0CNT + (bgIndex * 2);
        const bgcnt = this.bus.read16(address);

        return {
            charBaseBlock: (bgcnt >> 2) & 0x3,
            screenBaseBlock: (bgcnt >> 8) & 0x1F,
            colorMode: (bgcnt >> 7) & 0x1 // 0=4bpp (16 colors), 1=8bpp (256 colors)
        };
    }
    
    // New function to render the most common tile mode (Mode 0)
    drawMode0() {
        const bgIndex = 0; 
        const bgControl = this.readBgControl(bgIndex);

        const vramView = new DataView(this.vram.buffer);
        const prView = new DataView(this.paletteRAM.buffer);
        const frameData = this.frameBuffer.data;
        const is8bpp = bgControl.colorMode; 

        // Calculate Base Addresses (GBA VRAM is divided into 4 Char Blocks and 32 Screen Blocks)
        const tileBase = bgControl.charBaseBlock * 0x4000; // 16KB per block
        const mapBase = bgControl.screenBaseBlock * 0x800;  // 2KB per block

        // Screen is 30 tiles wide x 20 tiles high
        for (let tileY = 0; tileY < 20; tileY++) {
            for (let tileX = 0; tileX < 30; tileX++) {
                
                // 1. Read Tile Map Entry (Tile ID, Palette, Flip flags)
                const mapOffset = mapBase + (tileY * 32 + tileX) * TILE_MAP_ENTRY_SIZE;
                
                const mapEntry = vramView.getUint16(mapOffset, true);
                
                const tileID = mapEntry & 0x3FF; // Bits 0-9
                const paletteID = (mapEntry >> 12) & 0xF; // Bits 12-15 (for 4bpp only)
                // const flipX = (mapEntry >> 10) & 0x1; // Not implemented
                // const flipY = (mapEntry >> 11) & 0x1; // Not implemented

                if (tileID === 0) continue; 
                
                // 2. Calculate Tile Data Address
                const tileBytes = is8bpp ? 64 : TILE_SIZE; // 64 bytes for 8bpp, 32 bytes for 4bpp
                const tileDataOffset = tileBase + tileID * tileBytes;
                
                // 3. Draw Pixels of the Tile (8x8 loop)
                for (let py = 0; py < 8; py++) {
                    for (let px = 0; px < 8; px++) {
                        
                        // a. Calculate pixel data source offset
                        const bytesPerTileRow = tileBytes / 8;
                        const byteOffset = tileDataOffset + (py * bytesPerTileRow) + Math.floor(px / (is8bpp ? 1 : 2));
                        
                        if (byteOffset >= this.vram.byteLength) continue;

                        const tileByte = vramView.getUint8(byteOffset);
                        let paletteIndex;

                        if (is8bpp) {
                            // 8bpp: index is the entire byte (0-255)
                            paletteIndex = tileByte;
                        } else {
                            // 4bpp: index is a nibble (0-15)
                            paletteIndex = (px % 2) === 0 ? (tileByte & 0xF) : (tileByte >> 4);
                        }

                        // b. Handle Transparent Pixel (Index 0 is transparent)
                        if (paletteIndex === 0) continue; 

                        // c. Read Color from Palette RAM (PRAM)
                        // PRAM address: PRAM_Base + (Palette_Bank * 32) + (Palette_Index * 2)
                        const palBankOffset = is8bpp ? 0 : (paletteID * 32);
                        const palOffset = palBankOffset + (paletteIndex * 2);

                        const color16 = prView.getUint16(palOffset, true);
                        
                        // d. Convert BGR-555 to RGB-888
                        let b5 = color16 & 0x1F;
                        let g5 = (color16 >> 5) & 0x1F;
                        let r5 = (color16 >> 10) & 0x1F; 

                        let r8 = (r5 << 3) | (r5 >> 2);
                        let g8 = (g5 << 3) | (g5 >> 2);
                        let b8 = (b5 << 3) | (b5 >> 2);

                        // e. Calculate FrameBuffer Position
                        const screenX = tileX * 8 + px;
                        const screenY = tileY * 8 + py;
                        const frameIndex = (screenY * 240 + screenX) * 4;

                        // f. Draw to FrameBuffer
                        frameData[frameIndex] = r8; 
                        frameData[frameIndex + 1] = g8; 
                        frameData[frameIndex + 2] = b8; 
                        frameData[frameIndex + 3] = 0xFF; 
                    }
                }
            }
        }
    }

    renderScreen() {
        const frameData = this.frameBuffer.data;
        const width = 240;
        const height = 160;
        const vramView = new DataView(this.vram.buffer);
        const prView = new DataView(this.paletteRAM.buffer);
        
        // --- STEP 1: Determine Universal Background Color from PRAM index 0 ---
        let bgR = 0, bgG = 0, bgB = 0;
        
        // Read Palette RAM Index 0 (Universal BG Color)
        const color16 = prView.getUint16(0, true); 

        // Convert PRAM BGR-555 to RGB-888
        let b5 = color16 & 0x1F;
        let g5 = (color16 >> 5) & 0x1F;
        let r5 = (color16 >> 10) & 0x1F; 

        bgR = (r5 << 3) | (r5 >> 2);
        bgG = (g5 << 3) | (g5 >> 2);
        bgB = (b5 << 3) | (b5 >> 2);
        
        // If mode is Mode 1 or 2 (unimplemented tile modes), force MAGENTA clue
        if (this.currentVideoMode === 1 || this.currentVideoMode === 2) {
             bgR = 255; 
             bgG = 0; 
             bgB = 255; 
        }

        // --- STEP 2: Fill Framebuffer with the Background Color ---
        for (let i = 0; i < frameData.length; i += 4) {
             frameData[i] = bgR; 
             frameData[i + 1] = bgG; 
             frameData[i + 2] = bgB; 
             frameData[i + 3] = 0xFF; // Always Opaque
        }

        // --- STEP 3: Handle Graphics Mode Drawing (Pixel Overwrite) ---
        if (this.currentVideoMode === 3) {
            // Mode 3: 16-bit color, 240x160 bitmap
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const i = (y * width + x) * 4; 
                    const vram_offset = (y * width + x) * 2; 

                    if (vram_offset >= this.vram.byteLength) continue;

                    const pixel_color16 = vramView.getUint16(vram_offset, true);
                    
                    if (pixel_color16 !== 0x0000) {
                        let p_b5 = pixel_color16 & 0x1F;
                        let p_g5 = (pixel_color16 >> 5) & 0x1F;
                        let p_r5 = (pixel_color16 >> 10) & 0x1F; 

                        let p_r8 = (p_r5 << 3) | (p_r5 >> 2);
                        let p_g8 = (p_g5 << 3) | (p_g5 >> 2);
                        let p_b8 = (p_b5 << 3) | (p_b5 >> 2);
                        
                        frameData[i] = p_r8; 
                        frameData[i + 1] = p_g8; 
                        frameData[i + 2] = p_b8; 
                        frameData[i + 3] = 0xFF; 
                    }
                }
            }
        } 
        else if (this.currentVideoMode === 0) {
            // CRITICAL: Call the new Mode 0 renderer
            this.drawMode0();
        }

        // --- STEP 4: Render to Canvas and Draw Debug Overlay ---
        this.ctx.putImageData(this.frameBuffer, 0, 0); 

        // Draw Debug Info (ALWAYS OVERLAYED)
        const vcount = this.ioRegsView.getUint16(0x006, true);
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

            let dispstat = this.ioRegsView.getUint16(0x004, true);
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
            
            this.ioRegsView.setUint16(0x006, this.currentScanline, true);
            this.ioRegsView.setUint16(0x004, dispstat, true);
        }
    }

    loadRom(romData) {
        if (!romData || romData.byteLength === 0) throw new Error("Empty ROM data.");
        
        this.romData = new Uint8Array(romData); 
        this.bus.romData = this.romData; 
        
        this.romLoaded = true;
        this.paused = false;
        
        if (!this.animationFrameId) {
            this.runGameLoop();
        }
        console.log(`[GBAJS3_Core] ROM loaded. Emulation starting/resuming.`);
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
