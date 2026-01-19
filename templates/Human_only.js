const canvas = document.getElementById('fireMap');
const ctx = canvas.getContext('2d');
const mapImg = new Image();
mapImg.src = MAP_IMAGE_URL;
let gameActive = true;
let startTime = Date.now();
const MAX_TIME = 120000; // 2 minutes in milliseconds
const COVERAGE_THRESHOLD = 0.60; // 60%

let camera = { x: 0, y: 0, zoom: 1 };
let isDragging = false;
let lastMouse = { x: 0, y: 0 };

// Move nodes to global scope so both drawing and clicking can see them
let fires = [];
let nodes = [];
let evacuations = []; // Persistent safe zones
let activeAnimations = []; // Temporary scan/pulse animations
// Add these at the very top with your other variables
let activeNode = null; 
const actionDescriptions = {
    // These IDs should match your Node IDs or CDN variable names
    'Ribbon Bridge Status': { 1: "Deploy Bridge", 0: "Retract Bridge" },
    'Fire Across Gap': { 1: "Suppress Enemy", 0: "Cease Fire" },
    'Enemy ATK/Artillery': { 0: "Neutralize Battery", 1: "Monitor Position" }
};

function generateNodes() {
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = mapImg.width;
    tempCanvas.height = mapImg.height;
    tempCtx.drawImage(mapImg, 0, 0);
    const cdnNames = ['Ribbon Bridge Status', 'Fire Across Gap', 'Enemy ATK/Artillery', 'Weather Status'];
    for (let i = 0; i < 15; i++) {
        let valid = false;
        let rx, ry;
        while (!valid) {
            rx = Math.random() * mapImg.width;
            ry = Math.random() * mapImg.height;
            const pixel = tempCtx.getImageData(rx, ry, 1, 1).data;
            if (pixel[2] < pixel[0]) { // Simple land check
                valid = true;
            }
        }
nodes.push({
    id: cdnNames[i] || `Node_${i}`, // Assign real CDN names to the first few nodes
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

    let elapsed = Date.now() - startTime;
    
    // --- 1. THE ACTIVE SCAN (Liveness Check) ---
    // Filter fires that are visible (radius > 0)
    // Count how many are NOT mitigated (Active Threats)
    let visibleFires = fires.filter(f => f.radius > 0);
    let activeThreats = visibleFires.filter(f => !f.isMitigated).length;
    
    // Calculate Total Area for the 60% Failure Rule
    let totalArea = visibleFires.reduce((sum, f) => sum + (Math.PI * f.radius * f.radius), 0);
    let mapArea = mapImg.width * mapImg.height;
    let currentCoverage = totalArea / mapArea;

    // --- 2. TERMINAL RULES ---

    // FAILURE RULE 1: Fire spreads too far (60% coverage)
    if (currentCoverage >= COVERAGE_THRESHOLD) {
        endGame("SIMULATION OVER: Fire reached 60% coverage threshold.", false);
        return; 
    }

    // SUCCESS RULE: All fires extinguished
    const totalFireRadius = visibleFires.reduce((sum, f) => sum + f.radius, 0);
    if (fires.length > 0 && activeThreats === 0 && totalFireRadius < 1) {
        endGame("MISSION SUCCESS: All fire points fully neutralized!", true);
        return; 
    }

    // TIME LIMIT RULE: Check for threats when timer ends
    if (elapsed >= MAX_TIME) {
        if (activeThreats > 0) {
            // FAILURE: Time ran out but fires are still active
            endGame("SIMULATION OVER: Time expired with active fires remaining.", false);
        } else {
            // SUCCESS: Time ran out but you contained everything (even if some are cooling)
            endGame("MISSION SUCCESS: Area successfully defended and contained!", true);
        }
        return; 
    }
// NEW FAILURE RULE: Fire reaches evacuated population
let populationOvertaken = false;
evacuations.forEach(evac => {
    fires.forEach(f => {
        // Only check active fires (radius > 0 and not mitigated)
        if (f.radius > 0 && !f.isMitigated) {
            const dist = Math.sqrt((f.x - evac.x)**2 + (f.y - evac.y)**2);
            // Collision occurs if distance is less than the sum of both radii
            if (dist < (f.radius + evac.radius - 200)) { // 10px overlap required
    populationOvertaken = true;
}
        }
    });
});

if (populationOvertaken) {
    endGame("SIMULATION OVER: Fire has overtaken an evacuated population sector.", false);
    return;
}
    // --- 3. RENDER LOOP (If we are here, the game MUST continue) ---
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(camera.x, camera.y);
    ctx.scale(camera.zoom, camera.zoom); 
    ctx.drawImage(mapImg, 0, 0);
// --- Inside the draw() function loop ---

evacuations.forEach(evac => {
    // 1. Check if any ACTIVE, non-neutralized fire is threatening the zone
    const isThreatened = fires.some(f => {
        // Only count fires that aren't neutralized/shrinking and have a physical presence
        if (f.radius <= 0 || f.isMitigated) return false;

        const dist = Math.sqrt((f.x - evac.x)**2 + (f.y - evac.y)**2);
        // Alert if fire is within 50px of touching the evacuation perimeter
        return dist < (f.radius + evac.radius + 50);
    });

    ctx.save();
    ctx.beginPath();
    ctx.arc(evac.x, evac.y, evac.radius, 0, Math.PI * 2);
    
    // 2. Dynamic Color Selection
    // Red if an active fire is close; Blue if the area is clear or fire is neutralized
    const colorPrimary = isThreatened ? "rgba(255, 50, 50, 0.8)" : "rgba(0, 150, 255, 0.5)";
    const colorFill = isThreatened ? "rgba(255, 0, 0, 0.2)" : "rgba(0, 100, 255, 0.1)";

    ctx.strokeStyle = colorPrimary;
    ctx.setLineDash([10, 10]);
    ctx.lineWidth = isThreatened ? 4 / camera.zoom : 2 / camera.zoom;
    ctx.stroke();
    
    ctx.fillStyle = colorFill;
    ctx.fill();
    ctx.setLineDash([]); 
    
    // 3. Dynamic Labeling
    ctx.fillStyle = isThreatened ? "#ff4444" : "#00ccff";
    ctx.font = `bold ${14 / camera.zoom}px Arial`;
    ctx.textAlign = "center";
    
    const statusMsg = isThreatened ? "⚠ SECTOR THREATENED" : "✓ POPULATION SECURED";
    ctx.fillText(statusMsg, evac.x, evac.y - (evac.radius + 10));
    
    ctx.restore();
});

// B. Draw/Update One-time Animations
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
    // Update and Draw only visible fires
    // We use the visibleFires array to avoid drawing ghosts, 
    // but we modify the original objects
    fires.forEach(fire => {
        if (fire.radius > 0) {
            fire.update(); 
            fire.draw(ctx);
        }
    });
   
    drawNodes();
    ctx.restore();
    
    // Pass the active threat count to the UI so you can see it
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
    // Timer calculation
    let remaining = Math.max(0, (MAX_TIME - elapsed) / 1000);
    let mins = Math.floor(remaining / 60);
    let secs = Math.floor(remaining % 60);
    document.getElementById('timer').innerText = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

    // Coverage calculation
    let totalArea = fires.reduce((sum, f) => sum + (Math.PI * f.radius * f.radius), 0);
    let mapArea = mapImg.width * mapImg.height;
    let percent = Math.min(100, (totalArea / mapArea) * 100).toFixed(2);
    
    let coverageDisplay = document.getElementById('coverage');
    
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
}
// Initializing the app
window.addEventListener('resize', resizeCanvas);
mapImg.onload = () => {
    resizeCanvas();
    startRandomFire();
    startRandomFire();
    generateNodes();
    // Create Simulation Header
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
    // Center the map initially
    fires.push(new FireSource(mapImg.width / 2, mapImg.height / 2));
    console.log("Test fire added to array:", fires);
    camera.zoom = Math.max(canvas.width / mapImg.width, canvas.height / mapImg.height);
    draw();
};
// 1. Global variable that controls simulation speed/spread
let currentSpreadMultiplier = 0.05; 

let activityLog = []; // Global list to track actions

function handleAction(nodeId, actionValue, distance) {
    const actionNames = { 0: "Evacuation", 1: "Direct Suppression", 2: "Investigation Scan", 3: "Control Line" };
    const targetX = activeNode ? activeNode.x : 0;
    const targetY = activeNode ? activeNode.y : 0;
    const label = actionNames[actionValue] || "Unknown Action";

    recordActivity(`DECISION FIRED: [${label}] on ${nodeId}`);
    closeModal(); 

    fetch('/process_action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: nodeId, value: actionValue, distance: distance }),
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === "success") {
            // Update the fire spread multiplier based on the response
            currentSpreadMultiplier = Math.min(0.08, Math.max(0.02, data.spread_increment || 0.05));
            
            if (actionValue === 2) {
                // Temporary Scan Animation
                activeAnimations.push({ x: targetX, y: targetY, radius: 0, maxRadius: 500, type: 'scan' });
                recordActivity(`SCAN RESULTS: Intel updated for ${nodeId}.`);
            } 
            else if (actionValue === 0) {
    // Change 350 to a smaller value, like 150
    const smallerRadius = 150; 

    // Permanent Safe Zone
    evacuations.push({ x: targetX, y: targetY, radius: smallerRadius });
    
    // Temporary Pulse Animation
    activeAnimations.push({ 
        x: targetX, y: targetY, 
        radius: 0, 
        maxRadius: smallerRadius, 
        type: 'evac' 
    });

    recordActivity(`FIELD REPORT: Population secured at ${nodeId}.`);
}
            else if (actionValue === 1 || actionValue === 3) {
                let firesHit = 0;
                fires.forEach(f => {
                    const d = Math.sqrt((f.x - targetX)**2 + (f.y - targetY)**2);
                    if (d < 450) { 
                        f.isMitigated = true; 
                        firesHit++; 
                    }
                });
                recordActivity(`ACTION RESULT: ${firesHit} local fire(s) neutralized via ${label}.`);
            }
        }
    })
    .catch(err => {
        console.error(err);
        recordActivity(`SYSTEM ERROR: Uplink to ${nodeId} failed.`);
    });
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
    }

update() {
        if (this.isMitigated) {
            this.radius -= 0.4; 
            if (this.radius < 0) this.radius = 0;
            this.isSynergized = false;
        } else {
            // --- NEW: Proximity Scaler Logic ---
            let synergyBonus = 0;
            this.isSynergized = false;

            // Check distance against all other fires
            fires.forEach(other => {
                if (other === this || other.isMitigated || other.radius <= 0) return;
                
                const dist = Math.sqrt((this.x - other.x)**2 + (this.y - other.y)**2);
                
                // If centers are within 400 pixels, they fuel each other
                if (dist < 400) {
                    synergyBonus += 0.35;
                    this.isSynergized = true;
                }
            });

            let growthBase = (0.5 + synergyBonus) * currentSpreadMultiplier;
            let sizeDamping = Math.max(0.1, 1 - (this.radius / this.maxRadius));
            
            this.radius += growthBase * sizeDamping;
            
            if (this.radius > this.maxRadius) this.radius = this.maxRadius;
        }
    }

draw(context) {
        if (this.radius <= 0.1) return;
        
        let flicker = (Math.random() - 0.5) * 2;
        let displayRadius = Math.max(0.1, this.radius + flicker);

        try {
            let gradient = context.createRadialGradient(this.x, this.y, 0, this.x, this.y, displayRadius);

            if (this.isMitigated) {
                gradient.addColorStop(0, 'rgba(100, 200, 255, 0.9)'); 
                gradient.addColorStop(1, 'rgba(0, 50, 200, 0)');
            } else {
                // Visual Indicator: If synergized, center is brighter/whiter (hotter)
                if (this.isSynergized) {
                    gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)'); // White hot
                    gradient.addColorStop(0.2, 'rgba(255, 255, 0, 0.8)'); // Intense yellow
                } else {
                    gradient.addColorStop(0, 'rgba(255, 250, 200, 0.9)');
                }
                gradient.addColorStop(0.4, 'rgba(255, 100, 0, 0.6)');
                gradient.addColorStop(1, 'rgba(255, 0, 0, 0)');
            }

            context.beginPath();
            context.arc(this.x, this.y, displayRadius, 0, Math.PI * 2);
            context.fillStyle = gradient;
            context.fill();
        } catch (e) {
            console.error("Drawing error:", e);
        }
    }
}

function startRandomFire() {
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = mapImg.width;
    tempCanvas.height = mapImg.height;
    tempCtx.drawImage(mapImg, 0, 0);

    let validSpot = false;
    let rx, ry;
    let attempts = 0;

    while (!validSpot && attempts < 100) {
        rx = Math.random() * mapImg.width;
        ry = Math.random() * mapImg.height;

        // Get pixel data: [Red, Green, Blue, Alpha]
        const pixel = tempCtx.getImageData(rx, ry, 1, 1).data;
        
        // Simple Ocean Check: If Blue is significantly higher than Red/Green
        // Adjust these thresholds based on your specific image colors
        if (pixel[2] < pixel[0] || pixel[2] < pixel[1]) { 
            validSpot = true;
        }
        attempts++;
    }

    if (validSpot) {
        fires.push(new FireSource(rx, ry));
        console.log(`Fire started on land at: ${rx}, ${ry}`);
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