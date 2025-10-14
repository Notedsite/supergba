// GBAJS3-Core.js (Full Script with all Synchronization and Stubbing Fixes)

// === CONSTANTS for ARM Mode and Flags ===
const REG_PC = 15;
const ARM_MODE = 0b10000; // User mode
const FLAG_N = 0x80000000; 
const FLAG_Z = 0x40000000; 
// const FLAG_C = 0x20000000; 
// const FLAG_V = 0x10000000; 

// PPU Timing Constants
const H_CYCLES = 1232; 
const V_DRAW_LINES = 160;
const V_BLANK_LINES = 68;
const V_TOTAL_LINES = V_DRAW_LINES + V_BLANK_LINES;
const CYCLES_PER_FRAME = H_CYCLES * V_TOTAL_LINES; 
const CYCLES_PER_INSTRUCTION = 4; // 1 ARM instruction = 4 cycles

// IO Register Offsets (CRITICAL: MUST MATCH MEMORYBUS OFFSETS)
const REG_DISPCNT  = 0x000; // Display Control (0x4000000)
const REG_DISPSTAT = 0x004; // Display Status (0x4000004) - V-Blank flag is Bit 0
const REG_VCOUNT   = 0x006; // V-Count (Current Scanline) (0x4000006)
const REG_WAITCNT  = 0x204; // Waitstate Control Register (0x4000204) <-- STUBBED
const REG_IME      = 0x208; // Interrupt Master Enable (0x4000208) <-- STUBBED


// === MemoryBus (Handles memory reads/writes) ===
class MemoryBus {
    constructor(ewram, iwram, vram, paletteRAM, oam, ioRegsView, romData, biosData) {
        // Data Buffers
        this.ewram = ewram; // 0x02000000 (External WRAM, 256KB)
        this.iwram = iwram; // 0x03000000 (Internal WRAM, 32KB)
        this.vram = vram; 	// 0x06000000 (VRAM, 96KB)
        this.paletteRAM = paletteRAM; // 0x05000000 (PRAM, 1KB)
        this.oam = oam; 	// 0x07000000 (OAM, 1KB)
        
        // IO Registers (DataView for 0x04000000)
        this.ioRegsView = ioRegsView; 

        this.romData = romData;
        this.biosData = biosData; 
    }
    
    // --- READS ---
    read16(address) {
        address >>>= 0; // Unsigned 32-bit int

        // 1. BIOS Region (0x00000000 - 0x00003FFE)
        if (address < 0x00004000 && this.biosData) {
            const biosView = new DataView(this.biosData);
            return biosView.getUint16(address, true); 
        }
        
        // 2. IO Register Read (0x04000000 - 0x040003FE)
        if (address >= 0x04000000 && address < 0x04000400) {
            const offset = address - 0x04000000;
            return this.ioRegsView.getUint16(offset, true);
        }

        // Default: Fallback to 32-bit read and mask 
        return this.read32(address) & 0xFFFF;
    }

    read32(address) {
        address >>>= 0;
        // 1. BIOS Region (0x00000000 - 0x00003FFC)
        if (address < 0x00004000 && this.biosData) {
            const biosView = new DataView(this.biosData);
            try {
                return biosView.getUint32(address, true); 
            } catch (e) {
                return 0x0; 
            }
        }
        // 2. ROM Region (0x08000000 - 0x09FFFFFF)
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
        return 0x0;
    }

    // --- WRITES ---
    write16(address, value) {
        address >>>= 0;
        value &= 0xFFFF;

        // 1. IO Register Write (0x04000000 - 0x040003FE)
        if (address >= 0x04000000 && address < 0x04000400) {
            const offset = address - 0x04000000;
            this.ioRegsView.setUint16(offset, value, true);
            return;
        }
        
        // 2. PRAM Write (0x05000000 - 0x050003FF)
        if (address >= 0x05000000 && address < 0x05000400) {
            const offset = address - 0x05000000;
            const view = new DataView(this.paletteRAM.buffer);
            view.setUint16(offset % this.paletteRAM.byteLength, value, true);
            return;
        }
        
        // 3. VRAM Write (0x06000000 - 0x07000000)
        if (address >= 0x06000000 && address < 0x07000000) {
            const offset = address - 0x06000000;
            const view = new DataView(this.vram.buffer);
            view.setUint16(offset % this.vram.byteLength, value, true);
            return;
        }
        
        // 4. Internal WRAM Write (0x03000000 - 0x03007FFF)
        if (address >= 0x03000000 && address < 0x03008000) {
            const offset = address - 0x03000000;
            const view = new DataView(this.iwram.buffer);
            view.setUint16(offset % this.iwram.byteLength, value, true);
            return;
        }
        
        // 5. External WRAM Write (0x02000000 - 0x0203FFFF)
        if (address >= 0x02000000 && address < 0x02040000) {
            const offset = address - 0x02000000;
            const view = new DataView(this.ewram.buffer);
            view.setUint16(offset % this.ewram.byteLength, value, true);
            return;
        }
    }

