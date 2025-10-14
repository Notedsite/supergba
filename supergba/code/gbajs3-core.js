// gbajs3-core.js

// === CONSTANTS for ARM Mode and Flags ===
const REG_PC = 15;
const ARM_MODE = 0b10000; // User mode (for now)
const FLAG_N = 0x80000000; // Negative flag (Bit 31)
const FLAG_Z = 0x40000000; // Zero flag (Bit 30)

// PPU Timing Constants
const H_CYCLES = 1232; // Cycles per H-Draw/H-Blank line
const V_DRAW_LINES = 160;
const V_BLANK_LINES = 68;
const V_TOTAL_LINES = V_DRAW_LINES + V_BLANK_LINES;

// === GBA Input Key Map ===
const KEY_MAP = {
    'z': 0x0001, 		 // A button
    'x': 0x0002, 		 // B button
    'Enter': 0x0004, 	 // Select
    ' ': 0x0008, 		 // Start (Spacebar)
    'ArrowRight': 0x0010,// Right
    'ArrowLeft': 0x0020, // Left
    'ArrowUp': 0x0040, 	 // Up
    'ArrowDown': 0x0080, // Down
    'a': 0x0100, 		 // R shoulder
    's': 0x0200, 		 // L shoulder
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

    // Helper for 8-bit writes (CRITICAL for REG_WSCNT)
    write8(address, value) {
        // 1. IO Register Write (0x04000000 - 0x040003FE)
        if (address >= 0x04000000 && address < 0x04000400) {
            const offset = address - 0x04000000;
            const currentWord = this.ioRegsView.getUint32(offset & ~0x3, true);
            
            // Calculate shift based on byte position (0, 8, 16, 24)
            const shift = (offset & 0x3) * 8; 
            
            // Clear the existing byte and OR in the new value
            const mask = 0xFF << shift;
            const newValue = (currentWord & ~mask) | ((value & 0xFF) << shift);
            
            this.ioRegsView.setUint32(offset & ~0x3, newValue, true);
            return;
        }
    }

    // Helper for 16-bit writes (CRITICAL for REG_DISPCNT/VRAM)
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

    // Helper for 32-bit writes (CRITICAL for VRAM/SWI)
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
    
    // NEW: SWI Handler (CpuSet is essential for logo data copy)
    handleSWI(swiNumber) {
        if (swiNumber === 0x0C) { // SWI 0x0C: CpuSet (Fill or Copy memory)
            
            // R0: Source Address
            const src = this.registers[0]; 
            // R1: Destination Address
            const dst = this.registers[1]; 
            // R2: Control Word
            const control = this.registers[2]; 
            
            const mode16Bit = (control >> 25) & 0x1; // 0=16-bit (2-byte), 1=32-bit (4-byte)
            const isFill = (control >> 24) & 0x1;    // 0=Copy, 1=Fill
            const count = control & 0xFFFFFF;        // Number of units
            
            if (!isFill) {
                // Copy operation (CRITICAL: Copies logo and palette)
                
                let currentSrc = src;
                let currentDst = dst;
                
                if (mode16Bit === 0) { // 16-bit copy (Used for Palette/DMA copy)
                    for (let i = 0; i < count; i++) {
                        const value = this.bus.read16(currentSrc);
                        this.bus.write16(currentDst, value);
                        currentSrc += 2;
                        currentDst += 2;
                    }
                } else { // 32-bit copy (Used for Logo Bitmap)
                     for (let i = 0; i < count; i++) {
                        const value = this.bus.read32(currentSrc);
                        this.bus.write32(currentDst, value);
                        currentSrc += 4;
                        currentDst += 4;
                    }
                }
            }
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
        
        // Block Data Transfer (STM/LDM)
        const isBlockDataTransfer = ((instruction >> 25) & 0b111) === 0b100;
        
        // Load/Store Register (LDR/STR)
        const isLoadStore = (instruction >> 26) === 0b01; 
        
        // SWI Check
        const isSWI = ((instruction >> 24) & 0b1111) === 0b1111; 

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
                // Data Processing Instruction
                const Rd = (instruction >> 12) & 0xF; 
                const isImmediate = instruction & 0x02000000;
                
                // Read Rn (first operand)
                const RnIndex = (instruction >> 16) & 0xF;
                let operand1 = this.registers[RnIndex]; 
                
                let operand2;
                
                // Determine Operand 2 (Immediate or Register)
                if (isImmediate) {
                    operand2 = instruction & 0xFF; 
                } else {
                    const Rm = instruction & 0xF;
                    operand2 = this.registers[Rm];
                    
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
                        
                    case 0b0010: // SUB 
                        result = (operand1 - operand2) >>> 0; 
                        break;
                        
                    case 0b0100: // ADD 
                        result = (operand1 + operand2) >>> 0; 
                        break;
                        
                    case 0b1010: // CMP (Compare)
                        result = (operand1 - operand2) >>> 0; 
                        break;
                        
                    case 0b1100: // ORR 
                        result = operand1 | operand2;
                        this.registers[Rd] = result;
                        break;
                        
                    case 0b1101: // MOV 
                        result = operand2; 
                        this.registers[Rd] = result;
                        break;
                        
                    default:
                        return;
                }
                
                // Set flags if S-bit is set or instruction is CMP
                if (instruction & 0x00100000 || opcode === 0b1010) { 
                    this.setZNFlags(result);
                }
                if (opcode !== 0b1010) {
                    this.registers[Rd] = result;
                }

            } else if (isBlockDataTransfer) {
                // Block Data Transfer (STM/LDM) 
                
                const Rn = (instruction >> 16) & 0xF; 
                const registerList = instruction & 0xFFFF; 
                const baseAddress = this.registers[Rn];
                
                const P_bit = (instruction >> 24) & 0x1; 
                const U_bit = (instruction >> 23) & 0x1; 
                const isStore = ((instruction >> 20) & 0x1) === 0x0; 
                const W_bit = (instruction >> 21) & 0x1; 

                if (isStore) { // STM (Store Multiple)
                    
                    let currentAddress = baseAddress;
                    let numRegisters = 0;
                    
                    for (let i = 0; i < 16; i++) {
                        if ((registerList >> i) & 0x1) {
                            numRegisters++;
                        }
                    }
                    
                    // Simplified: Assume STMDB (Decrement Before) 
                    if (P_bit === 1 && U_bit === 0) { 
                        currentAddress = baseAddress - (numRegisters * 4);
                    } 

                    let bytesWritten = 0;
                    for (let i = 0; i < 16; i++) {
                        if ((registerList >> i) & 0x1) {
                            let value = this.registers[i];
                            
                            // CRITICAL: R15 (PC) is stored as PC + 8
                            if (i === REG_PC) {
                                value = instructionAddress + 8;
                            }

                            this.bus.write32(currentAddress + bytesWritten, value);
                            bytesWritten += 4;
                        }
                    }

                    if (W_bit) {
                        this.registers[Rn] = currentAddress;
                    }
                }
                
            } else if (isLoadStore) {
                // Load/Store Instruction (LDR/STR, LDRH/STRH, LDRB/STRB)
                
                const Rd = (instruction >> 12) & 0xF; 
                const Rn = (instruction >> 16) & 0xF; 
                
                const isLoad = (instruction >> 20) & 0x1; 
                const isByte = (instruction >> 22) & 0x1; 
                
                // Half-Word/Signed Byte format check
                const isHalfWordOrByte = ((instruction >> 25) & 0b111) === 0b000 && ((instruction >> 4) & 0b1111) === 0b1011;

                if (isHalfWordOrByte) {
                    // LDRH / STRH
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
                    
                } else {
                    // Standard LDR/STR (32-bit) and LDRB/STRB (Byte)
                    const offset = instruction & 0xFFF; 
                    const baseAddress = this.registers[Rn];
                    const targetAddress = baseAddress + offset;
                    
                    if (isLoad) { // LDR / LDRB
                        let loadedValue;
                        if (isByte) {
                            // LDRB (Load Byte)
                            loadedValue = this.bus.read32(targetAddress) & 0xFF; 
                        } else { 
                            // LDR (32-bit)
                            loadedValue = this.bus.read32(targetAddress);
                        }
                        
                        this.registers[Rd] = loadedValue;
                        
                        if (Rd === REG_PC) {
                            this.registers[REG_PC] &= 0xFFFFFFFC; 
                        }
                        
                    } else { // STR / STRB
                        const value = this.registers[Rd];
                        if (isByte) {
                            // STRB (Store Byte)
                            this.bus.write8(targetAddress, value & 0xFF); 
                        } else { 
                            // STR (32-bit)
                            this.bus.write32(targetAddress, value);
                        }
                    }
                }
            } else if (isSWI) { // SWI (Software Interrupt) <--- SWI EXECUTION
                const swiNumber = instruction & 0xFFFFFF; 
                this.handleSWI(swiNumber);
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
        this.REG_DISPCNT = 0x000; // 0x04000000 (Display Control)
        this.REG_DISPSTAT = 0x004; // 0x04000004 (Display Status: V-Blank, H-Blank, VCOUNT)
        this.REG_VCOUNT = 0x006;   // 0x04000006 (Current Scanline)
        this.REG_BG0CNT = 0x008; 	// 0x04000008 (BG0 Control Register)

        // Initialize IO Registers
        this.ioRegsView.setUint16(this.REG_DISPCNT, 0x0000, true); 
        this.ioRegsView.setUint16(this.REG_DISPSTAT, 0x0000, true); 
        this.ioRegsView.setUint16(this.REG_VCOUNT, 0x0000, true); 
        this.ioRegsView.setUint16(this.REG_BG0CNT, 0x0000, true); 

        // PPU Timing Initialization
        this.currentScanline = 0;
        this.cyclesToNextHBlank = H_CYCLES;
        
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

        this.container.innerHTML = ''; // Clear "Loading core initialization..."
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
        this.ctx.putImageData(this.frameBuffer, 0, 0); 
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

    updatePPU(cycles) {
        this.cyclesToNextHBlank -= cycles;
        
        // Check for H-Blank and move to the next scanline
        while (this.cyclesToNextHBlank <= 0) {
            this.cyclesToNextHBlank += H_CYCLES;
            this.currentScanline++;

            // 1. Wrap around at the end of the frame
            if (this.currentScanline >= V_TOTAL_LINES) {
                this.currentScanline = 0;
            }

            // 2. Read existing status and clear dynamic flags
            let dispstat = this.ioRegsView.getUint16(this.REG_DISPSTAT, true);
            dispstat &= ~0x0003; // Clear V-Blank (Bit 0) and H-Blank (Bit 1)
            dispstat &= ~0x0004; // Clear VCOUNT Match Flag (Bit 2)
            
            // 3. Set V-Blank flag (Bit 0)
            if (this.currentScanline >= V_DRAW_LINES) {
                dispstat |= 0x0001; // Set V-Blank flag
                if (this.currentScanline === V_DRAW_LINES) {
                    this.renderScreen(); 
                }
            }
            
            // 4. Set H-Blank flag (Bit 1)
            dispstat |= 0x0002; 
            
            // 5. VCOUNT Match Check (Simplified: The BIOS waits for VCOUNT 0)
            if (this.currentScanline === 0) {
                 dispstat |= 0x0004; 
            }
            
            // 6. Update VCOUNT register (Current Scanline)
            this.ioRegsView.setUint16(this.REG_VCOUNT, this.currentScanline, true);
            this.ioRegsView.setUint16(this.REG_DISPSTAT, dispstat, true);
        }
    }


    runGameLoop() {
        if (!this.paused) {
            this.frameCounter++;
            
            // Run a high number of cycles per frame
            const CYCLES_PER_FRAME = 200000; 
            const cyclesPerStep = 50; 

            for (let i = 0; i < CYCLES_PER_FRAME; i += cyclesPerStep) {
                // Execute CPU instructions (Roughly 4 cycles per instruction)
                for(let j = 0; j < cyclesPerStep / 4; j++) { 
                    this.cpu.executeNextInstruction(); 
                }
                
                // Update PPU timing after each batch of execution
                this.updatePPU(cyclesPerStep);
            }
        }
        this.animationFrameId = requestAnimationFrame(() => this.runGameLoop());
    }

    // --- Helper to draw a single 8x8 tile (for Mode 0) ---
    drawTile(ctx, tileNum, tileBase, mapBase, paletteBank, x, y, flipH, flipV) {
        
        const tileDataOffset = tileBase + tileNum * 32; 
        const vramView = new DataView(this.vram.buffer);

        const paletteView = new DataView(this.paletteRAM.buffer);
        const paletteBaseOffset = paletteBank * 32; 

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                
                const byteOffset = tileDataOffset + row * 4 + Math.floor(col / 2);
                const byte = vramView.getUint8(byteOffset % this.vram.byteLength);

                let pixelIndex;
                if (col % 2 === 0) {
                    pixelIndex = byte & 0x0F; 
                } else {
                    pixelIndex = byte >> 4;
                }
                
                if (pixelIndex === 0) continue; 
                
                const colorOffset = paletteBaseOffset + pixelIndex * 2;
                const color16 = paletteView.getUint16(colorOffset % this.paletteRAM.byteLength, true);

                // BGR-555 to RGB-888 conversion
                let r5 = (color16 >> 10) & 0x1F; 
                let g5 = (color16 >> 5) & 0x1F;
                let b5 = color16 & 0x1F;
                let r8 = (r5 << 3) | (r5 >> 2);
                let g8 = (g5 << 3) | (g5 >> 2);
                let b8 = (b5 << 3) | (b5 >> 2);
                
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
        
        const dispcnt = this.ioRegsView.getUint16(this.REG_DISPCNT, true);
        const displayMode = dispcnt & 0x7; 
        const bg0Enabled = (dispcnt >> 8) & 0x1; 

        const vramView = new DataView(this.vram.buffer);
        
        // Clear frame data to black
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
                    
                    if (vram_offset >= this.vram.byteLength) continue;

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
            // Mode 0: Tiled Background Rendering 
            
            const bg0cnt = this.ioRegsView.getUint16(this.REG_BG0CNT, true);
            
            const tileBaseIndex = (bg0cnt >> 2) & 0x3;
            const tileBase = tileBaseIndex * 0x4000; 
            
            const mapBaseIndex = (bg0cnt >> 8) & 0x1F;
            const mapBaseOffset = mapBaseIndex * 0x800; 

            const MAP_TILE_WIDTH = 32; 

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
        this.ctx.fillText(`VCOUNT: ${this.currentScanline}`, 5, 30);
        this.ctx.fillText(`Mode: ${displayMode}`, 5, 40);
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

        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, 240, 160);

        console.log(`[GBAJS3_Core] Loaded ROM data (${romData.byteLength} bytes). CPU is running.`);
    }

    pause() {
        this.paused = true;
        console.log('[GBAJS3_Core] Paused.');
    }
}
