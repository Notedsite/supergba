// GBAJS3-Core.js (Scanline Rendering & Palette Fix)

// Use 'strict mode' for better coding practices, inspired by Iodine
"use strict";

// === CONSTANTS for CPU and Flags ===
const REG_PC = 15;
const ARM_MODE = 0b10000; 
const FLAG_Z = 0x40000000; 

// === PPU Timing Constants ===
const H_CYCLES = 1232; 
const H_BLANK_START_CYCLE = 1006; 
const V_DRAW_LINES = 160; 
const V_BLANK_LINES = 68;
const V_TOTAL_LINES = V_DRAW_LINES + V_BLANK_LINES; 
const CYCLES_PER_INSTRUCTION = 4; 

// === IO Register Offsets ===
const REG_DISPCNT  = 0x000; 
const REG_BG0CNT   = 0x008; 
const REG_DMA3CNT_H = 0x0DA; 

// === TILE MODE CONSTANTS ===
const TILE_SIZE_4BPP = 32; 
const TILE_SIZE_8BPP = 64; 
const TILE_MAP_ENTRY_SIZE = 2; 
const SCREEN_WIDTH = 240;
const SCREEN_HEIGHT = 160;

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
    
    // --- READS (Unchanged) ---
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
        
        if (address >= 0x05000000 && address < 0x05000400) {
            const offset = address - 0x05000000;
            const view = new DataView(this.paletteRAM.buffer);
            return view.getUint16(offset % this.paletteRAM.byteLength, true);
        }
        
        if (address >= 0x06000000 && address < 0x07000000) {
            const offset = address - 0x06000000;
            const view = new DataView(this.vram.buffer);
            return view.getUint16(offset % this.vram.byteLength, true);
        }
        
        if (address >= 0x08000000 && this.romData) {
            const romBase = 0x08000000;
            const offset = (address - romBase) % this.romData.byteLength;
            const romView = new DataView(this.romData.buffer);
            try { return romView.getUint16(offset, true); } catch (e) { return 0xFFFF; }
        }
        return 0x0;
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
        return this.read16(address) | (this.read16(address + 2) << 16);
    }

    // --- WRITES (Updated for Palette Conversion) ---
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
        
        // 2. PRAM Write (0x05000000 - 0x050003FF)
        if (address >= 0x05000000 && address < 0x05000400) {
            const offset = address - 0x05000000;
            const view = new DataView(this.paletteRAM.buffer);
            const index = (offset % this.paletteRAM.byteLength) / 2;
            
            // Write to the raw PRAM (needed for read-back)
            view.setUint16(offset % this.paletteRAM.byteLength, value, true);
            
            // CRITICAL: Convert and cache the RGB color for PPU drawing
            if (this.core) {
                this.core.convertPaletteColor(index, value);
            }
            return;
        }
        
        // 3. VRAM Write (0x06000000 - 0x06017FFF)
        if (address >= 0x06000000 && address < 0x07000000) {
            const offset = address - 0x06000000;
            const view = new DataView(this.vram.buffer);
            view.setUint16(offset % this.vram.byteLength, value, true);
            return;
        }
        
        // 4. Internal WRAM Write (Unchanged)
        if (address >= 0x03000000 && address < 0x03008000) {
            const offset = address - 0x03000000;
            const view = new DataView(this.iwram.buffer);
            view.setUint16(offset % this.iwram.byteLength, value, true);
            return;
        }
        
        // 5. External WRAM Write (Unchanged)
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

// === GBA_CPU (The ARM7TDMI Interpreter - Unchanged) ===
class GBA_CPU {
    constructor(bus) {
        this.bus = bus;
        this.registers = new Uint32Array(16);
        this.CPSR = 0x00000010 | ARM_MODE; 
        this.registers[REG_PC] = 0x00000008; 
    }

    setZNFlags(result) {
        this.CPSR &= ~(FLAG_Z | 0x80000000); // FLAG_N
        if (result === 0) {
            this.CPSR |= FLAG_Z;
        }
        if (result & 0x80000000) { 
            this.CPSR |= 0x80000000;
        }
    }
    