    write32(address, value) {
        // Simplified VRAM/PRAM/WRAM 32-bit writes by chaining 16-bit writes
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
        
        // Set PC to 0x8 for execution at 0x0 (ARM pipeline model)
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
        // The instruction to be EXECUTED is at PC - 8 (for proper ARM pipeline behavior)
        const instructionAddress = currentPC - 8;
        const instruction = this.bus.read32(instructionAddress);
        
        let branchOccurred = false; 

        // Simplified Cond check: assume cond E (0b1110) for BIOS 
        
        const opcode = (instruction >> 21) & 0xF; 
        const isDataProcessing = (instruction >> 26) === 0b00; 
        const isLoadStore = (instruction >> 26) === 0b01; 
        
        // Check for LDRH/STRH pattern: Bit 25=0, Bit 7=1, Bit 4=1 (0b000xxxxx1x1)
        const isHalfWordOrByte = ((instruction >> 25) & 0b111) === 0b000 && ((instruction >> 4) & 0b1111) === 0b1011;

        if (isLoadStore) {
            const isLoad = (instruction >> 20) & 0x1;
            const Rd = (instruction >> 12) & 0xF; 
            const Rn = (instruction >> 16) & 0xF; 
            const isImmediateOffset = !((instruction >> 25) & 0x1); 
            
            if (isHalfWordOrByte) {
                // LDRH / STRH (Used heavily for IO/VBlank checks)
                const H_code = (instruction >> 5) & 0b11; 
                const offset = (instruction & 0xF) | ((instruction >> 8) & 0xF0); 
                
                const baseAddress = this.registers[Rn];
                const targetAddress = baseAddress + offset;
                
                if (isLoad) { // LDRH
                    if (H_code === 0b01) { 
                        this.registers[Rd] = this.bus.read16(targetAddress);
                    }
                } else { // STRH (Initial DISPCNT/WAITCNT writes)
                    if (H_code === 0b01) { 
                        this.bus.write16(targetAddress, this.registers[Rd] & 0xFFFF);
                    }
                }
            }
            
            // General LDR/STR (used for PC-relative loads)
            else if (isImmediateOffset) { 
                const offset = instruction & 0xFFF;
                // Base is PC (R15)
                const baseAddress = (Rn === REG_PC) ? (currentPC - 8) : this.registers[Rn]; // ARM Mode uses PC-8 for offset calculation
                const targetAddress = baseAddress + offset;

                if (isLoad) { // LDR
                    const data = this.bus.read32(targetAddress & ~0x3);

                    if (Rd === REG_PC) {
                        // CRITICAL FIX: PC Load (Final ROM jump)
                        this.registers[REG_PC] = (data & ~0x3) + 4; // Set PC to target + 4 for next fetch
                        branchOccurred = true;
                        if (instructionAddress < 0x4000) {
                            console.log(`[CPU] BIOS jump to ROM detected. New PC: 0x${data.toString(16).toUpperCase().padStart(8, '0')}`, 'success');
                        }
                    } else {
                        // Regular register load
                        this.registers[Rd] = data;
                    }
                } else { // STR
                    // Simple STR (write data from Rd to memory)
                    this.bus.write32(targetAddress, this.registers[Rd]);
                }
            }

        }
        else if (isDataProcessing) {
            // Setup for DP ops
            const S = (instruction >> 20) & 0x1; 
            const Rn = (instruction >> 16) & 0xF; 
            const Rd = (instruction >> 12) & 0xF;
            
            const isImmediate = instruction & 0x02000000;
            let operand2 = isImmediate ? (instruction & 0xFF) : (this.registers[instruction & 0xF]); 

            switch (opcode) {
                case 0b1000: { // TST (Used at 0x90 for V-Blank check)
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
                case 0b1100: { // ORR (Used for flag setting)
                    this.registers[Rd] = this.registers[Rn] | operand2; 
                    if (S) { this.setZNFlags(this.registers[Rd]); }
                    break;
                }
                default: 
                    // Handle BEQ/BNE - only need BEQ for V-Blank loop
                    if (instructionAddress === 0x94 && opcode === 0b0000) { 
                        if (this.CPSR & FLAG_Z) { 
                            // Z=1 (V-Blank flag is 0, keep waiting)
                            this.registers[REG_PC] = 0x8C + 8; // Jump back to LDRH instruction + 8
                            branchOccurred = true;
                            return; // Stop execution this cycle, effectively stalling
                        } else {
                            // Z=0 (V-Blank flag is 1, loop broken)
                            console.log('[CPU] V-Blank stall broken (PC=0x98).', 'success');
                        }
                    } 
                    break;
            }
        }
        
        // --- Final PC Advance ---
        if (!branchOccurred) {
            this.registers[REG_PC] += 4; 
        }
    }
}


// === GBAJS3_Core (PPU/IO Initialization and Drawing Logic) ===
class GBAJS3_Core {
    constructor(containerElement, biosData) {
        // Memory allocation setup
        this.ewram = new Uint8Array(0x40000); // 256KB
        this.iwram = new Uint8Array(0x8000);  // 32KB
        this.vram = new Uint8Array(0x18000); // 96KB
        this.paletteRAM = new Uint8Array(0x400); // 1KB
        this.oam = new Uint8Array(0x400); // 1KB
        this.ioRegsView = new DataView(new ArrayBuffer(0x400)); // 1KB for I/O

        this.bus = new MemoryBus(this.ewram, this.iwram, this.vram, this.paletteRAM, this.oam, this.ioRegsView, null, biosData);
        this.cpu = new GBA_CPU(this.bus);
        
        // PPU Timing Initialization
        this.currentScanline = 0;
        this.cyclesToNextHBlank = H_CYCLES;
        this.paused = true; 
        this.animationFrameId = null; // Initialize the frame ID

        // Initialize I/O status registers (CRITICAL STUBBING)
        this.ioRegsView.setUint16(REG_DISPSTAT, 0, true);
        this.ioRegsView.setUint16(REG_VCOUNT, 0, true);
        this.ioRegsView.setUint16(REG_WAITCNT, 0, true); // Stubbed: WAITCNT
        this.ioRegsView.setUint16(REG_IME, 0, true);     // Stubbed: IME
        
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
        console.log('[GBAJS3_Core] Core initialized. CPU waiting for V-Blank interrupt or ROM start.');
    }

