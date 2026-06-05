let targetScroll = 0;
let scrollY = 0;

const items = [
  {
    name: "start-image",
    fis: 0,
    fie: 0,
    fos: 400,
    foe: 800,
  },
    {
    name: "name",
    fis: 0,
    fie: 0,
    fos: 200,
    foe: 600,
  }
];

window.addEventListener("wheel", (e) => {
  targetScroll += e.deltaY;
  if (targetScroll < 0) targetScroll = 0;
});

function update() {
  scrollY += (targetScroll - scrollY) * 0.1;

  for (const item of items) {
    const el = document.getElementById(item.name);
    if (!el) continue;

    const fadeInStart = item.fis;
    const fadeInEnd = item.fie;
    const fadeOutStart = item.fos;
    const fadeOutEnd = item.foe;

    let opacity = 0;

    if (scrollY >= fadeInStart && scrollY <= fadeInEnd) {
      const range = fadeInEnd - fadeInStart;
      opacity = range ? (scrollY - fadeInStart) / range : 1;
    } else if (scrollY > fadeInEnd && scrollY < fadeOutStart) {
      opacity = 1;
    }

    if (scrollY >= fadeOutStart) {
      const range = fadeOutEnd - fadeOutStart;
      opacity = range ? 1 - (scrollY - fadeOutStart) / range : 0;
    }

    el.style.opacity = Math.max(0, Math.min(1, opacity));
  }

  console.log(scrollY);
  requestAnimationFrame(update);
}

update();