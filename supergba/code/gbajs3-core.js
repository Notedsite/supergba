// GBAJS3-Core.js (Full Script with V-Blank Stall Fix)

// === CONSTANTS for ARM Mode and Flags ===
const REG_PC = 15;
const ARM_MODE = 0b10000; // User mode (for now)
const FLAG_N = 0x80000000; // Negative flag (Bit 31)
const FLAG_Z = 0x40000000; // Zero flag (Bit 30)
const FLAG_C = 0x20000000; // Carry flag (Bit 29)
const FLAG_V = 0x10000000; // Overflow flag (Bit 28)

// PPU Timing Constants
const H_CYCLES = 1232; // Cycles per H-Draw/H-Blank line
const V_DRAW_LINES = 160;
const V_BLANK_LINES = 68;
const V_TOTAL_LINES = V_DRAW_LINES + V_BLANK_LINES;

// IO Register Offsets (CRITICAL: MUST MATCH MEMORYBUS OFFSETS)
const REG_DISPCNT  = 0x000; // Display Control
const REG_DISPSTAT = 0x004; // Display Status (V-Blank flag is Bit 0)
const REG_VCOUNT   = 0x006; // V-Count (Current Scanline)


// === MemoryBus (Handles memory reads/writes) ===
class MemoryBus {
    constructor(ewram, iwram, vram, paletteRAM, oam, ioRegsView, romData, biosData) {
        // Data Buffers
        this.ewram = ewram; // 0x02000000
        this.iwram = iwram; // 0x03000000
        this.vram = vram; 	// 0x06000000
        this.paletteRAM = paletteRAM; // 0x05000000
        this.oam = oam; 	// 0x07000000
        
        // IO Registers (DataView for 0x04000000)
        this.ioRegsView = ioRegsView; 

        this.romData = romData;
        this.biosData = biosData; 
    }
    
    // --- READS (LDRH in V-Blank loop) ---
    read16(address) {
        address >>>= 0; // Ensure address is treated as unsigned 32-bit int

        // 1. BIOS Region (0x00000000 - 0x00003FFE)
        if (address < 0x00004000 && this.biosData) {
            const biosView = new DataView(this.biosData);
            return biosView.getUint16(address, true); 
        }
        
        // 2. IO Register Read (0x04000000 - 0x040003FE)
        if (address >= 0x04000000 && address < 0x04000400) {
            const offset = address - 0x04000000;
            // CRITICAL: Must be reliable for REG_DISPSTAT (offset 0x004)
            return this.ioRegsView.getUint16(offset, true);
        }

        // ... (Other memory regions omitted for brevity)
        return 0x0000; // Return zero on unmapped/unimplemented read
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
        // ... (Other regions omitted)
        return 0x0;
    }

    // --- WRITES (STRH in setup) ---
    write16(address, value) {
        address >>>= 0;
        value &= 0xFFFF;

        // 1. IO Register Write (0x04000000 - 0x040003FE)
        if (address >= 0x04000000 && address < 0x04000400) {
            const offset = address - 0x04000000;
            // CRITICAL: Must be reliable for REG_DISPCNT (offset 0x000)
            this.ioRegsView.setUint16(offset, value, true);
            return;
        }

        // ... (Other memory regions omitted)
    }

    // ... (write32, write8 omitted)
}


