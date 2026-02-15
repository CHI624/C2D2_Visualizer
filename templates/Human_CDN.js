const canvas = document.getElementById('fireMap');
const ctx = canvas.getContext('2d');
const mapImg = new Image();
mapImg.src = MAP_IMAGE_URL;
let discreteTime = 0; // Starts at 0, counts UP to MAX_TIME
const MAX_TIME = 120000; // 120,000ms (2 minutes)
const TIME_PER_ACTION = 5000; // Each decision adds 5 seconds
const COVERAGE_THRESHOLD = 0.60; // 60%

let camera = { x: 0, y: 0, zoom: 1 };
let isDragging = false;
let lastMouse = { x: 0, y: 0 };

// Move nodes to global scope so both drawing and clicking can see them
let fires = [];
let nodes = [];
let evacuations = []; // Persistent safe zones
let activeAnimations = []; // Temporary scan/pulse animations
// NEW: Priority Asset Data
let priorityZone = {
    x: 0, 
    y: 0, 
    radius: 25, 
    revealed: false, // Initially hidden
    isCompromised: false
};
let priorityZones = []; // Array to store multiple assets
const MAX_PRIORITY_ZONES = 3;
// Add these at the very top with your other variables
let activeNode = null; 
// NEW: Environmental Variables
let currentWind = {
    angle: Math.random() * Math.PI * 2, // Random direction in radians
    magnitude: 0.30, // 30% influence
    revealed: false
};
let gameActive = false; // Start as false
// Function to move from the Legend to the Mission Briefing
function showMissionBriefing() {
    // Hide the Legend
    document.getElementById('artifact-legend').style.display = 'none';
    // Show the Briefing
    document.getElementById('mission-briefing').style.display = 'flex';
}
function startMission() {
    document.getElementById('mission-briefing').style.display = 'none';
    gameActive = true;
    // Set a random wind speed for the report
    currentWind.speed = Math.floor(Math.random() * 30) + 20; // 20-50 mph
// 1. Reset Arrays to ensure no duplicates
    fires = []; 

    // 2. Generate Fire 1: VISIBLE
    startRandomFire(true); 
    // Ensure the first one is revealed
    if (fires[0]) {
        fires[0].revealed = true;
        fires[0].isVisible = true;
    }

    // 3. Generate Fire 2: INVISIBLE
    startRandomFire(true);
    if (fires[1]) {
        fires[1].revealed = false; // Hidden from draw()
        fires[1].isVisible = false; 
    }

    draw();
}
/**
 * Returns true if the pixel color is NOT blue-dominant (likely land).
 * In RGB, water typically has higher Blue (B) than Red (R) or Green (G).
 */
function isLandPixel(r, g, b) {
    // If Blue is significantly higher than Red and Green, it's water.
    const isWater = (b > r) && (b > g); 
    return !isWater; 
}
function toggleLog() {
    const log = document.getElementById('activity-record');
    log.classList.toggle('log-hidden');
}
function calculateSuppressionTime(fire) {
    const ratio = fire.radius / fire.maxRadius;
    
    if (ratio >= 0.60) return 35000; // 35 seconds
    if (ratio >= 0.40) return 20000; // 20 seconds
    if (ratio >= 0.20) return 10000; // 10 seconds
    return 5000; // Base 5s for small fires
}

function toggleActivityModal() {
    const modal = document.getElementById('activity-modal');
    const logDisplay = document.getElementById('full-log-display');
    const mainLog = document.getElementById('activity-record'); // Your existing sidebar log

    if (modal.style.display === "block") {
        modal.style.display = "none";
    } else {
        // Copy the current history from your sidebar log into the modal
        logDisplay.innerHTML = mainLog.innerHTML;
        modal.style.display = "block";
    }
}

// Map Angle to Direction Names for the Log
function getWindDirectionName(angle) {
    const dirs = ["East", "South-East", "South", "South-West", "West", "North-West", "North", "North-East"];
    const index = Math.round(angle / (Math.PI / 4)) % 8;
    return dirs[index];
}
const actionDescriptions = {
    // These IDs should match your Node IDs or CDN variable names
    'Ribbon Bridge Status': { 1: "Deploy Bridge", 0: "Retract Bridge" },
    'Fire Across Gap': { 1: "Suppress Enemy", 0: "Cease Fire" },
    'Enemy ATK/Artillery': { 0: "Neutralize Battery", 1: "Monitor Position" }
};

