const canvas = document.getElementById('fireMap');
const ctx = canvas.getContext('2d');
const mapImg = new Image();
mapImg.src = MAP_IMAGE_URL;
let discreteTime = 0; // Starts at 0, counts UP to MAX_TIME
const MAX_TIME = 120000; // 120,000ms (2 minutes)
const TIME_PER_ACTION = 5000; // Each decision adds 5 seconds
const COVERAGE_THRESHOLD = 0.60; // 60%
let currentGrade = 100;
let primaryObjectiveType = ''; // Will hold 'person' or 'area'
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
    currentGrade = 100;
    // Announce the primary objective to the log
    const objName = primaryObjectiveType === 'person' ? "VIP PERSONNEL (⭐)" : "INFRASTRUCTURE (🏠)";
    recordActivity(`MISSION START: Primary protection objective is ${objName}.`);
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
// --- UPDATE THIS FUNCTION ---
function initializeAssets() {
    let assetNodes = nodes.filter(n => n.isAsset);
    let types = Math.random() > 0.5 ? ['person', 'person', 'area'] : ['person', 'area', 'area'];

    for (let i = types.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [types[i], types[j]] = [types[j], types[i]];
    }

    assetNodes.forEach((node, index) => {
        if (types[index]) {
            node.assetType = types[index];
            node.penaltyApplied = false; // NEW: Reset penalty flag
        }
    });

    // NEW: Randomly select the main priority for this run
    primaryObjectiveType = Math.random() > 0.5 ? 'person' : 'area';
}

