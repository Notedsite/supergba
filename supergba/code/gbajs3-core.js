// gbajs3-core.js

class GBAJS3_Core {
    /**
     * @param {HTMLElement} containerElement - The DOM element to host the emulator.
     */
    constructor(containerElement) {
        this.container = containerElement; 
        this.paused = true;
        this.romLoaded = false;
        this.frameCounter = 0; // Used for animation
        this.scrollOffset = 0; // Used for mock input effect
        
        // GBA Key Mappings: Map keyboard codes to GBA buttons
        this.KEY_MAP = {
            'z': 'A',      // GBA A Button
            'x': 'B',      // GBA B Button
            'a': 'L',      // GBA L Shoulder
            's': 'R',      // GBA R Shoulder
            'Enter': 'Start',
            'Shift': 'Select',
            'ArrowUp': 'Up',
            'ArrowDown': 'Down',
            'ArrowLeft': 'Left',
            'ArrowRight': 'Right'
        };
        this.inputState = {}; // Holds currently pressed GBA buttons
        
        // 1. Create the screen/canvas element
        this.screen = document.createElement('canvas');
        this.screen.width = 240; 
        this.screen.height = 160;
        
        // Apply inline styles for consistency with the CSS zoom
        this.screen.style.width = '240px'; 
        this.screen.style.height = '160px'; 
        
        // 2. Append the canvas to the container
        this.container.appendChild(this.screen);
        
        // 3. Draw a placeholder message on the canvas
        const ctx = this.screen.getContext('2d');
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, 240, 160);
        
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('SuperGBA Core Ready', 120, 70);
        ctx.fillText('Awaiting ROM Data...', 120, 90);
        
        console.log('[GBAJS3_Core] Core display created and initialized.', 'success');
        
        this.setupInputHandlers();
    }

    // --- Input Handling ---
    setupInputHandlers() {
        document.addEventListener('keydown', (e) => this.handleInput(e, true));
        document.addEventListener('keyup', (e) => this.handleInput(e, false));
    }
    
    handleInput(event, isKeyDown) {
        const gbaKey = this.KEY_MAP[event.key];
        if (gbaKey) {
            event.preventDefault(); // Stop scrolling/default browser behavior
            this.inputState[gbaKey] = isKeyDown;
            
            // Mock: Update scrollOffset based on direction keys
            if (isKeyDown) {
                if (gbaKey === 'Left') this.scrollOffset = (this.scrollOffset - 1 + 240) % 240;
                if (gbaKey === 'Right') this.scrollOffset = (this.scrollOffset + 1) % 240;
            }
        }
    }
    
    // --- Game Loop ---
    runGameLoop() {
        if (!this.paused && this.romLoaded) {
            this.frameCounter++;
            this.renderScreen();
        }
        // Use requestAnimationFrame for smooth, browser-friendly animation
        this.animationFrameId = requestAnimationFrame(() => this.runGameLoop());
    }

    renderScreen() {
        if (!this.screen || !this.romData) return;
        
        const ctx = this.screen.getContext('2d');
        const dataView = new DataView(this.romData);
        const bytesToRead = Math.min(240 * 160, this.romData.byteLength); // Max bytes for screen
        
        // Clear screen and set background
        ctx.clearRect(0, 0, 240, 160);
        ctx.fillStyle = '#101010'; 
        ctx.fillRect(0, 0, 240, 160);
        
        // === ACTUAL MOCK GAME RENDERING LOGIC (Driven by Input and Loop) ===
        
        // 1. Draw a scrolling data-driven background
        for (let y = 0; y < 160; y++) {
            for (let x = 0; x < 240; x++) {
                // Calculate index in the ROM data, applying the scroll offset
                // Wrap the index horizontally
                const pixelX = (x + this.scrollOffset) % 240;
                const dataIndex = (y * 240 + pixelX) % bytesToRead; 
                
                // Read three bytes to generate RGB color (Mock PPU/Tile data)
                const r = dataView.getUint8(dataIndex % this.romData.byteLength);
                const g = dataView.getUint8((dataIndex + 1) % this.romData.byteLength);
                const b = dataView.getUint8((dataIndex + 2) % this.romData.byteLength);
                
                ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
                ctx.fillRect(x, y, 1, 1);
            }
        }
        
        // 2. Draw mock 'Player' controlled by Up/Down
        const playerY = 80 + (this.inputState['Up'] ? -10 : 0) + (this.inputState['Down'] ? 10 : 0);
        ctx.fillStyle = this.inputState['A'] ? '#FF0000' : '#00FF00'; // Red if A is pressed, Green otherwise
        ctx.fillRect(100, playerY, 40, 40);

        // 3. Draw input status overlay
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`Frame: ${this.frameCounter}`, 5, 10);
        ctx.fillText(`Scroll: ${this.scrollOffset}`, 5, 20);
        ctx.fillText(`Input: ${Object.keys(this.inputState).filter(k => this.inputState[k]).join(', ') || 'None'}`, 5, 155);
    }
    
    // --- ROM Loading ---
    loadRom(romData) {
        if (!romData || romData.byteLength === 0) {
            console.error('[GBAJS3_Core] Cannot load empty ROM data.', 'error');
            throw new Error("Empty ROM data provided.");
        }

        this.romData = romData;
        this.romLoaded = true;
        this.paused = false;
        this.frameCounter = 0; // Reset state
        this.scrollOffset = 0; // Reset state
        this.inputState = {}; // Clear input state
        
        // Start the continuous game loop only once
        if (!this.animationFrameId) {
            this.runGameLoop();
        }

        console.log(`[GBAJS3_Core] Loaded ROM data (${romData.byteLength} bytes). Game loop started.`, 'success');
    }
    
    pause() {
        this.paused = true;
        console.log('[GBAJS3_Core] Paused.');
    }
}