    drawPlaceholder() {
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, 240, 160);
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.font = '12px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('Core Initialized. Waiting for ROM.', 120, 80);
        // Note: putImageData is called at the end of renderScreen, not here, but this is fine for initial draw
        this.ctx.putImageData(this.frameBuffer, 0, 0); 
    }
    
    // Debug method to force Mode 3 (needed for BIOS logo display)
    setVideoMode(mode) {
        const DISPCNT_ADDRESS = 0x04000000 + REG_DISPCNT;
        let currentValue = this.bus.read16(DISPCNT_ADDRESS);
        currentValue &= ~0x0007; // Clear mode bits (Bits 0-2)
        currentValue |= (mode & 0x7);
        // The BIOS logo uses mode 3 and enables BG2.
        if (mode === 3) {
            currentValue |= (1 << 10); // Enable BG2
        }
        this.bus.write16(DISPCNT_ADDRESS, currentValue);
    }
    
    renderScreen() {
        // We are only concerned with Mode 3 (used by the BIOS logo)
        const frameData = this.frameBuffer.data;
        const width = 240;
        const height = 160;
        const vramView = new DataView(this.vram.buffer);
        const DISPCNT_ADDRESS = 0x04000000 + REG_DISPCNT;
        const dispcnt = this.bus.read16(DISPCNT_ADDRESS);
        
        const videoMode = dispcnt & 0x7;
        
        if (videoMode === 3) {
            // Mode 3: 16-bit color, 240x160, uses VRAM at 0x06000000
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const i = (y * width + x) * 4; // Canvas data offset (RGBA)
                    const vram_offset = (y * width + x) * 2; // VRAM data offset (16-bit color)
                    
                    if (vram_offset >= this.vram.byteLength) continue;

                    const color16 = vramView.getUint16(vram_offset, true);

                    // GBA bit layout: x RRRRR GGGGG BBBBB (BGR-555 format)
                    let b5 = color16 & 0x1F;
                    let g5 = (color16 >> 5) & 0x1F;
                    let r5 = (color16 >> 10) & 0x1F; 

                    // CRITICAL FIX: BGR-555 to RGB-888 scaling (x8 + top 3 bits)
                    let r8 = (r5 << 3) | (r5 >> 2);
                    let g8 = (g5 << 3) | (g5 >> 2);
                    let b8 = (b5 << 3) | (b5 >> 2);
                    
                    frameData[i] = r8; 
                    frameData[i + 1] = g8; 
                    frameData[i + 2] = b8; 
                    frameData[i + 3] = 0xFF; // Alpha channel
                }
            }
        }
        
        this.ctx.putImageData(this.frameBuffer, 0, 0);

        // Draw Debug Info
        const vcount = this.ioRegsView.getUint16(REG_VCOUNT, true);
        const pc = this.cpu.registers[REG_PC];
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.font = '10px monospace';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(`PC: 0x${pc.toString(16).toUpperCase().padStart(8, '0')}`, 5, 10);
        this.ctx.fillText(`VCOUNT: ${vcount}`, 5, 20);
    }
    
    updatePPU(cycles) {
        this.cyclesToNextHBlank -= cycles;
        
        while (this.cyclesToNextHBlank <= 0) {
            this.cyclesToNextHBlank += H_CYCLES;

            // 1. Read/Clear Status Register
            let dispstat = this.ioRegsView.getUint16(REG_DISPSTAT, true);
            dispstat &= ~0x0007; // Clear V-Blank (0), H-Blank (1), VCOUNT Match (2)
            
            // 2. V-Blank Flag Logic
            if (this.currentScanline >= V_DRAW_LINES) {
                dispstat |= 0x0001; // <--- V-BLANK FLAG SET (Bit 0)
                if (this.currentScanline === V_DRAW_LINES) { 
                    // Start of V-Blank (Line 160): Trigger rendering
                    this.renderScreen(); 
                }
            }
            
            // 3. Advance Scanline
            this.currentScanline++;

            // 4. Line Wrap and V-Blank Clear
            if (this.currentScanline >= V_TOTAL_LINES) {
                this.currentScanline = 0;
                dispstat &= ~0x0001; // Clear V-Blank Flag (Bit 0) on line 0
            }
            
            // Re-Set H-Blank (Bit 1) for the H-Blank period (always set after H-Draw)
            dispstat |= 0x0002; 
            
            // Write VCOUNT and DISPSTAT registers (MUST be synchronous)
            this.ioRegsView.setUint16(REG_VCOUNT, this.currentScanline, true);
            this.ioRegsView.setUint16(REG_DISPSTAT, dispstat, true);
        }
    }

    loadRom(romData) {
        if (!romData || romData.byteLength === 0) throw new Error("Empty ROM data.");
        
        this.romData = new Uint8Array(romData); 
        this.bus.romData = this.romData; 
        
        this.romLoaded = true;
        this.paused = false;
        
        // Only start the loop once
        if (!this.animationFrameId) {
            this.runGameLoop();
        }
        console.log(`[GBAJS3_Core] ROM loaded. Emulation starting/resuming.`);
    }

    runGameLoop() {
        // CRITICAL: Use requestAnimationFrame to drive the loop 
        this.animationFrameId = requestAnimationFrame(() => this.runGameLoop()); 
        
        if (!this.paused) {
            let cycles = 0; 
            
            // TIGHT INTERLEAVING loop: Execute the required cycles for a single frame
            while (cycles < CYCLES_PER_FRAME) {
                
                // 1. Execute exactly one ARM instruction (4 cycles)
                this.cpu.executeNextInstruction(); 
                
                // 2. Update PPU logic based on the 4 cycles consumed
                this.updatePPU(CYCLES_PER_INSTRUCTION);
                cycles += CYCLES_PER_INSTRUCTION;
            }
        }
    }
}
