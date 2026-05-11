import {
  initJsPsych,
  ParameterType,
} from "https://cdn.jsdelivr.net/npm/jspsych@8.0.0/+esm";
import HtmlKeyboardResponsePlugin from "https://cdn.jsdelivr.net/npm/@jspsych/plugin-html-keyboard-response@2.0.0/+esm";
import HtmlButtonResponsePlugin from "https://cdn.jsdelivr.net/npm/@jspsych/plugin-html-button-response@2.0.0/+esm";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  updateDoc,
  arrayUnion,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// =============================================================================
// CONFIG — edit these per experiment
// =============================================================================

const EXPERIMENT_COLLECTION = "vis-guidelines-pilot";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCMWifly8RpRWOiZZNRGzfRY1zEx7DBMos",
  authDomain: "svrl-vis-guidelines.firebaseapp.com",
  projectId: "svrl-vis-guidelines",
  storageBucket: "svrl-vis-guidelines.firebasestorage.app",
  messagingSenderId: "528856330293",
  appId: "1:528856330293:web:b087ceef19468bea10017c",
  measurementId: "G-DR45EM7WN4",
};

// =============================================================================

const OFFLINE_MODE = FIREBASE_CONFIG.apiKey === "TODO";

// ---------- helpers ----------

function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sampleRandomTriplets(words, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const [head, left, right] = shuffle(words).slice(0, 3);
    out.push({ head, left, right });
  }
  return out;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

// ---------- Custom triplet plugin (mouse + keyboard) ----------

class TripletPlugin {
  static info = {
    name: "triplet",
    version: "1.0.0",
    parameters: {
      head: { type: ParameterType.STRING, default: "" },
      left: { type: ParameterType.STRING, default: "" },
      right: { type: ParameterType.STRING, default: "" },
      feedback_duration: { type: ParameterType.INT, default: 150 },
    },
  };

  constructor(jsPsych) {
    this.jsPsych = jsPsych;
  }

  trial(display_element, trial) {
    display_element.innerHTML = `
      <div class="triplet-stage">
        <div class="triplet-word triplet-target">${escapeHtml(trial.head)}</div>
        <div class="triplet-choices">
          <div class="triplet-word triplet-choice" data-side="left" tabindex="0">${escapeHtml(trial.left)}</div>
          <div class="triplet-word triplet-choice" data-side="right" tabindex="0">${escapeHtml(trial.right)}</div>
        </div>
      </div>
    `;

    const leftEl = display_element.querySelector('.triplet-choice[data-side="left"]');
    const rightEl = display_element.querySelector('.triplet-choice[data-side="right"]');
    const start = performance.now();
    let finished = false;

    const finish = (side, source) => {
      if (finished) return;
      finished = true;
      cleanup();
      const el = side === "left" ? leftEl : rightEl;
      el.classList.add("selected");
      const rt = performance.now() - start;
      setTimeout(() => {
        this.jsPsych.finishTrial({
          rt,
          response_side: side,
          response_source: source, // "click" | "key"
          head: trial.head,
          left: trial.left,
          right: trial.right,
          choice: side === "left" ? trial.left : trial.right,
        });
      }, trial.feedback_duration);
    };

    const onKey = (e) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        finish("left", "key");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        finish("right", "key");
      }
    };
    const onClickLeft = () => finish("left", "click");
    const onClickRight = () => finish("right", "click");

    document.addEventListener("keydown", onKey);
    leftEl.addEventListener("click", onClickLeft);
    rightEl.addEventListener("click", onClickRight);

    function cleanup() {
      document.removeEventListener("keydown", onKey);
      leftEl.removeEventListener("click", onClickLeft);
      rightEl.removeEventListener("click", onClickRight);
    }
  }
}

// ---------- Firebase setup ----------

let docRef = null;
let participantId = null;

if (!OFFLINE_MODE) {
  const app = initializeApp(FIREBASE_CONFIG);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const cred = await signInAnonymously(auth);
  participantId = cred.user.uid;
  docRef = doc(db, EXPERIMENT_COLLECTION, participantId);
  await setDoc(
    docRef,
    {
      participantId,
      collection: EXPERIMENT_COLLECTION,
      startedAt: serverTimestamp(),
      userAgent: navigator.userAgent,
      trials: [],
    },
    { merge: true }
  );
} else {
  console.warn(
    "[OFFLINE_MODE] Firebase config is unset — trial data will be logged to console only."
  );
  participantId = "offline-" + Math.random().toString(36).slice(2, 10);
}