    executeNextInstruction() {
        const currentPC = this.registers[REG_PC];
        const instructionAddress = currentPC - 8;
        const instruction = this.bus.read32(instructionAddress);
        
        let branchOccurred = false; 
        const isLoadStore = (instruction >> 26) === 0b01; 

        if (isLoadStore) {
            const isLoad = (instruction >> 20) & 0x1;
            const Rd = (instruction >> 12) & 0xF; 
            const Rn = (instruction >> 16) & 0xF; 
            const isImmediateOffset = !((instruction >> 25) & 0x1); 
            
            if (isImmediateOffset) { 
                const offset = instruction & 0xFFF;
                const baseAddress = (Rn === REG_PC) ? (currentPC - 8) : this.registers[Rn];
                const targetAddress = baseAddress + offset;

                if (isLoad) { // LDR
                    const data = this.bus.read32(targetAddress & ~0x3);

                    if (Rd === REG_PC) {
                        this.registers[REG_PC] = (data & ~0x3) + 4; 
                        branchOccurred = true;
                        if (instructionAddress < 0x4000) {
                            console.log(`[BIOS TRACE] BIOS Exit: Jump to ROM/Entry point. New PC: 0x${data.toString(16).toUpperCase().padStart(8, '0')}`);
                        }
                    } else {
                        this.registers[Rd] = data;
                    }
                } else { // STR
                    this.bus.write32(targetAddress, this.registers[Rd]);
                }
            }
        }
        
        else if ((instruction >> 26) === 0b00) { // Data Processing
             const S = (instruction >> 20) & 0x1; 
             const Rn = (instruction >> 16) & 0xF; 
             const Rd = (instruction >> 12) & 0xF;
             const isImmediate = instruction & 0x02000000;
             let operand2 = isImmediate ? (instruction & 0xFF) : (this.registers[instruction & 0xF]); 
             const opcode = (instruction >> 21) & 0xF; 

            switch (opcode) {
                case 0b1101: { // MOV
                    this.registers[Rd] = operand2; 
                    if (S) { this.setZNFlags(this.registers[Rd]); }
                    break;
                }
                default: 
                    if (instructionAddress === 0x94 && opcode === 0b0000) { // TST at BIOS Stall
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
        return true; 
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

        // CRITICAL: Palette Cache (512 entries * 3 bytes R/G/B)
        this.paletteRGB = new Uint8Array(512 * 3); 

        this.bus = new MemoryBus(
            this,
            this.ewram, this.iwram, this.vram, this.paletteRAM, this.oam, 
            this.ioRegsView, null, biosData
        );
        this.cpu = new GBA_CPU(this.bus);
        
        // PPU/Loop state
        this.currentScanline = 0;
        this.lastRenderedLine = 0; // New: Tracks the last fully rendered line
        this.cyclesToNextHBlank = H_CYCLES;
        this.paused = true; 
        this.animationFrameId = null; 
        this.currentVideoMode = 0; 
        this.romLoaded = false;

        // Initialize I/O registers
        this.ioRegsView.setUint16(0x004, 0, true); 
        this.ioRegsView.setUint16(0x006, 0, true); 
        
        // Display Setup
        this.screen = document.createElement('canvas');
        this.screen.width = SCREEN_WIDTH; this.screen.height = SCREEN_HEIGHT;
        containerElement.appendChild(this.screen);
        this.ctx = this.screen.getContext('2d');
        this.frameBuffer = this.ctx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
        this.frameData = this.frameBuffer.data; 

        this.drawPlaceholder(); 
    }
    
    // === Palette Color Converter (Called by MemoryBus) ===
    convertPaletteColor(index, color16) {
        // GBA 15-bit color: xBBBBBGGGGGRRRRR
        // index is 0-511 (512 total entries, 16 BG palettes * 16 colors + 16 OBJ palettes * 16 colors)
        
        let b5 = color16 & 0x1F;
        let g5 = (color16 >> 5) & 0x1F;
        let r5 = (color16 >> 10) & 0x1F; 

        // Convert 5-bit color (0-31) to 8-bit color (0-255)
        let r8 = (r5 << 3) | (r5 >> 2);
        let g8 = (g5 << 3) | (g5 >> 2);
        let b8 = (b5 << 3) | (b5 >> 2);
        
        const palIndex = index * 3;
        this.paletteRGB[palIndex] = r8; 
        this.paletteRGB[palIndex + 1] = g8; 
        this.paletteRGB[palIndex + 2] = b8;
    }
    
    // === DMA STUB IMPLEMENTATION (Unchanged) ===
    dmaTransfer(channelIndex) {
        const REG_BASE = 0x40000B0 + (channelIndex * 12); 
        
        const srcAddr = this.bus.read32(REG_BASE - 8); 
        const dstAddr = this.bus.read32(REG_BASE - 4);
        const dmaCntH = this.bus.read16(REG_BASE + 4);
        const dmaCntL = this.bus.read16(REG_BASE + 2); 
    
        const transferCount = dmaCntL === 0 ? 0x4000 : (dmaCntL & 0xFFFF);
        const transferSize = (dmaCntH & 0x400) ? 4 : 2; 
    
        if (transferCount === 0) return;
    
        let currentSrc = srcAddr & ~0x3; 
        let currentDst = dstAddr & ~0x1; 
        
        for (let i = 0; i < transferCount; i++) {
            if (transferSize === 4) {
                const value = this.bus.read32(currentSrc);
                this.bus.write32(currentDst, value);
                currentSrc += 4;
                currentDst += 4;
            } else {
                const value = this.bus.read16(currentSrc);
                this.bus.write16(currentDst, value);
                currentSrc += 2;
                currentDst += 2;
            }
        }
        
        this.bus.write16(REG_BASE + 4, dmaCntH & 0x7FFF); 
    }

    // === IO WRITE HANDLER (Added flushRenderQueue) ===
    handleIOWrite(address, value) {
        const offset = address - 0x04000000;
        
        // CRITICAL: Flush pending scanlines on *any* PPU register write (0x000-0x100)
        if (offset < 0x100) {
            this.flushRenderQueue(); 
        }
        
        if (offset === REG_DISPCNT) {
            const newMode = value & 0x7;
            this.currentVideoMode = (value & 0x80) ? -1 : newMode; 
            return;
        }

        // DMA activation check (Unchanged)
        else if (offset === REG_DMA3CNT_H) {
            if (value & 0x8000) this.dmaTransfer(3); 
        }
        // ... (other DMA channels omitted for brevity)
    }
    
    // === BG Control Reading (Unchanged) ===
    readBgControl(bgIndex) {
        const address = 0x04000000 + REG_BG0CNT + (bgIndex * 2);
        const bgcnt = this.bus.read16(address);

        return {
            priority: bgcnt & 0x3,
            charBaseBlock: (bgcnt >> 2) & 0x3,
            colorMode: (bgcnt >> 7) & 0x1, // 0 for 16-color, 1 for 256-color
            screenBaseBlock: (bgcnt >> 8) & 0x1F,
        };
    }
    
    // === BG RENDERING (Scanline-specific implementation) ===
    renderBGScanLine(bgIndex, line) {
        const bgControl = this.readBgControl(bgIndex);
        const vramView = new DataView(this.vram.buffer);
        const frameData = this.frameBuffer.data;
        
        const is8bpp = bgControl.colorMode; 
        const tileBase = bgControl.charBaseBlock * 0x4000; 
        const mapBase = bgControl.screenBaseBlock * 0x800;  
        
        const mapWidthTiles = 32; 
        
        // Tiled BG scrolls are not implemented yet, so we only handle fixed position (0,0)
        const lineInTile = line % 8;
        const tileY = Math.floor(line / 8); 

        for (let tileX = 0; tileX < 30; tileX++) {
            
            const mapOffset = mapBase + ((tileY * mapWidthTiles) + tileX) * TILE_MAP_ENTRY_SIZE;
            
            if (mapOffset >= this.vram.byteLength) continue;

            const mapEntry = vramView.getUint16(mapOffset, true);
            
            const tileID = mapEntry & 0x3FF; 
            if (tileID === 0) continue; 
            
            const flipX = (mapEntry >> 10) & 0x1;
            const flipY = (mapEntry >> 11) & 0x1;
            const paletteID = (mapEntry >> 12) & 0xF; 

            
            const tileBytes = is8bpp ? TILE_SIZE_8BPP : TILE_SIZE_4BPP; 
            const tileDataOffset = tileBase + tileID * tileBytes;
            
            // Loop through 8 pixels (px) for the current scanline (lineInTile)
            for (let px = 0; px < 8; px++) {
                
                let localPx = px;
                let localPy = lineInTile;
                
                if (flipX) localPx = 7 - px;
                if (flipY) localPy = 7 - lineInTile; 

                const bytesPerTileRow = tileBytes / 8;
                // Calculate the byte offset within the VRAM tile data
                const byteOffset = tileDataOffset + (localPy * bytesPerTileRow) + Math.floor(localPx / (is8bpp ? 1 : 2));
                
                if (byteOffset >= this.vram.byteLength) continue;

                const tileByte = vramView.getUint8(byteOffset);
                let paletteIndex;

                if (is8bpp) {
                    paletteIndex = tileByte;
                } else {
                    paletteIndex = (localPx % 2) === 0 ? (tileByte & 0xF) : (tileByte >> 4);
                }

                if (paletteIndex === 0) continue; // Index 0 is transparent for BGs

                // CRITICAL: Calculate 15-bit palette index
                // BG colors are in the first 256 entries (index 0-255)
                // The index is either (paletteID * 16 + paletteIndex) for 4bpp 
                // or just paletteIndex for 8bpp
                const paletteIndex15 = is8bpp ? paletteIndex : (paletteID * 16 + paletteIndex);
                
                // Get pre-converted RGB values
                const palR = this.paletteRGB[paletteIndex15 * 3];
                const palG = this.paletteRGB[paletteIndex15 * 3 + 1];
                const palB = this.paletteRGB[paletteIndex15 * 3 + 2];

                const screenX = tileX * 8 + px;
                const screenY = line;
                
                if (screenX >= SCREEN_WIDTH) continue;
                
                const frameIndex = (screenY * SCREEN_WIDTH + screenX) * 4;

                frameData[frameIndex] = palR; 
                frameData[frameIndex + 1] = palG; 
                frameData[frameIndex + 2] = palB; 
                frameData[frameIndex + 3] = 0xFF; 
            }
        }
    }
    
    // === LINE RENDERING DISPATCHER (Replaces old drawMode0) ===
    renderScanLine(line) {
        const dispcnt = this.bus.read16(0x04000000 + REG_DISPCNT);
        const dispstat = this.bus.read16(0x04000000 + 0x004);

        if (dispcnt & 0x80) { // Forced Blank is ON
            const index = line * SCREEN_WIDTH * 4;
            const r = this.paletteRGB[0];
            const g = this.paletteRGB[1];
            const b = this.paletteRGB[2];
             for (let i = 0; i < SCREEN_WIDTH * 4; i += 4) {
                 this.frameData[index + i] = r; 
                 this.frameData[index + i + 1] = g; 
                 this.frameData[index + i + 2] = b; 
                 this.frameData[index + i + 3] = 0xFF; 
             }
            return;
        }

        // 1. Draw Background Color (Palette Index 0) for the whole line
        const index = line * SCREEN_WIDTH * 4;
        const r = this.paletteRGB[0];
        const g = this.paletteRGB[1];
        const b = this.paletteRGB[2];
         for (let i = 0; i < SCREEN_WIDTH * 4; i += 4) {
             this.frameData[index + i] = r; 
             this.frameData[index + i + 1] = g; 
             this.frameData[index + i + 2] = b; 
             this.frameData[index + i + 3] = 0xFF; 
         }

        // 2. Dispatch based on current video mode
        const mode = dispcnt & 0x7;
        
        if (mode === 0) {
            // Mode 0: Tiled BGs
            for (let bgIndex = 3; bgIndex >= 0; bgIndex--) {
                const bgEnableBit = 1 << (8 + bgIndex); 
                
                if (dispcnt & bgEnableBit) {
                    this.renderBGScanLine(bgIndex, line); 
                }
            }
        }
        else if (mode === 3) {
            // Mode 3: Full Bitmap (240x160)
            const vramView = new DataView(this.vram.buffer);
            for (let x = 0; x < SCREEN_WIDTH; x++) {
                const vram_offset = (line * SCREEN_WIDTH + x) * 2; 

                if (vram_offset >= this.vram.byteLength) continue;

                const pixel_color16 = vramView.getUint16(vram_offset, true);
                
                // Simplified drawing (No blending/priority check yet)
                if (pixel_color16 !== 0x0000) {
                    const palIndex = (pixel_color16 * 32) + 256; // Simplified: just a non-zero pixel
                    
                    let p_b5 = pixel_color16 & 0x1F;
                    let p_g5 = (pixel_color16 >> 5) & 0x1F;
                    let p_r5 = (pixel_color16 >> 10) & 0x1F; 

                    let p_r8 = (p_r5 << 3) | (p_r5 >> 2);
                    let p_g8 = (p_g5 << 3) | (p_g5 >> 2);
                    let p_b8 = (p_b5 << 3) | (p_b5 >> 2);
                    
                    const frameIndex = (line * SCREEN_WIDTH + x) * 4;
                    this.frameData[frameIndex] = p_r8; 
                    this.frameData[frameIndex + 1] = p_g8; 
                    this.frameData[frameIndex + 2] = p_b8; 
                    this.frameData[frameIndex + 3] = 0xFF; 
                }
            }
        }
        // ... (Other modes omitted)
    }

    // === FRAME RENDERING AND SYNCHRONIZATION ===

    // CRITICAL: Processes all scanlines that have accumulated since the last render or V-Blank.
    flushRenderQueue() {
        if (this.lastRenderedLine === this.currentScanline) {
             return; // Nothing to render
        }
        
        let line = this.lastRenderedLine;
        
        // Loop through all lines between the last rendered line and the current line
        while (line !== this.currentScanline) {
            
            if (line < V_DRAW_LINES) { // Only render visible lines (0-159)
                 this.renderScanLine(line);
            }
            
            line++;
            if (line >= V_TOTAL_LINES) {
                line = 0;
            }
        }
        
        // Mark current line as the new last rendered line
        this.lastRenderedLine = this.currentScanline;
        
        // If we processed line 159 and wrapped to 0, it means we are now in V-Blank, so draw to screen.
        if (this.currentScanline === 0) {
            this.drawToScreen();
        }
    }

    drawToScreen() {
        this.ctx.putImageData(this.frameBuffer, 0, 0); 
        
        const vcount = this.ioRegsView.getUint16(0x006, true);
        const pc = this.cpu.registers[REG_PC];
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.font = '10px monospace';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(`PC: 0x${pc.toString(16).toUpperCase().padStart(8, '0')}`, 5, 10);
        this.ctx.fillText(`VCOUNT: ${vcount}`, 5, 20);
        this.ctx.fillText(`MODE: ${this.currentVideoMode}`, 5, 30);
        this.ctx.fillText(`RENDERED: ${this.lastRenderedLine}`, 5, 40);
    }
    
    // === PPU CYCLE TIMING (Updated V-Blank check to use flushRenderQueue) ===
    updatePPU(cycles) {
        this.cyclesToNextHBlank -= cycles;
        
        while (this.cyclesToNextHBlank <= 0) {
            
            // 1. Check for HBlank start
            let dispstat = this.ioRegsView.getUint16(0x004, true);
            if (this.cyclesToNextHBlank <= (H_CYCLES - H_BLANK_START_CYCLE)) {
                if (!(dispstat & 0x0002)) { 
                    dispstat |= 0x0002; 
                    this.ioRegsView.setUint16(0x004, dispstat, true);
                }
            }
            
            // 2. End of Scanline (Cycle 1232)
            this.cyclesToNextHBlank += H_CYCLES;

            dispstat &= ~0x0002; // Clear H-Blank flag 

            this.currentScanline++;

            // --- V-BLANK CHECK ---
            if (this.currentScanline === V_DRAW_LINES) { 
                dispstat |= 0x0001; // Set V-Blank flag
                // Render all accumulated lines (0-159)
                this.flushRenderQueue(); 
            } else if (this.currentScanline >= V_TOTAL_LINES) {
                // Frame End: Line 228 -> Line 0
                this.currentScanline = 0;
                dispstat &= ~0x0001; // Clear V-Blank flag
            }
            
            // Update VCOUNT register (REG_VCOUNT)
            this.ioRegsView.setUint16(0x006, this.currentScanline, true);
            
            // Check V-Counter match and write final DISPSTAT
            const VCounterMatch = (dispstat >> 8) & 0xFF;
            if (this.currentScanline === VCounterMatch) {
                dispstat |= 0x0004; 
            } else {
                dispstat &= ~0x0004; 
            }
            this.ioRegsView.setUint16(0x004, dispstat, true);
        }
    }
    
    // ... (drawPlaceholder, loadRom, runGameLoop remain the same) ...
    drawPlaceholder() {
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, 240, 160);
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.font = '12px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('Core Initialized. Waiting for ROM.', 120, 80);
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
    }

    runGameLoop() {
        this.animationFrameId = requestAnimationFrame(() => this.runGameLoop()); 
        
        if (!this.paused) {
            let cycles = 0; 
            const MAX_CPU_STEPS_PER_FRAME = 70224 / 2;
            let steps = 0;
            
            while (cycles < H_CYCLES * V_TOTAL_LINES && steps < MAX_CPU_STEPS_PER_FRAME) {
                
                this.cpu.executeNextInstruction(); 
                this.updatePPU(CYCLES_PER_INSTRUCTION);
                cycles += CYCLES_PER_INSTRUCTION;
                steps++;
                
            }
        }
    }
}
