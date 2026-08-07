const canvas = document.getElementById("logo");
const ctx = canvas.getContext("2d");
const W = canvas.width, H = canvas.height;

/* ---------- palettes ---------- */

const PALETTES = {
  "Sunset":      ["#2b1055", "#ff5c38", "#ffb347", "#ff2e63", "#fff2d9"],
  "Ocean":       ["#03045e", "#0077b6", "#00b4d8", "#90e0ef", "#f1fbff"],
  "Forest":      ["#1b4332", "#2d6a4f", "#74c69d", "#b7e4c7", "#f6fff8"],
  "Neon Cyber":  ["#0d0221", "#f706cf", "#00f5d4", "#fee440", "#241e4e"],
  "Pastel Dream":["#ffd6e8", "#c9e4ff", "#d4f0f0", "#fff3b0", "#3a3a3a"],
  "Mono":        ["#0a0a0a", "#333333", "#777777", "#cfcfcf", "#ffffff"],
  "Retro Diner": ["#1d3557", "#e63946", "#f1faee", "#a8dadc", "#457b9d"],
  "Berry":       ["#3a0519", "#a4133c", "#c9184a", "#ff4d6d", "#ffccd5"],
  "Citrus":      ["#1a1a1a", "#ff9f1c", "#ffbf69", "#cbf3f0", "#2ec4b6"],
};

const paletteSelect = document.getElementById("palette");
["Random", ...Object.keys(PALETTES), "Custom"].forEach(name => {
  const opt = document.createElement("option");
  opt.value = name;
  opt.textContent = name;
  paletteSelect.appendChild(opt);
});

const customColorsBox = document.getElementById("customColors");
paletteSelect.addEventListener("change", () => {
  customColorsBox.classList.toggle("hidden", paletteSelect.value !== "Custom");
});

/* ---------- color helpers ---------- */

function luminance(hex) {
  const c = hex.replace("#", "");
  const r = parseInt(c.substr(0, 2), 16) / 255;
  const g = parseInt(c.substr(2, 2), 16) / 255;
  const b = parseInt(c.substr(4, 2), 16) / 255;
  const lin = v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastText(hex) {
  return luminance(hex) > 0.42 ? "#141414" : "#ffffff";
}

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickScheme() {
  let paletteChoice = paletteSelect.value;
  if (paletteChoice === "Random") {
    const keys = Object.keys(PALETTES);
    paletteChoice = keys[Math.floor(Math.random() * keys.length)];
  }

  if (paletteChoice === "Custom") {
    const bg = document.getElementById("cBg").value;
    const main = document.getElementById("cMain").value;
    const accent = document.getElementById("cAccent").value;
    return { bg, main, accent, text: contrastText(bg) };
  }

  const colors = shuffled(PALETTES[paletteChoice]);
  const bg = colors[0];
  const main = colors[1];
  const accent = colors[2];
  return { bg, main, accent, text: contrastText(bg) };
}

/* ---------- shapes ---------- */

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function polygonPoints(cx, cy, r, sides, rotation = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i * 2 * Math.PI) / sides;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

function pathFromPoints(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function starPoints(cx, cy, outerR, innerR, spikes) {
  const pts = [];
  const step = Math.PI / spikes;
  let rot = -Math.PI / 2;
  for (let i = 0; i < spikes; i++) {
    pts.push([cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR]);
    rot += step;
    pts.push([cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR]);
    rot += step;
  }
  return pts;
}

function blobPath(ctx, cx, cy, baseR, seedPoints) {
  const n = seedPoints.length;
  const pts = seedPoints.map((v, i) => {
    const a = (i * 2 * Math.PI) / n;
    const r = baseR * v;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % n];
    const mx = (p0[0] + p1[0]) / 2;
    const my = (p0[1] + p1[1]) / 2;
    if (i === 0) ctx.moveTo(mx, my);
    ctx.quadraticCurveTo(p0[0], p0[1], mx, my);
  }
  ctx.closePath();
}

function drawShape(shape, main, accent, roundness) {
  const cx = W / 2, cy = 250, r = 150;
  ctx.fillStyle = main;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 15;

  if (shape === "circle") {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }

  if (shape === "square") {
    roundRect(ctx, cx - r, cy - r, r * 2, r * 2, roundness);
    ctx.fill(); ctx.stroke();
  }

  if (shape === "triangle") {
    pathFromPoints(ctx, polygonPoints(cx, cy + 10, r * 1.05, 3));
    ctx.fill(); ctx.stroke();
  }

  if (shape === "diamond") {
    pathFromPoints(ctx, polygonPoints(cx, cy, r, 4));
    ctx.fill(); ctx.stroke();
  }

  if (shape === "hexagon") {
    pathFromPoints(ctx, polygonPoints(cx, cy, r, 6));
    ctx.fill(); ctx.stroke();
  }

  if (shape === "pentagon") {
    pathFromPoints(ctx, polygonPoints(cx, cy, r, 5));
    ctx.fill(); ctx.stroke();
  }

  if (shape === "star") {
    pathFromPoints(ctx, starPoints(cx, cy, r * 1.1, r * 0.48, 5));
    ctx.fill(); ctx.stroke();
  }

  if (shape === "ring") {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2, false);
    ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2, true);
    ctx.fill("evenodd");
    ctx.stroke();
  }

    if (shape === "blob") {
    const seed = Array.from({ length: 10 }, () => 0.75 + Math.random() * 0.45);

    blobPath(ctx, cx, cy, r, seed);

    ctx.fill();
    ctx.stroke();
    }

}