async function recordTrial(trial) {
  if (OFFLINE_MODE) {
    console.log("[trial]", trial);
    return;
  }
  try {
    await updateDoc(docRef, { trials: arrayUnion(trial) });
  } catch (err) {
    console.error("Firestore write failed; backing up to localStorage:", err);
    const key = `vis_backup_${participantId}`;
    const backup = JSON.parse(localStorage.getItem(key) || "[]");
    backup.push(trial);
    localStorage.setItem(key, JSON.stringify(backup));
  }
}

// ---------- build trial list ----------

const stimuli = await fetch("./stimuli.json").then((r) => r.json());

const randomTrials = sampleRandomTriplets(
  stimuli.words,
  stimuli.n_random_trials
).map((t) => ({ ...t, type: "random" }));
const validationTrials = stimuli.validation_triplets.map((t) => ({
  ...t,
  type: "validation",
}));
const catchTrials = stimuli.catch_triplets.map((t) => ({
  ...t,
  type: "catch",
}));
const allTrials = shuffle([...randomTrials, ...validationTrials, ...catchTrials]);

// ---------- jsPsych timeline ----------

const jsPsych = initJsPsych({
  on_finish: () => {
    document.body.innerHTML =
      '<div class="instructions" style="text-align:center;margin-top:4rem;"><h2>Thank you!</h2><p>Your responses have been saved. You can close this window.</p></div>';
  },
});

const timeline = [];

// Instructions screen — static example trial styled identically to the real ones.
timeline.push({
  type: HtmlButtonResponsePlugin,
  stimulus: `
    <div class="instructions">
      <p>For this study, please think back to times you have read the results
      or discussion of a VIS paper and you came across words describing the
      contributions or results of the work. We will present you with examples
      of the types of words used to describe contributions or results, and we
      are interested in your judgments about the similarity of these words.</p>

      <p>In each trial, you will see three words: one <strong>target word</strong>
      on top, and two <strong>choice words</strong> beneath it. Your task is
      to select which of the two bottom words is most similar to the target
      word in terms of the contributions or results in a VIS paper. There are
      no right or wrong answers for most trials — go with your gut. Each
      trial shows only the three words, like this:</p>

      <div class="triplet-stage example-stage">
        <div class="example-label">Example trial</div>
        <div class="triplet-word triplet-target">recommendation</div>
        <div class="triplet-choices">
          <div class="triplet-word triplet-choice">guideline</div>
          <div class="triplet-word triplet-choice">implication</div>
        </div>
      </div>

      <p>To select the option on the <strong>LEFT</strong>, press the
      <kbd>←</kbd> LEFT ARROW key or click it with your mouse.<br />
      To select the option on the <strong>RIGHT</strong>, press the
      <kbd>→</kbd> RIGHT ARROW key or click it with your mouse.</p>

      <p>The task has ${allTrials.length} trials and should take a few minutes.</p>
    </div>
  `,
  choices: ["Begin"],
  button_html: (choice) => `<button class="begin-button">${choice}</button>`,
});

// Triplet trials.
allTrials.forEach((t, i) => {
  timeline.push({
    type: TripletPlugin,
    head: t.head,
    left: t.left,
    right: t.right,
    data: {
      trial_index: i,
      type: t.type,
    },
    on_finish: async (data) => {
      const winner = data.response_side === "left" ? t.left : t.right;
      const loser = data.response_side === "left" ? t.right : t.left;
      data.winner = winner;
      data.loser = loser;
      await recordTrial({
        trial_index: i,
        type: t.type,
        head: t.head,
        left: t.left,
        right: t.right,
        winner,
        loser,
        rt: data.rt,
        response_side: data.response_side,
        response_source: data.response_source,
      });
    },
  });
});

// Completion screen.
timeline.push({
  type: HtmlKeyboardResponsePlugin,
  stimulus:
    '<div class="instructions" style="text-align:center;"><h2>All done!</h2><p>Saving your responses...</p></div>',
  choices: "NO_KEYS",
  trial_duration: 1500,
  on_start: async () => {
    if (!OFFLINE_MODE) {
      try {
        await updateDoc(docRef, { completedAt: serverTimestamp() });
      } catch (err) {
        console.error("Failed to mark session complete:", err);
      }
    }
  },
});

jsPsych.run(timeline);