function generateNodes() {
    // Safety check for image loading
    const w = mapImg.width || 1200;
    const h = mapImg.height || 800;

    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = w;
    tempCanvas.height = h;
    tempCtx.drawImage(mapImg, 0, 0);
    
    nodes = []; 
    const totalNodes = 30;
    const cols = 6;
    const rows = 5;
    const cellW = w / cols;
    const cellH = h / rows;

    for (let i = 0; i < totalNodes; i++) {
        const gridRow = Math.floor(i / cols);
        const gridCol = i % cols;

        let valid = false;
        let rx, ry;
        let attempts = 0;
        
        // Find land strictly within this grid cell
        while (!valid && attempts < 150) {
            rx = (gridCol * cellW) + (Math.random() * cellW);
            ry = (gridRow * cellH) + (Math.random() * cellH);

            // Bounds check for safety
            if (rx > 0 && rx < w && ry > 0 && ry < h) {
                const pixel = tempCtx.getImageData(rx, ry, 1, 1).data;
                if (isLandPixel(pixel[0], pixel[1], pixel[2])) {
                    valid = true;
                }
            }
            attempts++;
        }

        // Emergency Fallback: If cell is 100% water (rare), use cell center
        if (!valid) {
            rx = (gridCol * cellW) + (cellW / 2);
            ry = (gridRow * cellH) + (cellH / 2);
        }

        // STRICT TYPE LOGIC: Alternate to ensure 15 of each type
        const nodeType = (i % 2 === 0) ? 'investigation' : 'action';
        const name = (nodeType === 'investigation' ? 'INT-' : 'ACT-') + i;

        nodes.push({
            id: name,
            x: rx,
            y: ry,
            type: nodeType,
            isAsset: false,
            isCompromised: false
        });
    }

    // Attach Assets to 3 random Action nodes (Green Squares)
    const actionNodes = nodes.filter(n => n.type === 'action');
    const shuffled = actionNodes.sort(() => 0.5 - Math.random());
    shuffled.slice(0, 3).forEach(node => { node.isAsset = true; });
    
    console.log("Map populated with 15 Squares and 15 Triangles.");
}

function clampCamera() {
    const minZoom = Math.max(canvas.width / mapImg.width, canvas.height / mapImg.height);
    if (camera.zoom < minZoom) camera.zoom = minZoom;

    const mapWidthOnScreen = mapImg.width * camera.zoom;
    const mapHeightOnScreen = mapImg.height * camera.zoom;

    const minX = canvas.width - mapWidthOnScreen;
    const minY = canvas.height - mapHeightOnScreen;

    camera.x = Math.min(0, Math.max(camera.x, minX));
    camera.y = Math.min(0, Math.max(camera.y, minY));
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    clampCamera(); // Ensure zoom is still valid after resize
}

// SINGLE Wheel Listener: Handles zoom + zoom-to-mouse + clamping
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const mouseX = e.clientX;
    const mouseY = e.clientY;

    // Map coordinate under mouse before zoom
    const beforeX = (mouseX - camera.x) / camera.zoom;
    const beforeY = (mouseY - camera.y) / camera.zoom;

    // Change zoom level
    if (e.deltaY < 0) camera.zoom *= 1.1;
    else camera.zoom /= 1.1;

    clampCamera();

    // Adjust x/y to keep mouse over the same map spot
    camera.x = mouseX - beforeX * camera.zoom;
    camera.y = mouseY - beforeY * camera.zoom;

    clampCamera();
}, { passive: false });

// SINGLE Panning Listeners
canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    lastMouse = { x: e.clientX, y: e.clientY };
});

window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    camera.x += e.clientX - lastMouse.x;
    camera.y += e.clientY - lastMouse.y;
    lastMouse = { x: e.clientX, y: e.clientY };
    clampCamera();
});

// Inside the Panning (MouseUp) Listener
window.addEventListener('mouseup', () => {
    if (isDragging) recordActivity("Map Panned to new coordinates");
    isDragging = false;
});

