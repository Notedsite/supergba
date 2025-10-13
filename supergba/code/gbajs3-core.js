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


// === MemoryBus (Handles BIOS and ROM reads) ===
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


// === GBAJS3_Core ===
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
        this.vram = new Uint8Array(0x18000); 
        this.paletteRAM = new Uint8Array(0x400); 
        this.oam = new Uint8Array(0x400); 
        this.ioRegs = new ArrayBuffer(0x400); 
        this.ioRegsView = new DataView(this.ioRegs);
        this.KEYINPUT_ADDR = 0x130; 
        this.keyInputRegister = 0xFFFF;
        this.KEY_MAP = KEY_MAP; 

        // Initialize Bus and CPU (pass BIOS data)
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
        
        let romPointer = this.cpu.registers[0]; 
        const frameColorShift = (this.frameCounter * 5) % 256; 
        
        const A_BUTTON_BIT = 0x0001;
        const aButtonPressed = !(this.keyInputRegister & A_BUTTON_BIT);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                
                let r = (x + frameColorShift) % 256;
                let g = (y + frameColorShift / 2) % 256;
                let b = (romPointer + x + y) % 256; 

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

        // Draw overlay
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
        this.ctx.fillText(`R0: 0x${this.cpu.registers[0].toString(16).padStart(8, '0')}`, 5, 30);
        this.ctx.fillText(`CPSR: 0x${this.cpu.CPSR.toString(16).padStart(8, '0')}`, 5, 40);
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

        console.log(`[GBAJS3_Core] Loaded ROM data (${romData.byteLength} bytes). CPU is running one instruction per frame.`);
    }

    pause() {
        this.paused = true;
        console.log('[GBAJS3_Core] Paused.');
    }
}
