const palette = document.getElementById("palette");
const generateBtn = document.getElementById("generate");
const copyAllBtn = document.getElementById("copyAll");

const COLOR_COUNT = 5;

generateBtn.onclick = generatePalette;
copyAllBtn.onclick = copyPalette;

generatePalette();

function randomColor(){
    return "#" + Math.floor(Math.random()*16777215)
        .toString(16)
        .padStart(6,"0")
        .toUpperCase();
}

function generatePalette(){

    palette.innerHTML="";

    for(let i=0;i<COLOR_COUNT;i++){

        const color = randomColor();

        const card=document.createElement("div");
        card.className="color-card";

        card.innerHTML=`
            <div class="preview" style="background:${color}"></div>

            <div class="info">

                <input type="color" value="${color}">

                <div class="hex">${color}</div>

                <button class="copy">Copy</button>

            </div>
        `;

        const picker = card.querySelector("input");
        const preview = card.querySelector(".preview");
        const hex = card.querySelector(".hex");
        const copy = card.querySelector(".copy");

        picker.addEventListener("input",()=>{

            preview.style.background=picker.value;
            hex.textContent=picker.value.toUpperCase();

        });

        copy.onclick=()=>{

            navigator.clipboard.writeText(hex.textContent);
            toast("Copied " + hex.textContent);

        };

        hex.onclick=()=>{

            navigator.clipboard.writeText(hex.textContent);
            toast("Copied " + hex.textContent);

        };

        palette.appendChild(card);

    }

}

function copyPalette(){

    const colors=[...document.querySelectorAll(".hex")]
        .map(e=>e.textContent)
        .join(", ");

    navigator.clipboard.writeText(colors);

    toast("Palette copied!");

}

function toast(text){

    let t=document.querySelector(".toast");

    if(!t){

        t=document.createElement("div");
        t.className="toast";
        document.body.appendChild(t);

    }

    t.textContent=text;
    t.classList.add("show");

    clearTimeout(t.timer);

    t.timer=setTimeout(()=>{
        t.classList.remove("show");
    },1800);

}