canvas.addEventListener('click', (e) => {
    const mapX = (e.clientX - camera.x) / camera.zoom;
    const mapY = (e.clientY - camera.y) / camera.zoom;
    let nodeClicked = false;
    nodes.forEach(node => {
        const dist = Math.sqrt((mapX - node.x)**2 + (mapY - node.y)**2);
        if (dist < 30 / camera.zoom) {
            nodeClicked = true;

            // NEW: Robustness check
            if (node.isCompromised) {
                recordActivity(`ACCESS DENIED: ${node.id.replace(/_/g, ' ')} is consumed by fire.`);
                return; // Exit without opening modal
            }

            recordActivity(`NODE SELECTED: ${node.id.replace(/_/g, ' ')}`);
            openActionModal(node);
        }
    });
});
function generatePriorityZone() {
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = mapImg.width;
    tempCanvas.height = mapImg.height;
    tempCtx.drawImage(mapImg, 0, 0);

    priorityZones = []; 

    for (let i = 0; i < MAX_PRIORITY_ZONES; i++) {
        let valid = false;
        let pX, pY;
        let attempts = 0;

while (!valid && attempts < 1000) {
            let rx = Math.random() * mapImg.width;
            let ry = Math.random() * mapImg.height; // [cite: 56, 57]
            
            // --- START REPLACEMENT ---
            const pixel = tempCtx.getImageData(rx, ry, 1, 1).data;
            const [r, g, b] = pixel;
            
            const isUrban = (r > 180 && g > 180 && b > 180);
            
            // REPLACE "const isLand = (b < r + 20);" WITH THIS:
            const isLand = isLandPixel(r, g, b); 

            if ((isUrban || (attempts > 500 && isLand))) {
            // --- END REPLACEMENT ---
                
                const tooClose = priorityZones.some(z => Math.sqrt((z.x - rx)**2 + (z.y - ry)**2) < 200);
                if (!tooClose) {
                    pX = rx;
                    pY = ry;
                    valid = true;
                }
            }
            attempts++;
        }

        if (valid) {
            priorityZones.push({
                x: pX,
                y: pY,
                radius: 25,
                revealed: false, // TRUE so they are visible on the map
                isCompromised: false
            });
        }
    }
}
function drawNodes() {
    nodes.forEach(node => {
        // Collision Check
        node.isCompromised = fires.some(f => {
            const dist = Math.sqrt((f.x - node.x)**2 + (f.y - node.y)**2);
            return dist < f.radius; 
        });

        const size = 20 / camera.zoom;
        ctx.save();
        
        // 1. Draw The Node (Square or Triangle)
        if (node.isCompromised) {
            ctx.fillStyle = "#333333"; 
            ctx.globalAlpha = 0.7;
        } else {
            if (node.type === 'investigation') {
                ctx.fillStyle = node.selected ? "#ebd915" : "#ebd915"; 
            } else {
                ctx.fillStyle = node.selected ? "#ebd915" : "#2ecc71"; 
            }
            ctx.globalAlpha = 1.0;
        }

        ctx.beginPath();
        if (node.type === 'investigation') {
            ctx.moveTo(node.x, node.y - size);
            ctx.lineTo(node.x + size, node.y + size);
            ctx.lineTo(node.x - size, node.y + size);
            ctx.closePath();
        } else {
            if (ctx.roundRect) ctx.roundRect(node.x - size, node.y - size, size * 2, size * 2, 5 / camera.zoom);
            else ctx.rect(node.x - size, node.y - size, size * 2, size * 2);
        }
        ctx.fill();
        
        ctx.strokeStyle = node.isCompromised ? "red" : "white";
        ctx.lineWidth = 2 / camera.zoom;
        ctx.stroke();

        // 2. NEW: Draw Asset Overlay (If Attached)
        //  Logic adapted for nodes
        if (node.isAsset && !node.isCompromised) {
            const time = Date.now() / 500;
            const assetSize = 35 / camera.zoom; // Larger than the node

            ctx.translate(node.x, node.y);
            ctx.rotate(time);
            
            ctx.lineWidth = 3 / camera.zoom;
            ctx.strokeStyle = "#FFD700"; // Gold color
            
            // Draw Reticle Segments
            ctx.beginPath(); ctx.arc(0, 0, assetSize, 0.2, 1.4); ctx.stroke();
            ctx.beginPath(); ctx.arc(0, 0, assetSize, 1.8, 3.0); ctx.stroke();
            ctx.beginPath(); ctx.arc(0, 0, assetSize, 3.4, 4.6); ctx.stroke();
            ctx.beginPath(); ctx.arc(0, 0, assetSize, 5.0, 6.2); ctx.stroke();

            // Asset Label
            ctx.rotate(-time); // Reset rotation for text
            ctx.fillStyle = "#FFD700";
            ctx.font = `bold ${12 / camera.zoom}px Courier New`;
            ctx.textAlign = "center";
            ctx.fillText("⚠ ASSET", 0, -assetSize - (5 / camera.zoom));
            
            // Reset translation for the standard label
            ctx.translate(-node.x, -node.y); 
        }

        // 3. Draw Standard Label
        ctx.fillStyle = "white";
        ctx.font = `bold ${10 / camera.zoom}px Arial`;
        ctx.textAlign = "center";
        const label = node.isCompromised ? "OFFLINE" : (node.type === 'investigation' ? "INT" : "ACT");
        const yOffset = node.type === 'investigation' ? (8 / camera.zoom) : (5 / camera.zoom);
        ctx.fillText(label, node.x, node.y + yOffset);
        
        ctx.restore();
    });
}

