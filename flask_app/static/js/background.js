// background.js

const savedTheme = localStorage.getItem('theme');

export const DEFAULTS = {
    speed: 0.12,
    maxRadius: 2.5,
    gridResolution: 70
};

const css = getComputedStyle(document.documentElement)

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

    let W = 0;
    let H = 0;

    const ctx = canvas.getContext('2d');

    function applySettings(){
        let mode = localStorage.getItem('theme');
        document.documentElement.setAttribute('data-theme', mode);
    }

    function resize() {
        W = canvas.width = window.innerWidth;
        H = canvas.height = window.innerHeight;
    }

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

    function bindKeyEvents(){
        document.addEventListener("keydown", function (event) {
            let mode = "dark"
            if (event.key == "l"){
                if (localStorage.getItem("theme") == "dark"){
                    mode = "light"
                }
                else {
                    mode = "dark"
                }
                localStorage.setItem('theme', mode);
            }
        });
            
    }

    function makeGrid() {
        const pointsX = Math.max(1, Math.round(W / gridResolution));
        const pointsY = Math.max(1, Math.round(H / gridResolution));

        const gapX = W / pointsX;
        const gapY = H / pointsY;

        const total = pointsX * pointsY;

        if (gridPoints.length === total) {
            for (let i = 0; i < total; i++) {
                const col = i % pointsX;
                const row = Math.floor(i / pointsX);

                gridPoints[i].x = col * gapX + gapX / 2;
                gridPoints[i].y = row * gapY + gapY / 2;
            }

            return;
        }

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
    }

    function updateCursor() {
        rx += (mx - rx) * speed;
        ry += (my - ry) * speed;

        cursor.style.left = `${mx}px`;
        cursor.style.top = `${my}px`;

        ring.style.left = `${rx}px`;
        ring.style.top = `${ry}px`;
    }

    function drawGlow() {
        const grd = ctx.createRadialGradient(mx, my, 5, mx, my, 340);

        const glow1 = css.getPropertyValue('--glow1').trim();
        const glow2 = css.getPropertyValue('--glow2').trim();

        grd.addColorStop(0, glow1);
        grd.addColorStop(1, glow2);

        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, W, H);
    }

    function updateDots() {
        gridPoints.forEach(dot => {
            const dist = (mx - dot.x) ** 2 + (my - dot.y) ** 2;

            dot.a = 30 / Math.sqrt(dist || 1);
            dot.r = Math.min(1000 / Math.sqrt(dist || 1), maxRadius);
        });
    }

    function drawDots() {
        gridPoints.forEach(dot => {
            ctx.beginPath();
            ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);

            let color = css.getPropertyValue("--dots").trim();
            let fallof = css.getPropertyValue("--dot_fallof").trim();

            

            ctx.fillStyle = color.includes('rgb') 
                ? color.replace('rgb', 'rgba').replace(')', `, ${dot.a * fallof})`)
                : color;
            
            ctx.fill();
        });
    }

    function render() {

        applySettings();

        updateCursor();

        ctx.clearRect(0, 0, W, H);

        makeGrid();

        drawGlow();

        updateDots();

        drawDots();

        requestAnimationFrame(render);
    }

    function start() {
        resize();

        bindCursorEvents();

        bindHoverEvents();

        bindKeyEvents();

        window.addEventListener('resize', resize);

        render();
    }

    return {
        start,
        resize
    };
}