function calculateSuppressionTime(fire) {
    const ratio = fire.radius / fire.maxRadius;
    
    if (ratio >= 0.60) return 35000; // 35 seconds
    if (ratio >= 0.40) return 20000; // 20 seconds
    if (ratio >= 0.20) return 10000; // 10 seconds
    return 5000; // Base 5s for small fires
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
function toggleActivityModal() {
    const modal = document.getElementById('activity-modal');
    const logDisplay = document.getElementById('full-log-display');
    const mainLog = document.getElementById('activity-record'); // Your existing sidebar log

    if (modal.style.display === "block") {
        modal.style.display = "none";
    } else {
        // Copy the current history from your sidebar log into the modal
        logDisplay.innerHTML = mainLog.innerHTML;
        // --- NEW: STYLING FOR LARGER & BOLDER TEXT ---
        logDisplay.style.fontSize = "22px";   // Increases text size
        logDisplay.style.fontWeight = "bold"; // Makes text bold
        logDisplay.style.lineHeight = "1.6";  // Improves readability
        modal.style.display = "block";
    }
}

// EXIT LOGIC: Close modal if clicking anywhere outside the modal-content box
window.addEventListener('click', function(event) {
    const modal = document.getElementById('activity-modal');
    // If the user clicks the dark overlay (the 'modal' itself) but not the 'content'
    if (event.target == modal) {
        modal.style.display = "none";
    }
});
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
        const wasAlreadyCompromised = node.isCompromised; // Track previous state
        node.isCompromised = fires.some(f => {
            const dist = Math.sqrt((f.x - node.x)**2 + (f.y - node.y)**2);
            return dist < f.radius; 
        });
        // --- NEW: GRADE PENALTY LOGIC ---
        if (node.isAsset && node.isCompromised && !wasAlreadyCompromised && !node.penaltyApplied) {
            currentGrade = Math.max(0, currentGrade - 15); // Deduct 15% for asset loss
            node.penaltyApplied = true; // Ensure it only deducts ONCE
            recordActivity(`CRITICAL LOSS: Asset at ${node.id} compromised! Grade -15%`);
        }
        const size = 20 / camera.zoom;
        ctx.save();
        
// --- 1. Draw The Node Base ---
        if (node.isCompromised) {
            ctx.fillStyle = "#333333"; 
            ctx.globalAlpha = 0.7;
        } else {
            ctx.fillStyle = node.type === 'investigation' 
                ? (node.selected ? "#ecf01d" : "#ebd915") 
                : (node.selected ? "#ecf01d" : "#2ecc71");
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
// 2. UPDATED: Draw Asset Overlay with Logic for Stars/Houses
        if (node.isAsset && !node.isCompromised) {
            const time = Date.now() / 500;
            const assetSize = 35 / camera.zoom;

            ctx.translate(node.x, node.y);
            
            // Draw Pulsing Dotted Reticle
            ctx.save();
            ctx.rotate(time);
            ctx.lineWidth = 3 / camera.zoom;
            ctx.strokeStyle = "#FFD700"; 
            ctx.beginPath(); ctx.arc(0, 0, assetSize, 0.2, 1.4); ctx.stroke();
            ctx.beginPath(); ctx.arc(0, 0, assetSize, 1.8, 3.0); ctx.stroke();
            ctx.beginPath(); ctx.arc(0, 0, assetSize, 3.4, 4.6); ctx.stroke();
            ctx.beginPath(); ctx.arc(0, 0, assetSize, 5.0, 6.2); ctx.stroke();
            ctx.restore();

            // --- NEW: INSIGNIA SELECTION ---
            // Determines if it's a Star (Person) or House (Area)
// 2. NEW: Insignia (Star vs House) and Glow Effect
    const insignia = node.assetType === 'person' ? "⭐" : "🏠";
    
    ctx.save();
    // THE GLOW:
    ctx.shadowBlur = 15 / camera.zoom;
    ctx.shadowColor = "#FFD700"; // Golden neon glow
    ctx.fillStyle = "#FFD700";
    ctx.font = `bold ${22 / camera.zoom}px Courier New`; // Larger font for visibility
    ctx.textAlign = "center";
    
    // Draw the Emoji with glow
    ctx.fillText(insignia, 0, -assetSize - (8 / camera.zoom));
    
    // Draw "PRIORITY" label
    ctx.shadowBlur = 0; // Turn off heavy glow for the small text
    ctx.font = `bold ${12 / camera.zoom}px Courier New`;
    ctx.fillText("PRIORITY", 0, -assetSize - (28 / camera.zoom));
    ctx.restore();

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

evacuations.forEach(evac => {
    // 1. SCORING LOGIC (Remains permanent once hit)
    if (!evac.penaltyApplied) {
        const isOverrun = fires.some(f => !f.isMitigated && f.radius > 0 && 
            Math.sqrt((f.x - evac.x)**2 + (f.y - evac.y)**2) < (f.radius + evac.radius));
        
        if (isOverrun) {
            evac.penaltyApplied = true;
            currentGrade = Math.max(0, currentGrade - 5);
            recordActivity(`TRAGEDY: Evacuation zone compromised! Grade -5%`);
        }
    }

    // 2. VISUAL LOGIC (Resets color if fire is cleared)
    // Check if any ACTIVE (non-mitigated) fire is currently inside the zone
    const isCurrentlyThreatened = fires.some(f => !f.isMitigated && f.radius > 0 && 
        Math.sqrt((f.x - evac.x)**2 + (f.y - evac.y)**2) < (f.radius + evac.radius));

    ctx.save();
    ctx.beginPath();
    ctx.arc(evac.x, evac.y, evac.radius, 0, Math.PI * 2);
    
    // Use isCurrentlyThreatened for color, not penaltyApplied
    ctx.strokeStyle = isCurrentlyThreatened ? "rgba(255, 50, 50, 0.8)" : "rgba(0, 255, 0, 0.5)";
    ctx.fillStyle = isCurrentlyThreatened ? "rgba(255, 0, 0, 0.2)" : "rgba(0, 255, 0, 0.05)";
    
    ctx.setLineDash([10, 5]);
    ctx.stroke();
    ctx.fill();
    ctx.restore();
});

    if (currentGrade <= 50) {
        endGame("OPERATIONAL FAILURE: Command Grade reached 50%. Mission aborted.", false);
        return;
    }

fires.forEach(fire => {
    // Check both if the fire is active AND if it has been revealed by a scan
    if (fire.radius > 0 && fire.isVisible) {
        fire.update(); 
        fire.draw(ctx); 
    }
});

    drawNodes();

activeAnimations.forEach((ani, index) => {
if (ani.type === 'drift_warning') {
        // Find the commander that belongs to this path
        const commander = fires.find(f => f.x === ani.startX && f.y === ani.startY && f.isCommander);
        
        // If commander is gone, mitigated, or finished, remove animation
        if (!commander || commander.isMitigated || !commander.driftTarget) {
            activeAnimations.splice(index, 1);
            return;
        }

        ctx.save();
        ctx.setLineDash([10, 5]);
        ctx.strokeStyle = "rgba(255, 60, 0, 0.6)";
        ctx.lineWidth = 3 / camera.zoom;
        ctx.beginPath();
        ctx.moveTo(ani.startX, ani.startY);
        ctx.lineTo(ani.endX, ani.endY);
        ctx.stroke();
        ctx.restore();
    }
// --- NEW: RENDER THE INVESTIGATION SCAN ---
    if (ani.type === 'investigation_scan') {
        ctx.save();
        ctx.beginPath();
        ctx.arc(ani.x, ani.y, ani.radius, 0, Math.PI * 2);
        
        // Create a cyan "radar" pulse effect
        ctx.strokeStyle = `rgba(0, 204, 255, ${ani.life})`;
        ctx.lineWidth = 5 / camera.zoom;
        ctx.stroke();
        
        // Draw an inner glow
        ctx.fillStyle = `rgba(0, 204, 255, ${ani.life * 0.2})`;
        ctx.fill();
        ctx.restore();

        // Animation Physics
        ani.radius += 5; // Pulse expands
        ani.life -= 0.02; // Fades out
        
        if (ani.life <= 0) activeAnimations.splice(index, 1);
    }
    if (ani.type === 'control_line') {
        ctx.strokeStyle = "rgba(255, 165, 0, 0.8)"; // Orange for Control Line
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(ani.x, ani.y, 280, 0, Math.PI * 2);
        ctx.setLineDash([15, 10]); // Dashed orange ring
        ctx.stroke();
        ctx.setLineDash([]); // Reset
        ani.life -= 0.02;
    }
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
    // --- NEW: Update Grade Display ---
    const gradeDisplay = document.getElementById('grade-display');
    if (gradeDisplay) {
        gradeDisplay.innerText = `${currentGrade}%`;
        
        // Color coding for tactical urgency
        if (currentGrade >= 80) {
            gradeDisplay.style.color = "#2ecc71"; // Green (Optimal)
        } else if (currentGrade >= 60) {
            gradeDisplay.style.color = "#f1c40f"; // Yellow (Warning)
        } else {
            gradeDisplay.style.color = "#e74c3c"; // Red (Critical)
        }
    }
}
// Initializing the app
window.addEventListener('resize', resizeCanvas);
mapImg.onload = () => {
resizeCanvas();
    
    // 1. Generate the base nodes only once
    generateNodes(); 
    
    // 2. Assign the randomized asset types (People vs Houses)
    initializeAssets(); 
    
    // 3. Create the priority regions and initial fire
    generatePriorityZone();
    startRandomFire(true);
    
    // Create Header
    const header = document.createElement('div');
    header.style = `
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.7); color: #2ecc71; padding: 5px 15px;
        border: 2px solid #2ecc71; border-radius: 5px; font-family: 'Courier New', monospace;
        font-size: 18px; font-weight: bold; letter-spacing: 2px; z-index: 1000;
        pointer-events: none; text-transform: uppercase; box-shadow: 0 0 15px rgba(46, 204, 113, 0.5);
    `;
    header.innerText = "HUMAN ONLY - FIRE SCAN SIMULATOR";
    document.body.appendChild(header);

    camera.zoom = Math.max(canvas.width / mapImg.width, canvas.height / mapImg.height);
    draw();
};
// 1. Global variable that controls simulation speed/spread
let currentSpreadMultiplier = 0.1; 

let activityLog = []; // Global list to track actions

function handleAction(nodeId, actionValue, distance) {
    if (!gameActive) return;
    // Find the specific node object using the nodeId string
    const node = nodes.find(n => n.id === nodeId);
        
    if (node && node.type === 'investigation') {
        const SCAN_RADIUS = 450; // Define how far the scan reaches

        // Trigger the animation
        activeAnimations.push({
            type: 'investigation_scan',
            x: node.x,
            y: node.y,
            radius: 10,
            maxRadius: SCAN_RADIUS, 
            life: 1.0
        });
        
        // Reveal wind info globally
        currentWind.revealed = true; 

        // ONLY reveal fires that are inside the scan radius
        fires.forEach(f => {
            const distToScan = Math.sqrt((f.x - node.x)**2 + (f.y - node.y)**2);
            if (distToScan <= SCAN_RADIUS) {
                f.isVisible = true; 
            }
        });
        
        recordActivity(`INTEL: Scanning sector ${node.id}. Local thermal signatures revealed.`);
    }
    // 1. Advance turn time
    discreteTime += TIME_PER_ACTION;

    // 2. TURN-BASED RE-IGNITION
    // Only generate new fires IF the current ones aren't all maxed out
    const allMaxed = fires.length > 0 && fires.every(f => f.radius >= 199);

    if (!allMaxed) {
        // Trigger a chance for a new fire only AFTER a choice is made
            startRandomFire(false);
            recordActivity("NEW IGNITION: Turn-based spread detected.");
        
        // Also trigger local spread/spot fires
        triggerDiscreteSpread();
        triggerCommanderSpread(); 
    }
    const actionNames = { 0: "Evacuation", 1: "Direct Suppression", 2: "Investigation Scan", 3: "Control Line" };
    const targetX = activeNode ? activeNode.x : 0;
    const targetY = activeNode ? activeNode.y : 0;
    const label = actionNames[actionValue] || "Unknown Action";

    recordActivity(`DECISION FIRED: [${label}] on ${nodeId}`);

    // --- ACTION LOGIC ---
    if (actionValue === 2) { // INVESTIGATION SCAN
        const SCAN_RADIUS = 275;
        currentWind.revealed = true;
        activeAnimations.push({ x: targetX, y: targetY, radius: 0, maxRadius: SCAN_RADIUS, type: 'scan' });
        
        let firesFound = 0;
        // NEW: Asset reveal logic
    let assetsFound = 0;
    priorityZones.forEach(zone => {
        const distToZone = Math.sqrt((zone.x - targetX)**2 + (zone.y - targetY)**2);
        if (!zone.revealed) return;

    ctx.save();
    // Set style for the dotted circle
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = zone.isCompromised ? 'gray' : '#f1c40f';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
    ctx.stroke();

    // --- NEW: INSIGNIA LOGIC ---
    const icon = zone.type === 'person' ? '⭐' : '🏠';
    const label = zone.isCompromised ? "LOST" : `${icon} PRIORITY ASSET`;
    
    ctx.fillStyle = zone.isCompromised ? 'gray' : '#f1c40f';
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    // Draw text above the circle
    ctx.fillText(label, zone.x, zone.y - zone.radius - 10);
    ctx.restore();
        // If the asset is within the scan radius and not yet revealed
        if (distToZone < SCAN_RADIUS && !zone.revealed) {
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
            if (distToFire < SCAN_RADIUS) {
                if (!f.revealed) firesFound++;
                f.revealed = true; // POP! Fire appears
                f.isVisible = true;
            }
        });

        if (firesFound > 0) {
            recordActivity(`SCAN REPORT: ${firesFound} hidden thermal signatures revealed.`);
        } else {
            recordActivity(`SCAN REPORT: No active fires detected in this sector.`);
        }
        recordActivity(`METEOROLOGY: Wind data updated.`);
    } 
else if (actionValue === 0) { 
    // Check if node already has an evacuation [cite: 1157-1158]
    if (node.evacuationDeployed) {
        recordActivity(`DENIED: Evacuation already active for ${node.id}.`);
        return; 
    }
    
    node.evacuationDeployed = true; // Mark node as used
    evacuations.push({ 
        x: targetX, 
        y: targetY, 
        radius: 75, 
        penaltyApplied: false,
        sourceNode: node.id 
    });
    activeAnimations.push({ x: targetX, y: targetY, radius: 0, maxRadius: 150, type: 'evac' });
}
// --- UPDATE SUPPRESSION / CONTROL LINE LOGIC --- [cite: 1159-1161]
 else if (actionValue === 1 || actionValue === 3) { 
    let firesAffected = 0;
    fires.forEach(f => {
        const d = Math.sqrt((f.x - targetX)**2 + (f.y - targetY)**2);
        // Range for suppression
        if (d < 280 && !f.isMitigated) { 
            f.revealed = true;
            f.isMitigated = true;
            firesAffected++;
        }
    });

        if (firesAffected > 0) {
        // --- NEW SCALING LOGIC ---
        let timePenalty = 0;
        if (firesAffected >= 7) timePenalty = 35000;
        else if (firesAffected >= 5) timePenalty = 25000;
        else if (firesAffected >= 3) timePenalty = 15000;
        else if (firesAffected >= 1) timePenalty = 5000;

        discreteTime += timePenalty;
        recordActivity(`ACTION: ${firesAffected} fires neutralized. Ops Clock +${timePenalty/1000}s`);
        
        // Add specific animation for Control Line
        if (actionValue === 3) {
            activeAnimations.push({ x: targetX, y: targetY, type: 'control_line', life: 1.0 });
        }
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

function findWindwardNode(spawnNode) {
    const windAngle = currentWind.angle;
    let bestNode = null;
    let minDist = Infinity;

    nodes.forEach(node => {
        if (node.id !== spawnNode.id && !node.isCompromised) {
            // Calculate angle from spawn to this potential target
            const angleToNode = Math.atan2(node.y - spawnNode.y, node.x - spawnNode.x);
            
            // Check if node is within a 45-degree cone of the wind direction
            const angleDiff = Math.abs(windAngle - angleToNode);
            if (angleDiff < Math.PI / 4) {
                const d = Math.sqrt((node.x - spawnNode.x)**2 + (node.y - spawnNode.y)**2);
                // Target nodes between 200 and 800 pixels away
                if (d > 200 && d < 800 && d < minDist) {
                    minDist = d;
                    bestNode = node;
                }
            }
        }
    });
    return bestNode;
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
    entry.className = 'log-entry'; // Matches the CSS above
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
        this.maxRadius = 40;
        this.isMitigated = false;
        this.isVisible = isVisible;
        this.isCommander = false; // Default
        this.pathProgress = 0;
    }

update() {
        if (this.isMitigated) {
            // Speed up termination animation (Change 0.6 to 2.5 for snappiness)
            this.radius -= 0.9; 
            if (this.radius < 0) this.radius = 0;
        } else if (this.radius < this.maxRadius) {
            this.radius += 0.5;
        }
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
    // 1. Logic for Initial Seed Fires (KEEP EXISTING)
    if (isInitial || fires.length === 0) {
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = mapImg.width;
        tempCanvas.height = mapImg.height;
        tempCtx.drawImage(mapImg, 0, 0);

        let rx, ry, valid = false;
        let attempts = 0;
        while (!valid && attempts < 1000) {
            rx = Math.random() * mapImg.width;
            ry = Math.random() * mapImg.height;
            const pixel = tempCtx.getImageData(rx, ry, 1, 1).data;
            if (isLandPixel(pixel[0], pixel[1], pixel[2])) valid = true;
            attempts++;
        }
        if (!valid) { rx=500; ry=500; }
        
        const isFirst = fires.length === 0;
        const seed = new FireSource(rx, ry, isFirst);
        seed.isCommander = true;
        fires.push(seed); 
        return;
    }

// --- 2. ADVANCE ACTIVE COMMANDERS (Ensure they reach target) ---
    fires.forEach(f => {
        if (f.isCommander && f.driftTarget && !f.isMitigated) {
            const dx = f.driftTarget.x - f.x;
            const dy = f.driftTarget.y - f.y;
            const totalDist = Math.sqrt(dx*dx + dy*dy);
            
            f.pathProgress += 100; 

            if (f.pathProgress < totalDist) {
                const ratio = f.pathProgress / totalDist;
                const subFire = new FireSource(f.x + dx * ratio, f.y + dy * ratio, f.isVisible);
                fires.push(subFire);
            } else {
                // TARGET REACHED: Spawn final node at the exact target location
                const finalFire = new FireSource(f.driftTarget.x, f.driftTarget.y, f.isVisible);
                fires.push(finalFire);
                
                recordActivity(`CRITICAL: Commander surge has reached target ${f.driftTarget.id}.`);
                f.driftTarget = null; // Animation stops naturally now
            }
        }
    });

    // --- 3. THE RANDOM QUANTITY LOOP (The "6 at a time" logic) ---
    // We roll a random number between 2 and 6 for new ignitions this turn
    const quantity = Math.floor(Math.random() * 5) + 2; 

    for (let i = 0; i < quantity; i++) {
        // A. 40% CHANCE FOR A NEW COMMANDER (Within the loop)
        if (Math.random() < 0.50) {
            const actionNodes = nodes.filter(n => n.type === 'action' && !n.isCompromised);
            if (actionNodes.length > 0) {
                const spawnNode = actionNodes[Math.floor(Math.random() * actionNodes.length)];
                
                const windAngle = currentWind.angle;
                let bestNode = null;
                let minDist = Infinity;
                nodes.forEach(node => {
                    if (node.id !== spawnNode.id) {
                        const angleToNode = Math.atan2(node.y - spawnNode.y, node.x - spawnNode.x);
                        const angleDiff = Math.abs(windAngle - angleToNode);
                        if (angleDiff < Math.PI / 4) {
                            const d = Math.sqrt((node.x - spawnNode.x)**2 + (node.y - spawnNode.y)**2);
                            if (d < minDist && d < 600) { minDist = d; bestNode = node; }
                        }
                    }
                });

                if (bestNode) {
                    const commander = new FireSource(spawnNode.x, spawnNode.y, false);
                    commander.isCommander = true;
                    commander.driftTarget = bestNode;
                    commander.pathProgress = 0;
                    
                    activeAnimations.push({
                        type: 'drift_warning',
                        startX: spawnNode.x, startY: spawnNode.y,
                        endX: bestNode.x, endY: bestNode.y,
                        life: 999 
                    });
                    fires.push(commander);
                    continue; // Skip standard logic for this specific loop iteration
                }
            }
        }

        // B. STANDARD 70/30 RANDOMNESS (The Fallback)
        const roll = Math.random();
        if (roll < 0.70 && fires.length > 0) {
            // SEQUENTIAL SPREAD
            const parent = fires[Math.floor(Math.random() * fires.length)];
            const angle = Math.random() * Math.PI * 2;
            const distance = 100 + Math.random() * 150; 
            const newX = Math.max(0, Math.min(mapImg.width, parent.x + Math.cos(angle) * distance));
            const newY = Math.max(0, Math.min(mapImg.height, parent.y + Math.sin(angle) * distance));
            fires.push(new FireSource(newX, newY, false));
        } else {
            // RANDOM SPOT FIRE
            let rx = Math.random() * mapImg.width;
            let ry = Math.random() * mapImg.height;
            fires.push(new FireSource(rx, ry, false));
        }
    }

    recordActivity(`SITUATION ALERT: ${quantity} new thermal ignitions detected across AO.`);
}
function triggerCommanderSpread() {
    let subFires = [];

    fires.forEach(f => {
        if (f.isCommander && f.driftTarget && !f.isMitigated) {
            // Calculate vector toward target
            const dx = f.driftTarget.x - f.x;
            const dy = f.driftTarget.y - f.y;
            const totalDist = Math.sqrt(dx*dx + dy*dy);
            
            // Advance the string by a fixed step (e.g., 80 pixels)
            f.pathProgress += 45; 

            if (f.pathProgress < totalDist) {
                const ratio = f.pathProgress / totalDist;
                const subX = f.x + dx * ratio;
                const subY = f.y + dy * ratio;

                // Generate new fire node in tandem
                const subFire = new FireSource(subX, subY, false);
                subFire.isSubNode = true; // Mark it as part of a string
                subFires.push(subFire);
                
                recordActivity(`COMMANDER FIRE NODE🎖️: Fire string extending toward ${f.driftTarget.id}.`);
            } else {
                // Target reached
                f.driftTarget = null; 
            }
        }
    });

    fires = [...fires, ...subFires];
}

function triggerDiscreteSpread() {
    let newSpotFires = [];

    fires.forEach(fire => {
        if (fire.isMitigated || fire.radius >= fire.maxRadius) return;

        // --- NEW: SUB-FIRE GENERATION FOR COMMANDERS ---
        if (fire.isCommander && fire.driftTarget) {
            // Commanders always try to spawn sub-fires toward their target
            if (Math.random() < 0.70) { // 70% chance to advance the line
                // Calculate direction to target
                const dx = fire.driftTarget.x - fire.x;
                const dy = fire.driftTarget.y - fire.y;
                const angleToTarget = Math.atan2(dy, dx);
                
                // Spawn a new fire slightly ahead on that path
                const jumpDistance = 45 + (Math.random() * 40);
                const newX = fire.x + Math.cos(angleToTarget) * jumpDistance;
                const newY = fire.y + Math.sin(angleToTarget) * jumpDistance;

                // Stop spawning if we reached the target node
                const distToTarget = Math.sqrt((newX - fire.driftTarget.x)**2 + (newY - fire.driftTarget.y)**2);
                
                if (distToTarget > 40) { 
                    const subFire = {
                        x: newX, y: newY,
                        radius: 0, maxRadius: 100, // Sub-fires are slightly smaller
                        revealed: false, isVisible: false, isMitigated: false,
                        isCommander: false, // Sub-fires are not commanders
                        driftTarget: null 
                    };
                    newSpotFires.push(subFire);
                    
                    
                } else {
                    recordActivity(`CRITICAL: Commander fire has reached target ${fire.driftTarget.id}.`);
                    fire.driftTarget = null; // Target reached, stop surging
                }
            }
        } 
        // --- EXISTING RANDOM SPOT FIRE LOGIC ---
        else if (Math.random() < 0.30) { // Lowered chance for non-commanders to spread wildly
            const travelAngle = currentWind.angle + ((Math.random() - 0.5) * (Math.PI / 3));
            const jumpDistance = 120 + (Math.random() * 80); 
            
            const newX = fire.x + Math.cos(travelAngle) * jumpDistance;
            const newY = fire.y + Math.sin(travelAngle) * jumpDistance;

            if (newX > 0 && newX < mapImg.width && newY > 0 && newY < mapImg.height) {
                newSpotFires.push({
                    x: newX, y: newY,
                    radius: 0, maxRadius: 150,
                    revealed: false, isVisible: false, isMitigated: false,
                    isCommander: false, driftTarget: null
                });
            }
        }
    });

    fires = [...fires, ...newSpotFires];
    if (newSpotFires.length > 0) {
        recordActivity(`WIND SPREAD: ${newSpotFires.length} new thermal signatures detected.`);
    }
}
function openActionModal(node) {
    activeNode = node;
    const container = document.getElementById('action-options-container');
    const modalContent = document.getElementById('action-modal'); 
    
    if (!modalContent || !container) return; // Safety check
    
    container.innerHTML = ''; 

    // Find distance to nearest fire
    let minDist = Infinity;
    fires.forEach(f => {
        const d = Math.sqrt((f.x - node.x)**2 + (f.y - node.y)**2);
        if (d < minDist) minDist = d;
    });

    // --- DYNAMIC COLOR LOGIC ---
    if (node.type === 'investigation') {
        modalContent.style.backgroundColor = "#737373"; 
        modalContent.style.border = "4px solid #fbc02d";
        modalContent.style.color = "#000"; 
    } else if (node.type === 'action') {
        modalContent.style.backgroundColor = "#737373"; 
        modalContent.style.border = "4px solid #2e7d32";
        modalContent.style.color = "#000";
    }

    // Define choices based on node type
    let choices = {};
    if (node.type === 'action') {
        choices = { 1: "Suppression", 0: "Evacuation" };
    } else {
        choices = { 2: "Investigate Scan", 3: "Control Line" };
    }

    // Create buttons from the choices object
    Object.entries(choices).forEach(([value, label]) => {
        const btn = document.createElement('button');
        btn.innerText = label;
        btn.className = "modal-btn"; 
        
        // Match button style to theme
        btn.style.backgroundColor = node.type === 'action' ? "#2e7d32" : "#f39c12";
        btn.style.color = "white";

        btn.onclick = () => {
            handleAction(node.id, parseInt(value), minDist);
            closeModal();
        };
        container.appendChild(btn);
    });

    // FINAL STEP: Show the modal
    modalContent.style.display = 'block';
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

// UPDATED TOUCH MOVE
window.addEventListener('touchmove', (e) => {
    // ONLY block scrolling if we are actively dragging the map
    if (isDragging) {
        if (e.cancelable) e.preventDefault(); 

        const coords = getCoords(e);
        camera.x += coords.x - lastMouse.x;
        camera.y += coords.y - lastMouse.y;
        lastMouse = { x: coords.x, y: coords.y };
        clampCamera();
    }
}, { passive: false });
// TOUCH END
window.addEventListener('touchend', () => {
    isDragging = false;
});