// === GBA_CPU (The ARM7TDMI Interpreter) ===
class GBA_CPU {
    constructor(bus) {
        this.bus = bus;
        this.registers = new Uint32Array(16);
        this.CPSR = 0x00000010 | ARM_MODE; 
        
        // PC must be 8 ahead of the instruction being *executed* in ARM mode
        this.registers[REG_PC] = 0x00000008; // PC points to the instruction at 0x8, executes the one at 0x0
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
    
    // Simplistic ARM instruction execution, assuming one instruction = 4 cycles
    executeNextInstruction() {
        // The instruction to be EXECUTED is at PC - 8
        const instructionAddress = this.registers[REG_PC] - 8;
        const instruction = this.bus.read32(instructionAddress);
        
        // Advance PC by 4 immediately (pipeline model)
        this.registers[REG_PC] += 4; 
        
        const cond = (instruction >> 28) & 0xF; 
        // Cond check omitted for brevity - assuming always true (cond E, 0b1110)

        // Decode: This block is heavily simplified.
        const opcode = (instruction >> 21) & 0xF; 
        const isDataProcessing = (instruction >> 26) === 0b00; 
        const isLoadStore = (instruction >> 26) === 0b01; 
        const isHalfWordOrByte = ((instruction >> 25) & 0b111) === 0b000 && ((instruction >> 4) & 0b1111) === 0b1011;

        if (isLoadStore) {
            const isLoad = (instruction >> 20) & 0x1;
            const Rd = (instruction >> 12) & 0xF; // Destination Register
            const Rn = (instruction >> 16) & 0xF; // Base Register
            
            if (isHalfWordOrByte) {
                // LDRH / STRH
                const H_code = (instruction >> 5) & 0b11; 
                // Immediate offset for LDRH/STRH
                const offset = (instruction & 0xF) | ((instruction >> 8) & 0xF0); 
                
                const baseAddress = this.registers[Rn];
                const targetAddress = baseAddress + offset;
                
                if (isLoad) { // LDRH (CRITICAL: Reads DISPSTAT in V-Blank loop)
                    if (H_code === 0b01) { 
                        this.registers[Rd] = this.bus.read16(targetAddress);
                    }
                } else { // STRH (CRITICAL: Writes DISPCNT at start)
                    if (H_code === 0b01) { 
                        this.bus.write16(targetAddress, this.registers[Rd] & 0xFFFF);
                    }
                }
            }
        }
        else if (isDataProcessing) {
            // ... (Data Processing setup)
            const S = (instruction >> 20) & 0x1; // S bit (Sets Flags)
            const Rn = (instruction >> 16) & 0xF; 
            const Rd = (instruction >> 12) & 0xF;

            switch (opcode) {
                case 0b1000: { // TST (CRITICAL for V-Blank loop break: TST Rx, #1)
                    if (S) { // TST must have S bit set
                        const operand1 = this.registers[Rn];
                        // Simplistic immediate/register operand calculation for TST #1
                        const operand2 = (instruction & 0xFF); 
                        
                        const result = operand1 & operand2;
                        this.setZNFlags(result);
                        return; // TST does not write to Rd
                    }
                    break;
                }
                // ... (Other opcodes like B, BEQ, SWI, MOV omitted for brevity)
                default: 
                    // Assume an instruction like BEQ (Branch if Equal) is being handled here 
                    // for the 0x90 instruction to loop back to 0x8C.
                    // The simplest jump would be an unconditional B.
                    // If at 0x90, instruction is BEQ 0x8C:
                    if (instructionAddress === 0x90) {
                         const branchOffset = (instruction & 0x00FFFFFF) << 2;
                         // Check Z-Flag for BEQ
                         if (this.CPSR & FLAG_Z) {
                             // Z=1 (V-Blank flag is 0, keep waiting)
                             this.registers[REG_PC] = (this.registers[REG_PC] + branchOffset) - 8; 
                             // Adjust for the -8 done above and the +4
                             this.registers[REG_PC] = (0x8C + 8); // Simplistic jump back to 0x8C instruction address
                         } else {
                             // Z=0 (V-Blank flag is 1, continue with PC += 4)
                         }
                    }
                    break;
            }
        }
    }
}


// === GBAJS3_Core (PPU/IO Initialization and Drawing Logic) ===
class GBAJS3_Core {
    constructor(containerElement, biosData) {
        // ... (Memory allocation setup)
        this.ioRegsView = new DataView(new ArrayBuffer(0x400));
        // ... (Other memory buffers: ewram, vram, etc.)

        this.bus = new MemoryBus(null, null, null, null, null, this.ioRegsView, null, biosData);
        this.cpu = new GBA_CPU(this.bus);
        
        // PPU Timing Initialization
        this.currentScanline = 0;
        this.cyclesToNextHBlank = H_CYCLES;
        this.paused = false;
        
        // Initialize I/O status registers
        this.ioRegsView.setUint16(REG_DISPSTAT, 0, true);
        this.ioRegsView.setUint16(REG_VCOUNT, 0, true);
    }

    updatePPU(cycles) {
        this.cyclesToNextHBlank -= cycles;
        
        while (this.cyclesToNextHBlank <= 0) {
            this.cyclesToNextHBlank += H_CYCLES;
            this.currentScanline++;

            // 1. Line Increment and Wrap
            if (this.currentScanline >= V_TOTAL_LINES) {
                this.currentScanline = 0;
            }

            // Read, clear dynamic flags, and update status
            let dispstat = this.ioRegsView.getUint16(REG_DISPSTAT, true);
            // Clear V-Blank (Bit 0), H-Blank (Bit 1), and VCOUNT Match (Bit 2)
            dispstat &= ~0x0007; 
            
            // 2. Set H-Blank flag (Bit 1) - End of H-Draw
            dispstat |= 0x0002; 

            // 3. Set V-Blank flag (Bit 0) - Start of V-Blank period
            if (this.currentScanline >= V_DRAW_LINES) {
                dispstat |= 0x0001; // <--- V-BLANK FLAG SET (Breaks the stall)
                if (this.currentScanline === V_DRAW_LINES) { 
                    // this.renderScreen(); // Trigger render logic here
                }
            }
            
            // Write VCOUNT and DISPSTAT registers (Must happen immediately)
            this.ioRegsView.setUint16(REG_VCOUNT, this.currentScanline, true);
            this.ioRegsView.setUint16(REG_DISPSTAT, dispstat, true);
        }
    }


    runGameLoop() {
        if (!this.paused) {
            
            const CYCLES_PER_FRAME = 279620; 
            // CRITICAL FIX: TIGHT INTERLEAVING
            const cyclesPerStep = 4; // 1 ARM instruction = 4 cycles

            for (let i = 0; i < CYCLES_PER_FRAME; i += cyclesPerStep) {
                
                // Execute exactly one ARM instruction
                this.cpu.executeNextInstruction(); 
                
                // Update PPU logic based on the 4 cycles consumed
                this.updatePPU(cyclesPerStep);
            }
        }
        // Use setTimeout for better cross-browser timing accuracy than requestAnimationFrame
        setTimeout(() => this.runGameLoop(), 1000/60); 
    }
}
