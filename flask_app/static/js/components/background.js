// background.js

export const DEFAULTS = {
    speed: 0.12,
    maxRadius: 2.5,
    gridResolution: 70
};

export const colorMap = {
    optviolet: '#515ada',
    optgreen: '#22c55e',
    optred: '#ef4444'
};

export function applyColor(id) {
    const color = colorMap[id] || '#515ada';
    document.documentElement.style.setProperty('--accent', color);
    localStorage.setItem('accent', id);
}

export function applySavedColor() {
    const saved = localStorage.getItem('accent') || 'optviolet';
    const color = colorMap[saved] || '#515ada';
    document.documentElement.style.setProperty('--accent', color);
}

const css = () => getComputedStyle(document.documentElement);

export function createBackground({
    cursor,
    ring,
    canvas,
    speed = DEFAULTS.speed,
    maxRadius = DEFAULTS.maxRadius,
    gridResolution = DEFAULTS.gridResolution
}) {
    let mx = -200;
    let my = -200;

    let rx = -200;
    let ry = -200;

    let gridPoints = [];
    let blobs = [];

    let W = 0;
    let H = 0;

    let mode = localStorage.getItem('background') || 'optgrid';

    const ctx = canvas.getContext('2d');

    // =========================
    // THEME
    // =========================
    function applyTheme() {
        const theme = localStorage.getItem('theme') || 'dark';
        document.documentElement.setAttribute('data-theme', theme);
    }

    // =========================
    // PUBLIC API
    // =========================
    function setMode(newMode) {
        mode = newMode;
        localStorage.setItem('background', newMode);

        if (newMode === 'optblobs') {
            createBlobs();
        }
    }

    // =========================
    // RESIZE
    // =========================
    function resize() {
        W = canvas.width = window.innerWidth;
        H = canvas.height = window.innerHeight;

        if (mode === 'optblobs') createBlobs();
    }

    // =========================
    // CURSOR
    // =========================
    function bindCursorEvents() {
        document.addEventListener('mousemove', e => {
            mx = e.clientX;
            my = e.clientY;
        });

        document.addEventListener('mousedown', () => {
            cursor.classList.add('clicking');
        });

        document.addEventListener('mouseup', () => {
            cursor.classList.remove('clicking');
        });
    }

    // =========================
    // HOVER
    // =========================
    function bindHoverEvents() {
        document.querySelectorAll('button, input, a, label, h1').forEach(el => {
            if (el.__bgHoverBound) return;

            el.addEventListener('mouseenter', () => {
                cursor.classList.add('hovered');
                ring.classList.add('hovered');
            });

            el.addEventListener('mouseleave', () => {
                cursor.classList.remove('hovered');
                ring.classList.remove('hovered');
            });

            el.__bgHoverBound = true;
        });
    }

    // =========================
    // GRID MODE (FIXED)
    // =========================
    function makeGrid() {
        if (mode !== 'optgrid') return;

        const pointsX = Math.max(1, Math.round(W / gridResolution));
        const pointsY = Math.max(1, Math.round(H / gridResolution));

        const gapX = W / pointsX;
        const gapY = H / pointsY;

        const total = pointsX * pointsY;

        if (gridPoints.length !== total) {
            gridPoints = Array.from({ length: total }, (_, i) => {
                const col = i % pointsX;
                const row = Math.floor(i / pointsX);

                return {
                    x: col * gapX + gapX / 2,
                    y: row * gapY + gapY / 2,
                    r: Math.random(),
                    a: Math.random()
                };
            });
        } else {
            for (let i = 0; i < total; i++) {
                const col = i % pointsX;
                const row = Math.floor(i / pointsX);

                gridPoints[i].x = col * gapX + gapX / 2;
                gridPoints[i].y = row * gapY + gapY / 2;
            }
        }
    }

    // =========================
    // BLOBS MODE
    // =========================
    function createBlobs() {
        const count = 12;

        blobs = Array.from({ length: count }, () => ({
            x: Math.random() * W,
            y: Math.random() * H,
            vx: (Math.random() - 0.5) * 0.3,
            vy: (Math.random() - 0.5) * 0.3,
            r: 120 + Math.random() * 200
        }));
    }

    function updateBlobs() {
        blobs.forEach(b => {
            b.x += b.vx;
            b.y += b.vy;

            if (b.x < -200) b.x = W + 200;
            if (b.x > W + 200) b.x = -200;
            if (b.y < -200) b.y = H + 200;
            if (b.y > H + 200) b.y = -200;
        });
    }

    function drawBlobs() {
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.filter = 'blur(60px)';

        const color = css().getPropertyValue('--accent').trim();

        blobs.forEach(b => {
            const grd = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
            grd.addColorStop(0, color);
            grd.addColorStop(1, 'transparent');

            ctx.fillStyle = grd;
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
            ctx.fill();
        });

        ctx.restore();
    }

    // =========================
    // CURSOR UPDATE
    // =========================
    function updateCursor() {
        rx += (mx - rx) * speed;
        ry += (my - ry) * speed;

        cursor.style.left = `${mx}px`;
        cursor.style.top = `${my}px`;

        ring.style.left = `${rx}px`;
        ring.style.top = `${ry}px`;
    }

    // =========================
    // GLOW
    // =========================
    function drawGlow() {
        const grd = ctx.createRadialGradient(mx, my, 5, mx, my, 340);

        const root = css();
        const glow1 = root.getPropertyValue('--glow1').trim();
        const glow2 = root.getPropertyValue('--glow2').trim();

        grd.addColorStop(0, glow1);
        grd.addColorStop(1, glow2);

        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, W, H);
    }

    // =========================
    // DOTS
    // =========================
    function updateDots() {
        if (mode !== 'optgrid') return;

        gridPoints.forEach(dot => {
            const dist = (mx - dot.x) ** 2 + (my - dot.y) ** 2;
            dot.a = 30 / Math.sqrt(dist || 1);
            dot.r = Math.min(1000 / Math.sqrt(dist || 1), maxRadius);
        });
    }

    function drawDots() {
        if (mode !== 'optgrid') return;

        const root = css();
        const color = root.getPropertyValue("--dots").trim();
        const fallof = root.getPropertyValue("--dot_fallof").trim();

        gridPoints.forEach(dot => {
            ctx.beginPath();
            ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);

            ctx.fillStyle = color.includes('rgb')
                ? color.replace('rgb', 'rgba').replace(')', `, ${dot.a * fallof})`)
                : color;

            ctx.fill();
        });
    }

    // =========================
    // RENDER
    // =========================
    function render() {
        applyTheme();

        updateCursor();

        ctx.clearRect(0, 0, W, H);

        if (mode === 'optgrid') {
            makeGrid();
            drawGlow();
            updateDots();
            drawDots();
        }

        if (mode === 'optblobs') {
            drawGlow();
            updateBlobs();
            drawBlobs();
        }

        requestAnimationFrame(render);
    }

    // =========================
    // START
    // =========================
    function start() {
        applySavedColor();
        resize();
        bindCursorEvents();
        bindHoverEvents();

        window.addEventListener('resize', resize);

        render();
    }

    return {
        start,
        resize,
        setMode
    };
}