function draw() {
    if (!gameActive) return;
    
    // 1. UPDATE STATE
    let elapsed = discreteTime;
    let visibleFires = fires.filter(f => f.radius > 0);
    let activeThreats = visibleFires.filter(f => !f.isMitigated).length;
    let totalArea = visibleFires.reduce((sum, f) => sum + (Math.PI * f.radius * f.radius), 0);
    let mapArea = mapImg.width * mapImg.height;
    let currentCoverage = totalArea / mapArea;
    // --- NEW: GAME OVER LOGIC ---
    
    // Check Case 1: Time Limit Reached [cite: 298]
    if (elapsed >= MAX_TIME) {
        endGame("OPERATIONAL TIMEOUT: Time Limit Reached.", false);
        return;
    }

    // Check Case 2: Fire Coverage Exceeded 
    if (currentCoverage >= COVERAGE_THRESHOLD) {
        endGame("CRITICAL FAILURE: Fire spread has exceeded containment thresholds (60%+).", false);
        return;
    }

// Check Case 3: Priority Asset Node Compromised
    const assetCompromised = nodes.some(node => {
        if (!node.isAsset) return false;
        // Check if fire hit this asset node
        return fires.some(f => {
            const dist = Math.sqrt((f.x - node.x)**2 + (f.y - node.y)**2);
            return dist < f.radius; 
        });
    });

    if (assetCompromised) {
        endGame("MISSION FAILURE: A high-value priority asset node has been compromised.", false);
        return;
    }

    // Check Case 4: Mission Success (All fires neutralized after initial start)
    // Only check this if some time has passed to allow initial fires to spawn [cite: 310-313]
    if (elapsed > 20000 && visibleFires.length > 0 && activeThreats === 0) {
        endGame("MISSION SUCCESS: All thermal threats have been successfully mitigated.", true);
        return;
    }
    // --- 2. RENDER MAP & OBJECTS ---
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    
    // GLOBAL CAMERA TRANSFORM (Applied once for everything)
    ctx.translate(camera.x, camera.y);
    ctx.scale(camera.zoom, camera.zoom); 
    ctx.drawImage(mapImg, 0, 0);

    // Draw Evacuations
    evacuations.forEach(evac => {
        const isThreatened = fires.some(f => !f.isMitigated && f.radius > 0 && 
            Math.sqrt((f.x - evac.x)**2 + (f.y - evac.y)**2) < (f.radius + evac.radius + 50));
        
        ctx.save();
        ctx.beginPath();
        ctx.arc(evac.x, evac.y, evac.radius, 0, Math.PI * 2);
        ctx.strokeStyle = isThreatened ? "rgba(255, 50, 50, 0.8)" : "rgba(0, 150, 255, 0.5)";
        ctx.fillStyle = isThreatened ? "rgba(255, 0, 0, 0.2)" : "rgba(0, 100, 255, 0.1)";
        ctx.setLineDash([10, 10]);
        ctx.stroke();
        ctx.fill();
        ctx.restore();
    });

    // Draw Fires
    fires.forEach(fire => {
        if (fire.radius > 0) {
            fire.update(); 
            fire.draw(ctx); 
        }
    });

    drawNodes();

    // Draw Animations
    activeAnimations.forEach((anim, index) => {
        anim.radius += 10;
        const alpha = 1 - (anim.radius / anim.maxRadius);
        ctx.beginPath();
        ctx.arc(anim.x, anim.y, anim.radius, 0, Math.PI * 2);
        ctx.strokeStyle = anim.type === 'scan' ? `rgba(0, 255, 0, ${alpha})` : `rgba(0, 150, 255, ${alpha})`;
        ctx.lineWidth = 5 / camera.zoom;
        ctx.stroke();
        if (anim.radius >= anim.maxRadius) activeAnimations.splice(index, 1);
    });

    ctx.restore(); // End Map Space

    // --- 3. UI OVERLAYS (No Camera Transform) ---
    if (currentWind.revealed) {
        const uiX = canvas.width - 700;
        const uiY = 100;
        ctx.save();
        ctx.translate(uiX, uiY);
        ctx.beginPath();
        ctx.arc(0, 0, 40, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fill();
        ctx.rotate(currentWind.angle);
        ctx.beginPath();
        ctx.moveTo(25, 0); ctx.lineTo(-15, -15); ctx.lineTo(-15, 15); ctx.closePath();
        ctx.fillStyle = "#00ccff";
        ctx.fill();
        ctx.restore();
        
        ctx.fillStyle = "#00ccff";
        ctx.font = "12px Arial";
        ctx.textAlign = "center";
        ctx.fillText("WIND DIRECTION", uiX, uiY + 55);
    }

    updateUI(elapsed, activeThreats);
    requestAnimationFrame(draw);
}

function endGame(reason, isSuccess) {
    gameActive = false; // Stop the map simulation
    
    // Create the overlay container
    const overlay = document.createElement('div');
    overlay.id = "game-over-overlay";
    
    // Success (Green) vs Failure (Red) styling
    const bgColor = isSuccess ? "rgba(46, 204, 113, 0.9)" : "rgba(192, 57, 43, 0.9)";
    const titleText = isSuccess ? "MISSION SUCCESS" : "SIMULATION OVER";
    
    overlay.style = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: ${bgColor}; backdrop-filter: blur(10px);
        display: flex; flex-direction: column; justify-content: center;
        align-items: center; z-index: 10000; color: white; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        text-align: center; transition: opacity 0.5s;
    `;
    
    overlay.innerHTML = `
        <h1 style="font-size: 72px; margin-bottom: 10px; text-shadow: 2px 2px 10px rgba(0,0,0,0.3);">${titleText}</h1>
        <p style="font-size: 24px; margin-bottom: 40px; max-width: 600px;">${reason}</p>
        
        <div style="display: flex; gap: 20px;">
            <button onclick="location.reload()" style="padding: 15px 40px; font-size: 20px; cursor: pointer; background: white; color: black; border: none; border-radius: 8px; font-weight: bold;">RESTART SIMULATION</button>
            <button onclick="window.location.href='{{ url_for('C2D2') }}'" style="padding: 15px 40px; font-size: 20px; cursor: pointer; background: rgba(0,0,0,0.3); color: white; border: 2px solid white; border-radius: 8px; font-weight: bold;">BACK TO MENU</button>
        </div>
    `;
    
    document.body.appendChild(overlay);
    recordActivity(`SIMULATION TERMINATED: ${reason}`);
}

function updateUI(elapsed, activeThreats) {
    let timeUsed = Math.floor(elapsed / 1000);
    let maxSecs = Math.floor(MAX_TIME / 1000);
    document.getElementById('timer').innerText = `T-USED: ${timeUsed}s / ${maxSecs}s`;

    let totalArea = fires.reduce((sum, f) => sum + (Math.PI * f.radius * f.radius), 0);
    let mapArea = mapImg.width * mapImg.height;
    let percent = Math.min(100, (totalArea / mapArea) * 100).toFixed(2);
    
    let coverageDisplay = document.getElementById('coverage');
    
    // NEW: Wind Status Element Logic
    // Make sure you have a div with id="wind-status" in your HTML, or we can inject it
    // Dynamic Feedback based on Active Threats
    if (activeThreats > 0) {
        coverageDisplay.innerText = `${percent}% (ALERT: ${activeThreats} ACTIVE)`;
        coverageDisplay.style.color = "#ff4500"; // Red/Orange warning
    } else if (percent > 0) {
        coverageDisplay.innerText = `${percent}% (COOLING...)`;
        coverageDisplay.style.color = "#3498db"; // Blue for cooling
    } else {
        coverageDisplay.innerText = "0% (CLEAR)";
        coverageDisplay.style.color = "#2ecc71"; // Green for clear
    }    
const windHud = document.getElementById('wind-hud-bottom');
    const windText = document.getElementById('wind-text');
    
    if (currentWind.revealed) {
        windHud.style.display = 'flex';
        const dir = getWindDirectionName(currentWind.angle);
        // Displaying the specific speed and direction requested
        windText.innerText = `Wind ${currentWind.speed}mph ${dir}`;
        
        // Change icon based on speed
        const icon = document.getElementById('wind-icon');
        icon.innerText = currentWind.speed > 40 ? "🌪️" : "💨";
    }


    coverageDisplay.innerText = `${percent}% ${activeThreats > 0 ? '(ACTIVE)' : '(STABLE)'}`;
}
// Initializing the app
window.addEventListener('resize', resizeCanvas);
mapImg.onload = () => {
    resizeCanvas();
    generateNodes();
    // 1. Start the first fire immediately
    startRandomFire(true); // Force a 'Seed' ignition

    generateNodes();
    generatePriorityZone();
    
    // Create Header
    const header = document.createElement('div');
    header.style = `
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.7); color: #2ecc71; padding: 5px 15px;
        border: 2px solid #2ecc71; border-radius: 5px; font-family: 'Courier New', monospace;
        font-size: 18px; font-weight: bold; letter-spacing: 2px; z-index: 1000;
        pointer-events: none; text-transform: uppercase; box-shadow: 0 0 15px rgba(46, 204, 113, 0.5);
    `;
    header.innerText = "HUMAN+CDN - FIRE SCAN SIMULATOR";
    document.body.appendChild(header);

    camera.zoom = Math.max(canvas.width / mapImg.width, canvas.height / mapImg.height);
    draw();
};
// 1. Global variable that controls simulation speed/spread
let currentSpreadMultiplier = 0.1; 

let activityLog = []; // Global list to track actions

async function handleAction(nodeId, actionValue, distance) {
    if (!gameActive) return;
// 1. Locate the specific node that was clicked
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

// --- CDN LOGIC: Mapping numeric values to descriptions  ---
    if (actionDescriptions[nodeId]) {
        const statusUpdate = actionDescriptions[nodeId][actionValue];
        if (statusUpdate) {
            // This ensures the decision (e.g., "Deploy Bridge") shows up in the log
            recordActivity(`CDN UPDATE: ${nodeId} — STATUS: ${statusUpdate}`);
        }
    }
// 2. Communicate with Flask Backend
    try {
        const response = await fetch('/process_action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                node_id: nodeId,
                value: actionValue
            })
        });

        const data = await response.json();

        if (data.status === "success") {
            // --- NEW: POPULATE THE LOG WITH BACKEND CALCULATION ---
            if (data.cdn_msg) {
                recordActivity(data.cdn_msg); // This shows the "15% reduction" etc.
            }
            
            // Use the backend multiplier to affect game fires
            // Example: shrink fires if the CDN result was good
            if (data.prob_high < 0.3) {
                fires.forEach(f => { if(!f.isMitigated) f.radius *= 0.8; });
            }
        }
    } catch (error) {
        console.error("CDN Communication Error:", error);
    }

    // Advance simulation time [cite: 168]

    // 1. Advance turn time
    discreteTime += TIME_PER_ACTION;

    // 2. TURN-BASED RE-IGNITION
    // Only generate new fires IF the current ones aren't all maxed out
    const allMaxed = fires.length > 0 && fires.every(f => f.radius >= 199);

    if (!allMaxed) {
        // Trigger a chance for a new fire only AFTER a choice is made
        if (Math.random() < 0.50) { 
            startRandomFire(false);
            recordActivity("NEW IGNITION: Turn-based spread detected.");
        }
        
        // Also trigger local spread/spot fires
        triggerDiscreteSpread(); 
    }
    const actionNames = { 0: "Evacuation", 1: "Direct Suppression", 2: "Investigation Scan", 3: "Control Line" };
    const targetX = activeNode ? activeNode.x : 0;
    const targetY = activeNode ? activeNode.y : 0;
    const label = actionNames[actionValue] || "Unknown Action";

    recordActivity(`DECISION FIRED: [${label}] on ${nodeId}`);

    // --- ACTION LOGIC ---
    if (actionValue === 2) { // INVESTIGATION SCAN
        currentWind.revealed = true;
        const scanRadius = 450; 
        activeAnimations.push({ x: targetX, y: targetY, radius: 0, maxRadius: scanRadius, type: 'scan' });
        
        let firesFound = 0;
        // NEW: Asset reveal logic
    let assetsFound = 0;
    priorityZones.forEach(zone => {
        const distToZone = Math.sqrt((zone.x - targetX)**2 + (zone.y - targetY)**2);
        
        // If the asset is within the scan radius and not yet revealed
        if (distToZone < scanRadius && !zone.revealed) {
            zone.revealed = true;
            assetsFound++;
        }
    });
// Priority Asset Report Logic:
//    if (assetsFound > 0) {
//        recordActivity(`INTEL ACQUIRED: ${assetsFound} Priority Assets identified.`);
//    }

        // LOOP: Find hidden fires nearby and reveal them
        fires.forEach(f => {
            const distToFire = Math.sqrt((f.x - targetX)**2 + (f.y - targetY)**2);
            if (distToFire < scanRadius) {
                if (!f.revealed) firesFound++;
                f.revealed = true; // POP! Fire appears
            }
        });

        if (firesFound > 0) {
            recordActivity(`SCAN REPORT: ${firesFound} hidden thermal signatures revealed.`);
        } else {
            recordActivity(`SCAN REPORT: No active fires detected in this sector.`);
        }
        recordActivity(`METEOROLOGY: Wind data updated.`);
        if (actionDescriptions[nodeId]) {
        const statusText = actionDescriptions[nodeId][actionValue];
        if (statusText) {
            recordActivity(`CDN UPDATE: ${nodeId} — STATUS: ${statusText}`);
        }
    }
    } 
    else if (actionValue === 0) { // EVACUATION
        evacuations.push({ x: targetX, y: targetY, radius: 150 });
        activeAnimations.push({ x: targetX, y: targetY, radius: 0, maxRadius: 150, type: 'evac' });
    }
    else if (actionValue === 1 || actionValue === 3) { // SUPPRESSION
        let maxSuppressionCost = 0;
        let firesAffected = 0;

        fires.forEach(f => {
            const d = Math.sqrt((f.x - targetX)**2 + (f.y - targetY)**2);
            if (d < 280 && !f.isMitigated) {
                // Auto-reveal if we suppress it (otherwise it disappears while putting it out)
                f.revealed = true; 
                
                const cost = calculateSuppressionTime(f);
                if (cost > maxSuppressionCost) maxSuppressionCost = cost;
                f.isMitigated = true; 
                firesAffected++;
            }
        });

        if (firesAffected > 0) {
            discreteTime += maxSuppressionCost;
            recordActivity(`SUPPRESSION: ${firesAffected} points neutralized. TIME COST: +${maxSuppressionCost/1000}s`);
        } else {
            recordActivity("SUPPRESSION FAILED: No active ignitions in range.");
        }
    }
    closeModal();

    // Server Uplink
    fetch('/process_action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: nodeId, value: actionValue, distance: distance }),
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === "success") {
            currentSpreadMultiplier = Math.min(0.08, Math.max(0.02, data.spread_increment || 0.05));
        }
    })
    .catch(err => console.warn("Uplink failed."));
}

function drawSafeZone(centerX, centerY) {
    let radius = 0;
    const maxRadius = 30;
    let opacity = 0.6;

    function animateZone() {
        if (radius < maxRadius) {
            ctx.save();
            // Translate for camera support if necessary, but handled by main loop draw calls usually
            // If calling outside main draw(), you may need camera offset
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(0, 150, 255, ${opacity})`;
            ctx.lineWidth = 8 / camera.zoom;
            ctx.setLineDash([10, 15]); // Dashed line for "Perimeter" look
            ctx.stroke();
            
            ctx.fillStyle = `rgba(0, 100, 255, ${opacity * 0.1})`;
            ctx.fill();
            
            ctx.restore();
            radius += 3;
            opacity -= 0.012;
            requestAnimationFrame(animateZone);
        }
    }
    animateZone();
}