function blobPath(ctx, cx, cy, baseR, seedPoints) {
  const n = seedPoints.length;
  const pts = [];

  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2;
    const radius = baseR * seedPoints[i];

    pts.push([
      cx + Math.cos(angle) * radius,
      cy + Math.sin(angle) * radius
    ]);
  }

  ctx.beginPath();

  // start halfway between last and first point
  const startX = (pts[n - 1][0] + pts[0][0]) / 2;
  const startY = (pts[n - 1][1] + pts[0][1]) / 2;

  ctx.moveTo(startX, startY);

  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const next = pts[(i + 1) % n];

    const midX = (p[0] + next[0]) / 2;
    const midY = (p[1] + next[1]) / 2;

    ctx.quadraticCurveTo(
      p[0],
      p[1],
      midX,
      midY
    );
  }

  ctx.closePath();
}





/* ---------- decorations ---------- */

function drawDeco(kind, accent, main) {
  if (kind === "none") return;

  if (kind === "dots") {
    for (let i = 0; i < 16; i++) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = Math.random() > 0.5 ? accent : main;
      ctx.beginPath();
      ctx.arc(Math.random() * W, Math.random() * H, 6 + Math.random() * 16, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (kind === "rings") {
    for (let i = 0; i < 10; i++) {
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(Math.random() * W, Math.random() * H, 10 + Math.random() * 30, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  if (kind === "lines") {
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    for (let i = 0; i < 10; i++) {
      const y = Math.random() * H;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(80 + Math.random() * 120, y + (Math.random() * 40 - 20));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  if (kind === "grid") {
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    for (let x = 0; x <= W; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y <= H; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

/* ---------- fonts ---------- */

const FONT_LIST = Array.from(document.getElementById("font").options)
  .map(o => o.value)
  .filter(v => v !== "random");

/* ---------- main render ---------- */

let lastParams = null;

function resolve(id, list) {
  const el = document.getElementById(id);
  if (el.value !== "random") return el.value;
  return list[Math.floor(Math.random() * list.length)];
}

function render(overrides = {}) {
  const shape = overrides.shape ?? resolve("shape",
    ["circle", "square", "triangle", "diamond", "hexagon", "pentagon", "star", "ring", "blob"]);
  const font = overrides.font ?? resolve("font", FONT_LIST);
  const layout = overrides.layout ?? resolve("layout", ["stacked", "overlay", "iconOnly"]);
  const deco = overrides.deco ?? resolve("deco", ["none", "dots", "rings", "lines", "grid"]);
  const roundness = Number(document.getElementById("roundness").value);
  const transparent = document.getElementById("transparent").checked;
  const scheme = overrides.scheme ?? pickScheme();

  lastParams = { shape, font, layout, deco, scheme };

  ctx.clearRect(0, 0, W, H);

  if (!transparent) {
    ctx.fillStyle = scheme.bg;
    ctx.fillRect(0, 0, W, H);
  }

  if (deco === "grid") drawDeco("grid", scheme.accent, scheme.main);

  drawShape(shape, scheme.main, scheme.accent, roundness);

  const text = (document.getElementById("name").value || "LOGO").toUpperCase();

  if (layout !== "iconOnly") {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 10;

    if (layout === "overlay") {
      ctx.fillStyle = contrastText(scheme.main);
      let size = 84;
      ctx.font = `900 ${size}px ${font}`;
      while (ctx.measureText(text).width > W - 120 && size > 20) {
        size -= 4;
        ctx.font = `900 ${size}px ${font}`;
      }
      ctx.fillText(text, W / 2, 250);
    } else {
      ctx.fillStyle = scheme.text;
      let size = 68;
      ctx.font = `800 ${size}px ${font}`;
      while (ctx.measureText(text).width > W - 80 && size > 20) {
        size -= 4;
        ctx.font = `800 ${size}px ${font}`;
      }
      ctx.fillText(text, W / 2, 480);
    }
    ctx.shadowBlur = 0;
  }

  if (deco !== "grid") drawDeco(deco, scheme.accent, scheme.main);
}

/* ---------- controls ---------- */

document.getElementById("roundness").addEventListener("input", e => {
  document.getElementById("roundnessVal").textContent = e.target.value;
});

document.getElementById("btnGenerate").addEventListener("click", () => render());

document.getElementById("btnRecolor").addEventListener("click", () => {
  if (!lastParams) return render();
  render({
    shape: lastParams.shape,
    font: lastParams.font,
    layout: lastParams.layout,
    deco: lastParams.deco,
  });
});

document.getElementById("name").addEventListener("input", () => {
  if (lastParams) render(lastParams);
});

["cBg", "cMain", "cAccent"].forEach(id => {
  document.getElementById(id).addEventListener("input", () => {
    if (paletteSelect.value === "Custom") render();
  });
});

document.getElementById("btnExport").addEventListener("click", () => {
  const link = document.createElement("a");
  const name = (document.getElementById("name").value || "logo").trim().replace(/\s+/g, "-").toLowerCase();
  link.download = `${name || "logo"}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
});

render();