// --- 1. STATE & TRANSLATIONS ---
        const STATE = {
            mode: 'DRAW', // 'DRAW' or 'IDENTIFY'
            activeTool: 'BRUSH', // 'BRUSH' or 'ERASER'
            color: '#FF3366',
            brushSize: 8,
            lang: 'en',
            isSystemBooted: false,
            screenW: window.innerWidth,
            screenH: window.innerHeight,
            // Track previous paths for smooth drawing (up to 10 hands now)
            paths: Array(10).fill(null), 
            
            detectedObjects: [],
            lastObjDetectTime: 0,
            
            // Memory dictionary to track up to 10 people simultaneously
            personMemory: {} 
        };

        const TRANSLATIONS = {
            en: { title: "AR Vision OS", subtitle: "The Ultimate Interactive Reality", startbtn: "Initialize System", developed: "Developed By", modedraw: "Draw", modeid: "Identify", loading: "BOOTING NEURAL ENGINES...", idhint: "Detecting Objects, Humans, Age & Emotion in real-time." },
            bn: { title: "এআর ভিশন ওএস", subtitle: "চূড়ান্ত ইন্টারেক্টিভ রিয়েলিটি", startbtn: "সিস্টেম চালু করুন", developed: "তৈরি করেছেন", modedraw: "আঁকুন", modeid: "শনাক্ত করুন", loading: "এআই ইঞ্জিন চালু হচ্ছে...", idhint: "বস্তু, মানুষ, বয়স এবং আবেগ রিয়েল-টাইমে শনাক্ত করা হচ্ছে।" },
            es: { title: "AR Vision OS", subtitle: "La realidad interactiva definitiva", startbtn: "Inicializar sistema", developed: "Desarrollado por", modedraw: "Dibujar", modeid: "Identificar", loading: "INICIANDO MOTORES IA...", idhint: "Detectando objetos, humanos, edad y emoción en tiempo real." },
            pt: { title: "AR Vision OS", subtitle: "A realidade interativa definitiva", startbtn: "Inicializar Sistema", developed: "Desenvolvido por", modedraw: "Desenhar", modeid: "Identificar", loading: "INICIANDO MOTORES IA...", idhint: "Detectando objetos, humanos, idade e emoção em tempo real." }
        };

        // --- 2. DOM ELEMENTS ---
        const video = document.getElementById('videoElement');
        const drawCanvas = document.getElementById('drawCanvas');
        const drawCtx = drawCanvas.getContext('2d', { willReadFrequently: true });
        const arCanvas = document.getElementById('arCanvas');
        const arCtx = arCanvas.getContext('2d');
        
        const tfjsCanvas = document.createElement('canvas');
        const tfjsCtx = tfjsCanvas.getContext('2d', { willReadFrequently: true });

        // --- 3. CORE AI ENGINES ---
        let handsAI, poseAI, objectAI;
        let animationFrameId;

        function resize() {
            STATE.screenW = window.innerWidth;
            STATE.screenH = window.innerHeight;
            drawCanvas.width = STATE.screenW;
            drawCanvas.height = STATE.screenH;
            arCanvas.width = STATE.screenW;
            arCanvas.height = STATE.screenH;
        }
        window.addEventListener('resize', resize);
        resize();

        // --- 4. STARTUP SEQUENCE ---
        async function bootSystem() {
            document.getElementById('start-menu').classList.add('opacity-0', 'pointer-events-none');
            setTimeout(() => document.getElementById('start-menu').classList.add('hidden'), 700);
            document.getElementById('app').classList.remove('hidden');
            document.getElementById('loading-overlay').classList.remove('hidden');

            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
                });
                video.srcObject = stream;
                await new Promise(resolve => { video.onloadeddata = () => { video.play(); resolve(); } });

                await tf.ready();
                objectAI = await cocoSsd.load();

                handsAI = new Hands({locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`});
                handsAI.setOptions({ maxNumHands: 10, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.7 });
                handsAI.onResults(handleHandsResults);

                poseAI = new Pose({locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}`});
                poseAI.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });
                poseAI.onResults(handlePoseResults);

                STATE.isSystemBooted = true;
                document.getElementById('loading-overlay').classList.add('hidden');
                
                requestAnimationFrame(masterRenderLoop);
            } catch (err) {
                console.error("Boot Error:", err);
                alert("Failed to initialize camera or AI. Please check permissions and internet.");
            }
        }

        // --- 5. MASTER RENDER & LOGIC LOOP ---
        async function masterRenderLoop() {
            if (!STATE.isSystemBooted) return;

            arCtx.clearRect(0, 0, arCanvas.width, arCanvas.height);

            if (video.readyState === 4 && video.videoWidth > 0) {
                if (STATE.mode === 'DRAW') {
                    await handsAI.send({ image: video });
                } 
                else if (STATE.mode === 'IDENTIFY') {
                    await poseAI.send({ image: video });
                    
                    const now = Date.now();
                    if (now - STATE.lastObjDetectTime > 200) {
                        STATE.lastObjDetectTime = now;
                        detectObjectsAsync();
                    }
                    renderObjects();
                }
            }
            animationFrameId = requestAnimationFrame(masterRenderLoop);
        }

        function mapToScreen(normX, normY) {
            const vw = video.videoWidth;
            const vh = video.videoHeight;
            const cw = STATE.screenW;
            const ch = STATE.screenH;
            const scale = Math.max(cw / vw, ch / vh);
            const renderedW = vw * scale;
            const renderedH = vh * scale;
            const offsetX = (renderedW - cw) / 2;
            const offsetY = (renderedH - ch) / 2;
            const x = (normX * renderedW) - offsetX;
            const y = (normY * renderedH) - offsetY;
            return { x, y };
        }

        // --- 7. DRAW MODE LOGIC (Smooth Dual Hands + Palm Eraser) ---
        function handleHandsResults(results) {
            if (STATE.mode !== 'DRAW') return;

            if (results.multiHandLandmarks) {
                let processedHands = 0;
                let currentFramePaths = Array(10).fill(null);

                for (const landmarks of results.multiHandLandmarks) {
                    if(processedHands >= 10) break;
                    
                    drawConnectors(arCtx, landmarks, HAND_CONNECTIONS, {color: '#ffffff', lineWidth: 1});
                    
                    const skeletonColor = STATE.activeTool === 'ERASER' ? '#00e5ff' : STATE.color;
                    drawLandmarks(arCtx, landmarks, {color: skeletonColor, lineWidth: 1, radius: 2});

                    const wrist = landmarks[0];
                    const indexTip = landmarks[8];
                    const indexPIP = landmarks[6];
                    const middleTip = landmarks[12];
                    const middlePIP = landmarks[10];
                    const ringTip = landmarks[16];
                    const ringPIP = landmarks[14];
                    const pinkyTip = landmarks[20];
                    const pinkyPIP = landmarks[18];

                    const pIndex = mapToScreen(indexTip.x, indexTip.y);
                    const pPalmCenter = mapToScreen(landmarks[9].x, landmarks[9].y);

                    const isIndexUp = Math.hypot(indexTip.x - wrist.x, indexTip.y - wrist.y) > Math.hypot(indexPIP.x - wrist.x, indexPIP.y - wrist.y);
                    const isMiddleUp = Math.hypot(middleTip.x - wrist.x, middleTip.y - wrist.y) > Math.hypot(middlePIP.x - wrist.x, middlePIP.y - wrist.y);
                    const isRingUp = Math.hypot(ringTip.x - wrist.x, ringTip.y - wrist.y) > Math.hypot(ringPIP.x - wrist.x, ringPIP.y - wrist.y);
                    const isPinkyUp = Math.hypot(pinkyTip.x - wrist.x, pinkyTip.y - wrist.y) > Math.hypot(pinkyPIP.x - wrist.x, pinkyPIP.y - wrist.y);

                    // UPGRADED GESTURE LOGIC: Much more forgiving for drawing with both hands.
                    const isPalmOpen = isIndexUp && isMiddleUp && isRingUp && isPinkyUp;
                    const isDrawGesture = isIndexUp && !isMiddleUp; // If middle finger is down, you draw! Ring/pinky state doesn't matter.

                    // Flawless multi-hand tracking
                    let bestMatch = -1;
                    let minDist = 200; 
                    for(let i=0; i<10; i++) {
                        if (STATE.paths[i] && !currentFramePaths[i]) {
                            const d = Math.hypot(STATE.paths[i].x - pIndex.x, STATE.paths[i].y - pIndex.y);
                            if (d < minDist) { minDist = d; bestMatch = i; }
                        }
                    }
                    const pathIndex = bestMatch !== -1 ? bestMatch : processedHands;

                    if (isPalmOpen) {
                        // PALM ERASE
                        drawCtx.globalCompositeOperation = 'destination-out';
                        drawCtx.beginPath();
                        drawCtx.arc(pPalmCenter.x, pPalmCenter.y, STATE.brushSize * 8, 0, Math.PI * 2);
                        drawCtx.fill();
                        
                        arCtx.beginPath();
                        arCtx.arc(pPalmCenter.x, pPalmCenter.y, STATE.brushSize * 8, 0, 2*Math.PI);
                        arCtx.strokeStyle = '#00e5ff';
                        arCtx.lineWidth = 2;
                        arCtx.setLineDash([8, 8]);
                        arCtx.stroke();
                        arCtx.setLineDash([]);

                        currentFramePaths[pathIndex] = null;
                    } 
                    else if (isDrawGesture) {
                        // DRAW OR ERASE (Tool based)
                        if (STATE.activeTool === 'ERASER') {
                            drawCtx.globalCompositeOperation = 'destination-out';
                            drawCtx.lineWidth = STATE.brushSize * 2;
                            drawCtx.strokeStyle = 'black'; 
                        } else {
                            drawCtx.globalCompositeOperation = 'source-over';
                            drawCtx.lineWidth = STATE.brushSize;
                            drawCtx.strokeStyle = STATE.color;
                        }
                        
                        drawCtx.lineCap = 'round';
                        drawCtx.lineJoin = 'round';
                        
                        let curX = pIndex.x;
                        let curY = pIndex.y;

                        drawCtx.beginPath();
                        if (STATE.paths[pathIndex] && minDist < 150) {
                            const lastP = STATE.paths[pathIndex];
                            drawCtx.moveTo(lastP.x, lastP.y);
                            
                            curX = lastP.x + (pIndex.x - lastP.x) * 0.4;
                            curY = lastP.y + (pIndex.y - lastP.y) * 0.4;
                            
                            drawCtx.lineTo(curX, curY);
                        } else {
                            drawCtx.moveTo(curX, curY);
                            drawCtx.lineTo(curX, curY);
                        }
                        drawCtx.stroke();
                        
                        arCtx.beginPath();
                        arCtx.arc(curX, curY, STATE.activeTool === 'ERASER' ? STATE.brushSize + 2 : STATE.brushSize/2 + 2, 0, 2*Math.PI);
                        arCtx.fillStyle = STATE.activeTool === 'ERASER' ? '#00e5ff' : STATE.color;
                        arCtx.fill();

                        currentFramePaths[pathIndex] = {x: curX, y: curY};
                    } else {
                        currentFramePaths[pathIndex] = null; 
                    }
                    processedHands++;
                }
                STATE.paths = currentFramePaths;
            } else {
                STATE.paths = Array(10).fill(null);
            }
        }

        // --- 8. IDENTIFY MODE LOGIC (Multi-Person Dynamic Emotions & Age) ---
        function handlePoseResults(results) {
            if (STATE.mode !== 'IDENTIFY') return;

            // Support both single and multi-pose architectures (up to 10 people simultaneously)
            let poses = [];
            if (results.multiPoseLandmarks) {
                poses = results.multiPoseLandmarks;
            } else if (results.poseLandmarks) {
                poses = [results.poseLandmarks];
            }

            // Loop through up to 10 tracked humans
            poses.slice(0, 10).forEach((landmarks, index) => {
                
                // Draw Full Skeleton
                drawConnectors(arCtx, landmarks, POSE_CONNECTIONS, {color: '#00ffcc', lineWidth: 2});
                drawLandmarks(arCtx, landmarks, {color: '#ff33ff', lineWidth: 1, radius: 3});

                const nose = mapToScreen(landmarks[0].x, landmarks[0].y);
                const eyeL = mapToScreen(landmarks[2].x, landmarks[2].y);
                const eyeR = mapToScreen(landmarks[5].x, landmarks[5].y);
                const earL = mapToScreen(landmarks[7].x, landmarks[7].y);
                const earR = mapToScreen(landmarks[8].x, landmarks[8].y);
                const mouthL = mapToScreen(landmarks[9].x, landmarks[9].y);
                const mouthR = mapToScreen(landmarks[10].x, landmarks[10].y);
                const shoulderL = mapToScreen(landmarks[11].x, landmarks[11].y);
                const shoulderR = mapToScreen(landmarks[12].x, landmarks[12].y);

                const eyeDistance = Math.hypot(eyeL.x - eyeR.x, eyeL.y - eyeR.y);
                const mouthWidth = Math.hypot(mouthL.x - mouthR.x, mouthL.y - mouthR.y);
                const headWidth = Math.hypot(earL.x - earR.x, earL.y - earR.y) || (eyeDistance * 2.5);
                const shoulderWidth = Math.hypot(shoulderL.x - shoulderR.x, shoulderL.y - shoulderR.y);

                // UPGRADED EMOTION ENGINE
                let emotion = "Neutral 😐";
                const mouthRatio = mouthWidth / (headWidth || 1);
                
                const avgMouthY = (mouthL.y + mouthR.y) / 2;
                const noseToMouthDist = avgMouthY - nose.y; 
                const surpriseRatio = noseToMouthDist / (headWidth || 1);

                if (mouthRatio > 0.38) {
                    emotion = "Happy 😊";
                } else if (surpriseRatio > 0.28) {
                    emotion = "Surprised 😲";
                } else if (mouthRatio < 0.22) {
                    emotion = "Serious 🧐";
                }

                // Initialize memory for this specific person slot
                if (!STATE.personMemory[index]) {
                    STATE.personMemory[index] = { age: null, timestamp: 0, lastHash: 0 };
                }
                const memory = STATE.personMemory[index];

                // AGE ENGINE
                if (shoulderWidth > 0) {
                    const headToShoulderRatio = headWidth / shoulderWidth;
                    let calculatedAge = (0.65 - headToShoulderRatio) * 120 + 5;
                    calculatedAge = Math.max(5, Math.min(calculatedAge, 65));
                    
                    const stableAge = Math.round(calculatedAge);
                    
                    if (!memory.age || Math.abs(memory.lastHash - stableAge) > 6 || Math.abs(Date.now() - memory.timestamp) > 3000) {
                        memory.age = stableAge;
                        memory.lastHash = stableAge;
                    }
                }
                memory.timestamp = Date.now(); 

                // FACE-ONLY BOUNDING BOX (NO COLOR OVERLAY)
                const headSize = headWidth * 1.5;
                arCtx.strokeStyle = '#00ffcc';
                arCtx.lineWidth = 2;
                arCtx.strokeRect(nose.x - headSize/2, nose.y - headSize/1.2, headSize, headSize * 1.3);
                
                // Draw HUD Text without the dark background box (uses clean drop shadow instead)
                arCtx.save();
                arCtx.translate(nose.x + headSize/2 + 10, nose.y - headSize/1.2);
                arCtx.scale(-1, 1); 
                
                // Text Shadow for ultimate clarity without blocks
                arCtx.shadowColor = "rgba(0,0,0,0.9)";
                arCtx.shadowBlur = 4;
                arCtx.shadowOffsetX = 1;
                arCtx.shadowOffsetY = 1;
                
                arCtx.fillStyle = '#00ffcc';
                arCtx.font = 'bold 12px Inter';
                arCtx.textAlign = 'right';
                arCtx.fillText(`[ ID: 0${index + 1} ]`, -10, 20);
                
                arCtx.fillStyle = '#ffffff';
                arCtx.font = '12px Inter';
                arCtx.fillText(`Age: ${memory.age || '...'}`, -10, 40);
                arCtx.fillText(`Mood: ${emotion}`, -10, 55);
                
                arCtx.restore();
            });
        }

        async function detectObjectsAsync() {
            if (!objectAI) return;
            tfjsCanvas.width = video.videoWidth;
            tfjsCanvas.height = video.videoHeight;
            tfjsCtx.drawImage(video, 0, 0, tfjsCanvas.width, tfjsCanvas.height);
            try { 
                const predictions = await objectAI.detect(tfjsCanvas); 
                // Legit Filter: Only display high confidence objects
                STATE.detectedObjects = predictions.filter(obj => obj.score > 0.55);
            } catch(e) {}
        }

        function renderObjects() {
            const scale = Math.max(STATE.screenW / video.videoWidth, STATE.screenH / video.videoHeight);
            STATE.detectedObjects.forEach(obj => {
                // NEVER track full person body bounding box (Pose logic handles faces/skeletons natively)
                if(obj.class === 'person') return; 
                
                const tl = mapToScreen(obj.bbox[0] / video.videoWidth, obj.bbox[1] / video.videoHeight);
                const mappedW = obj.bbox[2] * scale;
                const mappedH = obj.bbox[3] * scale;

                // PREMIUM SCI-FI BOUNDING BOXES (HOLLOW / NO OVERLAY)
                arCtx.strokeStyle = '#00ffcc';
                arCtx.lineWidth = 3;
                const cLen = 20; // Corner line length

                arCtx.beginPath();
                // Top Left
                arCtx.moveTo(tl.x, tl.y + cLen); arCtx.lineTo(tl.x, tl.y); arCtx.lineTo(tl.x + cLen, tl.y);
                // Top Right
                arCtx.moveTo(tl.x + mappedW - cLen, tl.y); arCtx.lineTo(tl.x + mappedW, tl.y); arCtx.lineTo(tl.x + mappedW, tl.y + cLen);
                // Bottom Right
                arCtx.moveTo(tl.x + mappedW, tl.y + mappedH - cLen); arCtx.lineTo(tl.x + mappedW, tl.y + mappedH); arCtx.lineTo(tl.x + mappedW - cLen, tl.y + mappedH);
                // Bottom Left
                arCtx.moveTo(tl.x, tl.y + mappedH - cLen); arCtx.lineTo(tl.x, tl.y + mappedH); arCtx.lineTo(tl.x + cLen, tl.y + mappedH);
                arCtx.stroke();
                
                // Sleek Label Box (Minimalist styling)
                arCtx.fillStyle = 'rgba(0, 0, 0, 0.8)';
                arCtx.fillRect(tl.x, tl.y - 30, mappedW, 30);

                arCtx.save();
                arCtx.translate(tl.x + mappedW, tl.y - 30);
                arCtx.scale(-1, 1);
                arCtx.fillStyle = '#00ffcc';
                arCtx.font = 'bold 14px Inter';
                arCtx.textAlign = 'left';
                arCtx.fillText(`[ ${obj.class.toUpperCase()} ] - ${Math.round(obj.score*100)}%`, 10, 20);
                arCtx.restore();
            });
        }

        // --- 9. UI CONTROLS ---
        
        // Language Dropdown Logic
        function toggleLangDropdown() {
            const dropdown = document.getElementById('lang-dropdown');
            if (dropdown.classList.contains('hidden')) {
                dropdown.classList.remove('hidden');
                dropdown.classList.add('fade-in');
            } else {
                dropdown.classList.add('hidden');
                dropdown.classList.remove('fade-in');
            }
        }

        // Close dropdown when clicking outside
        window.addEventListener('click', function(e) {
            const container = document.getElementById('lang-container');
            if (container && !container.contains(e.target)) {
                document.getElementById('lang-dropdown').classList.add('hidden');
            }
        });

        function setLanguage(langCode, langName) {
            STATE.lang = langCode;
            document.getElementById('current-lang-txt').innerText = langName;
            document.getElementById('lang-dropdown').classList.add('hidden');
            
            const t = TRANSLATIONS[STATE.lang];
            document.getElementById('t-title').innerText = t.title;
            document.getElementById('t-subtitle').innerText = t.subtitle;
            document.getElementById('t-startbtn').innerText = t.startbtn;
            document.getElementById('t-developed').innerText = t.developed;
            document.getElementById('t-modedraw').innerText = t.modedraw;
            document.getElementById('t-modeid').innerText = t.modeid;
            document.getElementById('loading-text').innerText = t.loading;
            document.getElementById('t-idhint').innerText = t.idhint;
        }

        function setMode(newMode) {
            STATE.mode = newMode;
            STATE.paths = Array(10).fill(null); 
            
            const btnDraw = document.getElementById('btn-mode-draw');
            const btnId = document.getElementById('btn-mode-identify');
            const toolbar = document.getElementById('toolbar');
            const idHud = document.getElementById('identify-hud');

            if (newMode === 'DRAW') {
                btnDraw.className = "px-6 py-3 rounded-xl font-bold bg-white dark:bg-white text-black transition-all shadow-md flex items-center gap-2 cursor-pointer";
                btnId.className = "px-6 py-3 rounded-xl font-bold hover:bg-white/20 text-black dark:text-white transition-all flex items-center gap-2 cursor-pointer";
                toolbar.classList.remove('hidden');
                idHud.classList.add('hidden');
            } else {
                btnId.className = "px-6 py-3 rounded-xl font-bold bg-white dark:bg-white text-black transition-all shadow-md flex items-center gap-2 cursor-pointer";
                btnDraw.className = "px-6 py-3 rounded-xl font-bold hover:bg-white/20 text-black dark:text-white transition-all flex items-center gap-2 cursor-pointer";
                toolbar.classList.add('hidden');
                idHud.classList.remove('hidden');
            }
        }

        function setTool(tool) {
            STATE.activeTool = tool;
            updateToolUI();
        }

        function setColor(hex) {
            STATE.color = hex;
            STATE.activeTool = 'BRUSH'; 
            updateToolUI();
            
            document.querySelectorAll('.color-btn').forEach(btn => {
                btn.classList.remove('ring-2');
                if(btn.style.backgroundColor === hex || btn.getAttribute('onclick').includes(hex)){
                    btn.classList.add('ring-2', `ring-[${hex}]`);
                }
            });
        }

        function updateToolUI() {
            const eraserBtn = document.getElementById('tool-eraser');
            if (STATE.activeTool === 'ERASER') {
                eraserBtn.classList.add('ring-2', 'ring-[#00e5ff]', 'bg-[#00e5ff]', 'text-black');
                eraserBtn.classList.remove('bg-gray-200', 'dark:bg-zinc-800');
            } else {
                eraserBtn.classList.remove('ring-2', 'ring-[#00e5ff]', 'bg-[#00e5ff]', 'text-black');
                eraserBtn.classList.add('bg-gray-200', 'dark:bg-zinc-800');
            }
        }

        function setBrush(size) {
            STATE.brushSize = size;
        }

        function clearCanvas() {
            drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
            arCanvas.style.backgroundColor = 'white';
            setTimeout(() => arCanvas.style.backgroundColor = 'transparent', 100);
        }

        function toggleTheme() {
            document.documentElement.classList.toggle('dark');
        }