function showHotspots(centerX, centerY) {
    // This creates a temporary green ring to show the "Investigation Scan"
    let scanRadius = 0;
    const maxScan = 500;
    
    function animateScan() {
        if (scanRadius < maxScan) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(centerX, centerY, scanRadius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(0, 255, 0, ${1 - (scanRadius/maxScan)})`;
            ctx.lineWidth = 5;
            ctx.stroke();
            ctx.restore();
            scanRadius += 10;
            requestAnimationFrame(animateScan);
        }
    }
    animateScan();
    recordActivity("Area scan complete: No hidden ignitions detected.");
}
function recordActivity(message) {
    const logContent = document.getElementById('log-content');
    const entry = document.createElement('div');
    entry.style.marginBottom = "5px";
    entry.innerText = `[${new Date().toLocaleTimeString()}] ${message}`;
    logContent.prepend(entry); // Newest on top
}
function updateSimulation() {
    // Basic fire growth logic
    fireParticles.forEach(p => {
        // We multiply the base growth rate by the multiplier from Python
        p.radius += (0.5 * currentSpreadMultiplier); 
    });

    requestAnimationFrame(updateSimulation);
}
class FireSource {
    constructor(x, y, isVisible = true) {
        this.x = x;
        this.y = y;
        this.radius = 40;
        this.maxRadius = 100;
        this.isMitigated = false;
        this.isVisible = isVisible;
        this.revealed = isVisible; // Start revealed
    }

update() {
        if (this.isMitigated) {
            this.radius -= 0.6;
            if (this.radius < 0) this.radius = 0;
        } else if (this.radius >= this.maxRadius) {
            // Fires grow slowly until they hit the 200px limit
            this.radius += 0.5; 
        }
        // Once radius reaches 200, it stays "stagnant"
    }

    draw(context) {
        // HIDDEN LOGIC: If not revealed, do not draw
        if (!this.revealed) return;
        
        let flicker = (Math.random() - 0.5) * 2;
        let displayRadius = Math.max(0.1, this.radius + flicker);

        try {
            let gradient = context.createRadialGradient(this.x, this.y, 0, this.x, this.y, displayRadius);
            if (this.isMitigated) {
                gradient.addColorStop(0, 'rgba(100, 200, 255, 0.7)'); 
                gradient.addColorStop(1, 'rgba(0, 50, 200, 0)');
            } else {
                gradient.addColorStop(0, 'rgba(255, 250, 200, 0.9)');
                gradient.addColorStop(0.4, 'rgba(255, 100, 0, 0.6)');
                gradient.addColorStop(1, 'rgba(255, 0, 0, 0)');
            }
            context.beginPath();
            context.arc(this.x, this.y, displayRadius, 0, Math.PI * 2);
            context.fillStyle = gradient;
            context.fill();
        } catch(e) {}
    }
}

function startRandomFire(isInitial = false) {
    // 1. Logic for Initial Seed Fires
    if (isInitial || fires.length === 0) {
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = mapImg.width;
        tempCanvas.height = mapImg.height;
        tempCtx.drawImage(mapImg, 0, 0);

        let rx, ry, valid = false;
        let attempts = 0;
        while (!valid) {
            rx = Math.random() * mapImg.width;
            ry = Math.random() * mapImg.height;
const pixel = tempCtx.getImageData(rx, ry, 1, 1).data;
        // VALIDATE LAND: Reject blue pixels
        if (isLandPixel(pixel[0], pixel[1], pixel[2])) {
            valid = true;
        }
        attempts++;
        }
        if (!valid) { rx=500; ry=500; } // Fallback
        // IF it's the very first fire, make it visible. Otherwise, hidden.
        const isFirst = fires.length === 0;
        fires.push(new FireSource(rx, ry, isFirst)); 
        return;
    }

    // 2. TURN-BASED LOGIC (70% Sequential / 30% Random)
    const roll = Math.random();

    if (roll < 0.70) {
        // --- SEQUENTIAL SPREAD ---
        const parent = fires[Math.floor(Math.random() * fires.length)];
        const angle = Math.random() * Math.PI * 2;
        const distance = 150 + Math.random() * 150; 
        
        const newX = parent.x + Math.cos(angle) * distance;
        const newY = parent.y + Math.sin(angle) * distance;

        const clampedX = Math.max(0, Math.min(mapImg.width, newX));
        const clampedY = Math.max(0, Math.min(mapImg.height, newY));
        
        // CHANGE: Pass 'false' to make it invisible [cite: 192]
        fires.push(new FireSource(clampedX, clampedY, false));
        
        recordActivity("SITUATION UPDATE: Secondary ignition detected near existing front.");
    } else {
        // --- RANDOM SPOT FIRE ---
        let rx = Math.random() * mapImg.width;
        let ry = Math.random() * mapImg.height;
        
        // CHANGE: Pass 'false' to make it invisible [cite: 194]
        fires.push(new FireSource(rx, ry, false));
        
        recordActivity("WARNING: New isolated fire cluster detected at distant coordinates.");
    }
}
function triggerDiscreteSpread() {
    let newSpotFires = [];
    fires.forEach(fire => {
        if (fire.isMitigated || fire.radius >= fire.maxRadius) return;

        if (Math.random() < 0.60) {
            const nodeCount = Math.floor(Math.random() * 3) + 1;
            for (let i = 0; i < nodeCount; i++) {
                const variance = (Math.random() - 0.5) * (Math.PI / 3);
                const travelAngle = currentWind.angle + variance;
                const jumpDistance = 120 + (Math.random() * 80); 
                
                const newX = fire.x + Math.cos(travelAngle) * jumpDistance;
                const newY = fire.y + Math.sin(travelAngle) * jumpDistance;

                if (newX > 0 && newX < mapImg.width && newY > 0 && newY < mapImg.height) {
                    // CHANGE: Pass 'false' for invisible [cite: 198]
                    newSpotFires.push(new FireSource(newX, newY, false));
                }
            }
        }
    });

    fires = [...fires, ...newSpotFires];
    if (newSpotFires.length > 0) {
        recordActivity(`WIND SPREAD: ${newSpotFires.length} new hidden signatures detected.`);
    }
}
function openActionModal(node) {
    activeNode = node;
    const container = document.getElementById('action-options-container');
    const title = document.getElementById('modal-title');
    
    title.innerText = node.id.replace(/_/g, ' ');
    container.innerHTML = ''; 
// Inside openActionModal(node)
// Find distance to nearest fire
let minDist = Infinity;
fires.forEach(f => {
    const d = Math.sqrt((f.x - node.x)**2 + (f.y - node.y)**2);
    if (d < minDist) minDist = d;
});

let choices = {};
// 1. If it's a specific CDN variable, use its unique descriptions
    if (actionDescriptions[node.id]) {
        choices = actionDescriptions[node.id];
    } 
    // 2. If it's a generic node, restrict choices by visual TYPE
    else if (node.type === 'action') {
        // SQUARE nodes only get Action choices
        choices = { 1: "Suppression", 0: "Evacuation" };
    } else {
        // TRIANGLE nodes only get Investigation choices
        choices = { 2: "Investigate Scan", 3: "Control Line" };
    }

    Object.entries(choices).forEach(([value, label]) => {
        const btn = document.createElement('button');
        btn.innerText = label;
        btn.className = "modal-btn"; // Use a CSS class for styling
        btn.onclick = () => {
            // Send value and distance to Flask
            handleAction(node.id, parseInt(value), minDist);
            closeModal();
        };
        container.appendChild(btn);
    });

    document.getElementById('action-modal').style.display = 'block';
}

function closeModal() {
    document.getElementById('action-modal').style.display = 'none';
}
// Helper function to get coordinates from either Mouse or Touch
function getCoords(e) {
    if (e.touches && e.touches.length > 0) {
        return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
}

// TOUCH START
canvas.addEventListener('touchstart', (e) => {
    isDragging = true;
    const coords = getCoords(e);
    lastMouse = { x: coords.x, y: coords.y };
}, { passive: false });

// TOUCH MOVE
window.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    
    // Prevent the actual phone screen from scrolling
    if (e.cancelable) e.preventDefault();

    const coords = getCoords(e);
    camera.x += coords.x - lastMouse.x;
    camera.y += coords.y - lastMouse.y;
    lastMouse = { x: coords.x, y: coords.y };
    
    clampCamera();
}, { passive: false });
// TOUCH END
window.addEventListener('touchend', () => {
    isDragging = false;
});