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

function startMission() {
    document.getElementById('mission-briefing').style.display = 'none';
    gameActive = true;
    // Set a random wind speed for the report
    currentWind.speed = Math.floor(Math.random() * 30) + 20; // 20-50 mph
    scheduleNextFire();
    draw();
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
// Variable ignition timer
function scheduleNextFire() {
    if (gameActive) {
        // Between 8 and 15 seconds
        const nextTime = 8000 + Math.random() * 7000; 
        setTimeout(() => {
            if (gameActive) {
                startRandomFire(false); // Can be seed or branch based on probability
                scheduleNextFire();
            }
        }, nextTime);
    }
}
scheduleNextFire(); // Start the loop

function generateNodes() {
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = mapImg.width;
    tempCanvas.height = mapImg.height;
    tempCtx.drawImage(mapImg, 0, 0);
    
    const cdnNames = ['Ribbon Bridge Status', 'Fire Across Gap', 'Enemy ATK/Artillery', 'Weather Status'];
    nodes = []; 

    for (let i = 0; i < 48; i++) {
        let valid = false;
        let rx, ry;
        let attempts = 0;

        while (!valid && attempts < 100) {
            // TIER 1: Strategic Clumping (Nodes 0-6)
            if (i < 7 && (fires.length > 0 || priorityZones.length > 0)) {
                // Pick either a fire or a priority zone as the anchor
                const anchor = Math.random() > 0.35 && priorityZones.length > 0 
                               ? priorityZones[Math.floor(Math.random() * priorityZones.length)]
                               : fires[Math.floor(Math.random() * fires.length)];
                
                if (anchor) {
                    const angle = Math.random() * Math.PI * 2;
                    const dist = 80 + Math.random() * 300; // Close but not on top
                    rx = anchor.x + Math.cos(angle) * dist;
                    ry = anchor.y + Math.sin(angle) * dist;
                }
            } 
            // TIER 2 & 3: Wide Distribution (Nodes 7-20)
            else {
                rx = Math.random() * mapImg.width;
                ry = Math.random() * mapImg.height;
            }

            // Global Validation: Ensure it's on the map and on land
            if (rx > 0 && rx < mapImg.width && ry > 0 && ry < mapImg.height) {
                const pixel = tempCtx.getImageData(rx, ry, 1, 1).data;
                // pixel[0] is Red, pixel[2] is Blue. Land usually has more Red than Blue.
                if (pixel[2] < pixel[0]) {
                    // Avoid overlapping existing nodes too closely
                    const tooCrowded = nodes.some(n => Math.sqrt((n.x - rx)**2 + (n.y - ry)**2) < 40);
                    if (!tooCrowded) valid = true;
                }
            }
            attempts++;
        }

        nodes.push({
            id: cdnNames[i] || `Node_${i}`,
            x: rx,
            y: ry,
            selected: false
        });
    }
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
            let ry = Math.random() * mapImg.height;
            const pixel = tempCtx.getImageData(rx, ry, 1, 1).data;
            const [r, g, b] = pixel;
            const isUrban = (r > 180 && g > 180 && b > 180);
            const isLand = (b < r + 20); 

            if ((isUrban || (attempts > 500 && isLand))) {
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
        // Check if node is currently "under" fire
        node.isCompromised = fires.some(f => {
            const dist = Math.sqrt((f.x - node.x)**2 + (f.y - node.y)**2);
            return dist < f.radius; // Node is inside the fire radius
        });

        const size = 20 / camera.zoom;
        ctx.save();
        
        // Visual logic: Burnt grey if compromised, otherwise standard green/orange
        if (node.isCompromised) {
            ctx.fillStyle = "#333333"; // Burnt out color
            ctx.globalAlpha = 0.7;
        } else {
            ctx.fillStyle = node.selected ? "#ff4500" : "#2ecc71";
            ctx.globalAlpha = 1.0;
        }

        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(node.x - size, node.y - size, size * 2, size * 2, 5 / camera.zoom);
        } else {
            ctx.rect(node.x - size, node.y - size, size * 2, size * 2);
        }
        ctx.fill();
        
        ctx.strokeStyle = node.isCompromised ? "red" : "white";
        ctx.lineWidth = 2 / camera.zoom;
        ctx.stroke();

        // Label change if compromised
        ctx.fillStyle = "white";
        ctx.font = `bold ${10 / camera.zoom}px Arial`;
        ctx.textAlign = "center";
        const label = node.isCompromised ? "OFFLINE" : "ACT";
        ctx.fillText(label, node.x, node.y + (5 / camera.zoom));
        
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

    // Check Case 3: Priority Asset Compromised [cite: 256, 257]
    const assetHit = priorityZones.find(zone => {
        return fires.some(f => {
            const dist = Math.sqrt((f.x - zone.x)**2 + (f.y - zone.y)**2);
            return dist < f.radius; // Fire has reached the asset
        });
    });

    if (assetHit) {
        endGame("MISSION FAILURE: A high-value priority asset has been consumed by fire.", false);
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

    // --- FIX STARTS HERE ---
    // Draw Priority Assets
    priorityZones.forEach(zone => {
        // 1. VISIBILITY CHECK: Only draw if revealed
        if (zone.revealed) { 
            ctx.save();
            
            // 2. POSITION FIX: Removed the extra ctx.translate(camera.x...) 
            // We are already in map space, so we just draw at zone.x, zone.y
            
            // Draw Danger Radius
            ctx.beginPath();
            ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255, 215, 0, 0.3)";
            ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
            ctx.lineWidth = 2 / camera.zoom;
            ctx.fill();
            ctx.stroke();

            // Rotating Reticle (Optional visual flair)
            const time = Date.now() / 500;
            const size = 40 / camera.zoom;
            
            ctx.translate(zone.x, zone.y); // Move to center of zone
            ctx.rotate(time); 
            
            ctx.lineWidth = 4 / camera.zoom;
            ctx.strokeStyle = "#FFD700"; 
            
            ctx.beginPath(); ctx.arc(0, 0, size, 0.2, 1.4); ctx.stroke();
            ctx.beginPath(); ctx.arc(0, 0, size, 1.8, 3.0); ctx.stroke();
            ctx.beginPath(); ctx.arc(0, 0, size, 3.4, 4.6); ctx.stroke();
            ctx.beginPath(); ctx.arc(0, 0, size, 5.0, 6.2); ctx.stroke();

            // Label
            ctx.rotate(-time); // Undo rotation for text
            ctx.fillStyle = "#FFD700";
            ctx.font = `bold ${16 / camera.zoom}px Courier New`;
            ctx.textAlign = "center";
            ctx.shadowColor = "black";
            ctx.shadowBlur = 4;
            ctx.fillText("⚠ ASSET", 0, -size - (10 / camera.zoom));

            ctx.restore();
        }
    });
    // --- FIX ENDS HERE ---

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

    // 2. Stagger the next two initial fires
    setTimeout(() => { 
        if(gameActive) startRandomFire(true); 
    }, 6000); // 6 seconds in
    
    setTimeout(() => { 
        if(gameActive) startRandomFire(true); 
    }, 14000); // 14 seconds in

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

    discreteTime += TIME_PER_ACTION;
    recordActivity(`TIME ADVANCED: +5s (Total: ${Math.floor(discreteTime/1000)}s)`);

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

    if (assetsFound > 0) {
        recordActivity(`INTEL ACQUIRED: ${assetsFound} Priority Assets identified.`);
    }
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
            if (d < 450 && !f.isMitigated) {
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
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.radius = 15;
        this.isMitigated = false;
        this.maxRadius = 600; 
        this.revealed = false; // Start hidden
    }

    update() {
        if (this.isMitigated) {
            this.radius -= 0.6; 
            if (this.radius < 0) this.radius = 0;
        } else {
            let synergyBonus = 0;
            fires.forEach(other => {
                if (other === this || other.isMitigated || other.radius <= 0) return;
                const dist = Math.sqrt((this.x - other.x)**2 + (this.y - other.y)**2);
                if (dist < 400) synergyBonus += 0.25;
            });

            let growthBase = (0.5 + synergyBonus) * currentSpreadMultiplier;
            let sizeDamping = Math.max(0.1, 1 - (this.radius / this.maxRadius));
            this.radius += growthBase * sizeDamping;
            if (this.radius > this.maxRadius) this.radius = this.maxRadius;
        }
    }

    draw(context) {
        // HIDDEN LOGIC: If not revealed, do not draw
        if (!this.revealed || this.radius <= 0.1) return;
        
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

function startRandomFire(forceSeed = false) {
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = mapImg.width;
    tempCanvas.height = mapImg.height;
    tempCtx.drawImage(mapImg, 0, 0);

    let validSpot = false;
    let rx, ry;
    let attempts = 0;

    // 20% chance for a random new ignition, 80% to branch off existing (sequential)
    const isNewSeed = forceSeed || fires.length === 0 || Math.random() < 0.20;

    const activeFires = fires.filter(f => f.radius > 5 && !f.isMitigated);
    const parentFire = (!isNewSeed && activeFires.length > 0) ? activeFires[Math.floor(Math.random() * activeFires.length)] : null;

    while (!validSpot && attempts < 150) {
        if (parentFire) {
            // SEQUENTIAL BRANCHING
            let spreadAngle = (Math.random() < 0.8) 
                ? currentWind.angle + (Math.random() * 0.6 - 0.3) 
                : Math.random() * Math.PI * 2;

            const dist = parentFire.radius + 50 + (Math.random() * 70); 
            rx = parentFire.x + Math.cos(spreadAngle) * dist;
            ry = parentFire.y + Math.sin(spreadAngle) * dist;
        } else {
            // NEW SEED: Truly random location
            rx = Math.random() * mapImg.width;
            ry = Math.random() * mapImg.height;
        }

        // --- VALIDATION ---
        if (rx > 0 && rx < mapImg.width && ry > 0 && ry < mapImg.height) {
            const pixel = tempCtx.getImageData(rx, ry, 1, 1).data;
            const isLand = pixel[2] < pixel[0]; // More Red than Blue = Land
            
            // If it's a NEW SEED, make sure it's not on top of another fire
            let tooCrowded = false;
            if (isNewSeed && fires.length > 0) {
                tooCrowded = fires.some(f => Math.sqrt((f.x - rx)**2 + (f.y - ry)**2) < 350);
            }

            if (isLand && !tooCrowded) validSpot = true;
        }
        attempts++;
    }

    if (validSpot) {
        fires.push(new FireSource(rx, ry));
        const msg = isNewSeed ? "NEW IGNITION: Remote sector compromised." : "FIRE SPREAD: Sequential path expanding.";
        recordActivity(msg);
    }
}
// Updated Interval to respect game state
setInterval(() => {
    if (gameActive && Math.random() < 0.3) {
        startRandomFire();
    }
}, 10000);
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
// If fire is extremely close (under 100px) but not covering it yet
if (minDist < 100) {
    choices = { 1: "EMERGENCY SUPPRESSION" }; 
    recordActivity(`CRITICAL: Heat levels rising at ${node.id}`);
} else if (minDist > 300) {
    choices = { 2: "Investigate Area (Scan)", 3: "Control Line (Preventative)" };
} else {
    choices = actionDescriptions[node.id] || { 1: "Direct Suppression", 0: "Evacuate" };
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