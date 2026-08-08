const state = {
  questions: [],
  current: 0,
  score: 0,
  answered: false,
};

// DOM refs
const $ = (id) => document.getElementById(id);
const quizCard = $("quiz-card");
const resultCard = $("result-card");
const questionText = $("question-text");
const questionImage = $("question-image");
const categoryBadge = $("category-badge");
const difficultyBadge = $("difficulty-badge");
const optionsContainer = $("options");
const feedbackBox = $("feedback");
const nextBtn = $("next-btn");
const progressText = $("progress-text");
const progressFill = $("progress-fill");
const scoreDisplay = $("score-display");

// Load data with debugging statements
async function loadQuestions() {
  console.log("🔍 [Debug] Starting loadQuestions()...");
  console.log("🔗 [Debug] Fetching from URL:", window.QUESTIONS_URL);

  try {
    const res = await fetch(window.QUESTIONS_URL);
    
    // Log the HTTP response status
    console.log(`📡 [Debug] Response received. Status: ${res.status} (${res.statusText})`);

    if (!res.ok) {
      throw new Error(`Failed to load questions.json (HTTP ${res.status})`);
    }

    state.questions = await res.json();
    
    // Log the parsed data and total count
    console.log("✅ [Debug] Questions successfully loaded into state:", state.questions);
    console.log(`📊 [Debug] Total questions loaded: ${state.questions?.length ?? 0}`);

    console.log("🚀 [Debug] Calling startQuiz()...");
    startQuiz();
  } catch (err) {
    // Detailed error logging
    console.error("❌ [Debug] Error caught in loadQuestions():", err);
    
    quizCard.innerHTML = `<p style="color:var(--danger); text-align:center;">Error loading quiz data: ${err.message}</p>`;
  }
}

function startQuiz() {
  state.current = 0;
  state.score = 0;
  state.answered = false;
  resultCard.hidden = true;
  quizCard.hidden = false;
  updateMeta();
  renderQuestion();
}

function updateMeta() {
  const total = state.questions.length;
  const i = state.current + 1;
  progressText.textContent = `Question ${i} of ${total}`;
  progressFill.style.width = `${(i / total) * 100}%`;
  scoreDisplay.textContent = `Score: ${state.score} / ${total}`;
}

function renderQuestion() {
  const q = state.questions[state.current];
  state.answered = false;
  nextBtn.hidden = true;
  feedbackBox.hidden = true;

  // Category + difficulty
  categoryBadge.textContent = q.category;
  difficultyBadge.textContent = q.difficulty;
  difficultyBadge.className = `badge difficulty ${q.difficulty}`;

  // Question text
  questionText.textContent = q.question;

  // Optional image
  if (q.image && q.image.trim() !== "") {
    questionImage.src = q.image;
    questionImage.hidden = false;
  } else {
    questionImage.hidden = true;
    questionImage.removeAttribute("src");
  }

  // Options
  optionsContainer.innerHTML = "";
  q.options.forEach((opt, idx) => {
    const btn = document.createElement("button");
    btn.className = "option";
    btn.textContent = opt;
    btn.dataset.index = idx;
    btn.addEventListener("click", () => handleAnswer(idx, btn));
    optionsContainer.appendChild(btn);
  });

  updateMeta();
}

function handleAnswer(selectedIdx, selectedBtn) {
  if (state.answered) return;
  state.answered = true;

  const q = state.questions[state.current];
  const isCorrect = selectedIdx === q.answer;
  const allBtns = document.querySelectorAll(".option");

  // Mark all buttons
  allBtns.forEach((btn, idx) => {
    btn.disabled = true;
    const i = parseInt(btn.dataset.index, 10);
    if (i === q.answer) btn.classList.add("correct");
    else if (i === selectedIdx) btn.classList.add("wrong");
  });

  if (isCorrect) state.score++;

  // Feedback
  feedbackBox.className = `feedback ${isCorrect ? "good" : "bad"}`;
  feedbackBox.innerHTML = `
    <strong>${isCorrect ? "✅ Correct!" : "❌ Not quite!"}</strong>
    ${isCorrect ? "" : `The correct answer was: <em>${q.options[q.answer]}</em>. `}
    <span>ℹ️ ${q.info}</span>
  `;
  feedbackBox.hidden = false;

  updateMeta();

  nextBtn.textContent = state.current === state.questions.length - 1 ? "See Results 🏁" : "Next ➡";
  nextBtn.hidden = false;
}

nextBtn.addEventListener("click", () => {
  if (state.current < state.questions.length - 1) {
    state.current++;
    renderQuestion();
  } else {
    showResults();
  }
});

function showResults() {
  quizCard.hidden = true;
  resultCard.hidden = false;

  const pct = Math.round((state.score / state.questions.length) * 100);
  $("result-title").textContent =
    pct === 100 ? "Perfect! 🏆" : pct >= 60 ? "Great job! 🎉" : "Keep practicing! 📚";
  $("result-message").textContent = `You scored ${state.score} out of ${state.questions.length} (${pct}%).`;
}

$("restart-btn").addEventListener("click", startQuiz);

// Theme toggle (from style guide)
const themeSwitch = $("theme-switch");
const themeLabel = $("theme-label");
if (themeSwitch) {
  themeSwitch.addEventListener("change", () => {
    const t = themeSwitch.checked ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", t);
    themeLabel.textContent = t === "dark" ? "Dark" : "Light";
  });
}

// Accent picker (from style guide)
document.querySelectorAll(".accent-dot").forEach((dot) => {
  dot.addEventListener("click", () => {
    document.documentElement.setAttribute("data-accent", dot.dataset.accent);
    document.querySelectorAll(".accent-dot").forEach((d) => d.classList.remove("active"));
    dot.classList.add("active");
  });
});

// Boot
loadQuestions();